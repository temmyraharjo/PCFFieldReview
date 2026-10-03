import { makeFloating, placeFixed } from "./floating";
import { icon } from "./panel";
import type { PolyLookupItem } from "./polyLookupApi";

type T = PolyLookupItem;

export interface MultiPickerOptions {
    selected: T[];
    disabled: boolean;
    /** Maximum number of selected items; undefined means no limit. */
    itemLimit?: number;
    /** Text shown in the empty, enabled search box. */
    placeholder: string;
    search: (term: string) => Promise<{ items: T[]; more: boolean }>;
    /** Called when the user picks an item. Rejecting shows the error under the control. */
    onAdd: (item: T) => Promise<void>;
    /** Called when the user removes a tag. Rejecting shows the error under the control. */
    onRemove: (item: T) => Promise<void>;
    /** Adds a "+ New record" entry to the list when set. Resolves the created item, or null if cancelled. */
    onCreate?: () => Promise<T | null>;
    /** Called when a tag's name is clicked. */
    onOpen: (item: T) => void;
}

export interface MultiPicker {
    setSelected: (items: T[]) => void;
    setDisabled: (disabled: boolean) => void;
    showError: (message: string | null) => void;
    destroy: () => void;
}

const SEARCH_DELAY_MS = 250;
const ICON_REMOVE = '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>';

/**
 * A multi-select value editor: the selected records as tags, followed by a
 * search box whose suggestions open below it. The picker holds no data of its
 * own beyond what it's given: the control saves each change through onAdd /
 * onRemove and then calls setSelected with the result.
 *
 * The suggestion list is appended to document.body (like the review panel) so
 * the form's fixed-size field cell can't clip it.
 */
