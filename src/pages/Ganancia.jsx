import React from 'react'
import { useState, useEffect } from 'react'
import { supabase, supabaseCostos } from '../lib/supabase'
import { formatFecha } from '../lib/utils'

// ─── Fórmulas de venta neta por cliente (lo que factura Lavalle, sin lo que se lleva
//     el impuesto ni los descuentos comerciales) ────────────────────────────────
// GR:     precio × unidades                       (sin IVA ni descuento — verificado)
// Balbi:  precio × (1,21 − 0,25 − 0,05) = ×0,91    (IVA, desc 25% y contado 5%, POR SEPARADO)
// Sucati: precio ÷ 1,21                            (el precio ya es final con IVA)
const IVA = 0.21
const BALBI_DESC = 0.25
const BALBI_CONTADO = 0.05

// Normaliza el código igual que el parser y la vista de costos:
// mayúsculas, sin espacios, letra al final ("1098 L"/"L1098" → "1098L").
function normCod(c) {
  var s = String(c || '').toUpperCase().replace(/\s+/g, '')
  var m = s.match(/^([A-Z]{1,2})(\d{1,4})$/)
  if (m) return m[2] + m[1]
  return s
}

function nombreCliente(p) {
  return (p.clientes && p.clientes.nombre) ? p.clientes.nombre : ''
}

// Devuelve el factor que se aplica al precio para obtener la venta neta por prenda
function factorVenta(cliente) {
  const c = String(cliente || '').toLowerCase()
  if (c.indexOf('balbi') !== -1) return { tipo: 'balbi', factor: (1 + IVA) - BALBI_DESC - BALBI_CONTADO }
  if (c.indexOf('sucati') !== -1) return { tipo: 'sucati', factor: 1 / (1 + IVA) }
  return { tipo: 'gr', factor: 1 } // García Reguera y cualquier otro
}

