import React from 'react'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { alertaFecha, formatFecha, pct } from '../lib/utils'

export default function Dashboard({ session, onNuevoPedido, onVerPedido }) {
  const [pedidos, setPedidos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [filtro, setFiltro] = useState('activo')
  const [busqueda, setBusqueda] = useState('')
  const [confirmarEliminar, setConfirmarEliminar] = useState(null) // pedido a eliminar
  const [eliminando, setEliminando] = useState(false)

  useEffect(() => { cargarPedidos() }, [])

  async function cargarPedidos() {
    setCargando(true)
    try {
      const { data, error } = await supabase
        .from('pedidos')
        .select('*, clientes(nombre), pedido_articulos(id, estado, total_unidades, codigo_nuestro, descripcion_cliente, descripcion_correcta), descuento, razon_social')
        .order('fecha_entrega', { ascending: true })
      if (error) throw error
      setPedidos(data || [])
    } catch (err) { console.error(err) }
    finally { setCargando(false) }
  }

  async function eliminarPedido(pedido) {
    setEliminando(true)
    try {
      // Borrar en cascada: sucursales → variantes → módulos → artículos → pedido
      const { data: arts } = await supabase.from('pedido_articulos').select('id').eq('pedido_id', pedido.id)
      const artIds = (arts || []).map(a => a.id)
      if (artIds.length > 0) {
        await supabase.from('pedido_sucursales').delete().in('pedido_articulo_id', artIds)
        await supabase.from('pedido_articulo_variantes').delete().in('pedido_articulo_id', artIds)
        await supabase.from('pedido_modulos').delete().in('pedido_articulo_id', artIds)
        await supabase.from('pedido_articulos').delete().eq('pedido_id', pedido.id)
      }
      await supabase.from('pedidos').delete().eq('id', pedido.id)
      setConfirmarEliminar(null)
      await cargarPedidos()
    } catch (err) { console.error(err) }
    finally { setEliminando(false) }
  }

  const busquedaLower = busqueda.toLowerCase()

  const pedidosFiltrados = pedidos.filter(p => {
    if (filtro === 'activo' && p.estado !== 'activo') return false
    if (filtro === 'finalizado' && p.estado !== 'finalizado') return false
    if (!busqueda) return true
    // Buscar por cliente, número de pedido, código o descripción de artículo
    if (p.clientes?.nombre?.toLowerCase().includes(busquedaLower)) return true
    if (p.numero_pedido?.toLowerCase().includes(busquedaLower)) return true
    if (p.pedido_articulos?.some(a =>
      a.codigo_nuestro?.toLowerCase().includes(busquedaLower) ||
      a.descripcion_cliente?.toLowerCase().includes(busquedaLower) ||
      a.descripcion_correcta?.toLowerCase().includes(busquedaLower)
    )) return true
    return false
  })

  const alertas = pedidos.filter(p => p.estado === 'activo' && alertaFecha(p.fecha_entrega) !== 'ok')

  return (
    <div className="space-y-6">
      {/* Alertas */}
      {alertas.length > 0 && (
        <div className="space-y-2">
          {alertas.map(p => {
            const tipo = alertaFecha(p.fecha_entrega)
            return (
              <div key={p.id} onClick={() => onVerPedido(p)} style={{
                borderRadius: '0.75rem', padding: '0.75rem 1rem',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer',
                background: tipo === 'vencido' ? '#1c0a0a' : '#1c1400',
                border: '1px solid ' + (tipo === 'vencido' ? '#b91c1c' : '#b45309'),
                color: tipo === 'vencido' ? '#fca5a5' : '#fcd34d'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span>{tipo === 'vencido' ? '🔴' : '🟡'}</span>
                  <div>
                    <span style={{ fontWeight: 600 }}>{p.clientes?.nombre}</span>
                    <span style={{ fontSize: '0.875rem', opacity: 0.7, marginLeft: '0.5rem' }}>#{p.numero_pedido}</span>
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontSize: '0.875rem' }}>
                  <div style={{ fontWeight: 600 }}>{tipo === 'vencido' ? 'VENCIDO' : 'Próximo a vencer'}</div>
                  <div style={{ opacity: 0.7 }}>{formatFecha(p.fecha_entrega)}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Pedidos</h1>
        <button className="btn-primary" style={{ fontSize: '0.875rem' }} onClick={onNuevoPedido}>+ Nuevo pedido</button>
      </div>

      {/* Buscador */}
      <input
        className="input"
        placeholder="🔍 Buscar por cliente, pedido, artículo o descripción..."
        value={busqueda}
        onChange={e => setBusqueda(e.target.value)}
      />

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {['activo', 'finalizado', 'todos'].map(f => (
          <button key={f} onClick={() => setFiltro(f)} style={{
            fontSize: '0.875rem', padding: '0.375rem 0.75rem', borderRadius: '0.5rem', fontWeight: 500, cursor: 'pointer',
            background: filtro === f ? '#3b5bdb' : '#1a1d27',
            color: filtro === f ? 'white' : '#6b7280',
            border: filtro === f ? 'none' : '1px solid #2a2d3e'
          }}>
            {f === 'activo' ? 'Activos' : f === 'finalizado' ? 'Finalizados' : 'Todos'}
          </button>
        ))}
      </div>

      {/* Lista */}
      {cargando ? (
        <div style={{ textAlign: 'center', color: '#6b7280', padding: '3rem' }}>Cargando...</div>
      ) : pedidosFiltrados.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#6b7280', padding: '3rem' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📦</div>
          <div>{busqueda ? 'Sin resultados para "' + busqueda + '"' : 'No hay pedidos'}</div>
          {!busqueda && <button className="btn-primary" style={{ marginTop: '1rem', fontSize: '0.875rem' }} onClick={onNuevoPedido}>Cargar primer pedido</button>}
        </div>
      ) : (
        <div className="space-y-3">
          {pedidosFiltrados.map(p => <TarjetaPedido key={p.id} pedido={p} onClick={() => onVerPedido(p)} busqueda={busquedaLower} onEliminar={() => setConfirmarEliminar(p)} />)}
        </div>
      )}
      {/* Modal confirmar eliminación */}
      {confirmarEliminar && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ background: '#1a1d27', border: '1px solid #b91c1c', borderRadius: '1rem', padding: '1.5rem', maxWidth: '22rem', width: '100%' }}>
            <h2 style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>¿Eliminar pedido?</h2>
            <p style={{ color: '#9ca3af', fontSize: '0.875rem', marginBottom: '1.25rem' }}>
              <span style={{ color: 'white', fontWeight: 600 }}>{confirmarEliminar.clientes?.nombre}</span>
              {confirmarEliminar.numero_pedido && <span> #{confirmarEliminar.numero_pedido}</span>}
              <br />Esta acción no se puede deshacer.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button onClick={() => setConfirmarEliminar(null)} style={{ flex: 1, background: '#0f1117', color: '#9ca3af', border: '1px solid #2a2d3e', borderRadius: '0.5rem', padding: '0.625rem', fontWeight: 600, cursor: 'pointer' }}>
                Cancelar
              </button>
              <button onClick={() => eliminarPedido(confirmarEliminar)} disabled={eliminando} style={{ flex: 1, background: '#7f1d1d', color: '#fca5a5', border: '1px solid #b91c1c', borderRadius: '0.5rem', padding: '0.625rem', fontWeight: 600, cursor: eliminando ? 'not-allowed' : 'pointer', opacity: eliminando ? 0.7 : 1 }}>
                {eliminando ? 'Eliminando...' : 'Sí, eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TarjetaPedido({ pedido, onClick, busqueda, onEliminar }) {
  const articulos = pedido.pedido_articulos || []
  const total = articulos.length
  const finalizados = articulos.filter(a => a.estado === 'finalizado').length
  const progreso = pct(finalizados, total)
  const alerta = alertaFecha(pedido.fecha_entrega)

  // Artículos que coinciden con la búsqueda
  const artsMatch = busqueda ? articulos.filter(a =>
    a.codigo_nuestro?.toLowerCase().includes(busqueda) ||
    a.descripcion_cliente?.toLowerCase().includes(busqueda) ||
    a.descripcion_correcta?.toLowerCase().includes(busqueda)
  ) : []

  const borderColor = alerta === 'vencido' ? '#b91c1c' : alerta === 'proximo' ? '#b45309' : '#2a2d3e'

  return (
    <div style={{ background: '#1a1d27', border: '1px solid ' + borderColor, borderRadius: '0.75rem', padding: '1rem', position: 'relative' }}>
      <div onClick={onClick} style={{ cursor: 'pointer' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: '1.125rem' }}>{pedido.clientes?.nombre}</span>
            {pedido.numero_pedido && <span style={{ color: '#6b7280', fontSize: '0.875rem' }}>#{pedido.numero_pedido}</span>}
            <span style={{
              fontSize: '0.75rem', padding: '0.125rem 0.5rem', borderRadius: '9999px', fontWeight: 600,
              background: pedido.estado === 'finalizado' ? '#052e16' : '#1e3a5f',
              color: pedido.estado === 'finalizado' ? '#86efac' : '#93c5fd'
            }}>
              {pedido.estado === 'finalizado' ? 'Finalizado' : 'Activo'}
            </span>
          </div>
          <div style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.25rem' }}>
            Entrega: <span style={{ fontWeight: 500, color: alerta === 'vencido' ? '#f87171' : alerta === 'proximo' ? '#facc15' : 'white' }}>
              {formatFecha(pedido.fecha_entrega)}
            </span>
          </div>
          {/* Artículos que coinciden con búsqueda */}
          {artsMatch.length > 0 && (
            <div style={{ marginTop: '0.375rem', display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
              {artsMatch.map(a => (
                <span key={a.id} style={{ fontSize: '0.7rem', background: '#1e2547', border: '1px solid #3b5bdb', padding: '0.1rem 0.4rem', borderRadius: '0.25rem', color: '#93c5fd' }}>
                  {a.codigo_nuestro} — {a.descripcion_correcta || a.descripcion_cliente}
                </span>
              ))}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: '1.5rem', fontWeight: 700, color: 'white' }}>
            {finalizados}<span style={{ color: '#6b7280', fontSize: '1rem' }}>/{total}</span>
          </div>
          <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>artículos</div>
        </div>
      </div>
      {total > 0 && (
        <div style={{ marginTop: '0.75rem' }}>
          <div style={{ height: '0.375rem', background: '#0f1117', borderRadius: '9999px', overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: '9999px', background: progreso === 100 ? '#22c55e' : '#3b5bdb', width: progreso + '%', transition: 'width 0.3s' }} />
          </div>
          <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>{progreso}% completado</div>
        </div>
      )}
      </div>
      {/* Botón eliminar */}
      <button
        onClick={e => { e.stopPropagation(); onEliminar() }}
        style={{ position: 'absolute', top: '0.75rem', right: '0.75rem', background: 'none', border: 'none', color: '#4b5563', cursor: 'pointer', fontSize: '1rem', padding: '0.25rem', lineHeight: 1, borderRadius: '0.25rem' }}
        title="Eliminar pedido"
      >🗑️</button>
    </div>
  )
}

