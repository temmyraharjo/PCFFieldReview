import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { createDropdown, Dropdown } from "../common/dropdown";
import { mountReviewControl, ReviewControl } from "../common/fieldLayout";

export class FieldReviewChoiceControl implements ComponentFramework.StandardControl<IInputs, IOutputs> {
    private context: ComponentFramework.Context<IInputs>;
    private notifyOutputChanged: () => void;
    private control: ReviewControl;
    private dropdown: Dropdown | null = null;
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
        this.currentValue = this.lastRawValue = context.parameters.value.raw ?? null;
        this.control = mountReviewControl(container, context, {
            renderEditor: (host) => {
                this.dropdown = createDropdown(host, {
                    items: this.getOptions().map((o) => ({ key: String(o.Value), label: o.Label })),
                    selectedKey: this.currentValue === null ? null : String(this.currentValue),
                    disabled: context.mode.isControlDisabled,
                    onChange: (key) => {
                        this.currentValue = key === null ? null : Number(key);
                        this.notifyOutputChanged();
                    },
                });
            },
            getCurrentValueFormatted: () => this.getFormattedValue(),
        });
    }

    public updateView(context: ComponentFramework.Context<IInputs>): void {
        this.context = context;
        if (!this.control.settings) return;
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
        this.control.destroy();
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
}
