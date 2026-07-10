import React from 'react'
import { useState } from 'react'

export default function Ajustes({ session, onVolver, onLogout }) {
  const [apiKey, setApiKey] = useState(localStorage.getItem('criterio_gemini_key') || '')
  const [guardado, setGuardado] = useState(false)

  function guardarKey() {
    localStorage.setItem('criterio_gemini_key', apiKey.trim())
    setGuardado(true)
    setTimeout(() => setGuardado(false), 2000)
  }

  return (
    <div className="space-y-6 max-w-lg mx-auto">
      <div className="flex items-center gap-3">
        <button onClick={onVolver} className="text-muted hover:text-white">← Volver</button>
        <h1 className="text-xl font-bold">Ajustes</h1>
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold">API Key de Gemini</h2>
        <p className="text-sm text-muted">Necesaria para interpretar los archivos de pedidos con IA.</p>
        <input
          type="password"
          className="input font-mono text-sm"
          placeholder="AQ.Ab8RN6..."
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
        />
        <button className="btn-primary text-sm" onClick={guardarKey} disabled={!apiKey}>
          {guardado ? '✓ Guardado' : 'Guardar API Key'}
        </button>
      </div>

      <div className="card space-y-2">
        <h2 className="font-semibold">Sesión</h2>
        <p className="text-sm text-muted">Usuario: <span className="text-white">{session.nombre}</span></p>
        <button className="btn-danger text-sm" onClick={onLogout}>
          Cerrar sesión
        </button>
      </div>

      <div className="text-center text-muted text-xs pt-4">
        Criterio Pedidos v1.0 · Lavalle Comercial
      </div>
    </div>
  )
}
