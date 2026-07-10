import React from 'react'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { alertaFecha, formatFecha, pct } from '../lib/utils'

export default function Dashboard({ session, onNuevoPedido, onVerPedido }) {
  const [pedidos, setPedidos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [filtro, setFiltro] = useState('activo') // activo | finalizado | todos

  useEffect(() => {
    cargarPedidos()
  }, [])

  async function cargarPedidos() {
    setCargando(true)
    try {
      const { data, error } = await supabase
        .from('pedidos')
        .select(`
          *,
          clientes(nombre),
          pedido_articulos(id, estado, total_unidades)
        `)
        .order('fecha_entrega', { ascending: true })

      if (error) throw error
      setPedidos(data || [])
    } catch (err) {
      console.error(err)
    } finally {
      setCargando(false)
    }
  }

  const pedidosFiltrados = pedidos.filter(p => {
    if (filtro === 'activo') return p.estado === 'activo'
    if (filtro === 'finalizado') return p.estado === 'finalizado'
    return true
  })

  // Alertas: pedidos vencidos o próximos a vencer
  const alertas = pedidos.filter(p => p.estado === 'activo' && alertaFecha(p.fecha_entrega) !== 'ok')

  return (
    <div className="space-y-6">
      {/* Alertas */}
      {alertas.length > 0 && (
        <div className="space-y-2">
          {alertas.map(p => {
            const tipo = alertaFecha(p.fecha_entrega)
            return (
              <div
                key={p.id}
                className={`rounded-xl px-4 py-3 flex items-center justify-between cursor-pointer ${tipo === 'vencido' ? 'alerta-vencido' : 'alerta-proximo'}`}
                onClick={() => onVerPedido(p)}
              >
                <div className="flex items-center gap-3">
                  <span className="text-lg">{tipo === 'vencido' ? '🔴' : '🟡'}</span>
                  <div>
                    <span className="font-semibold">{p.clientes?.nombre}</span>
                    <span className="text-sm opacity-70 ml-2">Pedido #{p.numero_pedido}</span>
                  </div>
                </div>
                <div className="text-right text-sm">
                  <div className="font-semibold">{tipo === 'vencido' ? 'VENCIDO' : 'Próximo a vencer'}</div>
                  <div className="opacity-70">Entrega: {formatFecha(p.fecha_entrega)}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Pedidos</h1>
        <button className="btn-primary text-sm" onClick={onNuevoPedido}>
          + Nuevo pedido
        </button>
      </div>

      {/* Filtros */}
      <div className="flex gap-2">
        {['activo', 'finalizado', 'todos'].map(f => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={`text-sm px-3 py-1.5 rounded-lg font-medium transition-colors ${
              filtro === f ? 'bg-brand-500 text-white' : 'bg-card border border-border text-muted hover:text-white'
            }`}
          >
            {f === 'activo' ? 'Activos' : f === 'finalizado' ? 'Finalizados' : 'Todos'}
          </button>
        ))}
      </div>

      {/* Lista de pedidos */}
      {cargando ? (
        <div className="text-center text-muted py-12">Cargando...</div>
      ) : pedidosFiltrados.length === 0 ? (
        <div className="text-center text-muted py-12">
          <div className="text-4xl mb-3">📦</div>
          <div>No hay pedidos {filtro === 'activo' ? 'activos' : filtro === 'finalizado' ? 'finalizados' : ''}</div>
          <button className="btn-primary mt-4 text-sm" onClick={onNuevoPedido}>Cargar primer pedido</button>
        </div>
      ) : (
        <div className="space-y-3">
          {pedidosFiltrados.map(p => <TarjetaPedido key={p.id} pedido={p} onClick={() => onVerPedido(p)} />)}
        </div>
      )}
    </div>
  )
}

function TarjetaPedido({ pedido, onClick }) {
  const articulos = pedido.pedido_articulos || []
  const total = articulos.length
  const finalizados = articulos.filter(a => a.estado === 'finalizado').length
  const progreso = pct(finalizados, total)
  const alerta = alertaFecha(pedido.fecha_entrega)

  const borderColor = alerta === 'vencido'
    ? 'border-red-700'
    : alerta === 'proximo'
    ? 'border-yellow-700'
    : 'border-border'

  return (
    <div
      className={`card border ${borderColor} cursor-pointer hover:border-brand-500 transition-colors`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-lg">{pedido.clientes?.nombre}</span>
            {pedido.numero_pedido && (
              <span className="text-muted text-sm">#{pedido.numero_pedido}</span>
            )}
            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
              pedido.estado === 'finalizado'
                ? 'bg-green-900 text-green-300'
                : 'bg-blue-900 text-blue-300'
            }`}>
              {pedido.estado === 'finalizado' ? 'Finalizado' : 'Activo'}
            </span>
          </div>
          <div className="text-sm text-muted mt-1">
            Entrega: <span className={`font-medium ${alerta === 'vencido' ? 'text-red-400' : alerta === 'proximo' ? 'text-yellow-400' : 'text-white'}`}>
              {formatFecha(pedido.fecha_entrega)}
            </span>
          </div>
        </div>

        <div className="text-right shrink-0">
          <div className="num text-2xl font-bold text-white">{finalizados}<span className="text-muted text-base">/{total}</span></div>
          <div className="text-xs text-muted">artículos</div>
        </div>
      </div>

      {/* Barra de progreso */}
      {total > 0 && (
        <div className="mt-3">
          <div className="h-1.5 bg-surface rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${progreso === 100 ? 'bg-green-500' : 'bg-brand-500'}`}
              style={{ width: `${progreso}%` }}
            />
          </div>
          <div className="text-xs text-muted mt-1">{progreso}% completado</div>
        </div>
      )}
    </div>
  )
}
