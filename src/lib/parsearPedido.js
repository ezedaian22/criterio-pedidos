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
            page: p
          })
        }
      })
    }
    return todosItems
  } catch(e) { return null }
}

function parsearNotaPedidoGR(items) {
  // Parser GR sin distribución — procesa CADA PÁGINA por separado
  var xCodProv = 75, xArt = 135, xTalle = 188, xCant = 415, xDesc1 = 195, xDesc2 = 400, xPrecio = 464
  var TOL_X = 20

  // Agrupar por página
  var porPagina = {}
  items.forEach(function(item) {
    var pg = item.page || 1
    if (!porPagina[pg]) porPagina[pg] = []
    porPagina[pg].push(item)
  })

  var articulosMap = {}
  var articulosOrden = []

  Object.keys(porPagina).forEach(function(pg) {
    var pageItems = porPagina[pg]
    var porY = {}
    pageItems.forEach(function(item) {
      var yKey = Math.round(item.y / 4) * 4
      if (!porY[yKey]) porY[yKey] = []
      porY[yKey].push(item)
    })

    Object.keys(porY).forEach(function(yKey) {
      var fila = porY[yKey].slice().sort(function(a,b){ return a.x - b.x })

      var codItems = fila.filter(function(i){ return /^\d{1,4}$/.test(i.text) && Math.abs(i.x - xCodProv) <= TOL_X })
      var talleItems = fila.filter(function(i){ return /^\d{1,2}$/.test(i.text) && Math.abs(i.x - xTalle) <= TOL_X })
      var cantItems = fila.filter(function(i){
        if (!/^\d+$/.test(i.text)) return false
        if (Math.abs(i.x - xCant) > TOL_X) return false
        var n = parseInt(i.text); return n > 0 && n < 9999 && n !== 60
      })
      var precioItems = fila.filter(function(i){ return Math.abs(i.x - xPrecio) <= 20 && /[\d.,]+/.test(i.text) })
      var artItems = fila.filter(function(i){ return /^\d{5}$/.test(i.text) && Math.abs(i.x - xArt) <= TOL_X })

      if (!cantItems.length || !codItems.length || !talleItems.length) return

      var codNuestro = codItems[0].text
      var codCliente = artItems.length ? artItems[0].text : codNuestro
      var talle = String(parseInt(talleItems[0].text))
      var cantidad = parseInt(cantItems[0].text)
      var precio = 0
      if (precioItems.length) {
        try { precio = Math.round(parseFloat(precioItems[0].text.replace(/\./g,'').replace(',','.'))) } catch(e) {}
      }
      var descItems = fila.filter(function(i){ return /[A-Za-záéíóúÁÉÍÓÚñÑ/]/.test(i.text) && i.x >= xDesc1 && i.x <= xDesc2 })
      var descripcion = descItems.map(function(i){ return i.text }).join(' ')

      if (!articulosMap[codNuestro]) {
        articulosMap[codNuestro] = {
          codigo_nuestro: codNuestro,
          codigo_cliente: codCliente,
          descripcion_cliente: descripcion,
          precio_unitario: precio,
          talles_articulo: [],
          sucursales: {},  // una "sucursal" por talle: "T4", "T6", etc.
          total_unidades: 0,
          modulos: [],
          variantes: [],
          es_por_talle: true
        }
        articulosOrden.push(codNuestro)
      }

      var art = articulosMap[codNuestro]
      var sucKey = 'T' + talle
      if (art.sucursales[sucKey]) return  // talle ya procesado
      if (art.talles_articulo.indexOf(talle) === -1) art.talles_articulo.push(talle)
      // Cada talle es una sucursal con su propio estado (reusa SucursalesGrid)
      art.sucursales[sucKey] = {
        nro_sucursal: sucKey,
        cantidad: cantidad,
        estado: 'pendiente',
        talles: {},
        es_por_talle: true
      }
      art.total_unidades += cantidad
    })
  })

  if (!Object.keys(articulosMap).length) return null

  var resultado = articulosOrden.map(function(cod) {
    var art = articulosMap[cod]
    art.talles_articulo.sort(function(a,b){ return Number(a)-Number(b) })
    art.sucursales = Object.values(art.sucursales).sort(function(a,b){
      return Number(a.nro_sucursal.replace('T','')) - Number(b.nro_sucursal.replace('T',''))
    })
    return art
  })

  return resultado.length > 0 ? resultado : null
}

function extraerPreciosGR(items) {
  // Los GR con distribución traen el precio en la página "NOTA DE PEDIDO" (no en la grilla).
  // Misma fila: código (x 60-95, 2-4 díg) + precio en formato AR (x 445-478, "6.991,73").
  // No depende del talle → robusto a diferencias PDF.js / pdfplumber.
  var precioRe = /^\d{1,3}(?:\.\d{3})*,\d{2}$/
  var codRe = /^\d{1,4}$/
  var mapa = {}
  var filas = {}
  items.forEach(function(i) {
    var k = (i.page || 1) + ':' + (Math.round(i.y / 4) * 4)
    if (!filas[k]) filas[k] = []
    filas[k].push(i)
  })
  Object.keys(filas).forEach(function(k) {
    var fila = filas[k]
    var cod = fila.find(function(i) { return i.x >= 60 && i.x <= 95 && codRe.test(i.text) })
    var pre = fila.find(function(i) { return i.x >= 445 && i.x <= 478 && precioRe.test(i.text) })
    if (!cod || !pre) return
    var val = Math.round(parseFloat(pre.text.replace(/\./g, '').replace(',', '.')))
    if (val > 0 && mapa[cod.text] === undefined) mapa[cod.text] = val
  })
  return mapa
}

