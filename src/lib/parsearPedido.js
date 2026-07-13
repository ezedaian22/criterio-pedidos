async function extraerTextoPDF(base64) {
  try {
    if (!window.pdfjsLib) {
      await new Promise(function(resolve, reject) {
        var script = document.createElement('script')
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
        script.onload = resolve
        script.onerror = reject
        document.head.appendChild(script)
      })
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
    }
    var pdfData = atob(base64)
    var pdfBytes = new Uint8Array(pdfData.length)
    for (var i = 0; i < pdfData.length; i++) pdfBytes[i] = pdfData.charCodeAt(i)
    var pdf = await window.pdfjsLib.getDocument({ data: pdfBytes }).promise
    var textoCompleto = ''
    for (var p = 1; p <= pdf.numPages; p++) {
      var page = await pdf.getPage(p)
      var content = await page.getTextContent()
      var items = content.items
      var filas = {}
      items.forEach(function(item) {
        var y = Math.round(item.transform[5])
        if (!filas[y]) filas[y] = []
        filas[y].push({ x: item.transform[4], text: item.str })
      })
      var ysOrdenados = Object.keys(filas).map(Number).sort(function(a, b) { return b - a })
      ysOrdenados.forEach(function(y) {
        var fila = filas[y].sort(function(a, b) { return a.x - b.x })
        textoCompleto += fila.map(function(i) { return i.text }).join('\t') + '\n'
      })
    }
    return textoCompleto
  } catch(e) {
    return null
  }
}

export async function parsearArchivoPedido(archivo, clienteNombre) {
  var apiKey = localStorage.getItem('criterio_anthropic_key')
  if (!apiKey) throw new Error('Falta la API Key. Configurala en Ajustes.')

  var base64 = await fileToBase64(archivo)
  var mimeType = getMimeType(archivo)
  var esPDF = archivo.type === 'application/pdf'

  var textoPDF = null
  if (esPDF) textoPDF = await extraerTextoPDF(base64)

  var prompt = [
    'Sos un asistente que extrae datos de pedidos de indumentaria para Lavalle Comercial SRL.',
    '',
    '=== REGLAS CRITICAS PARA GARCIA REGUERA ===',
    'En la tabla DISTRIBUCION hay dos columnas clave:',
    '- Columna "Artículo" o "Articulo": contiene el CODIGO DEL CLIENTE (ej: 50789-004). Este va en codigo_cliente.',
    '- Columna "Origen": contiene el CODIGO NUESTRO de Lavalle (ej: 128, 2171). Este va en codigo_nuestro.',
    'NUNCA pongas el codigo del cliente en codigo_nuestro. Son campos distintos.',
    '',
    'El talle está al final del codigo del cliente tras el guion: 50789-004 = talle 4, 50789-006 = talle 6.',
    '',
    'Las columnas de sucursales vienen DESPUES de la descripcion.',
    'El ULTIMO numero de cada fila es el TOTAL, no es una sucursal.',
    'Lee el encabezado de la tabla para saber qué número de sucursal corresponde a cada columna.',
    '',
    'Para cada codigo_nuestro, agrupa todos los talles y calcula por sucursal:',
    '- cantidad: suma de todos los talles',
    '- talles: {"4": cant, "6": cant, "8": cant, "10": cant, "12": cant}',
    'Omite sucursales con cantidad 0.',
    '',
    '=== PARA BALBI ===',
    'Las columnas son sucursales 1 al 23. Agrupa por codigo_nuestro igual.',
    '',
    '=== PARA SUCATI/CHANDAL ===',
    'Convierte talles: 3→4, 4→6, 5→8, 6→10, 7→12.',
    '',
    '=== DETECCION DE CLIENTE ===',
    'Lee el encabezado. Si dice "Garcia Reguera" → "Garcia Reguera". Si dice "Balbi" → "Balbi". Si dice "Sucati" o "Chandal" → "Sucati".',
    '',
    'Responde SOLO con JSON (sin texto extra ni backticks):',
    '{"cliente_detectado":"string","numero_pedido":"string","fecha_pedido":"YYYY-MM-DD","fecha_entrega":"YYYY-MM-DD","articulos":[{"codigo_nuestro":"string","codigo_cliente":"string","descripcion_cliente":"string","precio_unitario":0,"talles_articulo":["4","6","8","10","12"],"sucursales":[{"nro_sucursal":"string","cantidad":0,"talles":{"4":0,"6":0}}],"modulos":[],"total_unidades":0}]}'
  ].join('\n')

  var contenido = []
  if (textoPDF) {
    contenido.push({ type: 'text', text: 'TEXTO DEL PDF (usa esto para leer las tablas con precision):\n\n' + textoPDF })
  }
  contenido.push({ type: 'document', source: { type: 'base64', media_type: mimeType, data: base64 } })
  contenido.push({ type: 'text', text: prompt })

  var response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      messages: [{ role: 'user', content: contenido }]
    })
  })

  if (!response.ok) {
    var err = await response.text()
    throw new Error('Error API: ' + err.slice(0, 300))
  }

  var data = await response.json()
  var bloque = data.content && data.content.find(function(b) { return b.type === 'text' })
  var texto = bloque ? bloque.text : ''
  if (!texto) throw new Error('Sin respuesta de la IA.')

  var clean = texto.replace(/```json/g, '').replace(/```/g, '').trim()
  var jsonMatch = clean.match(/\{[\s\S]*\}/)
  if (jsonMatch) clean = jsonMatch[0]

  try {
    return JSON.parse(clean)
  } catch(e) {
    throw new Error('Debug: ' + clean.slice(0, 500))
  }
}

function getMimeType(archivo) {
  if (archivo.type === 'application/pdf') return 'application/pdf'
  if (archivo.name.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  if (archivo.name.endsWith('.xls')) return 'application/vnd.ms-excel'
  return 'application/pdf'
}

function fileToBase64(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader()
    reader.onload = function() { resolve(reader.result.split(',')[1]) }
    reader.onerror = function() { reject(new Error('No se pudo leer el archivo')) }
    reader.readAsDataURL(file)
  })
}
