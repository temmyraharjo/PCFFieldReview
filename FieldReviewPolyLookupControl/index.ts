import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { mountReviewControl, ReviewControl } from "../common/fieldLayout";
import { createMultiPicker, MultiPicker } from "../common/multiPicker";
import { getCurrentTableName, normalizeId, tryGetCurrentRecordId } from "../common/dataverseApi";
import {
    associateItem,
    disassociateItem,
    fetchSelectedItems,
    PolyLookupItem,
    PolyLookupMetadata,
    resolvePolyLookupMetadata,
    searchCandidates,
    validatePolyLookupSettings,
} from "../common/polyLookupApi";
import { PolyLookupOutput, ReviewSettings } from "../common/types";

type Metadata = ComponentFramework.PropertyHelper.FieldPropertyMetadata.Metadata & { MaxLength?: number };

/**
 * Multi-select lookup (in the style of DCE PolyLookup) with the review thread.
 * The bound text column hosts the control and names the review thread; the
 * selection itself lives in the relationship and is saved as each tag is
 * added or removed, independently of the form's Save.
 */
export class FieldReviewPolyLookupControl implements ComponentFramework.StandardControl<IInputs, IOutputs> {
    private context: ComponentFramework.Context<IInputs>;
    private notifyOutputChanged: () => void;
    private control: ReviewControl;
    private settings: ReviewSettings | null = null;
    private picker: MultiPicker | null = null;
    private noteEl: HTMLDivElement | null = null;
    private meta: PolyLookupMetadata | null = null;
    /** Null on a create form until the record is saved. */
    private recordId: string | null = null;
    private selected: PolyLookupItem[] = [];
    private loading = true;
    private loadSeq = 0;
    private destroyed = false;
    // Only written after the user changes the selection, so opening a record never dirties the form.
    private hasOutput = false;
    private output: string | undefined;

    public init(
        context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
        _state: ComponentFramework.Dictionary,
        container: HTMLDivElement
    ): void {
        this.context = context;
        this.notifyOutputChanged = notifyOutputChanged;
        this.recordId = tryGetCurrentRecordId(context);
        this.control = mountReviewControl(container, context, {
            validate: validatePolyLookupSettings,
            renderEditor: (host, settings) => this.renderEditor(host, settings),
            getCurrentValueFormatted: () => this.selected.map((i) => i.name).join(", ") || "(none)",
        });
        this.settings = this.control.settings;
        if (this.settings) void this.load();
    }

    public updateView(context: ComponentFramework.Context<IInputs>): void {
        this.context = context;
        if (!this.settings) return;

        // A create form gets its id once saved: load what's now related (e.g. by a post-create plugin).
        const recordId = tryGetCurrentRecordId(context);
        if (recordId !== this.recordId) {
            this.recordId = recordId;
            void this.loadSelected();
        }
        this.syncState();
    }

    public getOutputs(): IOutputs {
        return this.hasOutput ? { value: this.output } : {};
    }

    public destroy(): void {
        this.destroyed = true;
        this.control.destroy();
        this.picker?.destroy();
    }

    private get outputMode(): PolyLookupOutput {
        return this.settings?.polyLookupOutput ?? "none";
    }

    /** On a create form, selections can only be staged for a plugin, which needs the JSON output. */
    private get canStage(): boolean {
        return this.outputMode === "json";
    }

    private renderEditor(editorHost: HTMLElement, settings: ReviewSettings): void {
        this.picker = createMultiPicker(editorHost, {
            selected: [],
            disabled: true,
            itemLimit: settings.polyLookupItemLimit,
            placeholder: "Look for records",
            search: (term) => searchCandidates(this.context, this.meta!, term, this.settings?.lookupCandidateFilter),
            onAdd: (item) => this.add(item),
            onRemove: (item) => this.remove(item),
            onCreate: settings.lookupAllowCreate ? () => this.createRecord() : undefined,
            onOpen: (item) => this.openRecord(item),
        });

        this.noteEl = document.createElement("div");
        this.noteEl.className = "ifr-help";
        this.noteEl.style.display = "none";
        editorHost.appendChild(this.noteEl);
    }