function parsearDistribucionGR(items) {
  // Normalizar: PDF.js pega "50789-004 128" (codigo-talle + codigo nuestro) en un item.
  var codRe = /^(\d{5})[-\u2010\u2011\u2012\u2013\u2014](\d{3})\s+(\d{1,4})$/
  var codigosTalle = []  // { codCliente, talle, codNuestro, x, y }
  items.forEach(function(i) {
    var m = i.text.match(codRe)
    if (m) {
      codigosTalle.push({ codCliente: m[1], talle: String(parseInt(m[2])), codNuestro: m[3], x: i.x, y: i.y, page: i.page })
    }
  })
  // Fallback: código-talle sin codNuestro pegado (por si viene separado)
  if (codigosTalle.length === 0) {
    items.forEach(function(i) {
      var m = i.text.match(/^(\d{5})[-\u2010\u2011\u2012\u2013\u2014](\d{3})$/)
      if (m) {
        // buscar codNuestro cerca en el mismo Y
        var cn = null
        items.forEach(function(j) {
          if (!cn && Math.abs(j.y - i.y) <= 6 && j.x > i.x && j.x < i.x + 80 && /^\d{1,4}$/.test(j.text)) cn = j.text
        })
        codigosTalle.push({ codCliente: m[1], talle: String(parseInt(m[2])), codNuestro: cn || m[1], x: i.x, y: i.y, page: i.page })
      }
    })
  }
  if (codigosTalle.length === 0) return null

  // Detectar la COLUMNA de sucursales de forma robusta.
  // Las sucursales son números de 2 dígitos alineados verticalmente (X similar).
  // Agrupamos por X con tolerancia real (no redondeo fijo) y tomamos el grupo más grande.
  var dosDig = items.filter(function(i) { return /^\d{2}$/.test(i.text) && i.page === codigosTalle[0].page })
  dosDig.sort(function(a,b){ return a.x - b.x })
  // Agrupar en columnas: items cuyo X difiere < 10px forman la misma columna
  var columnas = []
  dosDig.forEach(function(it) {
    var col = null
    for (var k = 0; k < columnas.length; k++) {
      if (Math.abs(columnas[k].xProm - it.x) < 10) { col = columnas[k]; break }
    }
    if (!col) { col = { xProm: it.x, items: [] }; columnas.push(col) }
    col.items.push(it)
    // recalcular X promedio
    col.xProm = col.items.reduce(function(s,i){ return s+i.x }, 0) / col.items.length
  })
  // La columna de sucursales es la que tiene MÁS items (la lista vertical de sucursales)
  var colSucsObj = columnas.reduce(function(mejor, c){ return c.items.length > (mejor ? mejor.items.length : 0) ? c : mejor }, null)
  var colSucs = colSucsObj ? colSucsObj.items : []
  if (colSucs.length < 5) return null

  // Mapa: cada sucursal en su Y, ordenadas por Y ascendente
  var sucPorY = colSucs.map(function(i) { return { y: i.y, suc: i.text } }).sort(function(a,b){ return a.y - b.y })
  var pasoY = sucPorY.length > 1 ? Math.abs(sucPorY[1].y - sucPorY[0].y) : 36
  var tolY = Math.max(8, pasoY * 0.6)

  // Las columnas de código-talle están muy juntas (~14px). Para evitar que una columna
  // agarre cantidades de la vecina, calculamos el paso X entre columnas y usamos la mitad
  // como tolerancia, asignando cada número a la columna de código MÁS CERCANA.
  var xsCodigos = codigosTalle.map(function(c){ return c.x }).sort(function(a,b){ return a-b })
  var pasoX = 999
  for (var xi = 1; xi < xsCodigos.length; xi++) {
    var dx = xsCodigos[xi] - xsCodigos[xi-1]
    if (dx > 2 && dx < pasoX) pasoX = dx
  }
  if (pasoX === 999) pasoX = 14
  var tolX = Math.max(4, Math.floor(pasoX / 2))

  var articulos = {}
  var ordenArt = []

  // Precalcular todos los números candidatos (cantidades) de la zona de distribución
  var pageDist = codigosTalle[0].page
  var todosNums = items.filter(function(i) {
    return /^\d{1,4}$/.test(i.text) && i.page === pageDist
  })

  codigosTalle.forEach(function(ct) {
    var colX = ct.x
    var codNuestro = ct.codNuestro

    // Números que pertenecen a ESTA columna: su X más cercana es la de este código-talle
    var numsColumna = todosNums.filter(function(num) {
      if (Math.abs(num.y - ct.y) <= 6) return false  // excluir fila del código
      if (Math.abs(num.x - colX) > tolX) return false  // debe estar dentro de tolX
      // verificar que ESTE código es el más cercano en X (no una columna vecina)
      var miDost = Math.abs(num.x - colX)
      var hayMasCercano = codigosTalle.some(function(otro) {
        return otro !== ct && Math.abs(num.x - otro.x) < miDost
      })
      return !hayMasCercano
    })

    // Descripción
    var desc = items.filter(function(i) {
      return /[A-Za-z]/.test(i.text) && Math.abs(i.x - colX) <= tolX && i.page === ct.page
    }).sort(function(a,b){ return a.y - b.y }).map(function(i){ return i.text }).join(' ')

    if (!articulos[codNuestro]) {
      articulos[codNuestro] = {
        codigo_nuestro: codNuestro,
        codigo_cliente: ct.codCliente,
        descripcion_cliente: desc,
        precio_unitario: 0,
        talles_articulo: [],
        sucursales: {},
        total_unidades: 0,
        modulos: []
      }
      ordenArt.push(codNuestro)
    }
    var art = articulos[codNuestro]
    if (art.talles_articulo.indexOf(ct.talle) === -1) art.talles_articulo.push(ct.talle)

    numsColumna.forEach(function(num) {
      var mejor = null, mejorDist = 999
      sucPorY.forEach(function(s) {
        var d = Math.abs(s.y - num.y)
        if (d < mejorDist) { mejorDist = d; mejor = s }
      })
      if (!mejor || mejorDist > tolY || mejor.suc === 'TOTAL') return
      var cant = parseInt(num.text)
      if (cant <= 0) return
      if (!art.sucursales[mejor.suc]) {
        art.sucursales[mejor.suc] = { nro_sucursal: mejor.suc, cantidad: 0, talles: {} }
      }
      art.sucursales[mejor.suc].talles[ct.talle] = cant
      art.sucursales[mejor.suc].cantidad += cant
      art.total_unidades += cant
    })
  })

  var resultado = ordenArt.map(function(cod) {
    var art = articulos[cod]
    art.talles_articulo.sort(function(a, b) { return Number(a) - Number(b) })
    art.sucursales = Object.values(art.sucursales)
      .filter(function(s) { return s.cantidad > 0 })
      .sort(function(a, b) { return Number(a.nro_sucursal) - Number(b.nro_sucursal) })
    return art
  }).filter(function(art) { return art.sucursales.length > 0 })

  // Precio: sacarlo de la página nota-de-pedido y asignarlo por código (GR distribución no lo trae en la grilla)
  var preciosGR = extraerPreciosGR(items)
  resultado.forEach(function(art) {
    if (preciosGR[art.codigo_nuestro] !== undefined) art.precio_unitario = preciosGR[art.codigo_nuestro]
    else if (preciosGR[art.codigo_cliente] !== undefined) art.precio_unitario = preciosGR[art.codigo_cliente]
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
    // Formato PDF Balbi: "9,130.00" — eliminar coma (miles) y parsear float
    var precio = 0
    fila.forEach(function(fi) {
      if (fi.x < xPrimeraSuc && fi !== itemCodigo) {
        var str = fi.text.replace(/,/g, '')  // solo sacar comas de miles
        var p = parseFloat(str)
        if (!isNaN(p) && p > 1000) precio = Math.round(p)
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


// ─── PARSER SUCATI (XLS) ─────────────────────────────────────────────────────

function convertirTalleSucati(t) {
  // Conversión talles Sucati → Lavalle: 3→4, 4→6, 5→8, 6→10, 7→12, 8→14, 9→16
  var mapa = { '3':4, '4':6, '5':8, '6':10, '7':12, '8':14, '9':16 }
  return mapa[String(t)] ? String(mapa[String(t)]) : String(t)
}

function expandirRangoTalles(talleStr) {
  // Sucati pone talles Lavalle directamente: "6/12" = T6,T8,T10,T12 (de 2 en 2)
  if (!talleStr || typeof talleStr !== 'string') return []
  var partes = talleStr.split('/')
  if (partes.length !== 2) return []
  var desde = parseInt(partes[0])
  var hasta = parseInt(partes[1])
  if (isNaN(desde) || isNaN(hasta)) return []
  var talles = []
  for (var t = desde; t <= hasta; t += 2) talles.push(String(t))
  return talles
}

// ── Helpers de imágenes Sucati por hoja (relaciones internas del xlsx) ──
async function zipText(zip, ruta) {
  var f = zip.files[ruta]; return f ? await f.async('string') : null
}
async function mapaHojasZip(zip) {
  var wbxml = await zipText(zip, 'xl/workbook.xml')
  var rels = await zipText(zip, 'xl/_rels/workbook.xml.rels')
  var mapa = {}; if (!wbxml || !rels) return mapa
  var rid2t = {}, m
  var relRe = /Id="(rId\d+)"[^>]*?Target="([^"]+)"/g
  while ((m = relRe.exec(rels))) rid2t[m[1]] = m[2]
  var shRe = /<sheet\b[^>]*?\/?>/g
  while ((m = shRe.exec(wbxml))) {
    var tag = m[0]
    var nm = /name="([^"]+)"/.exec(tag), rid = /r:id="(rId\d+)"/.exec(tag)
    if (nm && rid && rid2t[rid[1]]) {
      var tgt = rid2t[rid[1]].replace(/^\/xl\//, '').replace(/^\//, '')
      mapa[nm[1]] = tgt.indexOf('xl/') === 0 ? tgt : 'xl/' + tgt
    }
  }
  return mapa
}
async function imagenesDeHoja(zip, wsPath) {
  var base = wsPath.split('/').pop()
  var wsRels = await zipText(zip, 'xl/worksheets/_rels/' + base + '.rels')
  if (!wsRels) return []
  var out = [], m
  var draws = [], dr = /Target="([^"]*drawing\d+\.xml)"/g
  while ((m = dr.exec(wsRels))) draws.push(m[1].split('/').pop())
  for (var di = 0; di < draws.length; di++) {
    var dfile = draws[di]
    var dxml = await zipText(zip, 'xl/drawings/' + dfile)
    var drels = await zipText(zip, 'xl/drawings/_rels/' + dfile + '.rels')
    if (!dxml || !drels) continue
    var e2m = {}, em, er = /Id="(rId\d+)"[^>]*?Target="([^"]*media\/[^"]+)"/g
    while ((em = er.exec(drels))) e2m[em[1]] = em[2].split('/').pop()
    var anchors = dxml.split(/<xdr:(?:oneCellAnchor|twoCellAnchor)/).slice(1)
    anchors.forEach(function(a) {
      var fr = /<xdr:from>[\s\S]*?<xdr:col>(\d+)<\/xdr:col>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/.exec(a)
      var eb = /r:embed="(rId\d+)"/.exec(a)
      if (fr && eb && e2m[eb[1]]) out.push({ name: e2m[eb[1]], row: parseInt(fr[2]), col: parseInt(fr[1]) })
    })
  }
  out.sort(function(x, y) { return x.row - y.row || x.col - y.col })
  return out
}

async function parsearSucatiXLS(archivo, supabaseClient) {
  // Usar arrayBuffer() nativo en lugar de FileReader para mayor compatibilidad
  try {
    var XLSX = window.XLSX
    if (!XLSX) { throw new Error('SheetJS no disponible') }

    var rawBuffer = await archivo.arrayBuffer()
    var data = new Uint8Array(rawBuffer)
        var wb = XLSX.read(data, { type: 'array', cellDates: true, raw: true })

        // Pre-cargar imágenes del ZIP interno (XLSX = ZIP con xl/media/)
        var mediaFromZip = {}
        try {
          // Cargar JSZip dinámicamente si no está en window
          if (!window.JSZip) {
            await new Promise(function(resolve, reject) {
              var s = document.createElement('script')
              s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
              s.onload = resolve
              s.onerror = reject
              document.head.appendChild(s)
            })
          }
          if (window.JSZip) {
            var zip = await window.JSZip.loadAsync(rawBuffer)
            var mediaKeys = Object.keys(zip.files).filter(function(k) {
              return k.startsWith('xl/media/') && !zip.files[k].dir
            })
            for (var mi = 0; mi < mediaKeys.length; mi++) {
              var mKey = mediaKeys[mi]
              var mExt = mKey.split('.').pop().toLowerCase()
              if (!['png','jpg','jpeg'].includes(mExt)) continue
              var imgBuf = await zip.files[mKey].async('arraybuffer')
              if (imgBuf.byteLength > 10000) {
                mediaFromZip[mi] = { buffer: imgBuf, ext: mExt, path: mKey }
              }
            }
          }
        } catch(zipErr) {
        }

        // Buscar hoja NOTA DE PEDIDO (no la original)
        var sheetName = wb.SheetNames.find(function(n) {
          return n.toLowerCase().includes('nota de pedido') && !n.toLowerCase().includes('original')
        }) || wb.SheetNames[0]

        var ws = wb.Sheets[sheetName]
        var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true, dateNF: 'yyyy-mm-dd' })

        // Extraer fechas — buscar por etiqueta y tomar la celda siguiente no-nula
        var fechaPedido = null, fechaEntregaDesde = null, fechaEntregaHasta = null
        for (var i = 0; i < Math.min(7, rows.length); i++) {
          var row = rows[i]
          for (var j = 0; j < row.length; j++) {
            var v = row[j]; if (v === null || v === undefined || v === '') continue
            var vs = String(v).toLowerCase().trim().replace(/\s+/g, ' ')
            var siguienteVal = null
            for (var k = j+1; k < row.length; k++) {
              if (row[k] !== null && row[k] !== '' && row[k] !== undefined) { siguienteVal = row[k]; break }
            }
            if (!siguienteVal) continue
            if (vs.startsWith('del')) fechaEntregaDesde = formatearFechaXLS(siguienteVal)
            if (vs.startsWith('al')) fechaEntregaHasta = formatearFechaXLS(siguienteVal)
            if (vs === 'fecha' && !fechaPedido) fechaPedido = formatearFechaXLS(siguienteVal)
          }
        }

        // Encontrar fila encabezado
        var headerRowIdx = -1
        var colCodProv = -1, colDesc = -1, colTalle = -1, colPrecio = -1
        var colSucs = {}

        for (var i = 0; i < rows.length; i++) {
          var row = rows[i]
          if (!row.some(function(v) { return v && String(v).toLowerCase().includes('cod prov') })) continue
          headerRowIdx = i
          row.forEach(function(v, j) {
            if (v === null || v === undefined || v === '') return
            var vs = String(v).trim()
            if (vs.toLowerCase().includes('cod prov')) colCodProv = j
            if (vs.toLowerCase() === 'descripcion') colDesc = j
            if (vs.toLowerCase() === 'talle') colTalle = j
            if (vs.toLowerCase().includes('costo f')) colPrecio = j
            // Detectar columnas de sucursales: 0, 01, 02, ... 23
            // Con raw:true, el 0 viene como integer, el resto puede ser string '01','02' o int
            var numSuc = (typeof v === 'number') ? v : parseInt(vs)
            if (!isNaN(numSuc) && numSuc >= 0 && numSuc <= 23) {
              colSucs[String(numSuc)] = j
            }
          })
          break
        }

        if (headerRowIdx === -1 || colCodProv === -1) {
          reject(new Error('No se encontró encabezado en el XLS')); return
        }

        // Leer unidades por módulo de la hoja (buscar "MODULOS X NN UNIDADES")
        var unidadesPorModulo = null
        rows.forEach(function(row) {
          if (!row) return
          row.forEach(function(v) {
            if (!v) return
            var m = String(v).match(/m[oó]dulos?\s+x\s*(\d+)\s+unidades/i)
            if (m) unidadesPorModulo = parseInt(m[1])
          })
        })

        // Leer curva de talles de la hoja (CURVA DE TALLES LAVALLE COMERCIAL)
        var curvaTalles = null
        for (var i = 0; i < rows.length; i++) {
          var row = rows[i]
          if (!row) continue
          // Buscar la fila que contiene "curva de talles lavalle"
          var textoFila = row.filter(Boolean).map(String).join(' ').toLowerCase()
          if (!textoFila.includes('curva de talles lavalle')) continue

          // Los talles están en la misma fila (números mayores a 3 y menores a 20)
          var tallesConCol = []
          for (var j = 0; j < row.length; j++) {
            var v = row[j]
            if (v === null || v === undefined || v === '') continue
            var n = parseInt(v)
            if (!isNaN(n) && n >= 4 && n <= 16 && n % 2 === 0) {
              tallesConCol.push({ col: j, talle: n })
            }
          }

          // Las cantidades están en la SIGUIENTE fila, en las mismas columnas
          var filaCants = rows[i+1] || []
          if (tallesConCol.length > 0) {
            curvaTalles = {}
            tallesConCol.forEach(function(tc) {
              var cant = parseInt(filaCants[tc.col])
              if (!isNaN(cant) && cant > 0) {
                curvaTalles[String(tc.talle)] = cant
              }
            })
            if (Object.keys(curvaTalles).length === 0) curvaTalles = null
          }
          break
        }

        // Parsear artículos
        var articulos = {}
        var articulosOrden = []

        for (var i = headerRowIdx + 1; i < rows.length; i++) {
          var row = rows[i]
          if (!row || row[colCodProv] === null || row[colCodProv] === undefined || row[colCodProv] === '') continue
          var codVal = String(row[colCodProv]).trim()
          if (!codVal || codVal.toLowerCase().includes('total') || isNaN(parseInt(codVal))) continue

          var codigo = codVal
          var descripcion = row[colDesc] ? String(row[colDesc]).trim() : ''
          var talleStr = row[colTalle] ? String(row[colTalle]).trim() : ''
          var precio = row[colPrecio] ? parseFloat(String(row[colPrecio]).replace(/,/g, '')) : 0

          // Los talles en el XLS de Sucati ya vienen en talles Lavalle (6/12 = T6 al T12 de 2 en 2)
          var tallesLavalle = expandirRangoTalles(talleStr)

          var sucursalesArt = {}
          Object.keys(colSucs).forEach(function(nroSuc) {
            var colIdx = colSucs[nroSuc]
            var rawVal = row[colIdx]
            var cant = parseInt(rawVal)
            if (!isNaN(cant) && cant > 0) {
              sucursalesArt[nroSuc] = {
                nro_sucursal: nroSuc,
                cantidad: cant,
                talles: {},
                es_entrega_final: nroSuc === '0' || nroSuc === 0
              }
            }
          })

          if (!articulos[codigo]) {
            articulos[codigo] = {
              codigo_nuestro: codigo,
              codigo_cliente: codigo,
              descripcion_cliente: descripcion,
              precio_unitario: precio,
              talles_articulo: tallesLavalle,
              sucursales: sucursalesArt,
              total_unidades: Object.values(sucursalesArt).reduce(function(s,x){return s+x.cantidad},0),
              modulos: unidadesPorModulo ? [{ descripcion: 'Módulo x' + unidadesPorModulo + ' unidades', unidades_por_caja: unidadesPorModulo, curva_talles: curvaTalles }] : [],
              variantes: [],
              imagen_url: null
            }
            articulosOrden.push(codigo)
          }
        }

        // Leer variantes de los módulos (debajo del encabezado)
        var artActual = null
        for (var i = headerRowIdx + 1; i < rows.length; i++) {
          var row = rows[i]
          if (!row) continue
          var textFila = row.filter(Boolean).map(String).join(' ')

          var mMod = textFila.match(/m[oó]dulo\s+art\s+(\d+)/i)
          if (mMod) { artActual = mMod[1]; continue }

          if (artActual && articulos[artActual]) {
            var primerVal = row.find(function(v) { return v !== null && v !== '' })
            if (!primerVal) { artActual = null; continue }
            var nombre = String(primerVal).trim()
            if (/^\d+$/.test(nombre)) continue
            var ignorar = ['modulo','cantidad','curva','entrega','observ','total','revisar','horario','facturar','proveedor','tel','condic','mail']
            if (!nombre || ignorar.some(function(w){ return nombre.toLowerCase().includes(w) })) { artActual = null; continue }

            var cantVar = 0
            for (var j = 1; j < row.length; j++) {
              if (!row[j]) continue
              var numStr = String(row[j]).replace(/[^0-9]/g, '')
              if (numStr && parseInt(numStr) > 0) { cantVar = parseInt(numStr); break }
            }
            if (nombre && cantVar > 0) {
              // Detectar si es estampa (DNS, VTE, estampa, etc.)
              var esEstampa = /dns|vte|estampa|diseño|print|var\s*\d/i.test(nombre)
              articulos[artActual].variantes.push({ nombre: nombre, cantidad: cantVar, imagen_url: null, es_estampa: esEstampa })
            }
          }
        }

        // Subir imágenes a Supabase Storage usando mediaFromZip (leído arriba via JSZip)
        if (supabaseClient && Object.keys(mediaFromZip).length > 0) {
          try {
            // ── Split por tipo de pedido Sucati ──
            // CON hoja "Modal Est" (ej. remeras): camino original, sin cambios.
            // SIN "Modal Est" (ej. sacos/camperas): asignar imágenes por la hoja donde están.
            var hayModalEst = wb.SheetNames.some(function(s) {
              return s.toLowerCase().includes('modal est') || s.toLowerCase().includes('estampa')
            })
            if (!hayModalEst && zip) {
              // ── SACOS/CAMPERAS: imágenes por HOJA vía relaciones internas (no por peso/orden) ──
              var hojasMapS = await mapaHojasZip(zip)
              var imgsCacheS = {}
              async function imgsHojaS(nombre) {
                if (imgsCacheS[nombre]) return imgsCacheS[nombre]
                var wsPath = hojasMapS[nombre]
                var lst = wsPath ? await imagenesDeHoja(zip, wsPath) : []
                for (var ii = 0; ii < lst.length; ii++) {
                  var mf = zip.files['xl/media/' + lst[ii].name]
                  lst[ii].size = mf ? (await mf.async('arraybuffer')).byteLength : 0
                }
                imgsCacheS[nombre] = lst
                return lst
              }
              async function subirImgS(nombre, prefijo, cod, tag) {
                var mf = zip.files['xl/media/' + nombre]
                if (!mf) return null
                var buf = await mf.async('arraybuffer')
                var ext = nombre.split('.').pop().toLowerCase()
                var fileName = 'sucati/' + prefijo + '_' + cod + '_' + tag + '_' + Date.now() + '.' + ext
                var blob = new Blob([buf], { type: 'image/' + ext })
                var up = await supabaseClient.storage.from('pedidos-variantes').upload(fileName, blob, { contentType: 'image/' + ext, upsert: true })
                if (up.error) return null
                var url = supabaseClient.storage.from('pedidos-variantes').getPublicUrl(fileName)
                return url.data ? url.data.publicUrl : null
              }
              for (var aiS = 0; aiS < articulosOrden.length; aiS++) {
                var codS = articulosOrden[aiS]
                var artS = articulos[codS]
                // 1) Foto principal: imagen más grande de la hoja con nombre = código
                var propiasS = await imgsHojaS(codS)
                if (propiasS.length) {
                  var mayorS = propiasS.slice().sort(function(a, b) { return b.size - a.size })[0]
                  if (mayorS && mayorS.size > 10000) {
                    var urlFotoS = await subirImgS(mayorS.name, 'art', codS, '0')
                    if (urlFotoS) artS.imagen_url = urlFotoS
                  }
                }
                // 2) Estampas: variantes es_estampa → hoja de material del artículo, en orden visual
                var varsEstS = artS.variantes.filter(function(v) { return v.es_estampa })
                if (varsEstS.length) {
                  var hojaMatS = null
                  var nombresHoja = Object.keys(hojasMapS)
                  for (var hs = 0; hs < nombresHoja.length; hs++) {
                    var sName = nombresHoja[hs]
                    var sl = sName.toLowerCase()
                    if (sl.indexOf('nota de pedido') !== -1) continue
                    if (articulos[sName] || articulos[sName.trim()]) continue
                    var palS = (artS.descripcion_cliente || '').toLowerCase().split(/\s+/).filter(function(w) { return w.length > 3 })
                    var matchS = false
                    for (var ps = 0; ps < palS.length; ps++) { if (sl.indexOf(palS[ps]) !== -1) { matchS = true; break } }
                    if (matchS) { hojaMatS = sName; break }
                  }
                  if (hojaMatS) {
                    var imgsMatS = (await imgsHojaS(hojaMatS)).filter(function(im) { return im.size >= 50000 })
                    for (var viS = 0; viS < varsEstS.length && viS < imgsMatS.length; viS++) {
                      var urlEstS = await subirImgS(imgsMatS[viS].name, 'estampa', codS, 'v' + viS)
                      if (urlEstS) varsEstS[viS].imagen_url = urlEstS
                    }
                  }
                }
              }
            } else {
            // Mapear hojas del XLS a códigos de artículo
            // Las hojas relevantes son las que tienen el código o el material
            // Orden de hojas: NOTA DE PEDIDO, NOTA DE PEDIDO original, Darlon, Plush, 2226, 2220
            // Las imágenes en xl/media/ siguen el orden en que aparecen en las hojas
            // Mapear código → primera imagen grande disponible
            var subidas = {}
            var mediaIdxs = Object.keys(mediaFromZip).map(Number).sort(function(a,b){return a-b})

            // Relacionar hojas con artículos
            var hojaArt = {}
            wb.SheetNames.forEach(function(sName) {
              if (articulos[sName]) { hojaArt[sName] = sName; return }
              Object.keys(articulos).forEach(function(cod) {
                if (hojaArt[sName]) return
                var desc = (articulos[cod].descripcion_cliente || '').toLowerCase()
                var palabras = desc.split(' ').filter(function(w) { return w.length > 3 })
                if (sName.toLowerCase().includes(cod.toLowerCase()) ||
                    palabras.some(function(w) { return sName.toLowerCase().includes(w) })) {
                  hojaArt[sName] = cod
                }
              })
            })

            // Asignar imágenes por hoja: hoja con nombre = código de artículo → ese artículo
            // Si no hay match directo, usar nombre de hoja que contenga palabra clave de descripción
            // Subir la imagen más grande de cada grupo de hojas
            var subidas = {}
            var hojasCodigo = {} // sName → codigo artículo

            wb.SheetNames.forEach(function(sName) {
              var sLow = sName.toLowerCase().trim()
              // Match directo por código
              if (articulos[sName]) { hojasCodigo[sName] = sName; return }
              if (articulos[sName.trim()]) { hojasCodigo[sName] = sName.trim(); return }
              // Hoja de estampas/modal → asignar a TODOS los artículos
              if (sLow.includes('modal est') || sLow.includes('estampa') || sLow.includes('estampas')) {
                Object.keys(articulos).forEach(function(cod) {
                  if (!hojasCodigo[sName]) hojasCodigo[sName] = cod // primer artículo
                  // Marcar todos los artículos para recibir esta imagen
                  articulos[cod]._hojaEstampa = sName
                })
                return
              }
              // Match por palabras clave de la descripción
              Object.keys(articulos).forEach(function(cod) {
                if (hojasCodigo[sName]) return
                var palabras = (articulos[cod].descripcion_cliente || '').toLowerCase().split(/\s+/).filter(function(w){ return w.length > 3 })
                if (palabras.some(function(w){ return sLow.includes(w) })) {
                  hojasCodigo[sName] = cod
                }
              })
            })

            // Para cada hoja mapeada, subir su imagen más grande
            // Relacionar path xl/media/imageN con hoja via xl/drawings/drawing*.xml
            // Como no podemos parsear los drawings, usamos el orden: las imágenes del ZIP
            // corresponden a las hojas en el orden en que aparecen las hojas con imágenes
            var hojasConImg = wb.SheetNames.filter(function(s) {
              return hojasCodigo[s] && !s.toLowerCase().includes('nota de pedido')
            })

            // Estrategia de imágenes:
            // 1. Si hay hoja de estampas (Modal Est): subir UNA imagen por variante en orden
            // 2. Si no: subir la imagen más representativa por artículo (muestrario de colores)

            // Detectar si hay hoja de estampas
            var hojaEstampas = wb.SheetNames.find(function(s) {
              return s.toLowerCase().includes('modal est') || s.toLowerCase().includes('estampa')
            })

            // Imágenes grandes (descartar íconos <10KB)
            var imgsGrandes = mediaIdxs.filter(function(idx) {
              return mediaFromZip[idx] && mediaFromZip[idx].buffer.byteLength >= 100000
            })

            if (hojaEstampas && Object.keys(articulos).some(function(c) { return articulos[c].variantes.some(function(v){ return v.es_estampa }) })) {
              // Modo estampas: imágenes entre 100KB y 950KB son estampas
              // Imágenes >1MB son fotos del artículo terminado — no las queremos acá
              var imgsEstampas = mediaIdxs.filter(function(idx) {
                var sz = mediaFromZip[idx] ? mediaFromZip[idx].buffer.byteLength : 0
                return sz >= 100000 && sz <= 950000
              })
              // Modo estampas: asignar imágenes en orden a cada variante de cada artículo
              // Las imágenes están ordenadas por posición en el ZIP igual al orden de la hoja
              // Cada variante recibe su propia imagen
              articulosOrden.forEach(function(cod) {
                var art = articulos[cod]
                var variantesEstampa = art.variantes.filter(function(v) { return v.es_estampa })
                if (variantesEstampa.length === 0) return
                art._variantesParaImg = variantesEstampa
                art._imgIdxStart = 0  // siempre desde 0 — las estampas son compartidas entre artículos
              })

              // Procesar uploads de estampas
              for (var ai = 0; ai < articulosOrden.length; ai++) {
                var cod = articulosOrden[ai]
                var art = articulos[cod]
                if (!art._variantesParaImg) continue

                for (var vi = 0; vi < art._variantesParaImg.length; vi++) {
                  var variante = art._variantesParaImg[vi]
                  var imgIdxAbs = art._imgIdxStart + vi
                  var mf = mediaFromZip[imgsEstampas[imgIdxAbs]]
                  if (!mf) continue
                  try {
                    var fileName = 'sucati/estampa_' + cod + '_v' + vi + '_' + Date.now() + '.' + mf.ext
                    var blob = new Blob([mf.buffer], { type: 'image/' + mf.ext })
                    var uploadRes = await supabaseClient.storage
                      .from('pedidos-variantes')
                      .upload(fileName, blob, { contentType: 'image/' + mf.ext, upsert: true })
                    if (!uploadRes.error) {
                      var urlRes = supabaseClient.storage.from('pedidos-variantes').getPublicUrl(fileName)
                      if (urlRes.data) {
                        // Asignar esta imagen a la variante específica
                        variante.imagen_url = urlRes.data.publicUrl
                        // NO asignar estampa como foto principal del artículo
                        // La foto del artículo viene de su hoja específica (2278, 2180, etc.)
                      }
                    }
                  } catch(imgErr) {
                    console.error('Error subiendo estampa:', imgErr)
                  }
                }
              }
            } // fin if hojaEstampas

            // Foto principal del artículo: imagen >1MB de la hoja con el código del artículo
            var imgsArticulo = mediaIdxs.filter(function(idx) {
              return mediaFromZip[idx] && mediaFromZip[idx].buffer.byteLength > 1000000
            })
            for (var hi2 = 0; hi2 < hojasConImg.length; hi2++) {
              var hoja2 = hojasConImg[hi2]
              var cod2 = hojasCodigo[hoja2]
              if (!cod2 || articulos[cod2].imagen_url) continue
              // Solo hojas con código de artículo (no Modal Est)
              if (hoja2.toLowerCase().includes('modal') || hoja2.toLowerCase().includes('estampa')) continue
              var mfArt = mediaFromZip[imgsArticulo[hi2]] || mediaFromZip[imgsArticulo[0]]
              if (!mfArt) continue
              try {
                var fileNameArt = 'sucati/art_' + cod2 + '_' + Date.now() + '.' + mfArt.ext
                var blobArt = new Blob([mfArt.buffer], { type: 'image/' + mfArt.ext })
                var upArt = await supabaseClient.storage.from('pedidos-variantes').upload(fileNameArt, blobArt, { contentType: 'image/' + mfArt.ext, upsert: true })
                if (!upArt.error) {
                  var urlArt = supabaseClient.storage.from('pedidos-variantes').getPublicUrl(fileNameArt)
                  if (urlArt.data) articulos[cod2].imagen_url = urlArt.data.publicUrl
                }
              } catch(e) { console.error('Error foto artículo:', e) }
            }
            } // fin else (camino original con Modal Est)
          } catch(e) {
            console.error('Error imágenes:', e)
          }
        }

        // Detectar razón social
        var resultado = articulosOrden.map(function(cod) {
          var art = articulos[cod]
          art.sucursales = Object.values(art.sucursales)
            .sort(function(a,b){ return Number(a.nro_sucursal)-Number(b.nro_sucursal) })
          return art
        })

        var todasSucs = []
        resultado.forEach(function(art) {
          art.sucursales.forEach(function(s) {
            var n = parseInt(s.nro_sucursal)
            if (todasSucs.indexOf(n) === -1) todasSucs.push(n)
          })
        })
        var tieneSucati  = todasSucs.some(function(n){ return n >= 1 && n <= 9 })
        var tieneChandal = todasSucs.some(function(n){ return n === 0 || (n >= 10 && n <= 23) })
        var razonSocial = tieneSucati && tieneChandal
          ? 'SUCATI S.R.L. + CHANDAL S.R.L.'
          : tieneChandal ? 'CHANDAL S.R.L.' : 'SUCATI S.R.L.'

        return {
          articulos: resultado,
          fechaPedido: fechaPedido,
          fechaEntregaDesde: fechaEntregaDesde,
          fechaEntregaHasta: fechaEntregaHasta,
          razonSocial: razonSocial
        }
  } catch(err) { throw err }
}