export function createMultiPicker(host: HTMLElement, options: MultiPickerOptions): MultiPicker {
    let selected = options.selected;
    let disabled = options.disabled;
    let busy = false;

    const box = document.createElement("div");
    box.className = "ifr-multi";
    host.appendChild(box);

    const tags = document.createElement("div");
    tags.className = "ifr-multi-tags";
    box.appendChild(tags);

    const input = document.createElement("input");
    input.type = "text";
    input.className = "ifr-multi-input";
    input.setAttribute("aria-autocomplete", "list");
    box.appendChild(input);

    const errorEl = document.createElement("div");
    errorEl.className = "ifr-field-error";
    errorEl.style.display = "none";
    host.appendChild(errorEl);

    let list: HTMLDivElement | null = null;
    let listItems: T[] = [];
    let activeIndex = -1;
    let searchTimer: number | undefined;
    let searchSeq = 0;
    let outsideClickHandler: ((e: MouseEvent) => void) | null = null;
    let repositionHandler: (() => void) | null = null;

    const limitReached = () => options.itemLimit !== undefined && selected.length >= options.itemLimit;
    const canEdit = () => !disabled && !busy;

    function renderTags() {
        tags.innerHTML = "";
        for (const item of selected) {
            const tag = document.createElement("span");
            tag.className = "ifr-tag";

            const name = document.createElement("button");
            name.type = "button";
            name.className = "ifr-tag-name";
            name.textContent = item.name;
            name.title = item.name;
            name.addEventListener("click", () => options.onOpen(item));
            tag.appendChild(name);

            if (!disabled) {
                const remove = document.createElement("button");
                remove.type = "button";
                remove.className = "ifr-tag-remove";
                remove.setAttribute("aria-label", `Remove ${item.name}`);
                remove.appendChild(icon(ICON_REMOVE, 10, "currentColor", 3));
                remove.disabled = busy;
                remove.addEventListener("click", () => void run(() => options.onRemove(item)));
                tag.appendChild(remove);
            }
            tags.appendChild(tag);
        }
        // A read-only, empty field still needs something visible, like the platform's "---".
        if (disabled && selected.length === 0) {
            const empty = document.createElement("span");
            empty.className = "ifr-multi-empty";
            empty.textContent = "---";
            tags.appendChild(empty);
        }
    }

    function renderInput() {
        const hidden = disabled || limitReached();
        input.style.display = hidden ? "none" : "";
        input.disabled = busy;
        input.placeholder = selected.length === 0 ? options.placeholder : "";
        box.classList.toggle("ifr-multi-disabled", disabled);
        if (hidden) closeList();
    }

    function render() {
        renderTags();
        renderInput();
    }

    /** Runs one save (add / remove / create), blocking further edits and surfacing its error. */
    async function run(action: () => Promise<void>) {
        if (!canEdit()) return;
        busy = true;
        showError(null);
        render();
        try {
            await action();
        } catch (e) {
            showError((e as Error)?.message ?? String(e));
        } finally {
            busy = false;
            render();
        }
    }

    function showError(message: string | null) {
        errorEl.textContent = message ?? "";
        errorEl.style.display = message ? "block" : "none";
    }

    // --- Suggestion list ---

    function openList() {
        if (list || !canEdit() || limitReached()) return;
        list = document.createElement("div");
        list.className = "ifr-multi-list";
        list.setAttribute("role", "listbox");
        // Keep focus in the input while clicking inside the list.
        list.addEventListener("mousedown", (e) => e.preventDefault());
        document.body.appendChild(list);
        makeFloating(list);
        positionList();

        repositionHandler = () => positionList();
        window.addEventListener("scroll", repositionHandler, true);
        window.addEventListener("resize", repositionHandler);
        outsideClickHandler = (e: MouseEvent) => {
            const target = e.target as Node;
            if (!box.contains(target) && !list?.contains(target)) closeList();
        };
        document.addEventListener("mousedown", outsideClickHandler);
        runSearch();
    }

    function closeList() {
        window.clearTimeout(searchTimer);
        searchSeq++;
        list?.remove();
        list = null;
        listItems = [];
        activeIndex = -1;
        if (repositionHandler) {
            window.removeEventListener("scroll", repositionHandler, true);
            window.removeEventListener("resize", repositionHandler);
            repositionHandler = null;
        }
        if (outsideClickHandler) {
            document.removeEventListener("mousedown", outsideClickHandler);
            outsideClickHandler = null;
        }
    }

    function positionList() {
        if (!list) return;
        const margin = 8;
        const gap = 2;
        const rect = box.getBoundingClientRect();
        const width = Math.max(rect.width, 240);
        list.style.width = `${width}px`;
        const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
        const spaceBelow = window.innerHeight - rect.bottom - gap - margin;
        const spaceAbove = rect.top - gap - margin;
        const maxHeight = 320;
        // Prefer below; flip above only when below is cramped and above has more room.
        const placeBelow = spaceBelow >= Math.min(maxHeight, 160) || spaceBelow >= spaceAbove;
        list.style.maxHeight = `${Math.min(maxHeight, placeBelow ? spaceBelow : spaceAbove)}px`;
        const top = placeBelow ? rect.bottom + gap : rect.top - gap - list.offsetHeight;
        placeFixed(list, left, Math.max(margin, top));
    }

    function scheduleSearch() {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(runSearch, SEARCH_DELAY_MS);
    }

    async function runSearch() {
        if (!list) return;
        const seq = ++searchSeq;
        renderListMessage("Loading…");
        try {
            const result = await options.search(input.value);
            if (seq !== searchSeq || !list) return;
            const selectedIds = new Set(selected.map((s) => s.id));
            listItems = result.items.filter((i) => !selectedIds.has(i.id));
            activeIndex = listItems.length > 0 ? 0 : -1;
            renderList(result.more);
        } catch (e) {
            if (seq !== searchSeq || !list) return;
            renderListMessage(`Couldn't load records: ${(e as Error)?.message ?? e}`);
        }
    }

    function renderListMessage(message: string) {
        if (!list) return;
        list.innerHTML = "";
        const row = document.createElement("div");
        row.className = "ifr-multi-note";
        row.textContent = message;
        list.appendChild(row);
        appendCreateRow();
    }

    function renderList(more: boolean) {
        if (!list) return;
        list.innerHTML = "";
        listItems.forEach((item, index) => {
            const row = document.createElement("div");
            row.className = "ifr-multi-option";
            row.setAttribute("role", "option");
            row.classList.toggle("ifr-multi-option-active", index === activeIndex);
            row.textContent = item.name;
            row.title = item.name;
            row.addEventListener("click", () => pick(item));
            row.addEventListener("mouseenter", () => setActive(index));
            list!.appendChild(row);
        });
        if (listItems.length === 0) {
            const row = document.createElement("div");
            row.className = "ifr-multi-note";
            row.textContent = input.value.trim() ? "No matching records" : "No records available";
            list.appendChild(row);
        } else if (more) {
            const row = document.createElement("div");
            row.className = "ifr-multi-note";
            row.textContent = "More records exist. Type to narrow the list.";
            list.appendChild(row);
        }
        appendCreateRow();
        positionList();
    }

    function appendCreateRow() {
        if (!list || !options.onCreate) return;
        const row = document.createElement("div");
        row.className = "ifr-multi-option ifr-multi-create";
        row.textContent = "+ New record";
        row.addEventListener("click", () => {
            closeList();
            void run(async () => {
                const created = await options.onCreate!();
                if (created && !selected.some((s) => s.id === created.id)) {
                    await options.onAdd(created);
                }
            });
        });
        list.appendChild(row);
    }

    function setActive(index: number) {
        activeIndex = index;
        list?.querySelectorAll(".ifr-multi-option:not(.ifr-multi-create)").forEach((row, i) => {
            row.classList.toggle("ifr-multi-option-active", i === index);
            if (i === index) (row as HTMLElement).scrollIntoView({ block: "nearest" });
        });
    }

    function pick(item: T) {
        const hadFocus = document.activeElement === input;
        input.value = "";
        closeList();
        void run(() => options.onAdd(item)).then(() => {
            // The input is disabled (and so blurred) while saving. Put focus back so the
            // user can keep picking, unless that filled the last slot.
            if (hadFocus && canEdit() && !limitReached()) input.focus();
        });
    }

    // --- Events ---

    const onFocus = () => openList();
    const onClick = () => openList();
    const onInput = () => {
        if (!list) openList();
        else scheduleSearch();
    };
    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!list) {
                openList();
                return;
            }
            if (listItems.length === 0) return;
            const step = e.key === "ArrowDown" ? 1 : -1;
            setActive((activeIndex + step + listItems.length) % listItems.length);
        } else if (e.key === "Enter") {
            if (list && activeIndex >= 0 && listItems[activeIndex]) {
                e.preventDefault();
                pick(listItems[activeIndex]);
            }
        } else if (e.key === "Escape") {
            closeList();
        } else if (e.key === "Tab") {
            closeList();
        }
    };
    const onBoxMouseDown = (e: MouseEvent) => {
        // Clicking the empty part of the box focuses the search input.
        if (e.target === box || e.target === tags) {
            e.preventDefault();
            input.focus();
        }
    };

    input.addEventListener("focus", onFocus);
    input.addEventListener("click", onClick);
    input.addEventListener("input", onInput);
    input.addEventListener("keydown", onKeyDown);
    box.addEventListener("mousedown", onBoxMouseDown);

    render();

    return {
        setSelected: (items) => {
            selected = items;
            render();
        },
        setDisabled: (next) => {
            if (next === disabled) return;
            disabled = next;
            render();
        },
        showError,
        destroy: () => {
            closeList();
            input.removeEventListener("focus", onFocus);
            input.removeEventListener("click", onClick);
            input.removeEventListener("input", onInput);
            input.removeEventListener("keydown", onKeyDown);
            box.removeEventListener("mousedown", onBoxMouseDown);
            box.remove();
            errorEl.remove();
        },
    };
}
