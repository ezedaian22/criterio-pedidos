import React from 'react'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { formatFecha, alertaFecha } from '../lib/utils'
import { exportarCortesSheets } from '../lib/exportarSheets'

const TALLERES = ['Eva', 'Juan', 'Justino', 'Jony', 'Farías', 'Lezcano', 'Walter', 'Milton', 'Arturo', 'Ramos']

export default function DistribucionCortes({ session, onVolver }) {
  const [pedidos, setPedidos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [seleccionados, setSeleccionados] = useState([])
  const [vista, setVista] = useState('pedido')
  const [soloActivos, setSoloActivos] = useState(true)
  const [guardando, setGuardando] = useState(null)
  const [exportando, setExportando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { cargar() }, [soloActivos])

  async function cargar() {
    setCargando(true)
    try {
      let q = supabase
        .from('pedidos')
        .select('id, numero_pedido, fecha_entrega, estado, clientes(nombre), pedido_articulos(id, codigo_nuestro, codigo_cliente, descripcion_cliente, descripcion_correcta, total_unidades, taller)')
        .order('fecha_entrega', { ascending: true })
      if (soloActivos) q = q.eq('estado', 'activo')
      const { data, error } = await q
      if (error) throw error
      setPedidos(data || [])
    } catch (err) {
      console.error(err)
      setError(err.message || 'Error cargando pedidos')
    } finally {
      setCargando(false)
    }
  }

  function togglePedido(id) {
    setSeleccionados(prev => prev.includes(id) ? prev.filter(x => x !== id) : prev.concat(id))
  }

  function seleccionarTodos() {
    setSeleccionados(seleccionados.length === pedidos.length ? [] : pedidos.map(p => p.id))
  }

  async function asignarTaller(articuloId, taller) {
    setGuardando(articuloId)
    try {
      const valor = taller || null
      const { error } = await supabase.from('pedido_articulos').update({ taller: valor }).eq('id', articuloId)
      if (error) throw error
      setPedidos(prev => prev.map(p => ({
        ...p,
        pedido_articulos: (p.pedido_articulos || []).map(a => a.id === articuloId ? { ...a, taller: valor } : a)
      })))
    } catch (err) {
      console.error(err)
      setError(err.message || 'No se pudo guardar el taller')
    } finally {
      setGuardando(null)
    }
  }

  const pedidosElegidos = pedidos.filter(p => seleccionados.includes(p.id))

  function articulosOrdenados(p) {
    return (p.pedido_articulos || []).slice().sort((a, b) =>
      String(a.codigo_nuestro || '').localeCompare(String(b.codigo_nuestro || ''), 'es', { numeric: true })
    )
  }

  // Filas planas para agrupar por taller y para exportar
  const filas = []
  pedidosElegidos.forEach(p => {
    articulosOrdenados(p).forEach(a => {
      filas.push({
        articuloId: a.id,
        taller: a.taller || '',
        codigo: a.codigo_nuestro || '',
        descripcion: a.descripcion_correcta || a.descripcion_cliente || '',
        cliente: p.clientes?.nombre || '',
        numero_pedido: p.numero_pedido || '',
        fecha_entrega: p.fecha_entrega ? formatFecha(p.fecha_entrega) : '',
        unidades: a.total_unidades || 0
      })
    })
  })

  const totalUnidades = filas.reduce((s, f) => s + (Number(f.unidades) || 0), 0)
  const sinAsignar = filas.filter(f => !f.taller).length

  async function exportar() {
    if (!filas.length) return
    setExportando(true)
    setError('')
    try {
      const url = await exportarCortesSheets(filas, TALLERES)
      window.open(url, '_blank')
    } catch (err) {
      setError(err.message || 'Error al exportar')
    } finally {
      setExportando(false)
    }
  }

  // Agrupado por taller (para la vista "Por taller")
  const grupos = {}
  filas.forEach(f => {
    const t = f.taller || 'Sin asignar'
    if (!grupos[t]) grupos[t] = []
    grupos[t].push(f)
  })
  const nombresGrupo = TALLERES.filter(t => grupos[t])
  Object.keys(grupos).forEach(t => {
    if (t !== 'Sin asignar' && nombresGrupo.indexOf(t) === -1) nombresGrupo.push(t)
  })
  if (grupos['Sin asignar']) nombresGrupo.push('Sin asignar')

  return (
    <div>
      {/* Encabezado */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <button onClick={onVolver} style={estiloBotonSec}>← Volver</button>
        <h2 style={{ color: '#fff', fontSize: '1.15rem', fontWeight: 800, margin: 0, letterSpacing: '0.02em' }}>
          DISTRIBUCIÓN DE CORTES
        </h2>
      </div>

      {error && (
        <div style={{ backgroundColor: '#3b1220', border: '1px solid #b91c1c', color: '#fca5a5', padding: '0.6rem 0.8rem', borderRadius: '0.5rem', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
          {error}
        </div>
      )}

      {/* Selección de pedidos */}
      <div style={estiloPanel}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <span style={{ color: '#c8d8ff', fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.04em' }}>
            ELEGÍ UNO O VARIOS PEDIDOS
          </span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={seleccionarTodos} style={estiloBotonSec}>
              {seleccionados.length === pedidos.length && pedidos.length > 0 ? 'Ninguno' : 'Todos'}
            </button>
            <button onClick={() => setSoloActivos(v => !v)} style={estiloBotonSec}>
              {soloActivos ? 'Ver todos' : 'Solo activos'}
            </button>
          </div>
        </div>

        {cargando ? (
          <p style={{ color: '#8b9dc3', fontSize: '0.85rem' }}>Cargando…</p>
        ) : pedidos.length === 0 ? (
          <p style={{ color: '#8b9dc3', fontSize: '0.85rem' }}>No hay pedidos.</p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {pedidos.map(p => {
              const activo = seleccionados.includes(p.id)
              const alerta = alertaFecha(p.fecha_entrega)
              return (
                <button
                  key={p.id}
                  onClick={() => togglePedido(p.id)}
                  style={{
                    backgroundColor: activo ? '#1e3a8a' : '#1a1f35',
                    border: '1px solid ' + (activo ? '#3b5bdb' : '#2a3150'),
                    borderRadius: '0.5rem',
                    padding: '0.5rem 0.7rem',
                    cursor: 'pointer',
                    textAlign: 'left',
                    color: '#fff',
                    minWidth: '11rem'
                  }}
                >
                  <div style={{ fontSize: '0.85rem', fontWeight: 700 }}>
                    {p.clientes?.nombre || 'Sin cliente'}{p.numero_pedido ? ' · ' + p.numero_pedido : ''}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: alerta === 'ok' ? '#8b9dc3' : '#fbbf24', marginTop: '0.15rem' }}>
                    Entrega: {p.fecha_entrega ? formatFecha(p.fecha_entrega) : '—'}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#7b9fff', marginTop: '0.15rem' }}>
                    {(p.pedido_articulos || []).length} artículos
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Resumen + acciones */}
      {filas.length > 0 && (
        <div style={{ ...estiloPanel, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.6rem' }}>
          <div style={{ color: '#c8d8ff', fontSize: '0.85rem' }}>
            <strong style={{ color: '#fff' }}>{filas.length}</strong> artículos ·{' '}
            <strong style={{ color: '#fff' }}>{totalUnidades.toLocaleString('es-AR')}</strong> unidades
            {sinAsignar > 0 && (
              <span style={{ color: '#fbbf24' }}> · {sinAsignar} sin taller</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button onClick={() => setVista('pedido')} style={vista === 'pedido' ? estiloTabActivo : estiloTab}>Por pedido</button>
            <button onClick={() => setVista('taller')} style={vista === 'taller' ? estiloTabActivo : estiloTab}>Por taller</button>
            <button onClick={exportar} disabled={exportando} style={{ ...estiloBotonPrim, opacity: exportando ? 0.6 : 1 }}>
              {exportando ? 'Exportando…' : '📊 Exportar → Sheets'}
            </button>
          </div>
        </div>
      )}

      {/* Vista por pedido (acá se asigna el taller) */}
      {vista === 'pedido' && pedidosElegidos.map(p => (
        <div key={p.id} style={estiloPanel}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
            <span style={{ color: '#fff', fontWeight: 800, fontSize: '0.95rem' }}>
              {p.clientes?.nombre || 'Sin cliente'}
            </span>
            {p.numero_pedido && <span style={{ color: '#7b9fff', fontSize: '0.85rem' }}>N° {p.numero_pedido}</span>}
            <span style={{ color: '#8b9dc3', fontSize: '0.8rem' }}>
              Entrega: {p.fecha_entrega ? formatFecha(p.fecha_entrega) : '—'}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {articulosOrdenados(p).map(a => (
              <div key={a.id} style={estiloFila}>
                <span style={{ color: '#7b9fff', fontWeight: 800, minWidth: '3.5rem', fontSize: '0.9rem' }}>
                  {a.codigo_nuestro}
                </span>
                <span style={{ color: '#e5e7eb', flex: 1, fontSize: '0.85rem', minWidth: '9rem' }}>
                  {a.descripcion_correcta || a.descripcion_cliente || ''}
                </span>
                <span style={{ color: '#fff', fontWeight: 700, fontSize: '0.9rem', minWidth: '4.5rem', textAlign: 'right' }}>
                  {(a.total_unidades || 0).toLocaleString('es-AR')} u
                </span>
                <select
                  value={a.taller || ''}
                  onChange={e => asignarTaller(a.id, e.target.value)}
                  disabled={guardando === a.id}
                  style={{
                    backgroundColor: a.taller ? '#1e3a8a' : '#1a1f35',
                    color: '#fff',
                    border: '1px solid ' + (a.taller ? '#3b5bdb' : '#2a3150'),
                    borderRadius: '0.4rem',
                    padding: '0.35rem 0.5rem',
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                    minWidth: '8rem'
                  }}
                >
                  <option value="">Sin asignar</option>
                  {TALLERES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Vista por taller */}
      {vista === 'taller' && nombresGrupo.map(t => {
        const items = grupos[t]
        const sub = items.reduce((s, f) => s + (Number(f.unidades) || 0), 0)
        return (
          <div key={t} style={estiloPanel}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
              <span style={{ color: t === 'Sin asignar' ? '#fbbf24' : '#fff', fontWeight: 800, fontSize: '1rem' }}>
                {t.toUpperCase()}
              </span>
              <span style={{ color: '#c8d8ff', fontSize: '0.85rem', fontWeight: 700 }}>
                {sub.toLocaleString('es-AR')} u · {items.length} art.
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {items.map(f => (
                <div key={f.articuloId} style={estiloFila}>
                  <span style={{ color: '#7b9fff', fontWeight: 800, minWidth: '3.5rem', fontSize: '0.9rem' }}>{f.codigo}</span>
                  <span style={{ color: '#e5e7eb', flex: 1, fontSize: '0.85rem', minWidth: '9rem' }}>{f.descripcion}</span>
                  <span style={{ color: '#8b9dc3', fontSize: '0.78rem', minWidth: '8rem' }}>
                    {f.cliente}{f.numero_pedido ? ' · ' + f.numero_pedido : ''}
                  </span>
                  <span style={{ color: '#8b9dc3', fontSize: '0.78rem', minWidth: '5rem' }}>{f.fecha_entrega}</span>
                  <span style={{ color: '#fff', fontWeight: 700, fontSize: '0.9rem', minWidth: '4.5rem', textAlign: 'right' }}>
                    {Number(f.unidades).toLocaleString('es-AR')} u
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {!cargando && seleccionados.length === 0 && (
        <p style={{ color: '#8b9dc3', fontSize: '0.85rem', textAlign: 'center', marginTop: '1.5rem' }}>
          Elegí al menos un pedido para ver los artículos.
        </p>
      )}
    </div>
  )
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const estiloPanel = {
  backgroundColor: '#13162b',
  border: '1px solid #2a3150',
  borderRadius: '0.75rem',
  padding: '0.9rem',
  marginBottom: '0.9rem'
}

const estiloFila = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.6rem',
  flexWrap: 'wrap',
  backgroundColor: '#1a1f35',
  border: '1px solid #2a3150',
  borderRadius: '0.5rem',
  padding: '0.5rem 0.65rem'
}

const estiloBotonSec = {
  backgroundColor: '#1a1f35',
  color: '#c8d8ff',
  border: '1px solid #3b5bdb',
  borderRadius: '0.5rem',
  padding: '0.35rem 0.7rem',
  fontSize: '0.8rem',
  fontWeight: 600,
  cursor: 'pointer'
}

const estiloBotonPrim = {
  backgroundColor: '#22c55e',
  color: '#04220f',
  border: 'none',
  borderRadius: '0.5rem',
  padding: '0.45rem 0.9rem',
  fontSize: '0.82rem',
  fontWeight: 800,
  cursor: 'pointer'
}

const estiloTab = {
  backgroundColor: '#1a1f35',
  color: '#8b9dc3',
  border: '1px solid #2a3150',
  borderRadius: '0.5rem',
  padding: '0.4rem 0.8rem',
  fontSize: '0.82rem',
  fontWeight: 700,
  cursor: 'pointer'
}

const estiloTabActivo = {
  ...estiloTab,
  backgroundColor: '#1e3a8a',
  color: '#fff',
  border: '1px solid #3b5bdb'
}
