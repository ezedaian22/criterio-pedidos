import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// Cliente para schema pedidos
export const supabase = createClient(url, key, {
  db: { schema: 'pedidos' }
})

// Cliente para schema costos (solo lectura, para traer descripción y foto)
export const supabaseCostos = createClient(url, key, {
  db: { schema: 'costos' }
})
