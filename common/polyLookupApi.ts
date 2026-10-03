import { PolyLookupRelationshipType, ReviewSettings } from "./types";
import {
    normalizeId,
    recordODataId,
    resolveCollectionName,
    resolvePrimaryIdAttribute,
    resolvePrimaryNameAttribute,
    webApiFetch,
} from "./dataverseApi";

/**
 * Reads and writes the records related to the current record through a
 * many-to-many style relationship, for the PolyLookup control. Three shapes:
 *
 * - "manyToMany": a native N:N relationship. Read through the current table's
 *   collection-valued navigation property, written with $ref associate /
 *   disassociate requests.
 * - "custom": a table of your own between the two (current 1:N intersect N:1
 *   selectable). Each selection is one intersect row: created on select,
 *   deleted on remove.
 * - "connection": the built-in connection table, which works like "custom"
 *   with record1id/record2id as the two lookups.
 *
 * Changes are saved as they're made, not with the form, so they need an
 * existing record. PCF's webAPI can't query relationship metadata or send
 * $ref requests, so those go through webApiFetch.
 */

export interface PolyLookupItem {
    /** Selected record's id, brace-free and lowercase. */
    id: string;
    name: string;
    /** "custom"/"connection": the intersect rows linking it (usually one). Empty for "manyToMany" and unsaved selections. */
    linkIds: string[];
}

export interface PolyLookupMetadata {
    type: PolyLookupRelationshipType;
    currentTable: string;
    currentEntitySet: string;
    /** The table records are picked from. */
    targetTable: string;
    targetEntitySet: string;
    targetIdAttribute: string;
    targetNameAttribute: string;
    /** "manyToMany": collection-valued navigation property on the current table. */
    navigationProperty?: string;
    /** "custom"/"connection": the intersect table and its two lookups. */
    intersectTable?: string;
    intersectIdAttribute?: string;
    currentLookupAttribute?: string;
    currentNavigationProperty?: string;
    targetLookupAttribute?: string;
    targetNavigationProperty?: string;
}

interface ManyToManyDefinition {
    Entity1LogicalName: string;
    Entity2LogicalName: string;
    Entity1NavigationPropertyName: string;
    Entity2NavigationPropertyName: string;
}

interface OneToManyDefinition {
    ReferencedEntity: string;
    ReferencingEntity: string;
    ReferencingAttribute: string;
    ReferencingEntityNavigationPropertyName: string;
}

const ONE_TO_MANY_SELECT = "ReferencedEntity,ReferencingEntity,ReferencingAttribute,ReferencingEntityNavigationPropertyName";
const FORMATTED = "@OData.Community.Display.V1.FormattedValue";
const LOOKUP_TABLE = "@Microsoft.Dynamics.CRM.lookuplogicalname";

