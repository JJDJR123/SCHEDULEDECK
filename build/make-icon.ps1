# 生成应用图标（渐变圆角方块 + 白色对勾），输出多尺寸 .ico 与 256px png
param(
  [string]$Out = "$PSScriptRoot\app.ico",
  [string]$PreviewPng = "$PSScriptRoot\app-icon.png"
)

$ErrorActionPreference = 'Stop'
try { Add-Type -AssemblyName System.Drawing.Common -ErrorAction Stop } catch { Add-Type -AssemblyName System.Drawing }

function New-RoundedPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

$base = New-Object System.Drawing.Bitmap 512, 512
$g = [System.Drawing.Graphics]::FromImage($base)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

$path = New-RoundedPath 16 16 480 480 110
$c1 = [System.Drawing.ColorTranslator]::FromHtml('#6D6AF8')
$c2 = [System.Drawing.ColorTranslator]::FromHtml('#8B5CF6')
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.Point 0, 0),
  (New-Object System.Drawing.Point 512, 512), $c1, $c2)
$g.FillPath($brush, $path)

$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), 54
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$pts = [System.Drawing.Point[]]@(
  (New-Object System.Drawing.Point 138, 268),
  (New-Object System.Drawing.Point 224, 354),
  (New-Object System.Drawing.Point 380, 170)
)
$g.DrawLines($pen, $pts)
$g.Dispose()

$base.Save($PreviewPng, [System.Drawing.Imaging.ImageFormat]::Png)

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$pngData = @()
foreach ($s in $sizes) {
  $small = New-Object System.Drawing.Bitmap $s, $s
  $sg = [System.Drawing.Graphics]::FromImage($small)
  $sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $sg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $sg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $sg.Clear([System.Drawing.Color]::Transparent)
  $sg.DrawImage($base, 0, 0, $s, $s)
  $sg.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $small.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngData += ,($ms.ToArray())
  $small.Dispose()
  $ms.Dispose()
}
$base.Dispose()

$fs = [System.IO.File]::Create($Out)
$bw = New-Object System.IO.BinaryWriter($fs)
$bw.Write([UInt16]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]
  $bw.Write([Byte]$(if ($s -ge 256) { 0 } else { $s }))
  $bw.Write([Byte]$(if ($s -ge 256) { 0 } else { $s }))
  $bw.Write([Byte]0)
  $bw.Write([Byte]0)
  $bw.Write([UInt16]1)
  $bw.Write([UInt16]32)
  $bw.Write([UInt32]$pngData[$i].Length)
  $bw.Write([UInt32]$offset)
  $offset += $pngData[$i].Length
}
foreach ($bytes in $pngData) { $bw.Write($bytes) }
$bw.Flush(); $bw.Close(); $fs.Close()

Write-Output "icon -> $Out"
