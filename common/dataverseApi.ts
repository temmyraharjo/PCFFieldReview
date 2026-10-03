import { AssignmentRecord, CommentRecord, CurrentRecordRef, ReviewSettings } from "./types";

/**
 * Thin Web API helper layer shared by all the controls.
 *
 * A couple of things worth knowing if you're reading this code:
 *
 * 1. @odata.bind paths need the entity SET name (plural/collection), not the
 *    logical name (e.g. "/accounts(guid)", not "/account(guid)"). We read it
 *    from context.utils.getEntityMetadata(). That object is untyped in the PCF
 *    typings, so readMetadata() accepts both the Xrm-style PascalCase keys
 *    (EntitySetName, PrimaryIdAttribute, ...) and camelCase variants, and
 *    falls back to the plural name only if no EntitySetName is present.
 *
 * 2. The `<name>@odata.bind` key must be the lookup's single-valued
 *    NAVIGATION PROPERTY name, which is case-sensitive and often differs from
 *    the column's logical name: custom lookups use the schema name
 *    ("tmy_FeedbackId"), multi-table lookups add the target
 *    ("regardingobjectid_account_task"). Sending the logical name fails with
 *    "An undeclared property ... which only has property annotations".
 *    resolveNavigationProperty() reads the real name from the relationship
 *    metadata; the *NavigationProperty settings override it.
 */

const SYSTEMUSER_COLLECTION = "systemusers";
const entitySetNameCache = new Map<string, string>();
const primaryNameAttributeCache = new Map<string, string>();
const primaryIdAttributeCache = new Map<string, string>();
const navigationPropertyCache = new Map<string, Promise<string>>();

function getClientUrl(context: ComponentFramework.Context<any>): string {
    const page = (context as unknown as { page?: { getClientUrl?: () => string } }).page;
    return (page?.getClientUrl?.() ?? window.location.origin).replace(/\/$/, "");
}

/**
 * Resolves the navigation property to use in `<property>@odata.bind` for the
 * lookup column `attribute` on table `entity`, pointing at table `target`.
 * PCF's webAPI can't query metadata, so this calls the Web API directly
 * (same origin as the form). Falls back to the logical name if that fails.
 */
async function resolveNavigationProperty(
    context: ComponentFramework.Context<any>,
    entity: string,
    attribute: string,
    target: string,
    override?: string
): Promise<string> {
    if (override) return override;
    const key = `${entity}.${attribute}.${target}`;
    const cached = navigationPropertyCache.get(key);
    if (cached) return cached;

    const lookup = (async () => {
        try {
            const body = (await webApiFetch(
                context,
                "GET",
                `EntityDefinitions(LogicalName='${entity}')/ManyToOneRelationships` +
                    `?$select=ReferencingEntityNavigationPropertyName,ReferencedEntity` +
                    `&$filter=${encodeURIComponent(`ReferencingAttribute eq '${attribute}'`)}`
            )) as {
                value: { ReferencingEntityNavigationPropertyName: string; ReferencedEntity: string }[];
            };
            // A multi-table lookup has one relationship per target table.
            const match = body.value.find((r) => r.ReferencedEntity === target) ?? body.value[0];
            if (match?.ReferencingEntityNavigationPropertyName) return match.ReferencingEntityNavigationPropertyName;
            throw new Error("no matching relationship");
        } catch (e) {
            // eslint-disable-next-line no-console
            console.warn(
                `Field Review: could not resolve the navigation property for ${entity}.${attribute} -> ${target} ` +
                    `(${(e as Error).message}); using the logical name. Set the matching *NavigationProperty setting if saving fails.`
            );
            navigationPropertyCache.delete(key);
            return attribute;
        }
    })();
    navigationPropertyCache.set(key, lookup);
    return lookup;
}

/** Returns the first non-empty string among the given metadata keys. */
function readMetadata(metadata: ComponentFramework.PropertyHelper.EntityMetadata, keys: string[]): string | undefined {
    for (const key of keys) {
        const value = metadata[key];
        if (typeof value === "string" && value.length > 0) return value;
    }
    return undefined;
}

