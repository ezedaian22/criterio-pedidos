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
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
    }
    var raw = atob(base64)
    var bytes = new Uint8Array(raw.length)
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
    var pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise

    // Extraer items con posicion X,Y de TODAS las paginas
    var todosItems = []
    for (var p = 1; p <= pdf.numPages; p++) {
      var page = await pdf.getPage(p)
      var vp = page.getViewport({ scale: 1 })
      var content = await page.getTextContent()
      content.items.forEach(function(item) {
        if (item.str.trim()) {
          todosItems.push({
            x: Math.round(item.transform[4]),
            y: Math.round(vp.height - item.transform[5]), // invertir Y para que 0 sea arriba
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

function parsearGR(items) {
  if (!items || !items.length) return null

  // Encontrar items que contengan codigos tipo "50789-004" o "53703-004"
  // Esos son las filas de distribucion
  var filasDistrib = {}

  items.forEach(function(item) {
    if (/^\d{5}-\d{3}$/.test(item.text)) {
      // Es un codigo de articulo-talle
      var key = Math.round(item.y / 2) * 2 // agrupar por Y cercano
      if (!filasDistrib[key]) filasDistrib[key] = []
      filasDistrib[key].push(item)
    }
  })

  if (Object.keys(filasDistrib).length === 0) return null

  // Encontrar el encabezado de sucursales (numeros de 2 digitos en la misma zona X que las cantidades)
  // Buscar la fila que tiene solo numeros de 2 digitos ANTES de las filas de distribucion
  var primeraFilaY = Math.min.apply(null, Object.keys(filasDistrib).map(Number))

  // Items numericos de 2 digitos que esten justo ARRIBA de la primera fila de datos
  var encabezadoItems = items.filter(function(item) {
    return /^\d{2}$/.test(item.text) && item.y < primeraFilaY && item.y > primeraFilaY - 100
  }).sort(function(a, b) { return a.x - b.x })

  var sucursales = encabezadoItems.map(function(i) { return i.text })

  if (sucursales.length === 0) {
    // Fallback: buscar encabezado buscando patron de numeros de 2 digitos consecutivos
    var candidatos = items.filter(function(item) {
      return /^\d{2}$/.test(item.text) && item.y < primeraFilaY
    })
    // Agrupar por Y
    var porY = {}
    candidatos.forEach(function(item) {
      var y = Math.round(item.y / 3) * 3
      if (!porY[y]) porY[y] = []
      porY[y].push(item)
    })
    // La fila con más números de 2 dígitos es el encabezado
    var mejorY = null, mejorCant = 0
    Object.keys(porY).forEach(function(y) {
      if (porY[y].length > mejorCant) {
        mejorCant = porY[y].length
        mejorY = y
      }
    })
    if (mejorY) {
      sucursales = porY[mejorY].sort(function(a, b) { return a.x - b.x }).map(function(i) { return i.text })
      encabezadoItems = porY[mejorY].sort(function(a, b) { return a.x - b.x })
    }
  }

  if (sucursales.length === 0) return null

  // Para cada fila de distribucion, encontrar los items por X que coincidan con las columnas de sucursal
  var articulos = {}
  var ysFilas = Object.keys(filasDistrib).map(Number).sort(function(a, b) { return a - b })

  ysFilas.forEach(function(yFila) {
    var filaItems = filasDistrib[yFila]
    var codigoItem = filaItems[0]
    var match = codigoItem.text.match(/^(\d+)-(\d+)$/)
    if (!match) return

    var codCliente = match[1]
    var talle = String(parseInt(match[2]))

    // Buscar todos los items en la misma fila (mismo Y aproximado)
    var itemsFila = items.filter(function(item) {
      return Math.abs(item.y - yFila) <= 5
    }).sort(function(a, b) { return a.x - b.x })

    // El segundo item despues del codigo es el codigo_nuestro
    var idx = itemsFila.findIndex(function(i) { return i.text === codigoItem.text })
    if (idx === -1) return

    var codNuestro = itemsFila[idx + 1] ? itemsFila[idx + 1].text : ''
    if (!codNuestro || !/^\d+$/.test(codNuestro)) return

    // Encontrar cantidades por X (alineadas con columnas de sucursal)
    var cantidades = {}
    encabezadoItems.forEach(function(enc) {
      // Buscar item en la fila que tenga X cercano al encabezado
      var itemCercano = itemsFila.find(function(fi) {
        return Math.abs(fi.x - enc.x) <= 15 && /^\d+$/.test(fi.text) && fi.text !== codNuestro && fi.text !== codigoItem.text
      })
      if (itemCercano) {
        cantidades[enc.text] = parseInt(itemCercano.text)
      }
    })

    if (!articulos[codNuestro]) {
      // Descripcion: items entre codNuestro y primeras cantidades
      var descItems = itemsFila.filter(function(fi) {
        return fi.x > itemsFila[idx + 1].x && !Object.values(cantidades).includes(parseInt(fi.text))
      })
      var desc = descItems.filter(function(fi) { return /[A-Za-z]/.test(fi.text) }).map(function(fi) { return fi.text }).join(' ')

      articulos[codNuestro] = {
        codigo_nuestro: codNuestro,
        codigo_cliente: codCliente,
        descripcion_cliente: desc,
        precio_unitario: 0,
        talles_articulo: [],
        sucursales: {},
        total_unidades: 0,
        modulos: []
      }
    }

    var art = articulos[codNuestro]
    if (art.talles_articulo.indexOf(talle) === -1) art.talles_articulo.push(talle)

    Object.keys(cantidades).forEach(function(suc) {
      var cant = cantidades[suc]
      if (!cant || cant === 0) return
      if (!art.sucursales[suc]) {
        art.sucursales[suc] = { nro_sucursal: suc, cantidad: 0, talles: {} }
      }
      art.sucursales[suc].talles[talle] = cant
      art.sucursales[suc].cantidad += cant
      art.total_unidades += cant
    })
  })

  return Object.values(articulos).map(function(art) {
    art.talles_articulo.sort(function(a, b) { return Number(a) - Number(b) })
    art.sucursales = Object.values(art.sucursales).filter(function(s) { return s.cantidad > 0 })
    return art
  })
}

async function llamarIA(apiKey, base64, mimeType, textoPDF, esGR) {
  var prompt = esGR
    ? 'Este es un pedido de Garcia Reguera para Lavalle Comercial. Extrae SOLO: numero_pedido, fecha_pedido (YYYY-MM-DD), fecha_entrega (YYYY-MM-DD). Responde SOLO con JSON: {"cliente_detectado":"Garcia Reguera","numero_pedido":"string","fecha_pedido":"YYYY-MM-DD","fecha_entrega":"YYYY-MM-DD"}'
    : [
        'Sos un asistente que extrae datos de pedidos para Lavalle Comercial SRL.',
        'cliente_detectado = "Garcia Reguera", "Balbi", "Sucati" o "desconocido".',
        'BALBI: columnas = sucursales 1-23. codigo_nuestro son los nuestros (170,171,2120 etc). Agrupa por codigo_nuestro sumando talles por sucursal.',
        'SUCATI: talles 3→4, 4→6, 5→8, 6→10, 7→12. Sucursales 0-23.',
        'Responde SOLO con JSON: {"cliente_detectado":"string","numero_pedido":"string","fecha_pedido":"YYYY-MM-DD","fecha_entrega":"YYYY-MM-DD","articulos":[{"codigo_nuestro":"string","codigo_cliente":"string","descripcion_cliente":"string","precio_unitario":0,"talles_articulo":["4","6","8","10","12"],"sucursales":[{"nro_sucursal":"string","cantidad":0,"talles":{"4":0,"6":0}}],"modulos":[],"total_unidades":0}]}'
      ].join('\n')

  var contenido = []
  if (textoPDF) contenido.push({ type: 'text', text: 'TEXTO DEL PDF:\n' + textoPDF.slice(0, 3000) })
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

  if (!response.ok) throw new Error('Error API: ' + (await response.text()).slice(0, 200))
  var data = await response.json()
  var texto = (data.content.find(function(b) { return b.type === 'text' }) || {}).text || ''
  var clean = texto.replace(/```json/g, '').replace(/```/g, '').trim()
  var m = clean.match(/\{[\s\S]*\}/)
  return JSON.parse(m ? m[0] : clean)
}

export async function parsearArchivoPedido(archivo, clienteNombre) {
  var apiKey = localStorage.getItem('criterio_anthropic_key')
  if (!apiKey) throw new Error('Falta la API Key. Configurala en Ajustes.')

  var base64 = await fileToBase64(archivo)
  var mimeType = getMimeType(archivo)
  var esPDF = archivo.type === 'application/pdf'

  var items = null
  var textoPDF = null
  if (esPDF) {
    items = await extraerTextoPDF(base64)
    if (items) {
      textoPDF = items.map(function(i) { return i.text }).join(' ')
    }
  }

  var esGR = false
  if (textoPDF) {
    esGR = textoPDF.toLowerCase().includes('garcia reguera') ||
           textoPDF.toLowerCase().includes('galver')
  }
  if (!esGR) {
    var nombre = archivo.name.toLowerCase()
    esGR = nombre.includes('_gr') || nombre.includes('garcia') || nombre.includes('reguera')
  }

  if (esGR && items) {
    // DEBUG: mostrar items de la zona de distribucion
    var itemsDistrib = items.filter(function(i) {
      return /^\d{5}-\d{3}$/.test(i.text) || /^\d{2}$/.test(i.text)
    }).slice(0, 30)
    throw new Error('DEBUG items: ' + JSON.stringify(itemsDistrib.map(function(i){ return {t:i.text,x:i.x,y:i.y} })))
  }

  // Fallback: IA interpreta todo
  var resultado = await llamarIA(apiKey, base64, mimeType, textoPDF, false)
  return resultado
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
