param(
  [string]$OutDir = ''
)

# 把 node 运行时、web、服务代码打进单个 exe：首次运行自解压到 LocalAppData
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$workspace = Split-Path -Parent $root
if (-not $OutDir) { $OutDir = Join-Path $workspace '打包成品' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$exe = Join-Path $OutDir '日程舱.exe'
if (Test-Path $exe) {
  try {
    $stream = [System.IO.File]::Open($exe, 'Open', 'ReadWrite', 'None')
    $stream.Close()
  } catch {
    throw '日程舱.exe 正在运行，请先从右下角托盘退出，再重新打包'
  }
}

Write-Host '[1/5] 构建文件夹版'
& (Join-Path $PSScriptRoot 'build.ps1') | Out-Host

$dist = Join-Path $workspace 'dist\日程舱'
if (-not (Test-Path (Join-Path $dist 'server.js'))) { throw 'dist 不完整，构建失败' }

Write-Host '[2/5] 生成 payload'
$tmp = Join-Path $env:TEMP ('sd-payload-' + [guid]::NewGuid().ToString('N') + '.zip')
$items = @('server.js', 'feishu.js', 'package.json', 'README-dist.txt', 'app.ico', 'web', 'runtime')
Push-Location $dist
try {
  tar -a -c -f $tmp @items
  if ($LASTEXITCODE -ne 0) { throw 'payload 打包失败' }
} finally {
  Pop-Location
}

Write-Host '[3/5] 生成构建标记'
$stamp = Get-Date -Format 'yyyyMMddHHmmss'
$stampFile = Join-Path $env:TEMP ('sd-stamp-' + [guid]::NewGuid().ToString('N') + '.txt')
[System.IO.File]::WriteAllText($stampFile, $stamp, (New-Object System.Text.UTF8Encoding($false)))

Write-Host '[4/5] 编译单文件 exe'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw '找不到 csc.exe' }
$tmpExe = Join-Path $OutDir '日程舱.new.exe'
& $csc /nologo /target:winexe /optimize+ "/out:$tmpExe" "/win32icon:$(Join-Path $root 'launcher\app.ico')" "/resource:$tmp,Payload.zip" "/resource:$stampFile,Stamp.txt" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll (Join-Path $root 'launcher\Program.cs')
if ($LASTEXITCODE -ne 0) { throw '单文件编译失败' }
Move-Item -LiteralPath $tmpExe -Destination $exe -Force

Remove-Item $tmp, $stampFile -Force -ErrorAction SilentlyContinue

Write-Host '[5/5] 完成'
Write-Host ('输出：{0}（{1:N1} MB）' -f $exe, ((Get-Item $exe).Length / 1MB))
