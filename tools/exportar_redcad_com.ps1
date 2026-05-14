param(
  [Parameter(Mandatory = $false)]
  [string]$JsonDataPath,

  [string]$TemplatePath = '',
  [string]$OutputPath = ''
)

$ErrorActionPreference = 'Stop'
trap {
  Write-Error ("{0} | Linea {1}: {2}" -f $_.Exception.Message, $_.InvocationInfo.ScriptLineNumber, $_.InvocationInfo.Line)
  exit 1
}

if (-not $TemplatePath) {
  $TemplatePath = Join-Path $PSScriptRoot '..\assets\templates\exportado_2red.xls'
}

if (-not $JsonDataPath) {
  Add-Type -AssemblyName System.Windows.Forms
  $dialog = [Windows.Forms.OpenFileDialog]::new()
  $dialog.Title = 'Seleccione redcad_export_data_*.json'
  $dialog.Filter = 'Data RedCAD (*.json)|*.json'
  if ($dialog.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) {
    throw 'No se selecciono ningun JSON RedCAD.'
  }
  $JsonDataPath = $dialog.FileName
}

function Clean-Text($value) {
  if ($null -eq $value) { return '' }
  return ([string]$value -replace "`r?`n", ' ' -replace '\s+', ' ').Trim()
}

function Get-CellText($sheet, $row, $col) {
  return Clean-Text $sheet.Cells.Item($row, $col).Text
}

function Set-CellText($sheet, $row, $col, $value) {
  $sheet.Cells.Item([int]$row, [int]$col).Value = [string](Clean-Text $value)
}

function Set-CellNumber($sheet, $row, $col, $value) {
  if ($null -eq $value -or "$value" -eq '') {
    $sheet.Cells.Item([int]$row, [int]$col).Value = $null
    return
  }
  $sheet.Cells.Item([int]$row, [int]$col).Value = [double]$value
}

function Set-CellInteger($sheet, $row, $col, $value) {
  if ($null -eq $value -or "$value" -eq '') {
    $sheet.Cells.Item([int]$row, [int]$col).Value = $null
    return
  }
  $sheet.Cells.Item([int]$row, [int]$col).Value = [int]$value
}

function Read-RedcadJson($path) {
  $data = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
  if (-not $data.estructuras) { throw 'El JSON no contiene estructuras.' }
  if (-not $data.acometidas) { $data | Add-Member -NotePropertyName acometidas -NotePropertyValue @() }
  return $data
}

function Assert-RedcadData($data) {
  $ids = @{}
  foreach ($e in @($data.estructuras)) {
    $id = [int]$e.id
    $idKey = [string]$id
    if ($ids.ContainsKey($idKey)) { throw "ID duplicado: $id" }
    $ids[$idKey] = $true
    if ((Clean-Text $e.zona_banda) -ne '19L') { throw "Zona-Banda invalida en estructura $id" }
    [void][double]$e.x
    [void][double]$e.y
  }
  foreach ($e in @($data.estructuras)) {
    $padre = [int]$e.padre
    if ($padre -eq 0) { continue }
    if (-not $ids.ContainsKey([string]$padre)) { throw "ID padre inexistente: $padre" }
  }
  foreach ($a in @($data.acometidas)) {
    $idEstructura = [int]$a.id_estructura
    if (-not $ids.ContainsKey([string]$idEstructura)) {
      throw "Acometida apunta a estructura inexistente: $idEstructura"
    }
    [void][double]$a.x
    [void][double]$a.y
  }
}

