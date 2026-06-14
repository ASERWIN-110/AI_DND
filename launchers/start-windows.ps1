$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

try {
  $nodeExe = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path (Get-Location) "scripts\bootstrap-node.ps1") -Root (Get-Location)
  if (-not $nodeExe) {
    throw "Could not resolve a Node.js 24+ runtime."
  }
  & $nodeExe scripts\quick-start.mjs @args
  $exitCode = $LASTEXITCODE
} catch {
  Write-Host $_
  $exitCode = 1
}

if ($env:AI_DND_NO_PAUSE -ne "1") {
  Write-Host ""
  Read-Host "Press Enter to close"
}

exit $exitCode
