import React from 'react'
import { useState, useEffect } from 'react'
import { supabase, supabaseCostos } from '../lib/supabase'
import { formatFecha } from '../lib/utils'
import { exportarCortesSheets } from '../lib/exportarSheets'

const TALLERES = ['Eva', 'Juan', 'Justino', 'Jony', 'Farías', 'Lezcano', 'Walter', 'Milton', 'Arturo', 'Ramos']

export default function DistribucionCortes({ session, onVolver }) {
  const [pedidos, setPedidos] = useState([])
  const [historial, setHistorial] = useState({})
  const [cargando, setCargando] = useState(true)
  const [seleccionados, setSeleccionados] = useState([])
  const [soloActivos, setSoloActivos] = useState(true)
  const [agruparRepetidos, setAgruparRepetidos] = useState(true)
  const [soloPendientes, setSoloPendientes] = useState(false)
  const [panelPedidos, setPanelPedidos] = useState(true)
  const [guardando, setGuardando] = useState(null)
  const [autoasignando, setAutoasignando] = useState(false)
  const [exportando, setExportando] = useState(false)
  const [error, setError] = useState('')
  const [temporadasCostos, setTemporadasCostos] = useState([])
  const [temporadaCostosId, setTemporadaCostosId] = useState('')
  const [costosPorCodigo, setCostosPorCodigo] = useState({})
  const [panelDerecho, setPanelDerecho] = useState('talleres')

  useEffect(() => { cargar() }, [soloActivos])
  useEffect(() => { cargarHistorial() }, [])
  useEffect(() => { cargarTemporadasCostos() }, [])
  useEffect(() => {
    const cods = []
    pedidos.forEach(p => {
      if (seleccionados.indexOf(p.id) === -1) return
      ;(p.pedido_articulos || []).forEach(a => {
        const c = String(a.codigo_nuestro || '')
        if (c && cods.indexOf(c) === -1) cods.push(c)
      })
    })
    cargarCostos(cods, temporadaCostosId)
  }, [seleccionados.join(','), temporadaCostosId, pedidos.length])

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

  async function cargarHistorial() {
    try {
      const { data, error } = await supabase.from('taller_por_articulo').select('codigo_nuestro, taller')
      if (error) throw error
      const mapa = {}
      ;(data || []).forEach(r => { if (r.codigo_nuestro) mapa[String(r.codigo_nuestro)] = r.taller })
      setHistorial(mapa)
    } catch (err) {
      console.error('Historial de talleres:', err)
    }
  }

  // ─── Costos: telas, consumo y precio (schema costos) ───
  async function cargarTemporadasCostos() {
    try {
      const { data, error } = await supabaseCostos
        .from('temporadas')
        .select('id, nombre, activa')
        .order('created_at', { ascending: false })
      if (error) throw error
      const lista = data || []
      setTemporadasCostos(lista)
      const activa = lista.find(t => t.activa)
      if (activa) setTemporadaCostosId(activa.id)
      else if (lista.length) setTemporadaCostosId(lista[0].id)
    } catch (err) {
      console.error('Temporadas de costos:', err)
    }
  }

  async function cargarCostos(codigos, tempId) {
    if (!tempId || !codigos.length) { setCostosPorCodigo({}); return }
    try {
      const resArt = await supabaseCostos
        .from('articulos')
        .select('id, codigo, descripcion, confeccion, categoria, notas_taller')
        .eq('temporada_id', tempId)
        .in('codigo', codigos)
      if (resArt.error) throw resArt.error
      const arts = resArt.data || []
      if (!arts.length) { setCostosPorCodigo({}); return }

      const artIds = arts.map(a => a.id)
      const resTelas = await supabaseCostos
        .from('articulo_telas')
        .select('articulo_id, cantidad, precio_tela_id')
        .in('articulo_id', artIds)
      if (resTelas.error) throw resTelas.error
      const rel = resTelas.data || []

      let precios = []
      const idsPrecio = []
      rel.forEach(r => { if (r.precio_tela_id && idsPrecio.indexOf(r.precio_tela_id) === -1) idsPrecio.push(r.precio_tela_id) })
      if (idsPrecio.length) {
        const resPrecios = await supabaseCostos
          .from('precios_tela')
          .select('id, nombre, precio, unidad')
          .in('id', idsPrecio)
        if (resPrecios.error) throw resPrecios.error
        precios = resPrecios.data || []
      }
      const mapaPrecio = {}
      precios.forEach(pr => { mapaPrecio[pr.id] = pr })

      const porArtId = {}
      rel.forEach(r => {
        if (!porArtId[r.articulo_id]) porArtId[r.articulo_id] = []
        const pr = mapaPrecio[r.precio_tela_id]
        porArtId[r.articulo_id].push({
          tela: pr ? pr.nombre : 'Tela sin nombre',
          precio: pr ? Number(pr.precio) || 0 : 0,
          unidad: pr ? (pr.unidad || '') : '',
          cantidad: Number(r.cantidad) || 0
        })
      })

      const mapa = {}
      arts.forEach(a => {
        mapa[String(a.codigo)] = {
          confeccion: Number(a.confeccion) || 0,
          categoria: a.categoria || '',
          notas_taller: a.notas_taller || '',
          telas: porArtId[a.id] || []
        }
      })
      setCostosPorCodigo(mapa)
    } catch (err) {
      console.error('Costos:', err)
      setCostosPorCodigo({})
    }
  }

  function togglePedido(id) {
    setSeleccionados(prev => prev.includes(id) ? prev.filter(x => x !== id) : prev.concat(id))
  }

  function seleccionarTodos() {
    setSeleccionados(seleccionados.length === pedidos.length ? [] : pedidos.map(p => p.id))
  }

  // Asigna el taller a uno o varios registros a la vez (un artículo repetido en
  // varios pedidos se asigna de una sola vez)
  async function asignarTaller(ids, taller, codigo) {
    const lista = Array.isArray(ids) ? ids : [ids]
    if (!lista.length) return
    setGuardando(lista[0])
    try {
      const valor = taller || null
      const { error } = await supabase.from('pedido_articulos').update({ taller: valor }).in('id', lista)
      if (error) throw error

      setPedidos(prev => prev.map(p => ({
        ...p,
        pedido_articulos: (p.pedido_articulos || []).map(a => lista.indexOf(a.id) !== -1 ? { ...a, taller: valor } : a)
      })))

      if (valor && codigo) {
        const cod = String(codigo)
        const { error: errMem } = await supabase
          .from('taller_por_articulo')
          .upsert({ codigo_nuestro: cod, taller: valor, actualizado: new Date().toISOString() }, { onConflict: 'codigo_nuestro' })
        if (errMem) console.error('No se pudo guardar en memoria:', errMem)
        else setHistorial(prev => ({ ...prev, [cod]: valor }))
      }
    } catch (err) {
      console.error(err)
      setError(err.message || 'No se pudo guardar el taller')
    } finally {
      setGuardando(null)
    }
  }

  const pedidosElegidos = pedidos.filter(p => seleccionados.includes(p.id))

  // Filas planas (una por registro real) — es lo que se exporta
  const filas = []
  pedidosElegidos.forEach(p => {
    ;(p.pedido_articulos || []).forEach(a => {
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

  // Items para trabajar: agrupados por código (sumando unidades) o uno por registro
  let items = []
  if (agruparRepetidos) {
    const porCodigo = {}
    filas.forEach(f => {
      const c = String(f.codigo)
      if (!porCodigo[c]) {
        porCodigo[c] = {
          codigo: f.codigo,
          descripcion: f.descripcion,
          unidades: 0,
          ids: [],
          talleres: [],
          origenes: [],
          fechas: []
        }
      }
      const g = porCodigo[c]
      g.unidades += Number(f.unidades) || 0
      g.ids.push(f.articuloId)
      if (g.talleres.indexOf(f.taller) === -1) g.talleres.push(f.taller)
      const org = f.cliente + (f.numero_pedido ? ' ' + f.numero_pedido : '')
      if (g.origenes.indexOf(org) === -1) g.origenes.push(org)
      if (f.fecha_entrega && g.fechas.indexOf(f.fecha_entrega) === -1) g.fechas.push(f.fecha_entrega)
    })
    items = Object.keys(porCodigo).map(c => {
      const g = porCodigo[c]
      g.taller = g.talleres.length === 1 ? g.talleres[0] : ''
      g.mixto = g.talleres.length > 1
      g.repetido = g.ids.length > 1
      return g
    })
  } else {
    items = filas.map(f => ({
      codigo: f.codigo,
      descripcion: f.descripcion,
      unidades: Number(f.unidades) || 0,
      ids: [f.articuloId],
      taller: f.taller,
      mixto: false,
      repetido: false,
      origenes: [f.cliente + (f.numero_pedido ? ' ' + f.numero_pedido : '')],
      fechas: f.fecha_entrega ? [f.fecha_entrega] : []
    }))
  }

  items.sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), 'es', { numeric: true }))

  const itemsVisibles = soloPendientes ? items.filter(i => !i.taller) : items

  const totalUnidades = filas.reduce((s, f) => s + (Number(f.unidades) || 0), 0)
  const sinAsignar = items.filter(i => !i.taller).length
  const sugeridos = items.filter(i => !i.taller && historial[String(i.codigo)])

  // Tela de cada artículo: consumo por prenda × unidades del pedido
  function telasDeItem(it) {
    const c = costosPorCodigo[String(it.codigo)]
    if (!c || !c.telas.length) return []
    return c.telas.map(t => ({
      tela: t.tela,
      unidad: t.unidad,
      precio: t.precio,
      porPrenda: t.cantidad,
      total: t.cantidad * it.unidades,
      costo: t.cantidad * it.unidades * t.precio
    }))
  }

  // Resumen de tela por taller
  const telaPorTaller = {}
  items.forEach(it => {
    const t = it.taller || 'Sin asignar'
    const lista = telasDeItem(it)
    if (!lista.length) return
    if (!telaPorTaller[t]) telaPorTaller[t] = {}
    lista.forEach(x => {
      const k = x.tela + ' | ' + (x.unidad || '')
      if (!telaPorTaller[t][k]) telaPorTaller[t][k] = { tela: x.tela, unidad: x.unidad, total: 0, costo: 0 }
      telaPorTaller[t][k].total += x.total
      telaPorTaller[t][k].costo += x.costo
    })
  })

  const hayCostos = Object.keys(costosPorCodigo).length > 0

  async function autoasignar() {
    if (!sugeridos.length) return
    setAutoasignando(true)
    setError('')
    try {
      for (let i = 0; i < sugeridos.length; i++) {
        const it = sugeridos[i]
        await asignarTaller(it.ids, historial[String(it.codigo)], it.codigo)
      }
    } finally {
      setAutoasignando(false)
    }
  }

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

  // Agrupado por taller — en vivo, para el panel de la derecha
  const grupos = {}
  items.forEach(i => {
    const t = i.taller || 'Sin asignar'
    if (!grupos[t]) grupos[t] = []
    grupos[t].push(i)
  })
  const nombresGrupo = TALLERES.filter(t => grupos[t])
  Object.keys(grupos).forEach(t => {
    if (t !== 'Sin asignar' && nombresGrupo.indexOf(t) === -1) nombresGrupo.push(t)
  })
  if (grupos['Sin asignar']) nombresGrupo.push('Sin asignar')

  return (
    <div>
      {/* Encabezado */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.7rem', flexWrap: 'wrap' }}>
        <button onClick={onVolver} style={estiloBotonSec}>← Volver</button>
        <h2 style={{ color: '#fff', fontSize: '1.05rem', fontWeight: 800, margin: 0, letterSpacing: '0.02em' }}>
          DISTRIBUCIÓN DE CORTES
        </h2>
      </div>

      {error && (
        <div style={{ backgroundColor: '#3b1220', border: '1px solid #b91c1c', color: '#fca5a5', padding: '0.5rem 0.7rem', borderRadius: '0.5rem', marginBottom: '0.6rem', fontSize: '0.82rem' }}>
          {error}
        </div>
      )}

      {/* Pedidos — plegable para no ocupar pantalla */}
      <div style={estiloPanelChico}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
          <button onClick={() => setPanelPedidos(v => !v)} style={estiloBotonPlano}>
            {panelPedidos ? '▾' : '▸'} PEDIDOS
            <span style={{ color: '#7b9fff', marginLeft: '0.4rem' }}>
              ({seleccionados.length} elegido{seleccionados.length === 1 ? '' : 's'})
            </span>
          </button>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            <button onClick={seleccionarTodos} style={estiloBotonSec}>
              {seleccionados.length === pedidos.length && pedidos.length > 0 ? 'Ninguno' : 'Todos'}
            </button>
            <button onClick={() => setSoloActivos(v => !v)} style={estiloBotonSec}>
              {soloActivos ? 'Ver todos' : 'Solo activos'}
            </button>
          </div>
        </div>

        {panelPedidos && (
          cargando ? (
            <p style={{ color: '#8b9dc3', fontSize: '0.82rem', marginTop: '0.5rem' }}>Cargando…</p>
          ) : pedidos.length === 0 ? (
            <p style={{ color: '#8b9dc3', fontSize: '0.82rem', marginTop: '0.5rem' }}>No hay pedidos.</p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.55rem' }}>
              {pedidos.map(p => {
                const activo = seleccionados.includes(p.id)
                return (
                  <button
                    key={p.id}
                    onClick={() => togglePedido(p.id)}
                    style={{
                      backgroundColor: activo ? '#1e3a8a' : '#1a1f35',
                      border: '1px solid ' + (activo ? '#3b5bdb' : '#2a3150'),
                      borderRadius: '0.45rem',
                      padding: '0.35rem 0.6rem',
                      cursor: 'pointer',
                      textAlign: 'left',
                      color: '#fff',
                      fontSize: '0.78rem'
                    }}
                  >
                    <strong>{p.clientes?.nombre || 'Sin cliente'}</strong>
                    {p.numero_pedido ? ' · ' + p.numero_pedido : ''}
                    <span style={{ color: '#8b9dc3' }}>
                      {' · '}{(p.pedido_articulos || []).length} art.
                      {p.fecha_entrega ? ' · ' + formatFecha(p.fecha_entrega) : ''}
                    </span>
                  </button>
                )
              })}
            </div>
          )
        )}
      </div>

      {/* Barra fija: totales, chips por taller y acciones */}
      {items.length > 0 && (
        <div style={{ ...estiloPanelChico, position: 'sticky', top: '4rem', zIndex: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div style={{ color: '#c8d8ff', fontSize: '0.82rem' }}>
              <strong style={{ color: '#fff' }}>{items.length}</strong> artículos ·{' '}
              <strong style={{ color: '#fff' }}>{totalUnidades.toLocaleString('es-AR')}</strong> u
              {sinAsignar > 0 && <span style={{ color: '#fbbf24' }}> · {sinAsignar} sin taller</span>}
            </div>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {sugeridos.length > 0 && (
                <button onClick={autoasignar} disabled={autoasignando} style={{ ...estiloBotonMemoria, opacity: autoasignando ? 0.6 : 1 }}>
                  {autoasignando ? 'Asignando…' : '⟲ Autoasignar ' + sugeridos.length}
                </button>
              )}
              <button onClick={() => setAgruparRepetidos(v => !v)} style={agruparRepetidos ? estiloTabActivo : estiloTab}>
                {agruparRepetidos ? '✓ Sumar repetidos' : 'Sumar repetidos'}
              </button>
              <button onClick={() => setSoloPendientes(v => !v)} style={soloPendientes ? estiloTabActivo : estiloTab}>
                {soloPendientes ? '✓ Solo pendientes' : 'Solo pendientes'}
              </button>
              {temporadasCostos.length > 0 && (
                <select
                  value={temporadaCostosId}
                  onChange={e => setTemporadaCostosId(e.target.value)}
                  title="Temporada de costos que se usa para tela y precios"
                  style={{
                    backgroundColor: '#1a1f35', color: '#c8d8ff', border: '1px solid #2a3150',
                    borderRadius: '0.45rem', padding: '0.3rem 0.45rem', fontSize: '0.76rem',
                    fontWeight: 700, cursor: 'pointer'
                  }}
                >
                  {temporadasCostos.map(t => (
                    <option key={t.id} value={t.id}>{t.nombre}{t.activa ? ' ●' : ''}</option>
                  ))}
                </select>
              )}
              <button onClick={exportar} disabled={exportando} style={{ ...estiloBotonPrim, opacity: exportando ? 0.6 : 1 }}>
                {exportando ? 'Exportando…' : '📊 Sheets'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dos columnas: izquierda asigno, derecha veo cómo queda */}
      {items.length > 0 && (
        <div style={{ display: 'flex', gap: '0.7rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>

          {/* Columna izquierda: asignar */}
          <div style={{ flex: '1 1 22rem', minWidth: '18rem' }}>
            <div style={estiloPanelChico}>
              <div style={{ color: '#c8d8ff', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em', marginBottom: '0.5rem' }}>
                ARTÍCULOS {soloPendientes ? '(PENDIENTES)' : ''}
              </div>

              {itemsVisibles.length === 0 ? (
                <p style={{ color: '#4ade80', fontSize: '0.82rem', margin: 0 }}>
                  ✓ No queda nada por asignar.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                  {itemsVisibles.map(it => {
                    const sugerido = !it.taller ? historial[String(it.codigo)] : null
                    return (
                      <div key={it.codigo + '_' + it.ids[0]} style={estiloFilaCompacta}>
                        <span style={{ color: '#7b9fff', fontWeight: 800, minWidth: '3rem', fontSize: '0.85rem' }}>
                          {it.codigo}
                        </span>
                        <span style={{ color: '#e5e7eb', flex: 1, fontSize: '0.8rem', minWidth: '7rem', lineHeight: 1.2 }}>
                          {it.descripcion}
                          {it.repetido && (
                            <span style={{ color: '#8b9dc3', fontSize: '0.7rem', display: 'block' }}>
                              {it.ids.length} pedidos: {it.origenes.join(' + ')}
                            </span>
                          )}
                          {telasDeItem(it).map((tl, ix) => (
                            <span key={'tl' + ix} style={{ color: '#5eead4', fontSize: '0.7rem', display: 'block' }}>
                              🧵 {tl.tela}: {redondear(tl.total)} {tl.unidad} ({redondear(tl.porPrenda)} c/u)
                              {tl.precio > 0 ? ' · ' + plata(tl.costo) : ''}
                            </span>
                          ))}
                        </span>
                        <span style={{ color: '#fff', fontWeight: 800, fontSize: '0.85rem', minWidth: '4rem', textAlign: 'right' }}>
                          {it.unidades.toLocaleString('es-AR')} u
                        </span>
                        {sugerido && (
                          <button
                            onClick={() => asignarTaller(it.ids, sugerido, it.codigo)}
                            title="La última vez fue a este taller"
                            style={estiloSugerencia}
                          >
                            ⟲ {sugerido}
                          </button>
                        )}
                        <select
                          value={it.taller || ''}
                          onChange={e => asignarTaller(it.ids, e.target.value, it.codigo)}
                          disabled={guardando === it.ids[0]}
                          style={{
                            backgroundColor: it.taller ? '#1e3a8a' : (it.mixto ? '#3a2f10' : '#1a1f35'),
                            color: it.mixto ? '#fbbf24' : '#fff',
                            border: '1px solid ' + (it.taller ? '#3b5bdb' : (it.mixto ? '#a16207' : '#2a3150')),
                            borderRadius: '0.35rem',
                            padding: '0.25rem 0.4rem',
                            fontSize: '0.78rem',
                            cursor: 'pointer',
                            minWidth: '7rem'
                          }}
                        >
                          <option value="">{it.mixto ? 'Repartido' : 'Sin asignar'}</option>
                          {TALLERES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Columna derecha: cómo va quedando, en vivo */}
          <div style={{ flex: '1 1 18rem', minWidth: '16rem', position: 'sticky', top: '9rem' }}>
            <div style={estiloPanelChico}>
              <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                <button onClick={() => setPanelDerecho('talleres')} style={panelDerecho === 'talleres' ? estiloTabActivo : estiloTab}>
                  Cómo va quedando
                </button>
                {hayCostos && (
                  <button onClick={() => setPanelDerecho('tela')} style={panelDerecho === 'tela' ? estiloTabActivo : estiloTab}>
                    🧵 Tela por taller
                  </button>
                )}
              </div>

              {panelDerecho === 'tela' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', maxHeight: '70vh', overflowY: 'auto' }}>
                  {Object.keys(telaPorTaller).length === 0 ? (
                    <p style={{ color: '#8b9dc3', fontSize: '0.8rem', margin: 0 }}>
                      No hay datos de tela para estos artículos en la temporada elegida.
                    </p>
                  ) : nombresGrupo.filter(t => telaPorTaller[t]).map(t => {
                    const telas = Object.keys(telaPorTaller[t]).map(k => telaPorTaller[t][k])
                    const costoTotal = telas.reduce((s2, x) => s2 + x.costo, 0)
                    const esSin = t === 'Sin asignar'
                    return (
                      <div key={'tela_' + t} style={{
                        backgroundColor: esSin ? '#231d0c' : '#0d2b28',
                        border: '1px solid ' + (esSin ? '#a16207' : '#14746b'),
                        borderRadius: '0.5rem',
                        padding: '0.45rem 0.55rem'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem' }}>
                          <strong style={{ color: esSin ? '#fbbf24' : '#5eead4', fontSize: '0.85rem' }}>{t}</strong>
                          {costoTotal > 0 && (
                            <span style={{ color: '#c8d8ff', fontSize: '0.76rem', fontWeight: 700 }}>{plata(costoTotal)}</span>
                          )}
                        </div>
                        <div style={{ marginTop: '0.25rem', display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                          {telas.map((x, ix) => (
                            <div key={'tt' + ix} style={{ display: 'flex', gap: '0.4rem', fontSize: '0.74rem' }}>
                              <span style={{ color: '#c8d8ff', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {x.tela}
                              </span>
                              <span style={{ color: '#fff', fontWeight: 800 }}>
                                {redondear(x.total)} {x.unidad}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : nombresGrupo.length === 0 ? (
                <p style={{ color: '#8b9dc3', fontSize: '0.8rem', margin: 0 }}>Todavía no asignaste ningún taller.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', maxHeight: '70vh', overflowY: 'auto' }}>
                  {nombresGrupo.map(t => {
                    const lista = grupos[t]
                    const sub = lista.reduce((s, i) => s + (Number(i.unidades) || 0), 0)
                    const esSin = t === 'Sin asignar'
                    return (
                      <div key={t} style={{
                        backgroundColor: esSin ? '#231d0c' : '#151d3a',
                        border: '1px solid ' + (esSin ? '#a16207' : '#2f4a9e'),
                        borderRadius: '0.5rem',
                        padding: '0.45rem 0.55rem'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem' }}>
                          <strong style={{ color: esSin ? '#fbbf24' : '#fff', fontSize: '0.85rem' }}>{t}</strong>
                          <span style={{ color: '#c8d8ff', fontSize: '0.76rem', fontWeight: 700 }}>
                            {sub.toLocaleString('es-AR')} u · {lista.length} art.
                          </span>
                        </div>
                        <div style={{ marginTop: '0.25rem', display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                          {lista.map(i => (
                            <div key={'g_' + t + '_' + i.codigo} style={{ display: 'flex', gap: '0.4rem', fontSize: '0.74rem' }}>
                              <span style={{ color: '#7b9fff', fontWeight: 700, minWidth: '2.6rem' }}>{i.codigo}</span>
                              <span style={{ color: '#c8d8ff', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {i.descripcion}
                              </span>
                              <span style={{ color: '#e5e7eb', fontWeight: 700 }}>{i.unidades.toLocaleString('es-AR')}u</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {!cargando && seleccionados.length === 0 && (
        <p style={{ color: '#8b9dc3', fontSize: '0.85rem', textAlign: 'center', marginTop: '1.5rem' }}>
          Elegí al menos un pedido para ver los artículos.
        </p>
      )}
    </div>
  )
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const estiloPanelChico = {
  backgroundColor: '#13162b',
  border: '1px solid #2a3150',
  borderRadius: '0.65rem',
  padding: '0.6rem 0.7rem',
  marginBottom: '0.6rem'
}

const estiloFilaCompacta = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.45rem',
  flexWrap: 'wrap',
  backgroundColor: '#1a1f35',
  border: '1px solid #2a3150',
  borderRadius: '0.45rem',
  padding: '0.35rem 0.5rem'
}

const estiloBotonSec = {
  backgroundColor: '#1a1f35',
  color: '#c8d8ff',
  border: '1px solid #3b5bdb',
  borderRadius: '0.45rem',
  padding: '0.3rem 0.6rem',
  fontSize: '0.76rem',
  fontWeight: 600,
  cursor: 'pointer'
}

const estiloBotonPlano = {
  background: 'none',
  border: 'none',
  color: '#c8d8ff',
  fontSize: '0.76rem',
  fontWeight: 800,
  letterSpacing: '0.04em',
  cursor: 'pointer',
  padding: 0
}

const estiloBotonPrim = {
  backgroundColor: '#22c55e',
  color: '#04220f',
  border: 'none',
  borderRadius: '0.45rem',
  padding: '0.35rem 0.7rem',
  fontSize: '0.78rem',
  fontWeight: 800,
  cursor: 'pointer'
}

const estiloBotonMemoria = {
  backgroundColor: '#7c3aed',
  color: '#ffffff',
  border: 'none',
  borderRadius: '0.45rem',
  padding: '0.35rem 0.7rem',
  fontSize: '0.78rem',
  fontWeight: 800,
  cursor: 'pointer'
}

const estiloSugerencia = {
  backgroundColor: '#2a1f4d',
  color: '#c4b5fd',
  border: '1px dashed #7c3aed',
  borderRadius: '0.35rem',
  padding: '0.22rem 0.45rem',
  fontSize: '0.72rem',
  fontWeight: 700,
  cursor: 'pointer'
}

const estiloTab = {
  backgroundColor: '#1a1f35',
  color: '#8b9dc3',
  border: '1px solid #2a3150',
  borderRadius: '0.45rem',
  padding: '0.3rem 0.6rem',
  fontSize: '0.76rem',
  fontWeight: 700,
  cursor: 'pointer'
}

const estiloTabActivo = {
  ...estiloTab,
  backgroundColor: '#1e3a8a',
  color: '#fff',
  border: '1px solid #3b5bdb'
}

// ─── Auxiliares ───────────────────────────────────────────────────────────────

function plata(n) {
  const v = Math.round(Number(n) || 0)
  return '$' + v.toLocaleString('es-AR')
}

function redondear(n) {
  const v = Number(n) || 0
  const r = Math.round(v * 100) / 100
  return r.toLocaleString('es-AR')
}
