/**
 * exportarSheets.js
 * Crea o actualiza Google Sheets en Drive usando la API REST.
 * El token OAuth se guarda en localStorage como 'criterio_google_token'.
 * El Google Client ID se guarda en localStorage como 'criterio_google_client_id'.
 *
 * Flujo:
 *  1. Verificar que hay token válido (no expirado).
 *  2. Si no hay token → abrir popup de Google Sign-In con scope Sheets+Drive.
 *  3. Crear Spreadsheet con los datos → devuelve la URL.
 */

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file'

// ─── Token management ────────────────────────────────────────────────────────

function getToken() {
  try {
    const raw = localStorage.getItem('criterio_google_token')
    if (!raw) return null
    const t = JSON.parse(raw)
    if (Date.now() > t.expires_at) {
      localStorage.removeItem('criterio_google_token')
      return null
    }
    return t.access_token
  } catch { return null }
}

function saveToken(token, expiresIn) {
  localStorage.setItem('criterio_google_token', JSON.stringify({
    access_token: token,
    expires_at: Date.now() + (expiresIn - 60) * 1000 // 1 min de margen
  }))
}

// ─── OAuth via Google Identity Services (popup) ───────────────────────────────

function loadGIS() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) { resolve(); return }
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.onload = resolve
    s.onerror = () => reject(new Error('No se pudo cargar Google Identity Services'))
    document.head.appendChild(s)
  })
}

export async function autenticarGoogle() {
  const clientId = localStorage.getItem('criterio_google_client_id')
  if (!clientId) throw new Error('Falta el Google Client ID. Configuralo en Ajustes.')

  await loadGIS()

  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (resp) => {
        if (resp.error) { reject(new Error(resp.error)); return }
        saveToken(resp.access_token, resp.expires_in)
        resolve(resp.access_token)
      }
    })
    client.requestAccessToken({ prompt: 'consent' })
  })
}

async function getValidToken() {
  const existing = getToken()
  if (existing) return existing
  return autenticarGoogle()
}

// ─── Helpers de formato ───────────────────────────────────────────────────────

/** Convierte array de arrays en formato values de Sheets API */
function toValues(rows) {
  return rows.map(r => r.map(c => c === null || c === undefined ? '' : c))
}

/** Color de fondo en formato Sheets API */
function color(r, g, b) {
  return { red: r / 255, green: g / 255, blue: b / 255 }
}

const AZUL_HEADER = color(59, 91, 219)   // #3b5bdb
const VERDE_OK    = color(34, 197, 94)    // #22c55e
const GRIS_ROW    = color(255, 255, 255)  // blanco
const BLANCO      = color(255, 255, 255)  // blanco
const NEGRO       = color(255, 255, 255)  // fondo blanco general
const TEXTO_NEGRO = color(0, 0, 0)        // texto negro
const TEXTO_BLANCO = color(255, 255, 255) // texto blanco (para headers)

// ─── Crear Spreadsheet ────────────────────────────────────────────────────────

async function crearSpreadsheet(token, titulo) {
  const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { title: titulo } })
  })
  if (!res.ok) throw new Error('Error creando Spreadsheet: ' + res.status)
  return res.json()
}

async function actualizarHoja(token, spreadsheetId, sheetId, sheetTitle, rows, requests) {
  // Escribir datos + renombrar hoja en un solo batchUpdate
  // Usamos updateCells para escribir por sheetId (no depende del nombre de la hoja)
  const cellData = rows.map(row => ({
    values: row.map(cell => ({
      userEnteredValue: typeof cell === 'number'
        ? { numberValue: cell }
        : { stringValue: cell === null || cell === undefined ? '' : String(cell) }
    }))
  }))

  requests.push(
    // Renombrar hoja
    {
      updateSheetProperties: {
        properties: { sheetId, title: sheetTitle },
        fields: 'title'
      }
    },
    // Escribir datos por sheetId (no depende del nombre)
    {
      updateCells: {
        start: { sheetId, rowIndex: 0, columnIndex: 0 },
        rows: cellData,
        fields: 'userEnteredValue'
      }
    }
  )

  return requests
}

async function aplicarFormatos(token, spreadsheetId, requests) {
  if (!requests.length) return
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests })
    }
  )
  if (!res.ok) {
    const err = await res.text()
    throw new Error('Error aplicando formatos: ' + err)
  }
}

// ─── EXPORT ARTÍCULO (distribución por sucursal) ──────────────────────────────

