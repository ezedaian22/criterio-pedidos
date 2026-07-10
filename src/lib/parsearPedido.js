export async function parsearArchivoPedido(archivo, clienteNombre) {
  var apiKey = localStorage.getItem('criterio_anthropic_key')
  if (!apiKey) throw new Error('Falta la API Key. Configurala en Ajustes.')

  var base64 = await fileToBase64(archivo)
  var mimeType = getMimeType(archivo)

  var infoSucursales = ''
  var nombreLower = archivo.name.toLowerCase()
  if (nombreLower.includes('_bb') || nombreLower.includes('balbi') || clienteNombre === 'Balbi') {
    infoSucursales = 'Cliente BALBI: sucursales del 1 al 23 (empresa Hijos: suc 1-17, empresa Retail: suc 18-23).'
  } else if (nombreLower.includes('_gr') || nombreLower.includes('garcia') || nombreLower.includes('reguera') || clienteNombre === 'García Reguera') {
    infoSucursales = 'Cliente GARCIA REGUERA: sucursales 01, 04, 06, 10, 11, 13, 14.'
  } else if (nombreLower.includes('_suc') || nombreLower.includes('sucati') || nombreLower.includes('chandal') || clienteNombre === 'Sucati') {
    infoSucursales = 'Cliente SUCATI/CHANDAL: sucursales del 0 al 23. La sucursal 0 es entrega final. Talles: 3=4, 4=6, 5=8, 6=10, 7=12.'
  } else {
    infoSucursales = 'Detecta las sucursales del archivo.'
  }

  var prompt = 'Analiza este archivo de pedido y extrae TODA la informacion de distribucion por sucursal. ' +
    infoSucursales + ' ' +
    'El codigo_nuestro es el codigo interno de Lavalle Comercial (el numero que aparece como codigo del proveedor). ' +
    'codigo_cliente es el codigo que usa el cliente si es diferente. ' +
    'sucursales es la lista completa de sucursales con su cantidad de unidades de ese articulo. ' +
    'Devuelve UNICAMENTE este JSON, sin ningun texto antes ni despues, sin backticks: ' +
    '{"numero_pedido":"string o null","fecha_pedido":"YYYY-MM-DD o null","fecha_entrega":"YYYY-MM-DD","articulos":[{"codigo_nuestro":"string","codigo_cliente":"string o null","descripcion_cliente":"string","precio_unitario":0,"variantes":[],"sucursales":[{"nro_sucursal":"string","cantidad":0}],"modulos":[],"total_unidades":0}]}'

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
    throw new Error('Respuesta IA (debug): ' + texto.slice(0, 500))
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
