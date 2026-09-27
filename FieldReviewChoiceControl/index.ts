import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { parseSettings } from "../common/settings";
import { attachFieldReview } from "../common/fieldRow";
import { createDropdown, Dropdown } from "../common/dropdown";
import { buildFieldLayout } from "../common/fieldLayout";
import { ReviewSettings } from "../common/types";

export class FieldReviewChoiceControl implements ComponentFramework.StandardControl<IInputs, IOutputs> {
    private container: HTMLDivElement;
    private context: ComponentFramework.Context<IInputs>;
    private notifyOutputChanged: () => void;
    private settings: ReviewSettings | null = null;
    private fieldRow: { refreshBadge: () => void; destroy: () => void } | null = null;
    private dropdown: Dropdown | null = null;
    private dropdownHost: HTMLDivElement;
    private errorEl: HTMLDivElement;
    private currentValue: number | null = null;
    // Last value the platform handed us, so updateView only overwrites the
    // selection when the field genuinely changed elsewhere (script, rollup, etc.).
    private lastRawValue: number | null = null;

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
        } catch (e) {
            this.showError((e as Error).message);
            return;
        }

        this.currentValue = this.lastRawValue = context.parameters.value.raw ?? null;
        this.render();
    }

    public updateView(context: ComponentFramework.Context<IInputs>): void {
        this.context = context;
        if (!this.settings) return;
        this.dropdown?.setDisabled(context.mode.isControlDisabled);

        const raw = context.parameters.value.raw ?? null;
        if (raw !== this.lastRawValue) {
            this.lastRawValue = raw;
            this.currentValue = raw;
            this.dropdown?.setSelected(raw === null ? null : String(raw));
        }
    }

    public getOutputs(): IOutputs {
        return { value: this.currentValue ?? undefined };
    }

    public destroy(): void {
        this.fieldRow?.destroy();
        this.dropdown?.destroy();
    }

    private getOptions(): ComponentFramework.PropertyHelper.OptionMetadata[] {
        return this.context.parameters.value.attributes?.Options ?? [];
    }

    private getFormattedValue(): string {
        if (this.currentValue === null) return "";
        const option = this.getOptions().find((o) => o.Value === this.currentValue);
        return option?.Label ?? String(this.currentValue);
    }

    private showError(message: string): void {
        this.errorEl.textContent = message;
        this.errorEl.style.display = "block";
    }

    private render(): void {
        if (!this.settings) return;
        const prop = this.context.parameters.value;
        const fieldLogicalName = prop.attributes?.LogicalName ?? "";
        const fieldDisplayName = prop.attributes?.DisplayName ?? fieldLogicalName;
        const layout = buildFieldLayout(this.container, this.settings, prop.attributes);

        this.dropdownHost = document.createElement("div");
        this.dropdownHost.className = "ifr-editor";
        layout.valueHost.appendChild(this.dropdownHost);

        this.dropdown = createDropdown(this.dropdownHost, {
            items: this.getOptions().map((o) => ({ key: String(o.Value), label: o.Label })),
            selectedKey: this.currentValue === null ? null : String(this.currentValue),
            disabled: this.context.mode.isControlDisabled,
            onChange: (key) => {
                this.currentValue = key === null ? null : Number(key);
                this.notifyOutputChanged();
            },
        });

        this.fieldRow = attachFieldReview(layout.reviewHost, {
            context: this.context,
            settings: this.settings,
            fieldLogicalName,
            fieldDisplayName,
            getCurrentValueFormatted: () => this.getFormattedValue(),
        });
    }
}