/**
 * Exporta la distribución de un artículo a Google Sheets.
 * Columnas: Sucursal | Cant. Total | [talles dinámicos] | Estado | Cajas | Fecha
 *
 * @param {object} articulo - objeto pedido_articulos con sucursales cargadas
 * @param {object} pedido   - objeto pedido con clientes
 */
export async function exportarArticuloSheets(articulo, pedido) {
  const token = await getValidToken()

  const cliente = pedido.clientes?.nombre || ''
  const nroPedido = pedido.numero_pedido || ''
  const codigo = articulo.codigo_nuestro || ''
  const descripcion = articulo.descripcion_correcta || articulo.descripcion_cliente || ''
  const precio = articulo.precio_unitario
    ? '$' + Number(articulo.precio_unitario).toLocaleString('es-AR')
    : ''

  // Recolectar todos los talles presentes en las sucursales (dinámico)
  const tallesSet = new Set()
  ;(articulo.pedido_sucursales || []).forEach(s => {
    if (s.talles) Object.keys(s.talles).forEach(t => tallesSet.add(String(t)))
  })
  const talles = Array.from(tallesSet).sort((a, b) => Number(a) - Number(b))

  // Filas de datos
  const sucursales = (articulo.pedido_sucursales || [])
    .filter(s => s.cantidad > 0)
    .sort((a, b) => Number(a.nro_sucursal) - Number(b.nro_sucursal))

  // Encabezado con info del artículo (filas de metadata)
  const rows = []
  rows.push(['CRITERIO PEDIDOS — Distribución por artículo'])
  rows.push([])
  const preparadores = (articulo.preparadores || []).join(', ') || 'Sin asignar'
  const descuento = pedido.descuento ? pedido.descuento + '%' : ''
  const razonSocial = pedido.razon_social || ''
  const fechaEntregaLabel = pedido.fecha_entrega
    ? new Date(pedido.fecha_entrega).toLocaleDateString('es-AR')
    : ''
  rows.push(['Cliente', cliente, '', 'Pedido N°', nroPedido])
  if (razonSocial) rows.push(['FACTURAR A', razonSocial])
  if (fechaEntregaLabel) rows.push(['Fecha entrega', fechaEntregaLabel])
  rows.push(['Artículo', codigo, '', 'Descripción', descripcion])
  rows.push(['Precio unit.', precio, '', 'Total unid.', articulo.total_unidades || ''])
  if (descuento) rows.push(['Descuento', descuento])
  rows.push(['Preparado por', preparadores])
  rows.push([])

  // Encabezado tabla
  const headerRow = ['Sucursal', 'Cant. Total', ...talles.map(t => 'T' + t), 'Estado', 'Cajas', 'Fecha final.']
  rows.push(headerRow)

  // Filas de sucursales — separar Sucati (1-9) y Chandal (10-23) si corresponde
  const esSucati = razonSocial && (razonSocial.includes('SUCATI') || razonSocial.includes('CHANDAL'))
  const sucsSucati = sucursales.filter(s => { const n = Number(s.nro_sucursal); return n >= 1 && n <= 9 })
  const sucsChandal = sucursales.filter(s => { const n = Number(s.nro_sucursal); return n >= 10 && n <= 23 })
  const sucsOtras = sucursales.filter(s => { const n = Number(s.nro_sucursal); return n < 1 || (n > 23) })

  const filaEstado = (suc) => [
    'Suc. ' + suc.nro_sucursal,
    suc.cantidad,
    ...talles.map(t => (suc.talles && suc.talles[t]) ? suc.talles[t] : 0),
    suc.estado === 'finalizado' ? 'Finalizado' : suc.estado === 'guardado' ? 'Guardado' : suc.estado === 'separado' ? 'Separado' : 'Pendiente',
    suc.nro_cajas || '',
    suc.fecha_finalizacion ? new Date(suc.fecha_finalizacion).toLocaleDateString('es-AR') : ''
  ]

  if (esSucati && (sucsSucati.length > 0 || sucsChandal.length > 0)) {
    if (sucsSucati.length > 0) {
      rows.push(['— SUCATI S.R.L. —', '', ...talles.map(() => ''), '', '', ''])
      sucsSucati.forEach(suc => rows.push(filaEstado(suc)))
    }
    if (sucsChandal.length > 0) {
      rows.push(['— CHANDAL S.R.L. —', '', ...talles.map(() => ''), '', '', ''])
      sucsChandal.forEach(suc => rows.push(filaEstado(suc)))
    }
    sucsOtras.forEach(suc => rows.push(filaEstado(suc)))
  } else {
    sucursales.forEach(suc => rows.push(filaEstado(suc)))
  }

  // Fila total
  const totalCantidad = sucursales.reduce((s, x) => s + (x.cantidad || 0), 0)
  const totalPorTalle = talles.map(t => sucursales.reduce((s, x) => s + ((x.talles && x.talles[t]) ? Number(x.talles[t]) : 0), 0))
  rows.push(['TOTAL', totalCantidad, ...totalPorTalle, '', '', ''])

  // Crear spreadsheet
  const fechaHoy = new Date().toLocaleDateString('es-AR').replace(/\//g, '-')
  const titulo = 'Art_' + codigo + '_' + cliente + (nroPedido ? '_P' + nroPedido : '') + '_' + fechaHoy
  const sheet = await crearSpreadsheet(token, titulo)
  const spreadsheetId = sheet.spreadsheetId
  const sheetId = sheet.sheets[0].properties.sheetId
  const sheetTitle = 'Distribucion'

  let requests = []

  // Escribir datos y renombrar hoja
  await actualizarHoja(token, spreadsheetId, sheetId, sheetTitle, rows, requests)

  // ── Formatos ──
  // headerRowIdx = índice de la fila del encabezado de tabla (la que tiene "Sucursal", "Cant. Total", etc.)
  const headerRowIdx = rows.findIndex(r => r[0] === 'Sucursal')
  const dataStart = headerRowIdx + 1
  const dataEnd = dataStart + sucursales.length
  const totalRowIdx = dataEnd
  const nCols = headerRow.length

  requests.push(
    // Freeze primera fila de tabla
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: headerRowIdx + 1 } }, fields: 'gridProperties.frozenRowCount' } },

    // Fondo blanco general
    { repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: rows.length, startColumnIndex: 0, endColumnIndex: nCols },
      cell: { userEnteredFormat: { backgroundColor: BLANCO, textFormat: { foregroundColor: TEXTO_NEGRO } } },
      fields: 'userEnteredFormat(backgroundColor,textFormat)'
    }},

    // Título principal
    { repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: nCols },
      cell: { userEnteredFormat: {
        textFormat: { bold: true, fontSize: 13, foregroundColor: BLANCO },
        backgroundColor: AZUL_HEADER
      }},
      fields: 'userEnteredFormat(textFormat,backgroundColor)'
    }},

    // Merge título

    // Filas de metadata (filas 2-5)
    { repeatCell: {
      range: { sheetId, startRowIndex: 2, endRowIndex: 6, startColumnIndex: 0, endColumnIndex: 1 },
      cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: TEXTO_NEGRO } } },
      fields: 'userEnteredFormat.textFormat'
    }},

    // Header tabla
    { repeatCell: {
      range: { sheetId, startRowIndex: headerRowIdx, endRowIndex: headerRowIdx + 1, startColumnIndex: 0, endColumnIndex: nCols },
      cell: { userEnteredFormat: {
        backgroundColor: AZUL_HEADER,
        textFormat: { bold: true, foregroundColor: BLANCO },
        horizontalAlignment: 'CENTER'
      }},
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
    }},

    // Filas de datos alternadas
    { repeatCell: {
      range: { sheetId, startRowIndex: dataStart, endRowIndex: totalRowIdx, startColumnIndex: 0, endColumnIndex: nCols },
      cell: { userEnteredFormat: {
        backgroundColor: BLANCO,
        textFormat: { foregroundColor: TEXTO_NEGRO },
        horizontalAlignment: 'CENTER'
      }},
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
    }},

    // Columna Sucursal: alineada a la izquierda y bold
    { repeatCell: {
      range: { sheetId, startRowIndex: dataStart, endRowIndex: totalRowIdx, startColumnIndex: 0, endColumnIndex: 1 },
      cell: { userEnteredFormat: {
        textFormat: { bold: true, foregroundColor: TEXTO_NEGRO },
        horizontalAlignment: 'LEFT'
      }},
      fields: 'userEnteredFormat(textFormat,horizontalAlignment)'
    }},

    // Fila total
    { repeatCell: {
      range: { sheetId, startRowIndex: totalRowIdx, endRowIndex: totalRowIdx + 1, startColumnIndex: 0, endColumnIndex: nCols },
      cell: { userEnteredFormat: {
        backgroundColor: color(235, 245, 235),
        textFormat: { bold: true, foregroundColor: TEXTO_NEGRO },
        horizontalAlignment: 'CENTER'
      }},
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
    }},

    // Bordes tabla
    { updateBorders: {
      range: { sheetId, startRowIndex: headerRowIdx, endRowIndex: totalRowIdx + 1, startColumnIndex: 0, endColumnIndex: nCols },
      top:    { style: 'SOLID', color: color(180, 180, 180) },
      bottom: { style: 'SOLID', color: color(180, 180, 180) },
      left:   { style: 'SOLID', color: color(180, 180, 180) },
      right:  { style: 'SOLID', color: color(180, 180, 180) },
      innerHorizontal: { style: 'SOLID', color: color(180, 180, 180) },
      innerVertical:   { style: 'SOLID', color: color(180, 180, 180) }
    }},

    // Auto-resize columnas
    { autoResizeDimensions: {
      dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: nCols }
    }}
  )

  await aplicarFormatos(token, spreadsheetId, requests)

  return 'https://docs.google.com/spreadsheets/d/' + spreadsheetId
}

