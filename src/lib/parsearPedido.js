export async function parsearArchivoPedido(archivo, clienteNombre) {
  var apiKey = localStorage.getItem('criterio_anthropic_key')
  if (!apiKey) throw new Error('Falta la API Key. Configurala en Ajustes.')

  var base64 = await fileToBase64(archivo)
  var mimeType = getMimeType(archivo)

  var prompt = 'Sos un asistente que extrae datos de pedidos de indumentaria para Lavalle Comercial SRL. ' +
    'Analizá el archivo adjunto. ' +
    'IMPORTANTE para Garcia Reguera: en la tabla de distribucion, la columna "Origen" es el codigo de Lavalle (codigo_nuestro), la columna "Articulo" es el codigo del cliente (codigo_cliente). Los numeros como 004,006,008,010,012 al inicio del codigo del cliente son TALLES, no sucursales separadas. Cada articulo tiene multiples filas de talles. Las columnas 01,04,06,10,11,13,14,15,17 son las sucursales. Para cada articulo (mismo codigo_nuestro), suma las cantidades de todos los talles por sucursal para obtener el total por sucursal. Guarda la curva de talles como objeto donde la clave es el talle y el valor es la cantidad por sucursal (no el total). ' +
    'Para Balbi: las sucursales son columnas numeradas del 1 al 23. ' +
    'Para Sucati/Chandal: talles equivalen 3=4, 4=6, 5=8, 6=10, 7=12. Sucursales 0 al 23. ' +
    'Respondé ÚNICAMENTE con un objeto JSON válido sin texto extra ni backticks ni markdown. El JSON debe tener exactamente este formato: ' +
    '{"numero_pedido":"string o null","fecha_pedido":"YYYY-MM-DD o null","fecha_entrega":"YYYY-MM-DD","articulos":[{"codigo_nuestro":"string","codigo_cliente":"string o null","descripcion_cliente":"string","precio_unitario":0,"curva_talles":{"4":3,"6":3,"8":3,"10":2,"12":7},"sucursales":[{"nro_sucursal":"string","cantidad":0}],"modulos":[],"total_unidades":0}]}'

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
          { type: 'document', source: { type: 'base64', media_type: mimeType, data: base64 } },
          { type: 'text', text: prompt }
        ]
      }]
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
    throw new Error('Debug: ' + clean.slice(0, 400))
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
