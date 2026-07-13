// Extrae texto de un PDF usando PDF.js
async function extraerTextoPDF(base64) {
  try {
    // Cargar PDF.js desde CDN
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

      // Agrupar items por posición Y para reconstruir filas
      var filas = {}
      items.forEach(function(item) {
        var y = Math.round(item.transform[5])
        if (!filas[y]) filas[y] = []
        filas[y].push({ x: item.transform[4], text: item.str })
      })

      // Ordenar filas por Y descendente y items por X ascendente
      var ysOrdenados = Object.keys(filas).map(Number).sort(function(a, b) { return b - a })
      ysOrdenados.forEach(function(y) {
        var fila = filas[y].sort(function(a, b) { return a.x - b.x })
        textoCompleto += fila.map(function(i) { return i.text }).join(' ') + '\n'
      })
    }

    return textoCompleto
  } catch(e) {
    return null // Si falla, usar el PDF directo
  }
}

export async function parsearArchivoPedido(archivo, clienteNombre) {
  var apiKey = localStorage.getItem('criterio_anthropic_key')
  if (!apiKey) throw new Error('Falta la API Key. Configurala en Ajustes.')

  var base64 = await fileToBase64(archivo)
  var mimeType = getMimeType(archivo)
  var esPDF = archivo.type === 'application/pdf'

  // Para PDFs, extraer texto primero
  var textoPDF = null
  if (esPDF) {
    textoPDF = await extraerTextoPDF(base64)
  }

  var prompt = construirPrompt(textoPDF)

  var contenido = []
  if (textoPDF) {
    // Mandamos el texto extraído + el PDF para referencia visual
    contenido.push({ type: 'text', text: 'TEXTO EXTRAIDO DEL PDF (usa este para leer las tablas con precision):\n\n' + textoPDF + '\n\n---\n\nAHORA EL DOCUMENTO ORIGINAL PARA REFERENCIA:' })
    contenido.push({ type: 'document', source: { type: 'base64', media_type: mimeType, data: base64 } })
  } else {
    contenido.push({ type: 'document', source: { type: 'base64', media_type: mimeType, data: base64 } })
  }
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

function construirPrompt(textoPDF) {
  return [
    'Sos un asistente que extrae datos de pedidos de indumentaria para Lavalle Comercial SRL.',
    '',
    'PASO 1: Identifica el cliente en el encabezado.',
    'cliente_detectado = "Garcia Reguera", "Balbi", "Sucati" o "desconocido".',
    '',
    'PASO 2: Extrae numero_pedido, fecha_pedido (YYYY-MM-DD), fecha_entrega (YYYY-MM-DD).',
    '',
    'PASO 3 - GARCIA REGUERA:',
    'Busca la seccion DISTRIBUCION. Tiene una tabla donde:',
    '- La primera fila del encabezado tiene los numeros de sucursal (ej: 01 04 06 10 11 13 14 15 17)',
    '- Cada fila de datos tiene: [cod_cliente]-[talle] [cod_nuestro] [descripcion] [cant_suc1] [cant_suc2]... [TOTAL]',
    '- El ULTIMO numero de cada fila es el TOTAL, no es una sucursal',
    '- El talle esta al final del codigo del cliente despues del guion (50789-004 = talle 4, 50789-006 = talle 6, etc)',
    '',
    'Para cada articulo (mismo codigo_nuestro), agrupa los talles y para cada sucursal:',
    '- cantidad = suma de todos los talles en esa sucursal',
    '- talles = {"4": cant_talle4, "6": cant_talle6, "8": cant_talle8, "10": cant_talle10, "12": cant_talle12}',
    'No incluyas sucursales con cantidad 0.',
    '',
    'PASO 4 - BALBI:',
    'La tabla tiene columnas de sucursales (numeros 1 al 23). Cada fila es un articulo por talle.',
    'Agrupa igual que GR.',
    '',
    'PASO 5 - SUCATI/CHANDAL:',
    'Convierte talles: 3→4, 4→6, 5→8, 6→10, 7→12.',
    '',
    'Responde SOLO con JSON valido (sin texto extra ni backticks):',
    '{"cliente_detectado":"string","numero_pedido":"string","fecha_pedido":"YYYY-MM-DD","fecha_entrega":"YYYY-MM-DD","articulos":[{"codigo_nuestro":"string","codigo_cliente":"string","descripcion_cliente":"string","precio_unitario":0,"talles_articulo":["4","6","8","10","12"],"sucursales":[{"nro_sucursal":"string","cantidad":0,"talles":{"4":0,"6":0,"8":0,"10":0,"12":0}}],"modulos":[],"total_unidades":0}]}'
  ].join('\n')
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
