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
            text: item.str.trim()
          })
        }
      })
    }
    return todosItems
  } catch(e) { return null }
}

function parsearDistribucionGR(items) {
  // Encontrar todos los items con formato NNNNN-NNN (codigo_cliente-talle)
  var codigosItems = items.filter(function(i) {
    return /^\d{5}-\d{3}$/.test(i.text)
  })
  if (codigosItems.length === 0) return null

  // El Y de los codigos nos da las filas de distribucion
  var ysFilas = codigosItems.map(function(i) { return i.y })
  var yMin = Math.min.apply(null, ysFilas)
  var yMax = Math.max.apply(null, ysFilas)

  // Buscar fila de encabezado: numeros de 2 digitos arriba de los codigos
  // En el PDF los Y crecen hacia arriba, entonces el encabezado tiene Y > yMax
  var posiblesEncabezado = items.filter(function(i) {
    return /^\d{2}$/.test(i.text) && i.y > yMax && i.y < yMax + 60
  })

  // Si no encontramos encabezado arriba, buscar abajo
  if (posiblesEncabezado.length < 3) {
    posiblesEncabezado = items.filter(function(i) {
      return /^\d{2}$/.test(i.text) && i.y < yMin && i.y > yMin - 60
    })
  }

  // Agrupar por Y para encontrar la fila de encabezado
  var porY = {}
  posiblesEncabezado.forEach(function(i) {
    var y = Math.round(i.y / 4) * 4
    if (!porY[y]) porY[y] = []
    porY[y].push(i)
  })

  var encItems = []
  Object.keys(porY).forEach(function(y) {
    if (porY[y].length > encItems.length) encItems = porY[y]
  })

  if (encItems.length < 2) {
    // Fallback: buscar en rango más amplio
    encItems = items.filter(function(i) {
      return /^\d{2}$/.test(i.text) &&
        Math.abs(i.y - yMax) < 100
    })
    var porY2 = {}
    encItems.forEach(function(i) {
      var y = Math.round(i.y / 4) * 4
      if (!porY2[y]) porY2[y] = []
      porY2[y].push(i)
    })
    encItems = []
    Object.keys(porY2).forEach(function(y) {
      if (porY2[y].length > encItems.length) encItems = porY2[y]
    })
  }

  if (encItems.length === 0) return null

  // Ordenar encabezado por X
  encItems = encItems.sort(function(a, b) { return a.x - b.x })
  var sucursales = encItems.map(function(i) { return i.text })
  var xCols = encItems.map(function(i) { return i.x })

  // Parsear cada fila de codigo-talle
  var articulos = {}

  codigosItems.forEach(function(codItem) {
    var match = codItem.text.match(/^(\d+)-(\d+)$/)
    if (!match) return

    var codCliente = match[1]
    var talle = String(parseInt(match[2]))
    var yFila = codItem.y

    // Todos los items en la misma fila (tolerancia ±4px)
    var filaItems = items.filter(function(i) {
      return Math.abs(i.y - yFila) <= 4
    }).sort(function(a, b) { return a.x - b.x })

    // codigo_nuestro: primer numero de 1-4 digitos con X > X del codigo cliente
    var codNuestro = null
    var descTextos = []
    filaItems.forEach(function(fi) {
      if (fi.text === codItem.text) return
      if (!codNuestro && /^\d{1,4}$/.test(fi.text) && fi.x > codItem.x) {
        codNuestro = fi.text
      } else if (codNuestro && /[A-Za-z]/.test(fi.text)) {
        descTextos.push(fi.text)
      }
    })

    if (!codNuestro) return

    // Para cada columna de sucursal, encontrar el número más cercano en X
    var cantidades = {}
    xCols.forEach(function(xCol, idx) {
      var suc = sucursales[idx]
      // Buscar número en la fila con X cercano a la columna (tolerancia ±15px)
      var candidatos = filaItems.filter(function(fi) {
        return /^\d+$/.test(fi.text) &&
               Math.abs(fi.x - xCol) <= 15 &&
               fi.text !== codNuestro &&
               fi.text !== codItem.text
      })
      if (candidatos.length > 0) {
        // Tomar el más cercano al X de la columna
        candidatos.sort(function(a, b) {
          return Math.abs(a.x - xCol) - Math.abs(b.x - xCol)
        })
        var cant = parseInt(candidatos[0].text)
        if (cant > 0) cantidades[suc] = cant
      }
    })

    if (!articulos[codNuestro]) {
      articulos[codNuestro] = {
        codigo_nuestro: codNuestro,
        codigo_cliente: codCliente,
        descripcion_cliente: descTextos.join(' '),
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
      if (!art.sucursales[suc]) {
        art.sucursales[suc] = { nro_sucursal: suc, cantidad: 0, talles: {} }
      }
      art.sucursales[suc].talles[talle] = cant
      art.sucursales[suc].cantidad += cant
      art.total_unidades += cant
    })
  })

  var resultado = Object.values(articulos).map(function(art) {
    art.talles_articulo.sort(function(a, b) { return Number(a) - Number(b) })
    art.sucursales = Object.values(art.sucursales)
      .filter(function(s) { return s.cantidad > 0 })
      .sort(function(a, b) { return Number(a.nro_sucursal) - Number(b.nro_sucursal) })
    return art
  })

  return resultado.length > 0 ? resultado : null
}


