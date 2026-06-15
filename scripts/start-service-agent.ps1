$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$serviceDir = Join-Path $root 'service-agent'

$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName = 'node'
$psi.Arguments = 'server.js'
$psi.WorkingDirectory = $serviceDir
$psi.UseShellExecute = $true
$psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden

$process = [System.Diagnostics.Process]::Start($psi)
"service-agent pid: $($process.Id)"
Start-Sleep -Seconds 2
