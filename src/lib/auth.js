// Usuarios hardcodeados (igual que las otras apps)
const USUARIOS = {
  deposito: { password: 'Deposito', rol: 'deposito', nombre: 'Depósito' },
  gerencia: { password: 'Ezedani', rol: 'gerencia', nombre: 'Gerencia' },
}

const SESSION_KEY = 'criterio_pedidos_user'

export function login(usuario, password) {
  const u = USUARIOS[usuario.toLowerCase()]
  if (!u) return { ok: false, error: 'Usuario no encontrado' }
  if (u.password !== password) return { ok: false, error: 'Contraseña incorrecta' }
  const session = { usuario: usuario.toLowerCase(), rol: u.rol, nombre: u.nombre }
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  return { ok: true, session }
}

export function logout() {
  localStorage.removeItem(SESSION_KEY)
}

export function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
