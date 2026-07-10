export async function parsearArchivoPedido(archivo, clienteNombre) {
  const apiKey = localStorage.getItem('criterio_gemini_key')
  if (!apiKey) throw new Error('Falta la API Key. Configurala en Ajustes.')

  const base64 = await fileToBase64(archivo)
  const mimeType = getMimeType(archivo)

  const prompt = 'Analiza este archivo de pedido del cliente "' + clienteNombre + '" y extrae la informacion. ' +
    'Devuelve SOLO JSON sin backticks: { "numero_pedido": "string o null", "fecha_pedido": "YYYY-MM-DD o null", "fecha_entrega": "YYYY-MM-DD", "articulos": [ { "codigo_nuestro": "string", "codigo_cliente": "string o null", "descripcion_cliente": "string", "precio_unitario": 0, "variantes": [], "sucursales": [ { "nro_sucursal": "string", "cantidad": 0 } ], "modulos": [], "total_unidades": 0 } ] } ' +
    'Para Balbi sucursales 1 al 23. Para Garcia Reguera sucursales 01 04 06 10 11 13 14. Para Sucati/Chandal sucursales 0 al 23 la 0 es entrega final. ' +
    'codigo_nuestro es el codigo de Lavalle. Sucati talles: 3=4, 4=6, 5=8, 6=10, 7=12.'

  var isNewFormat = apiKey.startsWith('AQ.')
  var url = isNewFormat
    ? 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
    : 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey

  var headers = { 'Content-Type': 'application/json' }
  if (isNewFormat) headers['x-goog-api-key'] = apiKey

  var body = {
    contents: [{
      parts: [
        { inline_data: { mime_type: mimeType, data: base64 } },
        { text: prompt }
      ]
    }],
    generationConfig: { temperature: 0, maxOutputTokens: 4000 }
  }

  var response = await fetch(url, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    var err = await response.text()
    throw new Error('Error API: ' + err.slice(0, 300))
  }

  var data = await response.json()
  var bloque = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0]
  var texto = bloque ? bloque.text : ''

  if (!texto) throw new Error('La IA no devolvio respuesta. Intenta de nuevo.')

  try {
    var clean = texto.replace(/```json/g, '').replace(/```/g, '').trim()
    return JSON.parse(clean)
  } catch(e) {
    throw new Error('No se pudo interpretar la respuesta. Intenta de nuevo.')
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