    private async load(): Promise<void> {
        try {
            this.meta = await resolvePolyLookupMetadata(this.context, getCurrentTableName(this.context), this.settings!);
        } catch (e) {
            if (this.destroyed) return;
            this.loading = false;
            this.control.showError((e as Error).message);
            this.syncState();
            return;
        }
        await this.loadSelected();
    }

    private async loadSelected(): Promise<void> {
        if (!this.meta) return;
        const seq = ++this.loadSeq;
        const recordId = this.recordId;
        if (!recordId) {
            // Create form: nothing is related yet. Keep anything staged for the plugin.
            this.loading = false;
            this.syncState();
            return;
        }
        this.loading = true;
        this.syncState();
        try {
            const items = await fetchSelectedItems(this.context, this.meta, recordId);
            if (this.destroyed || seq !== this.loadSeq) return;
            this.selected = items;
            this.picker?.setSelected(items);
            this.picker?.showError(null);
        } catch (e) {
            if (this.destroyed || seq !== this.loadSeq) return;
            this.picker?.showError(`Couldn't load the selected records: ${(e as Error).message}`);
        }
        this.loading = false;
        this.syncState();
    }

    /** Enables the picker only when it can save, and explains why not on a create form. */
    private syncState(): void {
        const unsavedAndCantStage = this.recordId === null && !this.canStage;
        this.picker?.setDisabled(
            this.context.mode.isControlDisabled || this.loading || !this.meta || unsavedAndCantStage
        );
        if (this.noteEl) {
            const showNote = !!this.meta && unsavedAndCantStage && !this.context.mode.isControlDisabled;
            this.noteEl.textContent = "Save the record to select items.";
            this.noteEl.style.display = showNote ? "block" : "none";
        }
    }

    private async add(item: PolyLookupItem): Promise<void> {
        if (!this.meta || this.selected.some((s) => s.id === item.id)) return;
        const saved = this.recordId ? await associateItem(this.context, this.meta, this.recordId, item) : item;
        this.selected = [...this.selected, saved];
        this.picker?.setSelected(this.selected);
        this.writeOutput();
    }

    private async remove(item: PolyLookupItem): Promise<void> {
        if (!this.meta) return;
        if (this.recordId) await disassociateItem(this.context, this.meta, this.recordId, item);
        this.selected = this.selected.filter((s) => s.id !== item.id);
        this.picker?.setSelected(this.selected);
        this.writeOutput();
    }

    private async createRecord(): Promise<PolyLookupItem | null> {
        if (!this.meta) return null;
        try {
            const result = await this.context.navigation.openForm({
                entityName: this.meta.targetTable,
                useQuickCreateForm: true,
            });
            const saved = result?.savedEntityReference?.[0];
            return saved ? { id: normalizeId(saved.id), name: saved.name ?? "(no name)", linkIds: [] } : null;
        } catch (e) {
            // openForm rejects when the form is dismissed.
            return null;
        }
    }

    private openRecord(item: PolyLookupItem): void {
        if (!this.meta) return;
        void this.context.navigation.openForm({ entityName: this.meta.targetTable, entityId: item.id });
    }

    /** Mirrors the selection into the bound column, per settings.polyLookupOutput. */
    private writeOutput(): void {
        if (!this.meta || this.outputMode === "none") return;
        const maxLength = (this.context.parameters.value.attributes as Metadata | undefined)?.MaxLength;
        let value: string;
        if (this.outputMode === "json") {
            value = this.selected.length
                ? JSON.stringify(this.selected.map((i) => ({ id: i.id, name: i.name, etn: this.meta!.targetTable })))
                : "";
            if (maxLength && value.length > maxLength) {
                // Truncated JSON would be unreadable, so leave the column as it was.
                this.picker?.showError(
                    `The selection is too long for this column (${value.length} of ${maxLength} characters), so it wasn't written to it.`
                );
                return;
            }
        } else {
            value = this.selected.map((i) => i.name).join(", ");
            if (maxLength && value.length > maxLength) value = `${value.slice(0, maxLength - 1)}…`;
        }
        this.output = value || undefined;
        this.hasOutput = true;
        this.notifyOutputChanged();
    }
}