export default function Ganancia({ session, onVolver }) {
  const [pedidos, setPedidos] = useState([])
  const [costos, setCostos] = useState({})
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [clienteFiltro, setClienteFiltro] = useState('')
  const [expandido, setExpandido] = useState([])
  const [alias, setAlias] = useState({})
  const [editandoAlias, setEditandoAlias] = useState(null)
  const [aliasInput, setAliasInput] = useState('')

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setCargando(true)
    try {
      // Alias de costo (código de pedido → código de costos)
      try {
        const resA = await supabase.from('alias_costo').select('codigo_pedido, codigo_costo')
        if (!resA.error && resA.data) {
          const mapaA = {}
          resA.data.forEach(r => { mapaA[normCod(r.codigo_pedido)] = normCod(r.codigo_costo) })
          setAlias(mapaA)
        }
      } catch (e) { /* la tabla puede no existir todavía */ }

      const { data, error } = await supabase
        .from('pedidos')
        .select('id, numero_pedido, fecha_pedido, fecha_entrega, estado, clientes(nombre), pedido_articulos(id, codigo_nuestro, descripcion_cliente, descripcion_correcta, precio_unitario, total_unidades)')
        .order('fecha_pedido', { ascending: false })
      if (error) throw error
      const lista = data || []
      setPedidos(lista)

      // Traer el costo de todos los códigos que aparecen
      const codigos = []
      lista.forEach(p => (p.pedido_articulos || []).forEach(a => {
        const c = normCod(a.codigo_nuestro)
        if (c && codigos.indexOf(c) === -1) codigos.push(c)
      }))
      if (codigos.length) {
        const resC = await supabaseCostos
          .from('costo_articulo')
          .select('codigo, costo_total')
          .in('codigo', codigos)
        if (!resC.error && resC.data) {
          const mapa = {}
          resC.data.forEach(r => { mapa[String(r.codigo)] = Number(r.costo_total) || 0 })
          setCostos(mapa)
        }
      }
    } catch (err) {
      console.error(err)
      setError(err.message || 'Error cargando la ganancia')
    } finally {
      setCargando(false)
    }
  }

  function toggle(id) {
    setExpandido(prev => prev.includes(id) ? prev.filter(x => x !== id) : prev.concat(id))
  }

  // Ganancia de un pedido: por artículo aplica la fórmula del cliente
  function calcular(p, aliasRef) {
    aliasRef = aliasRef || {}
    const cli = nombreCliente(p)
    const fv = factorVenta(cli)
    let ventaNeta = 0, costoTotal = 0, unidades = 0, sinCosto = 0
    const detalle = []
    ;(p.pedido_articulos || []).forEach(a => {
      const u = Number(a.total_unidades) || 0
      const precio = Number(a.precio_unitario) || 0
      const ventaU = precio * fv.factor
      const codNorm = normCod(a.codigo_nuestro)
      const codParaCosto = aliasRef[codNorm] || codNorm
      const costoU = costos[codParaCosto]
      const tieneCosto = costoU !== undefined
      if (!tieneCosto) sinCosto += 1
      const cU = tieneCosto ? costoU : 0
      const gananciaU = ventaU - cU

      ventaNeta += ventaU * u
      costoTotal += cU * u
      unidades += u
      detalle.push({
        id: a.id,
        codigo: a.codigo_nuestro,
        codigoPedido: codNorm,
        aliasUsado: aliasRef[codNorm] || null,
        descripcion: a.descripcion_correcta || a.descripcion_cliente || '',
        unidades: u,
        precio: precio,
        ventaU: ventaU,
        costoU: cU,
        tieneCosto: tieneCosto,
        gananciaU: gananciaU
      })
    })
    const ganancia = ventaNeta - costoTotal
    const margen = ventaNeta > 0 ? (ganancia / ventaNeta) * 100 : 0
    const gananciaPorPrenda = unidades > 0 ? ganancia / unidades : 0
    return { tipo: fv.tipo, ventaNeta, costoTotal, ganancia, margen, unidades, gananciaPorPrenda, sinCosto, detalle }
  }

  async function guardarAlias(codigoPedido) {
    const destino = normCod(aliasInput)
    if (!destino) { setEditandoAlias(null); return }
    const origen = normCod(codigoPedido)
    try {
      const { error } = await supabase.from('alias_costo')
        .upsert({ codigo_pedido: origen, codigo_costo: destino, actualizado: new Date().toISOString() }, { onConflict: 'codigo_pedido' })
      if (error) throw error
      // traer el costo del código destino si aún no lo tengo
      if (costos[destino] === undefined) {
        const resC = await supabaseCostos.from('costo_articulo').select('codigo, costo_total').eq('codigo', destino).maybeSingle()
        if (!resC.error && resC.data) {
          setCostos(prev => ({ ...prev, [destino]: Number(resC.data.costo_total) || 0 }))
        }
      }
      setAlias(prev => ({ ...prev, [origen]: destino }))
      setEditandoAlias(null)
      setAliasInput('')
      setError('')
    } catch (err) {
      console.error(err)
      setError(err.message || 'No se pudo guardar el alias')
    }
  }

  async function borrarAlias(codigoPedido) {
    const origen = normCod(codigoPedido)
    try {
      await supabase.from('alias_costo').delete().eq('codigo_pedido', origen)
      setAlias(prev => { const c = { ...prev }; delete c[origen]; return c })
    } catch (err) { console.error(err) }
  }

  const clientes = []
  pedidos.forEach(p => {
    const n = nombreCliente(p)
    if (n && clientes.indexOf(n) === -1) clientes.push(n)
  })
  clientes.sort()

  const filtrados = pedidos.filter(p => !clienteFiltro || nombreCliente(p) === clienteFiltro)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <button onClick={onVolver} style={estiloBotonSec}>← Volver</button>
        <h2 style={{ color: '#fff', fontSize: '1.15rem', fontWeight: 800, margin: 0, letterSpacing: '0.02em' }}>
          GANANCIA POR PEDIDO
        </h2>
      </div>

      {error && (
        <div style={{ backgroundColor: '#3b1220', border: '1px solid #b91c1c', color: '#fca5a5', padding: '0.6rem 0.8rem', borderRadius: '0.5rem', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
          {error}
        </div>
      )}

      <div style={{ ...estiloPanel, fontSize: '0.76rem', color: '#8b9dc3' }}>
        <strong style={{ color: '#c8d8ff' }}>Cómo se calcula la venta neta:</strong>{' '}
        García Reguera = precio · Balbi = precio × 0,91 (IVA 21% − desc 25% − contado 5%) · Sucati = precio ÷ 1,21.
        La ganancia es venta neta − costo (tela + avíos + perchas + confección + corte, de la app de Costos).
      </div>

      {/* Filtro por cliente */}
      <div style={estiloPanel}>
        <label style={{ color: '#8b9dc3', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em', marginRight: '0.5rem' }}>
          CLIENTE
        </label>
        <select value={clienteFiltro} onChange={e => setClienteFiltro(e.target.value)} style={estiloInput}>
          <option value="">Todos</option>
          {clientes.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {cargando ? (
        <p style={{ color: '#8b9dc3', fontSize: '0.85rem' }}>Cargando…</p>
      ) : filtrados.length === 0 ? (
        <p style={{ color: '#8b9dc3', fontSize: '0.85rem', textAlign: 'center', marginTop: '1.5rem' }}>
          No hay pedidos.
        </p>
      ) : filtrados.map(p => {
        const r = calcular(p, alias)
        const abierto = expandido.includes(p.id)
        const margenColor = r.margen >= 40 ? '#4ade80' : (r.margen >= 20 ? '#fbbf24' : '#fca5a5')
        return (
          <div key={p.id} style={estiloPanel}>
            <div onClick={() => toggle(p.id)} style={{ cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                <span style={{ color: '#8b9dc3', fontSize: '0.78rem' }}>{abierto ? '▾' : '▸'}</span>
                <span style={{ color: '#fff', fontWeight: 800, fontSize: '0.95rem' }}>{nombreCliente(p) || 'Sin cliente'}</span>
                {p.numero_pedido && <span style={{ color: '#7b9fff', fontSize: '0.85rem' }}>N° {p.numero_pedido}</span>}
                <span style={{ color: '#8b9dc3', fontSize: '0.8rem' }}>{p.fecha_entrega ? 'Entrega ' + formatFecha(p.fecha_entrega) : ''}</span>
                {r.sinCosto > 0 && (
                  <span style={{ color: '#fbbf24', fontSize: '0.74rem' }}>⚠ {r.sinCosto} sin costo</span>
                )}
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.1rem' }}>
                <Dato etiqueta="Venta neta" valor={plata(r.ventaNeta)} />
                <Dato etiqueta="Costo" valor={plata(r.costoTotal)} />
                <Dato etiqueta="Ganancia" valor={plata(r.ganancia)} color="#4ade80" />
                <Dato etiqueta="Por prenda" valor={plata(r.gananciaPorPrenda)} />
                <Dato etiqueta="Margen" valor={r.margen.toFixed(1) + '%'} color={margenColor} />
              </div>
            </div>

            {abierto && (
              <div style={{ marginTop: '0.7rem', paddingTop: '0.6rem', borderTop: '1px solid #2a3150', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                {r.detalle.map(d => (
                  <div key={d.id} style={estiloFila}>
                    <span style={{ color: '#7b9fff', fontWeight: 800, minWidth: '3.2rem', fontSize: '0.82rem' }}>{d.codigo}</span>
                    <span style={{ color: '#e5e7eb', flex: 1, fontSize: '0.8rem', minWidth: '8rem' }}>{d.descripcion}</span>
                    <span style={{ color: '#8b9dc3', fontSize: '0.78rem', minWidth: '3.5rem', textAlign: 'right' }}>{d.unidades} u</span>
                    <span style={{ color: '#c8d8ff', fontSize: '0.78rem', minWidth: '5.5rem', textAlign: 'right' }} title="venta neta por prenda">
                      {plata(d.ventaU)} v/u
                    </span>
                    <span style={{ color: d.tieneCosto ? '#8b9dc3' : '#fbbf24', fontSize: '0.78rem', minWidth: '5.5rem', textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }} title="costo por prenda">
                      {editandoAlias === d.codigoPedido ? (
                        <span style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                          <input
                            type="text"
                            placeholder="código en Costos"
                            value={aliasInput}
                            onChange={e => setAliasInput(e.target.value)}
                            style={{ backgroundColor: '#1a1f35', color: '#fff', border: '1px solid #3b5bdb', borderRadius: '0.3rem', padding: '0.15rem 0.35rem', fontSize: '0.72rem', width: '6rem' }}
                          />
                          <button onClick={() => guardarAlias(d.codigoPedido)} style={estiloMini}>✓</button>
                          <button onClick={() => { setEditandoAlias(null); setAliasInput('') }} style={estiloLink}>✕</button>
                        </span>
                      ) : d.tieneCosto ? (
                        <span>
                          {plata(d.costoU)} c/u
                          {d.aliasUsado && <span style={{ color: '#7c3aed', fontSize: '0.66rem', display: 'block' }}>← usa {d.aliasUsado}</span>}
                          <button onClick={() => { setAliasInput(d.aliasUsado || ''); setEditandoAlias(d.codigoPedido) }} style={{ ...estiloLink, display: 'block' }}>
                            {d.aliasUsado ? 'cambiar' : 'usar otro'}
                          </button>
                        </span>
                      ) : (
                        <span>
                          <span style={{ color: '#fbbf24' }}>sin costo</span>
                          <button onClick={() => { setAliasInput(''); setEditandoAlias(d.codigoPedido) }} style={{ ...estiloLink, display: 'block', color: '#7c3aed' }}>
                            usar costo de otro art
                          </button>
                        </span>
                      )}
                    </span>
                    <span style={{ color: d.gananciaU >= 0 ? '#4ade80' : '#fca5a5', fontWeight: 700, fontSize: '0.82rem', minWidth: '6rem', textAlign: 'right' }}>
                      {plata(d.gananciaU)} g/u
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function plata(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100
  return '$' + v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function Dato({ etiqueta, valor, color }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={{ color: '#8b9dc3', fontSize: '0.68rem', letterSpacing: '0.04em' }}>{etiqueta.toUpperCase()}</span>
      <span style={{ color: color || '#fff', fontSize: '1rem', fontWeight: 800 }}>{valor}</span>
    </div>
  )
}

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
  padding: '0.45rem 0.6rem'
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

const estiloMini = {
  backgroundColor: '#14746b',
  color: '#fff',
  border: 'none',
  borderRadius: '0.3rem',
  padding: '0.15rem 0.4rem',
  fontSize: '0.72rem',
  fontWeight: 800,
  cursor: 'pointer'
}

const estiloLink = {
  background: 'none',
  border: 'none',
  color: '#8b9dc3',
  fontSize: '0.68rem',
  textDecoration: 'underline',
  cursor: 'pointer',
  padding: '0.1rem 0'
}

const estiloInput = {
  backgroundColor: '#1a1f35',
  color: '#fff',
  border: '1px solid #2a3150',
  borderRadius: '0.4rem',
  padding: '0.35rem 0.5rem',
  fontSize: '0.82rem',
  minWidth: '10rem'
}
