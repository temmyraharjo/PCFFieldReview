# Building and deploying

This repo is a single PCF project containing six controls:
`FieldReviewControl`, `FieldReviewLookupControl`, `FieldReviewChoiceControl`,
`FieldReviewYesNoControl`, `FieldReviewDateControl` and
`FieldReviewPolyLookupControl`.
They always build together. You can't build just one of them.

## Prerequisites

- Node.js (LTS) and npm, for building the controls.
- For packaging or deploying to Dataverse only:
  - [Power Platform CLI](https://learn.microsoft.com/power-platform/developer/cli/introduction) (`pac`)
  - .NET SDK (`dotnet`), or Visual Studio's `msbuild`

## One-step build (recommended)

From the repo root:

```
build.cmd
```

This runs [scripts/build.ps1](scripts/build.ps1), which:

1. Runs `npm install` if `node_modules` is missing, then `npm run build`. If
   the build fails, the script stops before touching any version numbers.
2. Bumps the version of every control (`ControlManifest.Input.xml`) and of
   the solution (`Solution/src/Other/Solution.xml`).
3. Runs `dotnet build` in `Solution/` and prints the path of the zip.

| Option | Effect |
|---|---|
| `-Configuration Release` | Release build with minified bundles (default `Debug`). |
| `-Bump Minor` / `-Bump Major` | Bump that part instead of the patch number. Lower parts reset to 0. |
| `-NoBump` | Build and package without changing versions. |
| `-DryRun` | Only print the version changes that would be made. |

Options combine, e.g. `build.cmd -Configuration Release -Bump Minor`. The
first bump turns the solution's two-part `1.0` into `1.0.1`, after which the
solution and controls move in step. Commit the version changes along with
your code so the next build continues from the right number.

The sections below describe the same steps done by hand.

## Build the controls

From the repo root:

```
npm install
npm run build
```

Output:

```
out/controls/FieldReviewControl/
out/controls/FieldReviewLookupControl/
out/controls/FieldReviewChoiceControl/
out/controls/FieldReviewPolyLookupControl/
```

Each folder contains `bundle.js`, `ControlManifest.xml`, the CSS and the
strings `.resx`.

Other scripts:

| Command | What it does |
|---|---|
| `npm run rebuild` | Clean, then build. |
| `npm run build -- --buildMode production` | Minified bundle for release. |
| `npm start watch` | Local test harness with rebuild on save. Only shows the first control it finds. It isn't connected to Dataverse, so the comment thread and lookup records won't load. |

Build-time ESLint is turned off in `pcfconfig.json` (`skipBuildLinting`)
because the project doesn't ship an ESLint config. To lint during the build,
add an `eslint.config.mjs` and remove that flag.

## Package into a Dataverse solution

Create the solution in its own folder. The repo root is the PCF project
(`FieldReview.pcfproj`), so the solution can't live there too. One reference
brings in all six controls.

```
mkdir Solution
cd Solution
pac solution init --publisher-name Insurgo --publisher-prefix insurgo
pac solution add-reference --path ..
dotnet build
```

This produces `Solution/bin/Debug/InsurgoReviewControls.zip`, a **managed**
solution. Use `dotnet build -c Release` for a release build. Import the zip
into your environment through **Solutions > Import** in make.powerapps.com.

### Managed vs unmanaged

The package type is set by `SolutionPackageType` in
`Solution/InsurgoReviewControls.cdsproj`:

| Value | Output |
|---|---|
| `Managed` (current) | `InsurgoReviewControls.zip`, managed |
| `Unmanaged` | `InsurgoReviewControls.zip`, unmanaged |
| `Both` | `InsurgoReviewControls.zip` (unmanaged) and `InsurgoReviewControls_managed.zip` |

A managed solution can't be edited in the target environment, and deleting
it removes the controls cleanly, so it's the right choice for test and
production. Don't import it into an environment that already has these
controls from an unmanaged import (for example the earlier "Solution"): the
unmanaged copy sits on top and keeps winning, so the new bundles won't show.
Delete the unmanaged solution *and* its controls first, or use a clean
environment.

After importing:

1. Create the two custom tables described in the [README](README.md#dataverse-schema-to-create).
2. On the form, open the field's properties, go to **Components**, and add
   the matching control:
   - Text, Multiple Lines of Text, Whole Number, Currency, Decimal: `Insurgo.FieldReviewControl`
   - Lookup: `Insurgo.FieldReviewLookupControl`
   - Choice: `Insurgo.FieldReviewChoiceControl`
   - Yes/No: `Insurgo.FieldReviewYesNoControl`
   - Date Only, Date and Time: `Insurgo.FieldReviewDateControl`
   - Multi-select (N:N) on a text column: `Insurgo.FieldReviewPolyLookupControl`
     (see [Multi-select (PolyLookup) control](README.md#multi-select-polylookup-control))
3. Set **Review settings (JSON)** to your schema (see the
   [README](README.md#settings-json)), then save and publish the form.
   [Getting started](README.md#getting-started) in the README walks through
   this with screenshots.

## Quick deploy while developing

Use this to push the controls straight into a dev environment without
packaging a solution yourself:

```
pac auth create --url https://<yourorg>.crm.dynamics.com
pac pcf push --publisher-prefix insurgo
```

## Versioning

Before each new import or push, increase the `version` attribute on the
`<control>` element in the relevant `ControlManifest.Input.xml` (for example
`1.0.0` to `1.0.1`). Otherwise Dataverse may keep serving the cached older
bundle. `build.cmd` does this for you; `pac pcf push` doesn't, so bump by
hand (or run `build.cmd -DryRun` to see the current numbers) before pushing.
