import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { mountReviewControl, ReviewControl } from "../common/fieldLayout";
import { getCurrentTableName } from "../common/dataverseApi";

type ScalarValue = string | number | null;
type Metadata = ComponentFramework.PropertyHelper.FieldPropertyMetadata.Metadata & {
    MaxLength?: number;
    MinValue?: number;
    MaxValue?: number;
    Precision?: number;
};

// AttributeTypeCode values: Decimal 3, Double 4, Integer 5, Money 8 / Memo 7, String 14.
const NUMBER_TYPE_CODES = [3, 4, 5, 8];
const TEXT_TYPE_CODES = [7, 14];

/** Maps an attribute definition to "text" or "number"; null if its type can't be read. */
function columnKind(
    attr: { AttributeType?: number | string; AttributeTypeName?: string | { value?: string } } | undefined
): "text" | "number" | null {
    if (!attr) return null;
    const code = attr.AttributeType;
    if (typeof code === "number") {
        if (NUMBER_TYPE_CODES.includes(code)) return "number";
        if (TEXT_TYPE_CODES.includes(code)) return "text";
    }
    const typeName = attr.AttributeTypeName;
    const name = `${typeof code === "string" ? code : ""} ${typeof typeName === "string" ? typeName : typeName?.value ?? ""}`;
    if (/String|Memo/i.test(name)) return "text";
    if (/Integer|Decimal|Double|Money/i.test(name)) return "number";
    return null;
}

export class FieldReviewControl implements ComponentFramework.StandardControl<IInputs, IOutputs> {
    private context: ComponentFramework.Context<IInputs>;
    private notifyOutputChanged: () => void;
    private control: ReviewControl;
    private input: HTMLInputElement | null = null;
    private validationEl: HTMLDivElement | null = null;
    private currentValue: ScalarValue = null;
    // Last value the platform handed us, so updateView only overwrites what the
    // user typed when the field genuinely changed elsewhere (script, rollup, etc.).
    private lastRawValue: ScalarValue = null;
    /** The column's real type, once resolveColumnKind has read it; null until then. */
    private columnIsNumeric: boolean | null = null;

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
            renderEditor: (host) => this.renderEditor(host),
            getCurrentValueFormatted: () => this.displayText(),
        });
        if (this.control.settings) void this.resolveColumnKind();
    }

    public updateView(context: ComponentFramework.Context<IInputs>): void {
        this.context = context;
        if (!this.input) return;
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
        this.control.destroy();
    }

    private get metadata(): Metadata | undefined {
        return this.context.parameters.value.attributes as Metadata | undefined;
    }

    /**
     * Whether the bound column is a number. With a type-group binding, what the property reports
     * isn't reliable: `type` can be numeric on an empty text column, and text columns can carry
     * MinValue/MaxValue. So the column's real type is looked up from the table definition
     * (resolveColumnKind). Until that answers, go by the value itself, else assume text: a
     * wrongly-assumed text box just accepts input, while a wrongly-assumed number box blocks it.
     */
    private isNumeric(): boolean {
        if (this.columnIsNumeric !== null) return this.columnIsNumeric;
        const raw = this.context.parameters.value.raw;
        if (typeof raw === "number") return true;
        if (typeof raw === "string") return false;
        const type = this.context.parameters.value.type ?? "";
        return type === "Whole.None" || type === "Currency" || type === "Decimal" || type === "FP";
    }

    /** Reads the column's attribute type from the table definition, then re-renders the input to match. */
    private async resolveColumnKind(): Promise<void> {
        const logicalName = this.context.parameters.value.attributes?.LogicalName;
        if (!logicalName) return;
        try {
            const table = getCurrentTableName(this.context);
            const metadata = (await this.context.utils.getEntityMetadata(table, [logicalName])) as {
                Attributes?: { get?: (name: string) => unknown } & Record<string, unknown>;
            };
            const attrs = metadata.Attributes;
            const attr = (attrs?.get?.(logicalName) ?? attrs?.[logicalName]) as
                | { AttributeType?: number | string; AttributeTypeName?: string | { value?: string } }
                | undefined;
            const kind = columnKind(attr);
            if (kind === null) return;
            this.columnIsNumeric = kind === "number";
        } catch (e) {
            // eslint-disable-next-line no-console
            console.warn(`Field Review: couldn't read the type of column "${logicalName}"; guessing from its value.`, e);
            return;
        }
        if (!this.input) return;
        this.applyKind(this.input);
        this.hideValidation();
        if (document.activeElement !== this.input) this.input.value = this.displayText();
    }

    /** Sets the input's keyboard and length limit for the column's kind. */
    private applyKind(input: HTMLInputElement): void {
        input.inputMode = this.isNumeric() ? "decimal" : "text";
        if (!this.isNumeric() && this.metadata?.MaxLength) input.maxLength = this.metadata.MaxLength;
        else input.removeAttribute("maxlength");
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

    private renderEditor(editor: HTMLElement): void {
        const input = document.createElement("input");
        input.type = "text";
        input.className = "ifr-input";
        input.setAttribute("aria-label", this.metadata?.DisplayName ?? this.metadata?.LogicalName ?? "");
        this.applyKind(input);
        input.readOnly = this.isReadOnly();
        input.value = this.displayText();
        editor.appendChild(input);

        const validation = document.createElement("div");
        validation.className = "ifr-field-error";
        validation.style.display = "none";
        editor.appendChild(validation);
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
    }
}
