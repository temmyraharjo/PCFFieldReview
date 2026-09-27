import { ReviewSettings } from "./types";

export interface FieldLayout {
    /** Where the control renders its value editor. */
    valueHost: HTMLElement;
    /** Where the "+" button and comment badge go (see attachFieldReview). */
    reviewHost: HTMLElement;
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
export function buildFieldLayout(
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
