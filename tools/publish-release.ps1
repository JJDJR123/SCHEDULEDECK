param(
  [string]$Exe = '',
  [string]$Notes = '',
  [string]$Repo = 'JJDJR123/SCHEDULEDECK'
)

# 发布新版本到 GitHub Release：
#   - 每个版本一个 tag（v<打包时间戳>），exe 挂在版本 tag 下 → 下载地址每次都不同，不会被 CDN 缓存串
#   - 固定 tag "latest" 只放 latest.json（更新清单），地址永远不变
# 用法：powershell -File tools\publish-release.ps1 -Notes "这次改了什么"
# 凭证复用 git 已保存的 GitHub 登录，不在脚本里写 token

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
if (-not $Exe) {
  $dir = $root
  for ($i = 0; $i -lt 4; $i++) {
    $dir = Split-Path -Parent $dir
    if (-not $dir) { break }
    if (Test-Path (Join-Path $dir '打包成品')) { $Exe = Join-Path $dir '打包成品\日程舱.exe'; break }
  }
}
if (-not $Exe -or -not (Test-Path $Exe)) { throw '找不到要发布的 exe' }

Write-Host '[1/5] 取 GitHub 凭证'
$cred = "protocol=https`nhost=github.com`n`n" | git credential fill 2>&1
$token = (($cred | Select-String '^password=').Line -replace '^password=', '')
if (-not $token) { throw '没拿到 GitHub 凭证，先 git push 一次让它记住' }
$headers = @{
  Authorization          = "Bearer $token"
  'User-Agent'           = 'ScheduleDeck'
  Accept                 = 'application/vnd.github+json'
  'X-GitHub-Api-Version' = '2022-11-28'
}

function Ensure-Release {
  param([string]$Tag, [string]$Name, [string]$Body)
  try {
    return Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/tags/$Tag" -Headers $headers -TimeoutSec 30
  } catch {
    $payload = @{ tag_name = $Tag; name = $Name; body = $Body; draft = $false; prerelease = $false } | ConvertTo-Json
    return Invoke-RestMethod "https://api.github.com/repos/$Repo/releases" -Method Post -Headers $headers -Body $payload -ContentType 'application/json' -TimeoutSec 30
  }
}

function Upload-Asset {
  param($Release, [string]$Path, [string]$Name)
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  $url = "https://uploads.github.com/repos/$Repo/releases/$($Release.id)/assets?name=$Name"
  $res = Invoke-RestMethod $url -Method Post -Headers $headers -ContentType 'application/octet-stream' -Body $bytes -TimeoutSec 900
  Write-Host ("  上传 " + $res.name + " (" + [math]::Round($bytes.Length / 1MB, 1) + " MB)")
  return $res
}

function Remove-AssetNames {
  param($Release, [string[]]$Names)
  foreach ($a in $Release.assets) {
    if ($Names -contains $a.name) {
      Invoke-RestMethod ("https://api.github.com/repos/$Repo/releases/assets/" + $a.id) -Method Delete -Headers $headers -TimeoutSec 30 | Out-Null
      Write-Host ("  删除旧资源 " + $a.name)
    }
  }
}

# exe 内嵌的打包时间戳 → 版本 tag
$asm = [Reflection.Assembly]::LoadFile((Resolve-Path $Exe).Path)
$stream = $asm.GetManifestResourceStream('Stamp.txt')
if (-not $stream) { throw 'exe 里没有 Stamp.txt，不是 build-single.ps1 打的' }
$reader = New-Object System.IO.StreamReader($stream)
$stamp = $reader.ReadToEnd().Trim()
$reader.Close()

Write-Host "[2/5] 版本 release: v$stamp"
$verTag = "v$stamp"
$verRelease = Ensure-Release -Tag $verTag -Name "日程舱 $stamp" -Body $(if ($Notes) { $Notes } else { '自动发布' })
Remove-AssetNames -Release $verRelease -Names @('ScheduleDeck.exe', 'default.exe')
Write-Host '[3/5] 上传 exe'
# 资源名用 ASCII：中文名在 uploads 接口上会被 GitHub 改成 default.exe
$asset = Upload-Asset -Release $verRelease -Path $Exe -Name 'ScheduleDeck.exe'
$exeUrl = $asset.browser_download_url

Write-Host '[4/5] 生成 latest.json'
$manifestOut = Join-Path $env:TEMP ('sd-latest-' + [guid]::NewGuid().ToString('N') + '.json')
& (Join-Path $PSScriptRoot '..\build\make-manifest.ps1') -Exe $Exe -Url $exeUrl -Notes $Notes -Out $manifestOut | Out-Host

Write-Host '[5/5] 更新 latest 清单'
$latestRelease = Ensure-Release -Tag 'latest' -Name '最新版本' -Body '日程舱 自动更新发布点：latest.json 指向当前版本'
Remove-AssetNames -Release $latestRelease -Names @('latest.json', 'ScheduleDeck.exe', 'default.exe')
Upload-Asset -Release $latestRelease -Path $manifestOut -Name 'latest.json' | Out-Null
Remove-Item $manifestOut -Force -ErrorAction SilentlyContinue

Write-Host ''
Write-Host '完成。更新地址（填到 设置 → 外观与数据 → 自动更新）：'
Write-Host "  https://github.com/$Repo/releases/download/latest/latest.json"
Write-Host '安装包地址：'
Write-Host "  $exeUrl"
