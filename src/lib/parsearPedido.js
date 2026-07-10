// Parsea cualquier archivo de pedido usando Gemini API
export async function parsearArchivoPedido(archivo, clienteNombre) {
  const apiKey = localStorage.getItem('criterio_gemini_key')
  if (!apiKey) throw new Error('Falta la API Key de Gemini. Configurala en Ajustes.')

  const base64 = await fileToBase64(archivo)
  const mimeType = getMimeType(archivo)
  const prompt = buildPrompt(clienteNombre)

  const body = {
    contents: [{
      parts: [
        {
          inline_data: {
            mime_type: mimeType,
            data: base64
          }
        },
        { text: prompt }
      ]
    }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 4000,
    }
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }
  )

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Error API Gemini: ${err}`)
  }

  const data = await response.json()
  const texto = data.candidates?.[0]?.content?.parts?.[0]?.text || ''

  try {
    const clean = texto.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch {
    throw new Error('No se pudo parsear la respuesta de la IA. Intentá de nuevo.')
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

IMPORTANTE sobre talles de Sucati/Chandal: si el cliente es Sucati o Chandal, sus talles equivalen a los nuestros así: 3→4, 4→6, 5→8, 6→10, 7→12, 8→14, 9→16. Siempre convertí a talles nuestros.

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
      "variantes": [
        {
          "nombre": "string",
          "cantidad_total": 0
        }
      ],
      "sucursales": [
        {
          "nro_sucursal": "string",
          "cantidad": 0
        }
      ],
      "modulos": [
        {
          "descripcion": "string",
          "unidades_por_caja": 0,
          "curva_talles": {}
        }
      ],
      "total_unidades": 0
    }
  ]
}

Notas:
- Si no hay variantes dejá variantes como [].
- Si no hay módulos dejá modulos como [].
- sucursales es la distribución: cuántas unidades de ese artículo van a cada sucursal.
- Para Balbi: sucursales del 1 al 23 (Hijos: 1-17, Retail: 18-23).
- Para García Reguera: sucursales 01, 04, 06, 10, 11, 13, 14.
- Para Sucati/Chandal: sucursales del 0 al 23 (la 0 se entrega al final).
- codigo_nuestro es el código interno de Lavalle (ej: 170, 2278, 128).
- codigo_cliente es el código del cliente si es distinto (ej: 53920, 50789).`
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'))
    reader.readAsDataURL(file)
  })
}
