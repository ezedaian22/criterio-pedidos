export async function parsearArchivoPedido(archivo, clienteNombre) {
  var apiKey = localStorage.getItem('criterio_anthropic_key')
  if (!apiKey) throw new Error('Falta la API Key. Configurala en Ajustes.')

  var base64 = await fileToBase64(archivo)
  var mimeType = getMimeType(archivo)

  var prompt = 'Sos un asistente que extrae datos de pedidos de indumentaria para Lavalle Comercial SRL. Analiza el archivo adjunto.\n\n' +

    'GARCIA REGUERA - MUY IMPORTANTE: El PDF tiene DOS secciones. La primera es la NOTA DE PEDIDO con cantidades totales por talle (ignorala para la distribucion). La segunda seccion se llama DISTRIBUCION y es la que debes usar. En la DISTRIBUCION: cada fila representa UN TALLE de un articulo. Las columnas son sucursales (01, 04, 06, 10, 11, 13, 14, etc). El numero al final del codigo del articulo (50789-004) indica el talle (004=talle 4). El campo "Origen" es el codigo_nuestro (128, 2171). Para cada articulo (mismo codigo_nuestro), agrupa todas las filas de talles y construye la distribucion por sucursal: por cada sucursal, suma las cantidades de todos los talles para obtener el total, y guarda cada talle individual en el objeto "talles". Ejemplo: si suc 04 tiene 3 unidades de cada uno de los 5 talles, entonces cantidad=15 y talles={"4":3,"6":3,"8":3,"10":3,"12":3}.\n\n' +

    'BALBI: Las sucursales son columnas numeradas 1 al 23. Cada fila es un articulo con cantidades por sucursal.\n\n' +

    'SUCATI/CHANDAL: Talles equivalen 3=4, 4=6, 5=8, 6=10, 7=12. Sucursales 0 al 23.\n\n' +

    'Para detectar el cliente, lee el encabezado del documento: si dice "Garcia Reguera" el cliente es Garcia Reguera, si dice "Balbi" es Balbi, si dice "Sucati" o "Chandal" es Sucati.\n\n' +

    'Responde UNICAMENTE con JSON valido sin texto extra ni backticks:\n' +
    '{"cliente_detectado":"Garcia Reguera|Balbi|Sucati|desconocido","numero_pedido":"string o null","fecha_pedido":"YYYY-MM-DD o null","fecha_entrega":"YYYY-MM-DD","articulos":[{"codigo_nuestro":"string","codigo_cliente":"string o null","descripcion_cliente":"string","precio_unitario":0,"sucursales":[{"nro_sucursal":"string","cantidad":0,"talles":{"4":0,"6":0,"8":0,"10":0,"12":0}}],"modulos":[],"total_unidades":0}]}'

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
