// ─── Extrae texto del PDF página por página ───────────────────────────────
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
    var paginas = []
    for (var p = 1; p <= pdf.numPages; p++) {
      var page = await pdf.getPage(p)
      var content = await page.getTextContent()
      // Agrupar por fila (Y) y ordenar por X
      var filas = {}
      content.items.forEach(function(item) {
        var y = Math.round(item.transform[5])
        if (!filas[y]) filas[y] = []
        filas[y].push({ x: item.transform[4], text: item.str.trim() })
      })
      var ys = Object.keys(filas).map(Number).sort(function(a, b) { return b - a })
      var textoPagina = ys.map(function(y) {
        return filas[y].sort(function(a, b) { return a.x - b.x })
                       .map(function(i) { return i.text }).filter(Boolean).join('\t')
      }).filter(Boolean).join('\n')
      paginas.push(textoPagina)
    }
    return paginas
  } catch(e) {
    return null
  }
}

// ─── Parser específico para García Reguera ───────────────────────────────
function parsearGR(paginas) {
  // Encontrar la página/sección de DISTRIBUCION
  var textoTotal = paginas.join('\n')
  var lineas = textoTotal.split('\n').map(function(l) { return l.trim() }).filter(Boolean)

  // Encontrar línea de encabezado de sucursales
  var idxEncabezado = -1
  var sucursales = []

  for (var i = 0; i < lineas.length; i++) {
    var cols = lineas[i].split('\t').map(function(c) { return c.trim() }).filter(Boolean)
    // Buscar línea que tenga solo números de 2 dígitos (sucursales)
    var soloNums = cols.filter(function(c) { return /^\d{2}$/.test(c) })
    if (soloNums.length >= 3) {
      idxEncabezado = i
      sucursales = soloNums
      break
    }
  }

  if (idxEncabezado === -1) return null

  // Leer filas de datos después del encabezado
  var articulos = {}

  for (var j = idxEncabezado + 1; j < lineas.length; j++) {
    var cols = lineas[j].split('\t').map(function(c) { return c.trim() }).filter(Boolean)
    if (cols.length < sucursales.length + 2) continue

    // Buscar patrón: primer col tiene formato NNNNN-NNN (codigo_cliente-talle)
    var codigoCli = cols[0]
    var matchCli = codigoCli.match(/^(\d+)-(\d+)$/)
    if (!matchCli) continue

    var codCliente = matchCli[1]
    var talle = String(parseInt(matchCli[2])) // "004" → "4"
    var codNuestro = cols[1]
    var descripcion = ''

    // Las columnas del medio son descripción (texto no numérico)
    // Las últimas cols son los números de sucursal + total
    var numerosAlFinal = []
    var k = cols.length - 1
    while (k >= 2 && /^[\d.,]+$/.test(cols[k])) {
      numerosAlFinal.unshift(cols[k])
      k--
      if (numerosAlFinal.length >= sucursales.length + 1) break
    }
    // El primer número del medio hacia adelante es descripción
    descripcion = cols.slice(2, k + 1).join(' ')

    // numerosAlFinal tiene [cant_suc1, cant_suc2, ..., TOTAL]
    // Ignorar el último (TOTAL)
    var cantsPorSuc = numerosAlFinal.slice(0, sucursales.length).map(function(n) {
      return parseInt(n.replace(/[.,]/g, '')) || 0
    })

    if (!articulos[codNuestro]) {
      articulos[codNuestro] = {
        codigo_nuestro: codNuestro,
        codigo_cliente: codCliente,
        descripcion_cliente: descripcion,
        precio_unitario: 0,
        talles_articulo: [],
        sucursales: {},
        total_unidades: 0
      }
    }

    var art = articulos[codNuestro]
    if (art.talles_articulo.indexOf(talle) === -1) art.talles_articulo.push(talle)

    sucursales.forEach(function(suc, idx) {
      var cant = cantsPorSuc[idx] || 0
      if (cant === 0) return
      if (!art.sucursales[suc]) {
        art.sucursales[suc] = { nro_sucursal: suc, cantidad: 0, talles: {} }
      }
      art.sucursales[suc].talles[talle] = cant
      art.sucursales[suc].cantidad += cant
      art.total_unidades += cant
    })
  }

  // Convertir sucursales de objeto a array
  return Object.values(articulos).map(function(art) {
    art.talles_articulo.sort(function(a, b) { return Number(a) - Number(b) })
    art.sucursales = Object.values(art.sucursales).filter(function(s) { return s.cantidad > 0 })
    art.modulos = []
    return art
  })
}

