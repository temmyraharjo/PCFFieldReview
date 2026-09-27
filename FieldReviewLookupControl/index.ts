import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { parseSettings } from "../common/settings";
import { attachFieldReview } from "../common/fieldRow";
import { attachLookupEditor, LookupEditor } from "../common/lookupPicker";
import { buildFieldLayout } from "../common/fieldLayout";
import { ReviewSettings } from "../common/types";

export class FieldReviewLookupControl implements ComponentFramework.StandardControl<IInputs, IOutputs> {
    private container: HTMLDivElement;
    private context: ComponentFramework.Context<IInputs>;
    private notifyOutputChanged: () => void;
    private settings: ReviewSettings | null = null;
    private fieldRow: { refreshBadge: () => void; destroy: () => void } | null = null;
    private lookupEditor: LookupEditor | null = null;
    private lookupHost: HTMLDivElement;
    private errorEl: HTMLDivElement;
    private currentValue: ComponentFramework.LookupValue[] | null = null;

    public init(
        context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
        _state: ComponentFramework.Dictionary,
        container: HTMLDivElement
    ): void {
        this.context = context;
        this.notifyOutputChanged = notifyOutputChanged;
        this.container = container;
        this.container.classList.add("ifr-root");

        this.errorEl = document.createElement("div");
        this.errorEl.className = "ifr-help";
        this.errorEl.style.display = "none";
        this.container.appendChild(this.errorEl);

        try {
            this.settings = parseSettings(context.parameters.settingsJson.raw);
            if (!this.settings.lookupTargets || this.settings.lookupTargets.length === 0) {
                throw new Error(
                    "Field Review (Lookup) control: settingsJson must include a non-empty lookupTargets array."
                );
            }
        } catch (e) {
            this.showError((e as Error).message);
            return;
        }

        const rawValue = (context.parameters.value as unknown as ComponentFramework.PropertyTypes.LookupProperty).raw;
        this.currentValue = rawValue && rawValue.length > 0 ? rawValue : null;

        this.render();
    }

    public updateView(context: ComponentFramework.Context<IInputs>): void {
        this.context = context;
        this.lookupEditor?.setDisabled(context.mode.isControlDisabled);
        // Intentionally not re-syncing this.currentValue from context here: while the
        // picker is mid-edit we treat the control as the source of truth for its own
        // value between commits, consistent with how PCF field controls typically
        // handle bound-property echo during editing.
    }

    public getOutputs(): IOutputs {
        return { value: this.currentValue ?? undefined } as IOutputs;
    }

    public destroy(): void {
        this.fieldRow?.destroy();
        this.lookupEditor?.destroy();
    }

    private showError(message: string): void {
        this.errorEl.textContent = message;
        this.errorEl.style.display = "block";
    }

    private render(): void {
        if (!this.settings) return;
        const prop = this.context.parameters.value as unknown as ComponentFramework.PropertyTypes.LookupProperty;
        const fieldLogicalName = prop.attributes?.LogicalName ?? "";
        const fieldDisplayName = prop.attributes?.DisplayName ?? fieldLogicalName;
        const layout = buildFieldLayout(this.container, this.settings, prop.attributes);

        this.lookupHost = document.createElement("div");
        this.lookupHost.className = "ifr-editor";
        layout.valueHost.appendChild(this.lookupHost);

        this.lookupEditor = attachLookupEditor(this.lookupHost, {
            context: this.context,
            settings: this.settings,
            currentValue: this.currentValue,
            disabled: this.context.mode.isControlDisabled,
            onChange: (value) => {
                this.currentValue = value;
                this.notifyOutputChanged();
            },
        });

        this.fieldRow = attachFieldReview(layout.reviewHost, {
            context: this.context,
            settings: this.settings,
            fieldLogicalName,
            fieldDisplayName,
            getCurrentValueFormatted: () => this.currentValue?.[0]?.name ?? "(none)",
        });
    }
}
