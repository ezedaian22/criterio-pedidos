import React from 'react'
import { useState, useEffect } from 'react'
import { getSession } from './lib/auth'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import NuevoPedido from './pages/NuevoPedido'
import DetallePedido from './pages/DetallePedido'
import Ajustes from './pages/Ajustes'
import DistribucionCortes from './pages/DistribucionCortes'
import HistorialClientes from './pages/HistorialClientes'

export default function App() {
  const [session, setSession] = useState(null)
  const [pagina, setPagina] = useState('dashboard')
  const [pedidoSeleccionado, setPedidoSeleccionado] = useState(null)
  const [archivoParaNuevo, setArchivoParaNuevo] = useState(null)

  useEffect(() => {
    setSession(getSession())
  }, [])

  if (!session) {
    return <Login onLogin={setSession} />
  }

  // Solo gerencia entra a Configuración
  const esGerencia = session.rol === 'gerencia'

  function cerrarSesion() {
    import('./lib/auth').then(m => m.logout())
    setSession(null)
  }

  function irA(pag, data = null) {
    if ((pag === 'ajustes' || pag === 'cortes' || pag === 'historial') && !esGerencia) return
    setPagina(pag)
    if (data) setPedidoSeleccionado(data)
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0f1117' }}>
      {/* Header */}
      <header style={{
        backgroundColor: '#13162b',
        borderBottom: '2px solid #3b5bdb',
        padding: '1rem 1.5rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 50,
        boxShadow: '0 4px 24px rgba(59,91,219,0.25)'
      }}>
        {/* Logo */}
        <button
          onClick={() => irA('dashboard')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0
          }}
        >
          <span style={{
            fontFamily: "'Archivo Black', sans-serif",
            fontSize: '1.3rem',
            color: '#ffffff',
            letterSpacing: '-0.02em',
            textShadow: '0 0 20px rgba(255,255,255,0.3)'
          }}>CRITERIO</span>
          <span style={{
            fontFamily: "'Archivo Black', sans-serif",
            fontSize: '1.3rem',
            color: '#7b9fff',
            letterSpacing: '-0.02em',
            textShadow: '0 0 20px rgba(123,159,255,0.5)'
          }}>PEDIDOS</span>
        </button>

        {/* Solapas — solo gerencia */}
        {esGerencia && (
          <nav style={{ display: 'flex', gap: '0.4rem', marginLeft: '0.75rem', flex: 1 }}>
            <button
              onClick={() => irA('cortes')}
              style={{
                backgroundColor: pagina === 'cortes' ? '#1e3a8a' : 'transparent',
                color: pagina === 'cortes' ? '#ffffff' : '#7b9fff',
                border: '1px solid #3b5bdb',
                borderRadius: '0.5rem',
                padding: '0.3rem 0.7rem',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
                letterSpacing: '0.03em'
              }}
            >
              CORTES
            </button>
            <button
              onClick={() => irA('historial')}
              style={{
                backgroundColor: pagina === 'historial' ? '#1e3a8a' : 'transparent',
                color: pagina === 'historial' ? '#ffffff' : '#7b9fff',
                border: '1px solid #3b5bdb',
                borderRadius: '0.5rem',
                padding: '0.3rem 0.7rem',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
                letterSpacing: '0.03em'
              }}
            >
              HISTORIAL
            </button>
          </nav>
        )}

        {/* Usuario */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{
            backgroundColor: '#1e2547',
            border: '1px solid #3b5bdb',
            borderRadius: '2rem',
            padding: '0.3rem 0.9rem',
            color: '#c8d8ff',
            fontSize: '0.85rem',
            fontWeight: 600,
            letterSpacing: '0.02em'
          }}>
            {session.nombre.toUpperCase()}
          </div>
          {esGerencia ? (
            <button
              onClick={() => irA('ajustes')}
              style={{
                color: '#7b9fff',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '1.2rem',
                lineHeight: 1
              }}
            >
              ⚙
            </button>
          ) : (
            <button
              onClick={cerrarSesion}
              style={{
                color: '#7b9fff',
                background: 'none',
                border: '1px solid #3b5bdb',
                borderRadius: '0.5rem',
                padding: '0.25rem 0.6rem',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontWeight: 600,
                lineHeight: 1.4
              }}
            >
              Salir
            </button>
          )}
        </div>
      </header>

      {/* Contenido */}
      <main style={{ maxWidth: '64rem', margin: '0 auto', padding: '1.5rem 1rem' }}>
        {pagina === 'dashboard' && (
          <Dashboard
            session={session}
            onNuevoPedido={(archivo) => {
              setArchivoParaNuevo(archivo || null)
              setPagina('nuevo')
            }}
            onVerPedido={(p) => irA('detalle', p)}
          />
        )}
        {pagina === 'nuevo' && (
          <NuevoPedido
            session={session}
            archivoInicial={archivoParaNuevo}
            onVolver={() => { setArchivoParaNuevo(null); irA('dashboard') }}
            onGuardado={() => { setArchivoParaNuevo(null); irA('dashboard') }}
          />
        )}
        {pagina === 'detalle' && (
          <DetallePedido
            session={session}
            pedido={pedidoSeleccionado}
            onVolver={() => irA('dashboard')}
          />
        )}
        {pagina === 'cortes' && esGerencia && (
          <DistribucionCortes
            session={session}
            onVolver={() => irA('dashboard')}
          />
        )}
        {pagina === 'historial' && esGerencia && (
          <HistorialClientes
            session={session}
            onVolver={() => irA('dashboard')}
          />
        )}
        {pagina === 'ajustes' && esGerencia && (
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
