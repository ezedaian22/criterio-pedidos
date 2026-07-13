export async function parsearArchivoPedido(archivo, clienteNombre) {
  var apiKey = localStorage.getItem('criterio_anthropic_key')
  if (!apiKey) throw new Error('Falta la API Key. Configurala en Ajustes.')

  var base64 = await fileToBase64(archivo)
  var mimeType = getMimeType(archivo)

  var prompt = [
    'Sos un asistente que extrae datos de pedidos de indumentaria para Lavalle Comercial SRL.',
    'Analiza el documento adjunto con MUCHO CUIDADO.',
    '',
    'PASO 1: Identifica el cliente en el encabezado del documento.',
    'Si dice "Garcia Reguera" → cliente_detectado = "Garcia Reguera"',
    'Si dice "Balbi" → cliente_detectado = "Balbi"',
    'Si dice "Sucati" o "Chandal" → cliente_detectado = "Sucati"',
    '',
    'PASO 2 - GARCIA REGUERA UNICAMENTE:',
    'Busca la seccion DISTRIBUCION. Tiene una tabla con:',
    '- Encabezado: numeros de sucursal (ej: 01 04 06 10 11 13 14 15 17)',
    '- Filas: [cod_cliente]-[talle] [cod_nuestro] [descripcion] [cant_suc1] [cant_suc2] ...',
    'Ejemplo de fila: "50789-004 128 CANGURO... 3 3 3 2 7 3 3 6" → talle 4, suc01=3, suc04=3, suc06=3, suc10=2, suc11=7, suc13=3, suc14=3, suc15=0, suc17=6',
    '',
    'Para cada articulo (mismo codigo_nuestro):',
    '- Agrupa todas las filas de talles',
    '- Para cada sucursal, suma todos los talles → cantidad total',
    '- Guarda cada talle individual en "talles": {"4": cant, "6": cant, "8": cant, "10": cant, "12": cant}',
    '- Si una sucursal tiene cantidad 0 en todos los talles, NO la incluyas',
    '- Los talles son los numeros despues del guion en el codigo cliente (004=talle 4, 006=talle 6, etc)',
    '',
    'PASO 3 - BALBI:',
    'La tabla tiene columnas de sucursales numeradas 1 al 23.',
    'Cada fila es un articulo con cantidades por sucursal.',
    'Guarda en talles la curva de talles del articulo (la curva viene en las columnas de la tabla por fila de talle).',
    '',
    'PASO 4 - SUCATI/CHANDAL:',
    'Talles: 3=talle4, 4=talle6, 5=talle8, 6=talle10, 7=talle12.',
    'Sucursales 0 al 23.',
    '',
    'IMPORTANTE: La curva de talles del articulo va en el campo "talles_articulo" (ej: ["4","6","8","10","12"]).',
    '',
    'Responde UNICAMENTE con JSON valido sin texto extra ni backticks:',
    '{"cliente_detectado":"Garcia Reguera","numero_pedido":"string","fecha_pedido":"YYYY-MM-DD","fecha_entrega":"YYYY-MM-DD","articulos":[{"codigo_nuestro":"string","codigo_cliente":"string","descripcion_cliente":"string","precio_unitario":0,"talles_articulo":["4","6","8","10","12"],"sucursales":[{"nro_sucursal":"string","cantidad":0,"talles":{"4":0,"6":0,"8":0,"10":0,"12":0}}],"modulos":[],"total_unidades":0}]}'
  ].join('\n')

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
