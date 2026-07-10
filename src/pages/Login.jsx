import React from 'react'
import { useState } from 'react'
import { login } from '../lib/auth'

export default function Login({ onLogin }) {
  const [usuario, setUsuario] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)

  function handleLogin() {
    setError('')
    setCargando(true)
    const result = login(usuario.trim(), password)
    setCargando(false)
    if (result.ok) {
      onLogin(result.session)
    } else {
      setError(result.error)
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter') handleLogin()
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="font-display text-3xl text-white tracking-tight">CRITERIO</div>
          <div className="font-display text-3xl text-brand-500 tracking-tight">PEDIDOS</div>
          <p className="text-muted text-sm mt-2">Gestión de pedidos sucursaleros</p>
        </div>

        <div className="card space-y-4">
          <div>
            <label className="text-sm text-muted block mb-1">Usuario</label>
            <input
              className="input"
              placeholder="deposito / gerencia"
              value={usuario}
              onChange={e => setUsuario(e.target.value)}
              onKeyDown={handleKey}
              autoCapitalize="none"
            />
          </div>
          <div>
            <label className="text-sm text-muted block mb-1">Contraseña</label>
            <input
              className="input"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={handleKey}
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm">{error}</p>
          )}

          <button
            className="btn-primary w-full"
            onClick={handleLogin}
            disabled={cargando || !usuario || !password}
          >
            {cargando ? 'Entrando...' : 'Ingresar'}
          </button>
        </div>
      </div>
    </div>
  )
}