// ─── EXPORT ROMANEO COMPLETO ──────────────────────────────────────────────────

/**
 * Exporta el romaneo completo del pedido a Google Sheets.
 * Columnas: Artículo | Descripción | Precio | Suc | Cant. | [talles] | Total Pedido
 *
 * @param {object} pedido    - con clientes
 * @param {array}  articulos - array de pedido_articulos con sucursales
 */
export async function exportarRomaneoSheets(pedido, articulos) {
  const token = await getValidToken()

  const cliente = pedido.clientes?.nombre || ''
  const nroPedido = pedido.numero_pedido || ''
  const fechaEntrega = pedido.fecha_entrega
    ? new Date(pedido.fecha_entrega).toLocaleDateString('es-AR')
    : ''
  const fechaPedido = pedido.fecha_pedido
    ? new Date(pedido.fecha_pedido).toLocaleDateString('es-AR')
    : ''
  const descuentoPedido = pedido.descuento ? pedido.descuento + '%' : ''

  // Recolectar todos los talles presentes en todos los artículos
  const tallesSet = new Set()
  articulos.forEach(art => {
    ;(art.pedido_sucursales || []).forEach(s => {
      if (s.talles) Object.keys(s.talles).forEach(t => tallesSet.add(String(t)))
    })
  })
  const talles = Array.from(tallesSet).sort((a, b) => Number(a) - Number(b))

  const rows = []

  // Header general
  rows.push(['ROMANEO — ' + cliente.toUpperCase()])
  rows.push([])
  rows.push(['Cliente', cliente, '', 'N° Pedido', nroPedido])
  const razonSocialPedido = pedido.razon_social || ''
  if (razonSocialPedido) rows.push(['FACTURAR A', razonSocialPedido])
  rows.push(['Fecha pedido', fechaPedido, '', 'Fecha entrega', fechaEntrega])
  if (descuentoPedido) rows.push(['Descuento', descuentoPedido])
  rows.push([])

  // Encabezado tabla
  const headerRow = [
    'Artículo', 'Cód. Cliente', 'Descripción', 'Precio Unit.', 'Descuento',
    'Sucursal', 'Cant. Suc.',
    ...talles.map(t => 'T' + t),
    'Total Artículo'
  ]
  rows.push(headerRow)

  const dataStart = rows.length
  let totalGeneral = 0

  articulos.forEach(art => {
    const precio = art.precio_unitario
      ? '$' + Number(art.precio_unitario).toLocaleString('es-AR')
      : ''
    const sucucursales = (art.pedido_sucursales || [])
      .filter(s => s.cantidad > 0)
      .sort((a, b) => Number(a.nro_sucursal) - Number(b.nro_sucursal))

    sucucursales.forEach((suc, idx) => {
      rows.push([
        idx === 0 ? (art.codigo_nuestro || '') : '',  // solo en primera fila del artículo
        idx === 0 ? (art.codigo_cliente || '') : '',
        idx === 0 ? (art.descripcion_correcta || art.descripcion_cliente || '') : '',
        idx === 0 ? precio : '',
        idx === 0 ? descuentoPedido : '',
        'Suc. ' + suc.nro_sucursal,
        suc.cantidad,
        ...talles.map(t => (suc.talles && suc.talles[t]) ? suc.talles[t] : 0),
        idx === 0 ? (art.total_unidades || '') : ''
      ])
    })

    totalGeneral += art.total_unidades || 0
  })

  // Fila total general
  rows.push([])
  rows.push(['TOTAL PEDIDO', '', '', '', '', totalGeneral, ...talles.map(() => ''), ''])

  // Crear spreadsheet
  const titulo = 'Romaneo_' + cliente + (nroPedido ? '_P' + nroPedido : '') + '_' + new Date().toLocaleDateString('es-AR').replace(/\//g, '-')
  const sheet = await crearSpreadsheet(token, titulo)
  const spreadsheetId = sheet.spreadsheetId
  const sheetId = sheet.sheets[0].properties.sheetId
  const sheetTitle = 'Romaneo'

  let requests = []
  await actualizarHoja(token, spreadsheetId, sheetId, sheetTitle, rows, requests)

  const headerRowIdx = 5
  const nCols = headerRow.length
  const totalRowIdx = rows.length - 1

  requests.push(
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: headerRowIdx + 1, frozenColumnCount: 4 } }, fields: 'gridProperties(frozenRowCount,frozenColumnCount)' } },

    // Fondo blanco
    { repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: rows.length, startColumnIndex: 0, endColumnIndex: nCols },
      cell: { userEnteredFormat: { backgroundColor: BLANCO, textFormat: { foregroundColor: TEXTO_NEGRO } } },
      fields: 'userEnteredFormat(backgroundColor,textFormat)'
    }},

    // Título
    { repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: nCols },
      cell: { userEnteredFormat: {
        textFormat: { bold: true, fontSize: 14, foregroundColor: BLANCO },
        backgroundColor: AZUL_HEADER
      }},
      fields: 'userEnteredFormat(textFormat,backgroundColor)'
    }},

    // Metadata labels
    { repeatCell: {
      range: { sheetId, startRowIndex: 2, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: 1 },
      cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: TEXTO_NEGRO } } },
      fields: 'userEnteredFormat.textFormat'
    }},

    // Header tabla
    { repeatCell: {
      range: { sheetId, startRowIndex: headerRowIdx, endRowIndex: headerRowIdx + 1, startColumnIndex: 0, endColumnIndex: nCols },
      cell: { userEnteredFormat: {
        backgroundColor: AZUL_HEADER,
        textFormat: { bold: true, foregroundColor: BLANCO },
        horizontalAlignment: 'CENTER'
      }},
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
    }},

    // Datos
    { repeatCell: {
      range: { sheetId, startRowIndex: dataStart, endRowIndex: totalRowIdx - 1, startColumnIndex: 0, endColumnIndex: nCols },
      cell: { userEnteredFormat: {
        backgroundColor: BLANCO,
        textFormat: { foregroundColor: TEXTO_NEGRO },
        horizontalAlignment: 'CENTER'
      }},
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
    }},

    // Columnas de texto: izquierda
    { repeatCell: {
      range: { sheetId, startRowIndex: dataStart, endRowIndex: totalRowIdx - 1, startColumnIndex: 0, endColumnIndex: 4 },
      cell: { userEnteredFormat: { horizontalAlignment: 'LEFT' } },
      fields: 'userEnteredFormat.horizontalAlignment'
    }},

    // Artículo: bold + azul
    { repeatCell: {
      range: { sheetId, startRowIndex: dataStart, endRowIndex: totalRowIdx - 1, startColumnIndex: 0, endColumnIndex: 1 },
      cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: AZUL_HEADER } } },
      fields: 'userEnteredFormat.textFormat'
    }},

    // Fila total
    { repeatCell: {
      range: { sheetId, startRowIndex: totalRowIdx, endRowIndex: totalRowIdx + 1, startColumnIndex: 0, endColumnIndex: nCols },
      cell: { userEnteredFormat: {
        backgroundColor: color(235, 245, 235),
        textFormat: { bold: true, foregroundColor: TEXTO_NEGRO },
        horizontalAlignment: 'CENTER'
      }},
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
    }},

    // Bordes
    { updateBorders: {
      range: { sheetId, startRowIndex: headerRowIdx, endRowIndex: totalRowIdx + 1, startColumnIndex: 0, endColumnIndex: nCols },
      top:    { style: 'SOLID', color: color(180, 180, 180) },
      bottom: { style: 'SOLID', color: color(180, 180, 180) },
      left:   { style: 'SOLID', color: color(180, 180, 180) },
      right:  { style: 'SOLID', color: color(180, 180, 180) },
      innerHorizontal: { style: 'SOLID', color: color(180, 180, 180) },
      innerVertical:   { style: 'SOLID', color: color(180, 180, 180) }
    }},

    // Auto-resize
    { autoResizeDimensions: { dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: nCols } }}
  )

  await aplicarFormatos(token, spreadsheetId, requests)

  return 'https://docs.google.com/spreadsheets/d/' + spreadsheetId
}
