import React from 'react'
import { useState, useEffect, useRef } from 'react'
import { supabase, supabaseCostos } from '../lib/supabase'
import { parsearArchivoPedido } from '../lib/parsearPedido'

export default function NuevoPedido({ session, onVolver, onGuardado }) {
  const [paso, setPaso] = useState('archivo')
  const [clientes, setClientes] = useState([])
  const [archivos, setArchivos] = useState([])
  const [parseados, setParseados] = useState([]) // array de pedidos parseados
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)
  const [progresoParseo, setProgresoParseo] = useState('')
  const inputRef = useRef()

  useEffect(() => {
    supabase.from('clientes').select('*').then(({ data }) => setClientes(data || []))
  }, [])

  function detectarCliente(nombreArchivo, textoPedido) {
    const texto = (nombreArchivo + ' ' + (textoPedido || '')).toLowerCase()
    if (texto.includes('balbi')) return clientes.find(c => c.nombre === 'Balbi')
    if (texto.includes('garcia') || texto.includes('garcía') || texto.includes('reguera') || texto.includes('gr')) return clientes.find(c => c.nombre === 'García Reguera')
    if (texto.includes('sucati') || texto.includes('chandal') || texto.includes('suc')) return clientes.find(c => c.nombre === 'Sucati')
    return null
  }

  function handleArchivos(nuevos) {
    const lista = Array.from(nuevos)
    setArchivos(prev => {
      const nombres = prev.map(f => f.name)
      const sinDuplicados = lista.filter(f => !nombres.includes(f.name))
      return [...prev, ...sinDuplicados]
    })
  }

  function quitarArchivo(idx) {
    setArchivos(prev => prev.filter((_, i) => i !== idx))
  }

  async function handleParsear() {
    if (archivos.length === 0) return
    setError('')
    setCargando(true)
    setParseados([])

    const resultados = []

    for (let i = 0; i < archivos.length; i++) {
      const archivo = archivos[i]
      setProgresoParseo(`Interpretando ${i + 1} de ${archivos.length}: ${archivo.name}...`)

      try {
        // Detectar cliente por nombre de archivo
        const clienteDetectado = detectarCliente(archivo.name, '')
        const clienteNombre = clienteDetectado?.nombre || 'desconocido'

        const resultado = await parsearArchivoPedido(archivo, clienteNombre)
        const enriquecido = await enriquecerConCostos(resultado)

        resultados.push({
          archivo: archivo.name,
          cliente: clienteDetectado,
          clienteId: clienteDetectado?.id || null,
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
    const codigos = pedidoIA.articulos?.map(a => a.codigo_nuestro).filter(Boolean) || []
    if (codigos.length === 0) return pedidoIA
    try {
      const { data } = await supabaseCostos.from('articulos').select('codigo, descripcion, foto_url').in('codigo', codigos)
      const mapa = {}
      if (data) data.forEach(a => { mapa[a.codigo] = a })
      return {
        ...pedidoIA,
        articulos: pedidoIA.articulos.map(a => ({
          ...a,
          descripcion_correcta: mapa[a.codigo_nuestro]?.descripcion || null,
          foto_url: mapa[a.codigo_nuestro]?.foto_url || null,
        }))
      }
    } catch {
      return pedidoIA
    }
  }

  async function handleGuardarTodos() {
    setCargando(true)
    setError('')
    let errores = []

    for (const p of parseados) {
      if (p.error || !p.data || !p.clienteId) continue
      try {
        await guardarPedido(p.clienteId, p.data)
      } catch (err) {
        errores.push(`${p.archivo}: ${err.message}`)
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
    const { data: pedidoDB, error: errPedido } = await supabase
      .from('pedidos')
      .insert({
        cliente_id: parseInt(clienteId),
        numero_pedido: parseado.numero_pedido,
        fecha_pedido: parseado.fecha_pedido,
        fecha_entrega: parseado.fecha_entrega,
        estado: 'activo',
      })
      .select()
      .single()

    if (errPedido) throw errPedido

    for (const art of parseado.articulos) {
      const { data: artDB, error: errArt } = await supabase
        .from('pedido_articulos')
        .insert({
          pedido_id: pedidoDB.id,
          codigo_nuestro: art.codigo_nuestro,
          codigo_cliente: art.codigo_cliente,
          descripcion_cliente: art.descripcion_cliente,
          descripcion_correcta: art.descripcion_correcta,
          foto_url: art.foto_url,
          precio_unitario: art.precio_unitario,
          total_unidades: art.total_unidades,
          estado: 'pendiente',
        })
        .select()
        .single()

      if (errArt) throw errArt

      if (art.sucursales?.length) {
        await supabase.from('pedido_sucursales').insert(
          art.sucursales.map(s => ({
            pedido_articulo_id: artDB.id,
            nro_sucursal: s.nro_sucursal,
            cantidad: s.cantidad,
            estado: 'pendiente',
            es_entrega_final: s.nro_sucursal === '0',
          }))
        )
      }

      if (art.variantes?.length) {
        await supabase.from('pedido_articulo_variantes').insert(
          art.variantes.map(v => ({
            pedido_articulo_id: artDB.id,
            nombre: v.nombre,
            cantidad: v.cantidad_total,
          }))
        )
      }

      if (art.modulos?.length) {
        await supabase.from('pedido_modulos').insert(
          art.modulos.map(m => ({
            pedido_articulo_id: artDB.id,
            descripcion: m.descripcion,
            unidades_por_caja: m.unidades_por_caja,
            curva_talles: m.curva_talles,
          }))
        )
      }
    }
  }

  // ── PASO 1: SUBIR ARCHIVOS ──
  if (paso === 'archivo') {
    return (
      <div style={{ maxWidth: '32rem', margin: '0 auto' }} className="space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={onVolver} style={{ color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer' }}>← Volver</button>
          <h1 className="text-xl font-bold">Nuevo pedido</h1>
        </div>

        <div className="card space-y-5">
          {/* Zona de archivos */}
          <div>
            <label className="text-sm text-muted block mb-2">Archivos del pedido</label>
            <div
              style={{
                border: '2px dashed #2a2d3e',
                borderRadius: '0.75rem',
                padding: '2rem',
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'border-color 0.15s'
              }}
              onClick={() => inputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); handleArchivos(e.dataTransfer.files) }}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,.xls,.xlsx"
                multiple
                style={{ display: 'none' }}
                onChange={e => handleArchivos(e.target.files)}
              />
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📤</div>
              <div style={{ color: '#6b7280' }}>Subí uno o más archivos PDF o Excel</div>
              <div style={{ color: '#6b7280', fontSize: '0.75rem', marginTop: '0.25rem' }}>.pdf, .xls, .xlsx · Podés arrastrar varios a la vez</div>
            </div>
          </div>

          {/* Lista de archivos seleccionados */}
          {archivos.length > 0 && (
            <div className="space-y-2">
              {archivos.map((f, i) => (
                <div key={i} style={{
                  background: '#0f1117',
                  border: '1px solid #2a2d3e',
                  borderRadius: '0.5rem',
                  padding: '0.625rem 0.75rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span>📄</span>
                    <div>
                      <div style={{ fontSize: '0.875rem', color: 'white' }}>{f.name}</div>
                      <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{(f.size / 1024).toFixed(0)} KB</div>
                    </div>
                  </div>
                  <button
                    onClick={() => quitarArchivo(i)}
                    style={{ color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem' }}
                  >✕</button>
                </div>
              ))}
            </div>
          )}

          {error && <p style={{ color: '#f87171', fontSize: '0.875rem' }}>{error}</p>}

          <button
            className="btn-primary w-full"
            disabled={archivos.length === 0 || cargando}
            onClick={handleParsear}
          >
            {cargando ? (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                <svg style={{ animation: 'spin 1s linear infinite', width: '1rem', height: '1rem' }} viewBox="0 0 24 24" fill="none">
                  <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                {progresoParseo || 'Interpretando...'}
              </span>
            ) : `Interpretar ${archivos.length > 1 ? archivos.length + ' archivos' : 'archivo'} con IA →`}
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
    const cliente = clientes.find(c => String(c.id) === String(clienteId))
    const copia = [...parseados]
    copia[idx] = { ...copia[idx], cliente, clienteId: parseInt(clienteId) }
    onEditar(copia)
  }

  function editarFecha(idx, fecha) {
    const copia = [...parseados]
    copia[idx] = { ...copia[idx], data: { ...copia[idx].data, fecha_entrega: fecha } }
    onEditar(copia)
  }

  function editarDescripcion(pedIdx, artIdx, val) {
    const copia = [...parseados]
    const arts = [...copia[pedIdx].data.articulos]
    arts[artIdx] = { ...arts[artIdx], descripcion_correcta: val }
    copia[pedIdx] = { ...copia[pedIdx], data: { ...copia[pedIdx].data, articulos: arts } }
    onEditar(copia)
  }

  const listos = parseados.filter(p => !p.error && p.clienteId)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={onVolver} style={{ color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer' }}>← Volver</button>
        <h1 className="text-xl font-bold">Revisá los pedidos</h1>
      </div>

      {parseados.map((p, idx) => (
        <div key={idx} className="card space-y-4">
          {/* Header del pedido */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{p.archivo}</div>
              {p.data?.numero_pedido && (
                <div style={{ fontSize: '0.875rem', color: '#6b8fff' }}>Pedido #{p.data.numero_pedido}</div>
              )}
            </div>
            {p.error && (
              <span style={{ background: '#450a0a', color: '#f87171', fontSize: '0.75rem', padding: '0.25rem 0.5rem', borderRadius: '0.5rem' }}>
                Error
              </span>
            )}
          </div>

          {p.error ? (
            <p style={{ color: '#f87171', fontSize: '0.875rem' }}>⚠ {p.error}</p>
          ) : (
            <>
              {/* Cliente */}
              <div>
                <label style={{ fontSize: '0.75rem', color: '#6b7280', display: 'block', marginBottom: '0.25rem' }}>Cliente</label>
                <select
                  className="input"
                  value={p.clienteId || ''}
                  onChange={e => editarCliente(idx, e.target.value)}
                >
                  <option value="">Seleccioná cliente...</option>
                  {clientes.map(c => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                  ))}
                </select>
              </div>

              {/* Fecha entrega */}
              <div>
                <label style={{ fontSize: '0.75rem', color: '#6b7280', display: 'block', marginBottom: '0.25rem' }}>Fecha de entrega</label>
                <input
                  type="date"
                  className="input"
                  style={{ width: 'auto' }}
                  value={p.data?.fecha_entrega || ''}
                  onChange={e => editarFecha(idx, e.target.value)}
                />
              </div>

              {/* Artículos */}
              <div>
                <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {p.data?.articulos?.length} artículos
                </div>
                <div className="space-y-2">
                  {p.data?.articulos?.map((art, artIdx) => (
                    <div key={artIdx} style={{ background: '#0f1117', border: '1px solid #2a2d3e', borderRadius: '0.5rem', padding: '0.75rem' }}>
                      <div style={{ display: 'flex', gap: '0.75rem' }}>
                        {art.foto_url && (
                          <img src={art.foto_url} alt="" style={{ width: '3.5rem', height: '3.5rem', objectFit: 'cover', borderRadius: '0.5rem', flexShrink: 0 }} />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <span style={{ fontFamily: "'Archivo Black', sans-serif", color: '#6b8fff', fontWeight: 700 }}>{art.codigo_nuestro}</span>
                            {art.codigo_cliente && <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>({art.codigo_cliente})</span>}
                            <span style={{ fontFamily: "'Archivo Black', sans-serif", color: 'white', fontWeight: 700 }}>{art.total_unidades} u</span>
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.125rem' }}>{art.descripcion_cliente}</div>
                          <input
                            className="input"
                            style={{ marginTop: '0.375rem', fontSize: '0.8rem' }}
                            placeholder="Descripción correcta (editable)"
                            value={art.descripcion_correcta || ''}
                            onChange={e => editarDescripcion(idx, artIdx, e.target.value)}
                          />
                        </div>
                      </div>

                      {art.variantes?.length > 0 && (
                        <div style={{ marginTop: '0.5rem' }}>
                          <div style={{ fontSize: '0.7rem', color: '#6b7280', marginBottom: '0.25rem' }}>Variantes:</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                            {art.variantes.map((v, vi) => (
                              <span key={vi} style={{ fontSize: '0.7rem', background: '#1a1d27', border: '1px solid #2a2d3e', padding: '0.125rem 0.5rem', borderRadius: '0.375rem' }}>
                                {v.nombre} — <span style={{ fontFamily: "'Archivo Black', sans-serif" }}>{v.cantidad_total}u</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {art.sucursales?.length > 0 && (
                        <div style={{ marginTop: '0.5rem' }}>
                          <div style={{ fontSize: '0.7rem', color: '#6b7280', marginBottom: '0.25rem' }}>{art.sucursales.length} sucursales</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                            {art.sucursales.map((s, si) => (
                              <span key={si} style={{
                                fontSize: '0.7rem',
                                padding: '0.125rem 0.375rem',
                                borderRadius: '0.25rem',
                                fontFamily: 'monospace',
                                background: s.nro_sucursal === '0' ? '#3b0764' : '#1a1d27',
                                color: s.nro_sucursal === '0' ? '#c084fc' : '#9ca3af',
                                border: '1px solid ' + (s.nro_sucursal === '0' ? '#7e22ce' : '#2a2d3e')
                              }}>
                                S{s.nro_sucursal}: {s.cantidad}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      ))}

      {error && <p style={{ color: '#f87171', fontSize: '0.875rem', whiteSpace: 'pre-line' }}>{error}</p>}

      <button
        className="btn-primary w-full"
        onClick={onConfirmar}
        disabled={cargando || listos.length === 0}
      >
        {cargando ? 'Guardando...' : `✓ Confirmar y guardar ${listos.length} pedido${listos.length !== 1 ? 's' : ''}`}
      </button>
    </div>
  )
}
