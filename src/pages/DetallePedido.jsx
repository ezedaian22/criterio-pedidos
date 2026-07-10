import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { formatFecha, alertaFecha, pct } from '../lib/utils'

export default function DetallePedido({ session, pedido, onVolver }) {
  const [articulos, setArticulos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [artSeleccionado, setArtSeleccionado] = useState(null)

  useEffect(() => {
    cargarArticulos()
  }, [pedido.id])

  async function cargarArticulos() {
    setCargando(true)
    try {
      const { data, error } = await supabase
        .from('pedido_articulos')
        .select(`
          *,
          pedido_sucursales(*),
          pedido_articulo_variantes(*),
          pedido_modulos(*)
        `)
        .eq('pedido_id', pedido.id)
        .order('id')

      if (error) throw error
      setArticulos(data || [])
    } catch (err) {
      console.error(err)
    } finally {
      setCargando(false)
    }
  }

  const alerta = alertaFecha(pedido.fecha_entrega)
  const finalizados = articulos.filter(a => a.estado === 'finalizado').length
  const progreso = pct(finalizados, articulos.length)

  if (artSeleccionado) {
    return (
      <ArmarArticulo
        articulo={artSeleccionado}
        pedido={pedido}
        onVolver={() => { setArtSeleccionado(null); cargarArticulos() }}
        onActualizar={cargarArticulos}
      />
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onVolver} className="text-muted hover:text-white">← Volver</button>
        <div>
          <h1 className="text-xl font-bold">{pedido.clientes?.nombre || 'Pedido'}</h1>
          {pedido.numero_pedido && <p className="text-muted text-sm">#{pedido.numero_pedido}</p>}
        </div>
      </div>

      {/* Info pedido */}
      <div className={`card ${alerta === 'vencido' ? 'alerta-vencido' : alerta === 'proximo' ? 'alerta-proximo' : ''}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted">Fecha de entrega</p>
            <p className={`font-bold text-lg num ${alerta === 'vencido' ? 'text-red-400' : alerta === 'proximo' ? 'text-yellow-400' : 'text-white'}`}>
              {formatFecha(pedido.fecha_entrega)}
              {alerta === 'vencido' && ' 🔴'}
              {alerta === 'proximo' && ' 🟡'}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-muted">Progreso</p>
            <p className="num font-bold text-lg">{finalizados}/{articulos.length} arts</p>
          </div>
        </div>
        {articulos.length > 0 && (
          <div className="mt-3">
            <div className="h-2 bg-surface rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${progreso === 100 ? 'bg-green-500' : 'bg-brand-500'}`}
                style={{ width: `${progreso}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Lista artículos */}
      {cargando ? (
        <div className="text-center text-muted py-8">Cargando...</div>
      ) : (
        <div className="space-y-2">
          <h2 className="text-sm text-muted uppercase tracking-wide font-semibold">Artículos</h2>
          {articulos.map(art => (
            <TarjetaArticulo
              key={art.id}
              art={art}
              onClick={() => setArtSeleccionado(art)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TarjetaArticulo({ art, onClick }) {
  const sucursales = art.pedido_sucursales || []
  const finalizadas = sucursales.filter(s => s.estado === 'finalizado').length
  const progreso = pct(finalizadas, sucursales.length)

  const badgeClass = {
    pendiente: 'badge-pendiente',
    en_proceso: 'badge-separado',
    finalizado: 'badge-finalizado',
  }[art.estado] || 'badge-pendiente'

  const estadoLabel = {
    pendiente: 'Pendiente',
    en_proceso: 'En proceso',
    finalizado: 'Finalizado',
  }[art.estado] || art.estado

  return (
    <div
      className="card cursor-pointer hover:border-brand-500 transition-colors flex gap-3"
      onClick={onClick}
    >
      {art.foto_url && (
        <img src={art.foto_url} alt="" className="w-14 h-14 object-cover rounded-lg shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="num font-bold text-brand-500">{art.codigo_nuestro}</span>
              <span className={badgeClass}>{estadoLabel}</span>
            </div>
            <p className="text-sm text-white mt-0.5 truncate">
              {art.descripcion_correcta || art.descripcion_cliente}
            </p>
            <p className="text-xs text-muted">{art.total_unidades} u totales · {sucursales.length} sucursales</p>
          </div>
          <div className="text-right shrink-0">
            <div className="num font-bold">{finalizadas}/{sucursales.length}</div>
            <div className="text-xs text-muted">suc. listas</div>
          </div>
        </div>
        {sucursales.length > 0 && (
          <div className="mt-2 h-1 bg-surface rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${progreso === 100 ? 'bg-green-500' : 'bg-brand-500'}`}
              style={{ width: `${progreso}%` }}
            />
          </div>
        )}
        {art.estado === 'finalizado' && art.fecha_finalizacion && (
          <p className="text-xs text-green-400 mt-1">Finalizado {formatFecha(art.fecha_finalizacion)}</p>
        )}
      </div>
    </div>
  )
}

// ── ARMADO DEL ARTÍCULO ──
function ArmarArticulo({ articulo, pedido, onVolver, onActualizar }) {
  const [sucursales, setSucursales] = useState(articulo.pedido_sucursales || [])
  const [guardando, setGuardando] = useState(null) // id de suc que se está guardando
  const [mostrarModulos, setMostrarModulos] = useState(false)
  const modulos = articulo.pedido_modulos || []
  const variantes = articulo.pedido_articulo_variantes || []

  // Sucursales: normales y la 0 (entrega final)
  const sucsNormales = sucursales.filter(s => !s.es_entrega_final).sort((a, b) => Number(a.nro_sucursal) - Number(b.nro_sucursal))
  const suc0 = sucursales.find(s => s.es_entrega_final)

  async function avanzarEstado(suc) {
    const siguiente = {
      pendiente: 'separado',
      separado: 'guardado',
      guardado: 'guardado', // queda en guardado hasta poner cajas
    }[suc.estado] || suc.estado

    setGuardando(suc.id)
    try {
      const update = { estado: siguiente }
      const { error } = await supabase
        .from('pedido_sucursales')
        .update(update)
        .eq('id', suc.id)

      if (error) throw error

      setSucursales(prev => prev.map(s => s.id === suc.id ? { ...s, ...update } : s))
    } catch (err) {
      console.error(err)
    } finally {
      setGuardando(null)
    }
  }

  async function guardarCajas(suc, nroCajas) {
    if (!nroCajas || isNaN(nroCajas)) return
    setGuardando(suc.id)
    try {
      const update = { nro_cajas: parseInt(nroCajas), estado: 'finalizado', fecha_finalizacion: new Date().toISOString().split('T')[0] }
      const { error } = await supabase
        .from('pedido_sucursales')
        .update(update)
        .eq('id', suc.id)

      if (error) throw error
      setSucursales(prev => prev.map(s => s.id === suc.id ? { ...s, ...update } : s))

      // Ver si todas las suc normales finalizaron → marcar artículo como finalizado
      const todasListas = sucursales
        .filter(s => !s.es_entrega_final)
        .every(s => s.id === suc.id ? true : s.estado === 'finalizado')

      if (todasListas) {
        await finalizarArticulo()
      }
    } catch (err) {
      console.error(err)
    } finally {
      setGuardando(null)
    }
  }

  async function finalizarArticulo() {
    await supabase
      .from('pedido_articulos')
      .update({ estado: 'finalizado', fecha_finalizacion: new Date().toISOString().split('T')[0] })
      .eq('id', articulo.id)
    onActualizar()
  }

  async function finalizarSuc0(nroCajas) {
    if (!suc0) return
    setGuardando(suc0.id)
    try {
      const update = {
        estado: 'finalizado',
        nro_cajas: parseInt(nroCajas) || 0,
        fecha_finalizacion: new Date().toISOString().split('T')[0]
      }
      await supabase.from('pedido_sucursales').update(update).eq('id', suc0.id)
      setSucursales(prev => prev.map(s => s.id === suc0.id ? { ...s, ...update } : s))
    } catch (err) {
      console.error(err)
    } finally {
      setGuardando(null)
    }
  }

  const finalizadasNormales = sucsNormales.filter(s => s.estado === 'finalizado').length
  const todasNormalesOk = finalizadasNormales === sucsNormales.length && sucsNormales.length > 0

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onVolver} className="text-muted hover:text-white">← Volver</button>
        <div>
          <div className="flex items-center gap-2">
            <span className="num font-bold text-brand-500 text-lg">{articulo.codigo_nuestro}</span>
            {articulo.codigo_cliente && <span className="text-muted text-sm">({articulo.codigo_cliente})</span>}
          </div>
          <p className="text-sm text-white">{articulo.descripcion_correcta || articulo.descripcion_cliente}</p>
        </div>
      </div>

      {/* Info artículo */}
      <div className="card">
        <div className="flex gap-3">
          {articulo.foto_url && (
            <img src={articulo.foto_url} alt="" className="w-20 h-20 object-cover rounded-lg shrink-0" />
          )}
          <div>
            <p className="text-muted text-sm">{articulo.total_unidades} unidades totales</p>
            <p className="text-muted text-sm">{sucsNormales.length} sucursales{suc0 ? ' + suc. 0 (entrega final)' : ''}</p>
            <p className="text-sm mt-1">
              <span className="num font-bold text-white">{finalizadasNormales}</span>
              <span className="text-muted">/{sucsNormales.length} sucursales listas</span>
            </p>
          </div>
        </div>

        {/* Variantes */}
        {variantes.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-xs text-muted mb-2 font-semibold">VARIANTES (colores/estampados)</p>
            <div className="flex flex-wrap gap-2">
              {variantes.map(v => (
                <div key={v.id} className="bg-surface border border-border rounded-lg px-3 py-2 text-sm">
                  <p className="font-medium">{v.nombre}</p>
                  <p className="text-muted text-xs num">{v.cantidad} u</p>
                  {v.imagen_url && <img src={v.imagen_url} alt="" className="w-12 h-12 object-cover rounded mt-1" />}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Módulos */}
        {modulos.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border">
            <button
              className="text-xs text-brand-500 font-semibold"
              onClick={() => setMostrarModulos(!mostrarModulos)}
            >
              {mostrarModulos ? '▲ Ocultar módulos' : '▼ Ver módulos de armado'}
            </button>
            {mostrarModulos && (
              <div className="mt-2 space-y-2">
                {modulos.map(m => (
                  <div key={m.id} className="bg-surface rounded-lg p-2 text-xs">
                    <p className="font-semibold text-white">{m.descripcion}</p>
                    <p className="text-muted">{m.unidades_por_caja} u/caja</p>
                    {m.curva_talles && (
                      <div className="flex gap-2 mt-1">
                        {Object.entries(m.curva_talles).map(([t, c]) => (
                          <span key={t} className="bg-card px-2 py-0.5 rounded">T{t}: {c}u</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sucursales normales */}
      <div className="space-y-2">
        <h2 className="text-sm text-muted uppercase tracking-wide font-semibold">Sucursales</h2>
        {sucsNormales.map(suc => (
          <FilaSucursal
            key={suc.id}
            suc={suc}
            onAvanzar={() => avanzarEstado(suc)}
            onGuardarCajas={(n) => guardarCajas(suc, n)}
            cargando={guardando === suc.id}
          />
        ))}
      </div>

      {/* Sucursal 0 — entrega final */}
      {suc0 && (
        <div className="space-y-2">
          <h2 className="text-sm text-purple-400 uppercase tracking-wide font-semibold">Sucursal 0 — Entrega final</h2>
          <FilaSucursal
            key={suc0.id}
            suc={suc0}
            especial
            bloqueada={!todasNormalesOk}
            onAvanzar={() => avanzarEstado(suc0)}
            onGuardarCajas={(n) => finalizarSuc0(n)}
            cargando={guardando === suc0.id}
          />
          {!todasNormalesOk && (
            <p className="text-xs text-purple-400 pl-1">Se habilita cuando todas las sucursales estén listas.</p>
          )}
        </div>
      )}
    </div>
  )
}

function FilaSucursal({ suc, onAvanzar, onGuardarCajas, cargando, especial, bloqueada }) {
  const [cajasInput, setCajasInput] = useState(suc.nro_cajas ? String(suc.nro_cajas) : '')
  const [editandoCajas, setEditandoCajas] = useState(false)

  const estadoConfig = {
    pendiente: { label: 'Pendiente', color: 'text-gray-400', btn: 'Separado ✓', btnClass: 'bg-blue-800 hover:bg-blue-700 text-white' },
    separado:  { label: 'Separado',  color: 'text-blue-400', btn: 'Guardado ✓', btnClass: 'bg-yellow-800 hover:bg-yellow-700 text-white' },
    guardado:  { label: 'Guardado',  color: 'text-yellow-400', btn: null, btnClass: '' },
    finalizado:{ label: 'Finalizado',color: 'text-green-400', btn: null, btnClass: '' },
  }[suc.estado] || {}

  const mostrarCajas = suc.estado === 'guardado' || (suc.estado === 'finalizado' && suc.nro_cajas)

  function handleCajas() {
    if (!cajasInput || isNaN(cajasInput)) return
    onGuardarCajas(cajasInput)
    setEditandoCajas(false)
  }

  return (
    <div className={`card flex items-center gap-3 ${especial ? 'border-purple-700' : ''} ${bloqueada ? 'opacity-40 pointer-events-none' : ''}`}>
      {/* Número sucursal */}
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm shrink-0 num ${especial ? 'bg-purple-900 text-purple-300' : 'bg-surface text-white'}`}>
        {suc.nro_sucursal}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold ${estadoConfig.color}`}>{estadoConfig.label}</span>
          <span className="num text-white text-sm font-bold">{suc.cantidad} u</span>
        </div>
        {suc.estado === 'finalizado' && suc.nro_cajas && (
          <p className="text-xs text-muted">{suc.nro_cajas} caja{suc.nro_cajas > 1 ? 's' : ''} · {formatFecha(suc.fecha_finalizacion)}</p>
        )}
      </div>

      {/* Acciones */}
      <div className="shrink-0 flex items-center gap-2">
        {/* Cajas (cuando está guardado) */}
        {suc.estado === 'guardado' && (
          <div className="flex items-center gap-1">
            <input
              type="number"
              min="1"
              placeholder="Cajas"
              className="input w-20 text-sm text-center"
              value={cajasInput}
              onChange={e => setCajasInput(e.target.value)}
            />
            <button
              className="btn-primary text-xs px-3 py-2"
              onClick={handleCajas}
              disabled={!cajasInput || cargando}
            >
              {cargando ? '...' : '✓'}
            </button>
          </div>
        )}

        {/* Botón avanzar estado */}
        {estadoConfig.btn && (
          <button
            className={`text-xs font-semibold px-3 py-2 rounded-lg transition-colors ${estadoConfig.btnClass}`}
            onClick={onAvanzar}
            disabled={cargando}
          >
            {cargando ? '...' : estadoConfig.btn}
          </button>
        )}

        {/* Finalizado */}
        {suc.estado === 'finalizado' && (
          <span className="text-green-400 text-lg">✓</span>
        )}
      </div>
    </div>
  )
}
