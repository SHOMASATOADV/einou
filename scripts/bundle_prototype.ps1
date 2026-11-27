# らくらく営農日誌 Next — 単一HTMLバンドル生成スクリプト (RF-24)
param(
  [string]$OutPath = ''
)
$base = Split-Path -Parent $PSScriptRoot
if (-not $OutPath) {
  $OutPath = Join-Path $base 'dist\rakuraku_einou_standalone.html'
}
$outDir = Split-Path -Parent $OutPath
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

$indexPath = Join-Path $base 'index.html'
$html = [System.IO.File]::ReadAllText($indexPath, [System.Text.Encoding]::UTF8)

$cssPath = Join-Path $base 'css\styles.css'
if (Test-Path $cssPath) {
  $css = [System.IO.File]::ReadAllText($cssPath, [System.Text.Encoding]::UTF8)
  $html = $html -replace '<link\s+rel=["\'']stylesheet["\'']\s+href=["\'']\./css/styles\.css["\'']\s*/?>', ('<style>' + [Environment]::NewLine + $css + [Environment]::NewLine + '</style>')
}

# index.html 内のすべてのローカル <script src="./js/..."> を自動検出して順番通りインライン化
$html = [regex]::Replace($html, '<script\s+src=["\''](\./js/[^"\'']+)["\'']>\s*</script>', {
  param($m)
  $rel = $m.Groups[1].Value.TrimStart('./').Replace('/', '\')
  $full = Join-Path $base $rel
  if (Test-Path $full) {
    $code = [System.IO.File]::ReadAllText($full, [System.Text.Encoding]::UTF8)
    return '<script>' + [Environment]::NewLine + $code + [Environment]::NewLine + '</script>'
  }
  return $m.Value
})

[System.IO.File]::WriteAllText($OutPath, $html, [System.Text.Encoding]::UTF8)
Write-Output ("Bundle generated: $OutPath (" + $html.Length + " bytes)")
