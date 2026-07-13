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

function parsearGR(items) {
  if (!items || !items.length) return null

  // Los codigos de articulo-talle tienen formato NNNNN-NNN
  var codigosArtTalle = items.filter(function(i) {
    return /^\d{5}-\d{3}$/.test(i.text)
  })
  if (codigosArtTalle.length === 0) return null

  // Agrupar codigos por Y (cada Y distinto = una fila de talle)
  // Los codigos tienen todos el mismo X aproximado
  var xCodigos = codigosArtTalle[0].x

  // Los numeros de sucursal son de 2 digitos y tienen todos el mismo X
  // Segun el debug: x=96 para las sucursales
  // Buscamos items de 2 digitos que esten en la zona de la distribucion
  var yCodigos = codigosArtTalle.map(function(i) { return i.y })
  var yMin = Math.min.apply(null, yCodigos)
  var yMax = Math.max.apply(null, yCodigos)

  // Items de 2 digitos cerca del area de distribucion (tolerancia amplia)
  var itemsSuc = items.filter(function(i) {
    return /^\d{2}$/.test(i.text) &&
           i.y >= yMin - 80 && i.y <= yMax + 80
  })

  // El X de los numeros de sucursal en el encabezado
  // Agrupar por X para encontrar las columnas
  var colsX = {}
  itemsSuc.forEach(function(i) {
    var xKey = Math.round(i.x / 5) * 5
    if (!colsX[xKey]) colsX[xKey] = []
    colsX[xKey].push(i)
  })

  // Las columnas de sucursal son los X que tienen items en la fila de encabezado
  // El encabezado esta ARRIBA de los codigos (Y mayor en PDF.js = mas arriba)
  var yEncabezado = yMax + 30 // encabezado esta arriba del area de datos

  // Encontrar la fila de encabezado: buscar Y que tenga varios numeros de 2 digitos
  var porY = {}
  itemsSuc.forEach(function(i) {
    var yKey = Math.round(i.y / 4) * 4
    if (!porY[yKey]) porY[yKey] = []
    porY[yKey].push(i)
  })

  // La fila con mas elementos es el encabezado
  var encabezadoY = null
  var encabezadoItems = []
  Object.keys(porY).forEach(function(y) {
    if (porY[y].length > encabezadoItems.length) {
      encabezadoItems = porY[y]
      encabezadoY = Number(y)
    }
  })

  if (encabezadoItems.length === 0) return null

  // Ordenar encabezado por X
  encabezadoItems = encabezadoItems.sort(function(a, b) { return a.x - b.x })
  var sucursales = encabezadoItems.map(function(i) { return i.text })
  var xSucursales = encabezadoItems.map(function(i) { return i.x })

  // Ahora parsear cada fila de codigo-talle
  var articulos = {}

  codigosArtTalle.forEach(function(codItem) {
    var match = codItem.text.match(/^(\d+)-(\d+)$/)
    if (!match) return

    var codCliente = match[1]
    var talle = String(parseInt(match[2]))
    var yFila = codItem.y

    // Buscar codigo_nuestro: item numerico en la misma fila, X diferente al codigo cliente
    var itemsFila = items.filter(function(i) {
      return Math.abs(i.y - yFila) <= 6 && i.text !== codItem.text
    }).sort(function(a, b) { return a.x - b.x })

    // Codigo nuestro: primer numero corto (1-4 digitos) despues del codigo cliente
    var codNuestro = null
    var descItems = []
    itemsFila.forEach(function(fi) {
      if (!codNuestro && /^\d{1,4}$/.test(fi.text) && fi.x > codItem.x) {
        codNuestro = fi.text
      } else if (codNuestro && /[A-Za-z]/.test(fi.text)) {
        descItems.push(fi.text)
      }
    })

    if (!codNuestro) return

    // Para cada sucursal, buscar el numero en esa columna X
    var cantidades = {}
    xSucursales.forEach(function(xSuc, idx) {
      var suc = sucursales[idx]
      // Buscar item en la fila con X cercano a la columna de sucursal
      var itemCol = itemsFila.find(function(fi) {
        return Math.abs(fi.x - xSuc) <= 12 && /^\d+$/.test(fi.text)
      })
      if (itemCol) {
        cantidades[suc] = parseInt(itemCol.text)
      }
    })

    if (!articulos[codNuestro]) {
      articulos[codNuestro] = {
        codigo_nuestro: codNuestro,
        codigo_cliente: codCliente,
        descripcion_cliente: descItems.join(' '),
        precio_unitario: 0,
        talles_articulo: [],
        sucursales: {},
        total_unidades: 0,
        modulos: []
      }
    }

    var art = articulos[codNuestro]
    if (art.talles_articulo.indexOf(talle) === -1) {
      art.talles_articulo.push(talle)
    }

    Object.keys(cantidades).forEach(function(suc) {
      var cant = cantidades[suc]
      if (!cant) return
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
    art.sucursales = Object.values(art.sucursales)
      .filter(function(s) { return s.cantidad > 0 })
      .sort(function(a, b) { return Number(a.nro_sucursal) - Number(b.nro_sucursal) })
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
        'SUCATI: talles 3->4, 4->6, 5->8, 6->10, 7->12. Sucursales 0-23.',
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
    items = await extraerItemsPDF(base64)
    if (items) textoPDF = items.map(function(i) { return i.text }).join(' ')
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
    var articulosGR = parsearGR(items)
    var meta = await llamarIA(apiKey, base64, mimeType, textoPDF, true)

    if (articulosGR && articulosGR.length > 0) {
      return {
        cliente_detectado: 'Garcia Reguera',
        numero_pedido: meta.numero_pedido,
        fecha_pedido: meta.fecha_pedido,
        fecha_entrega: meta.fecha_entrega,
        articulos: articulosGR
      }
    }
  }

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
