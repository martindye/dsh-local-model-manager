param(
    [Parameter(Mandatory = $true)][string]$StartScript,
    [Parameter(Mandatory = $true)][long]$ContextSize
)

$ErrorActionPreference = 'Stop'
if ($ContextSize -le 0) { throw 'ContextSize must be positive.' }
$scriptFile = Get-Item -LiteralPath $StartScript -ErrorAction Stop
if ($scriptFile.PSIsContainer) { throw 'StartScript must be a file.' }

# Start-Process supplies a real console with unredirected diagnostic output.
# Its arguments are file paths and a validated integer, never a shell command.
$launchArgs = @('-NoProfile', '-File', ('"' + $scriptFile.FullName + '"'), '-ContextSize', [string]$ContextSize)
$server = Start-Process -FilePath 'powershell.exe' -ArgumentList $launchArgs -WindowStyle Normal -PassThru
$server.WaitForExit()
$server.Refresh()
exit $server.ExitCode
