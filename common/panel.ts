import { ReviewSettings, CommentRecord } from "./types";
import {
    fetchCommentHistory,
    createCommentWithAssignments,
    resolveComment,
    getCurrentUserId,
} from "./dataverseApi";

export interface PanelOptions {
    context: ComponentFramework.Context<any>;
    settings: ReviewSettings;
    fieldLogicalName: string;
    fieldDisplayName: string;
    currentValueFormatted: string;
    onChanged?: () => void; // called after a comment/assignment is created or completed, so the caller can refresh its badge
}

const ASSIGNEE_SEARCH_DEBOUNCE_MS = 250;

function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

export function icon(paths: string, size = 14, stroke = "currentColor", strokeWidth = 2): SVGSVGElement {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", stroke);
    svg.setAttribute("stroke-width", String(strokeWidth));
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.innerHTML = paths;
    return svg;
}

const ICON_CHECK = '<circle cx="12" cy="12" r="9"></circle><path d="M8.5 12.5l2.5 2.5 5-5"></path>';
const ICON_CLOCK = '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3.5 2"></path>';
const ICON_CLOSE = '<line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line>';

/**
 * Builds the comment-thread panel (history feed + compose box) as a detached
 * DOM node. The caller is responsible for positioning it (see fieldRow.ts,
 * which appends it to document.body as a fixed-position flyout so it is not
 * clipped by the model-driven form's field-cell container) and for removing
 * it from the DOM when the user closes it.
 */
