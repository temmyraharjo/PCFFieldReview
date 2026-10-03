# Graph Report - .  (2026-10-03)

## Corpus Check
- Corpus is ~16,660 words - fits in a single context window. You may not need a graph.

## Summary
- 214 nodes · 436 edges · 13 communities (10 shown, 3 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 18 edges (avg confidence: 0.86)
- Token cost: 61,265 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Dataverse Web API Layer|Dataverse Web API Layer]]
- [[_COMMUNITY_Field Layout & Lookup Picker|Field Layout & Lookup Picker]]
- [[_COMMUNITY_Review Panel & Data Types|Review Panel & Data Types]]
- [[_COMMUNITY_PolyLookup Control|PolyLookup Control]]
- [[_COMMUNITY_Multi-Picker & Floating UI|Multi-Picker & Floating UI]]
- [[_COMMUNITY_TextNumber Field Control|Text/Number Field Control]]
- [[_COMMUNITY_NPM Package Config|NPM Package Config]]
- [[_COMMUNITY_Build & Packaging Pipeline|Build & Packaging Pipeline]]
- [[_COMMUNITY_CommentAssignment Data Model|Comment/Assignment Data Model]]
- [[_COMMUNITY_Choice & Lookup Controls|Choice & Lookup Controls]]
- [[_COMMUNITY_TypeScript Config|TypeScript Config]]
- [[_COMMUNITY_Project Docs Overview|Project Docs Overview]]
- [[_COMMUNITY_Build Linting Flag|Build Linting Flag]]

