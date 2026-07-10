import React from 'react'
import { useState, useEffect } from 'react'
import { getSession } from './lib/auth'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import NuevoPedido from './pages/NuevoPedido'
import DetallePedido from './pages/DetallePedido'
import Ajustes from './pages/Ajustes'

const headerStyle = {
  background: 'linear-gradient(135deg, #1a1d27 0%, #1e2236 100%)',
  borderBottom: '2px solid #3b5bdb',
  padding: '0.875rem 1.25rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  position: 'sticky',
  top: 0,
  zIndex: 50,
  boxShadow: '0 2px 20px rgba(59,91,219,0.2)'
}

export default function App() {
  const [session, setSession] = useState(null)
  const [pagina, setPagina] = useState('dashboard')
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
    <div style={{ minHeight: '100vh', backgroundColor: '#0f1117' }}>
      {/* Header */}
      <header style={headerStyle}>
        <button
          onClick={() => irA('dashboard')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          <span style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: '1.25rem', color: 'white', letterSpacing: '-0.025em' }}>CRITERIO</span>
          <span style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: '1.25rem', color: '#6b8fff', letterSpacing: '-0.025em' }}>PEDIDOS</span>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ color: '#c8d0e0', fontSize: '0.875rem', fontWeight: 600 }}>{session.nombre}</span>
          <button
            onClick={() => irA('ajustes')}
            style={{ color: '#c8d0e0', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem' }}
          >
            ⚙
          </button>
        </div>
      </header>

      {/* Contenido */}
      <main style={{ maxWidth: '64rem', margin: '0 auto', padding: '1.5rem 1rem' }}>
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
