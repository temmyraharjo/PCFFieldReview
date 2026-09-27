import { ReviewSettings } from "./types";
import { fetchCommentHistory } from "./dataverseApi";
import { buildReviewPanel } from "./panel";

export interface FieldRowOptions {
    context: ComponentFramework.Context<any>;
    settings: ReviewSettings;
    fieldLogicalName: string;
    fieldDisplayName: string;
    getCurrentValueFormatted: () => string;
}

const ICON_PLUS = '<line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>';
const ICON_CHAT =
    '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>';

function svg(paths: string, size: number): SVGSVGElement {
    const ns = "http://www.w3.org/2000/svg";
    const node = document.createElementNS(ns, "svg");
    node.setAttribute("width", String(size));
    node.setAttribute("height", String(size));
    node.setAttribute("viewBox", "0 0 24 24");
    node.setAttribute("fill", "none");
    node.setAttribute("stroke", "currentColor");
    node.setAttribute("stroke-width", "2.5");
    node.setAttribute("stroke-linecap", "round");
    node.innerHTML = paths;
    return node;
}

/**
 * Renders the "+" affordance (and open-thread badge) that decorates a field's
 * value box, and wires it up to open the shared comment-thread panel as a
 * document.body-level flyout -- appending to body (rather than nesting it
 * inside the control's own container) is what keeps the panel from being
 * clipped by the model-driven form's fixed-size field cell.
 */
export function attachFieldReview(host: HTMLElement, options: FieldRowOptions): { refreshBadge: () => void; destroy: () => void } {
    host.classList.add("ifr-field-row");

    const badge = document.createElement("div");
    badge.className = "ifr-badge";
    badge.style.display = "none";
    badge.appendChild(svg(ICON_CHAT, 12));
    const badgeText = document.createElement("span");
    badge.appendChild(badgeText);
    host.appendChild(badge);

    const plusBtn = document.createElement("button");
    plusBtn.type = "button";
    plusBtn.className = "ifr-plus-btn";
    plusBtn.setAttribute("aria-label", `Add review comment on ${options.fieldDisplayName}`);
    plusBtn.appendChild(svg(ICON_PLUS, 14));
    host.appendChild(plusBtn);

    let openPanel: HTMLElement | null = null;
    let outsideClickHandler: ((e: MouseEvent) => void) | null = null;

    function closePanel() {
        if (openPanel) {
            openPanel.remove();
            openPanel = null;
        }
        if (outsideClickHandler) {
            document.removeEventListener("mousedown", outsideClickHandler);
            outsideClickHandler = null;
        }
    }

    function openPanelNear(anchor: HTMLElement) {
        closePanel();
        const panel = buildReviewPanel({
            context: options.context,
            settings: options.settings,
            fieldLogicalName: options.fieldLogicalName,
            fieldDisplayName: options.fieldDisplayName,
            currentValueFormatted: options.getCurrentValueFormatted(),
            onChanged: refreshBadge,
        });
        panel.classList.add("ifr-panel-floating");
        panel.addEventListener("ifr-close", closePanel);
        document.body.appendChild(panel);

        const rect = anchor.getBoundingClientRect();
        const panelWidth = 380;
        let left = rect.left + window.scrollX;
        if (left + panelWidth > window.innerWidth - 16) {
            left = window.innerWidth - panelWidth - 16;
        }
        panel.style.position = "absolute";
        panel.style.top = `${rect.bottom + window.scrollY + 6}px`;
        panel.style.left = `${Math.max(8, left)}px`;
        openPanel = panel;

        // Defer wiring the outside-click listener so the click that opened
        // the panel doesn't immediately close it.
        window.setTimeout(() => {
            outsideClickHandler = (e: MouseEvent) => {
                if (openPanel && !openPanel.contains(e.target as Node) && e.target !== anchor) {
                    closePanel();
                }
            };
            document.addEventListener("mousedown", outsideClickHandler);
        }, 0);
    }

    plusBtn.addEventListener("click", () => openPanelNear(plusBtn));
    badge.addEventListener("click", () => openPanelNear(badge));

    async function refreshBadge() {
        try {
            const comments = await fetchCommentHistory(options.context, options.settings, options.fieldLogicalName);
            if (comments.length === 0) {
                badge.style.display = "none";
                return;
            }
            const openCount = comments.filter((c) => !c.isResolved).length;
            badgeText.textContent =
                comments.length === 1 ? "1 comment" : `${comments.length} comments`;
            if (openCount > 0) {
                badgeText.textContent += ` · ${openCount} open`;
                badge.classList.add("ifr-badge-open");
            } else {
                badge.classList.remove("ifr-badge-open");
            }
            badge.style.display = "inline-flex";
        } catch (e) {
            // Swallow badge-refresh errors so a transient network issue doesn't
            // block the rest of the field from rendering; the panel itself
            // will surface the same error if the user opens it.
            // eslint-disable-next-line no-console
            console.error("Field Review: failed to refresh badge", e);
        }
    }

    refreshBadge();

    return {
        refreshBadge,
        destroy: () => {
            closePanel();
        },
    };
}