async function resolveMetadataValue(
    context: ComponentFramework.Context<any>,
    cache: Map<string, string>,
    logicalName: string,
    keys: string[],
    fallback: () => string
): Promise<string> {
    const cached = cache.get(logicalName);
    if (cached) return cached;
    const metadata = await context.utils.getEntityMetadata(logicalName);
    const value = readMetadata(metadata, keys) ?? fallback();
    cache.set(logicalName, value);
    return value;
}

/**
 * Resolves the table's primary key column. Usually "<table>id", but not always:
 * activity tables such as task, email and phonecall all use "activityid".
 */
export function resolvePrimaryIdAttribute(context: ComponentFramework.Context<any>, logicalName: string): Promise<string> {
    return resolveMetadataValue(
        context,
        primaryIdAttributeCache,
        logicalName,
        ["PrimaryIdAttribute", "primaryIdAttribute"],
        () => `${logicalName}id`
    );
}

/** Resolves the table's primary name column, so callers never have to configure it by hand. */
export function resolvePrimaryNameAttribute(context: ComponentFramework.Context<any>, logicalName: string): Promise<string> {
    return resolveMetadataValue(
        context,
        primaryNameAttributeCache,
        logicalName,
        ["PrimaryNameAttribute", "primaryNameAttribute"],
        () => {
            throw new Error(`Field Review control: could not resolve the primary name column of table "${logicalName}".`);
        }
    );
}

export async function resolveCollectionName(context: ComponentFramework.Context<any>, logicalName: string): Promise<string> {
    if (logicalName === "systemuser") return SYSTEMUSER_COLLECTION;
    return resolveMetadataValue(
        context,
        entitySetNameCache,
        logicalName,
        ["EntitySetName", "entitySetName", "entityPluralName", "EntityPluralName"],
        () => {
            throw new Error(`Field Review control: could not resolve the Web API collection name of table "${logicalName}".`);
        }
    );
}

/** The column holding the reviewed field's logical name: as configured, else the comment table's primary name column. */
async function resolveFieldReferenceAttribute(
    context: ComponentFramework.Context<any>,
    settings: ReviewSettings
): Promise<string> {
    return settings.fieldReferenceAttribute ?? resolvePrimaryNameAttribute(context, settings.commentTable);
}

function stripBraces(guid: string): string {
    return guid.replace(/[{}]/g, "");
}

/** A GUID brace-free and lowercase, to match ids the Web API returns. */
export function normalizeId(id: string): string {
    return stripBraces(id).toLowerCase();
}

/** Current user's id, brace-free and lowercase. */
export function getCurrentUserId(context: ComponentFramework.Context<any>): string {
    return normalizeId(context.userSettings.userId);
}

/**
 * Reads the current record's entity name, id and display name.
 *
 * IMPORTANT CAVEAT: a field-bound PCF control has no *officially documented*
 * way to learn which record it is sitting on -- that information is only
 * exposed on the dataset context of dataset-bound controls. `context.mode`
 * carries an undocumented `contextInfo` object ({ entityTypeName, entityId,
 * entityRecordName }) that is widely relied on in production PCF controls
 * (see e.g. https://oliverflint.co.uk/2020/06/10/pcf-primary-entity-info/),
 * and it is what we use here -- but it is not part of the published
 * ComponentFramework typings and Microsoft has never committed to keeping it.
 * If a future platform update removes it, the fallback documented in the
 * README (parsing entityId/etn from the page URL) is uglier but has also
 * been used in production; this function is the single place you'd swap the
 * implementation.
 */
export function getCurrentRecordRef(context: ComponentFramework.Context<any>): CurrentRecordRef {
    const contextInfo = readContextInfo(context);
    if (!contextInfo || !contextInfo.entityId || !contextInfo.entityTypeName) {
        throw new Error(
            "Field Review control: could not determine the current record (context.mode.contextInfo is unavailable). " +
                "This relies on an undocumented platform property -- see the README's 'Current record detection' section."
        );
    }
    return {
        entityTypeName: contextInfo.entityTypeName,
        entityId: stripBraces(contextInfo.entityId),
        entityName: contextInfo.entityRecordName ?? "",
    };
}

