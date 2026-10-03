/**
 * Shared type definitions for the Insurgo Field Review controls.
 * Imported by every control in this project via ../common.
 */

/** One person assigned to a comment. Assignments carry no status: the comment does. */
export interface AssignmentRecord {
    id: string;
    assigneeId: string;
    assigneeName: string;
}

export interface CommentRecord {
    id: string;
    text: string;
    authorName: string;
    createdOn: string;
    /** Resolved for everyone as soon as any one assignee resolves it. */
    isResolved: boolean;
    resolvedOn?: string;
    resolvedByName?: string;
    assignments: AssignmentRecord[];
}

/** A value written to / compared against a status column: a Choice option value, a Yes/No boolean, or text. */
export type StatusValue = string | number | boolean;

export type LookupMode = "auto" | "simple" | "search";

export type RegardingMode = "text" | "lookup";

/**
 * Everything the control needs to know about the reviewer's Dataverse schema.
 * All logical names are supplied by the maker when configuring the field
 * (via the settingsJson input property) so the same compiled control can be
 * reused across environments and clients with different publisher prefixes.
 */
export interface ReviewSettings {
    // --- Layout (all controls) ---
    /**
     * Draw the field label inside the control, with the "+" next to it. Hide the form's own
     * label for this field when you turn this on. Default false: "+" sits after the value.
     */
    renderLabel?: boolean;
    /** Width of the label drawn by renderLabel, as a CSS length. Default "160px". */
    labelWidth?: string;
    /** Where the comment panel opens: "center" (default) of the screen, or "field" next to the "+" / badge clicked. */
    panelPlacement?: "center" | "field";

    // --- Comment table ---
    /** Logical name of the table that stores one row per review comment. */
    commentTable: string;
    /** Column on the comment table that holds the comment text. */
    commentTextAttribute: string;
    /**
     * How a comment row points at its parent record.
     * "text" (default): regardingTableAttribute + regardingIdAttribute, so one comment table serves any parent table.
     * "lookup": a real Lookup column (regardingLookupAttribute) to the table this form is on.
     */
    regardingMode?: RegardingMode;
    /** Column on the comment table storing the parent record's table logical name (e.g. "opportunity"). Required in "text" mode; optional extra in "lookup" mode. */
    regardingTableAttribute?: string;
    /** Column on the comment table storing the parent record's GUID as text. Required in "text" mode; optional extra in "lookup" mode. */
    regardingIdAttribute?: string;
    /** "lookup" mode: logical name of the Lookup column on the comment table pointing at the current form's table. */
    regardingLookupAttribute?: string;
    /**
     * "lookup" mode: override for the lookup's navigation property name (used for @odata.bind).
     * Normally resolved automatically from relationship metadata; set it only if that fails.
     */
    regardingLookupNavigationProperty?: string;
    /** Optional column storing a human-readable snapshot of the parent record's name. */
    regardingNameAttribute?: string;
    /**
     * Text column on the comment table where the control stores the logical name of the field
     * the comment is about (e.g. "title"), so each field keeps its own thread.
     * Optional: defaults to the comment table's primary name column (e.g. "subject" on task).
     */
    fieldReferenceAttribute?: string;
    /** Column on the comment table storing whether the comment is open or resolved. */
    commentStatusAttribute: string;
    /** Value written to commentStatusAttribute when a comment is created. */
    commentStatusOpenValue: StatusValue;
    /** Value written to commentStatusAttribute when an assignee resolves the comment. Anything else counts as open. */
    commentStatusResolvedValue: StatusValue;
    /** Optional datetime column on the comment table stamped when the comment is resolved. */
    commentResolvedOnAttribute?: string;
    /** Optional Lookup-to-systemuser column on the comment table set to whoever resolved it. */
    commentResolvedByAttribute?: string;
    /** Override for commentResolvedByAttribute's navigation property. Normally resolved automatically. */
    commentResolvedByNavigationProperty?: string;

    // --- Assignment (child) table ---
    /** Logical name of the table that stores one row per person assigned to a comment. */
    assignmentTable: string;
    /** Column on the assignment table that is the lookup back to the parent comment row. */
    assignmentCommentLookupAttribute: string;
    /** Column on the assignment table that is the lookup to systemuser (the assignee). */
    assignmentUserLookupAttribute: string;
    /** Override for assignmentCommentLookupAttribute's navigation property. Normally resolved automatically. */
    assignmentCommentNavigationProperty?: string;
    /** Override for assignmentUserLookupAttribute's navigation property. Normally resolved automatically. */
    assignmentUserNavigationProperty?: string;
    /** Optional denormalized copy of regardingTableAttribute on the assignment table (for cross-entity "assigned to me" views). */
    assignmentRegardingTableAttribute?: string;
    /** Optional denormalized copy of regardingIdAttribute on the assignment table. */
    assignmentRegardingIdAttribute?: string;

    // --- Lookup-field-only settings (ignored by the scalar and Choice controls; the PolyLookup control also reads lookupCandidateFilter and lookupAllowCreate) ---
    /** Table(s) the bound Lookup field can point to. Required for the Lookup control; not derivable from PCF metadata. */
    lookupTargets?: string[];
    /** "simple" (default): plain dropdown of existing records. "search": native lookup dialog. "auto": pick by candidate count. */
    lookupMode?: LookupMode;
    /** Candidate-count threshold used by "auto" mode. Default 25. */
    lookupAutoThreshold?: number;
    /** Optional OData $filter fragment scoping which records are offered (also used for the auto-mode count check). */
    lookupCandidateFilter?: string;
    /** Optional saved view id passed as defaultViewId to the native search dialog. */
    lookupSearchDefaultViewId?: string;
    /** Adds a "+ New record" entry (quick create) to the simple dropdown. Default false. Has no effect on the native dialog, which always shows its own "+ New". */
    lookupAllowCreate?: boolean;

    // --- PolyLookup-only settings (ignored by the other controls) ---
    /** How the current table relates to the selectable table. Default "manyToMany". */
    polyLookupRelationshipType?: PolyLookupRelationshipType;
    /**
     * Schema name of the relationship. "manyToMany": the N:N relationship. "custom": the 1:N from the
     * current table to the intersect table. "connection": the "connected from" relationship (e.g. account_connections1).
     */
    polyLookupRelationshipName?: string;
    /**
     * "custom" and "connection" only: schema name of the relationship between the intersect table and the
     * selectable table. "custom": the N:1 from the intersect table. "connection": the "connected to" relationship.
     */
    polyLookupRelationship2Name?: string;
    /** Maximum number of selected records. Default: no limit. */
    polyLookupItemLimit?: number;
    /** What the control writes to the bound text column when the selection changes. Default "none". */
    polyLookupOutput?: PolyLookupOutput;
}

export type PolyLookupRelationshipType = "manyToMany" | "custom" | "connection";

/**
 * "none": the bound column only hosts the control. "text": comma-separated names.
 * "json": [{ id, name, etn }], which also enables picking on a create form (a post-create plugin associates them).
 */
export type PolyLookupOutput = "none" | "text" | "json";

export interface CurrentRecordRef {
    entityTypeName: string;
    entityId: string;
    entityName: string;
}
