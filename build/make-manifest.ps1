param(
  [string]$Exe = '',
  [string]$Url = '',
  [string]$Notes = '',
  [string]$Version = '',
  [string]$Out = ''
)

# 生成 latest.json：version / stamp / url / sha256 / size / notes
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
if (-not $Exe) {
  $dir = $root
  for ($i = 0; $i -lt 4; $i++) {
    $dir = Split-Path -Parent $dir
    if (-not $dir) { break }
    if (Test-Path (Join-Path $dir '打包成品')) { $Exe = Join-Path $dir '打包成品\日程舱.exe'; break }
  }
  if (-not $Exe) { throw '找不到成品 exe，用 -Exe 指定' }
}
if (-not (Test-Path $Exe)) { throw "找不到 exe：$Exe" }
if (-not $Url) { throw '必须给 -Url：新 exe 的下载地址（http/https）' }

# 从 exe 内嵌的 Stamp.txt 读构建标记
Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
$asm = [Reflection.Assembly]::LoadFile((Resolve-Path $Exe).Path)
$stamp = ''
$stream = $asm.GetManifestResourceStream('Stamp.txt')
if ($stream) {
  $reader = New-Object System.IO.StreamReader($stream)
  $stamp = $reader.ReadToEnd().Trim()
  $reader.Close()
}
if (-not $stamp) { throw '这个 exe 里没有 Stamp.txt（不是 build-single.ps1 打的）' }

$hash = (Get-FileHash $Exe -Algorithm SHA256).Hash.ToLower()
$size = (Get-Item $Exe).Length
if (-not $Version) { $Version = '1.0.' + $stamp }

$manifest = [ordered]@{
  version = $Version
  stamp   = $stamp
  url     = $Url
  sha256  = $hash
  size    = $size
  notes   = $Notes
  builtAt = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
}

if (-not $Out) { $Out = Join-Path (Split-Path -Parent $Exe) 'latest.json' }
$json = $manifest | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($Out, $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Host '已生成:' $Out
Write-Host ('  version ' + $Version)
Write-Host ('  stamp   ' + $stamp)
Write-Host ('  sha256  ' + $hash)
Write-Host ('  size    ' + $size)