## God Nodes (most connected - your core abstractions)
1. `FieldReviewPolyLookupControl` - 21 edges
2. `ReviewSettings` - 19 edges
3. `FieldReviewControl` - 18 edges
4. `FieldReviewChoiceControl` - 11 edges
5. `attachFieldReview()` - 10 edges
6. `FieldReviewLookupControl` - 9 edges
7. `buildFieldLayout()` - 9 edges
8. `parseSettings()` - 9 edges
9. `resolvePolyLookupMetadata()` - 8 edges
10. `webApiFetch()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `FieldReviewControl` --references--> `ReviewSettings`  [EXTRACTED]
  FieldReviewControl/index.ts → common/types.ts
- `FieldReviewPolyLookupControl` --references--> `MultiPicker`  [EXTRACTED]
  FieldReviewPolyLookupControl/index.ts → common/multiPicker.ts
- `FieldReviewPolyLookupControl` --references--> `PolyLookupMetadata`  [EXTRACTED]
  FieldReviewPolyLookupControl/index.ts → common/polyLookupApi.ts
- `FieldReviewPolyLookupControl` --references--> `ReviewSettings`  [EXTRACTED]
  FieldReviewPolyLookupControl/index.ts → common/types.ts
- `Adding controls to form fields` --references--> `FieldReviewPolyLookupControl`  [EXTRACTED]
  BUILD.md → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Four field-family controls built from one PCF project** — readme_fieldreviewcontrol, readme_fieldreviewlookupcontrol, readme_fieldreviewchoicecontrol, readme_fieldreviewpolylookupcontrol, build_single_pcf_project, readme_shared_common_folder [EXTRACTED 1.00]
- **Settings-driven comment/assignment data model** — readme_settings_json, readme_comment_table, readme_assignment_table, readme_regarding_mode, readme_comment_assignment_thread [INFERRED 0.85]
- **Build, version bump and solution packaging pipeline** — build_one_step_build, scripts_build, build_version_bump, build_solution_packaging, build_insurgoreviewcontrols_zip [EXTRACTED 1.00]

## Communities (13 total, 3 thin omitted)

### Community 0 - "Dataverse Web API Layer"
Cohesion: 0.10
Nodes (39): createCommentWithAssignments(), entitySetNameCache, fetchCommentHistory(), fetchLookupCandidates(), getClientUrl(), getCurrentRecordRef(), getCurrentTableName(), navigationPropertyCache (+31 more)

### Community 1 - "Field Layout & Lookup Picker"
Cohesion: 0.09
Nodes (21): countLookupCandidates(), createDropdown(), Dropdown, DropdownItem, DropdownOptions, buildFieldLayout(), FieldLayout, attachFieldReview() (+13 more)

### Community 2 - "Review Panel & Data Types"
Cohesion: 0.13
Nodes (16): getCurrentUserId(), resolveComment(), buildReviewPanel(), el(), icon(), PanelOptions, REMOVED_KEYS, REQUIRED_KEYS (+8 more)

### Community 3 - "PolyLookup Control"
Cohesion: 0.21
Nodes (3): PolyLookupItem, PolyLookupOutput, FieldReviewPolyLookupControl

### Community 4 - "Multi-Picker & Floating UI"
Cohesion: 0.15
Nodes (14): FieldRowOptions, svg(), makeFloating(), placeFixed(), createMultiPicker(), MultiPicker, MultiPickerItem, MultiPickerOptions (+6 more)

### Community 6 - "NPM Package Config"
Cohesion: 0.12
Nodes (16): description, devDependencies, pcf-scripts, pcf-start, @types/node, @types/powerapps-component-framework, typescript, name (+8 more)

### Community 7 - "Build & Packaging Pipeline"
Cohesion: 0.16
Nodes (11): InsurgoReviewControls.zip, Managed vs Unmanaged Solution (SolutionPackageType), One-step build (build.cmd), Power Platform CLI (pac), Quick deploy with pac pcf push, Single PCF Project (FieldReview.pcfproj), Package into Dataverse Solution, Control and Solution Version Bumping (+3 more)

### Community 8 - "Comment/Assignment Data Model"
Cohesion: 0.36
Nodes (8): Adding controls to form fields, Local test harness (npm start watch), Assignment table (insurgo_reviewassignment), Field comment/assignment thread, Migration from per-assignee status to comment status, Comment table (insurgo_reviewcomment), regardingMode (text vs lookup), Review settings (JSON)

### Community 9 - "Choice & Lookup Controls"
Cohesion: 0.33
Nodes (7): Clearing value via undefined from getOutputs, FieldReviewChoiceControl, FieldReviewLookupControl, lookupMode (simple/search/auto), Multi-target lookup forces native search dialog, Not built yet (assignment notification, field state, view search), Shared dropdown (common/dropdown.ts)

### Community 10 - "TypeScript Config"
Cohesion: 0.33
Nodes (5): compilerOptions, typeRoots, exclude, extends, include

## Knowledge Gaps
- **44 isolated node(s):** `ScalarValue`, `Metadata`, `NUMBER_TYPE_CODES`, `TEXT_TYPE_CODES`, `Metadata` (+39 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ReviewSettings` connect `Field Layout & Lookup Picker` to `Dataverse Web API Layer`, `Review Panel & Data Types`, `PolyLookup Control`, `Multi-Picker & Floating UI`, `Text/Number Field Control`?**
  _High betweenness centrality (0.190) - this node is a cross-community bridge._
- **Why does `FieldReviewControl` connect `Text/Number Field Control` to `Field Layout & Lookup Picker`?**
  _High betweenness centrality (0.090) - this node is a cross-community bridge._
- **Why does `FieldReviewPolyLookupControl` connect `PolyLookup Control` to `Dataverse Web API Layer`, `Field Layout & Lookup Picker`, `Multi-Picker & Floating UI`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **What connects `ScalarValue`, `Metadata`, `NUMBER_TYPE_CODES` to the rest of the system?**
  _50 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Dataverse Web API Layer` be split into smaller, more focused modules?**
  _Cohesion score 0.10409745293466224 - nodes in this community are weakly interconnected._
- **Should `Field Layout & Lookup Picker` be split into smaller, more focused modules?**
  _Cohesion score 0.08970099667774087 - nodes in this community are weakly interconnected._
- **Should `Review Panel & Data Types` be split into smaller, more focused modules?**
  _Cohesion score 0.12857142857142856 - nodes in this community are weakly interconnected._