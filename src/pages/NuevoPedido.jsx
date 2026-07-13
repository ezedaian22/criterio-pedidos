import React from 'react'
import { useState, useEffect, useRef } from 'react'
import { supabase, supabaseCostos } from '../lib/supabase'
import { parsearArchivoPedido } from '../lib/parsearPedido'

export default function NuevoPedido({ session, onVolver, onGuardado }) {
  const [paso, setPaso] = useState('archivo')
  const [clientes, setClientes] = useState([])
  const [archivos, setArchivos] = useState([])
  const [parseados, setParseados] = useState([])
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)
  const [progresoParseo, setProgresoParseo] = useState('')
  const inputRef = useRef()

  useEffect(() => {
    supabase.from('clientes').select('*').then(({ data }) => setClientes(data || []))
  }, [])

  function detectarCliente(nombreArchivo, textoIA) {
    var texto = (nombreArchivo + ' ' + (textoIA || '')).toLowerCase()
    if (texto.includes('balbi')) return clientes.find(c => c.nombre === 'Balbi')
    if (texto.includes('garcia') || texto.includes('garcía') || texto.includes('reguera') || texto.includes('_gr')) return clientes.find(c => c.nombre === 'García Reguera')
    if (texto.includes('sucati') || texto.includes('chandal') || texto.includes('_suc')) return clientes.find(c => c.nombre === 'Sucati')
    return null
  }

  function handleArchivos(nuevos) {
    var lista = Array.from(nuevos)
    setArchivos(function(prev) {
      var nombres = prev.map(function(f) { return f.name })
      var sinDuplicados = lista.filter(function(f) { return !nombres.includes(f.name) })
      return prev.concat(sinDuplicados)
    })
  }

  function quitarArchivo(idx) {
    setArchivos(function(prev) { return prev.filter(function(_, i) { return i !== idx }) })
  }

  async function handleParsear() {
    if (archivos.length === 0) return
    setError('')
    setCargando(true)
    setParseados([])

    var resultados = []

    for (var i = 0; i < archivos.length; i++) {
      var archivo = archivos[i]
      setProgresoParseo('Interpretando ' + (i + 1) + ' de ' + archivos.length + ': ' + archivo.name + '...')

      try {
        var resultado = await parsearArchivoPedido(archivo, '')
        var enriquecido = await enriquecerConCostos(resultado)

        // Auto-detectar cliente: primero desde el campo cliente_detectado de la IA, luego por nombre de archivo
        var clienteDetectado = null
        if (resultado.cliente_detectado && resultado.cliente_detectado !== 'desconocido') {
          clienteDetectado = clientes.find(function(c) {
            return c.nombre.toLowerCase().includes(resultado.cliente_detectado.toLowerCase().split(' ')[0])
          })
        }
        if (!clienteDetectado) {
          var textoDeteccion = JSON.stringify(enriquecido).toLowerCase()
          clienteDetectado = detectarCliente(archivo.name, textoDeteccion)
        }

        resultados.push({
          archivo: archivo.name,
          cliente: clienteDetectado,
          clienteId: clienteDetectado ? clienteDetectado.id : null,
          data: enriquecido,
          error: null
        })
      } catch (err) {
        resultados.push({
          archivo: archivo.name,
          cliente: null,
          clienteId: null,
          data: null,
          error: err.message
        })
      }
    }

    setParseados(resultados)
    setProgresoParseo('')
    setCargando(false)
    setPaso('revisar')
  }

  async function enriquecerConCostos(pedidoIA) {
    var codigos = (pedidoIA.articulos || []).map(function(a) { return a.codigo_nuestro }).filter(Boolean)
    if (codigos.length === 0) return pedidoIA
    try {
      var result = await supabaseCostos.from('articulos').select('codigo, descripcion, foto_url').in('codigo', codigos)
      var mapa = {}
      if (result.data) result.data.forEach(function(a) { mapa[a.codigo] = a })
      return Object.assign({}, pedidoIA, {
        articulos: pedidoIA.articulos.map(function(a) {
          return Object.assign({}, a, {
            descripcion_correcta: mapa[a.codigo_nuestro] ? mapa[a.codigo_nuestro].descripcion : null,
            foto_url: mapa[a.codigo_nuestro] ? mapa[a.codigo_nuestro].foto_url : null,
          })
        })
      })
    } catch(e) {
      return pedidoIA
    }
  }

  async function handleGuardarTodos() {
    setCargando(true)
    setError('')
    var errores = []

    for (var i = 0; i < parseados.length; i++) {
      var p = parseados[i]
      if (p.error || !p.data || !p.clienteId) continue
      try {
        await guardarPedido(p.clienteId, p.data)
      } catch (err) {
        errores.push(p.archivo + ': ' + err.message)
      }
    }

    setCargando(false)
    if (errores.length > 0) {
      setError(errores.join('\n'))
    } else {
      onGuardado()
    }
  }

  async function guardarPedido(clienteId, parseado) {
    var pedRes = await supabase.from('pedidos').insert({
      cliente_id: parseInt(clienteId),
      numero_pedido: parseado.numero_pedido,
      fecha_pedido: parseado.fecha_pedido,
      fecha_entrega: parseado.fecha_entrega,
      estado: 'activo',
    }).select().single()

    if (pedRes.error) throw pedRes.error
    var pedidoDB = pedRes.data

    for (var i = 0; i < parseado.articulos.length; i++) {
      var art = parseado.articulos[i]
      var artRes = await supabase.from('pedido_articulos').insert({
        pedido_id: pedidoDB.id,
        codigo_nuestro: art.codigo_nuestro,
        codigo_cliente: art.codigo_cliente,
        descripcion_cliente: art.descripcion_cliente,
        descripcion_correcta: art.descripcion_correcta,
        foto_url: art.foto_url,
        precio_unitario: art.precio_unitario,
        total_unidades: art.total_unidades,
        curva_talles: art.curva_talles || null,
          talles_articulo: art.talles_articulo || null,
        estado: 'pendiente',
      }).select().single()

      if (artRes.error) throw artRes.error
      var artDB = artRes.data

      if (art.sucursales && art.sucursales.length) {
        var sucData = art.sucursales.map(function(s) {
          return { pedido_articulo_id: artDB.id, nro_sucursal: s.nro_sucursal, cantidad: s.cantidad, estado: 'pendiente', es_entrega_final: s.nro_sucursal === '0', talles: s.talles || null }
        })
        var sucRes = await supabase.from('pedido_sucursales').insert(sucData)
        if (sucRes.error) throw sucRes.error
      }

      if (art.variantes && art.variantes.length) {
        var varData = art.variantes.map(function(v) {
          return { pedido_articulo_id: artDB.id, nombre: v.nombre, cantidad: v.cantidad_total }
        })
        await supabase.from('pedido_articulo_variantes').insert(varData)
      }

      if (art.modulos && art.modulos.length) {
        var modData = art.modulos.map(function(m) {
          return { pedido_articulo_id: artDB.id, descripcion: m.descripcion, unidades_por_caja: m.unidades_por_caja, curva_talles: m.curva_talles }
        })
        await supabase.from('pedido_modulos').insert(modData)
      }
    }
  }

  // ── PASO 1: SUBIR ARCHIVOS ──
  if (paso === 'archivo') {
    return (
      <div style={{ maxWidth: '32rem', margin: '0 auto' }} className="space-y-6">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button onClick={onVolver} style={{ color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer' }}>← Volver</button>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Nuevo pedido</h1>
        </div>

        <div className="card space-y-5">
          <div>
            <label style={{ fontSize: '0.875rem', color: '#6b7280', display: 'block', marginBottom: '0.5rem' }}>Archivos del pedido</label>
            <div
              style={{ border: '2px dashed #2a2d3e', borderRadius: '0.75rem', padding: '2rem', textAlign: 'center', cursor: 'pointer' }}
              onClick={() => inputRef.current && inputRef.current.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); handleArchivos(e.dataTransfer.files) }}
            >
              <input ref={inputRef} type="file" accept=".pdf,.xls,.xlsx" multiple style={{ display: 'none' }} onChange={e => handleArchivos(e.target.files)} />
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📤</div>
              <div style={{ color: '#6b7280' }}>Subí uno o más archivos PDF o Excel</div>
              <div style={{ color: '#6b7280', fontSize: '0.75rem', marginTop: '0.25rem' }}>.pdf, .xls, .xlsx · Podés arrastrar varios a la vez</div>
            </div>
          </div>

          {archivos.length > 0 && (
            <div className="space-y-2">
              {archivos.map(function(f, i) {
                return (
                  <div key={i} style={{ background: '#0f1117', border: '1px solid #2a2d3e', borderRadius: '0.5rem', padding: '0.625rem 0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span>📄</span>
                      <div>
                        <div style={{ fontSize: '0.875rem', color: 'white' }}>{f.name}</div>
                        <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{(f.size / 1024).toFixed(0)} KB</div>
                      </div>
                    </div>
                    <button onClick={() => quitarArchivo(i)} style={{ color: '#f87171', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
                  </div>
                )
              })}
            </div>
          )}

          {error && <p style={{ color: '#f87171', fontSize: '0.875rem' }}>{error}</p>}

          <button
            className="btn-primary w-full"
            disabled={archivos.length === 0 || cargando}
            onClick={handleParsear}
          >
            {cargando ? (progresoParseo || 'Interpretando...') : 'Interpretar ' + (archivos.length > 1 ? archivos.length + ' archivos' : 'archivo') + ' con IA →'}
          </button>
        </div>
      </div>
    )
  }

  // ── PASO 2: REVISAR ──
  if (paso === 'revisar') {
    return (
      <RevisarPedidos
        parseados={parseados}
        clientes={clientes}
        onEditar={setParseados}
        onVolver={() => setPaso('archivo')}
        onConfirmar={handleGuardarTodos}
        cargando={cargando}
        error={error}
      />
    )
  }

  return null
}

function RevisarPedidos({ parseados, clientes, onEditar, onVolver, onConfirmar, cargando, error }) {
  function editarCliente(idx, clienteId) {
    var cliente = clientes.find(function(c) { return String(c.id) === String(clienteId) })
    var copia = parseados.slice()
    copia[idx] = Object.assign({}, copia[idx], { cliente: cliente, clienteId: parseInt(clienteId) })
    onEditar(copia)
  }

  function editarFecha(idx, fecha) {
    var copia = parseados.slice()
    copia[idx] = Object.assign({}, copia[idx], { data: Object.assign({}, copia[idx].data, { fecha_entrega: fecha }) })
    onEditar(copia)
  }

  function editarDescripcion(pedIdx, artIdx, val) {
    var copia = parseados.slice()
    var arts = copia[pedIdx].data.articulos.slice()
    arts[artIdx] = Object.assign({}, arts[artIdx], { descripcion_correcta: val })
    copia[pedIdx] = Object.assign({}, copia[pedIdx], { data: Object.assign({}, copia[pedIdx].data, { articulos: arts }) })
    onEditar(copia)
  }

  var listos = parseados.filter(function(p) { return !p.error && p.clienteId })

  return (
    <div className="space-y-6">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <button onClick={onVolver} style={{ color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer' }}>← Volver</button>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Revisá los pedidos</h1>
      </div>

      {parseados.map(function(p, idx) {
        return (
          <div key={idx} className="card space-y-4">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{p.archivo}</div>
                {p.data && p.data.numero_pedido && <div style={{ fontSize: '0.875rem', color: '#6b8fff' }}>Pedido #{p.data.numero_pedido}</div>}
              </div>
              {p.error && <span style={{ background: '#450a0a', color: '#f87171', fontSize: '0.75rem', padding: '0.25rem 0.5rem', borderRadius: '0.5rem' }}>Error</span>}
            </div>

            {p.error ? (
              <p style={{ color: '#f87171', fontSize: '0.875rem' }}>⚠ {p.error}</p>
            ) : (
              <div className="space-y-3">
                {/* Cliente */}
                <div>
                  <label style={{ fontSize: '0.75rem', color: '#6b7280', display: 'block', marginBottom: '0.25rem' }}>Cliente</label>
                  <select className="input" value={p.clienteId || ''} onChange={e => editarCliente(idx, e.target.value)}>
                    <option value="">Seleccioná cliente...</option>
                    {clientes.map(function(c) { return <option key={c.id} value={c.id}>{c.nombre}</option> })}
                  </select>
                </div>

                {/* Fecha */}
                <div>
                  <label style={{ fontSize: '0.75rem', color: '#6b7280', display: 'block', marginBottom: '0.25rem' }}>Fecha de entrega</label>
                  <input type="date" className="input" style={{ width: 'auto' }} value={p.data && p.data.fecha_entrega || ''} onChange={e => editarFecha(idx, e.target.value)} />
                </div>

                {/* Artículos */}
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.5rem', textTransform: 'uppercase' }}>{p.data && p.data.articulos && p.data.articulos.length} artículos</div>
                  <div className="space-y-2">
                    {p.data && p.data.articulos && p.data.articulos.map(function(art, artIdx) {
                      return (
                        <div key={artIdx} style={{ background: '#0f1117', border: '1px solid #2a2d3e', borderRadius: '0.5rem', padding: '0.75rem' }}>
                          <div style={{ display: 'flex', gap: '0.75rem' }}>
                            {art.foto_url && <img src={art.foto_url} alt="" style={{ width: '3.5rem', height: '3.5rem', objectFit: 'cover', borderRadius: '0.5rem', flexShrink: 0 }} />}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                <span style={{ fontFamily: "'Archivo Black', sans-serif", color: '#6b8fff', fontWeight: 700 }}>{art.codigo_nuestro}</span>
                                {art.codigo_cliente && <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>({art.codigo_cliente})</span>}
                                <span style={{ fontFamily: "'Archivo Black', sans-serif", color: 'white', fontWeight: 700 }}>{art.total_unidades} u</span>
                              </div>
                              <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.125rem' }}>{art.descripcion_cliente}</div>
                              <input className="input" style={{ marginTop: '0.375rem', fontSize: '0.8rem' }} placeholder="Descripción correcta" value={art.descripcion_correcta || ''} onChange={e => editarDescripcion(idx, artIdx, e.target.value)} />
                            </div>
                          </div>

                          {/* Curva de talles */}
                          {art.curva_talles && Object.keys(art.curva_talles).length > 0 && (
                            <div style={{ marginTop: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                              {Object.entries(art.curva_talles).map(function(entry) {
                                return <span key={entry[0]} style={{ fontSize: '0.7rem', background: '#1e2547', border: '1px solid #3b5bdb', padding: '0.125rem 0.375rem', borderRadius: '0.25rem', color: '#c8d8ff' }}>T{entry[0]}: {entry[1]}u</span>
                              })}
                            </div>
                          )}

                          {/* Sucursales */}
                          {art.sucursales && art.sucursales.length > 0 && (
                            <div style={{ marginTop: '0.5rem' }}>
                              <div style={{ fontSize: '0.7rem', color: '#6b7280', marginBottom: '0.25rem' }}>{art.sucursales.length} sucursales</div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                                {art.sucursales.map(function(s, si) {
                                  return (
                                    <span key={si} style={{ fontSize: '0.7rem', padding: '0.125rem 0.375rem', borderRadius: '0.25rem', fontFamily: 'monospace', background: s.nro_sucursal === '0' ? '#3b0764' : '#1a1d27', color: s.nro_sucursal === '0' ? '#c084fc' : '#9ca3af', border: '1px solid ' + (s.nro_sucursal === '0' ? '#7e22ce' : '#2a2d3e') }}>
                                      S{s.nro_sucursal}: {s.cantidad}
                                    </span>
                                  )
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {error && <p style={{ color: '#f87171', fontSize: '0.875rem', whiteSpace: 'pre-line' }}>{error}</p>}

      <button className="btn-primary w-full" onClick={onConfirmar} disabled={cargando || listos.length === 0}>
        {cargando ? 'Guardando...' : '✓ Confirmar y guardar ' + listos.length + ' pedido' + (listos.length !== 1 ? 's' : '')}
      </button>
    </div>
  )
}
