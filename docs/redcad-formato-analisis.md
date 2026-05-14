# Analisis del formato REDCAD de red existente

Este archivo documenta como debe llenarse el Excel de importacion tomando como base `exportado red.xls`.

## Estructuras

La hoja debe llamarse `Estructuras`.

Fila 1:

- `A1`: `RCE`
- `B1`: `0.34`

La celda `0.34` es la version del formato RCE observada en el archivo exportado. No es total de filas.

Fila 2: solo los encabezados del formato original. No agregar columnas extras.

Reglas de llenado:

- `ID Estructura`: numero entero correlativo REDCAD: `1, 2, 3...`
- `ID Estructura Padre`: numero entero del padre REDCAD. La primera estructura usa `0`.
- `Codigo de Estructura`: en el exportado aparece vacio, por lo tanto se deja vacio.
- `Zona-Banda`: zona UTM y banda calculada desde WGS84.
- `X`, `Y`: coordenadas locales de plano en metros. Se calculan desde WGS84 -> UTM -> origen local.
- `Tipo Red`: valores observados/permitidos: `LP`, `RP`, `RS`.
- `N° Subestacion`: solo se llena en la fila de la subestacion con `1`.
- `Nombre Subestacion`: en el exportado puede estar vacio; no repetir el codigo GIS.
- `Tipo Subestacion`: usar nombres compatibles con el catalogo REDCAD, por ejemplo `15kVA-2ø-13.2kV`.
- `Armado Primario BT` y `Armado Secundario BT`: usar codigos del catalogo, por ejemplo `E1`, `E3`, `E6`.
- `Soporte`: usar codigos del catalogo, por ejemplo `8/200`, `9/300`, `12/300`.
- `Cantidad de soportes`: numero entero. Si no hay dato, usar `1`.
- `Cimentacion`: usar `CM`, `CM8`, `CM9`, `CM12` segun soporte.
- `Terreno`: usar `I`.
- `Accesibilidad`: usar `TA`.

No colocar codigos GIS (`SED000...`, `NBT000...`, `CBT000...`) en `ID Estructura`.

## Acometidas

La hoja debe llamarse `Acometidas`.

Mantener solo las columnas del exportado:

- `ID Estructura`
- `N° Acometida`
- `X`
- `Y`
- `Tipo`
- `Longitud real`
- `Longitud sobreescrita`
- `Accesorio de Acometida`
- `Carga`
- `Nombre`
- `Potencia (kW)`
- `Factor de simultaneidad`

Reglas:

- `ID Estructura`: ID numerico REDCAD del poste/estructura padre.
- `N° Acometida`: correlativo de acometida dentro del archivo.
- `Tipo`: usar `Corta` por defecto mientras no se clasifique otra opcion validada por manual.
- `Longitud real`: distancia en metros desde la estructura padre hasta el suministro.
- `Accesorio de Acometida`: usar catalogo; por defecto `Murete existente`.
- `Carga`: usar catalogo; por ejemplo `Carga 1ø - Tipo 2` si se puede inferir.

## Archivo de referencia

Los codigos reales del GIS se descargan en un archivo aparte `referencia_redcad_*.xls`.

Ese archivo no se importa en REDCAD. Sirve para saber que fila REDCAD corresponde a cada elemento GIS.