function formatearFechaXLS(val) {
  if (!val) return null
  // Objeto Date nativo
  if (val instanceof Date && !isNaN(val)) {
    var y = val.getFullYear(), m = val.getMonth()+1, d = val.getDate()
    return y + '-' + String(m).padStart(2,'0') + '-' + String(d).padStart(2,'0')
  }
  var s = String(val).trim()
  // yyyy-mm-dd
  var m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m1) return m1[1] + '-' + m1[2] + '-' + m1[3]
  // d/m/yyyy o dd/mm/yyyy (SheetJS raw:false)
  var m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m2) return m2[3] + '-' + String(m2[2]).padStart(2,'0') + '-' + String(m2[1]).padStart(2,'0')
  // dd-mm-yyyy
  var m3 = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/)
  if (m3) return m3[3] + '-' + String(m3[2]).padStart(2,'0') + '-' + String(m3[1]).padStart(2,'0')
  // Número serial de Excel (días desde 1900)
  var n = parseFloat(s)
  if (!isNaN(n) && n > 40000 && n < 60000) {
    var d = new Date(Date.UTC(1900, 0, 1) + (n - 1) * 86400000)
    return d.toISOString().split('T')[0]
  }
  return null
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
  return parsed
}

export async function parsearArchivoPedido(archivo, clienteNombre, supabaseClient) {
  var apiKey = localStorage.getItem('criterio_anthropic_key')
  if (!apiKey) throw new Error('Falta la API Key. Configurala en Ajustes.')

  // Para XLS/XLSX ir directo al parser de Sucati sin pasar por fileToBase64
  var esXLS = archivo.name.toLowerCase().endsWith('.xls') || archivo.name.toLowerCase().endsWith('.xlsx')
  if (esXLS) {
    if (!window.XLSX) {
      await new Promise(function(resolve, reject) {
        var s = document.createElement('script')
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
        s.onload = resolve
        s.onerror = function() { reject(new Error('No se pudo cargar SheetJS')) }
        document.head.appendChild(s)
      })
    }
    try {
      var sucatiData = await parsearSucatiXLS(archivo, supabaseClient)
      if (sucatiData && sucatiData.articulos && sucatiData.articulos.length > 0) {
        var nroPedidoSucati = sucatiData.fechaPedido ? sucatiData.fechaPedido.replace(/-/g, '') : null
        return {
          cliente_detectado: 'Sucati',
          numero_pedido: nroPedidoSucati,
          fecha_pedido: sucatiData.fechaPedido,
          fecha_entrega: sucatiData.fechaEntregaHasta || sucatiData.fechaEntregaDesde,
          razon_social: sucatiData.razonSocial,
          articulos: sucatiData.articulos
        }
      } else {
        throw new Error('No se encontraron artículos en el archivo. Verificá que sea un pedido de Sucati válido.')
      }
    } catch(e) {
      throw new Error('Error leyendo XLS de Sucati: ' + e.message)
    }
  }

  var base64 = await fileToBase64(archivo)
  var mimeType = getMimeType(archivo)
  var esPDF = archivo.type === 'application/pdf'

  var items = null
  var textoPDF = null
  if (esPDF) {
    items = await extraerItemsPDF(base64)
    if (items) textoPDF = items.map(function(i) { return i.text }).join(' ')
    try { if (typeof window !== 'undefined') window._itemsReales = items } catch(e) {}
  }

  // Detectar si es GR por texto
  var esGR = false
  if (textoPDF) {
    var tl = textoPDF.toLowerCase()
    esGR = tl.includes('garcia reguera') || tl.includes('galver') ||
           archivo.name.toLowerCase().includes('_gr')
  }

  if (esGR && items) {
    // Primero intentar distribución por sucursal
    var articulosGR = parsearDistribucionGR(items)
    // Si no hay distribución, intentar por talle
    if (!articulosGR || articulosGR.length === 0) {
      articulosGR = parsearNotaPedidoGR(items)
    }
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
      // Extraer descuento del texto del PDF: "Desc.: 20.000%" o "Desc.: 20%"
      var descuento = 0
      if (textoPDF) {
        var mDesc = textoPDF.match(/Desc\.?:\s*([\d.,]+)%/)
        if (mDesc) descuento = parseFloat(mDesc[1].replace(/,/g, '.'))
      }
      // Detectar razón social por sucursales presentes
      var todasSucs = []
      articulosBalbi.forEach(function(art) {
        art.sucursales.forEach(function(s) {
          var n = parseInt(s.nro_sucursal)
          if (todasSucs.indexOf(n) === -1) todasSucs.push(n)
        })
      })
      var tieneRetail = todasSucs.some(function(n) { return n >= 18 && n <= 23 })
      var tieneHijos  = todasSucs.some(function(n) { return n >= 1  && n <= 17 })
      var razonSocial = tieneHijos && tieneRetail
        ? 'E.A. Balbi e Hijos S.A. + Balbi Retail S.A.'
        : tieneRetail ? 'Balbi Retail S.A.' : 'E.A. Balbi e Hijos S.A.'

      return {
        cliente_detectado: 'Balbi',
        numero_pedido: metaB.numero_pedido,
        fecha_pedido: metaB.fecha_pedido,
        fecha_entrega: metaB.fecha_entrega,
        descuento: descuento,
        razon_social: razonSocial,
        articulos: articulosBalbi
      }
    }
  }

  // Fallback: IA interpreta todo (solo para PDFs no reconocidos)
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
