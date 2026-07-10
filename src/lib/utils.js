// Días hábiles entre hoy y una fecha
export function diasHabilesHasta(fechaEntrega) {
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const hasta = new Date(fechaEntrega)
  hasta.setHours(0, 0, 0, 0)

  if (hasta < hoy) return -1 // vencido

  let count = 0
  const cursor = new Date(hoy)
  while (cursor < hasta) {
    cursor.setDate(cursor.getDate() + 1)
    const dow = cursor.getDay()
    if (dow !== 0 && dow !== 6) count++ // lunes a viernes
  }
  return count
}

// Estado de alerta según días hábiles
export function alertaFecha(fechaEntrega) {
  const dias = diasHabilesHasta(fechaEntrega)
  if (dias < 0) return 'vencido'
  if (dias <= 10) return 'proximo'
  return 'ok'
}

// Formatea fecha DD/MM/YYYY
export function formatFecha(fecha) {
  if (!fecha) return '-'
  const d = new Date(fecha)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// Conversión de talles Sucati → nuestros
const CONV_SUCATI = { '3': '4', '4': '6', '5': '8', '6': '10', '7': '12', '8': '14', '9': '16' }
export function convertirTalleSucati(talle) {
  return CONV_SUCATI[String(talle)] || String(talle)
}

// Porcentaje
export function pct(parcial, total) {
  if (!total) return 0
  return Math.round((parcial / total) * 100)
}
