import { useState, useEffect, useRef } from 'react'
import { supabase, supabaseCostos } from '../lib/supabase'
import { parsearArchivoPedido } from '../lib/parsearPedido'

const PASOS = ['archivo', 'revisar', 'guardando']

export default function NuevoPedido({ session, onVolver, onGuardado }) {
  const [paso, setPaso] = useState('archivo')
  const [clientes, setClientes] = useState([])
  const [clienteId, setClienteId] = useState('')
  const [archivo, setArchivo] = useState(null)
  const [parseado, setParseado] = useState(null)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)
  const inputRef = useRef()

  useEffect(() => {
    supabase.from('clientes').select('*').then(({ data }) => setClientes(data || []))
  }, [])

  const clienteSeleccionado = clientes.find(c => String(c.id) === String(clienteId))

  async function handleParsear() {
    if (!archivo || !clienteId) return
    setError('')
    setCargando(true)
    try {
      const resultado = await parsearArchivoPedido(archivo, clienteSeleccionado?.nombre || '')
      // Enriquecer con datos de costos (descripción y foto)
      const enriquecido = await enriquecerConCostos(resultado)
      setParseado(enriquecido)
      setPaso('revisar')
    } catch (err) {
      setError(err.message)
    } finally {
      setCargando(false)
    }
  }

  async function enriquecerConCostos(pedidoIA) {
    const codigos = pedidoIA.articulos.map(a => a.codigo_nuestro).filter(Boolean)
    if (codigos.length === 0) return pedidoIA

    try {
      const { data } = await supabaseCostos
        .from('articulos')
        .select('codigo, descripcion, foto_url')
        .in('codigo', codigos)

      const mapaArts = {}
      if (data) data.forEach(a => { mapaArts[a.codigo] = a })

      return {
        ...pedidoIA,
        articulos: pedidoIA.articulos.map(a => ({
          ...a,
          descripcion_correcta: mapaArts[a.codigo_nuestro]?.descripcion || null,
          foto_url: mapaArts[a.codigo_nuestro]?.foto_url || null,
        }))
      }
    } catch {
      return pedidoIA
    }
  }

  async function handleGuardar() {
    if (!parseado) return
    setCargando(true)
    setError('')
    try {
      // 1. Crear pedido
      const { data: pedidoDB, error: errPedido } = await supabase
        .from('pedidos')
        .insert({
          cliente_id: parseInt(clienteId),
          numero_pedido: parseado.numero_pedido,
          fecha_pedido: parseado.fecha_pedido,
          fecha_entrega: parseado.fecha_entrega,
          estado: 'activo',
        })
        .select()
        .single()

      if (errPedido) throw errPedido

      // 2. Crear artículos y sus sucursales/variantes/módulos
      for (const art of parseado.articulos) {
        const { data: artDB, error: errArt } = await supabase
          .from('pedido_articulos')
          .insert({
            pedido_id: pedidoDB.id,
            codigo_nuestro: art.codigo_nuestro,
            codigo_cliente: art.codigo_cliente,
            descripcion_cliente: art.descripcion_cliente,
            descripcion_correcta: art.descripcion_correcta,
            foto_url: art.foto_url,
            precio_unitario: art.precio_unitario,
            total_unidades: art.total_unidades,
            estado: 'pendiente',
          })
          .select()
          .single()

        if (errArt) throw errArt

        // Sucursales
        if (art.sucursales?.length) {
          const sucData = art.sucursales.map(s => ({
            pedido_articulo_id: artDB.id,
            nro_sucursal: s.nro_sucursal,
            cantidad: s.cantidad,
            estado: 'pendiente',
            es_entrega_final: s.nro_sucursal === '0',
          }))
          const { error: errSuc } = await supabase.from('pedido_sucursales').insert(sucData)
          if (errSuc) throw errSuc
        }

        // Variantes
        if (art.variantes?.length) {
          const varData = art.variantes.map(v => ({
            pedido_articulo_id: artDB.id,
            nombre: v.nombre,
            cantidad: v.cantidad_total,
          }))
          const { error: errVar } = await supabase.from('pedido_articulo_variantes').insert(varData)
          if (errVar) throw errVar
        }

        // Módulos
        if (art.modulos?.length) {
          const modData = art.modulos.map(m => ({
            pedido_articulo_id: artDB.id,
            descripcion: m.descripcion,
            unidades_por_caja: m.unidades_por_caja,
            curva_talles: m.curva_talles,
          }))
          const { error: errMod } = await supabase.from('pedido_modulos').insert(modData)
          if (errMod) throw errMod
        }
      }

      onGuardado()
    } catch (err) {
      setError(err.message || 'Error al guardar')
      setCargando(false)
    }
  }

  // ── PASO 1: SUBIR ARCHIVO ──
  if (paso === 'archivo') {
    return (
      <div className="space-y-6 max-w-lg mx-auto">
        <div className="flex items-center gap-3">
          <button onClick={onVolver} className="text-muted hover:text-white">← Volver</button>
          <h1 className="text-xl font-bold">Nuevo pedido</h1>
        </div>

        <div className="card space-y-5">
          {/* Cliente */}
          <div>
            <label className="text-sm text-muted block mb-1">Cliente</label>
            <select
              className="input"
              value={clienteId}
              onChange={e => setClienteId(e.target.value)}
            >
              <option value="">Seleccioná un cliente...</option>
              {clientes.map(c => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          </div>

          {/* Archivo */}
          <div>
            <label className="text-sm text-muted block mb-1">Archivo del pedido</label>
            <div
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                archivo ? 'border-brand-500 bg-brand-500/5' : 'border-border hover:border-brand-500/50'
              }`}
              onClick={() => inputRef.current?.click()}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,.xls,.xlsx"
                className="hidden"
                onChange={e => setArchivo(e.target.files[0] || null)}
              />
              {archivo ? (
                <div>
                  <div className="text-2xl mb-2">📄</div>
                  <div className="font-medium text-white">{archivo.name}</div>
                  <div className="text-xs text-muted mt-1">{(archivo.size / 1024).toFixed(0)} KB</div>
                  <button
                    className="text-xs text-muted hover:text-red-400 mt-2"
                    onClick={e => { e.stopPropagation(); setArchivo(null) }}
                  >
                    Quitar archivo
                  </button>
                </div>
              ) : (
                <div>
                  <div className="text-3xl mb-2">📤</div>
                  <div className="text-muted">Subí el PDF o Excel del pedido</div>
                  <div className="text-xs text-muted mt-1">.pdf, .xls, .xlsx</div>
                </div>
              )}
            </div>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            className="btn-primary w-full"
            disabled={!archivo || !clienteId || cargando}
            onClick={handleParsear}
          >
            {cargando ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                Interpretando pedido...
              </span>
            ) : 'Interpretar con IA →'}
          </button>
        </div>
      </div>
    )
  }

  // ── PASO 2: REVISAR Y EDITAR ──
  if (paso === 'revisar' && parseado) {
    return (
      <RevisarPedido
        parseado={parseado}
        clienteNombre={clienteSeleccionado?.nombre}
        onEditar={setParseado}
        onVolver={() => setPaso('archivo')}
        onConfirmar={handleGuardar}
        cargando={cargando}
        error={error}
      />
    )
  }

  return null
}

function RevisarPedido({ parseado, clienteNombre, onEditar, onVolver, onConfirmar, cargando, error }) {
  function editarFechaEntrega(val) {
    onEditar({ ...parseado, fecha_entrega: val })
  }

  function editarDescripcion(idx, val) {
    const arts = [...parseado.articulos]
    arts[idx] = { ...arts[idx], descripcion_correcta: val }
    onEditar({ ...parseado, articulos: arts })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={onVolver} className="text-muted hover:text-white">← Volver</button>
        <h1 className="text-xl font-bold">Revisá el pedido</h1>
      </div>

      {/* Info general */}
      <div className="card space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-muted text-sm">Cliente:</span>
          <span className="font-semibold">{clienteNombre}</span>
        </div>
        {parseado.numero_pedido && (
          <div className="flex items-center gap-2">
            <span className="text-muted text-sm">Pedido:</span>
            <span className="font-semibold">#{parseado.numero_pedido}</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-muted text-sm">Fecha de entrega:</span>
          <input
            type="date"
            className="input w-auto"
            value={parseado.fecha_entrega || ''}
            onChange={e => editarFechaEntrega(e.target.value)}
          />
        </div>
      </div>

      {/* Artículos */}
      <div className="space-y-3">
        <h2 className="font-semibold text-muted text-sm uppercase tracking-wide">
          {parseado.articulos.length} artículos
        </h2>

        {parseado.articulos.map((art, idx) => (
          <div key={idx} className="card space-y-3">
            <div className="flex gap-3">
              {/* Foto */}
              {art.foto_url && (
                <img src={art.foto_url} alt="" className="w-16 h-16 object-cover rounded-lg shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="num font-bold text-brand-500">{art.codigo_nuestro}</span>
                  {art.codigo_cliente && (
                    <span className="text-xs text-muted">({art.codigo_cliente})</span>
                  )}
                  <span className="num font-bold text-white">{art.total_unidades} u</span>
                </div>
                <div className="text-xs text-muted mt-0.5">{art.descripcion_cliente}</div>
                {/* Descripción correcta editable */}
                <input
                  className="input text-sm mt-1"
                  placeholder="Descripción correcta (editable)"
                  value={art.descripcion_correcta || ''}
                  onChange={e => editarDescripcion(idx, e.target.value)}
                />
              </div>
            </div>

            {/* Variantes */}
            {art.variantes?.length > 0 && (
              <div>
                <p className="text-xs text-muted mb-1">Variantes:</p>
                <div className="flex flex-wrap gap-2">
                  {art.variantes.map((v, vi) => (
                    <span key={vi} className="text-xs bg-surface border border-border px-2 py-1 rounded-lg">
                      {v.nombre} — <span className="num font-bold">{v.cantidad_total} u</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Sucursales resumen */}
            {art.sucursales?.length > 0 && (
              <div>
                <p className="text-xs text-muted mb-1">{art.sucursales.length} sucursales</p>
                <div className="flex flex-wrap gap-1">
                  {art.sucursales.map((s, si) => (
                    <span key={si} className={`text-xs px-2 py-0.5 rounded font-mono ${s.nro_sucursal === '0' ? 'bg-purple-900 text-purple-300' : 'bg-surface border border-border text-muted'}`}>
                      S{s.nro_sucursal}: {s.cantidad}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Módulos */}
            {art.modulos?.length > 0 && (
              <div className="bg-surface rounded-lg p-2 text-xs text-muted">
                <p className="font-semibold text-white mb-1">Módulos:</p>
                {art.modulos.map((m, mi) => (
                  <div key={mi}>{m.descripcion} — {m.unidades_por_caja} u/caja</div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <button
        className="btn-primary w-full"
        onClick={onConfirmar}
        disabled={cargando}
      >
        {cargando ? 'Guardando...' : '✓ Confirmar y guardar pedido'}
      </button>
    </div>
  )
}
