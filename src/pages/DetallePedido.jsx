import React from 'react'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { formatFecha, alertaFecha, pct } from '../lib/utils'

export default function DetallePedido({ session, pedido, onVolver }) {
  const [articulos, setArticulos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [artSeleccionado, setArtSeleccionado] = useState(null)

  useEffect(() => {
    cargarArticulos()
  }, [pedido.id])

  async function cargarArticulos() {
    setCargando(true)
    try {
      const { data, error } = await supabase
        .from('pedido_articulos')
        .select('*, pedido_sucursales(*), pedido_articulo_variantes(*), pedido_modulos(*)')
        .eq('pedido_id', pedido.id)
        .order('id')
      if (error) throw error
      setArticulos(data || [])
    } catch (err) {
      console.error(err)
    } finally {
      setCargando(false)
    }
  }

  const alerta = alertaFecha(pedido.fecha_entrega)
  const finalizados = articulos.filter(a => a.estado === 'finalizado').length
  const progreso = pct(finalizados, articulos.length)

  if (artSeleccionado) {
    return (
      <ArmarArticulo
        articulo={artSeleccionado}
        onVolver={() => { setArtSeleccionado(null); cargarArticulos() }}
        onActualizar={cargarArticulos}
      />
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={onVolver} style={{ color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer' }}>← Volver</button>
        <div>
          <h1 className="text-xl font-bold">{pedido.clientes?.nombre || 'Pedido'}</h1>
          {pedido.numero_pedido && <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>#{pedido.numero_pedido}</p>}
        </div>
      </div>

      {/* Info pedido */}
      <div className={`card ${alerta === 'vencido' ? 'alerta-vencido' : alerta === 'proximo' ? 'alerta-proximo' : ''}`}>
        <div className="flex items-center justify-between">
          <div>
            <p style={{ fontSize: '0.875rem', color: '#6b7280' }}>Fecha de entrega</p>
            <p className="num font-bold text-lg" style={{ color: alerta === 'vencido' ? '#f87171' : alerta === 'proximo' ? '#facc15' : 'white' }}>
              {formatFecha(pedido.fecha_entrega)} {alerta === 'vencido' ? '🔴' : alerta === 'proximo' ? '🟡' : ''}
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: '0.875rem', color: '#6b7280' }}>Progreso</p>
            <p className="num font-bold text-lg">{finalizados}/{articulos.length} arts</p>
          </div>
        </div>
        {articulos.length > 0 && (
          <div style={{ marginTop: '0.75rem', height: '0.5rem', backgroundColor: '#0f1117', borderRadius: '9999px', overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: '9999px', backgroundColor: progreso === 100 ? '#22c55e' : '#3b5bdb', width: progreso + '%', transition: 'width 0.3s' }} />
          </div>
        )}
      </div>

      {/* Lista artículos */}
      {cargando ? (
        <div style={{ textAlign: 'center', color: '#6b7280', padding: '2rem' }}>Cargando...</div>
      ) : (
        <div className="space-y-2">
          <h2 style={{ fontSize: '0.75rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Artículos</h2>
          {articulos.map(art => (
            <TarjetaArticulo key={art.id} art={art} onClick={() => setArtSeleccionado(art)} />
          ))}
        </div>
      )}
    </div>
  )
}

function TarjetaArticulo({ art, onClick }) {
  const sucursales = art.pedido_sucursales || []
  const finalizadas = sucursales.filter(s => s.estado === 'finalizado').length
  const progreso = pct(finalizadas, sucursales.length)

  const estadoColor = { pendiente: '#6b7280', en_proceso: '#60a5fa', finalizado: '#4ade80' }[art.estado] || '#6b7280'
  const estadoLabel = { pendiente: 'Pendiente', en_proceso: 'En proceso', finalizado: 'Finalizado' }[art.estado] || art.estado

  return (
    <div onClick={onClick} style={{ background: '#1a1d27', border: '1px solid #2a2d3e', borderRadius: '0.75rem', padding: '1rem', cursor: 'pointer', display: 'flex', gap: '0.75rem', transition: 'border-color 0.15s' }}>
      {art.foto_url && <img src={art.foto_url} alt="" style={{ width: '3.5rem', height: '3.5rem', objectFit: 'cover', borderRadius: '0.5rem', flexShrink: 0 }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className="num" style={{ color: '#6b8fff', fontWeight: 700 }}>{art.codigo_nuestro}</span>
            <span style={{ fontSize: '0.75rem', color: estadoColor, fontWeight: 600 }}>{estadoLabel}</span>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span className="num" style={{ fontWeight: 700 }}>{finalizadas}/{sucursales.length}</span>
            <span style={{ color: '#6b7280', fontSize: '0.75rem' }}> suc</span>
          </div>
        </div>
        <p style={{ fontSize: '0.875rem', color: 'white', marginTop: '0.125rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {art.descripcion_correcta || art.descripcion_cliente}
        </p>
        <p style={{ fontSize: '0.75rem', color: '#6b7280' }}>{art.total_unidades} u · {sucursales.length} sucursales</p>
        {sucursales.length > 0 && (
          <div style={{ marginTop: '0.5rem', height: '0.25rem', backgroundColor: '#0f1117', borderRadius: '9999px', overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: '9999px', backgroundColor: progreso === 100 ? '#22c55e' : '#3b5bdb', width: progreso + '%' }} />
          </div>
        )}
        {art.estado === 'finalizado' && art.fecha_finalizacion && (
          <p style={{ fontSize: '0.75rem', color: '#4ade80', marginTop: '0.25rem' }}>✓ Finalizado {formatFecha(art.fecha_finalizacion)}</p>
        )}
      </div>
    </div>
  )
}

function ArmarArticulo({ articulo, onVolver, onActualizar }) {
  const [sucursales, setSucursales] = useState(articulo.pedido_sucursales || [])
  const [guardando, setGuardando] = useState(null)
  const [mostrarCurva, setMostrarCurva] = useState(true)
  const variantes = articulo.pedido_articulo_variantes || []
  const modulos = articulo.pedido_modulos || []
  const curva = articulo.curva_talles || null

  const sucsNormales = sucursales.filter(s => !s.es_entrega_final).sort((a, b) => Number(a.nro_sucursal) - Number(b.nro_sucursal))
  const suc0 = sucursales.find(s => s.es_entrega_final)
  const todasNormalesOk = sucsNormales.length > 0 && sucsNormales.every(s => s.estado === 'finalizado')
  const finalizadasNormales = sucsNormales.filter(s => s.estado === 'finalizado').length

  async function avanzarEstado(suc) {
    const siguiente = { pendiente: 'separado', separado: 'guardado' }[suc.estado]
    if (!siguiente) return
    setGuardando(suc.id)
    try {
      await supabase.from('pedido_sucursales').update({ estado: siguiente }).eq('id', suc.id)
      setSucursales(prev => prev.map(s => s.id === suc.id ? { ...s, estado: siguiente } : s))
      // Actualizar estado del artículo a en_proceso si está pendiente
      if (articulo.estado === 'pendiente') {
        await supabase.from('pedido_articulos').update({ estado: 'en_proceso' }).eq('id', articulo.id)
      }
    } catch (err) { console.error(err) }
    finally { setGuardando(null) }
  }

  async function guardarCajas(suc, nroCajas) {
    if (!nroCajas || isNaN(nroCajas)) return
    setGuardando(suc.id)
    try {
      const update = { estado: 'finalizado', nro_cajas: parseInt(nroCajas), fecha_finalizacion: new Date().toISOString().split('T')[0] }
      await supabase.from('pedido_sucursales').update(update).eq('id', suc.id)
      const nuevasSucs = sucursales.map(s => s.id === suc.id ? { ...s, ...update } : s)
      setSucursales(nuevasSucs)
      // Ver si todas las normales finalizaron
      const todasListas = nuevasSucs.filter(s => !s.es_entrega_final).every(s => s.estado === 'finalizado')
      if (todasListas) {
        await supabase.from('pedido_articulos').update({ estado: 'finalizado', fecha_finalizacion: new Date().toISOString().split('T')[0] }).eq('id', articulo.id)
        onActualizar()
      }
    } catch (err) { console.error(err) }
    finally { setGuardando(null) }
  }

  async function finalizarSuc0(nroCajas) {
    if (!suc0) return
    setGuardando(suc0.id)
    try {
      const update = { estado: 'finalizado', nro_cajas: parseInt(nroCajas) || 0, fecha_finalizacion: new Date().toISOString().split('T')[0] }
      await supabase.from('pedido_sucursales').update(update).eq('id', suc0.id)
      setSucursales(prev => prev.map(s => s.id === suc0.id ? { ...s, ...update } : s))
    } catch (err) { console.error(err) }
    finally { setGuardando(null) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onVolver} style={{ color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer' }}>← Volver</button>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className="num" style={{ color: '#6b8fff', fontWeight: 700, fontSize: '1.125rem' }}>{articulo.codigo_nuestro}</span>
            {articulo.codigo_cliente && <span style={{ color: '#6b7280', fontSize: '0.875rem' }}>({articulo.codigo_cliente})</span>}
          </div>
          <p style={{ fontSize: '0.875rem', color: 'white' }}>{articulo.descripcion_correcta || articulo.descripcion_cliente}</p>
        </div>
      </div>

      {/* Info artículo */}
      <div className="card">
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          {articulo.foto_url && <img src={articulo.foto_url} alt="" style={{ width: '5rem', height: '5rem', objectFit: 'cover', borderRadius: '0.5rem', flexShrink: 0 }} />}
          <div>
            <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>{articulo.total_unidades} unidades totales</p>
            <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>{sucsNormales.length} sucursales{suc0 ? ' + suc. 0 (entrega final)' : ''}</p>
            <p style={{ fontSize: '0.875rem', marginTop: '0.25rem' }}>
              <span className="num" style={{ fontWeight: 700 }}>{finalizadasNormales}</span>
              <span style={{ color: '#6b7280' }}>/{sucsNormales.length} listas</span>
            </p>
          </div>
        </div>

        {/* Curva de talles */}
        {curva && Object.keys(curva).length > 0 && (
          <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #2a2d3e' }}>
            <button onClick={() => setMostrarCurva(!mostrarCurva)} style={{ color: '#6b8fff', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}>
              {mostrarCurva ? '▲' : '▼'} Curva de talles por sucursal
            </button>
            {mostrarCurva && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginTop: '0.5rem' }}>
                {Object.entries(curva).map(function(entry) {
                  return (
                    <span key={entry[0]} style={{ fontSize: '0.75rem', background: '#0f1117', border: '1px solid #2a2d3e', padding: '0.25rem 0.5rem', borderRadius: '0.375rem' }}>
                      T<span className="num" style={{ fontWeight: 700 }}>{entry[0]}</span>: {entry[1]}u/suc
                    </span>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Variantes */}
        {variantes.length > 0 && (
          <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #2a2d3e' }}>
            <p style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.375rem', fontWeight: 600 }}>VARIANTES</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
              {variantes.map(v => (
                <span key={v.id} style={{ fontSize: '0.75rem', background: '#0f1117', border: '1px solid #2a2d3e', padding: '0.25rem 0.5rem', borderRadius: '0.375rem' }}>
                  {v.nombre} — <span className="num">{v.cantidad}u</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Módulos */}
        {modulos.length > 0 && (
          <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #2a2d3e' }}>
            <p style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.375rem', fontWeight: 600 }}>MÓDULOS</p>
            {modulos.map(m => (
              <div key={m.id} style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{m.descripcion} — {m.unidades_por_caja} u/caja</div>
            ))}
          </div>
        )}
      </div>

      {/* Sucursales normales */}
      <div className="space-y-2">
        <h2 style={{ fontSize: '0.75rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Sucursales</h2>
        {sucsNormales.map(suc => (
          <FilaSucursal key={suc.id} suc={suc} onAvanzar={() => avanzarEstado(suc)} onGuardarCajas={(n) => guardarCajas(suc, n)} cargando={guardando === suc.id} />
        ))}
      </div>

      {/* Sucursal 0 */}
      {suc0 && (
        <div className="space-y-2">
          <h2 style={{ fontSize: '0.75rem', color: '#c084fc', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Sucursal 0 — Entrega final</h2>
          <FilaSucursal suc={suc0} especial bloqueada={!todasNormalesOk} onAvanzar={() => avanzarEstado(suc0)} onGuardarCajas={(n) => finalizarSuc0(n)} cargando={guardando === suc0.id} />
          {!todasNormalesOk && <p style={{ fontSize: '0.75rem', color: '#c084fc' }}>Se habilita cuando todas las sucursales estén listas.</p>}
        </div>
      )}
    </div>
  )
}

function FilaSucursal({ suc, onAvanzar, onGuardarCajas, cargando, especial, bloqueada }) {
  const [cajasInput, setCajasInput] = useState(suc.nro_cajas ? String(suc.nro_cajas) : '')

  const config = {
    pendiente:  { label: 'Pendiente',  color: '#6b7280', btnLabel: 'Separado ✓', btnBg: '#1e3a5f', btnColor: '#93c5fd' },
    separado:   { label: 'Separado',   color: '#60a5fa', btnLabel: 'Guardado ✓', btnBg: '#451a03', btnColor: '#fcd34d' },
    guardado:   { label: 'Guardado',   color: '#facc15', btnLabel: null },
    finalizado: { label: 'Finalizado', color: '#4ade80', btnLabel: null },
  }[suc.estado] || {}

  function handleCajas() {
    if (!cajasInput || isNaN(cajasInput)) return
    onGuardarCajas(cajasInput)
  }

  return (
    <div style={{
      background: '#1a1d27',
      border: '1px solid ' + (especial ? '#7e22ce' : '#2a2d3e'),
      borderRadius: '0.75rem',
      padding: '0.75rem',
      display: 'flex',
      alignItems: 'center',
      gap: '0.75rem',
      opacity: bloqueada ? 0.4 : 1,
      pointerEvents: bloqueada ? 'none' : 'auto'
    }}>
      {/* Número sucursal */}
      <div style={{
        width: '2.5rem', height: '2.5rem',
        borderRadius: '0.5rem',
        background: especial ? '#3b0764' : '#1e2547',
        color: especial ? '#c084fc' : '#7b9fff', border: '2px solid ' + (especial ? '#7e22ce' : '#3b5bdb'),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: "'Archivo Black', sans-serif",
        fontWeight: 700, fontSize: '1rem', width: '3rem', height: '3rem',
        flexShrink: 0
      }}>
        {suc.nro_sucursal}
      </div>

      {/* Info */}
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ color: config.color, fontWeight: 600, fontSize: '0.875rem' }}>{config.label}</span>
          <span className="num" style={{ color: '#ffffff', fontWeight: 700, fontSize: '1.1rem' }}>{suc.cantidad}<span style={{ fontSize: '0.75rem', color: '#a0aec0', fontWeight: 400 }}> u</span></span>
        </div>
        {suc.talles && Object.keys(suc.talles).length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.25rem' }}>
            {Object.entries(suc.talles).map(function(entry) {
              return (
                <span key={entry[0]} style={{ fontSize: '0.7rem', background: '#0f1117', border: '1px solid #3b5bdb', padding: '0.1rem 0.35rem', borderRadius: '0.25rem', color: '#93c5fd' }}>
                  T{entry[0]}: <span style={{ fontFamily: "'Archivo Black', sans-serif", fontWeight: 700 }}>{entry[1]}</span>u
                </span>
              )
            })}
          </div>
        )}
        {suc.estado === 'finalizado' && suc.nro_cajas && (
          <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>{suc.nro_cajas} caja{suc.nro_cajas > 1 ? 's' : ''} · {formatFecha(suc.fecha_finalizacion)}</p>
        )}
      </div>

      {/* Acciones */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
        {suc.estado === 'guardado' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <input
              type="number" min="1" placeholder="Cajas"
              style={{ width: '4.5rem', background: '#0f1117', border: '1px solid #2a2d3e', borderRadius: '0.5rem', padding: '0.375rem 0.5rem', color: 'white', fontSize: '0.875rem', textAlign: 'center' }}
              value={cajasInput}
              onChange={e => setCajasInput(e.target.value)}
            />
            <button
              onClick={handleCajas}
              disabled={!cajasInput || cargando}
              style={{ background: '#3b5bdb', color: 'white', border: 'none', borderRadius: '0.5rem', padding: '0.375rem 0.75rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' }}
            >
              {cargando ? '...' : '✓'}
            </button>
          </div>
        )}

        {config.btnLabel && (
          <button
            onClick={onAvanzar}
            disabled={cargando}
            style={{ background: config.btnBg, color: config.btnColor, border: 'none', borderRadius: '0.5rem', padding: '0.375rem 0.75rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.75rem' }}
          >
            {cargando ? '...' : config.btnLabel}
          </button>
        )}

        {suc.estado === 'finalizado' && (
          <span style={{ color: '#4ade80', fontSize: '1.25rem' }}>✓</span>
        )}
      </div>
    </div>
  )
}
