import React from 'react'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { formatFecha } from '../lib/utils'

export default function HistorialClientes({ session, onVolver }) {
  const [pedidos, setPedidos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [clienteFiltro, setClienteFiltro] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [expandido, setExpandido] = useState([])

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setCargando(true)
    try {
      const { data, error } = await supabase
        .from('pedidos')
        .select('id, numero_pedido, fecha_pedido, fecha_entrega, estado, descuento, razon_social, clientes(nombre), pedido_articulos(id, codigo_nuestro, descripcion_cliente, descripcion_correcta, precio_unitario, total_unidades)')
        .order('fecha_pedido', { ascending: false })
      if (error) throw error
      setPedidos(data || [])
    } catch (err) {
      console.error(err)
      setError(err.message || 'Error cargando el historial')
    } finally {
      setCargando(false)
    }
  }

  function toggleExpandido(id) {
    setExpandido(prev => prev.includes(id) ? prev.filter(x => x !== id) : prev.concat(id))
  }

  // Totales de un pedido: cuenta TODO lo pedido (no solo lo finalizado)
  function totalesPedido(p) {
    const arts = p.pedido_articulos || []
    const unidades = arts.reduce((s, a) => s + (Number(a.total_unidades) || 0), 0)
    const bruto = arts.reduce((s, a) => s + (Number(a.precio_unitario) || 0) * (Number(a.total_unidades) || 0), 0)
    const desc = Number(p.descuento) || 0
    const neto = bruto * (1 - desc / 100)
    return { unidades, bruto, neto, desc, cantArticulos: arts.length }
  }

  // Filtros
  const filtrados = pedidos.filter(p => {
    const nombre = p.clientes?.nombre || ''
    if (clienteFiltro && nombre !== clienteFiltro) return false
    if (desde && p.fecha_pedido && p.fecha_pedido < desde) return false
    if (hasta && p.fecha_pedido && p.fecha_pedido > hasta) return false
    return true
  })

  const clientes = []
  pedidos.forEach(p => {
    const n = p.clientes?.nombre
    if (n && clientes.indexOf(n) === -1) clientes.push(n)
  })
  clientes.sort()

  // Agrupar por cliente
  const grupos = {}
  filtrados.forEach(p => {
    const n = p.clientes?.nombre || 'Sin cliente'
    if (!grupos[n]) grupos[n] = []
    grupos[n].push(p)
  })
  const nombresCliente = Object.keys(grupos).sort()

  // Total general
  let genUnidades = 0, genBruto = 0, genNeto = 0
  filtrados.forEach(p => {
    const t = totalesPedido(p)
    genUnidades += t.unidades
    genBruto += t.bruto
    genNeto += t.neto
  })

  return (
    <div>
      {/* Encabezado */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <button onClick={onVolver} style={estiloBotonSec}>← Volver</button>
        <h2 style={{ color: '#fff', fontSize: '1.15rem', fontWeight: 800, margin: 0, letterSpacing: '0.02em' }}>
          HISTORIAL POR CLIENTE
        </h2>
      </div>

      {error && (
        <div style={{ backgroundColor: '#3b1220', border: '1px solid #b91c1c', color: '#fca5a5', padding: '0.6rem 0.8rem', borderRadius: '0.5rem', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
          {error}
        </div>
      )}

      {/* Filtros */}
      <div style={estiloPanel}>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={estiloLabel}>
            Cliente
            <select value={clienteFiltro} onChange={e => setClienteFiltro(e.target.value)} style={estiloInput}>
              <option value="">Todos</option>
              {clientes.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label style={estiloLabel}>
            Desde
            <input type="date" value={desde} onChange={e => setDesde(e.target.value)} style={estiloInput} />
          </label>
          <label style={estiloLabel}>
            Hasta
            <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} style={estiloInput} />
          </label>
          <button
            onClick={() => { setClienteFiltro(''); setDesde(''); setHasta('') }}
            style={estiloBotonSec}
          >
            Limpiar
          </button>
        </div>
      </div>

      {/* Total general */}
      {!cargando && filtrados.length > 0 && (
        <div style={{ ...estiloPanel, backgroundColor: '#101a33', border: '1px solid #3b5bdb' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.2rem', alignItems: 'center' }}>
            <Dato etiqueta="Pedidos" valor={filtrados.length} />
            <Dato etiqueta="Unidades" valor={genUnidades.toLocaleString('es-AR')} />
            <Dato etiqueta="Total bruto" valor={plata(genBruto)} />
            <Dato etiqueta="Con descuento" valor={plata(genNeto)} destacado />
          </div>
        </div>
      )}

      {cargando ? (
        <p style={{ color: '#8b9dc3', fontSize: '0.85rem' }}>Cargando…</p>
      ) : filtrados.length === 0 ? (
        <p style={{ color: '#8b9dc3', fontSize: '0.85rem', textAlign: 'center', marginTop: '1.5rem' }}>
          No hay pedidos para esos filtros.
        </p>
      ) : nombresCliente.map(nombre => {
        const lista = grupos[nombre]
        let cUnid = 0, cBruto = 0, cNeto = 0
        lista.forEach(p => {
          const t = totalesPedido(p)
          cUnid += t.unidades; cBruto += t.bruto; cNeto += t.neto
        })

        return (
          <div key={nombre} style={estiloPanel}>
            {/* Cabecera del cliente */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.7rem', paddingBottom: '0.6rem', borderBottom: '1px solid #2a3150' }}>
              <span style={{ color: '#fff', fontWeight: 800, fontSize: '1.05rem' }}>{nombre.toUpperCase()}</span>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <Dato etiqueta="Pedidos" valor={lista.length} chico />
                <Dato etiqueta="Unidades" valor={cUnid.toLocaleString('es-AR')} chico />
                <Dato etiqueta="Bruto" valor={plata(cBruto)} chico />
                <Dato etiqueta="Con desc." valor={plata(cNeto)} chico destacado />
              </div>
            </div>

            {/* Pedidos del cliente */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {lista.map(p => {
                const t = totalesPedido(p)
                const abierto = expandido.includes(p.id)
                return (
                  <div key={p.id}>
                    <div onClick={() => toggleExpandido(p.id)} style={{ ...estiloFila, cursor: 'pointer' }}>
                      <span style={{ color: '#8b9dc3', fontSize: '0.78rem', minWidth: '1rem' }}>{abierto ? '▾' : '▸'}</span>
                      <span style={{ color: '#7b9fff', fontWeight: 800, fontSize: '0.88rem', minWidth: '5rem' }}>
                        {p.numero_pedido ? 'N° ' + p.numero_pedido : '—'}
                      </span>
                      <span style={{ color: '#e5e7eb', fontSize: '0.8rem', minWidth: '6.5rem' }}>
                        Pedido: {p.fecha_pedido ? formatFecha(p.fecha_pedido) : '—'}
                      </span>
                      <span style={{ color: '#8b9dc3', fontSize: '0.8rem', minWidth: '6.5rem' }}>
                        Entrega: {p.fecha_entrega ? formatFecha(p.fecha_entrega) : '—'}
                      </span>
                      <span style={{ color: '#8b9dc3', fontSize: '0.78rem', minWidth: '4.5rem' }}>
                        {t.cantArticulos} art.
                      </span>
                      <span style={{ color: '#fff', fontWeight: 700, fontSize: '0.85rem', minWidth: '5rem', textAlign: 'right' }}>
                        {t.unidades.toLocaleString('es-AR')} u
                      </span>
                      <span style={{ color: '#c8d8ff', fontSize: '0.85rem', minWidth: '7rem', textAlign: 'right' }}>
                        {plata(t.bruto)}
                      </span>
                      <span style={{ color: '#4ade80', fontWeight: 800, fontSize: '0.88rem', minWidth: '7rem', textAlign: 'right' }}>
                        {plata(t.neto)}
                      </span>
                      {t.desc > 0 && (
                        <span style={{ color: '#fbbf24', fontSize: '0.72rem' }}>−{t.desc}%</span>
                      )}
                    </div>

                    {/* Detalle de artículos */}
                    {abierto && (
                      <div style={{ marginLeft: '1.2rem', marginTop: '0.35rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {(p.pedido_articulos || []).map(a => {
                          const sub = (Number(a.precio_unitario) || 0) * (Number(a.total_unidades) || 0)
                          return (
                            <div key={a.id} style={{ ...estiloFila, backgroundColor: '#151a2e' }}>
                              <span style={{ color: '#7b9fff', fontWeight: 700, fontSize: '0.82rem', minWidth: '3.5rem' }}>
                                {a.codigo_nuestro}
                              </span>
                              <span style={{ color: '#c8d8ff', flex: 1, fontSize: '0.8rem', minWidth: '8rem' }}>
                                {a.descripcion_correcta || a.descripcion_cliente || ''}
                              </span>
                              <span style={{ color: '#8b9dc3', fontSize: '0.8rem', minWidth: '5.5rem', textAlign: 'right' }}>
                                {plata(a.precio_unitario)} c/u
                              </span>
                              <span style={{ color: '#e5e7eb', fontSize: '0.8rem', minWidth: '4.5rem', textAlign: 'right' }}>
                                {(a.total_unidades || 0).toLocaleString('es-AR')} u
                              </span>
                              <span style={{ color: '#fff', fontWeight: 700, fontSize: '0.82rem', minWidth: '7rem', textAlign: 'right' }}>
                                {plata(sub)}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Auxiliares ───────────────────────────────────────────────────────────────

function plata(n) {
  const v = Math.round(Number(n) || 0)
  return '$' + v.toLocaleString('es-AR')
}

function Dato({ etiqueta, valor, chico, destacado }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={{ color: '#8b9dc3', fontSize: chico ? '0.68rem' : '0.72rem', letterSpacing: '0.04em' }}>
        {etiqueta.toUpperCase()}
      </span>
      <span style={{
        color: destacado ? '#4ade80' : '#fff',
        fontSize: chico ? '0.85rem' : '1.05rem',
        fontWeight: 800
      }}>
        {valor}
      </span>
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
  padding: '0.4rem 0.7rem',
  fontSize: '0.8rem',
  fontWeight: 600,
  cursor: 'pointer'
}

const estiloLabel = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
  color: '#8b9dc3',
  fontSize: '0.72rem',
  fontWeight: 700,
  letterSpacing: '0.04em'
}

const estiloInput = {
  backgroundColor: '#1a1f35',
  color: '#fff',
  border: '1px solid #2a3150',
  borderRadius: '0.4rem',
  padding: '0.35rem 0.5rem',
  fontSize: '0.82rem',
  minWidth: '9rem'
}
