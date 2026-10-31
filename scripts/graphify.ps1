$ErrorActionPreference = 'Stop'
$productRoot = Split-Path -Parent $PSScriptRoot
$configuredTool = $env:LIVING_CANVAS_GRAPHIFY
$localTool = Join-Path (Split-Path -Parent $productRoot) '.graphify-venv\Scripts\graphify.exe'
$graphifyTool = if ($configuredTool) { $configuredTool } elseif (Test-Path -LiteralPath $localTool) { $localTool } else { $null }
if (-not $graphifyTool -or -not (Test-Path -LiteralPath $graphifyTool)) {
  Write-Host 'Graphify is optional development tooling. Set LIVING_CANVAS_GRAPHIFY to an absolute Graphify executable path.'
  exit 0
}
Push-Location -LiteralPath $productRoot
try {
  & $graphifyTool extract . --code-only --no-cluster --max-workers 2
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  Write-Host 'Local source graph generated in graphify-out/graph.json. No language-model service was used.'
}
finally { Pop-Location }