export function buildReviewPanel(options: PanelOptions): HTMLElement {
    const { context, settings, fieldLogicalName, fieldDisplayName, currentValueFormatted } = options;
    const currentUserId = getCurrentUserId(context);

    const panel = el("div", "ifr-panel");
    const header = el("div", "ifr-panel-header");
    const headerText = el("div");
    headerText.appendChild(el("div", "ifr-panel-title", `${fieldDisplayName} — comment thread`));
    const subtitle = el("div", "ifr-panel-subtitle", "Loading…");
    headerText.appendChild(subtitle);
    header.appendChild(headerText);
    const closeBtn = el("button", "ifr-icon-btn");
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.appendChild(icon(ICON_CLOSE, 16));
    closeBtn.addEventListener("click", () => panel.dispatchEvent(new CustomEvent("ifr-close")));
    header.appendChild(closeBtn);
    panel.appendChild(header);

    const context_box = el("div", "ifr-context-box", `Current value: ${currentValueFormatted}`);
    panel.appendChild(context_box);

    const history = el("div", "ifr-history");
    panel.appendChild(history);

    const composeLabel = el("label", "ifr-label", "Add another comment");
    panel.appendChild(composeLabel);
    const textarea = el("textarea", "ifr-textarea");
    textarea.placeholder = "Write a comment…";
    panel.appendChild(textarea);

    const assignLabel = el("label", "ifr-label", "Assign to");
    panel.appendChild(assignLabel);
    const assignBox = el("div", "ifr-assign-box");
    const chipsHost = el("div", "ifr-chips");
    const assignInput = el("input", "ifr-assign-input");
    assignInput.type = "text";
    assignInput.placeholder = "Add reviewer…";
    assignBox.appendChild(chipsHost);
    assignBox.appendChild(assignInput);
    panel.appendChild(assignBox);
    const assignHelp = el("div", "ifr-help", "Any person you assign can resolve the comment for everyone.");
    panel.appendChild(assignHelp);

    const suggestList = el("div", "ifr-suggest-list");
    suggestList.style.display = "none";
    panel.appendChild(suggestList);

    const footer = el("div", "ifr-footer");
    const cancelBtn = el("button", "ifr-btn ifr-btn-secondary", "Cancel");
    cancelBtn.addEventListener("click", () => panel.dispatchEvent(new CustomEvent("ifr-close")));
    const submitBtn = el("button", "ifr-btn ifr-btn-primary", "Assign");
    footer.appendChild(cancelBtn);
    footer.appendChild(submitBtn);
    panel.appendChild(footer);

    // --- state ---
    const selectedAssignees: { id: string; name: string }[] = [];
    let searchTimer: number | undefined;

    function renderChips() {
        chipsHost.innerHTML = "";
        for (const a of selectedAssignees) {
            const chip = el("div", "ifr-chip");
            chip.appendChild(el("span", undefined, a.name));
            const remove = el("button", "ifr-chip-remove");
            remove.appendChild(icon(ICON_CLOSE, 10));
            remove.setAttribute("aria-label", `Remove ${a.name}`);
            remove.addEventListener("click", () => {
                const idx = selectedAssignees.findIndex((x) => x.id === a.id);
                if (idx >= 0) selectedAssignees.splice(idx, 1);
                renderChips();
            });
            chip.appendChild(remove);
            chipsHost.appendChild(chip);
        }
    }

    assignInput.addEventListener("input", () => {
        window.clearTimeout(searchTimer);
        const term = assignInput.value.trim();
        if (term.length < 2) {
            suggestList.style.display = "none";
            return;
        }
        searchTimer = window.setTimeout(async () => {
            const filter = `contains(fullname,'${term.replace(/'/g, "''")}')`;
            const result = await context.webAPI.retrieveMultipleRecords(
                "systemuser",
                `?$select=fullname&$filter=${encodeURIComponent(filter)}&$top=8`
            );
            suggestList.innerHTML = "";
            const candidates = result.entities.filter(
                (u) => !selectedAssignees.some((s) => s.id === u["systemuserid"])
            );
            if (candidates.length === 0) {
                suggestList.style.display = "none";
                return;
            }
            for (const u of candidates) {
                const row = el("div", "ifr-suggest-row", u["fullname"] as string);
                row.addEventListener("click", () => {
                    // "lookup" mode stores one assignee, so a new pick replaces the current one.
                    if (settings.assignmentMode === "lookup") selectedAssignees.length = 0;
                    selectedAssignees.push({ id: u["systemuserid"] as string, name: u["fullname"] as string });
                    renderChips();
                    assignInput.value = "";
                    suggestList.style.display = "none";
                });
                suggestList.appendChild(row);
            }
            suggestList.style.display = "block";
        }, ASSIGNEE_SEARCH_DEBOUNCE_MS);
    });

    function renderEntry(comment: CommentRecord): HTMLElement {
        const entry = el("div", `ifr-entry ${comment.isResolved ? "ifr-entry-resolved" : "ifr-entry-open"}`);
        const row1 = el("div", "ifr-entry-row");
        const who = el("div", "ifr-entry-who");
        who.appendChild(el("div", "ifr-avatar", initials(comment.authorName)));
        who.appendChild(el("div", "ifr-entry-name", comment.authorName || "(unknown)"));
        row1.appendChild(who);
        row1.appendChild(el("div", "ifr-entry-time", formatWhen(comment.createdOn)));
        entry.appendChild(row1);
        entry.appendChild(el("div", "ifr-entry-text", comment.text));

        const statusRow = el("div", "ifr-status-row");
        const status = el("div", `ifr-status-chip ${comment.isResolved ? "" : "ifr-status-pending"}`);
        status.appendChild(
            icon(comment.isResolved ? ICON_CHECK : ICON_CLOCK, 14, comment.isResolved ? "#107C10" : "#C19C00")
        );
        let statusText = comment.isResolved ? "Resolved" : "Open";
        if (comment.isResolved && comment.resolvedByName) statusText += ` by ${comment.resolvedByName}`;
        if (comment.isResolved && comment.resolvedOn) statusText += ` · ${formatWhen(comment.resolvedOn)}`;
        status.appendChild(el("span", undefined, statusText));
        statusRow.appendChild(status);

        const isAssignee = comment.assignments.some((a) => a.assigneeId.toLowerCase() === currentUserId);
        if (!comment.isResolved && isAssignee) {
            const resolveBtn = el("button", "ifr-btn ifr-btn-primary ifr-btn-small", "Mark resolved");
            resolveBtn.addEventListener("click", async () => {
                resolveBtn.disabled = true;
                try {
                    await resolveComment(context, settings, comment.id);
                    options.onChanged?.();
                    await refreshHistory();
                } catch (e) {
                    resolveBtn.disabled = false;
                    throw e;
                }
            });
            statusRow.appendChild(resolveBtn);
        }
        entry.appendChild(statusRow);

        if (comment.assignments.length > 0) {
            const assignees = comment.assignments
                .map((a) => `${a.assigneeName}${a.assigneeId.toLowerCase() === currentUserId ? " (you)" : ""}`)
                .join(", ");
            entry.appendChild(el("div", "ifr-entry-assignees", `Assigned to ${assignees}`));
        }
        return entry;
    }

    async function refreshHistory() {
        history.innerHTML = "";
        const comments = await fetchCommentHistory(context, settings, fieldLogicalName);
        const openCount = comments.filter((c) => !c.isResolved).length;
        subtitle.textContent = `${openCount} open · ${comments.length - openCount} resolved`;
        if (comments.length === 0) {
            history.appendChild(el("div", "ifr-help", "No comments yet on this field."));
        } else {
            for (const c of comments) history.appendChild(renderEntry(c));
        }
    }

    submitBtn.addEventListener("click", async () => {
        const text = textarea.value.trim();
        if (!text || selectedAssignees.length === 0) {
            submitBtn.classList.add("ifr-shake");
            window.setTimeout(() => submitBtn.classList.remove("ifr-shake"), 300);
            return;
        }
        submitBtn.disabled = true;
        try {
            await createCommentWithAssignments(
                context,
                settings,
                fieldLogicalName,
                text,
                selectedAssignees.map((a) => a.id)
            );
            textarea.value = "";
            selectedAssignees.length = 0;
            renderChips();
            options.onChanged?.();
            await refreshHistory();
        } finally {
            submitBtn.disabled = false;
        }
    });

    refreshHistory();

    return panel;
}

function initials(name: string): string {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/);
    return parts
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase() ?? "")
        .join("");
}

function formatWhen(isoDate: string): string {
    if (!isoDate) return "";
    const date = new Date(isoDate);
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    return sameDay ? `Today, ${time}` : date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + `, ${time}`;
}
