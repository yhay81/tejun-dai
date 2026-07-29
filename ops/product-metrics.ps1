[CmdletBinding()]
param(
    [switch]$Local
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$SqlPath = Join-Path $PSScriptRoot "product-metrics.sql"
$Wrangler = Join-Path $RepoRoot "node_modules\.bin\wrangler.cmd"
$Target = if ($Local) { "--local" } else { "--remote" }
$Sql = (Get-Content $SqlPath) -join " "

$Output = & $Wrangler d1 execute tejun-dai $Target --json --command $Sql
if ($LASTEXITCODE -ne 0) {
    throw "D1 metrics query failed with exit code $LASTEXITCODE"
}

$Payload = ($Output -join [Environment]::NewLine) | ConvertFrom-Json
$Row = $Payload[0].results[0]
if (-not $Row) {
    throw "D1 metrics query returned no result"
}

function Get-Percent {
    param([int]$Numerator, [int]$Denominator)
    if ($Denominator -eq 0) { return $null }
    return [Math]::Round(($Numerator / $Denominator) * 100, 1)
}

$Users = [int]$Row.users
$Starters = [int]$Row.starters
$Editors = [Math]::Max([int]$Row.photo_users, [int]$Row.step_editors)
$Printers = [int]$Row.printers

[ordered]@{
    generated_at = (Get-Date).ToUniversalTime().ToString("o")
    service = "tejun-dai"
    environment = if ($Local) { "local" } else { "production" }
    funnel = [ordered]@{
        users = $Users
        starters = $Starters
        photo_users = [int]$Row.photo_users
        step_editors = [int]$Row.step_editors
        printers = $Printers
        exporters = [int]$Row.exporters
        importers = [int]$Row.importers
        returned = [int]$Row.returned
        editors_7d = [int]$Row.editors_7d
        printers_7d = [int]$Row.printers_7d
    }
    rates = [ordered]@{
        start_percent = Get-Percent $Starters $Users
        editor_percent = Get-Percent $Editors $Users
        print_percent = Get-Percent $Printers $Editors
        export_percent = Get-Percent ([int]$Row.exporters) $Editors
    }
} | ConvertTo-Json -Depth 4
