async function extraerItemsPDF(base64) {
  try {
    if (!window.pdfjsLib) {
      await new Promise(function(resolve, reject) {
        var script = document.createElement('script')
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
        script.onload = resolve
        script.onerror = reject
        document.head.appendChild(script)
      })
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
    }
    var raw = atob(base64)
    var bytes = new Uint8Array(raw.length)
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
    var pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise
    var todosItems = []
    for (var p = 1; p <= pdf.numPages; p++) {
      var page = await pdf.getPage(p)
      var content = await page.getTextContent()
      content.items.forEach(function(item) {
        if (item.str.trim()) {
          todosItems.push({
            x: Math.round(item.transform[4]),
            y: Math.round(item.transform[5]),
            text: item.str.trim(),
            pagina: p
          })
        }
      })
    }
    return todosItems
  } catch(e) {
    return null
  }
}

// Convierte los items del PDF en texto tabular estructurado para la IA
function itemsATexto(items) {
  if (!items) return ''
  
  // Agrupar por Y (fila) con tolerancia de 3px
  var filas = {}
  items.forEach(function(item) {
    var yKey = Math.round(item.y / 3) * 3
    if (!filas[yKey]) filas[yKey] = []
    filas[yKey].push(item)
  })
  
  // Ordenar filas por Y descendente (arriba = mayor Y en PDF)
  var ys = Object.keys(filas).map(Number).sort(function(a, b) { return b - a })
  
  var lineas = []
  ys.forEach(function(y) {
    var fila = filas[y].sort(function(a, b) { return a.x - b.x })
    lineas.push(fila.map(function(i) { return i.text }).join(' | '))
  })
  
  return lineas.join('\n')
}

export async function parsearArchivoPedido(archivo, clienteNombre) {
  var apiKey = localStorage.getItem('criterio_anthropic_key')
  if (!apiKey) throw new Error('Falta la API Key. Configurala en Ajustes.')

  var base64 = await fileToBase64(archivo)
  var mimeType = getMimeType(archivo)
  var esPDF = archivo.type === 'application/pdf'

  var items = null
  var textoEstructurado = ''
  if (esPDF) {
    items = await extraerItemsPDF(base64)
    if (items) textoEstructurado = itemsATexto(items)
  }

  var prompt = [
    'Sos un asistente que extrae datos de pedidos de indumentaria para Lavalle Comercial SRL.',
    '',
    'Te doy el texto del PDF donde cada linea es una fila y los elementos estan separados por |',
    'Asi podes leer las columnas con precision.',
    '',
    'REGLAS:',
    '1. cliente_detectado: lee el encabezado. "Garcia Reguera" / "Balbi" / "Sucati" / "desconocido"',
    '2. Para GARCIA REGUERA: busca la seccion DISTRIBUCION.',
    '   - Hay una fila de encabezado con numeros de sucursal (01, 04, 06, 10, 11, 13, 14, 15, 17)',
    '   - Cada fila de datos tiene: [codigo_cliente]-[talle] | [codigo_nuestro] | [descripcion] | [cant_suc1] | [cant_suc2] | ... | [TOTAL]',
    '   - El ULTIMO numero es el TOTAL, ignoralo',
    '   - codigo_nuestro es el campo "Origen" (128, 2171, etc)',
    '   - codigo_cliente es el campo "Articulo" sin el talle (50789, 53703, etc)',
    '   - el talle es el numero al final del codigo (50789-004 = talle 4)',
    '   - Agrupa por codigo_nuestro. Para cada sucursal: cantidad = suma talles, talles = {"4":X,"6":X,...}',
    '3. Para BALBI: sucursales 1-23 en columnas. codigo_nuestro = codigo de Lavalle (170, 171, 2120, etc)',
    '4. Para SUCATI: talles 3->4, 4->6, 5->8, 6->10, 7->12. Sucursales 0-23.',
    '',
    'TEXTO DEL PDF (fila por fila, columnas separadas por |):',
    textoEstructurado,
    '',
    'Responde SOLO con JSON valido (sin texto extra ni backticks):',
    '{"cliente_detectado":"string","numero_pedido":"string","fecha_pedido":"YYYY-MM-DD","fecha_entrega":"YYYY-MM-DD","articulos":[{"codigo_nuestro":"string","codigo_cliente":"string","descripcion_cliente":"string","precio_unitario":0,"talles_articulo":["4","6","8","10","12"],"sucursales":[{"nro_sucursal":"string","cantidad":0,"talles":{"4":0,"6":0,"8":0,"10":0,"12":0}}],"modulos":[],"total_unidades":0}]}'
  ].join('\n')

  // Para el contexto visual mandamos solo el PDF (sin texto duplicado en contenido)
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
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt }
        ]
      }]
    })
  })

  if (!response.ok) throw new Error('Error API: ' + (await response.text()).slice(0, 200))
  var data = await response.json()
  var texto = (data.content.find(function(b) { return b.type === 'text' }) || {}).text || ''
  var clean = texto.replace(/```json/g, '').replace(/```/g, '').trim()
  var m = clean.match(/\{[\s\S]*\}/)
  try {
    return JSON.parse(m ? m[0] : clean)
  } catch(e) {
    throw new Error('Error parseando respuesta: ' + clean.slice(0, 300))
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
