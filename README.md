# Insurgo Field Review — PCF controls

Three PCF field controls that add a "+" comment/assignment thread to a field on a
model-driven form: reviewers can comment on a field and assign the comment to
multiple people. Each comment is open until any one of its assignees marks it
resolved, which resolves it for everyone. The full history is visible to all.

## Why three controls, not one

A single bound property can only declare one `<type-group>`, and while the
manifest schema docs describe resolvable type-groups for scalar families
(strings, numbers, dates), they do not document — and don't rule out — mixing
`Lookup.Simple` or `OptionSet` into a group with scalar types. (`pcf-scripts`
accepts either at build time, but only by falling back to an untyped
`Property`, so a passing build doesn't prove the platform binds it at
runtime.) Rather than gamble on
unconfirmed platform behaviour for something this foundational, this project
ships one control per field family, built together from a single PCF project:

- **FieldReviewControl** — bind to a Text, Whole Number, Currency or Decimal
  field. Editable input: text respects the column's max length; numbers show
  formatted (e.g. `$1,250.00`), switch to the plain number while typing, and
  are checked against the column's min/max and decimal places.
- **FieldReviewLookupControl** — bind to a Lookup field. Same comment thread,
  plus an editable dropdown of existing records. There's no way to create a
  record from the field unless `lookupAllowCreate` is set (see below).
- **FieldReviewChoiceControl** — bind to a Choice (option set) field. Same
  comment thread, plus an editable dropdown of the field's options.

The Lookup and Choice controls render the value with the same dropdown
(`common/dropdown.ts`), so both field types look and behave the same on the
form: a plain list with a `---` entry for "no value", disabled when the form
or field is read-only.

All editors, including the text/number input, become read-only only when the
field is disabled: by the form, a business rule, a script
(`setDisabled(true)`), or column security.

All three import the same logic from the root `common/` folder (settings parsing,
the comment/assignment Web API calls, the panel UI, the lookup picker) via
`../common/...`. There is one copy, and webpack bundles it into each
control's `bundle.js` separately.

```
FieldReview.pcfproj        one PCF project, referenced by the solution
package.json / tsconfig    shared toolchain
pcfconfig.json             output dir; build-time ESLint skipped (no config shipped)
common/                    shared TypeScript used by all controls
FieldReviewControl/        manifest, index.ts, css, strings
FieldReviewLookupControl/  manifest, index.ts, css, strings
FieldReviewChoiceControl/  manifest, index.ts, css, strings
```

A single `npm install && npm run build` at the root builds all three controls
into `out/controls/<ControlName>/` (verified). You don't need the `pac` CLI
for that step. You need the Power Platform CLI only to package or push the
compiled controls into a solution.

## Settings JSON

All controls take one input property, **Review settings (JSON)**, configured
per field instance in the form designer. Nothing about your table/column
naming is hardcoded, so the same compiled control works across environments
and clients with different publisher prefixes.

```json
{
  "commentTable": "insurgo_reviewcomment",
  "commentTextAttribute": "insurgo_commenttext",
  "regardingMode": "text",
  "regardingTableAttribute": "insurgo_regardingtable",
  "regardingIdAttribute": "insurgo_regardingid",
  "regardingNameAttribute": "insurgo_regardingname",
  "fieldReferenceAttribute": "insurgo_fieldlogicalname",
  "commentStatusAttribute": "insurgo_status",
  "commentStatusOpenValue": 100000000,
  "commentStatusResolvedValue": 100000001,
  "commentResolvedOnAttribute": "insurgo_resolvedon",
  "commentResolvedByAttribute": "insurgo_resolvedby",

  "assignmentTable": "insurgo_reviewassignment",
  "assignmentCommentLookupAttribute": "insurgo_comment",
  "assignmentUserLookupAttribute": "insurgo_assignee",
  "assignmentRegardingTableAttribute": "insurgo_regardingtable",
  "assignmentRegardingIdAttribute": "insurgo_regardingid",

  "lookupTargets": ["account"],
  "lookupMode": "simple",
  "lookupAllowCreate": false,
  "lookupAutoThreshold": 25,
  "lookupCandidateFilter": "statecode eq 0",
  "lookupSearchDefaultViewId": null
}
```

