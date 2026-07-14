import React from 'react'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { formatFecha, alertaFecha, pct } from '../lib/utils'
import { exportarArticuloSheets } from '../lib/exportarSheets'

export default function DetallePedido({ session, pedido, onVolver }) {
  const [articulos, setArticulos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [artSeleccionado, setArtSeleccionado] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [fotoExpandida, setFotoExpandida] = useState(null)
  useEffect(() => { cargarArticulos() }, [pedido.id])

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
    } catch (err) { console.error(err) }
    finally { setCargando(false) }
  }

  const alerta = alertaFecha(pedido.fecha_entrega)
  const finalizados = articulos.filter(a => a.estado === 'finalizado').length
  const progreso = pct(finalizados, articulos.length)

  const busquedaLower = busqueda.toLowerCase()
  const articulosFiltrados = articulos.filter(a => {
    if (!busqueda) return true
    return a.codigo_nuestro?.toLowerCase().includes(busquedaLower) ||
           a.codigo_cliente?.toLowerCase().includes(busquedaLower) ||
           a.descripcion_cliente?.toLowerCase().includes(busquedaLower) ||
           a.descripcion_correcta?.toLowerCase().includes(busquedaLower)
  })

  if (artSeleccionado) {
    return (
      <>
        {fotoExpandida && <ModalFoto url={fotoExpandida} onClose={() => setFotoExpandida(null)} />}
        <ArmarArticulo
          articulo={artSeleccionado}
          pedido={pedido}
          onVolver={() => { setArtSeleccionado(null); cargarArticulos() }}
          onActualizar={cargarArticulos}
          onExpandirFoto={setFotoExpandida}
        />
      </>
    )
  }

  return (
    <>
      {fotoExpandida && <ModalFoto url={fotoExpandida} onClose={() => setFotoExpandida(null)} />}
      <div className="space-y-5">
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button onClick={onVolver} style={{ color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer' }}>← Volver</button>
          <div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700 }}>{pedido.clientes?.nombre}</h1>
            {pedido.numero_pedido && <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>#{pedido.numero_pedido}</p>}
          </div>
        </div>

        {/* Info pedido */}
        <div className="card" style={{
          background: alerta === 'vencido' ? '#1c0a0a' : alerta === 'proximo' ? '#1c1400' : '#1a1d27',
          border: '1px solid ' + (alerta === 'vencido' ? '#b91c1c' : alerta === 'proximo' ? '#b45309' : '#2a2d3e')
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontSize: '0.875rem', color: '#6b7280' }}>Fecha de entrega</p>
              <p style={{ fontFamily: "'Archivo Black', sans-serif", fontWeight: 700, fontSize: '1.125rem', color: alerta === 'vencido' ? '#f87171' : alerta === 'proximo' ? '#facc15' : 'white' }}>
                {formatFecha(pedido.fecha_entrega)} {alerta === 'vencido' ? '🔴' : alerta === 'proximo' ? '🟡' : ''}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: '0.875rem', color: '#6b7280' }}>Progreso</p>
              <p style={{ fontFamily: "'Archivo Black', sans-serif", fontWeight: 700, fontSize: '1.125rem' }}>{finalizados}/{articulos.length} arts</p>
            </div>
          </div>
          {articulos.length > 0 && (
            <div style={{ marginTop: '0.75rem', height: '0.5rem', background: '#0f1117', borderRadius: '9999px', overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: '9999px', background: progreso === 100 ? '#22c55e' : '#3b5bdb', width: progreso + '%', transition: 'width 0.3s' }} />
            </div>
          )}
        </div>

        {/* Buscador */}
        <input
          className="input"
          placeholder="🔍 Buscar artículo por código o descripción..."
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
        />

        {/* Lista artículos */}
        {cargando ? (
          <div style={{ textAlign: 'center', color: '#6b7280', padding: '2rem' }}>Cargando...</div>
        ) : (
          <div className="space-y-2">
            <h2 style={{ fontSize: '0.75rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
              {articulosFiltrados.length} artículo{articulosFiltrados.length !== 1 ? 's' : ''}
            </h2>
            {articulosFiltrados.map(art => (
              <TarjetaArticulo key={art.id} art={art} onClick={() => setArtSeleccionado(art)} onExpandirFoto={setFotoExpandida} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function ModalFoto({ url, onClose }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out'
    }}>
      <img src={url} alt="" style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: '0.75rem' }} />
    </div>
  )
}

function TarjetaArticulo({ art, onClick, onExpandirFoto }) {
  const sucursales = art.pedido_sucursales || []
  const finalizadas = sucursales.filter(s => s.estado === 'finalizado').length
  const progreso = pct(finalizadas, sucursales.length)
  const estadoColor = { pendiente: '#6b7280', en_proceso: '#60a5fa', finalizado: '#4ade80' }[art.estado] || '#6b7280'
  const estadoLabel = { pendiente: 'Pendiente', en_proceso: 'En proceso', finalizado: 'Finalizado' }[art.estado] || art.estado

  return (
    <div onClick={onClick} style={{ background: '#1a1d27', border: '1px solid #2a2d3e', borderRadius: '0.75rem', padding: '1rem', cursor: 'pointer', display: 'flex', gap: '0.75rem' }}>
      {art.foto_url && (
        <img
          src={art.foto_url} alt=""
          style={{ width: '3.5rem', height: '3.5rem', objectFit: 'cover', borderRadius: '0.5rem', flexShrink: 0, cursor: 'zoom-in' }}
          onClick={e => { e.stopPropagation(); onExpandirFoto(art.foto_url) }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: "'Archivo Black', sans-serif", color: '#6b8fff', fontWeight: 700 }}>{art.codigo_nuestro}</span>
            <span style={{ fontSize: '0.75rem', color: estadoColor, fontWeight: 600 }}>{estadoLabel}</span>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <span style={{ fontFamily: "'Archivo Black', sans-serif", fontWeight: 700 }}>{finalizadas}/{sucursales.length}</span>
            <span style={{ color: '#6b7280', fontSize: '0.75rem' }}> suc</span>
          </div>
        </div>
        <p style={{ fontSize: '0.875rem', color: 'white', marginTop: '0.125rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {art.descripcion_correcta || art.descripcion_cliente}
        </p>
        <p style={{ fontSize: '0.75rem', color: '#6b7280' }}>{art.total_unidades} u · {sucursales.length} sucursales</p>
        {sucursales.length > 0 && (
          <div style={{ marginTop: '0.375rem', height: '0.25rem', background: '#0f1117', borderRadius: '9999px', overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: '9999px', background: progreso === 100 ? '#22c55e' : '#3b5bdb', width: progreso + '%' }} />
          </div>
        )}
        {art.estado === 'finalizado' && art.fecha_finalizacion && (
          <p style={{ fontSize: '0.75rem', color: '#4ade80', marginTop: '0.25rem' }}>✓ {formatFecha(art.fecha_finalizacion)}</p>
        )}
      </div>
    </div>
  )
}

const EMPLEADOS = ['Brian', 'Barto', 'Dario', 'Marcos', 'Meli', 'Luli', 'Maxi', 'Claudia']

function ArmarArticulo({ articulo, pedido, onVolver, onActualizar, onExpandirFoto }) {
  const [sucursales, setSucursales] = useState(articulo.pedido_sucursales || [])
  const [guardando, setGuardando] = useState(null)
  const [mostrarCurva, setMostrarCurva] = useState(true)
  const [preparadores, setPreparadores] = useState(articulo.preparadores || [])
  const [mostrarDropdown, setMostrarDropdown] = useState(false)
  const [guardandoPrep, setGuardandoPrep] = useState(false)

  async function togglePreparador(nombre) {
    const nuevos = preparadores.includes(nombre)
      ? preparadores.filter(p => p !== nombre)
      : [...preparadores, nombre]
    setPreparadores(nuevos)
    setGuardandoPrep(true)
    try {
      await supabase.from('pedido_articulos').update({ preparadores: nuevos }).eq('id', articulo.id)
    } catch (err) { console.error(err) }
    finally { setGuardandoPrep(false) }
  }

  async function editarCantidad(suc, nuevaCantidad) {
    setGuardando(suc.id)
    try {
      await supabase.from('pedido_sucursales').update({ cantidad: nuevaCantidad }).eq('id', suc.id)
      setSucursales(prev => prev.map(s => s.id === suc.id ? { ...s, cantidad: nuevaCantidad } : s))
    } catch (err) { console.error(err) }
    finally { setGuardando(null) }
  }

  const [exportandoArt, setExportandoArt] = useState(false)
  const [exportArtError, setExportArtError] = useState(null)
  const variantes = articulo.pedido_articulo_variantes || []
  const modulos = articulo.pedido_modulos || []

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

  async function exportarArticulo() {
    setExportandoArt(true)
    setExportArtError(null)
    try {
      // Armar objeto articulo con las sucursales actuales del estado local
      const articuloConSucs = { ...articulo, pedido_sucursales: sucursales }
      const url = await exportarArticuloSheets(articuloConSucs, pedido)
      window.open(url, '_blank')
    } catch (err) {
      setExportArtError(err.message || 'Error al exportar')
    } finally {
      setExportandoArt(false)
    }
  }

  return (
    <div className="space-y-4">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button onClick={onVolver} style={{ color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer' }}>← Volver</button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontFamily: "'Archivo Black', sans-serif", color: '#6b8fff', fontWeight: 700, fontSize: '1.125rem' }}>{articulo.codigo_nuestro}</span>
              {articulo.codigo_cliente && <span style={{ color: '#6b7280', fontSize: '0.875rem' }}>({articulo.codigo_cliente})</span>}
            </div>
            <p style={{ fontSize: '0.875rem', color: 'white' }}>{articulo.descripcion_correcta || articulo.descripcion_cliente}</p>
          </div>
        </div>
        <button onClick={exportarArticulo} disabled={exportandoArt} style={{
          background: exportandoArt ? '#14532d' : '#166534', color: '#86efac', border: '1px solid #15803d',
          borderRadius: '0.5rem', padding: '0.375rem 0.75rem', fontSize: '0.75rem',
          fontWeight: 600, cursor: exportandoArt ? 'not-allowed' : 'pointer', flexShrink: 0,
          opacity: exportandoArt ? 0.7 : 1
        }}>{exportandoArt ? '⏳' : '📊 → Sheets'}</button>
      </div>

      {exportArtError && (
        <div style={{ background: '#1c0a0a', border: '1px solid #b91c1c', borderRadius: '0.5rem', padding: '0.625rem 0.875rem', fontSize: '0.8rem', color: '#f87171', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>⚠️ {exportArtError}</span>
          <button onClick={() => setExportArtError(null)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '1rem' }}>✕</button>
        </div>
      )}

      {/* Info artículo */}
      <div className="card">
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          {articulo.foto_url && (
            <img
              src={articulo.foto_url} alt=""
              style={{ width: '5rem', height: '5rem', objectFit: 'cover', borderRadius: '0.5rem', flexShrink: 0, cursor: 'zoom-in' }}
              onClick={() => onExpandirFoto(articulo.foto_url)}
            />
          )}
          <div>
            <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>{articulo.total_unidades} unidades totales</p>
            <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>{sucsNormales.length} sucursales{suc0 ? ' + suc. 0 (entrega final)' : ''}</p>
            {articulo.precio_unitario && <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>Precio: ${articulo.precio_unitario.toLocaleString('es-AR')}</p>}
            {articulo.talles_articulo && articulo.talles_articulo.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.375rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.7rem', color: '#6b7280' }}>Talles:</span>
                {articulo.talles_articulo.map(t => (
                  <span key={t} style={{ fontSize: '0.75rem', background: '#1e2547', border: '1px solid #3b5bdb', padding: '0.1rem 0.4rem', borderRadius: '0.25rem', color: '#c8d8ff', fontFamily: "'Archivo Black', sans-serif", fontWeight: 700 }}>{t}</span>
                ))}
              </div>
            )}
            <p style={{ fontSize: '0.875rem', marginTop: '0.25rem' }}>
              <span style={{ fontFamily: "'Archivo Black', sans-serif", fontWeight: 700 }}>{finalizadasNormales}</span>
              <span style={{ color: '#6b7280' }}>/{sucsNormales.length} listas</span>
            </p>
          </div>
        </div>

        {variantes.length > 0 && (
          <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #2a2d3e' }}>
            <p style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.375rem', fontWeight: 600 }}>VARIANTES</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
              {variantes.map(v => (
                <span key={v.id} style={{ fontSize: '0.75rem', background: '#0f1117', border: '1px solid #2a2d3e', padding: '0.25rem 0.5rem', borderRadius: '0.375rem' }}>
                  {v.nombre} — <span style={{ fontFamily: "'Archivo Black', sans-serif", fontWeight: 700 }}>{v.cantidad}u</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {modulos.length > 0 && (
          <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #2a2d3e' }}>
            <p style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.375rem', fontWeight: 600 }}>MÓDULOS</p>
            {modulos.map(m => <div key={m.id} style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{m.descripcion} — {m.unidades_por_caja} u/caja</div>)}
          </div>
        )}
        {/* Preparadores */}
        <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #2a2d3e', position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <p style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Preparado por {guardandoPrep && <span style={{ color: '#3b5bdb' }}>•</span>}
            </p>
            <button
              onClick={() => setMostrarDropdown(v => !v)}
              style={{ background: '#1e2547', border: '1px solid #3b5bdb', borderRadius: '0.375rem', padding: '0.2rem 0.6rem', color: '#93c5fd', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 600 }}
            >
              {mostrarDropdown ? 'Cerrar' : '+ Editar'}
            </button>
          </div>

          {/* Nombres seleccionados */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginTop: '0.375rem', minHeight: '1.5rem' }}>
            {preparadores.length === 0
              ? <span style={{ fontSize: '0.8rem', color: '#4b5563' }}>Sin asignar</span>
              : preparadores.map(p => (
                <span key={p} style={{ fontSize: '0.8rem', background: '#1e3a5f', border: '1px solid #3b5bdb', borderRadius: '9999px', padding: '0.15rem 0.6rem', color: '#93c5fd', fontWeight: 600 }}>{p}</span>
              ))
            }
          </div>

          {/* Dropdown checklist */}
          {mostrarDropdown && (
            <div style={{ position: 'absolute', left: 0, right: 0, zIndex: 10, background: '#1a1d27', border: '1px solid #2a2d3e', borderRadius: '0.75rem', padding: '0.5rem', marginTop: '0.5rem', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
              {EMPLEADOS.map(emp => (
                <div
                  key={emp}
                  onClick={() => togglePreparador(emp)}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0.625rem', borderRadius: '0.5rem', cursor: 'pointer', background: preparadores.includes(emp) ? '#1e2547' : 'transparent' }}
                >
                  <div style={{
                    width: '1.1rem', height: '1.1rem', borderRadius: '0.25rem', flexShrink: 0,
                    border: '2px solid ' + (preparadores.includes(emp) ? '#3b5bdb' : '#4b5563'),
                    background: preparadores.includes(emp) ? '#3b5bdb' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    {preparadores.includes(emp) && <span style={{ color: 'white', fontSize: '0.7rem', fontWeight: 700 }}>✓</span>}
                  </div>
                  <span style={{ fontSize: '0.9rem', color: preparadores.includes(emp) ? 'white' : '#9ca3af', fontWeight: preparadores.includes(emp) ? 600 : 400 }}>{emp}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Sucursales */}
      <div className="space-y-2">
        <h2 style={{ fontSize: '0.75rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Sucursales</h2>
        {sucsNormales.filter(s => s.cantidad > 0).map(suc => (
          <FilaSucursal key={suc.id} suc={suc} onAvanzar={() => avanzarEstado(suc)} onGuardarCajas={n => guardarCajas(suc, n)} onEditarCantidad={n => editarCantidad(suc, n)} cargando={guardando === suc.id} />
        ))}
      </div>

      {suc0 && (
        <div className="space-y-2">
          <h2 style={{ fontSize: '0.75rem', color: '#c084fc', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Sucursal 0 — Entrega final</h2>
          <FilaSucursal suc={suc0} especial bloqueada={!todasNormalesOk} onAvanzar={() => avanzarEstado(suc0)} onGuardarCajas={n => finalizarSuc0(n)} onEditarCantidad={n => editarCantidad(suc0, n)} cargando={guardando === suc0.id} />
          {!todasNormalesOk && <p style={{ fontSize: '0.75rem', color: '#c084fc' }}>Se habilita cuando todas las sucursales estén listas.</p>}
        </div>
      )}

      {/* Error exportación artículo */}
      {exportArtError && (
        <div style={{ background: '#1c0a0a', border: '1px solid #b91c1c', borderRadius: '0.5rem', padding: '0.625rem 0.875rem', fontSize: '0.8rem', color: '#f87171', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>⚠️ {exportArtError}</span>
          <button onClick={() => setExportArtError(null)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '1rem' }}>✕</button>
        </div>
      )}

      {/* Botón exportar */}
      <button onClick={exportarArticulo} disabled={exportandoArt} style={{
        width: '100%',
        background: exportandoArt ? '#14532d' : '#166534',
        color: '#86efac',
        border: '1px solid #15803d',
        borderRadius: '0.75rem',
        padding: '0.875rem',
        fontSize: '0.9rem',
        fontWeight: 700,
        cursor: exportandoArt ? 'not-allowed' : 'pointer',
        marginTop: '0.5rem',
        opacity: exportandoArt ? 0.7 : 1
      }}>
        {exportandoArt ? '⏳ Subiendo a Sheets...' : '📊 Exportar distribución → Sheets'}
      </button>
    </div>
  )
}

function FilaSucursal({ suc, onAvanzar, onGuardarCajas, onEditarCantidad, cargando, especial, bloqueada }) {
  const [cajasInput, setCajasInput] = useState(suc.nro_cajas ? String(suc.nro_cajas) : '')
  const [editandoCantidad, setEditandoCantidad] = useState(false)
  const [cantidadInput, setCantidadInput] = useState(String(suc.cantidad))
  const config = {
    pendiente:  { label: 'Pendiente',  color: '#6b7280', btnLabel: 'Separado ✓', btnBg: '#1e3a5f', btnColor: '#93c5fd' },
    separado:   { label: 'Separado',   color: '#60a5fa', btnLabel: 'Guardado ✓', btnBg: '#451a03', btnColor: '#fcd34d' },
    guardado:   { label: 'Guardado',   color: '#facc15', btnLabel: null },
    finalizado: { label: 'Finalizado', color: '#4ade80', btnLabel: null },
  }[suc.estado] || {}

  function confirmarCantidad() {
    const nueva = parseInt(cantidadInput)
    if (!nueva || nueva < 0) return
    onEditarCantidad(nueva)
    setEditandoCantidad(false)
  }

  return (
    <div style={{
      background: '#1a1d27', border: '1px solid ' + (especial ? '#7e22ce' : '#2a2d3e'),
      borderRadius: '0.75rem', padding: '0.75rem',
      display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
      opacity: bloqueada ? 0.4 : 1, pointerEvents: bloqueada ? 'none' : 'auto'
    }}>
      {/* Número sucursal */}
      <div style={{
        width: '3rem', height: '3rem', borderRadius: '0.5rem', flexShrink: 0,
        background: especial ? '#3b0764' : '#1e2547',
        color: especial ? '#c084fc' : '#7b9fff',
        border: '2px solid ' + (especial ? '#7e22ce' : '#3b5bdb'),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: "'Archivo Black', sans-serif", fontWeight: 700, fontSize: '1rem'
      }}>
        {suc.nro_sucursal}
      </div>

      {/* Info */}
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span style={{ color: config.color, fontWeight: 600, fontSize: '0.875rem' }}>{config.label}</span>
          {/* Cantidad editable (solo si no está finalizado) */}
          {suc.estado !== 'finalizado' && editandoCantidad ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <input
                type="number" min="0"
                value={cantidadInput}
                onChange={e => setCantidadInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') confirmarCantidad(); if (e.key === 'Escape') setEditandoCantidad(false) }}
                autoFocus
                style={{ width: '4rem', background: '#0f1117', border: '1px solid #3b5bdb', borderRadius: '0.375rem', padding: '0.125rem 0.375rem', color: 'white', fontSize: '1rem', fontFamily: "'Archivo Black', sans-serif", fontWeight: 700, textAlign: 'center' }}
              />
              <span style={{ fontSize: '0.75rem', color: '#a0aec0' }}>u</span>
              <button onClick={confirmarCantidad} style={{ background: '#3b5bdb', color: 'white', border: 'none', borderRadius: '0.375rem', padding: '0.125rem 0.5rem', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700 }}>✓</button>
              <button onClick={() => { setCantidadInput(String(suc.cantidad)); setEditandoCantidad(false) }} style={{ background: 'none', color: '#6b7280', border: 'none', cursor: 'pointer', fontSize: '0.75rem' }}>✕</button>
            </div>
          ) : (
            <span
              onClick={suc.estado !== 'finalizado' ? () => { setCantidadInput(String(suc.cantidad)); setEditandoCantidad(true) } : undefined}
              title={suc.estado !== 'finalizado' ? 'Tocar para editar cantidad' : ''}
              style={{ fontFamily: "'Archivo Black', sans-serif", color: '#ffffff', fontWeight: 700, fontSize: '1.1rem', cursor: suc.estado !== 'finalizado' ? 'pointer' : 'default', borderBottom: suc.estado !== 'finalizado' ? '1px dashed #3b5bdb' : 'none' }}
            >
              {suc.cantidad}<span style={{ fontSize: '0.75rem', color: '#a0aec0', fontWeight: 400 }}> u</span>
            </span>
          )}
        </div>
        {/* Talles por sucursal */}
        {suc.talles && Object.keys(suc.talles).length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.2rem', marginTop: '0.3rem', alignItems: 'center' }}>
            {Object.entries(suc.talles).map(([t, c], i, arr) => (
              <span key={t} style={{ fontSize: '0.7rem', color: '#93c5fd' }}>
                T<span style={{ fontFamily: "'Archivo Black', sans-serif", fontWeight: 700 }}>{t}</span>:<span style={{ fontFamily: "'Archivo Black', sans-serif", fontWeight: 700, color: '#ffffff' }}>{c}</span>{i < arr.length - 1 ? <span style={{ color: '#3b5bdb', margin: '0 0.15rem' }}>·</span> : ''}
              </span>
            ))}
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
            <button onClick={() => onGuardarCajas(cajasInput)} disabled={!cajasInput || cargando}
              style={{ background: '#3b5bdb', color: 'white', border: 'none', borderRadius: '0.5rem', padding: '0.375rem 0.75rem', cursor: 'pointer', fontWeight: 600 }}>
              {cargando ? '...' : '✓'}
            </button>
          </div>
        )}
        {config.btnLabel && (
          <button onClick={onAvanzar} disabled={cargando}
            style={{ background: config.btnBg, color: config.btnColor, border: 'none', borderRadius: '0.5rem', padding: '0.375rem 0.75rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.75rem' }}>
            {cargando ? '...' : config.btnLabel}
          </button>
        )}
        {suc.estado === 'finalizado' && <span style={{ color: '#4ade80', fontSize: '1.25rem' }}>✓</span>}
      </div>
    </div>
  )
}
