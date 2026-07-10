import { createClient } from '@supabase/supabase-js'

const url = 'https://dptfgqdybjuhsehyhuyy.supabase.co'
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwdGZncWR5Ymp1aHNlaHlodXl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyNDM4OTEsImV4cCI6MjA5MzgxOTg5MX0.Pek-PptrKcUYh6jCKocnhqO4umbUx5LWtgwrE4WzjF4'

export const supabase = createClient(url, key, {
  db: { schema: 'pedidos' }
})

export const supabaseCostos = createClient(url, key, {
  db: { schema: 'costos' }
})
