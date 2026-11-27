# らくらく営農日誌 Next — docs/task_roadmap.md -> docs/task_roadmap.csv 生成スクリプト (RF-24)
$base = Split-Path -Parent $PSScriptRoot
$mdPath = Join-Path $base 'docs\task_roadmap.md'
$outCsvPath = Join-Path $base 'docs\task_roadmap.csv'

$lines = [System.IO.File]::ReadAllLines($mdPath, [System.Text.Encoding]::UTF8)

function Clean-Md([string]$s) {
  if ($null -eq $s) { return '' }
  $t = $s.Trim() -replace '\*\*', '' -replace '`', '' -replace '\$', '' -replace '<br\s*/?>', ' / ' -replace '\s+', ' '
  return $t.Trim()
}

function To-CsvCell([string]$s) {
  if ($null -eq $s) { return '""' }
  return '"' + ($s -replace '"', '""') + '"'
}

$rows = New-Object System.Collections.Generic.List[string]
$headers = @('タスクID','親タスクID','階層','ステータス','フェーズ','カテゴリーID','カテゴリー名','種類ID','種類名','優先度','タスク名称','詳細・実装内容','対象ファイル・担当')
$rows.Add(($headers | ForEach-Object { To-CsvCell $_ }) -join ',')

$currentPhase = ''
$currentSubParent = ''

foreach ($line in $lines) {
  if ($line -match '^### .*Phase 0：') { $currentPhase = 'Phase 0'; continue }
  if ($line -match '^### .*Phase 0\.5：') { $currentPhase = 'Phase 0.5'; continue }
  if ($line -match '^#### 1-A\.') { $currentPhase = 'Phase 1-A'; continue }
  if ($line -match '^#### 1-B\.') { $currentPhase = 'Phase 1-B'; continue }
  if ($line -match '^### .*Phase 2：') { $currentPhase = 'Phase 2'; continue }
  if ($line -match '^### .*Phase 3：') { $currentPhase = 'Phase 3'; continue }
  if ($line -match '^### .*(TSK-\d{3})：') { $currentSubParent = $Matches[1]; $currentPhase = 'Phase 2'; continue }
  if ($line -match '^## 5\.') { break }
  if ($line -notmatch '^\|') { continue }

  $cells = $line.Trim('|').Split('|') | ForEach-Object { $_.Trim() }
  if ($cells.Count -lt 4) { continue }

  if ($cells[0] -match '^`?\[(x| )\]`?$' -and $cells[1] -match '(TSK-\d{3})') {
    $status = if ($cells[0] -match 'x') { '完了' } else { '未着手' }
    $null = $cells[1] -match '(TSK-\d{3})'
    $tskId = $Matches[1]
    $catParts = ($cells[2] -split '<br\s*/?>') | ForEach-Object { Clean-Md $_ }
    $typParts = ($cells[3] -split '<br\s*/?>') | ForEach-Object { Clean-Md $_ }
    $col4 = Clean-Md $cells[4]
    $priority = if ($col4 -match '^Phase') { '-' } else { $col4 }
    $descParts = $cells[5] -split '<br\s*/?>', 2
    $vals = @(
      $tskId, '', 'メイン', $status, $currentPhase,
      $(if ($catParts.Count -ge 1) { $catParts[0] } else { '' }),
      $(if ($catParts.Count -ge 2) { $catParts[1] } else { '' }),
      $(if ($typParts.Count -ge 1) { $typParts[0] } else { '' }),
      $(if ($typParts.Count -ge 2) { $typParts[1] } else { '' }),
      $priority, (Clean-Md $descParts[0]),
      $(if ($descParts.Count -ge 2) { Clean-Md $descParts[1] } else { '' }),
      $(if ($cells.Count -ge 7) { Clean-Md $cells[6] } else { '' })
    )
    $rows.Add(($vals | ForEach-Object { To-CsvCell $_ }) -join ',')
    continue
  }

  if ($cells[0] -match '(TSK-\d{3}-\d+)') {
    $subId = $Matches[1]
    if ($cells[1] -match '^`?\[(x| )\]`?$') {
      $status = if ($cells[1] -match 'x') { '完了' } else { '未着手' }
      $subPrio = if ($currentSubParent -eq 'TSK-040') { '中' } else { '高' }
      $vals = @($subId, $currentSubParent, 'サブ', $status, 'Phase 2', 'CAT-10', 'データ解析', 'TYP-DEV', '新規実装', $subPrio, (Clean-Md $cells[2]), (Clean-Md $cells[3]), '')
      $rows.Add(($vals | ForEach-Object { To-CsvCell $_ }) -join ',')
    }
  }
}

$utf8Bom = New-Object System.Text.UTF8Encoding($true)
[System.IO.File]::WriteAllText($outCsvPath, ($rows -join "`r`n") + "`r`n", $utf8Bom)
Write-Output ("Generated CSV rows: " + $rows.Count)
