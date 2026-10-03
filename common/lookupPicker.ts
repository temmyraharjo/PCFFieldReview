import { ReviewSettings } from "./types";
import { countLookupCandidates, fetchLookupCandidates, normalizeId } from "./dataverseApi";
import { createDropdown, Dropdown, DropdownItem } from "./dropdown";

export interface LookupPickerOptions {
    context: ComponentFramework.Context<any>;
    settings: ReviewSettings;
    currentValue: ComponentFramework.LookupValue[] | null;
    disabled: boolean;
    onChange: (value: ComponentFramework.LookupValue[] | null) => void;
}

export interface LookupEditor {
    setDisabled: (disabled: boolean) => void;
    destroy: () => void;
}

const CREATE_KEY = "__ifr_create__";

/**
 * Renders the Lookup value editor. By default ("simple") this is the same
 * plain dropdown the Choice control uses, listing existing records only --
 * no way to create a record unless settings.lookupAllowCreate is true, which
 * adds a "+ New record" entry that opens the target table's quick create form.
 *
 * "search" (and "auto" above lookupAutoThreshold) opt into the native lookup
 * dialog instead. That dialog carries its own "+ New" button which this
 * control cannot hide, so it's opt-in only. A multi-target lookup always uses
 * the dialog: merging several tables into one dropdown isn't supported.
 */
export function attachLookupEditor(host: HTMLElement, options: LookupPickerOptions): LookupEditor {
    const { context, settings } = options;
    // The Lookup control rejects settings without lookupTargets before getting here.
    const targets = settings.lookupTargets as string[];

    let disabled = options.disabled;
    let destroyed = false;
    let dropdown: Dropdown | null = null;
    let searchRow: HTMLElement | null = null;
    let renderSearchRow: (() => void) | null = null;

    function commit(value: ComponentFramework.LookupValue[] | null) {
        options.currentValue = value;
        options.onChange(value);
    }

    async function resolveMode(): Promise<"simple" | "search"> {
        if (targets.length > 1) return "search";
        const mode = settings.lookupMode ?? "simple";
        if (mode !== "auto") return mode;
        const threshold = settings.lookupAutoThreshold ?? 25;
        const count = await countLookupCandidates(context, targets[0], settings.lookupCandidateFilter, threshold);
        return count > threshold ? "search" : "simple";
    }

    async function attachDropdown() {
        const target = targets[0];
        const current = options.currentValue?.[0] ?? null;
        let records: { id: string; name: string }[] = [];

        const toItems = (): DropdownItem[] => {
            const items = records.map((r) => ({ key: r.id, label: r.name }));
            if (settings.lookupAllowCreate) {
                items.push({ key: CREATE_KEY, label: "+ New record" });
            }
            return items;
        };
        const selectedKey = () => (options.currentValue?.[0] ? normalizeId(options.currentValue[0].id) : null);

        dropdown = createDropdown(host, {
            items: [],
            selectedKey: null,
            disabled,
            onChange: (key) => {
                if (key === CREATE_KEY) {
                    void createRecord();
                    return;
                }
                const record = key ? records.find((r) => r.id === key) : undefined;
                commit(record ? [{ id: record.id, name: record.name, entityType: target }] : null);
            },
        });
        dropdown.setLoading(true);

        async function createRecord() {
            try {
                const result = await context.navigation.openForm({ entityName: target, useQuickCreateForm: true });
                const saved = result?.savedEntityReference?.[0];
                if (saved) {
                    const record = { id: normalizeId(saved.id), name: saved.name ?? "(no name)" };
                    records = [...records.filter((r) => r.id !== record.id), record];
                    commit([{ id: record.id, name: record.name, entityType: target }]);
                    dropdown?.setItems(toItems());
                }
            } catch (e) {
                // openForm rejects if the form is dismissed; fall through to restore the selection.
            }
            dropdown?.setSelected(selectedKey());
        }

        try {
            const fetched = await fetchLookupCandidates(context, target, settings.lookupCandidateFilter);
            records = fetched.map((r) => ({ id: normalizeId(r.id), name: r.name }));
        } catch (e) {
            records = [];
        }
        // Keep the current value selectable even if the candidate filter or row cap excludes it.
        if (current && !records.some((r) => r.id === normalizeId(current.id))) {
            records.unshift({ id: normalizeId(current.id), name: current.name ?? "(no name)" });
        }
        if (destroyed) return;
        dropdown.setLoading(false);
        dropdown.setItems(toItems());
        dropdown.setSelected(selectedKey());
    }

    function attachSearch() {
        const row = document.createElement("div");
        row.className = "ifr-lookup-value-row";
        host.appendChild(row);
        searchRow = row;

        renderSearchRow = () => {
            row.innerHTML = "";
            const nameSpan = document.createElement("span");
            nameSpan.className = "ifr-lookup-name";
            nameSpan.textContent = options.currentValue?.[0]?.name ?? "---";
            row.appendChild(nameSpan);
            if (disabled) return;

            const changeBtn = document.createElement("button");
            changeBtn.type = "button";
            changeBtn.className = "ifr-link-btn";
            changeBtn.textContent = "Change";
            changeBtn.addEventListener("click", () => void openSearchDialog());
            row.appendChild(changeBtn);

            if (options.currentValue?.[0]) {
                const clearBtn = document.createElement("button");
                clearBtn.type = "button";
                clearBtn.className = "ifr-link-btn";
                clearBtn.textContent = "Clear";
                clearBtn.addEventListener("click", () => {
                    commit(null);
                    renderSearchRow?.();
                });
                row.appendChild(clearBtn);
            }
        };

        async function openSearchDialog() {
            try {
                const result = await context.utils.lookupObjects({
                    entityTypes: targets,
                    allowMultiSelect: false,
                    defaultEntityType: targets[0],
                    defaultViewId: settings.lookupSearchDefaultViewId,
                } as ComponentFramework.UtilityApi.LookupOptions);
                if (result && result.length > 0) {
                    commit(result);
                    renderSearchRow?.();
                }
            } catch (e) {
                // lookupObjects rejects if the user cancels the dialog; nothing to do.
            }
        }

        renderSearchRow();
    }

    void resolveMode()
        .catch(() => "simple" as const)
        .then((mode) => {
            if (destroyed) return;
            if (mode === "search") attachSearch();
            else void attachDropdown();
        });

    return {
        setDisabled: (next) => {
            if (next === disabled) return;
            disabled = next;
            dropdown?.setDisabled(next);
            renderSearchRow?.();
        },
        destroy: () => {
            destroyed = true;
            dropdown?.destroy();
            searchRow?.remove();
        },
    };
}
