<#
.SYNOPSIS
    Builds the PCF controls, bumps version numbers and packages the Dataverse solution.

.DESCRIPTION
    1. npm install (only if node_modules is missing), then npm run build at the repo root.
       If this fails nothing is bumped, so a compile error never burns a version number.
    2. Bumps the version on every ControlManifest.Input.xml and in Solution/src/Other/Solution.xml.
       Dataverse only picks up a new control bundle when the control version increases.
    3. dotnet build in the Solution folder, producing Solution/bin/<Configuration>/<name>.zip.

.PARAMETER Configuration
    Debug (default) or Release. Release also minifies the control bundles.

.PARAMETER Bump
    Which part of the version to increase: Patch (default), Minor or Major.

.PARAMETER NoBump
    Build and package without changing any version numbers.

.PARAMETER DryRun
    Show the version changes that would be made, without writing files or building.

.EXAMPLE
    .\build.cmd
    .\build.cmd -Configuration Release
    .\build.cmd -Bump Minor
    .\build.cmd -DryRun
#>
[CmdletBinding()]
param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Debug",
    [ValidateSet("Patch", "Minor", "Major")]
    [string]$Bump = "Patch",
    [switch]$NoBump,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$solutionDir = Join-Path $root "Solution"
$solutionXml = Join-Path $solutionDir "src\Other\Solution.xml"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Step([string]$message) {
    Write-Host ""
    Write-Host "==> $message" -ForegroundColor Cyan
}

function Invoke-Checked([string]$command, [string[]]$arguments, [string]$workingDir) {
    Push-Location $workingDir
    try {
        & $command @arguments
        if ($LASTEXITCODE -ne 0) {
            throw "'$command $($arguments -join ' ')' failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
}

# Increases one part of a dotted version and zeroes the parts after it.
# Versions shorter than three parts are padded first, so "1.0" + Patch -> "1.0.1".
function Step-Version([string]$version, [string]$part) {
    $parts = [System.Collections.Generic.List[int]]($version.Split(".") | ForEach-Object { [int]$_ })
    while ($parts.Count -lt 3) { $parts.Add(0) }
    $index = @{ Major = 0; Minor = 1; Patch = 2 }[$part]
    $parts[$index]++
    for ($i = $index + 1; $i -lt $parts.Count; $i++) { $parts[$i] = 0 }
    return ($parts -join ".")
}

# Rewrites the first match of $pattern in $path; group 2 must capture the version.
# A regex edit (rather than an XML round-trip) keeps the file's comments and layout intact.
function Update-VersionInFile([string]$path, [string]$pattern, [string]$label) {
    $text = [System.IO.File]::ReadAllText($path)
    $match = [regex]::Match($text, $pattern)
    if (-not $match.Success) {
        throw "Could not find a version in $path."
    }
    $old = $match.Groups[2].Value
    $new = Step-Version $old $Bump
    Write-Host ("  {0,-28} {1} -> {2}" -f $label, $old, $new)
    if (-not $DryRun) {
        $updated = $text.Substring(0, $match.Groups[2].Index) + $new +
            $text.Substring($match.Groups[2].Index + $match.Groups[2].Length)
        [System.IO.File]::WriteAllText($path, $updated, $utf8NoBom)
    }
}

$manifests = Get-ChildItem -Path $root -Filter "ControlManifest.Input.xml" -Recurse -File |
    Where-Object { $_.FullName -notmatch "\\(node_modules|out|obj|bin)\\" }
if ($manifests.Count -eq 0) { throw "No ControlManifest.Input.xml found under $root." }
if (-not (Test-Path $solutionXml)) { throw "Solution manifest not found: $solutionXml" }

if ($DryRun) {
    Write-Step "Dry run: version changes that would be made ($Bump)"
}
else {
    Write-Step "Building PCF controls (npm run build)"
    if (-not (Test-Path (Join-Path $root "node_modules"))) {
        Invoke-Checked "npm" @("install") $root
    }
    $buildArgs = @("run", "build")
    if ($Configuration -eq "Release") { $buildArgs += @("--", "--buildMode", "production") }
    Invoke-Checked "npm" $buildArgs $root
}

if ($NoBump) {
    Write-Step "Skipping version bump (-NoBump)"
}
else {
    if (-not $DryRun) { Write-Step "Bumping versions ($Bump)" }
    foreach ($manifest in $manifests) {
        Update-VersionInFile $manifest.FullName '(<control\b[^>]*?\sversion=")([^"]+)' $manifest.Directory.Name
    }
    Update-VersionInFile $solutionXml '(<Version>)([^<]+)' "Solution"
}

if ($DryRun) { return }

$buildStarted = Get-Date
Write-Step "Packaging solution (dotnet build -c $Configuration)"
Invoke-Checked "dotnet" @("build", "-c", $Configuration) $solutionDir

# SolutionPackageType "Both" produces two zips (<name>.zip and <name>_managed.zip), so list every fresh one.
$zips = Get-ChildItem -Path (Join-Path $solutionDir "bin\$Configuration") -Filter "*.zip" |
    Where-Object { $_.LastWriteTime -ge $buildStarted }
Write-Step "Done"
foreach ($zip in $zips) { Write-Host "  $($zip.FullName)" -ForegroundColor Green }
