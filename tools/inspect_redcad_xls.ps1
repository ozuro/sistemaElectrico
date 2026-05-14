param(
  [Parameter(Mandatory = $true)]
  [string]$Path,
  [int]$MaxRows = 250
)

$ErrorActionPreference = 'Stop'

function Get-CellText($sheet, [int]$row, [int]$col) {
  $value = $sheet.Cells.Item($row, $col).Text
  if ($null -eq $value) { return '' }
  return [string]$value
}

$excel = $null
$workbook = $null
try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $workbook = $excel.Workbooks.Open((Resolve-Path -LiteralPath $Path).Path)

  $result = [ordered]@{
    path = (Resolve-Path -LiteralPath $Path).Path
    sheets = @{}
  }

  foreach ($sheetName in @('Estructuras', 'Acometidas')) {
    $sheet = $workbook.Worksheets.Item($sheetName)
    $usedRows = [int]$sheet.UsedRange.Rows.Count
    $usedCols = [int]$sheet.UsedRange.Columns.Count
    $rows = @()
    $lastRow = [Math]::Min($usedRows, $MaxRows)
    for ($row = 1; $row -le $lastRow; $row++) {
      $values = @()
      for ($col = 1; $col -le $usedCols; $col++) {
        $values += Get-CellText $sheet $row $col
      }
      $rows += ,$values
    }
    $result.sheets[$sheetName] = [ordered]@{
      usedRows = $usedRows
      usedCols = $usedCols
      rows = $rows
    }
  }

  $result | ConvertTo-Json -Depth 8
}
finally {
  if ($workbook) { $workbook.Close($false) | Out-Null }
  if ($excel) { $excel.Quit() | Out-Null }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
