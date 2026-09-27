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
            const url =
                `${getClientUrl(context)}/api/data/v9.2/EntityDefinitions(LogicalName='${entity}')/ManyToOneRelationships` +
                `?$select=ReferencingEntityNavigationPropertyName,ReferencedEntity` +
                `&$filter=${encodeURIComponent(`ReferencingAttribute eq '${attribute}'`)}`;
            const response = await fetch(url, {
                credentials: "same-origin",
                headers: { Accept: "application/json", "OData-MaxVersion": "4.0", "OData-Version": "4.0" },
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const body = (await response.json()) as {
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

async function resolveCollectionName(
    context: ComponentFramework.Context<any>,
    logicalName: string,
    override?: string
): Promise<string> {
    if (override) return override;
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

/** Current user's id, brace-free and lowercase to match ids the Web API returns. */
export function getCurrentUserId(context: ComponentFramework.Context<any>): string {
    return stripBraces(context.userSettings.userId).toLowerCase();
}

export function getCurrentUserName(context: ComponentFramework.Context<any>): string {
    return context.userSettings.userName ?? "";
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
    const contextInfo = (context.mode as unknown as { contextInfo?: Record<string, string> }).contextInfo;
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
    const assignmentIdAttribute = await resolvePrimaryIdAttribute(context, settings.assignmentTable);
    const commentIds = comments.map((c) => c[commentIdAttribute] as string);
    const idFilter = commentIds
        // Lookups are filtered on their _<column>_value property, with the GUID unquoted.
        .map((id) => `_${settings.assignmentCommentLookupAttribute}_value eq ${id}`)
        .join(" or ");

    const assignmentResult = await context.webAPI.retrieveMultipleRecords(
        settings.assignmentTable,
        `?$filter=${encodeURIComponent(idFilter)}`
    );

    const assignmentsByComment = new Map<string, AssignmentRecord[]>();
    for (const a of assignmentResult.entities) {
        const commentId = a[`_${settings.assignmentCommentLookupAttribute}_value`] as string;
        const assigneeId = a[`_${settings.assignmentUserLookupAttribute}_value`] as string;
        const assigneeName =
            (a[`_${settings.assignmentUserLookupAttribute}_value@OData.Community.Display.V1.FormattedValue`] as string) ??
            "";

        const list = assignmentsByComment.get(commentId) ?? [];
        list.push({
            id: a[assignmentIdAttribute] as string,
            assigneeId,
            assigneeName,
        });
        assignmentsByComment.set(commentId, list);
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
 * Creates one open comment row against the current record/field, plus one
 * assignment row per assignee. Assignment rows only record who is assigned.
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

    const created = await context.webAPI.createRecord(settings.commentTable, commentData);
    const commentId = created.id;

    const userCollection = await resolveCollectionName(context, "systemuser");
    const commentCollection = await resolveCollectionName(context, settings.commentTable);
    const commentNavigationProperty = await resolveNavigationProperty(
        context,
        settings.assignmentTable,
        settings.assignmentCommentLookupAttribute,
        settings.commentTable,
        settings.assignmentCommentNavigationProperty
    );
    const userNavigationProperty = await resolveNavigationProperty(
        context,
        settings.assignmentTable,
        settings.assignmentUserLookupAttribute,
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
        await context.webAPI.createRecord(settings.assignmentTable, assignmentData);
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

export { resolveCollectionName };
