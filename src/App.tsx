import { useState, useEffect } from 'react'
import { getSession } from './lib/auth'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import NuevoPedido from './pages/NuevoPedido'
import DetallePedido from './pages/DetallePedido'
import Ajustes from './pages/Ajustes'

export default function App() {
  const [session, setSession] = useState(null)
  const [pagina, setPagina] = useState('dashboard') // dashboard | nuevo | detalle | ajustes
  const [pedidoSeleccionado, setPedidoSeleccionado] = useState(null)

  useEffect(() => {
    setSession(getSession())
  }, [])

  if (!session) {
    return <Login onLogin={setSession} />
  }

  function irA(pag, data = null) {
    setPagina(pag)
    if (data) setPedidoSeleccionado(data)
  }

  return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
      <header className="border-b border-border bg-card px-4 py-3 flex items-center justify-between sticky top-0 z-50">
        <button onClick={() => irA('dashboard')} className="flex items-center gap-2">
          <span className="font-display text-lg text-white tracking-tight">CRITERIO</span>
          <span className="text-brand-500 font-display text-lg">PEDIDOS</span>
        </button>
        <div className="flex items-center gap-3">
          <span className="text-muted text-sm">{session.nombre}</span>
          <button onClick={() => irA('ajustes')} className="text-muted hover:text-white transition-colors text-sm">
            ⚙
          </button>
        </div>
      </header>

      {/* Contenido */}
      <main className="max-w-5xl mx-auto px-4 py-6">
        {pagina === 'dashboard' && (
          <Dashboard
            session={session}
            onNuevoPedido={() => irA('nuevo')}
            onVerPedido={(p) => irA('detalle', p)}
          />
        )}
        {pagina === 'nuevo' && (
          <NuevoPedido
            session={session}
            onVolver={() => irA('dashboard')}
            onGuardado={() => irA('dashboard')}
          />
        )}
        {pagina === 'detalle' && (
          <DetallePedido
            session={session}
            pedido={pedidoSeleccionado}
            onVolver={() => irA('dashboard')}
          />
        )}
        {pagina === 'ajustes' && (
          <Ajustes
            session={session}
            onVolver={() => irA('dashboard')}
            onLogout={() => { import('./lib/auth').then(m => m.logout()); setSession(null) }}
          />
        )}
      </main>
    </div>
  )
}
