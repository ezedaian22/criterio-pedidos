// Parsea cualquier archivo de pedido usando Gemini API (Vertex AI compatible)
export async function parsearArchivoPedido(archivo, clienteNombre) {
  const apiKey = localStorage.getItem('criterio_gemini_key')
  if (!apiKey) throw new Error('Falta la API Key de Gemini. Configurala en Ajustes.')

  const base64 = await fileToBase64(archivo)
  const mimeType = getMimeType(archivo)
  const prompt = buildPrompt(clienteNombre)

  // Intentar con endpoint de AI Studio primero, luego Vertex
  const endpoints = [
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`,
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-vision:generateContent?key=${apiKey}`,
  ]

  const body = {
    contents: [{
      parts: [
        { inline_data: { mime_type: mimeType, data: base64 } },
        { text: prompt }
      ]
    }],
    generationConfig: { temperature: 0, maxOutputTokens: 4000 }
  }

  let lastError = ''
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      if (response.status === 401 || response.status === 403) {
        // Key no válida para este endpoint, probar con Authorization header
        const response2 = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify(body)
        })
        if (response2.ok) {
          const data = await response2.json()
          return parsearRespuesta(data)
        }
        lastError = await response2.text()
        continue
      }

      if (!response.ok) {
        lastError = await response.text()
        continue
      }

      const data = await response.json()
      return parsearRespuesta(data)

    } catch (err) {
      lastError = err.message
      continue
    }
  }

  throw new Error(`Error al conectar con Gemini. Verificá tu API Key.\n${lastError.slice(0, 200)}`)
}

function parsearRespuesta(data) {
  const texto = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  if (!texto) throw new Error('La IA no devolvió respuesta. Intentá de nuevo.')
  try {
    const clean = texto.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch {
    throw new Error('No se pudo interpretar la respuesta de la IA. Intentá de nuevo.')
  }
}

function getMimeType(archivo) {
  if (archivo.type === 'application/pdf') return 'application/pdf'
  if (archivo.name.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  if (archivo.name.endsWith('.xls')) return 'application/vnd.ms-excel'
  return 'application/pdf'
}

function buildPrompt(clienteNombre) {
  return `Analizá este archivo de pedido del cliente "${clienteNombre}" y extraé la información estructurada.

IMPORTANTE sobre talles de Sucati/Chandal: sus talles equivalen así: 3→4, 4→6, 5→8, 6→10, 7→12, 8→14, 9→16. Convertí siempre a talles nuestros.

Devolvé SOLO este JSON (sin nada más, sin backticks, sin markdown):
{
  "numero_pedido": "string o null",
  "fecha_pedido": "YYYY-MM-DD o null",
  "fecha_entrega": "YYYY-MM-DD",
  "articulos": [
    {
      "codigo_nuestro": "string",
      "codigo_cliente": "string o null",
      "descripcion_cliente": "string",
      "precio_unitario": 0,
      "variantes": [],
      "sucursales": [
        { "nro_sucursal": "string", "cantidad": 0 }
      ],
      "modulos": [],
      "total_unidades": 0
    }
  ]
}

- sucursales es la distribución por sucursal de ese artículo.
- Para Balbi: sucursales 1 al 23 (Hijos: 1-17, Retail: 18-23).
- Para García Reguera: sucursales 01, 04, 06, 10, 11, 13, 14.
- Para Sucati/Chandal: sucursales 0 al 23 (la 0 se entrega al final).
- codigo_nuestro es el código de Lavalle (ej: 170, 2278, 128).
- codigo_cliente es el código del cliente si difiere (ej: 53920).
- variantes solo si hay colores/estampados distintos.
- modulos solo si hay módulos de armado definidos.`
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'))
    reader.readAsDataURL(file)
  })
}
