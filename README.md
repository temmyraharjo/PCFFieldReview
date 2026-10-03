# Insurgo Field Review — PCF controls

Six PCF field controls that add a "+" comment/assignment thread to a field on a
model-driven form: reviewers can comment on a field and assign the comment to
multiple people. Each comment is open until any one of its assignees marks it
resolved, which resolves it for everyone. The full history is visible to all.

## Why several controls, not one

A single bound property can only declare one `<type-group>`, and while the
manifest schema docs describe resolvable type-groups for scalar families
(strings, numbers, dates), they do not document — and don't rule out — mixing
`Lookup.Simple` or `OptionSet` into a group with scalar types. (`pcf-scripts`
accepts either at build time, but only by falling back to an untyped
`Property`, so a passing build doesn't prove the platform binds it at
runtime.) Rather than gamble on
unconfirmed platform behaviour for something this foundational, this project
ships one control per field family, built together from a single PCF project:

- **FieldReviewControl** — bind to a Single Line of Text, Multiple Lines of
  Text, Whole Number, Currency or Decimal field. Editable input: text respects
  the column's max length; multi-line text gets a text area that grows with
  its content up to a cap, then scrolls; numbers show formatted (e.g.
  `$1,250.00`), switch to the plain number while typing, and are checked
  against the column's min/max and decimal places. A Multiple Lines of Text
  column in **rich text** format shows read-only: a plain text area would
  expose and could rewrite its formatting.
- **FieldReviewLookupControl** — bind to a Lookup field. Same comment thread,
  plus an editable dropdown of existing records. There's no way to create a
  record from the field unless `lookupAllowCreate` is set (see below).
- **FieldReviewChoiceControl** — bind to a Choice (option set) field. Same
  comment thread, plus an editable dropdown of the field's options.
- **FieldReviewYesNoControl** — bind to a Yes/No (two options) field. Same
  dropdown as the Choice control, showing the column's own two labels.
- **FieldReviewDateControl** — bind to a Date Only or Date and Time field.
  Shows the date in the user's own format and switches to the browser's date
  (and time) picker while editing. See caveat 8 on time zones.
