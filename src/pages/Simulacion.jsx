import React from 'react'
import { useState, useEffect } from 'react'
import { supabase, supabaseCostos } from '../lib/supabase'
import { parsearArchivoPedido } from '../lib/parsearPedido'

// ─── Fórmulas de venta neta por cliente (las mismas de la solapa Ganancia) ───
// GR:     precio × unidades                      (sin IVA ni descuento)
// Balbi:  precio × (1,21 − 0,25 − 0,05) = ×0,91  (IVA, desc 25% y contado 5%, por separado)
// Sucati: precio × unidades                      (el precio de venta ya es el neto)
const IVA = 0.21
const CLIENTES = ['García Reguera', 'Balbi', 'Sucati']

function factorVenta(cliente) {
  const c = String(cliente || '').toLowerCase()
  if (c.indexOf('balbi') !== -1) return (1 + IVA) - 0.25 - 0.05
  if (c.indexOf('sucati') !== -1 || c.indexOf('chandal') !== -1) return 1
  return 1
}

function explicacionFormula(cliente) {
  const c = String(cliente || '').toLowerCase()
  if (c.indexOf('balbi') !== -1) return 'precio × 0,91 (IVA 21% − desc 25% − contado 5%)'
  if (c.indexOf('sucati') !== -1 || c.indexOf('chandal') !== -1) return 'precio tal cual (el precio de venta ya es el neto)'
  return 'precio tal cual (sin IVA ni descuento)'
}

// Los códigos con letra pueden venir "L718" o "718L": son el mismo artículo
function normCod(c) {
  const s = String(c || '').toUpperCase().replace(/\s+/g, '')
  const m = s.match(/^([A-Z]{1,2})(\d{1,4})$/)
  if (m) return m[2] + m[1]
  return s
}
function variantesCod(c) {
  const n = normCod(c)
  const m = n.match(/^(\d{1,4})([A-Z]{1,2})$/)
  const out = [String(c), n]
  if (m) out.push(m[2] + m[1])
  return out.filter((v, i, a) => v && a.indexOf(v) === i)
}

