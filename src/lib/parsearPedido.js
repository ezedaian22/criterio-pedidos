// Parsea cualquier archivo de pedido usando la API de Anthropic
// Devuelve un objeto estructurado listo para confirmar y guardar en Supabase

export async function parsearArchivoPedido(archivo, clienteNombre) {
  const apiKey = localStorage.getItem('criterio_anthropic_key')
  if (!apiKey) throw new Error('Falta la API Key de Anthropic. Configurala en Ajustes.')

  // Convertir archivo a base64
  const base64 = await fileToBase64(archivo)
  const esImagen = archivo.type.startsWith('image/')
  const esPDF = archivo.type === 'application/pdf'
  const esExcel = archivo.name.endsWith('.xls') || archivo.name.endsWith('.xlsx')

  // Para XLS necesitamos texto plano primero (no se puede enviar binario directamente)
  let contenido
  if (esExcel) {
    contenido = {
      type: 'text',
      text: `[Archivo Excel: ${archivo.name}]\nContenido en base64 adjunto. Por favor interpretá este archivo de pedido como si fuera un CSV/texto.`
    }
    // En realidad mandamos el base64 como texto para que la IA lo procese
  }

  const prompt = buildPrompt(clienteNombre)

  let messages
  if (esPDF) {
    messages = [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64 }
        },
        { type: 'text', text: prompt }
      ]
    }]
  } else {
    // Para XLS mandamos base64 como documento
    messages = [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64 }
        },
        { type: 'text', text: prompt }
      ]
    }]
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: `Sos un asistente que interpreta pedidos de clientes para una empresa de indumentaria llamada Lavalle Comercial / Criterio Indumentaria.
Siempre respondés ÚNICAMENTE con JSON válido, sin texto adicional, sin backticks, sin markdown.
El JSON debe seguir exactamente el esquema que se te indica.`,
      messages
    })
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Error API Anthropic: ${err}`)
  }

  const data = await response.json()
  const texto = data.content.find(b => b.type === 'text')?.text || ''

  try {
    const clean = texto.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch {
    throw new Error('No se pudo parsear la respuesta de la IA. Intentá de nuevo.')
  }
}

function buildPrompt(clienteNombre) {
  return `Analizá este archivo de pedido del cliente "${clienteNombre}" y extraé la información estructurada.

IMPORTANTE sobre talles de Sucati/Chandal: si el cliente es Sucati o Chandal, sus talles equivalen a los nuestros así: 3→4, 4→6, 5→8, 6→10, 7→12, 8→14, 9→16. Siempre convertí a talles nuestros.

Devolvé SOLO este JSON (sin nada más):
{
  "numero_pedido": "string o null",
  "fecha_pedido": "YYYY-MM-DD o null",
  "fecha_entrega": "YYYY-MM-DD",
  "articulos": [
    {
      "codigo_nuestro": "string",
      "codigo_cliente": "string o null",
      "descripcion_cliente": "string",
      "precio_unitario": number o null,
      "variantes": [
        {
          "nombre": "string (color, estampado, DNS, etc.)",
          "cantidad_total": number
        }
      ],
      "sucursales": [
        {
          "nro_sucursal": "string",
          "cantidad": number
        }
      ],
      "modulos": [
        {
          "descripcion": "string",
          "unidades_por_caja": number,
          "curva_talles": {"talle": cantidad}
        }
      ],
      "total_unidades": number
    }
  ]
}

Notas:
- Si no hay variantes (colores/estampados), dejá variantes como array vacío [].
- Si no hay módulos, dejá modulos como array vacío [].
- sucursales es la distribución: cuántas unidades de ese artículo van a cada sucursal.
- Para Balbi: las sucursales van del 1 al 23 (Hijos: 1-17, Retail: 18-23).
- Para García Reguera: sucursales 01, 04, 06, 10, 11, 13, 14.
- Para Sucati/Chandal: sucursales del 0 al 23 (la 0 es especial, se entrega al final).
- codigo_nuestro es el código interno de Lavalle (ej: 170, 2278, 128).
- codigo_cliente es el código que usa el cliente si es distinto (ej: 53920, 50789).`
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'))
    reader.readAsDataURL(file)
  })
}
