$ErrorActionPreference = 'Stop'
$excel = $null
try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  Write-Host 'Excel COM OK'
} finally {
  if ($excel) {
    $excel.Quit()
    [Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
  }
}