function parsearBalbi(items, textoPDF) {
  // PDF Balbi: Artic Descripcion Sc Rub P.Unit 1 2 3 ... 17 Total
  // El codigo (Artic) es nuestro codigo directamente.
  // Cada fila de articulo tiene: codigo descripcion Sc Rub precio suc1 suc2 ... sucN total

  // Agrupar items por fila (Y coordinate, tolerancia 4px)
  var porY = {}
  items.forEach(function(i) {
    var y = Math.round(i.y / 4) * 4
    if (!porY[y]) porY[y] = []
    porY[y].push(i)
  })

  var yFilas = Object.keys(porY).map(Number).sort(function(a, b) { return b - a })

  // Buscar fila encabezado: la que tiene "Artic" Y numeros del 1 al 17 (o mas)
  var sucursales = []
  var xSucursales = []
  var yEncabezado = null

  for (var i = 0; i < yFilas.length; i++) {
    var fila = porY[yFilas[i]].sort(function(a, b) { return a.x - b.x })
    var tieneArtic = fila.some(function(f) { return f.text.toLowerCase() === 'artic' })
    if (!tieneArtic) continue

    // Tomar todos los numeros del 1 al 23 de esta fila como columnas de sucursal
    var nums = fila.filter(function(f) {
      var n = parseInt(f.text)
      return /^\d{1,2}$/.test(f.text) && n >= 1 && n <= 23
    })
    if (nums.length < 5) continue

    yEncabezado = yFilas[i]
    nums.sort(function(a, b) { return a.x - b.x })
    var seen = {}
    nums.forEach(function(n) {
      var num = parseInt(n.text)
      if (!seen[num]) {
        seen[num] = true
        sucursales.push(String(num))
        xSucursales.push(n.x)
      }
    })
    break
  }

  if (!yEncabezado || sucursales.length < 5) return null

  // Encontrar X del campo "Artic" para saber donde empieza el codigo
  var xArtic = 0
  var filaEnc = porY[yEncabezado].sort(function(a, b) { return a.x - b.x })
  var itemArtic = filaEnc.find(function(f) { return f.text.toLowerCase() === 'artic' })
  if (itemArtic) xArtic = itemArtic.x

  var articulos = {}

  yFilas.forEach(function(y) {
    if (y >= yEncabezado) return
    var fila = porY[y].sort(function(a, b) { return a.x - b.x })

    // Buscar el codigo: numero de 1-4 digitos cerca del X de "Artic" (tolerancia 30px)
    var itemCodigo = fila.find(function(fi) {
      return /^\d{1,4}$/.test(fi.text) && Math.abs(fi.x - xArtic) <= 30
    })
    if (!itemCodigo) return

    var codigo = itemCodigo.text

    // Buscar cantidades por sucursal
    var cantidades = {}
    var tieneCantidad = false
    xSucursales.forEach(function(xCol, idx) {
      var suc = sucursales[idx]
      var candidatos = fila.filter(function(fi) {
        return /^\d+$/.test(fi.text) &&
               Math.abs(fi.x - xCol) <= 20 &&
               fi !== itemCodigo
      })
      if (candidatos.length > 0) {
        candidatos.sort(function(a, b) { return Math.abs(a.x - xCol) - Math.abs(b.x - xCol) })
        var cant = parseInt(candidatos[0].text)
        if (cant > 0) { cantidades[suc] = cant; tieneCantidad = true }
      }
    })

    if (!tieneCantidad) return

    // Descripcion: textos con letras, entre el codigo y la primera columna de sucursal
    var xPrimeraSuc = xSucursales[0]
    var desc = fila
      .filter(function(fi) { return fi.x > itemCodigo.x && fi.x < xPrimeraSuc && /[A-Za-zÀ-ú]/.test(fi.text) })
      .map(function(fi) { return fi.text })

    // Precio: numero > 1000 antes de la primera sucursal
    var precio = 0
    fila.forEach(function(fi) {
      if (fi.x < xPrimeraSuc && fi !== itemCodigo) {
        var str = fi.text.replace(/[,.]/g, '')
        var p = parseInt(str)
        if (p > 1000) precio = p
      }
    })

    if (!articulos[codigo]) {
      articulos[codigo] = {
        codigo_nuestro: codigo,
        codigo_cliente: codigo,
        descripcion_cliente: desc.join(' '),
        precio_unitario: precio,
        talles_articulo: [],
        sucursales: {},
        total_unidades: 0,
        modulos: []
      }
    }

    var art = articulos[codigo]
    Object.keys(cantidades).forEach(function(suc) {
      var cant = cantidades[suc]
      if (!art.sucursales[suc]) art.sucursales[suc] = { nro_sucursal: suc, cantidad: 0, talles: {} }
      art.sucursales[suc].cantidad += cant
      art.total_unidades += cant
    })
  })

  var resultado = Object.values(articulos).map(function(art) {
    art.sucursales = Object.values(art.sucursales)
      .filter(function(s) { return s.cantidad > 0 })
      .sort(function(a, b) { return Number(a.nro_sucursal) - Number(b.nro_sucursal) })
    return art
  })

  return resultado.length > 0 ? resultado : null
}

