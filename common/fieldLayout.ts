import { ReviewSettings } from "./types";
import { parseSettings } from "./settings";
import { attachFieldReview } from "./fieldRow";

interface FieldLayout {
    /** Where the control renders its value editor. */
    valueHost: HTMLElement;
    /** Where the "+" button and comment badge go (see attachFieldReview). */
    reviewHost: HTMLElement;
}

export interface ReviewControlOptions {
    /** Extra checks on the parsed settings; throw to show the message instead of the control. */
    validate?: (settings: ReviewSettings) => void;
    /** Renders the value editor into `host`. */
    renderEditor: (host: HTMLElement, settings: ReviewSettings) => void;
    getCurrentValueFormatted: () => string;
}

export interface ReviewControl {
    /** Null when settingsJson was invalid; the error is shown and nothing else is rendered. */
    settings: ReviewSettings | null;
    showError: (message: string) => void;
    destroy: () => void;
}

/**
 * The setup every Field Review control shares: parses settingsJson (showing
 * its error in place of the control), lays out the label and value cells,
 * renders the control's editor and attaches the review "+" and badge.
 */
export function mountReviewControl(
    container: HTMLElement,
    context: ComponentFramework.Context<any>,
    options: ReviewControlOptions
): ReviewControl {
    container.classList.add("ifr-root");
    const errorEl = document.createElement("div");
    errorEl.className = "ifr-help";
    errorEl.style.display = "none";
    container.appendChild(errorEl);
    const showError = (message: string) => {
        errorEl.textContent = message;
        errorEl.style.display = "block";
    };

    let settings: ReviewSettings;
    try {
        settings = parseSettings(context.parameters.settingsJson.raw);
        options.validate?.(settings);
    } catch (e) {
        showError((e as Error).message);
        return { settings: null, showError, destroy: () => undefined };
    }

    const attributes = context.parameters.value.attributes;
    const fieldLogicalName = attributes?.LogicalName ?? "";
    const layout = buildFieldLayout(container, settings, attributes);
    const editorHost = document.createElement("div");
    editorHost.className = "ifr-editor";
    layout.valueHost.appendChild(editorHost);
    options.renderEditor(editorHost, settings);

    const destroy = attachFieldReview(layout.reviewHost, {
        context,
        settings,
        fieldLogicalName,
        fieldDisplayName: attributes?.DisplayName ?? fieldLogicalName,
        getCurrentValueFormatted: options.getCurrentValueFormatted,
    });
    return { settings, showError, destroy };
}

/**
 * Lays out the control's container. A PCF control can't draw into the form's
 * own label, so with settings.renderLabel the control draws the label itself
 * (hide the form label for this field) and puts the "+" next to it:
 *
 *   [Label *  (+) (2 comments)] [ value editor              ]
 *
 * Without renderLabel the "+" sits after the value, inside the value cell.
 */
function buildFieldLayout(
    container: HTMLElement,
    settings: ReviewSettings,
    metadata: ComponentFramework.PropertyHelper.FieldPropertyMetadata.Metadata | undefined
): FieldLayout {
    if (!settings.renderLabel) {
        return { valueHost: container, reviewHost: container };
    }

    container.classList.add("ifr-labelled");
    if (settings.labelWidth) {
        container.style.setProperty("--ifr-label-width", settings.labelWidth);
    }

    const labelCell = document.createElement("div");
    labelCell.className = "ifr-label-cell";
    const labelText = document.createElement("span");
    labelText.className = "ifr-label-text";
    labelText.textContent = metadata?.DisplayName ?? metadata?.LogicalName ?? "";
    labelText.title = labelText.textContent;
    labelCell.appendChild(labelText);
    // 1 = SystemRequired, 2 = ApplicationRequired (Business Required).
    if (metadata?.RequiredLevel === 1 || metadata?.RequiredLevel === 2) {
        const star = document.createElement("span");
        star.className = "ifr-required";
        star.textContent = "*";
        star.setAttribute("aria-hidden", "true");
        labelCell.appendChild(star);
    }
    container.appendChild(labelCell);

    const valueCell = document.createElement("div");
    valueCell.className = "ifr-value-cell";
    container.appendChild(valueCell);

    return { valueHost: valueCell, reviewHost: labelCell };
}
