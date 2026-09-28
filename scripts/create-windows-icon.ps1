$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$target = Join-Path $projectRoot 'windows\Angela.ico'
$sizes = @(16, 32, 48, 256)
$images = @()
foreach ($size in $sizes) {
    $bitmap = [System.Drawing.Bitmap]::new($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $scale = $size / 48.0
    $blue = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#173D66'))
    $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
    $graphics.FillRectangle($blue, [int](4 * $scale), [int](4 * $scale), [int](40 * $scale), [int](40 * $scale))
    $graphics.FillRectangle($white, [int](12 * $scale), [int](12 * $scale), [int](9 * $scale), [int](25 * $scale))
    $graphics.FillRectangle($white, [int](26 * $scale), [int](12 * $scale), [int](10 * $scale), [int](25 * $scale))
    $memory = [System.IO.MemoryStream]::new()
    $bitmap.Save($memory, [System.Drawing.Imaging.ImageFormat]::Png)
    $images += ,$memory.ToArray()
    $memory.Dispose()
    $white.Dispose()
    $blue.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}

$stream = [System.IO.File]::Create($target)
$writer = [System.IO.BinaryWriter]::new($stream)
try {
    $writer.Write([uint16]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]$images.Count)
    $offset = 6 + 16 * $images.Count
    for ($i = 0; $i -lt $images.Count; $i++) {
        $size = $sizes[$i]
        $writer.Write([byte]($size % 256))
        $writer.Write([byte]($size % 256))
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]32)
        $writer.Write([uint32]$images[$i].Length)
        $writer.Write([uint32]$offset)
        $offset += $images[$i].Length
    }
    foreach ($bytes in $images) { $writer.Write([byte[]]$bytes) }
} finally {
    $writer.Dispose()
}
Write-Output $target
