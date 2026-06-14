param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"
$NodeMajorMin = 24
$RuntimeDir = Join-Path $Root ".runtime\node"
$RuntimeNode = Join-Path $RuntimeDir "node.exe"
$DownloadsDir = Join-Path $Root ".runtime\downloads"

function Test-NodeOk {
  param([string]$NodeExe)
  if (-not $NodeExe) {
    return $false
  }
  try {
    $major = & $NodeExe -p "Number(process.versions.node.split('.')[0])" 2>$null
    return ([int]$major -ge $NodeMajorMin)
  } catch {
    return $false
  }
}

if (Test-NodeOk $RuntimeNode) {
  Write-Output $RuntimeNode
  exit 0
}

$SystemNode = Get-Command node -ErrorAction SilentlyContinue
if ($SystemNode -and (Test-NodeOk $SystemNode.Source)) {
  Write-Output $SystemNode.Source
  exit 0
}

$processorArch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
$nodeArch = if ($processorArch -eq "ARM64") { "win-arm64" } else { "win-x64" }
$manifestUrl = "https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt"

Write-Host "Configuring local Node.js $NodeMajorMin+ under .runtime\node..."
New-Item -ItemType Directory -Force -Path $DownloadsDir | Out-Null
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$manifest = (Invoke-WebRequest -UseBasicParsing -Uri $manifestUrl).Content
$match = [regex]::Match($manifest, "node-v24\.[^\s]+-$nodeArch\.zip")
if (-not $match.Success) {
  throw "Could not find a Node.js package for $nodeArch in $manifestUrl"
}

$file = $match.Value
$archive = Join-Path $DownloadsDir $file
$tmpDir = Join-Path $Root ".runtime\node.tmp"
$url = "https://nodejs.org/dist/latest-v24.x/$file"

Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $archive
Remove-Item -Recurse -Force $tmpDir, $RuntimeDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
Expand-Archive -Path $archive -DestinationPath $tmpDir -Force

$inner = Get-ChildItem -Path $tmpDir -Directory | Select-Object -First 1
if (-not $inner) {
  throw "Node.js archive did not contain an expected directory."
}

Move-Item -Path $inner.FullName -Destination $RuntimeDir
Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue

if (-not (Test-NodeOk $RuntimeNode)) {
  throw "Downloaded Node.js did not pass the version check."
}

Write-Output $RuntimeNode
