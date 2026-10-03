import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { createDropdown, Dropdown } from "../common/dropdown";
import { isFieldReadOnly, mountReviewControl, ReviewControl } from "../common/fieldLayout";

// A Yes/No column's two options carry the values 1 (true) and 0 (false).
const TRUE_KEY = "1";
const FALSE_KEY = "0";
const toKey = (value: boolean | null) => (value === null ? null : value ? TRUE_KEY : FALSE_KEY);

/** The review thread on a Yes/No column, edited with the same dropdown as the Choice control. */
export class FieldReviewYesNoControl implements ComponentFramework.StandardControl<IInputs, IOutputs> {
    private context: ComponentFramework.Context<IInputs>;
    private notifyOutputChanged: () => void;
    private control: ReviewControl;
    private dropdown: Dropdown | null = null;
    private currentValue: boolean | null = null;
    // Last value the platform handed us, so updateView only overwrites the
    // selection when the field genuinely changed elsewhere (script, business rule, etc.).
    private lastRawValue: boolean | null = null;

    public init(
        context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
        _state: ComponentFramework.Dictionary,
        container: HTMLDivElement
    ): void {
        this.context = context;
        this.notifyOutputChanged = notifyOutputChanged;
        this.currentValue = this.lastRawValue = this.readRaw();
        this.control = mountReviewControl(container, context, {
            renderEditor: (host) => {
                this.dropdown = createDropdown(host, {
                    items: this.getOptions().map((o) => ({ key: String(o.Value), label: o.Label })),
                    selectedKey: toKey(this.currentValue),
                    disabled: this.isReadOnly(),
                    onChange: (key) => {
                        this.currentValue = key === null ? null : key === TRUE_KEY;
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
        this.dropdown?.setDisabled(this.isReadOnly());

        const raw = this.readRaw();
        // Also resync when the user picked "---" but the platform kept (or restored) a value.
        if (raw !== this.lastRawValue || (this.currentValue === null && raw !== null)) {
            this.lastRawValue = raw;
            this.currentValue = raw;
            this.dropdown?.setSelected(toKey(raw));
        }
    }

    public getOutputs(): IOutputs {
        // undefined clears the value ("---"); the platform decides whether the column keeps it empty.
        return { value: this.currentValue ?? undefined };
    }

    public destroy(): void {
        this.control.destroy();
        this.dropdown?.destroy();
    }

    private readRaw(): boolean | null {
        const raw = this.context.parameters.value.raw as boolean | null | undefined;
        return raw ?? null;
    }

    private getOptions(): ComponentFramework.PropertyHelper.OptionMetadata[] {
        return this.context.parameters.value.attributes?.Options ?? [];
    }

    private getFormattedValue(): string {
        if (this.currentValue === null) return "";
        const key = toKey(this.currentValue);
        return this.getOptions().find((o) => String(o.Value) === key)?.Label ?? String(this.currentValue);
    }

    private isReadOnly(): boolean {
        return isFieldReadOnly(this.context, this.context.parameters.value.security);
    }
}
