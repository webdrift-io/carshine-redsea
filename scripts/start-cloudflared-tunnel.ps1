$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$cloudflared = Join-Path $root 'cloudflared.exe'
$stdout = Join-Path $root 'cloudflared-tunnel.log'
$stderr = Join-Path $root 'cloudflared-tunnel.err.log'

Remove-Item -LiteralPath $stdout, $stderr -ErrorAction SilentlyContinue

$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName = $cloudflared
$psi.WorkingDirectory = $root
$psi.Arguments = 'tunnel --url http://127.0.0.1:5000 --no-autoupdate'
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true

$process = [System.Diagnostics.Process]::new()
$process.StartInfo = $psi
$null = $process.Start()
$process.StandardOutput.BaseStream.CopyToAsync([System.IO.File]::Open($stdout, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::ReadWrite)) | Out-Null
$process.StandardError.BaseStream.CopyToAsync([System.IO.File]::Open($stderr, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::ReadWrite)) | Out-Null
"cloudflared pid: $($process.Id)"

Start-Sleep -Seconds 8

if (Test-Path -LiteralPath $stderr) {
  Get-Content -LiteralPath $stderr -Tail 120
}
if (Test-Path -LiteralPath $stdout) {
  Get-Content -LiteralPath $stdout -Tail 40
}
