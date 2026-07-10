export async function parsearArchivoPedido(archivo, clienteNombre) {
  const apiKey = localStorage.getItem('criterio_gemini_key')
  if (!apiKey) throw new Error('Falta la API Key. Configurala en Ajustes.')

  const base64 = await fileToBase64(archivo)
  const mimeType = getMimeType(archivo)
  const prompt = buildPrompt(clienteNombre)

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: mimeType, data: base64 } },
          { type: 'text', text: prompt }
        ]
      }]
    })
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Error API: ${err.slice(0, 300)}`)
  }

  const data = await response.json()
  const texto = data.content?.find(b => b.type === 'text')?.text || ''

  try {
    return JSON.parse(texto.replace(/```json|```/g, '').trim())
  } catch {
    throw new Error('No se pudo interpretar la respuesta. Intentá de nuevo.')
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

Devolvé SOLO este JSON sin backticks ni markdown:
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
      "sucursales": [{ "nro_sucursal": "string", "cantidad": 0 }],