function readContextInfo(context: ComponentFramework.Context<any>): Record<string, string> | undefined {
    return (context.mode as unknown as { contextInfo?: Record<string, string> }).contextInfo;
}

/** The form's table logical name. Unlike getCurrentRecordRef, this also works on a create form. */
export function getCurrentTableName(context: ComponentFramework.Context<any>): string {
    const entityTypeName = readContextInfo(context)?.entityTypeName;
    if (!entityTypeName) {
        throw new Error(
            "Field Review control: could not determine the current table (context.mode.contextInfo is unavailable)."
        );
    }
    return entityTypeName;
}

/** The current record's id (brace-free, lowercase), or null on a create form that hasn't been saved yet. */
export function tryGetCurrentRecordId(context: ComponentFramework.Context<any>): string | null {
    const id = normalizeId(readContextInfo(context)?.entityId ?? "");
    return id && id !== "00000000-0000-0000-0000-000000000000" ? id : null;
}

/**
 * Calls the Web API directly, for what PCF's webAPI can't do: query metadata and
 * associate/disassociate N:N records. `path` is relative to /api/data/v9.2/.
 * Returns the parsed JSON body, or null for an empty (204) response.
 */
export async function webApiFetch(
    context: ComponentFramework.Context<any>,
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown
): Promise<any> {
    const headers: Record<string, string> = {
        Accept: "application/json",
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0",
        Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"',
    };
    if (body !== undefined) headers["Content-Type"] = "application/json; charset=utf-8";
    const response = await fetch(`${getClientUrl(context)}/api/data/v9.2/${path}`, {
        method,
        credentials: "same-origin",
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const json = text ? JSON.parse(text) : null;
    if (!response.ok) {
        throw new Error(json?.error?.message ?? `HTTP ${response.status}`);
    }
    return json;
}

/** Absolute Web API URL of a record, as `@odata.id` in an associate request requires. */
export function recordODataId(context: ComponentFramework.Context<any>, entitySetName: string, id: string): string {
    return `${getClientUrl(context)}/api/data/v9.2/${entitySetName}(${stripBraces(id)})`;
}

/**
 * Loads every comment recorded against the current record for one specific
 * field, each with its status and list of assignees, newest first.
 */
export async function fetchCommentHistory(
    context: ComponentFramework.Context<any>,
    settings: ReviewSettings,
    fieldLogicalName: string
): Promise<CommentRecord[]> {
    const record = getCurrentRecordRef(context);

    const regardingFilter =
        settings.regardingMode === "lookup"
            ? `_${settings.regardingLookupAttribute}_value eq ${record.entityId}`
            : `${settings.regardingTableAttribute} eq '${record.entityTypeName}' and ` +
              `${settings.regardingIdAttribute} eq '${record.entityId}'`;
    const fieldReferenceAttribute = await resolveFieldReferenceAttribute(context, settings);
    const filter = `${regardingFilter} and ${fieldReferenceAttribute} eq '${fieldLogicalName}'`;

    const commentResult = await context.webAPI.retrieveMultipleRecords(
        settings.commentTable,
        `?$filter=${encodeURIComponent(filter)}&$orderby=createdon desc`
    );

    const comments = commentResult.entities;
    if (comments.length === 0) return [];

    const commentIdAttribute = await resolvePrimaryIdAttribute(context, settings.commentTable);
    const assignmentsByComment = new Map<string, AssignmentRecord[]>();
    // Adds the assignee held by `userLookupAttribute` on `row` (an assignment row, or the comment itself in "lookup" mode).
    const addAssignee = (commentId: string, assignmentId: string, row: ComponentFramework.WebApi.Entity, userLookupAttribute: string) => {
        const assigneeId = row[`_${userLookupAttribute}_value`] as string | undefined;
        if (!assigneeId) return;
        const assigneeName =
            (row[`_${userLookupAttribute}_value@OData.Community.Display.V1.FormattedValue`] as string) ?? "";
        const list = assignmentsByComment.get(commentId) ?? [];
        list.push({ id: assignmentId, assigneeId, assigneeName });
        assignmentsByComment.set(commentId, list);
    };

    if (settings.assignmentMode === "lookup") {
        for (const c of comments) {
            const id = c[commentIdAttribute] as string;
            addAssignee(id, id, c, settings.commentAssigneeAttribute as string);
        }
    } else {
        const assignmentTable = settings.assignmentTable as string;
        const commentLookupAttribute = settings.assignmentCommentLookupAttribute as string;
        const assignmentIdAttribute = await resolvePrimaryIdAttribute(context, assignmentTable);
        const idFilter = comments
            // Lookups are filtered on their _<column>_value property, with the GUID unquoted.
            .map((c) => `_${commentLookupAttribute}_value eq ${c[commentIdAttribute] as string}`)
            .join(" or ");

        const assignmentResult = await context.webAPI.retrieveMultipleRecords(
            assignmentTable,
            `?$filter=${encodeURIComponent(idFilter)}`
        );
        for (const a of assignmentResult.entities) {
            addAssignee(
                a[`_${commentLookupAttribute}_value`] as string,
                a[assignmentIdAttribute] as string,
                a,
                settings.assignmentUserLookupAttribute as string
            );
        }
    }

    return comments.map((c) => {
        const id = c[commentIdAttribute] as string;
        return {
            id,
            text: c[settings.commentTextAttribute] as string,
            authorName: (c["_createdby_value@OData.Community.Display.V1.FormattedValue"] as string) ?? "",
            createdOn: c["createdon"] as string,
            // Rows with an empty or unexpected status count as open, so nothing is hidden by accident.
            isResolved: String(c[settings.commentStatusAttribute]) === String(settings.commentStatusResolvedValue),
            resolvedOn: settings.commentResolvedOnAttribute
                ? (c[settings.commentResolvedOnAttribute] as string | undefined)
                : undefined,
            resolvedByName: settings.commentResolvedByAttribute
                ? (c[
                      `_${settings.commentResolvedByAttribute}_value@OData.Community.Display.V1.FormattedValue`
                  ] as string | undefined)
                : undefined,
            assignments: assignmentsByComment.get(id) ?? [],
        };
    });
}

/**
 * Creates one open comment row against the current record/field. In "table"
 * mode it adds one assignment row per assignee (rows only record who is
 * assigned); in "lookup" mode the single assignee goes on the comment itself.
 */
export async function createCommentWithAssignments(
    context: ComponentFramework.Context<any>,
    settings: ReviewSettings,
    fieldLogicalName: string,
    commentText: string,
    assigneeIds: string[]
): Promise<void> {
    const record = getCurrentRecordRef(context);

    const commentData: Record<string, unknown> = {
        [settings.commentTextAttribute]: commentText,
        [await resolveFieldReferenceAttribute(context, settings)]: fieldLogicalName,
        [settings.commentStatusAttribute]: settings.commentStatusOpenValue,
    };
    if (settings.regardingMode === "lookup") {
        const navigationProperty = await resolveNavigationProperty(
            context,
            settings.commentTable,
            settings.regardingLookupAttribute as string,
            record.entityTypeName,
            settings.regardingLookupNavigationProperty
        );
        const parentCollection = await resolveCollectionName(context, record.entityTypeName);
        commentData[`${navigationProperty}@odata.bind`] = `/${parentCollection}(${record.entityId})`;
    }
    // Always required in "text" mode; in "lookup" mode, written too if configured (handy for cross-table views).
    if (settings.regardingTableAttribute) {
        commentData[settings.regardingTableAttribute] = record.entityTypeName;
    }
    if (settings.regardingIdAttribute) {
        commentData[settings.regardingIdAttribute] = record.entityId;
    }
    if (settings.regardingNameAttribute && record.entityName) {
        commentData[settings.regardingNameAttribute] = record.entityName;
    }

    const userCollection = await resolveCollectionName(context, "systemuser");
    if (settings.assignmentMode === "lookup") {
        const assigneeNavigationProperty = await resolveNavigationProperty(
            context,
            settings.commentTable,
            settings.commentAssigneeAttribute as string,
            "systemuser",
            settings.commentAssigneeNavigationProperty
        );
        commentData[`${assigneeNavigationProperty}@odata.bind`] = `/${userCollection}(${assigneeIds[0]})`;
        await context.webAPI.createRecord(settings.commentTable, commentData);
        return;
    }

    const created = await context.webAPI.createRecord(settings.commentTable, commentData);
    const commentId = created.id;

    const assignmentTable = settings.assignmentTable as string;
    const commentCollection = await resolveCollectionName(context, settings.commentTable);
    const commentNavigationProperty = await resolveNavigationProperty(
        context,
        assignmentTable,
        settings.assignmentCommentLookupAttribute as string,
        settings.commentTable,
        settings.assignmentCommentNavigationProperty
    );
    const userNavigationProperty = await resolveNavigationProperty(
        context,
        assignmentTable,
        settings.assignmentUserLookupAttribute as string,
        "systemuser",
        settings.assignmentUserNavigationProperty
    );

    for (const assigneeId of assigneeIds) {
        const assignmentData: Record<string, unknown> = {
            [`${commentNavigationProperty}@odata.bind`]: `/${commentCollection}(${commentId})`,
            [`${userNavigationProperty}@odata.bind`]: `/${userCollection}(${assigneeId})`,
        };
        if (settings.assignmentRegardingTableAttribute) {
            assignmentData[settings.assignmentRegardingTableAttribute] = record.entityTypeName;
        }
        if (settings.assignmentRegardingIdAttribute) {
            assignmentData[settings.assignmentRegardingIdAttribute] = record.entityId;
        }
        await context.webAPI.createRecord(assignmentTable, assignmentData);
    }
}

/** Resolves a comment for everyone. Called when any one of its assignees resolves it. */
export async function resolveComment(
    context: ComponentFramework.Context<any>,
    settings: ReviewSettings,
    commentId: string
): Promise<void> {
    const data: Record<string, unknown> = {
        [settings.commentStatusAttribute]: settings.commentStatusResolvedValue,
    };
    if (settings.commentResolvedOnAttribute) {
        data[settings.commentResolvedOnAttribute] = new Date().toISOString();
    }
    if (settings.commentResolvedByAttribute) {
        const navigationProperty = await resolveNavigationProperty(
            context,
            settings.commentTable,
            settings.commentResolvedByAttribute,
            "systemuser",
            settings.commentResolvedByNavigationProperty
        );
        const userCollection = await resolveCollectionName(context, "systemuser");
        data[`${navigationProperty}@odata.bind`] = `/${userCollection}(${getCurrentUserId(context)})`;
    }
    await context.webAPI.updateRecord(settings.commentTable, commentId, data);
}

/** Counts candidate records for a Lookup's "auto" simple-vs-search decision. Capped at threshold+1 rows. */
export async function countLookupCandidates(
    context: ComponentFramework.Context<any>,
    targetEntity: string,
    filter: string | undefined,
    threshold: number
): Promise<number> {
    const query = filter ? `?$filter=${encodeURIComponent(filter)}&$top=${threshold + 1}` : `?$top=${threshold + 1}`;
    const result = await context.webAPI.retrieveMultipleRecords(targetEntity, query);
    return result.entities.length;
}

/** Fetches candidate records for the lookup dropdown. */
export async function fetchLookupCandidates(
    context: ComponentFramework.Context<any>,
    targetEntity: string,
    filter: string | undefined,
    topN = 100
): Promise<{ id: string; name: string }[]> {
    const primaryNameAttribute = await resolvePrimaryNameAttribute(context, targetEntity);
    const primaryIdAttribute = await resolvePrimaryIdAttribute(context, targetEntity);
    const select = `?$select=${primaryIdAttribute},${primaryNameAttribute}${filter ? `&$filter=${encodeURIComponent(filter)}` : ""}&$top=${topN}&$orderby=${primaryNameAttribute} asc`;
    const result = await context.webAPI.retrieveMultipleRecords(targetEntity, select);
    return result.entities.map((e) => ({
        id: e[primaryIdAttribute] as string,
        name: (e[primaryNameAttribute] as string) ?? "(no name)",
    }));
}
