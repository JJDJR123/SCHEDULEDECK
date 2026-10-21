# 打包日程舱：生成图标 -> 编译启动器 -> 组装 dist\日程舱
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$launcherDir = Join-Path $root 'launcher'
$distRoot = Join-Path $root 'dist'   # 放在仓库内（已在 .gitignore），不再写到上一级
$dist = Join-Path $distRoot '日程舱'

Write-Host '[1/4] 生成图标'
& (Join-Path $PSScriptRoot 'make-icon.ps1') -Out (Join-Path $launcherDir 'app.ico') -PreviewPng (Join-Path $launcherDir 'app-icon.png') | Out-Host

Write-Host '[2/4] 编译启动器'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw '找不到 .NET Framework 编译器 csc.exe' }
$exe = Join-Path $launcherDir '日程舱.exe'
& $csc /nologo /target:winexe /optimize+ "/out:$exe" "/win32icon:$(Join-Path $launcherDir 'app.ico')" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll (Join-Path $launcherDir 'Program.cs')
if ($LASTEXITCODE -ne 0) { throw '启动器编译失败' }

Write-Host '[3/4] 组装目录'
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Join-Path $dist 'runtime'), (Join-Path $dist 'web'), (Join-Path $dist 'data') | Out-Null

Copy-Item (Join-Path $root 'server.js') $dist
Copy-Item (Join-Path $root 'feishu.js') $dist
Copy-Item (Join-Path $root 'package.json') $dist
Copy-Item (Join-Path $root 'web\*') (Join-Path $dist 'web') -Recurse -Force
Copy-Item $exe $dist
Copy-Item (Join-Path $launcherDir 'app.ico') $dist
Copy-Item (Join-Path $root 'build\README-dist.txt') $dist

$node = (Get-Command node -ErrorAction SilentlyContinue)
if (-not $node) { throw '找不到 node.exe，无法打包运行时' }
Copy-Item $node.Source (Join-Path $dist 'runtime\node.exe')

Write-Host '[4/4] 完成'
$size = (Get-ChildItem $dist -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB
Write-Host ("输出：{0}（{1:N1} MB）" -f $dist, $size)
