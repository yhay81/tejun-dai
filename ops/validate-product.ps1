[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$WorkerPath = Join-Path $RepoRoot "src\worker.tsx"
$MigrationPath = Join-Path $RepoRoot "migrations\0001_events.sql"
$AppPath = Join-Path $RepoRoot "public\app.js"
$StylesPath = Join-Path $RepoRoot "public\styles.css"
$PublicDirectory = Join-Path $RepoRoot "public"

$RequiredFiles = @(
    ".github\workflows\ci.yml",
    "DECISIONS.md",
    "EXPERIMENT.md",
    "METRICS.md",
    "PRIVACY.md",
    "README.md",
    "SECURITY.md",
    "STACK.md",
    "public\app.js",
    "public\favicon.svg",
    "public\manifest.webmanifest",
    "public\styles.css",
    "public\og.svg",
    "public\robots.txt",
    "public\sitemap.xml"
)
foreach ($RelativePath in $RequiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot $RelativePath))) {
        throw "Missing required release file: $RelativePath"
    }
}

$Worker = Get-Content -Raw -LiteralPath $WorkerPath
$Migration = Get-Content -Raw -LiteralPath $MigrationPath
$App = Get-Content -Raw -LiteralPath $AppPath
$Styles = Get-Content -Raw -LiteralPath $StylesPath
$ProductSurface = @($Worker, $App) -join "`n"

if (-not $Worker.Contains('class="workbench"') -or
    -not $Worker.Contains('class="manual-paper"') -or
    -not $Worker.Contains('class="photo-drop"') -or
    -not $Worker.Contains('class="data-flow"')) {
    throw "Expected the workbench, A4 paper, photo station, and privacy data flow"
}
if ($ProductSurface -match '(?i)public validation|success criteria|experiment|仮説|成功条件|市場スコア|移行候補|収益性') {
    throw "Research copy must not appear on the product surface"
}
if ($Styles -match '(?s)h1\s*\{[^}]*font-size:\s*(?:[4-9]\d|[1-9]\d{2})px') {
    throw "Primary heading is too large"
}
if ($App -match '(?i)innerHTML|eval\(|new Function') {
    throw "User content must not be interpreted as markup or code"
}
if (-not $App.Contains('fetch("/api/events"') -or
    ([regex]::Matches($App, '(?i)\bfetch\s*\(').Count -ne 1)) {
    throw "The editor may send only anonymous product events"
}
if (-not $App.Contains("localStorage") -or
    -not $App.Contains("createImageBitmap") -or
    -not $App.Contains("canvas.toBlob") -or
    -not $App.Contains("const maximumSteps = 12") -or
    -not $App.Contains(".tejundai") -or
    -not $App.Contains("window.print()")) {
    throw "Expected local editing, client-side image reduction, bounded steps, export, and print"
}
if (-not $Styles.Contains("@page") -or
    -not $Styles.Contains("size: A4") -or
    -not $Styles.Contains("@media print")) {
    throw "Expected an explicit A4 print contract"
}
if (-not $Worker.Contains("enforceSameOrigin") -or
    -not $Worker.Contains("45 * 86400") -or
    -not $Worker.Contains("DELETE FROM product_events WHERE created_at <= ?")) {
    throw "Expected same-origin telemetry and bounded event retention"
}
if ($Migration -match '(?i)\b(photo|manual_body|step_body|title|company|email|phone|filename|image_size)\b') {
    throw "Photos, procedure content, identity, and file metadata do not belong in telemetry"
}
if (-not $Migration.Contains("is_qa") -or
    -not $Migration.Contains("CHECK(name IN")) {
    throw "Expected allowlisted events and a QA boundary"
}
if ($Worker -match '(?i)better-auth|betterAuth') {
    throw "Account authentication is not needed for this local-first release"
}

$OgPath = Join-Path $PublicDirectory "og.svg"
if ((Get-Item -LiteralPath $OgPath).Length -lt 2500) {
    throw "Expected a product-specific OG SVG larger than 2.5 KB"
}

$KeyFiles = @(
    Get-ChildItem -LiteralPath $PublicDirectory -File |
        Where-Object { $_.Name -match "^[a-zA-Z0-9-]{8,128}\.txt$" }
)
if ($KeyFiles.Count -ne 1) {
    throw "Expected exactly one generated IndexNow key file, found $($KeyFiles.Count)"
}
$Key = (Get-Content -Raw -LiteralPath $KeyFiles[0].FullName).Trim()
if ($Key -ne $KeyFiles[0].BaseName) {
    throw "IndexNow key file name and content do not match"
}

Write-Output "Product release contract is satisfied"