function quote(value: string): string {
    return value.replace(/'/g, "''");
}

/** Checks the PolyLookup keys of settingsJson; throws a message for the maker if they're incomplete. */
export function validatePolyLookupSettings(settings: ReviewSettings): void {
    const type = settings.polyLookupRelationshipType ?? "manyToMany";
    if (!["manyToMany", "custom", "connection"].includes(type)) {
        throw new Error(
            `Field Review (PolyLookup) control: polyLookupRelationshipType must be "manyToMany", "custom" or "connection" (got "${type}").`
        );
    }
    if (!settings.polyLookupRelationshipName) {
        throw new Error("Field Review (PolyLookup) control: settingsJson must include polyLookupRelationshipName.");
    }
    if (type !== "manyToMany" && !settings.polyLookupRelationship2Name) {
        throw new Error(
            `Field Review (PolyLookup) control: polyLookupRelationship2Name is required when polyLookupRelationshipType is "${type}".`
        );
    }
    const output = settings.polyLookupOutput ?? "none";
    if (!["none", "text", "json"].includes(output)) {
        throw new Error(
            `Field Review (PolyLookup) control: polyLookupOutput must be "none", "text" or "json" (got "${output}").`
        );
    }
}

/** Reads the relationship definition(s) and the tables involved. */
export async function resolvePolyLookupMetadata(
    context: ComponentFramework.Context<any>,
    currentTable: string,
    settings: ReviewSettings
): Promise<PolyLookupMetadata> {
    const type = settings.polyLookupRelationshipType ?? "manyToMany";
    const relationshipName = quote(settings.polyLookupRelationshipName as string);
    const tablePath = `EntityDefinitions(LogicalName='${quote(currentTable)}')`;

    let partial: Omit<
        PolyLookupMetadata,
        "currentEntitySet" | "targetEntitySet" | "targetIdAttribute" | "targetNameAttribute"
    >;
    try {
        if (type === "manyToMany") {
            const rel = (await webApiFetch(
                context,
                "GET",
                `${tablePath}/ManyToManyRelationships(SchemaName='${relationshipName}')` +
                    "?$select=Entity1LogicalName,Entity2LogicalName,Entity1NavigationPropertyName,Entity2NavigationPropertyName"
            )) as ManyToManyDefinition;
            // For a self-referencing N:N both sides are the current table; use Entity1's side.
            const currentIsEntity1 = rel.Entity1LogicalName === currentTable;
            partial = {
                type,
                currentTable,
                targetTable: currentIsEntity1 ? rel.Entity2LogicalName : rel.Entity1LogicalName,
                navigationProperty: currentIsEntity1 ? rel.Entity1NavigationPropertyName : rel.Entity2NavigationPropertyName,
            };
        } else {
            const toIntersect = (await webApiFetch(
                context,
                "GET",
                `${tablePath}/OneToManyRelationships(SchemaName='${relationshipName}')?$select=${ONE_TO_MANY_SELECT}`
            )) as OneToManyDefinition;
            const intersectTable = toIntersect.ReferencingEntity;
            const toTarget = (await webApiFetch(
                context,
                "GET",
                `EntityDefinitions(LogicalName='${quote(intersectTable)}')/ManyToOneRelationships(SchemaName='${quote(
                    settings.polyLookupRelationship2Name as string
                )}')?$select=${ONE_TO_MANY_SELECT}`
            )) as OneToManyDefinition;
            partial = {
                type,
                currentTable,
                targetTable: toTarget.ReferencedEntity,
                intersectTable,
                intersectIdAttribute: await resolvePrimaryIdAttribute(context, intersectTable),
                currentLookupAttribute: toIntersect.ReferencingAttribute,
                currentNavigationProperty: toIntersect.ReferencingEntityNavigationPropertyName,
                targetLookupAttribute: toTarget.ReferencingAttribute,
                targetNavigationProperty: toTarget.ReferencingEntityNavigationPropertyName,
            };
        }
    } catch (e) {
        throw new Error(
            `Field Review (PolyLookup) control: could not read relationship "${settings.polyLookupRelationshipName}"` +
                (type === "manyToMany" ? "" : ` / "${settings.polyLookupRelationship2Name}"`) +
                ` from table "${currentTable}" (${(e as Error).message}). ` +
                "Use the relationship's schema name, not the intersect table name."
        );
    }

    const [currentEntitySet, targetEntitySet, targetIdAttribute, targetNameAttribute] = await Promise.all([
        resolveCollectionName(context, currentTable),
        resolveCollectionName(context, partial.targetTable),
        resolvePrimaryIdAttribute(context, partial.targetTable),
        resolvePrimaryNameAttribute(context, partial.targetTable),
    ]);
    return { ...partial, currentEntitySet, targetEntitySet, targetIdAttribute, targetNameAttribute };
}

/** Loads the records currently related to `recordId`, sorted by name. */
export async function fetchSelectedItems(
    context: ComponentFramework.Context<any>,
    meta: PolyLookupMetadata,
    recordId: string
): Promise<PolyLookupItem[]> {
    let items: PolyLookupItem[];
    if (meta.type === "manyToMany") {
        const body = (await webApiFetch(
            context,
            "GET",
            `${meta.currentEntitySet}(${recordId})/${meta.navigationProperty}` +
                `?$select=${meta.targetIdAttribute},${meta.targetNameAttribute}`
        )) as { value: Record<string, unknown>[] };
        items = body.value.map((r) => ({
            id: normalizeId(r[meta.targetIdAttribute] as string),
            name: (r[meta.targetNameAttribute] as string) ?? "(no name)",
            linkIds: [],
        }));
    } else {
        const targetValue = `_${meta.targetLookupAttribute}_value`;
        const result = await context.webAPI.retrieveMultipleRecords(
            meta.intersectTable as string,
            `?$select=${meta.intersectIdAttribute},${targetValue}` +
                `&$filter=${encodeURIComponent(`_${meta.currentLookupAttribute}_value eq ${recordId}`)}`
        );
        // Group by selected record: two intersect rows to the same record show as one tag.
        const byId = new Map<string, PolyLookupItem>();
        for (const row of result.entities) {
            const targetId = row[targetValue] as string | undefined;
            if (!targetId) continue;
            // A connection's record2id can point at any table; keep only the configured one.
            const targetTable = row[`${targetValue}${LOOKUP_TABLE}`] as string | undefined;
            if (targetTable && targetTable !== meta.targetTable) continue;
            const id = normalizeId(targetId);
            const item = byId.get(id) ?? { id, name: (row[`${targetValue}${FORMATTED}`] as string) ?? "(no name)", linkIds: [] };
            item.linkIds.push(row[meta.intersectIdAttribute as string] as string);
            byId.set(id, item);
        }
        items = Array.from(byId.values());
    }
    return items.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Searches the selectable table by primary name ("contains"), within settings.lookupCandidateFilter.
 * Returns up to `top` records and whether there are more.
 */
export async function searchCandidates(
    context: ComponentFramework.Context<any>,
    meta: PolyLookupMetadata,
    term: string,
    candidateFilter: string | undefined,
    top = 50
): Promise<{ items: PolyLookupItem[]; more: boolean }> {
    const filters: string[] = [];
    if (term.trim()) filters.push(`contains(${meta.targetNameAttribute},'${quote(term.trim())}')`);
    if (candidateFilter) filters.push(`(${candidateFilter})`);
    const query =
        `?$select=${meta.targetIdAttribute},${meta.targetNameAttribute}` +
        (filters.length ? `&$filter=${encodeURIComponent(filters.join(" and "))}` : "") +
        `&$orderby=${meta.targetNameAttribute} asc&$top=${top + 1}`;
    const result = await context.webAPI.retrieveMultipleRecords(meta.targetTable, query);
    const items = result.entities.slice(0, top).map((r) => ({
        id: normalizeId(r[meta.targetIdAttribute] as string),
        name: (r[meta.targetNameAttribute] as string) ?? "(no name)",
        linkIds: [],
    }));
    return { items, more: result.entities.length > top };
}

/** Relates `item` to the current record. Returns the item with its new intersect row id, if any. */
export async function associateItem(
    context: ComponentFramework.Context<any>,
    meta: PolyLookupMetadata,
    recordId: string,
    item: PolyLookupItem
): Promise<PolyLookupItem> {
    if (meta.type === "manyToMany") {
        await webApiFetch(context, "POST", `${meta.currentEntitySet}(${recordId})/${meta.navigationProperty}/$ref`, {
            "@odata.id": recordODataId(context, meta.targetEntitySet, item.id),
        });
        return { ...item, linkIds: [] };
    }
    const created = await context.webAPI.createRecord(meta.intersectTable as string, {
        [`${meta.currentNavigationProperty}@odata.bind`]: `/${meta.currentEntitySet}(${recordId})`,
        [`${meta.targetNavigationProperty}@odata.bind`]: `/${meta.targetEntitySet}(${item.id})`,
    });
    return { ...item, linkIds: [created.id] };
}

/** Removes the relationship between `item` and the current record. The selected record itself is untouched. */
export async function disassociateItem(
    context: ComponentFramework.Context<any>,
    meta: PolyLookupMetadata,
    recordId: string,
    item: PolyLookupItem
): Promise<void> {
    if (meta.type === "manyToMany") {
        await webApiFetch(context, "DELETE", `${meta.currentEntitySet}(${recordId})/${meta.navigationProperty}(${item.id})/$ref`);
        return;
    }
    for (const linkId of item.linkIds) {
        await context.webAPI.deleteRecord(meta.intersectTable as string, linkId);
    }
}