- **FieldReviewPolyLookupControl** — a multi-select lookup in the style of
  [DCE PolyLookup](https://github.com/khoait/DCE.PCF/wiki/PolyLookup), with the
  same comment thread. Bind it to a text column that hosts it; the selection
  lives in an N:N, custom N:N or Connection relationship. See
  [Multi-select (PolyLookup) control](#multi-select-polylookup-control).

The Lookup, Choice and Yes/No controls render the value with the same
dropdown (`common/dropdown.ts`), so those field types look and behave the same
on the form: a plain list with a `---` entry for "no value", disabled when the form
or field is read-only.

All editors, including the text/number input, become read-only only when the
field is disabled: by the form, a business rule, a script
(`setDisabled(true)`), or column security.

All of them import the same logic from the root `common/` folder (settings parsing,
the shared control setup, the comment/assignment Web API calls, the panel UI,
the lookup pickers) via `../common/...`. There is one copy, and webpack
bundles it into each control's `bundle.js` separately. The one stylesheet,
`common/css/FieldReview.css`, is referenced by every manifest and copied into
each control's output by the build.

```
FieldReview.pcfproj        one PCF project, referenced by the solution
package.json / tsconfig    shared toolchain
pcfconfig.json             output dir; build-time ESLint skipped (no config shipped)
common/                    shared TypeScript and the one stylesheet (css/) used by all controls
FieldReviewControl/        manifest, index.ts, strings
FieldReviewLookupControl/  manifest, index.ts, strings
FieldReviewChoiceControl/  manifest, index.ts, strings
FieldReviewYesNoControl/   manifest, index.ts, strings
FieldReviewDateControl/    manifest, index.ts, strings
FieldReviewPolyLookupControl/  manifest, index.ts, strings
```

A single `npm install && npm run build` at the root builds all six controls
into `out/controls/<ControlName>/` (verified). You don't need the `pac` CLI
for that step. You need the Power Platform CLI only to package or push the
compiled controls into a solution.

## Settings JSON

All controls take one input property, **Review settings (JSON)**, configured
per field instance in the form designer. Nothing about your table/column
naming is hardcoded, so the same compiled control works across environments
and clients with different publisher prefixes.

### Which control for which column

| Column type on the form | Control to add | Extra keys on top of the shared ones |
|---|---|---|
| Single Line of Text, Multiple Lines of Text, Whole Number, Currency, Decimal | FieldReviewControl | none |
| Choice | FieldReviewChoiceControl | none |
| Yes/No | FieldReviewYesNoControl | none |
| Date Only, Date and Time | FieldReviewDateControl | none |
| Lookup | FieldReviewLookupControl | `lookupTargets` (required), optional `lookup*` keys |
| Several related records (N:N, custom intersect table, Connection) | FieldReviewPolyLookupControl, bound to a text column | `polyLookup*` keys |

Multi-select Choices, File and Image columns are **not supported**: no
control binds to them, so they won't appear in the form designer's control
list for those fields. Multiple Lines of Text in rich text format can be
bound but shows read-only.

### Text, number, Choice, Yes/No and date fields

These need only the shared comment/assignment keys, so the same JSON works on
any Text, Multiple Lines of Text, Whole Number, Currency, Decimal, Choice,
Yes/No or date field. A complete example:

```json
{
  "commentTable": "ins_reviewcomment",
  "commentTextAttribute": "ins_commenttext",
  "regardingMode": "text",
  "regardingTableAttribute": "ins_regardingtable",
  "regardingIdAttribute": "ins_regardingid",
  "regardingNameAttribute": "ins_regardingname",
  "fieldReferenceAttribute": "ins_fieldlogicalname",
  "commentStatusAttribute": "ins_status",
  "commentStatusOpenValue": 100000000,
  "commentStatusResolvedValue": 100000001,
  "commentResolvedOnAttribute": "ins_resolvedon",
  "commentResolvedByAttribute": "ins_resolvedby",

  "assignmentTable": "ins_reviewassignment",
  "assignmentCommentLookupAttribute": "ins_comment",
  "assignmentUserLookupAttribute": "ins_assignee",
  "assignmentRegardingTableAttribute": "ins_regardingtable",
  "assignmentRegardingIdAttribute": "ins_regardingid"
}
```

That example links each comment to its record with `"regardingMode": "text"`:
two plain text columns hold the record's table name and GUID, so one comment
table serves every table with no schema change. With `"regardingMode":
"lookup"`, a real Lookup column on the comment table points at the form's
table instead, which adds a comments subgrid on the parent form, a clickable
record name in views, and cascade delete, at the cost of one Lookup column per
parent table. The same settings in `"lookup"` mode, for a field on an
Opportunity form:

```json
{
  "commentTable": "ins_reviewcomment",
  "commentTextAttribute": "ins_commenttext",
  "regardingMode": "lookup",
  "regardingLookupAttribute": "ins_opportunity",
  "regardingNameAttribute": "ins_regardingname",
  "fieldReferenceAttribute": "ins_fieldlogicalname",
  "commentStatusAttribute": "ins_status",
  "commentStatusOpenValue": 100000000,
  "commentStatusResolvedValue": 100000001,
  "commentResolvedOnAttribute": "ins_resolvedon",
  "commentResolvedByAttribute": "ins_resolvedby",

  "assignmentTable": "ins_reviewassignment",
  "assignmentCommentLookupAttribute": "ins_comment",
  "assignmentUserLookupAttribute": "ins_assignee"
}
```

Here `regardingTableAttribute` and `regardingIdAttribute` are optional: set
them too and they're still filled in, which helps a single view across all
parent tables. The assignment table's `assignmentRegarding*` copies are left
out because "my open reviews" can follow the comment's Lookup instead. See
[Linking comments to the parent record](#linking-comments-to-the-parent-record)
for switching an existing field between modes.

The bare minimum, with a Yes/No status column, the label drawn by the control
and the panel opening next to the field:

```json
{
  "renderLabel": true,
  "labelWidth": "180px",
  "panelPlacement": "field",

  "commentTable": "ins_reviewcomment",
  "commentTextAttribute": "ins_commenttext",
  "regardingTableAttribute": "ins_regardingtable",
  "regardingIdAttribute": "ins_regardingid",
  "commentStatusAttribute": "ins_isresolved",
  "commentStatusOpenValue": false,
  "commentStatusResolvedValue": true,

  "assignmentTable": "ins_reviewassignment",
  "assignmentCommentLookupAttribute": "ins_comment",
  "assignmentUserLookupAttribute": "ins_assignee"
}
```

### Samples by field type

The keys don't change with the field type, so any example above works on any
of these fields. These complete samples each pair a field type with a typical
setup, using the column names from [Dataverse schema to create](#dataverse-schema-to-create).

A **Multiple Lines of Text** field (e.g. Description), several assignees per
comment, panel centred on screen:

```json
{
  "commentTable": "ins_reviewcomment",
  "commentTextAttribute": "ins_commenttext",
  "regardingTableAttribute": "ins_regardingtable",
  "regardingIdAttribute": "ins_regardingid",
  "regardingNameAttribute": "ins_regardingname",
  "fieldReferenceAttribute": "ins_fieldlogicalname",
  "commentStatusAttribute": "ins_status",
  "commentStatusOpenValue": 100000000,
  "commentStatusResolvedValue": 100000001,
  "commentResolvedOnAttribute": "ins_resolvedon",
  "commentResolvedByAttribute": "ins_resolvedby",

  "assignmentTable": "ins_reviewassignment",
  "assignmentCommentLookupAttribute": "ins_comment",
  "assignmentUserLookupAttribute": "ins_assignee"
}
```

A **Yes/No** field (e.g. Do Not Email), one assignee per comment stored as the
comment's owner, label drawn by the control (hide the form's own label):

```json
{
  "renderLabel": true,
  "labelWidth": "180px",

  "commentTable": "ins_reviewcomment",
  "commentTextAttribute": "ins_commenttext",
  "regardingTableAttribute": "ins_regardingtable",
  "regardingIdAttribute": "ins_regardingid",
  "fieldReferenceAttribute": "ins_fieldlogicalname",
  "commentStatusAttribute": "ins_status",
  "commentStatusOpenValue": 100000000,
  "commentStatusResolvedValue": 100000001,
  "commentResolvedOnAttribute": "ins_resolvedon",

  "assignmentMode": "lookup",
  "commentAssigneeAttribute": "ownerid"
}
```

A **Date Only** or **Date and Time** field (e.g. Est. Close Date) on an
Opportunity form, comments linked to the opportunity through a real Lookup
column, panel opening next to the field:

```json
{
  "panelPlacement": "field",

  "commentTable": "ins_reviewcomment",
  "commentTextAttribute": "ins_commenttext",
  "regardingMode": "lookup",
  "regardingLookupAttribute": "ins_opportunity",
  "regardingNameAttribute": "ins_regardingname",
  "fieldReferenceAttribute": "ins_fieldlogicalname",
  "commentStatusAttribute": "ins_status",
  "commentStatusOpenValue": 100000000,
  "commentStatusResolvedValue": 100000001,
  "commentResolvedOnAttribute": "ins_resolvedon",
  "commentResolvedByAttribute": "ins_resolvedby",

  "assignmentTable": "ins_reviewassignment",
  "assignmentCommentLookupAttribute": "ins_comment",
  "assignmentUserLookupAttribute": "ins_assignee"
}
```

### Lookup fields

The Lookup control needs everything above plus `lookupTargets`, the table(s)
the Lookup points to. A complete example for a Lookup to Account, showing a
dropdown of active accounts:

```json
{
  "commentTable": "ins_reviewcomment",
  "commentTextAttribute": "ins_commenttext",
  "regardingTableAttribute": "ins_regardingtable",
  "regardingIdAttribute": "ins_regardingid",
  "commentStatusAttribute": "ins_status",
  "commentStatusOpenValue": 100000000,
  "commentStatusResolvedValue": 100000001,

  "assignmentTable": "ins_reviewassignment",
  "assignmentCommentLookupAttribute": "ins_comment",
  "assignmentUserLookupAttribute": "ins_assignee",

  "lookupTargets": ["account"],
  "lookupMode": "simple",
  "lookupCandidateFilter": "statecode eq 0"
}
```

Variations: replace the `lookup*` keys at the end with one of these.

Dropdown plus a "+ New record" entry (quick create):

```json
{
  "lookupTargets": ["contact"],
  "lookupAllowCreate": true
}
```

Always the native lookup dialog, opening on a saved view (put your view's GUID in `lookupSearchDefaultViewId`):

```json
{
  "lookupTargets": ["account"],
  "lookupMode": "search",
  "lookupSearchDefaultViewId": "00000000-0000-0000-00aa-000010001001"
}
```

Dropdown for short lists, native dialog once there are more than 50 records:

```json
{
  "lookupTargets": ["ins_category"],
  "lookupMode": "auto",
  "lookupAutoThreshold": 50,
  "lookupCandidateFilter": "statecode eq 0"
}
```

A Lookup that can point to several tables (always uses the native dialog,
see caveat 4):

```json
{
  "lookupTargets": ["account", "contact"]
}
```

For a multi-select field, see
[Multi-select (PolyLookup) control](#multi-select-polylookup-control).

### All keys

| Key | Required | Purpose |
|---|---|---|
| `renderLabel` | no | `true` draws the field label inside the control with the "+" and comment badge next to it. A control can't draw into the form's own label, so **hide the form label** for that field (field properties > "Hide label") when you turn this on. Default `false`: the "+" sits after the value. |
| `labelWidth` | no | Width of the label drawn by `renderLabel`, as a CSS length, e.g. `"180px"`. Match it to the other labels on the form. Default `"160px"`. |
| `panelPlacement` | no | Where the comment panel opens: `"field"` (default) below the "+" or badge that was clicked (above it when there's more room there), or `"center"` of the screen. See [The comment panel](#the-comment-panel). |
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
| `assignmentMode` | no | Where assignees are stored: `"table"` (default), one row per assignee in `assignmentTable`, so a comment can have several; or `"lookup"`, one assignee in a Lookup-to-User column on the comment table. See [One assignee per comment](#one-assignee-per-comment). |
| `commentAssigneeAttribute` | `"lookup"` assignment mode | Lookup-to-User column on the comment table holding the assignee, e.g. `ownerid`. |
| `commentAssigneeNavigationProperty` | no | Override for `commentAssigneeAttribute`'s navigation property. Normally not needed (see caveat 3). |
| `assignmentTable` | `"table"` assignment mode | Logical name of the child table storing one row per assignee. |
| `assignmentCommentLookupAttribute` | `"table"` assignment mode | Column on the assignment table: the Lookup back to the parent comment row. |
| `assignmentUserLookupAttribute` | `"table"` assignment mode | Column on the assignment table: the Lookup to `systemuser` (the assignee). |
| `assignmentCommentNavigationProperty` / `assignmentUserNavigationProperty` | no | Overrides for those two lookups' navigation properties. Normally not needed (see caveat 3). |
| `assignmentRegardingTableAttribute` / `assignmentRegardingIdAttribute` | no | Denormalized copies of the regarding info directly on the assignment row, for a cross-table "assigned to me" view. |
| `lookupTargets` | Lookup control only | Array of target table logical names. Not derivable from PCF metadata — must be listed explicitly. More than one entry (a polymorphic-style lookup) always forces the native search dialog; see below. |
| `lookupMode` | Lookup control only | `"simple"` (default): the plain dropdown, same as the Choice control. `"search"`: the native lookup dialog, which always has its own "+ New" button that this control can't hide. `"auto"`: dropdown up to `lookupAutoThreshold` candidates, the native dialog above that. |
| `lookupAllowCreate` | Lookup control only | `true` adds a "+ New record" entry to the dropdown that opens the target table's quick create form and selects the saved record. Default `false`: existing records only. |
| `lookupAutoThreshold` | Lookup control only | Candidate-count cutoff for `"auto"`. Default 25. |
| `lookupCandidateFilter` | Lookup control only | Optional OData `$filter` fragment scoping candidates (used by both the dropdown and the auto-mode count check). The dropdown lists at most 100 records, sorted by name; use this filter to keep the list short. The current value always stays in the list even if the filter excludes it. |
| `lookupSearchDefaultViewId` | Lookup control only | Saved view GUID passed as the native dialog's default view. |
| `polyLookupRelationshipType` | PolyLookup only | `"manyToMany"` (default), `"custom"` or `"connection"`. See [Multi-select (PolyLookup) control](#multi-select-polylookup-control). |
| `polyLookupRelationshipName` | PolyLookup only | Relationship **schema name** (not the intersect table name). `"manyToMany"`: the N:N relationship. `"custom"`: the 1:N from this table to the intersect table. `"connection"`: the "connected from" relationship, e.g. `account_connections1`. |
| `polyLookupRelationship2Name` | PolyLookup, `"custom"`/`"connection"` | `"custom"`: the N:1 from the intersect table to the table you pick from. `"connection"`: the "connected to" relationship, e.g. `contact_connections2`. |
| `polyLookupItemLimit` | no | PolyLookup only. Maximum number of selected records. Default: no limit. |
| `polyLookupOutput` | no | PolyLookup only. What to write to the bound text column when the selection changes: `"none"` (default), `"text"` (comma-separated names, cut to the column's max length) or `"json"` (`[{"id","name","etn"}]`, the same shape as DCE PolyLookup). `"json"` is also what enables picking on a create form. |

The PolyLookup control also reads `lookupCandidateFilter` (an OData `$filter`
limiting which records are offered) and `lookupAllowCreate` (a "+ New record"
entry that opens the quick create form and selects the saved record).

### The comment panel

The panel opens over the form (it's attached to the page, not the field, so
the form's field cell can't clip it). Only the comment history scrolls inside
it: the current value, the compose box, the assignee picker and the
Cancel/Assign buttons always show in full. By default the panel goes below the
"+", or above it if it only fits there, and shrinks the history first to make
it fit. Only when there isn't room for even that on either side does the whole
panel scroll. Set `panelPlacement: "center"` to open it in the middle of the
screen instead.

The panel follows the field while the form scrolls. Scrolling, including
dragging a scrollbar, doesn't close it. Clicking anywhere else on the form,
the X or Cancel does.

### One assignee per comment

By default a comment can be assigned to several people, each stored as a row
in the assignment table. If one person is always enough, set
`assignmentMode` to `"lookup"` and name a Lookup-to-User column on the comment
table itself. The assignment table and its keys aren't needed then:

```json
{
  "assignmentMode": "lookup",
  "commentAssigneeAttribute": "ownerid"
}
```

(merged into the usual comment keys, without the `assignment*` ones). The
assignee picker then holds one person, and picking someone else replaces
them. Assign still needs someone picked. The assignee is the one who can mark
the comment resolved, as in `"table"` mode.

Things to know when the column is `ownerid`:

- Setting the owner assigns the record, so reviewers need the **Assign**
  privilege on the comment table, or posting fails.
- The picker offers users only. If a comment is later reassigned to a team,
  the thread shows the team's name and nobody can mark it resolved from the
  control.
- A "my open reviews" view becomes a plain view on the comment table:
  owner = current user and status = Open.

Switching a field between `"table"` and `"lookup"` doesn't move existing
assignments. Comments created under `"table"` mode keep their assignment rows,
but `"lookup"` mode reads the comment's own column instead: with a dedicated
column they show no assignee, and with `ownerid` they show their owner
(usually whoever wrote the comment) as the assignee, who can then resolve
them while the original assignees can't.

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
`ins_opportunity` for Opportunity forms and `ins_account` for Account
forms. Each form's settings JSON names its own column:

```json
{
  "regardingMode": "lookup",
  "regardingLookupAttribute": "ins_opportunity"
}
```

In `"lookup"` mode, comments are found through the Lookup column only. If
you also set `regardingTableAttribute`/`regardingIdAttribute`, they're still
filled in, which is useful for a single view across all parent tables.

Switching an existing field from `"text"` to `"lookup"` doesn't move old
comments. They only have the text columns, so they stop showing until you
fill in their Lookup column (for example with a one-off flow or data
import).

## Multi-select (PolyLookup) control

`FieldReviewPolyLookupControl` lets users pick several records, shown as
tags, with the same "+" review thread as the other controls. It follows the
model of [DCE PolyLookup](https://github.com/khoait/DCE.PCF/wiki/PolyLookup):

- **Bind it to a text column** (Single Line of Text, Text Area or Multiple
  Lines of Text) on the form, e.g. a new `ins_categories` column. That
  column hosts the control and names its review thread, so comments are filed
  under its logical name. It doesn't hold the selection. Use `polyLookupOutput`
  if you also want the selection copied into it.
- **The selection lives in a relationship,** and each add or remove is saved
  right away through the Web API, independently of the form's Save button:

| `polyLookupRelationshipType` | Tables | Adding a tag | Removing a tag |
|---|---|---|---|
| `"manyToMany"` | Native N:N, e.g. Course ⟷ Category | Associates the two records | Disassociates them |
| `"custom"` | Your own intersect table, e.g. Student → Enrollment ← Class | Creates an intersect row | Deletes the intersect row(s) |
| `"connection"` | The built-in Connection table | Creates a connection | Deletes the connection |

Example, for a native N:N between Opportunity and a custom Category table:

```json
{
  "polyLookupRelationshipType": "manyToMany",
  "polyLookupRelationshipName": "ins_opportunity_category",
  "lookupCandidateFilter": "statecode eq 0",
  "polyLookupItemLimit": 10
}
```

(merged into the usual comment/assignment keys). For a custom intersect table:

```json
{
  "polyLookupRelationshipType": "custom",
  "polyLookupRelationshipName": "ins_opportunity_enrollment",
  "polyLookupRelationship2Name": "ins_class_enrollment"
}
```

How it behaves:

- Typing searches the target table's primary name ("contains"), within
  `lookupCandidateFilter`. The list shows up to 50 matches, sorted by name,
  and says when more exist. Records that are already selected are left out.
  Arrow keys and Enter pick from the list.
- Clicking a tag's name opens that record.
- Read-only when the field is disabled (form, business rule, script, or
  column security), like the other controls.
- The selection is copied into the bound column only when the user changes
  it, so opening a record never marks the form as modified. With
  `polyLookupOutput` set, each change does mark it modified (the
  relationship itself is already saved).

**Create forms.** Records can't be related until the current record exists.
With the default settings, the picker says "Save the record to select items"
and turns on after the first save. With `polyLookupOutput: "json"`, users can
pick on the create form: the choices are written to the bound column as JSON,
and a plugin you register on Create (post-operation) must read that JSON and
make the associations. The JSON shape matches DCE PolyLookup, so its
[sample plugin](https://github.com/khoait/DCE.PCF/blob/main/Samples/DCE.PCF/DCE.PCF.Plugins/AssociatePolyLookup.cs)
is a starting point. After the save, the control reloads the selection from
the relationship.

## Dataverse schema to create

Two tables, in your own solution, using whatever publisher prefix you're
standardizing on for this project (the examples above use `ins_`):

**Comment table** (e.g. `ins_reviewcomment`)
- Primary column (name) — whatever you like, not read by the control
- `ins_commenttext` — Multiline Text
- `ins_regardingtable` — Single Line of Text (`"text"` mode)
- `ins_regardingid` — Single Line of Text, stores a GUID (`"text"` mode)
- One Lookup per parent table, e.g. `ins_opportunity` — Lookup to Opportunity (`"lookup"` mode only)
- `ins_regardingname` — Single Line of Text (optional, recommended)
- `ins_fieldlogicalname` — Single Line of Text (optional; without it the field name goes into the primary name column)
- `ins_status` — Choice (Open / Resolved) or Yes/No. Make sure `commentStatusOpenValue`/`commentStatusResolvedValue` match the stored values.
- `ins_resolvedon` — Date and Time (optional, recommended)
- `ins_resolvedby` — Lookup to User (optional, recommended)

**Assignment table** (e.g. `ins_reviewassignment`)
- Primary column (name) — not read by the control
- `ins_comment` — Lookup to the comment table
- `ins_assignee` — Lookup to User (systemuser)
- `ins_regardingtable` / `ins_regardingid` — Single Line of Text (optional, for a cross-table "assigned to me" view)

The assignment table is only needed in the default `"table"` assignment
mode; with `assignmentMode: "lookup"` the assignee is a column on the comment
table instead (see [One assignee per comment](#one-assignee-per-comment)).
It only records who is assigned to which comment, one row
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

6. **The PolyLookup control reads relationship metadata and sends N:N
   associate/disassociate (`$ref`) requests with direct Web API calls,** since
   PCF's `webAPI` can do neither. They go to the same origin as the form, like
   the navigation-property lookup in caveat 3. Custom and Connection
   relationships use `webAPI.createRecord`/`deleteRecord` on the intersect
   table. Users need the matching Append/Append To privileges (and create /
   delete on a custom intersect table); if they lack them, the error shows
   under the control and the tag isn't added or removed.
7. **The PolyLookup's bound column uses a `SingleLine.Text` /
   `SingleLine.TextArea` / `Multiple` type-group.** That's a documented
   same-family group, and the one DCE PolyLookup ships with.
8. **Date time zones follow community-documented behaviour.** Microsoft
   documents how each Date and Time behaviour is stored, but not the value a
   PCF control receives. The date control treats a **User Local** value as a
   UTC instant shown in the user's Dataverse time zone (not the browser's),
   and **Date Only** and **Time Zone Independent** values as the stored date
   and time unchanged (`common/dateValue.ts`). Before relying on it, check a
   date of each behaviour on a real form with the browser's time zone set
   differently from the user's: what the control shows and saves should match
   the native field.
9. **Choosing `---` on a Yes/No field** sends an empty value. Most Yes/No
   columns always hold a value, so the platform may keep or restore the
   column's default instead; the dropdown then shows what was kept.

## Building and packaging

From the repo root, `npm install && npm run build` builds all six controls
into `out/controls/`. For packaging into a solution, quick deploys with
`pac pcf push`, and adding the controls to a form, see [BUILD.md](BUILD.md).
