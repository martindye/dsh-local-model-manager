$ErrorActionPreference = 'Stop'
$launch = $env:DSH_LOCAL_MODEL_LAUNCH | ConvertFrom-Json
if (-not $launch.command) { throw 'Model launch command is missing.' }
Remove-Item Env:DSH_LOCAL_MODEL_LAUNCH -ErrorAction SilentlyContinue

# Quote argv for Windows native parsing, including embedded quotes and trailing
# backslashes. These are literal arguments; no command text is evaluated.
function Quote-NativeArgument([string]$value) {
    $result = '"'
    $slashes = 0
    foreach ($char in $value.ToCharArray()) {
        if ($char -eq '\') { $slashes++; continue }
        if ($char -eq '"') {
            $result += ('\' * (2 * $slashes + 1)) + '"'
        } else {
            $result += ('\' * $slashes) + $char
        }
        $slashes = 0
    }
    return $result + ('\' * (2 * $slashes)) + '"'
}

$arguments = @($launch.args | ForEach-Object { Quote-NativeArgument ([string]$_) }) -join ' '
$parameters = @{ FilePath = [string]$launch.command; WindowStyle = 'Normal'; PassThru = $true }
if ($arguments.Length -gt 0) { $parameters.ArgumentList = $arguments }
if ($launch.cwd) { $parameters.WorkingDirectory = [string]$launch.cwd }
$server = Start-Process @parameters
$null = $server.Handle
$server.WaitForExit()
exit $server.ExitCode
