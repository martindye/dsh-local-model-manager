param(
    [Parameter(Mandatory = $true)][string]$LogPath,
    [ValidateSet('Unicode', 'UTF8')][string]$Encoding = 'Unicode'
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $LogPath -PathType Leaf)) {
    throw "Diagnostic log not found: $LogPath"
}
$Host.UI.RawUI.WindowTitle = 'Qwen diagnostics - live log viewer'
Write-Host 'Live diagnostics from the existing Qwen process.'
Write-Host 'Closing this viewer does not stop Qwen.'
Write-Host "Log: $LogPath"
Write-Host ''
Get-Content -LiteralPath $LogPath -Encoding $Encoding -Tail 80 -Wait
