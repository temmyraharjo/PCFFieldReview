import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { parseSettings } from "../common/settings";
import { attachFieldReview } from "../common/fieldRow";
import { buildFieldLayout } from "../common/fieldLayout";
import { ReviewSettings } from "../common/types";

type ScalarValue = string | number | null;
type Metadata = ComponentFramework.PropertyHelper.FieldPropertyMetadata.Metadata & {
    MaxLength?: number;
    MinValue?: number;
    MaxValue?: number;
    Precision?: number;
};

export class FieldReviewControl implements ComponentFramework.StandardControl<IInputs, IOutputs> {
    private container: HTMLDivElement;
    private context: ComponentFramework.Context<IInputs>;
    private notifyOutputChanged: () => void;
    private settings: ReviewSettings | null = null;
    private fieldRow: { refreshBadge: () => void; destroy: () => void } | null = null;
    private input: HTMLInputElement | null = null;
    private validationEl: HTMLDivElement | null = null;
    private currentValue: ScalarValue = null;
    // Last value the platform handed us, so updateView only overwrites what the
    // user typed when the field genuinely changed elsewhere (script, rollup, etc.).
    private lastRawValue: ScalarValue = null;

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

        try {
            this.settings = parseSettings(context.parameters.settingsJson.raw);
        } catch (e) {
            const errorEl = document.createElement("div");
            errorEl.className = "ifr-help";
            errorEl.textContent = (e as Error).message;
            this.container.appendChild(errorEl);
            return;
        }

        this.currentValue = this.lastRawValue = this.readRaw();
        this.render();
    }

    public updateView(context: ComponentFramework.Context<IInputs>): void {
        this.context = context;
        if (!this.settings || !this.input) return;
        this.input.readOnly = this.isReadOnly();

        const raw = this.readRaw();
        if (raw !== this.lastRawValue) {
            this.lastRawValue = raw;
            this.currentValue = raw;
            this.hideValidation();
        }
        if (document.activeElement !== this.input) {
            this.input.value = this.displayText();
        }
    }

    public getOutputs(): IOutputs {
        return { value: this.currentValue ?? undefined };
    }

    public destroy(): void {
        this.fieldRow?.destroy();
    }

    private get metadata(): Metadata | undefined {
        return this.context.parameters.value.attributes as Metadata | undefined;
    }

    private isNumeric(): boolean {
        return this.context.parameters.value.type !== "SingleLine.Text";
    }

    private isReadOnly(): boolean {
        const security = this.context.parameters.value.security;
        return this.context.mode.isControlDisabled || (security !== undefined && !security.editable);
    }

    private readRaw(): ScalarValue {
        const raw = this.context.parameters.value.raw as ScalarValue | undefined;
        return raw === undefined || raw === "" ? null : raw;
    }

    /** Text shown while the input isn't focused: the platform's formatting when it matches, else our own. */
    private displayText(): string {
        if (this.currentValue === null) return "";
        if (!this.isNumeric()) return String(this.currentValue);
        const prop = this.context.parameters.value;
        if (this.currentValue === this.lastRawValue && prop.formatted) return prop.formatted;
        return this.formatNumber(this.currentValue as number);
    }

    private formatNumber(value: number): string {
        const formatting = this.context.formatting;
        switch (this.context.parameters.value.type) {
            case "Whole.None":
                return formatting.formatInteger(value);
            case "Currency":
                return formatting.formatCurrency(value, this.metadata?.Precision);
            default:
                return formatting.formatDecimal(value, this.metadata?.Precision);
        }
    }

    /** The number as the user edits it: no grouping or symbol, in their own decimal separator. */
    private editText(): string {
        if (this.currentValue === null) return "";
        if (!this.isNumeric()) return String(this.currentValue);
        const separator = this.context.userSettings.numberFormattingInfo.numberDecimalSeparator || ".";
        return String(this.currentValue).replace(".", separator);
    }

    /** Parses what the user typed. Returns an error message instead when it isn't a valid value. */
    private parseInput(text: string): { value: ScalarValue } | { error: string } {
        const trimmed = text.trim();
        if (!this.isNumeric()) return { value: trimmed === "" ? null : text };
        if (trimmed === "") return { value: null };

        const info = this.context.userSettings.numberFormattingInfo;
        const decimalSeparator = info.numberDecimalSeparator || ".";
        const groupSeparators = [info.numberGroupSeparator, info.currencyGroupSeparator].filter((s) => s);
        let normalized = trimmed.replace(info.currencySymbol || "\u0000", "").replace(/\s/g, "");
        for (const separator of groupSeparators) normalized = normalized.split(separator).join("");
        normalized = normalized.replace(decimalSeparator, ".");
        if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(normalized)) return { error: "Enter a valid number." };

        let value = Number(normalized);
        const type = this.context.parameters.value.type;
        if (type === "Whole.None" && !Number.isInteger(value)) return { error: "Enter a whole number." };
        const precision = this.metadata?.Precision;
        if (type !== "Whole.None" && precision !== undefined && precision >= 0) {
            value = Number(value.toFixed(precision));
        }
        const min = this.metadata?.MinValue;
        const max = this.metadata?.MaxValue;
        if (min !== undefined && value < min) return { error: `Enter a value of at least ${this.formatNumber(min)}.` };
        if (max !== undefined && value > max) return { error: `Enter a value of at most ${this.formatNumber(max)}.` };
        return { value };
    }

    private showValidation(message: string): void {
        if (!this.validationEl) return;
        this.validationEl.textContent = message;
        this.validationEl.style.display = "block";
    }

    private hideValidation(): void {
        if (this.validationEl) this.validationEl.style.display = "none";
    }

    private render(): void {
        if (!this.settings) return;
        const prop = this.context.parameters.value;
        const fieldLogicalName = prop.attributes?.LogicalName ?? "";
        const fieldDisplayName = prop.attributes?.DisplayName ?? fieldLogicalName;
        const layout = buildFieldLayout(this.container, this.settings, prop.attributes);

        const editor = document.createElement("div");
        editor.className = "ifr-editor";
        const input = document.createElement("input");
        input.type = "text";
        input.className = "ifr-input";
        input.setAttribute("aria-label", fieldDisplayName);
        input.inputMode = this.isNumeric() ? "decimal" : "text";
        if (!this.isNumeric() && this.metadata?.MaxLength) input.maxLength = this.metadata.MaxLength;
        input.readOnly = this.isReadOnly();
        input.value = this.displayText();
        editor.appendChild(input);

        const validation = document.createElement("div");
        validation.className = "ifr-field-error";
        validation.style.display = "none";
        editor.appendChild(validation);
        layout.valueHost.appendChild(editor);
        this.input = input;
        this.validationEl = validation;

        input.addEventListener("focus", () => {
            if (!input.readOnly) input.value = this.editText();
        });
        input.addEventListener("blur", () => {
            const parsed = this.parseInput(input.value);
            if ("error" in parsed) {
                // Keep what they typed so they can correct it; nothing is sent to the form.
                this.showValidation(parsed.error);
                return;
            }
            this.hideValidation();
            if (parsed.value !== this.currentValue) {
                this.currentValue = parsed.value;
                this.notifyOutputChanged();
            }
            input.value = this.displayText();
        });
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") input.blur();
        });

        this.fieldRow = attachFieldReview(layout.reviewHost, {
            context: this.context,
            settings: this.settings,
            fieldLogicalName,
            fieldDisplayName,
            getCurrentValueFormatted: () => this.displayText(),
        });
    }
}
