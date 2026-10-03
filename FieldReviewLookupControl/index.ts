import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { attachLookupEditor, LookupEditor } from "../common/lookupPicker";
import { mountReviewControl, ReviewControl } from "../common/fieldLayout";

export class FieldReviewLookupControl implements ComponentFramework.StandardControl<IInputs, IOutputs> {
    private context: ComponentFramework.Context<IInputs>;
    private notifyOutputChanged: () => void;
    private control: ReviewControl;
    private lookupEditor: LookupEditor | null = null;
    private currentValue: ComponentFramework.LookupValue[] | null = null;

    public init(
        context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
        _state: ComponentFramework.Dictionary,
        container: HTMLDivElement
    ): void {
        this.context = context;
        this.notifyOutputChanged = notifyOutputChanged;
        const rawValue = (context.parameters.value as unknown as ComponentFramework.PropertyTypes.LookupProperty).raw;
        this.currentValue = rawValue && rawValue.length > 0 ? rawValue : null;

        this.control = mountReviewControl(container, context, {
            validate: (settings) => {
                if (!settings.lookupTargets || settings.lookupTargets.length === 0) {
                    throw new Error(
                        "Field Review (Lookup) control: settingsJson must include a non-empty lookupTargets array."
                    );
                }
            },
            renderEditor: (host, settings) => {
                this.lookupEditor = attachLookupEditor(host, {
                    context,
                    settings,
                    currentValue: this.currentValue,
                    disabled: context.mode.isControlDisabled,
                    onChange: (value) => {
                        this.currentValue = value;
                        this.notifyOutputChanged();
                    },
                });
            },
            getCurrentValueFormatted: () => this.currentValue?.[0]?.name ?? "(none)",
        });
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
        this.control.destroy();
        this.lookupEditor?.destroy();
    }
}
