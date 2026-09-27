import { RegardingMode, ReviewSettings } from "./types";

const REQUIRED_KEYS: (keyof ReviewSettings)[] = [
    "commentTable",
    "commentTextAttribute",
    "commentStatusAttribute",
    "commentStatusOpenValue",
    "commentStatusResolvedValue",
    "assignmentTable",
    "assignmentCommentLookupAttribute",
    "assignmentUserLookupAttribute",
];

// Settings from the old per-assignee status design. Rejected so an outdated
// settings JSON fails loudly instead of silently ignoring those columns.
const REMOVED_KEYS = [
    "assignmentStatusAttribute",
    "assignmentStatusPendingValue",
    "assignmentStatusCompletedValue",
    "assignmentCompletedOnAttribute",
];

const REQUIRED_KEYS_BY_REGARDING_MODE: Record<RegardingMode, (keyof ReviewSettings)[]> = {
    text: ["regardingTableAttribute", "regardingIdAttribute"],
    lookup: ["regardingLookupAttribute"],
};

/**
 * Parses and validates the settingsJson input property.
 * Throws a descriptive Error if the JSON is malformed or missing a
 * required key, so misconfiguration fails loudly at load time instead of
 * silently breaking a Web API call later.
 */
export function parseSettings(raw: string | null): ReviewSettings {
    if (!raw || raw.trim().length === 0) {
        throw new Error(
            "Field Review control: the settingsJson property is empty. " +
                "Configure it on the field in the form designer with the comment/assignment schema JSON."
        );
    }

    let parsed: Partial<ReviewSettings>;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        throw new Error(
            `Field Review control: settingsJson is not valid JSON (${(e as Error).message}).`
        );
    }

    const removed = REMOVED_KEYS.filter((key) => key in parsed);
    if (removed.length > 0) {
        throw new Error(
            `Field Review control: settingsJson uses removed key(s): ${removed.join(", ")}. ` +
                "Status now lives on the comment: use commentStatusAttribute, commentStatusOpenValue, " +
                "commentStatusResolvedValue and commentResolvedOnAttribute instead (see the README)."
        );
    }

    const regardingMode = parsed.regardingMode ?? "text";
    if (!(regardingMode in REQUIRED_KEYS_BY_REGARDING_MODE)) {
        throw new Error(
            `Field Review control: settingsJson regardingMode must be "text" or "lookup" (got "${regardingMode}").`
        );
    }

    const missing = [...REQUIRED_KEYS, ...REQUIRED_KEYS_BY_REGARDING_MODE[regardingMode]].filter((key) => {
        const value = parsed[key];
        return value === undefined || value === null || value === "";
    });
    if (missing.length > 0) {
        throw new Error(
            `Field Review control: settingsJson is missing required key(s): ${missing.join(", ")}.`
        );
    }

    return {
        ...parsed,
        regardingMode,
        lookupMode: parsed.lookupMode ?? "simple",
        lookupAutoThreshold: parsed.lookupAutoThreshold ?? 25,
        lookupAllowCreate: parsed.lookupAllowCreate ?? false,
    } as ReviewSettings;
}
