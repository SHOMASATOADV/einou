# らくらく営農日誌 Next — アーキテクチャ規約・イベント委任監査スクリプト (RF-24)
$base = Split-Path -Parent $PSScriptRoot

Write-Output '=== 1. index.html inline on*= check ==='
$idxHits = Select-String -Path (Join-Path $base 'index.html') -Pattern '\bon[a-z]+\s*=' -CaseSensitive:$false
Write-Output ('Count: ' + @($idxHits).Count)
$idxHits | ForEach-Object { Write-Output ($_.LineNumber.ToString() + ': ' + $_.Line.Trim()) }

Write-Output ''
Write-Output '=== 2. js/**/*.js dynamic HTML inline on*= check ==='
$jsFiles = Get-ChildItem -Path (Join-Path $base 'js') -Filter '*.js' -Recurse
$jsHits = $jsFiles | Select-String -Pattern '\bon(click|change|input|submit|keydown|keyup|focus|blur|error|load)\s*=\s*[''"`]' -CaseSensitive:$false
Write-Output ('Count: ' + @($jsHits).Count)
$jsHits | ForEach-Object { Write-Output ($_.Filename + ':' + $_.LineNumber + ': ' + $_.Line.Trim()) }

Write-Output ''
Write-Output '=== 3. data-action / data-change / data-input vs registerActionHandlers cross-check ==='
$registered = @{}
foreach ($jf in $jsFiles) {
  $jtxt = [System.IO.File]::ReadAllText($jf.FullName, [System.Text.Encoding]::UTF8)
  [regex]::Matches($jtxt, 'registerActionHandlers\s*\(\s*\{([\s\S]*?)\r?\n\}\s*\)') | ForEach-Object {
    [regex]::Matches($_.Groups[1].Value, '(?m)^\s*([A-Za-z0-9_]+)\s*:') | ForEach-Object {
      $registered[$_.Groups[1].Value] = $true
    }
  }
}
Write-Output ('Registered ACTION_HANDLERS (across all modules): ' + $registered.Count)

$allFiles = @((Get-Item (Join-Path $base 'index.html'))) + $jsFiles
$used = @{}
foreach ($f in $allFiles) {
  $txt = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8)
  [regex]::Matches($txt, 'data-(?:action|change|input)=[''"]([A-Za-z0-9_]+)[''"]') | ForEach-Object {
    $name = $_.Groups[1].Value
    if (-not $used.ContainsKey($name)) { $used[$name] = @() }
    $used[$name] += $f.Name
  }
}
$missing = @()
foreach ($k in ($used.Keys | Sort-Object)) {
  if (-not $registered.ContainsKey($k)) {
    $missing += ($k + ' (in ' + (($used[$k] | Select-Object -Unique) -join ', ') + ')')
  }
}
Write-Output ('Used unique handlers: ' + $used.Count)
Write-Output ('Missing in ACTION_HANDLERS: ' + $missing.Count)
$missing | ForEach-Object { Write-Output ('  MISSING: ' + $_) }

$winGlobals = $jsFiles | Select-String -Pattern 'window\.(_[A-Za-z0-9_]+)' -AllMatches |
  ForEach-Object { $_.Matches } | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
Write-Output ('Unique window._* globals: ' + @($winGlobals).Count)

if (@($idxHits).Count -gt 0 -or @($jsHits).Count -gt 0 -or $missing.Count -gt 0) {
  exit 1
}
