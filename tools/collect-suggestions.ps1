param(
  [string]$From = '',
  [string]$To = ''
)

# 把 app 攒下的建议收进仓库的「建议」文件夹（按人分目录）
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
if (-not $To) { $To = Join-Path $root '建议' }

if (-not $From) {
  $d = $root
  for ($i = 0; $i -lt 4; $i++) {
    $d = Split-Path -Parent $d
    if (-not $d) { break }
    $cand = Join-Path $d '打包成品\data\suggestions'
    if (Test-Path $cand) { $From = $cand; break }
  }
}
if (-not $From) {
  $local = Join-Path $env:LOCALAPPDATA 'ScheduleDeck\data\suggestions'
  if (Test-Path $local) { $From = $local }
}
if (-not $From -or -not (Test-Path $From)) {
  throw '找不到 data\suggestions，用 -From 指定（例如 打包成品\data\suggestions）'
}

New-Item -ItemType Directory -Force -Path $To | Out-Null
$n = 0
Get-ChildItem $From -Directory | ForEach-Object {
  $person = $_.Name
  $dest = Join-Path $To $person
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  Get-ChildItem $_.FullName -Filter *.json -File | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $dest $_.Name) -Force
    $n++
  }
}

Write-Host ('已收集 {0} 条建议 → {1}' -f $n, $To)