| Key | Required | Purpose |
|---|---|---|
| `renderLabel` | no | `true` draws the field label inside the control with the "+" and comment badge next to it. A control can't draw into the form's own label, so **hide the form label** for that field (field properties > "Hide label") when you turn this on. Default `false`: the "+" sits after the value. |
| `labelWidth` | no | Width of the label drawn by `renderLabel`, as a CSS length, e.g. `"180px"`. Match it to the other labels on the form. Default `"160px"`. |
| `commentTable` | yes | Logical name of the table storing one row per comment. |
| `commentTextAttribute` | yes | Column holding the comment text. |
| `regardingMode` | no | How a comment links to its parent record: `"text"` (default) or `"lookup"`. See [Linking comments to the parent record](#linking-comments-to-the-parent-record). |
| `regardingTableAttribute` | `"text"` mode | Column storing the parent record's table logical name. Optional in `"lookup"` mode; filled in too if set. |
| `regardingIdAttribute` | `"text"` mode | Column storing the parent record's GUID as text. Optional in `"lookup"` mode; filled in too if set. |
| `regardingLookupAttribute` | `"lookup"` mode | Logical name of the Lookup column on the comment table that points at the table this form is on. |
| `regardingLookupNavigationProperty` | no | `"lookup"` mode only. Override for the lookup's navigation property. Normally not needed: the control reads it from the relationship metadata (see caveat 3). |
| `regardingNameAttribute` | no | Column storing a snapshot of the parent record's display name, so views show something readable instead of a bare GUID. |
| `fieldReferenceAttribute` | no | Text column on the comment table where the control stores the logical name of the field the comment is about (e.g. `title`), so each field keeps its own thread. The field name itself is always detected automatically; this only says where to store it. Defaults to the comment table's primary name column (e.g. `subject` on `task`). Set it to use a dedicated column instead, which keeps the primary name free for something readable. |
| `commentStatusAttribute` | yes | Column on the comment table storing whether the comment is open or resolved. |
| `commentStatusOpenValue` / `commentStatusResolvedValue` | yes | Values written to that column on create and on resolve. Use a JSON number for a Choice (`100000001`), `true`/`false` for Yes/No, or a string for a text column: the value is sent to Dataverse exactly as written. Any stored value other than the resolved value counts as open. |
| `commentResolvedOnAttribute` | no | Date and Time column on the comment table, stamped when the comment is resolved. |
| `commentResolvedByAttribute` | no | Lookup-to-User column on the comment table, set to whoever resolved the comment. |
| `commentResolvedByNavigationProperty` | no | Override for `commentResolvedByAttribute`'s navigation property. Normally not needed (see caveat 3). |
| `assignmentTable` | yes | Logical name of the child table storing one row per assignee. |
| `assignmentCommentLookupAttribute` | yes | Column on the assignment table: the Lookup back to the parent comment row. |
| `assignmentUserLookupAttribute` | yes | Column on the assignment table: the Lookup to `systemuser` (the assignee). |
| `assignmentCommentNavigationProperty` / `assignmentUserNavigationProperty` | no | Overrides for those two lookups' navigation properties. Normally not needed (see caveat 3). |
| `assignmentRegardingTableAttribute` / `assignmentRegardingIdAttribute` | no | Denormalized copies of the regarding info directly on the assignment row, for a cross-table "assigned to me" view. |
| `lookupTargets` | Lookup control only | Array of target table logical names. Not derivable from PCF metadata — must be listed explicitly. More than one entry (a polymorphic-style lookup) always forces the native search dialog; see below. |
| `lookupMode` | Lookup control only | `"simple"` (default): the plain dropdown, same as the Choice control. `"search"`: the native lookup dialog, which always has its own "+ New" button that this control can't hide. `"auto"`: dropdown up to `lookupAutoThreshold` candidates, the native dialog above that. |
| `lookupAllowCreate` | Lookup control only | `true` adds a "+ New record" entry to the dropdown that opens the target table's quick create form and selects the saved record. Default `false`: existing records only. |
| `lookupAutoThreshold` | Lookup control only | Candidate-count cutoff for `"auto"`. Default 25. |
| `lookupCandidateFilter` | Lookup control only | Optional OData `$filter` fragment scoping candidates (used by both the dropdown and the auto-mode count check). The dropdown lists at most 100 records, sorted by name; use this filter to keep the list short. The current value always stays in the list even if the filter excludes it. |
| `lookupSearchDefaultViewId` | Lookup control only | Saved view GUID passed as the native dialog's default view. |

### Linking comments to the parent record

`regardingMode` picks how each comment row points back to the record it's
about. You set it per field, so different forms can use different modes.

**`"text"` (default)**: two plain text columns, the table name and the GUID.
One comment table serves Opportunity, Account, Case or anything else with no
schema changes. The trade-off: the GUID doesn't show as a clickable,
name-resolved link in views, you can't add a native subgrid of comments to
the parent form, and comments aren't deleted when the parent record is.

**`"lookup"`**: a real Lookup column on the comment table, pointing at the
table the form is on. You get the clickable link, the subgrid and cascade
delete back. The cost is one Lookup column per parent table, for example
`insurgo_opportunity` for Opportunity forms and `insurgo_account` for Account
forms. Each form's settings JSON names its own column:

```json
{
  "regardingMode": "lookup",
  "regardingLookupAttribute": "insurgo_opportunity"
}
```

In `"lookup"` mode, comments are found through the Lookup column only. If
you also set `regardingTableAttribute`/`regardingIdAttribute`, they're still
filled in, which is useful for a single view across all parent tables.

Switching an existing field from `"text"` to `"lookup"` doesn't move old
comments. They only have the text columns, so they stop showing until you
fill in their Lookup column (for example with a one-off flow or data
import).

## Dataverse schema to create

Two tables, in your own solution, using whatever publisher prefix you're
standardizing on for this project (the examples above use `insurgo_`):

**Comment table** (e.g. `insurgo_reviewcomment`)
- Primary column (name) — whatever you like, not read by the control
- `insurgo_commenttext` — Multiline Text
- `insurgo_regardingtable` — Single Line of Text (`"text"` mode)
- `insurgo_regardingid` — Single Line of Text, stores a GUID (`"text"` mode)
- One Lookup per parent table, e.g. `insurgo_opportunity` — Lookup to Opportunity (`"lookup"` mode only)
- `insurgo_regardingname` — Single Line of Text (optional, recommended)
- `insurgo_fieldlogicalname` — Single Line of Text (optional; without it the field name goes into the primary name column)
- `insurgo_status` — Choice (Open / Resolved) or Yes/No. Make sure `commentStatusOpenValue`/`commentStatusResolvedValue` match the stored values.
- `insurgo_resolvedon` — Date and Time (optional, recommended)
- `insurgo_resolvedby` — Lookup to User (optional, recommended)

**Assignment table** (e.g. `insurgo_reviewassignment`)
- Primary column (name) — not read by the control
- `insurgo_comment` — Lookup to the comment table
- `insurgo_assignee` — Lookup to User (systemuser)
- `insurgo_regardingtable` / `insurgo_regardingid` — Single Line of Text (optional, for a cross-table "assigned to me" view)

The assignment table only records who is assigned to which comment, one row
per person. It has no status of its own. For a "my open reviews" view, build
a view on the assignment table filtered to assignee = current user, and add a
filter on the related comment's status being Open.

### Moving from the old per-assignee status

Earlier versions kept a status on each assignment row. If you set that up:

- Add the status (and optionally resolved on / resolved by) columns to the
  comment table, and switch the settings JSON to the `commentStatus*` keys.
  The control refuses to load while the old `assignmentStatus*` or
  `assignmentCompletedOnAttribute` keys are still in the JSON, so an outdated
  config can't go unnoticed.
- Existing comments have no comment status yet, so they show as open. Mark
  them resolved in bulk where appropriate.
- The old status columns on the assignment table are no longer read. Delete
  them once you're done migrating.

## Platform caveats worth knowing before you deploy

These are the places this build leans on behaviour that isn't fully
guaranteed by Microsoft's published docs. None of them are exotic — all are
long-standing, widely used patterns in production PCF controls — but they're
worth knowing about rather than discovering at 2am.

1. **Current record detection is undocumented.** A field-bound PCF control
   has no officially documented way to learn its own record's id/table —
   that's only guaranteed for dataset-bound controls. This control uses
   `context.mode.contextInfo` (`entityTypeName`, `entityId`,
   `entityRecordName`), which is not in the published `ComponentFramework`
   typings but is a well-established community workaround used in production
   for years (see `common/dataverseApi.ts`, `getCurrentRecordRef`). If a
   future platform update ever removes it, the documented fallback is parsing
   `etn`/`id` from the page URL — uglier, and explicitly flagged elsewhere as
   fragile, so treat it as a last resort, not a first fix.
2. **Table metadata comes from `context.utils.getEntityMetadata()`,** which
   is untyped in PCF. The control reads `EntitySetName` (for `@odata.bind`
   collection names), `PrimaryIdAttribute` and `PrimaryNameAttribute`, and
   accepts camelCase spellings too. Reading `PrimaryIdAttribute` matters for
   activity tables: a `task` comment table has the key `activityid`, not
   `taskid`. If a table's metadata ever lacks `EntitySetName`, the control
   falls back to its plural name, and shows an error if neither is present.
3. **Lookup values are written through their navigation property,** which
   Dataverse requires for `@odata.bind` and which is case-sensitive. It's
   often not the column's logical name: a custom lookup `tmy_feedbackid`
   is usually `tmy_FeedbackId`, and the task's built-in Regarding pointing
   at Feedback is `regardingobjectid_tmy_feedback_task`. Using the wrong name
   fails with "An undeclared property ... which only has property
   annotations". The control reads the right name from the relationship
   metadata (a direct Web API call, since PCF's `webAPI` can't query
   metadata). If that call fails, it logs a warning in the browser console
   and falls back to the logical name. In that case set the matching
   `*NavigationProperty` setting.
4. **A multi-target `lookupTargets` always gets the native search dialog,**
   regardless of `lookupMode`, and that dialog includes a "+ New" button.
   Merging and labelling candidates from several different tables in one
   dropdown is a bigger feature than this control takes on. Single-target
   lookups get the dropdown by default.
5. **Clearing a value is sent as `undefined` from `getOutputs`** for both the
   Lookup and Choice controls. That's the common community pattern, but
   confirm on a real form that choosing `---` actually clears the stored
   value.

## Building and packaging

From the repo root, `npm install && npm run build` builds all three controls
into `out/controls/`. For packaging into a solution, quick deploys with
`pac pcf push`, and adding the controls to a form, see [BUILD.md](BUILD.md).

## Not built yet

- Notification when someone is assigned (deliberately out of scope — needs a
  plugin or Power Automate flow watching the assignment table, discussed and
  deferred earlier in this project).
- A visual "has an open thread / fully resolved / no comments" state on the
  field itself, distinct from the badge, so a reviewer can scan a form
  without opening every panel.
- Multi-target lookup candidates merged into the dropdown.
