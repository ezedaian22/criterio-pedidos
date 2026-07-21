import React from 'react'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { formatFecha } from '../lib/utils'

const TEMPORADAS = ['Verano', 'Invierno']

// Años disponibles para elegir: del 2024 hasta dos años adelante
function aniosDisponibles() {
  const hoy = new Date().getFullYear()
  const lista = []
  for (let a = hoy + 2; a >= 2024; a--) lista.push(a)
  return lista
}

export default function HistorialClientes({ session, onVolver }) {
  const [pedidos, setPedidos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [clienteFiltro, setClienteFiltro] = useState('')
  const [temporadaFiltro, setTemporadaFiltro] = useState('')
  const [anioFiltro, setAnioFiltro] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [agruparPor, setAgruparPor] = useState('cliente')
  const [expandido, setExpandido] = useState([])
  const [guardando, setGuardando] = useState(null)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setCargando(true)
    try {
      const { data, error } = await supabase
        .from('pedidos')
        .select('id, numero_pedido, fecha_pedido, fecha_entrega, estado, descuento, razon_social, temporada, anio, clientes(nombre), pedido_articulos(id, codigo_nuestro, descripcion_cliente, descripcion_correcta, precio_unitario, total_unidades)')
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

  // Guarda temporada + año. El valor del select viene como "Verano 2026"
  async function asignarTemporada(pedidoId, valor) {
    setGuardando(pedidoId)
    setError('')
    try {
      let temporada = null
      let anio = null
      if (valor) {
        const partes = String(valor).split(' ')
        temporada = partes[0]
        anio = parseInt(partes[1], 10)
        if (isNaN(anio)) anio = null
      }
      const { error } = await supabase.from('pedidos').update({ temporada: temporada, anio: anio }).eq('id', pedidoId)
      if (error) throw error
      setPedidos(prev => prev.map(p => p.id === pedidoId ? { ...p, temporada: temporada, anio: anio } : p))
    } catch (err) {
      console.error(err)
      setError(err.message || 'No se pudo guardar la temporada')
    } finally {
      setGuardando(null)
    }
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

  function etiquetaTemporada(p) {
    if (p.temporada && p.anio) return p.temporada + ' ' + p.anio
    if (p.temporada) return p.temporada
    return ''
  }

  // Filtros
  const filtrados = pedidos.filter(p => {
    const nombre = p.clientes?.nombre || ''
    if (clienteFiltro && nombre !== clienteFiltro) return false
    if (temporadaFiltro && p.temporada !== temporadaFiltro) return false
    if (anioFiltro && String(p.anio || '') !== String(anioFiltro)) return false
    if (desde && p.fecha_pedido && p.fecha_pedido < desde) return false
    if (hasta && p.fecha_pedido && p.fecha_pedido > hasta) return false
    return true
  })

  const clientes = []
  const aniosUsados = []
  pedidos.forEach(p => {
    const n = p.clientes?.nombre
    if (n && clientes.indexOf(n) === -1) clientes.push(n)
    if (p.anio && aniosUsados.indexOf(p.anio) === -1) aniosUsados.push(p.anio)
  })
  clientes.sort()
  aniosUsados.sort(function (a, b) { return b - a })

  // Agrupación
  const grupos = {}
  filtrados.forEach(p => {
    let clave
    if (agruparPor === 'temporada') {
      clave = etiquetaTemporada(p) || 'Sin temporada'
    } else {
      clave = p.clientes?.nombre || 'Sin cliente'
    }
    if (!grupos[clave]) grupos[clave] = []
    grupos[clave].push(p)
  })

  let nombresGrupo = Object.keys(grupos)
  if (agruparPor === 'temporada') {
    nombresGrupo.sort(function (a, b) {
      if (a === 'Sin temporada') return 1
      if (b === 'Sin temporada') return -1
      const anioA = parseInt(String(a).split(' ')[1], 10) || 0
      const anioB = parseInt(String(b).split(' ')[1], 10) || 0
      if (anioA !== anioB) return anioB - anioA
      return String(a).localeCompare(String(b), 'es')
    })
  } else {
    nombresGrupo.sort()
  }

  // Total general
  let genUnidades = 0, genBruto = 0, genNeto = 0
  filtrados.forEach(p => {
    const t = totalesPedido(p)
    genUnidades += t.unidades
    genBruto += t.bruto
    genNeto += t.neto
  })

  const opcionesTemporada = []
  aniosDisponibles().forEach(a => {
    TEMPORADAS.forEach(t => opcionesTemporada.push(t + ' ' + a))
  })

  const sinTemporada = pedidos.filter(p => !p.temporada).length

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
            Temporada
            <select value={temporadaFiltro} onChange={e => setTemporadaFiltro(e.target.value)} style={estiloInput}>
              <option value="">Todas</option>
              {TEMPORADAS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label style={estiloLabel}>
            Año
            <select value={anioFiltro} onChange={e => setAnioFiltro(e.target.value)} style={estiloInput}>
              <option value="">Todos</option>
              {aniosUsados.map(a => <option key={a} value={a}>{a}</option>)}
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
            onClick={() => { setClienteFiltro(''); setTemporadaFiltro(''); setAnioFiltro(''); setDesde(''); setHasta('') }}
            style={estiloBotonSec}
          >
            Limpiar
          </button>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.7rem', paddingTop: '0.7rem', borderTop: '1px solid #2a3150', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: '#8b9dc3', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em' }}>AGRUPAR POR</span>
          <button onClick={() => setAgruparPor('cliente')} style={agruparPor === 'cliente' ? estiloTabActivo : estiloTab}>Cliente</button>
          <button onClick={() => setAgruparPor('temporada')} style={agruparPor === 'temporada' ? estiloTabActivo : estiloTab}>Temporada</button>
          {sinTemporada > 0 && (
            <span style={{ color: '#fbbf24', fontSize: '0.76rem' }}>
              {sinTemporada} pedido{sinTemporada === 1 ? '' : 's'} sin temporada asignada
            </span>
          )}
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
      ) : nombresGrupo.map(nombre => {
        const lista = grupos[nombre]
        let cUnid = 0, cBruto = 0, cNeto = 0
        lista.forEach(p => {
          const t = totalesPedido(p)
          cUnid += t.unidades; cBruto += t.bruto; cNeto += t.neto
        })

        return (
          <div key={nombre} style={estiloPanel}>
            {/* Cabecera del grupo */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.7rem', paddingBottom: '0.6rem', borderBottom: '1px solid #2a3150' }}>
              <span style={{ color: nombre === 'Sin temporada' ? '#fbbf24' : '#fff', fontWeight: 800, fontSize: '1.05rem' }}>
                {nombre.toUpperCase()}
              </span>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <Dato etiqueta="Pedidos" valor={lista.length} chico />
                <Dato etiqueta="Unidades" valor={cUnid.toLocaleString('es-AR')} chico />
                <Dato etiqueta="Bruto" valor={plata(cBruto)} chico />
                <Dato etiqueta="Con desc." valor={plata(cNeto)} chico destacado />
              </div>
            </div>

            {/* Pedidos del grupo */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {lista.map(p => {
                const t = totalesPedido(p)
                const abierto = expandido.includes(p.id)
                const etiqTemp = etiquetaTemporada(p)
                return (
                  <div key={p.id}>
                    <div style={estiloFila}>
                      <span onClick={() => toggleExpandido(p.id)} style={{ color: '#8b9dc3', fontSize: '0.78rem', minWidth: '1rem', cursor: 'pointer' }}>
                        {abierto ? '▾' : '▸'}
                      </span>
                      <span onClick={() => toggleExpandido(p.id)} style={{ color: '#7b9fff', fontWeight: 800, fontSize: '0.88rem', minWidth: '5rem', cursor: 'pointer' }}>
                        {p.numero_pedido ? 'N° ' + p.numero_pedido : '—'}
                      </span>
                      {agruparPor === 'temporada' && (
                        <span style={{ color: '#c8d8ff', fontSize: '0.8rem', minWidth: '7rem' }}>
                          {p.clientes?.nombre || 'Sin cliente'}
                        </span>
                      )}
                      <span style={{ color: '#e5e7eb', fontSize: '0.8rem', minWidth: '6.5rem' }}>
                        Pedido: {p.fecha_pedido ? formatFecha(p.fecha_pedido) : '—'}
                      </span>
                      <span style={{ color: '#8b9dc3', fontSize: '0.8rem', minWidth: '6.5rem' }}>
                        Entrega: {p.fecha_entrega ? formatFecha(p.fecha_entrega) : '—'}
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
                      <select
                        value={etiqTemp}
                        onChange={e => asignarTemporada(p.id, e.target.value)}
                        disabled={guardando === p.id}
                        style={{
                          backgroundColor: etiqTemp ? '#1e3a8a' : '#1a1f35',
                          color: etiqTemp ? '#fff' : '#fbbf24',
                          border: '1px solid ' + (etiqTemp ? '#3b5bdb' : '#a16207'),
                          borderRadius: '0.4rem',
                          padding: '0.3rem 0.45rem',
                          fontSize: '0.78rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          minWidth: '8.5rem'
                        }}
                      >
                        <option value="">Sin temporada</option>
                        {etiqTemp && opcionesTemporada.indexOf(etiqTemp) === -1 && (
                          <option value={etiqTemp}>{etiqTemp}</option>
                        )}
                        {opcionesTemporada.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
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
  minWidth: '8rem'
}

const estiloTab = {
  backgroundColor: '#1a1f35',
  color: '#8b9dc3',
  border: '1px solid #2a3150',
  borderRadius: '0.5rem',
  padding: '0.35rem 0.75rem',
  fontSize: '0.8rem',
  fontWeight: 700,
  cursor: 'pointer'
}

const estiloTabActivo = {
  ...estiloTab,
  backgroundColor: '#1e3a8a',
  color: '#fff',
  border: '1px solid #3b5bdb'
}
