import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { mountReviewControl, ReviewControl } from "../common/fieldLayout";
import { fromInputValue, fromWallClock, toInputValue, toWallClock } from "../common/dateValue";

type DateProperty = ComponentFramework.PropertyTypes.DateTimeProperty;

/**
 * The review thread on a Date Only or Date and Time column. Shows the date in the
 * user's own format, and switches to the browser's date (and time) picker while
 * editing, the way the number fields switch to their plain number.
 */
export class FieldReviewDateControl implements ComponentFramework.StandardControl<IInputs, IOutputs> {
    private context: ComponentFramework.Context<IInputs>;
    private notifyOutputChanged: () => void;
    private control: ReviewControl;
    private input: HTMLInputElement | null = null;
    private validationEl: HTMLDivElement | null = null;
    /** The value as the wall clock the user sees (see common/dateValue.ts); null when empty. */
    private wallClock: Date | null = null;
    // Last value the platform handed us (ms), so updateView only overwrites an
    // edit when the field genuinely changed elsewhere (script, business rule, etc.).
    private lastRawTime: number | null = null;
    /** True once the user changed the value, after which the platform's formatted text is stale. */
    private edited = false;

    public init(
        context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
        _state: ComponentFramework.Dictionary,
        container: HTMLDivElement
    ): void {
        this.context = context;
        this.notifyOutputChanged = notifyOutputChanged;
        this.syncFromPlatform();
        this.control = mountReviewControl(container, context, {
            renderEditor: (host) => this.renderEditor(host),
            getCurrentValueFormatted: () => this.displayText(),
        });
    }

    public updateView(context: ComponentFramework.Context<IInputs>): void {
        this.context = context;
        if (!this.input) return;
        this.input.readOnly = this.isReadOnly();
        const raw = this.property.raw;
        if ((raw?.getTime() ?? null) !== this.lastRawTime) {
            this.syncFromPlatform();
            this.hideValidation();
        }
        if (document.activeElement !== this.input) this.showDisplay();
    }

    public getOutputs(): IOutputs {
        return { value: this.wallClock ? fromWallClock(this.wallClock) : undefined } as IOutputs;
    }

    public destroy(): void {
        this.control.destroy();
    }

    private get property(): DateProperty {
        return this.context.parameters.value as unknown as DateProperty;
    }

    /** Date and Time columns formatted to show the time get a time part; Date Only and "date" format don't. */
    private get withTime(): boolean {
        return (this.property.attributes?.Format ?? "").toLowerCase() === "datetime";
    }

    private syncFromPlatform(): void {
        const raw = this.property.raw;
        this.lastRawTime = raw?.getTime() ?? null;
        this.wallClock = raw
            ? toWallClock(raw, this.property.attributes?.Behavior ?? 1, (d) =>
                  this.context.userSettings.getTimeZoneOffsetMinutes(d)
              )
            : null;
        this.edited = false;
    }

    private isReadOnly(): boolean {
        const security = this.property.security;
        return this.context.mode.isControlDisabled || (security !== undefined && !security.editable);
    }

    /** Text shown while not editing: the platform's formatting until the user changes the value, then our own. */
    private displayText(): string {
        if (!this.wallClock) return "";
        if (!this.edited && this.property.formatted) return this.property.formatted;
        return this.context.formatting.formatDateShort(this.wallClock, this.withTime);
    }

    private showDisplay(): void {
        if (!this.input) return;
        this.input.type = "text";
        this.input.value = this.displayText();
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
        input.className = "ifr-input";
        input.setAttribute("aria-label", this.property.attributes?.DisplayName ?? this.property.attributes?.LogicalName ?? "");
        input.readOnly = this.isReadOnly();
        editor.appendChild(input);

        const validation = document.createElement("div");
        validation.className = "ifr-field-error";
        validation.style.display = "none";
        editor.appendChild(validation);
        this.input = input;
        this.validationEl = validation;
        this.showDisplay();

        input.addEventListener("focus", () => {
            if (input.readOnly || input.type !== "text") return;
            input.type = this.withTime ? "datetime-local" : "date";
            input.value = this.wallClock ? toInputValue(this.wallClock, this.withTime) : "";
        });
        // Chromium browsers only focus the date segments on a click; open the calendar explicitly.
        input.addEventListener("click", () => {
            if (input.readOnly || input.type === "text") return;
            try {
                (input as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
            } catch {
                // showPicker throws when the browser won't open it here; typing still works.
            }
        });
        input.addEventListener("blur", () => {
            if (input.readOnly || input.type === "text") return;
            // A partly typed date reads as "" with badInput set: that's an invalid entry, not a clear.
            const parsed = input.validity.badInput ? undefined : fromInputValue(input.value, this.wallClock);
            if (parsed === undefined) {
                // Keep what they typed so they can correct it; nothing is sent to the form.
                this.showValidation(this.withTime ? "Enter a valid date and time." : "Enter a valid date.");
                return;
            }
            this.hideValidation();
            if ((parsed?.getTime() ?? null) !== (this.wallClock?.getTime() ?? null)) {
                this.wallClock = parsed;
                this.edited = true;
                this.notifyOutputChanged();
            }
            this.showDisplay();
        });
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") input.blur();
        });
    }
}