function plata(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100
  return '$' + v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function num(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100
  return v.toLocaleString('es-AR')
}

export default function Simulacion({ session, onVolver }) {
  const [vista, setVista] = useState('lista')   // lista | detalle
  const [simulaciones, setSimulaciones] = useState([])
  const [simActual, setSimActual] = useState(null)
  const [articulos, setArticulos] = useState([])
  const [telasDisponibles, setTelasDisponibles] = useState([])
  const [cargando, setCargando] = useState(false)
  const [procesando, setProcesando] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => { cargarLista() }, [])
  useEffect(() => { cargarTelas() }, [])

  async function cargarLista() {
    try {
      const { data, error } = await supabase
        .from('simulaciones')
        .select('*')
        .order('creada', { ascending: false })
      if (error) throw error
      setSimulaciones(data || [])
    } catch (err) {
      console.error(err)
      setError(err.message || 'Error cargando simulaciones')
    }
  }

  async function cargarTelas() {
    try {
      const { data, error } = await supabaseCostos
        .from('precios_tela')
        .select('id, nombre, precio, unidad, created_at')
        .order('created_at', { ascending: false })
      if (error) throw error
      const vistos = [], lista = []
      ;(data || []).forEach(t => {
        const k = String(t.nombre || '').toLowerCase().trim()
        if (!k || vistos.indexOf(k) !== -1) return
        vistos.push(k); lista.push(t)
      })
      lista.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'))
      setTelasDisponibles(lista)
    } catch (err) {
      console.error('Telas:', err)
    }
  }

  // ── Crear una simulación desde un archivo del cliente ──
  async function onArchivo(e) {
    const archivo = e.target.files && e.target.files[0]
    if (!archivo) return
    setError('')
    setCargando(true)
    try {
      setProcesando('Leyendo el archivo…')
      const parsed = await parsearArchivoPedido(archivo, null, supabaseCostos)
      const arts = (parsed && parsed.articulos) ? parsed.articulos : []
      if (!arts.length) throw new Error('No se pudieron leer artículos de ese archivo')

      // el parser devuelve el cliente en 'cliente_detectado' ('Garcia Reguera', 'Balbi', 'Sucati')
      const detectado = (parsed && parsed.cliente_detectado) ? parsed.cliente_detectado : ''
      const clienteArchivo = CLIENTES.find(c => c.toLowerCase().replace(/í/g, 'i') === detectado.toLowerCase().replace(/í/g, 'i')) || detectado

      setProcesando('Buscando los costos…')
      const costos = await traerCostos(arts.map(a => a.codigo_nuestro))

      setProcesando('Guardando la simulación…')
      const nombre = 'Simulación ' + new Date().toLocaleDateString('es-AR') + ' · ' + (clienteArchivo || archivo.name)
      const resSim = await supabase.from('simulaciones').insert({
        nombre: nombre,
        cliente: clienteArchivo || CLIENTES[0],
        cliente_orig: clienteArchivo || null,
        archivo: archivo.name
      }).select().single()
      if (resSim.error) throw resSim.error
      const sim = resSim.data

      const filas = arts.map((a, i) => {
        const c = costos[normCod(a.codigo_nuestro)] || null
        const t = (c && c.telas && c.telas.length) ? c.telas[0] : null
        return {
          simulacion_id: sim.id,
          orden: i,
          codigo: a.codigo_nuestro || '',
          descripcion: a.descripcion_correcta || a.descripcion_cliente || '',
          unidades: Number(a.total_unidades) || 0,
          precio_venta: Number(a.precio_unitario) || 0,
          tela_nombre: t ? t.nombre : null,
          tela_precio: t ? t.precio : 0,
          tela_cantidad: t ? t.cantidad : 0,
          tela_unidad: t ? t.unidad : null,
          avios: c ? c.avios : 0,
          perchas: c ? c.perchas : 0,
          confeccion: c ? c.confeccion : 0,
          corte: c ? c.corte : 0,
          sin_costo: !c
        }
      })
      const resArt = await supabase.from('simulacion_articulos').insert(filas)
      if (resArt.error) throw resArt.error

      await cargarLista()
      await abrir(sim)
    } catch (err) {
      console.error(err)
      setError(err.message || 'No se pudo crear la simulación')
    } finally {
      setCargando(false)
      setProcesando('')
      e.target.value = ''
    }
  }

  // Trae el desglose de costo por código desde el schema costos
  async function traerCostos(codigos) {
    const limpios = []
    codigos.forEach(c => { if (c && limpios.indexOf(c) === -1) limpios.push(c) })
    if (!limpios.length) return {}
    const busqueda = limpios.reduce((acc, c) => acc.concat(variantesCod(c)), [])

    const resArt = await supabaseCostos
      .from('articulos')
      .select('id, codigo, confeccion, temporada_id, created_at')
      .in('codigo', busqueda)
    if (resArt.error) throw resArt.error
    const arts = resArt.data || []
    if (!arts.length) return {}
    const ids = arts.map(a => a.id)

    const [rTel, rAvi, rPer] = await Promise.all([
      supabaseCostos.from('articulo_telas').select('articulo_id, cantidad, precio_tela_id').in('articulo_id', ids),
      supabaseCostos.from('articulo_avios').select('articulo_id, cantidad, precio_avio_id').in('articulo_id', ids),
      supabaseCostos.from('articulo_percha').select('articulo_id, cantidad, precio_percha_id').in('articulo_id', ids)
    ])

    const idsTela = [], idsAvio = [], idsPercha = []
    ;(rTel.data || []).forEach(r => { if (r.precio_tela_id && idsTela.indexOf(r.precio_tela_id) === -1) idsTela.push(r.precio_tela_id) })
    ;(rAvi.data || []).forEach(r => { if (r.precio_avio_id && idsAvio.indexOf(r.precio_avio_id) === -1) idsAvio.push(r.precio_avio_id) })
    ;(rPer.data || []).forEach(r => { if (r.precio_percha_id && idsPercha.indexOf(r.precio_percha_id) === -1) idsPercha.push(r.precio_percha_id) })

    const [pTel, pAvi, pPer, cfg] = await Promise.all([
      idsTela.length ? supabaseCostos.from('precios_tela').select('id, nombre, precio, unidad').in('id', idsTela) : Promise.resolve({ data: [] }),
      idsAvio.length ? supabaseCostos.from('precios_avios').select('id, precio').in('id', idsAvio) : Promise.resolve({ data: [] }),
      idsPercha.length ? supabaseCostos.from('precios_perchas').select('id, precio').in('id', idsPercha) : Promise.resolve({ data: [] }),
      supabaseCostos.from('config').select('temporada_id, precio_corte')
    ])
    const mTel = {}, mAvi = {}, mPer = {}, mCorte = {}
    ;(pTel.data || []).forEach(p => { mTel[p.id] = p })
    ;(pAvi.data || []).forEach(p => { mAvi[p.id] = Number(p.precio) || 0 })
    ;(pPer.data || []).forEach(p => { mPer[p.id] = Number(p.precio) || 0 })
    ;(cfg.data || []).forEach(c => { mCorte[c.temporada_id] = Number(c.precio_corte) || 0 })

    const telasPorArt = {}, aviosPorArt = {}, perchasPorArt = {}
    ;(rTel.data || []).forEach(r => {
      const p = mTel[r.precio_tela_id]
      if (!telasPorArt[r.articulo_id]) telasPorArt[r.articulo_id] = []
      telasPorArt[r.articulo_id].push({
        nombre: p ? p.nombre : 'Tela',
        precio: p ? Number(p.precio) || 0 : 0,
        unidad: p ? (p.unidad || '') : '',
        cantidad: Number(r.cantidad) || 0
      })
    })
    ;(rAvi.data || []).forEach(r => {
      aviosPorArt[r.articulo_id] = (aviosPorArt[r.articulo_id] || 0) + (Number(r.cantidad) || 0) * (mAvi[r.precio_avio_id] || 0)
    })
    ;(rPer.data || []).forEach(r => {
      perchasPorArt[r.articulo_id] = (perchasPorArt[r.articulo_id] || 0) + (Number(r.cantidad) || 0) * (mPer[r.precio_percha_id] || 0)
    })

    // Si un código está en varias temporadas gana el que tiene tela cargada, y el más reciente
    const elegido = {}
    arts.forEach(a => {
      const c = normCod(a.codigo)
      const tiene = (telasPorArt[a.id] || []).length > 0
      const act = elegido[c]
      if (!act) { elegido[c] = { a, tiene }; return }
      if (tiene && !act.tiene) { elegido[c] = { a, tiene }; return }
      if (tiene === act.tiene && String(a.created_at || '') > String(act.a.created_at || '')) elegido[c] = { a, tiene }
    })

    const out = {}
    Object.keys(elegido).forEach(c => {
      const a = elegido[c].a
      out[c] = {
        telas: telasPorArt[a.id] || [],
        avios: aviosPorArt[a.id] || 0,
        perchas: perchasPorArt[a.id] || 0,
        confeccion: Number(a.confeccion) || 0,
        corte: mCorte[a.temporada_id] || 0
      }
    })
    return out
  }

  async function abrir(sim) {
    setError('')
    setSimActual(sim)
    setVista('detalle')
    try {
      const { data, error } = await supabase
        .from('simulacion_articulos')
        .select('*')
        .eq('simulacion_id', sim.id)
        .order('orden', { ascending: true })
      if (error) throw error
      setArticulos(data || [])
    } catch (err) {
      console.error(err)
      setError(err.message || 'Error abriendo la simulación')
    }
  }

  // ── Edición de un valor de un artículo ──
  function editar(id, campo, valor) {
    setArticulos(prev => prev.map(a => a.id === id ? { ...a, [campo]: valor } : a))
  }

  async function guardarCambios() {
    setGuardando(true)
    setError('')
    try {
      for (const a of articulos) {
        await supabase.from('simulacion_articulos').update({
          precio_venta: Number(a.precio_venta) || 0,
          tela_nombre: a.tela_nombre,
          tela_precio: Number(a.tela_precio) || 0,
          tela_cantidad: Number(a.tela_cantidad) || 0,
          tela_unidad: a.tela_unidad,
          confeccion: Number(a.confeccion) || 0,
          corte: Number(a.corte) || 0
        }).eq('id', a.id)
      }
      if (simActual) {
        await supabase.from('simulaciones').update({ cliente: simActual.cliente }).eq('id', simActual.id)
      }
    } catch (err) {
      console.error(err)
      setError(err.message || 'No se pudieron guardar los cambios')
    } finally {
      setGuardando(false)
    }
  }

  async function borrarSim(sim) {
    if (!window.confirm('¿Borrar la simulación "' + sim.nombre + '"?')) return
    try {
      await supabase.from('simulaciones').delete().eq('id', sim.id)
      await cargarLista()
      if (simActual && simActual.id === sim.id) { setVista('lista'); setSimActual(null) }
    } catch (err) {
      setError(err.message || 'No se pudo borrar')
    }
  }

  // ── Cálculos ──
  function calcular(a, cliente) {
    const u = Number(a.unidades) || 0
    const precio = Number(a.precio_venta) || 0
    const ventaU = precio * factorVenta(cliente)
    const costoTelaU = (Number(a.tela_precio) || 0) * (Number(a.tela_cantidad) || 0)
    const costoU = costoTelaU + (Number(a.avios) || 0) + (Number(a.perchas) || 0) +
                   (Number(a.confeccion) || 0) + (Number(a.corte) || 0)
    const ganU = ventaU - costoU
    const margen = ventaU > 0 ? (ganU / ventaU) * 100 : 0
    return { u, ventaU, costoU, costoTelaU, ganU, margen, venta: ventaU * u, costo: costoU * u, ganancia: ganU * u }
  }

  const cliente = simActual ? simActual.cliente : CLIENTES[0]
  let tVenta = 0, tCosto = 0, tGan = 0, tUnid = 0
  articulos.forEach(a => {
    const r = calcular(a, cliente)
    tVenta += r.venta; tCosto += r.costo; tGan += r.ganancia; tUnid += r.u
  })
  const tMargen = tVenta > 0 ? (tGan / tVenta) * 100 : 0
  const colorMargen = tMargen >= 40 ? '#4ade80' : (tMargen >= 20 ? '#fbbf24' : '#fca5a5')

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.9rem', flexWrap: 'wrap' }}>
        <button onClick={vista === 'detalle' ? () => { setVista('lista'); cargarLista() } : onVolver} style={estiloBotonSec}>← Volver</button>
        <h2 style={{ color: '#fff', fontSize: '1.15rem', fontWeight: 800, margin: 0, letterSpacing: '0.02em' }}>
          SIMULACIÓN DE PEDIDOS
        </h2>
      </div>

      {error && (
        <div style={{ backgroundColor: '#3b1220', border: '1px solid #b91c1c', color: '#fca5a5', padding: '0.6rem 0.8rem', borderRadius: '0.5rem', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
          {error}
        </div>
      )}

      {vista === 'lista' && (
        <div>
          <div style={estiloPanel}>
            <p style={{ color: '#8b9dc3', fontSize: '0.82rem', margin: '0 0 0.6rem 0' }}>
              Subí el archivo del cliente para ver cuánto se gana <strong style={{ color: '#c8d8ff' }}>antes de aprobar el pedido</strong>.
              Después vas a poder cambiar el precio de la tela, la tela, el precio de venta y la confección/corte
              para ver cómo se mueve el margen. Nada de esto toca la app de Costos ni los pedidos reales.
            </p>
            <label style={{ ...estiloBotonPrim, display: 'inline-block', cursor: cargando ? 'wait' : 'pointer', opacity: cargando ? 0.6 : 1 }}>
              {cargando ? (procesando || 'Procesando…') : '+ Nueva simulación'}
              <input type="file" accept=".pdf,.xlsx,.xls" onChange={onArchivo} disabled={cargando} style={{ display: 'none' }} />
            </label>
          </div>

          {simulaciones.length === 0 ? (
            <p style={{ color: '#8b9dc3', fontSize: '0.85rem', textAlign: 'center', marginTop: '1.5rem' }}>
              Todavía no hay simulaciones guardadas.
            </p>
          ) : simulaciones.map(s => (
            <div key={s.id} style={{ ...estiloPanel, display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <button onClick={() => abrir(s)} style={{ background: 'none', border: 'none', color: '#fff', fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer', textAlign: 'left', flex: 1, minWidth: '10rem' }}>
                {s.nombre}
              </button>
              <span style={{ color: '#8b9dc3', fontSize: '0.78rem' }}>{s.cliente}</span>
              <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>
                {s.creada ? new Date(s.creada).toLocaleDateString('es-AR') : ''}
              </span>
              <button onClick={() => borrarSim(s)} style={estiloBotonBorrar}>Borrar</button>
            </div>
          ))}
        </div>
      )}

      {vista === 'detalle' && simActual && (
        <div>
          {/* Cliente y totales */}
          <div style={{ ...estiloPanel, position: 'sticky', top: '4rem', zIndex: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
              <span style={{ color: '#8b9dc3', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em' }}>SIMULAR COMO</span>
              <select
                value={cliente}
                onChange={e => setSimActual({ ...simActual, cliente: e.target.value })}
                style={estiloInput}
              >
                {CLIENTES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <span style={{ color: '#6b7280', fontSize: '0.74rem' }}>{explicacionFormula(cliente)}</span>
              <button onClick={guardarCambios} disabled={guardando} style={{ ...estiloBotonPrim, opacity: guardando ? 0.6 : 1, marginLeft: 'auto' }}>
                {guardando ? 'Guardando…' : 'Guardar'}
              </button>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.2rem' }}>
              <Dato etiqueta="Unidades" valor={tUnid.toLocaleString('es-AR')} />
              <Dato etiqueta="Venta neta" valor={plata(tVenta)} />
              <Dato etiqueta="Costo" valor={plata(tCosto)} />
              <Dato etiqueta="Ganancia" valor={plata(tGan)} color="#4ade80" />
              <Dato etiqueta="Margen" valor={tMargen.toFixed(1) + '%'} color={colorMargen} />
              <Dato etiqueta="Por prenda" valor={tUnid > 0 ? plata(tGan / tUnid) : '—'} />
            </div>
          </div>

          {/* Artículos editables */}
          {articulos.map(a => {
            const r = calcular(a, cliente)
            const cm = r.margen >= 40 ? '#4ade80' : (r.margen >= 20 ? '#fbbf24' : '#fca5a5')
            return (
              <div key={a.id} style={estiloPanel}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                  <span style={{ color: '#7b9fff', fontWeight: 800, fontSize: '0.95rem' }}>{a.codigo}</span>
                  <span style={{ color: '#e5e7eb', fontSize: '0.85rem', flex: 1, minWidth: '10rem' }}>{a.descripcion}</span>
                  <span style={{ color: '#fff', fontWeight: 700, fontSize: '0.85rem' }}>{(a.unidades || 0).toLocaleString('es-AR')} u</span>
                  {a.sin_costo && <span style={{ color: '#fbbf24', fontSize: '0.74rem' }}>⚠ sin costo en Costos</span>}
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.5rem' }}>
                  <Campo etiqueta="Precio venta" valor={a.precio_venta}
                    onChange={v => editar(a.id, 'precio_venta', v)} ancho="6.5rem" />

                  <label style={estiloLabel}>
                    TELA
                    <select
                      value={a.tela_nombre || ''}
                      onChange={e => {
                        const t = telasDisponibles.find(x => x.nombre === e.target.value)
                        editar(a.id, 'tela_nombre', e.target.value)
                        if (t) {
                          editar(a.id, 'tela_precio', Number(t.precio) || 0)
                          editar(a.id, 'tela_unidad', t.unidad || '')
                        }
                      }}
                      style={{ ...estiloInput, minWidth: '9rem' }}
                    >
                      <option value="">— sin tela —</option>
                      {a.tela_nombre && !telasDisponibles.some(t => t.nombre === a.tela_nombre) && (
                        <option value={a.tela_nombre}>{a.tela_nombre}</option>
                      )}
                      {telasDisponibles.map(t => (
                        <option key={t.id} value={t.nombre}>{t.nombre}{t.unidad ? ' (' + t.unidad + ')' : ''}</option>
                      ))}
                    </select>
                  </label>

                  <Campo etiqueta={'Precio tela' + (a.tela_unidad ? ' /' + a.tela_unidad : '')} valor={a.tela_precio}
                    onChange={v => editar(a.id, 'tela_precio', v)} ancho="6.5rem" />
                  <Campo etiqueta="Consumo x prenda" valor={a.tela_cantidad}
                    onChange={v => editar(a.id, 'tela_cantidad', v)} ancho="6rem" />
                  <Campo etiqueta="Confección" valor={a.confeccion}
                    onChange={v => editar(a.id, 'confeccion', v)} ancho="5.5rem" />
                  <Campo etiqueta="Corte" valor={a.corte}
                    onChange={v => editar(a.id, 'corte', v)} ancho="5rem" />
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', paddingTop: '0.5rem', borderTop: '1px solid #2a3150' }}>
                  <Dato etiqueta="Venta x prenda" valor={plata(r.ventaU)} chico />
                  <Dato etiqueta="Costo x prenda" valor={plata(r.costoU)} chico />
                  <Dato etiqueta="Gana x prenda" valor={plata(r.ganU)} chico color={r.ganU >= 0 ? '#4ade80' : '#fca5a5'} />
                  <Dato etiqueta="Margen" valor={r.margen.toFixed(1) + '%'} chico color={cm} />
                  <Dato etiqueta="Ganancia total" valor={plata(r.ganancia)} chico color="#4ade80" />
                  <span style={{ color: '#6b7280', fontSize: '0.7rem', alignSelf: 'flex-end' }}>
                    tela {plata(r.costoTelaU)} + avíos {plata(a.avios)} + perchas {plata(a.perchas)} + confección {plata(a.confeccion)} + corte {plata(a.corte)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Auxiliares ───────────────────────────────────────────────────────────────

function Campo({ etiqueta, valor, onChange, ancho }) {
  return (
    <label style={estiloLabel}>
      {etiqueta.toUpperCase()}
      <input
        type="text"
        inputMode="decimal"
        value={valor === null || valor === undefined ? '' : String(valor)}
        onChange={e => {
          const v = e.target.value.replace(',', '.')
          onChange(v === '' ? 0 : (isNaN(parseFloat(v)) ? valor : parseFloat(v)))
        }}
        style={{ ...estiloInput, width: ancho || '6rem' }}
      />
    </label>
  )
}

function Dato({ etiqueta, valor, color, chico }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={{ color: '#8b9dc3', fontSize: chico ? '0.66rem' : '0.72rem', letterSpacing: '0.04em' }}>
        {etiqueta.toUpperCase()}
      </span>
      <span style={{ color: color || '#fff', fontSize: chico ? '0.9rem' : '1.05rem', fontWeight: 800 }}>{valor}</span>
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

const estiloBotonPrim = {
  backgroundColor: '#22c55e',
  color: '#04220f',
  border: 'none',
  borderRadius: '0.5rem',
  padding: '0.45rem 0.9rem',
  fontSize: '0.85rem',
  fontWeight: 800,
  cursor: 'pointer'
}

const estiloBotonBorrar = {
  backgroundColor: '#7f1d1d',
  color: '#fecaca',
  border: '1px solid #b91c1c',
  borderRadius: '0.45rem',
  padding: '0.3rem 0.6rem',
  fontSize: '0.74rem',
  fontWeight: 700,
  cursor: 'pointer'
}

const estiloLabel = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.2rem',
  color: '#8b9dc3',
  fontSize: '0.64rem',
  fontWeight: 700,
  letterSpacing: '0.04em'
}

const estiloInput = {
  backgroundColor: '#1a1f35',
  color: '#fff',
  border: '1px solid #2a3150',
  borderRadius: '0.4rem',
  padding: '0.3rem 0.45rem',
  fontSize: '0.82rem'
}
