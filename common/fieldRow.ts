import { ReviewSettings } from "./types";
import { fetchCommentHistory } from "./dataverseApi";
import { buildReviewPanel, icon } from "./panel";
import { makeFloating, placeFixed } from "./floating";

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

/**
 * Renders the "+" affordance (and open-thread badge) that decorates a field's
 * value box, and wires it up to open the shared comment-thread panel as a
 * document.body-level flyout -- appending to body (rather than nesting it
 * inside the control's own container) is what keeps the panel from being
 * clipped by the model-driven form's fixed-size field cell.
 */
/** Returns a function that tears it down. */
export function attachFieldReview(host: HTMLElement, options: FieldRowOptions): () => void {
    host.classList.add("ifr-field-row");

    const badge = document.createElement("div");
    badge.className = "ifr-badge";
    badge.style.display = "none";
    badge.appendChild(icon(ICON_CHAT, 12, "currentColor", 2.5));
    const badgeText = document.createElement("span");
    badge.appendChild(badgeText);
    host.appendChild(badge);

    const plusBtn = document.createElement("button");
    plusBtn.type = "button";
    plusBtn.className = "ifr-plus-btn";
    plusBtn.setAttribute("aria-label", `Add review comment on ${options.fieldDisplayName}`);
    plusBtn.appendChild(icon(ICON_PLUS, 14, "currentColor", 2.5));
    host.appendChild(plusBtn);

    let openPanel: HTMLElement | null = null;
    let outsideClickHandler: ((e: MouseEvent) => void) | null = null;
    let repositionHandler: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;

    function closePanel() {
        if (openPanel) {
            openPanel.remove();
            openPanel = null;
        }
        if (repositionHandler) {
            window.removeEventListener("scroll", repositionHandler, true);
            window.removeEventListener("resize", repositionHandler);
            repositionHandler = null;
        }
        resizeObserver?.disconnect();
        resizeObserver = null;
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

        makeFloating(panel);
        openPanel = panel;
        positionPanel(panel, anchor);

        // Form content scrolls inside nested containers, so listen in the capture phase.
        repositionHandler = () => {
            if (openPanel) positionPanel(openPanel, anchor);
        };
        window.addEventListener("scroll", repositionHandler, true);
        window.addEventListener("resize", repositionHandler);
        // History loads asynchronously, so re-place once its content changes the panel size.
        resizeObserver = new ResizeObserver(() => repositionHandler?.());
        Array.from(panel.children).forEach((c) => resizeObserver!.observe(c));

        // Defer wiring the outside-click listener so the click that opened
        // the panel doesn't immediately close it.
        window.setTimeout(() => {
            outsideClickHandler = (e: MouseEvent) => {
                const target = e.target as HTMLElement;
                // Grabbing a scrollbar fires mousedown on the scrolling element; that's scrolling, not an outside click.
                const onScrollbar = e.offsetX >= target.clientWidth || e.offsetY >= target.clientHeight;
                if (openPanel && !openPanel.contains(target) && target !== anchor && !onScrollbar) {
                    closePanel();
                }
            };
            document.addEventListener("mousedown", outsideClickHandler);
        }, 0);
    }

    function positionPanel(panel: HTMLElement, anchor: HTMLElement) {
        const margin = 8;
        const gap = 6;
        const cssMax = 560;
        const rect = anchor.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        const history = panel.querySelector<HTMLElement>(".ifr-history");
        // Re-measuring resets scroll offsets, so put them back afterwards.
        const panelScroll = panel.scrollTop;
        const historyScroll = history?.scrollTop ?? 0;

        panel.style.maxHeight = "";
        // The smallest height that still shows everything but the history in full: history at its CSS min-height.
        if (history) history.style.maxHeight = "0";
        const minHeight = panel.scrollHeight;
        if (history) history.style.maxHeight = "";
        const cap = Math.max(cssMax, minHeight);
        const naturalHeight = Math.min(panel.scrollHeight, cap);
        const panelWidth = panel.offsetWidth || 380;

        let left: number;
        let top: number;
        let height: number;
        if (options.settings.panelPlacement === "center") {
            const available = Math.max(200, Math.min(cap, vh - 2 * margin));
            height = Math.min(naturalHeight, available);
            panel.style.maxHeight = `${available}px`;
            left = (vw - panelWidth) / 2;
            top = (vh - height) / 2;
        } else {
            left = Math.min(rect.left, vw - panelWidth - margin);

            const spaceBelow = vh - rect.bottom - gap - margin;
            const spaceAbove = rect.top - gap - margin;
            // Prefer below at full height, then above; then whichever side fits with the history shrunk;
            // otherwise the larger side, where the whole panel scrolls.
            const placeBelow =
                naturalHeight <= spaceBelow ||
                (naturalHeight > spaceAbove &&
                    (minHeight <= spaceBelow || (minHeight > spaceAbove && spaceBelow >= spaceAbove)));
            const available = Math.max(200, Math.min(cap, placeBelow ? spaceBelow : spaceAbove));
            height = Math.min(naturalHeight, available);
            panel.style.maxHeight = `${available}px`;

            top = Math.min(placeBelow ? rect.bottom + gap : rect.top - gap - height, vh - height - margin);
        }
        placeFixed(panel, Math.max(margin, left), Math.max(margin, top));
        panel.scrollTop = panelScroll;
        if (history) history.scrollTop = historyScroll;
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

    return closePanel;
}