// ─── Llamada a la IA solo para metadatos + clientes no-GR ─────────────────
async function llamarIA(apiKey, base64, mimeType, textoPDF, esGR) {
  var prompt = esGR
    ? [
        'Este es un pedido de Garcia Reguera para Lavalle Comercial.',
        'Extrae SOLO: numero_pedido, fecha_pedido (YYYY-MM-DD), fecha_entrega (YYYY-MM-DD).',
        'Responde SOLO con JSON: {"cliente_detectado":"Garcia Reguera","numero_pedido":"string","fecha_pedido":"YYYY-MM-DD","fecha_entrega":"YYYY-MM-DD"}'
      ].join('\n')
    : [
        'Sos un asistente que extrae datos de pedidos para Lavalle Comercial SRL.',
        'PASO 1: cliente_detectado = "Garcia Reguera", "Balbi", "Sucati" o "desconocido".',
        'PASO 2: numero_pedido, fecha_pedido (YYYY-MM-DD), fecha_entrega (YYYY-MM-DD).',
        'PASO 3 BALBI: columnas = sucursales 1-23, filas = articulos por talle. codigo_nuestro es el nuestro (170,171,2120 etc). Agrupa por codigo_nuestro, suma talles por sucursal.',
        'PASO 3 SUCATI: talles 3→4, 4→6, 5→8, 6→10, 7→12. Sucursales 0-23.',
        'Responde SOLO con JSON: {"cliente_detectado":"string","numero_pedido":"string","fecha_pedido":"YYYY-MM-DD","fecha_entrega":"YYYY-MM-DD","articulos":[{"codigo_nuestro":"string","codigo_cliente":"string","descripcion_cliente":"string","precio_unitario":0,"talles_articulo":["4","6","8","10","12"],"sucursales":[{"nro_sucursal":"string","cantidad":0,"talles":{"4":0,"6":0}}],"modulos":[],"total_unidades":0}]}'
      ].join('\n')

  var contenido = []
  if (textoPDF) contenido.push({ type: 'text', text: 'TEXTO DEL PDF:\n\n' + textoPDF })
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
  if (m) clean = m[0]
  return JSON.parse(clean)
}

// ─── Función principal ─────────────────────────────────────────────────────
export async function parsearArchivoPedido(archivo, clienteNombre) {
  var apiKey = localStorage.getItem('criterio_anthropic_key')
  if (!apiKey) throw new Error('Falta la API Key. Configurala en Ajustes.')

  var base64 = await fileToBase64(archivo)
  var mimeType = getMimeType(archivo)
  var esPDF = archivo.type === 'application/pdf'

  var paginas = null
  var textoPDF = null
  if (esPDF) {
    paginas = await extraerTextoPDF(base64)
    if (paginas) textoPDF = paginas.join('\n---PAGINA---\n')
  }

  // Detectar si es GR por texto extraído o nombre de archivo
  var esGR = false
  if (textoPDF) {
    esGR = textoPDF.toLowerCase().includes('garcia reguera') ||
           textoPDF.toLowerCase().includes('galver')
  }
  if (!esGR) {
    esGR = archivo.name.toLowerCase().includes('_gr') ||
           archivo.name.toLowerCase().includes('garcia') ||
           archivo.name.toLowerCase().includes('reguera')
  }

  // Para GR: parsear distribución con código JS, pedir solo metadatos a la IA
  if (esGR && paginas) {
    var articulosGR = parsearGR(paginas)
    // DEBUG: mostrar primeras líneas del texto extraído
    if (!articulosGR || articulosGR.length === 0) {
      var debug = textoPDF ? textoPDF.slice(0, 1000) : 'SIN TEXTO'
      throw new Error('DEBUG texto PDF:\n' + debug)
    }
    var meta = await llamarIA(apiKey, base64, mimeType, textoPDF, true)

    return {
      cliente_detectado: 'Garcia Reguera',
      numero_pedido: meta.numero_pedido,
      fecha_pedido: meta.fecha_pedido,
      fecha_entrega: meta.fecha_entrega,
      articulos: articulosGR || []
    }
  }

  // Para Balbi/Sucati: la IA interpreta todo
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
