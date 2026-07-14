import React from 'react'
import { useState } from 'react'
import { autenticarGoogle } from '../lib/exportarSheets'

export default function Ajustes({ session, onVolver, onLogout }) {
  const [apiKey, setApiKey] = useState(localStorage.getItem('criterio_anthropic_key') || '')
  const [googleClientId, setGoogleClientId] = useState(localStorage.getItem('criterio_google_client_id') || '')
  const [guardado, setGuardado] = useState(false)
  const [googleGuardado, setGoogleGuardado] = useState(false)
  const [testGoogleStatus, setTestGoogleStatus] = useState(null) // null | 'ok' | 'error'
  const [testGoogleMsg, setTestGoogleMsg] = useState('')

  function guardarKey() {
    localStorage.setItem('criterio_anthropic_key', apiKey.trim())
    setGuardado(true)
    setTimeout(() => setGuardado(false), 2000)
  }

  function guardarGoogleClientId() {
    localStorage.setItem('criterio_google_client_id', googleClientId.trim())
    // Borrar token anterior si cambió el client ID
    localStorage.removeItem('criterio_google_token')
    setGoogleGuardado(true)
    setTimeout(() => setGoogleGuardado(false), 2000)
  }

  async function testGoogleAuth() {
    setTestGoogleStatus(null)
    setTestGoogleMsg('Abriendo Google...')
    try {
      // Borrar token para forzar nuevo login
      localStorage.removeItem('criterio_google_token')
      await autenticarGoogle()
      setTestGoogleStatus('ok')
      setTestGoogleMsg('✓ Autenticación exitosa. Sheets ya puede exportar al Drive.')
    } catch (err) {
      setTestGoogleStatus('error')
      setTestGoogleMsg('Error: ' + (err.message || 'No se pudo autenticar'))
    }
  }

  const tieneGoogleToken = !!localStorage.getItem('criterio_google_token')

  return (
    <div className="space-y-6 max-w-lg mx-auto">
      <div className="flex items-center gap-3">
        <button onClick={onVolver} style={{ color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer' }}>← Volver</button>
        <h1 className="text-xl font-bold">Ajustes</h1>
      </div>

      {/* API Key Anthropic */}
      <div className="card space-y-3">
        <h2 className="font-semibold">API Key de Anthropic</h2>
        <p className="text-sm text-muted">Necesaria para interpretar los archivos de pedidos con IA.</p>
        <input
          type="password"
          className="input font-mono text-sm"
          placeholder="sk-ant-..."
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
        />
        <button className="btn-primary text-sm" onClick={guardarKey} disabled={!apiKey}>
          {guardado ? '✓ Guardado' : 'Guardar API Key'}
        </button>
      </div>

      {/* Google Sheets */}
      <div className="card space-y-3">
        <h2 className="font-semibold">📊 Google Sheets</h2>
        <p className="text-sm text-muted">
          Para exportar directo al Drive como Google Sheets. Necesitás un <strong style={{ color: 'white' }}>Google OAuth Client ID</strong> con los scopes de Sheets y Drive habilitados.
        </p>

        <div style={{ background: '#0f1117', borderRadius: '0.5rem', padding: '0.75rem', fontSize: '0.75rem', color: '#9ca3af', lineHeight: 1.6 }}>
          <p style={{ fontWeight: 600, color: '#c8d8ff', marginBottom: '0.25rem' }}>Cómo obtener el Client ID:</p>
          <p>1. Entrá a <span style={{ color: '#6b8fff' }}>console.cloud.google.com</span></p>
          <p>2. APIs &amp; Services {'->'} Credentials {'->'} Create OAuth 2.0 Client ID</p>
          <p>3. Tipo: <strong style={{ color: 'white' }}>Web application</strong></p>
          <p>4. Origins: <code style={{ color: '#86efac' }}>https://criterio-pedidos.vercel.app</code></p>
          <p>5. Habilitá: <em>Google Sheets API</em> y <em>Google Drive API</em></p>
        </div>

        <input
          type="text"
          className="input font-mono text-sm"
          placeholder="XXXXXXXXXX-xxxx.apps.googleusercontent.com"
          value={googleClientId}
          onChange={e => setGoogleClientId(e.target.value)}
        />
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-primary text-sm" onClick={guardarGoogleClientId} disabled={!googleClientId}>
            {googleGuardado ? '✓ Guardado' : 'Guardar Client ID'}
          </button>
          <button
            onClick={testGoogleAuth}
            disabled={!googleClientId}
            style={{
              background: '#1e3a5f', color: '#93c5fd', border: '1px solid #1d4ed8',
              borderRadius: '0.5rem', padding: '0.375rem 0.875rem', fontSize: '0.875rem',
              fontWeight: 600, cursor: googleClientId ? 'pointer' : 'not-allowed',
              opacity: googleClientId ? 1 : 0.5
            }}
          >
            Probar autenticación
          </button>
        </div>

        {testGoogleMsg && (
          <div style={{
            background: testGoogleStatus === 'ok' ? '#052e16' : testGoogleStatus === 'error' ? '#1c0a0a' : '#0f1117',
            border: '1px solid ' + (testGoogleStatus === 'ok' ? '#15803d' : testGoogleStatus === 'error' ? '#b91c1c' : '#2a2d3e'),
            borderRadius: '0.5rem', padding: '0.625rem 0.875rem',
            fontSize: '0.8rem',
            color: testGoogleStatus === 'ok' ? '#86efac' : testGoogleStatus === 'error' ? '#f87171' : '#9ca3af'
          }}>
            {testGoogleMsg}
          </div>
        )}

        {tieneGoogleToken && !testGoogleMsg && (
          <p style={{ fontSize: '0.75rem', color: '#4ade80' }}>✓ Sesión Google activa</p>
        )}
      </div>

      {/* Sesión */}
      <div className="card space-y-2">
        <h2 className="font-semibold">Sesión</h2>
        <p className="text-sm text-muted">Usuario: <span className="text-white">{session.nombre}</span></p>
        <button className="btn-danger text-sm" onClick={onLogout}>Cerrar sesión</button>
      </div>

      <div className="text-center text-muted text-xs pt-4">
        Criterio Pedidos v1.0 · Lavalle Comercial
      </div>
    </div>
  )
}