function Write-RedcadXls($data, $template, $output) {
  $templateResolved = (Resolve-Path -LiteralPath $template).Path
  if (-not $output) {
    $sed = Clean-Text $data.sed
    if (-not $sed) { $sed = 'SED' }
    $sed = $sed -replace '[^A-Za-z0-9_-]', '_'
    $output = Join-Path ([Environment]::GetFolderPath('UserProfile')) "Downloads\redcad_export_$sed.xls"
  }
  $outputResolved = [IO.Path]::GetFullPath($output)
  Copy-Item -LiteralPath $templateResolved -Destination $outputResolved -Force
  if ($data.debug_geojson) {
    $debugPath = Join-Path ([IO.Path]::GetDirectoryName($outputResolved)) 'debug_redcad.geojson'
    $data.debug_geojson | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $debugPath -Encoding UTF8
  }

  $excel = $null
  $wb = $null
  try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $wb = $excel.Workbooks.Open($outputResolved)

    $wsE = $wb.Worksheets.Item('Estructuras')
    $wsA = $wb.Worksheets.Item('Acometidas')

    if ((Get-CellText $wsE 2 1) -ne 'ID Estructura') { throw 'Estructuras!A2 no conserva ID Estructura.' }
    if ((Get-CellText $wsA 2 1) -ne 'ID Estructura') { throw 'Acometidas!A2 no conserva ID Estructura.' }

    $lastE = [Math]::Max($wsE.UsedRange.Rows.Count, 3)
    $lastA = [Math]::Max($wsA.UsedRange.Rows.Count, 3)
    $wsE.Range("A3:AB$lastE").ClearContents() | Out-Null
    $wsA.Range("A3:L$lastA").ClearContents() | Out-Null

    $row = 3
    foreach ($e in @($data.estructuras)) {
      Set-CellInteger $wsE $row 1 $e.id
      Set-CellInteger $wsE $row 2 $e.padre
      Set-CellText $wsE $row 3 $e.codigo
      Set-CellText $wsE $row 4 '19L'
      Set-CellNumber $wsE $row 5 $e.x
      Set-CellNumber $wsE $row 6 $e.y
      Set-CellText $wsE $row 7 $e.tipo_red
      if ($null -ne $e.n_subestacion -and "$($e.n_subestacion)" -ne '') {
        Set-CellInteger $wsE $row 8 $e.n_subestacion
      } else {
        Set-CellText $wsE $row 8 ''
      }
      Set-CellText $wsE $row 9 $e.nombre_subestacion
      Set-CellText $wsE $row 10 $e.tipo_subestacion
      Set-CellText $wsE $row 13 $e.armado_bt
      Set-CellText $wsE $row 15 $e.soporte
      $cantidadSoportes = if ($null -ne $e.cantidad_soportes -and "$($e.cantidad_soportes)" -ne '') { [int]$e.cantidad_soportes } else { 1 }
      Set-CellInteger $wsE $row 16 $cantidadSoportes
      Set-CellText $wsE $row 17 $e.pat
      Set-CellText $wsE $row 18 $e.retenidas
      Set-CellText $wsE $row 22 $e.cimentacion
      Set-CellText $wsE $row 23 $e.terreno
      Set-CellText $wsE $row 24 $e.accesibilidad
      Set-CellText $wsE $row 25 $e.conductor
      Set-CellText $wsE $row 26 $e.sistema_linea
      Set-CellText $wsE $row 28 $e.comentario
      $row++
    }

    $row = 3
    foreach ($a in @($data.acometidas)) {
      Set-CellInteger $wsA $row 1 $a.id_estructura
      Set-CellInteger $wsA $row 2 $a.n_acometida
      Set-CellNumber $wsA $row 3 $a.x
      Set-CellNumber $wsA $row 4 $a.y
      Set-CellText $wsA $row 5 $a.tipo
      Set-CellNumber $wsA $row 6 $a.longitud_real
      Set-CellText $wsA $row 7 $a.longitud_sobreescrita
      Set-CellText $wsA $row 8 $a.accesorio
      Set-CellText $wsA $row 9 $a.carga
      Set-CellText $wsA $row 10 $a.nombre
      Set-CellNumber $wsA $row 11 $a.potencia
      Set-CellNumber $wsA $row 12 $a.factor_simultaneidad
      $row++
    }

    if ((Get-CellText $wsE 2 1) -ne 'ID Estructura') { throw 'Se altero Estructuras!A2.' }
    if ((Get-CellText $wsA 2 1) -ne 'ID Estructura') { throw 'Se altero Acometidas!A2.' }

    $wb.SaveAs($outputResolved, 56)
    $wb.Close($true)
  } finally {
    if ($wb) { [Runtime.InteropServices.Marshal]::ReleaseComObject($wb) | Out-Null }
    if ($excel) {
      $excel.Quit()
      [Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
  }

  return $outputResolved
}

$data = Read-RedcadJson $JsonDataPath
Assert-RedcadData $data
$finalPath = Write-RedcadXls $data $TemplatePath $OutputPath
Write-Host "RedCAD XLS generado: $finalPath"
Write-Host "Estructuras: $(@($data.estructuras).Count)"
Write-Host "Acometidas: $(@($data.acometidas).Count)"