async function llamarIA(apiKey, base64, mimeType, textoPDF, soloMeta) {
  var prompt = soloMeta
    ? 'Extrae SOLO numero_pedido, fecha_pedido (YYYY-MM-DD), fecha_entrega (YYYY-MM-DD) de este pedido. Responde SOLO JSON: {"numero_pedido":"string","fecha_pedido":"YYYY-MM-DD","fecha_entrega":"YYYY-MM-DD"}'
    : [
        'Sos un asistente que extrae datos de pedidos para Lavalle Comercial SRL.',
        'cliente_detectado = "Garcia Reguera", "Balbi", "Sucati" o "desconocido".',
        'BALBI: La columna "Artic" del PDF contiene el codigo_nuestro de Lavalle directamente (ej: 65, 2101, 2180). Ponelo en codigo_nuestro Y en codigo_cliente con el mismo valor. sucursales 1-23 en columnas. Para cada sucursal: cantidad=suma talles, talles={"talle":cant}.',
        'SUCATI: talles 3->4, 4->6, 5->8, 6->10, 7->12. Sucursales 0-23.',
        'Responde SOLO JSON: {"cliente_detectado":"string","numero_pedido":"string","fecha_pedido":"YYYY-MM-DD","fecha_entrega":"YYYY-MM-DD","articulos":[{"codigo_nuestro":"string","codigo_cliente":"string","descripcion_cliente":"string","precio_unitario":0,"talles_articulo":["4","6","8","10","12"],"sucursales":[{"nro_sucursal":"string","cantidad":0,"talles":{"4":0,"6":0}}],"modulos":[],"total_unidades":0}]}'
      ].join('\n')

  var contenido = []
  if (textoPDF) contenido.push({ type: 'text', text: 'PDF:\n' + textoPDF.slice(0, 2000) })
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
  var parsed = JSON.parse(m ? m[0] : clean)
  console.log('IA RESPONSE:', JSON.stringify(parsed).slice(0, 500))
  return parsed
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

  // Detectar si es GR por texto
  var esGR = false
  if (textoPDF) {
    var tl = textoPDF.toLowerCase()
    esGR = tl.includes('garcia reguera') || tl.includes('galver') ||
           archivo.name.toLowerCase().includes('_gr')
  }

  if (esGR && items) {
    var articulosGR = parsearDistribucionGR(items)
    if (articulosGR && articulosGR.length > 0) {
      var meta = await llamarIA(apiKey, base64, mimeType, textoPDF, true)
      return {
        cliente_detectado: 'Garcia Reguera',
        numero_pedido: meta.numero_pedido,
        fecha_pedido: meta.fecha_pedido,
        fecha_entrega: meta.fecha_entrega,
        articulos: articulosGR
      }
    }
  }

  // Detectar si es Balbi
  var esBalbi = false
  if (textoPDF) {
    var tlb = textoPDF.toLowerCase()
    esBalbi = tlb.includes('balbi') || tlb.includes('e.a. balbi') ||
              archivo.name.toLowerCase().includes('_bb')
  }

  if (esBalbi && items) {
    var articulosBalbi = parsearBalbi(items, textoPDF)
    if (articulosBalbi && articulosBalbi.length > 0) {
      var metaB = await llamarIA(apiKey, base64, mimeType, textoPDF, true)
      return {
        cliente_detectado: 'Balbi',
        numero_pedido: metaB.numero_pedido,
        fecha_pedido: metaB.fecha_pedido,
        fecha_entrega: metaB.fecha_entrega,
        articulos: articulosBalbi
      }
    }
  }

  // Sucati / fallback: IA interpreta todo
  return await llamarIA(apiKey, base64, mimeType, textoPDF, false)
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
