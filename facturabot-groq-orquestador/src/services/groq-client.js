const DEFAULT_MODEL = 'openai/gpt-oss-120b';

export class GroqClient {
  constructor({ apiKey = process.env.GROQ_API_KEY, model = process.env.GROQ_MODEL || DEFAULT_MODEL, timeoutMs = 30000 } = {}) {
    this.apiKey = String(apiKey || '').trim();
    this.model = model;
    this.timeoutMs = timeoutMs;
  }

  get configured() { return this.apiKey.length > 0; }

  async chat(messages, { temperature = 0.15, maxTokens = 900, jsonMode = false } = {}) {
    if (!this.configured) throw new Error('GROQ_NOT_CONFIGURED');
    const payload = {
      model: this.model,
      messages,
      temperature,
      max_tokens: maxTokens,
    };
    if (jsonMode) payload.response_format = { type: 'json_object' };

    let response;
    try {
      response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new Error('GROQ_TIMEOUT');
      throw new Error('GROQ_NETWORK_ERROR');
    }

    if (!response.ok) {
      // No propaga el cuerpo de error del proveedor, que podría incluir detalles innecesarios.
      if (response.status === 401 || response.status === 403) throw new Error('GROQ_AUTH_ERROR');
      if (response.status === 429) throw new Error('GROQ_RATE_LIMIT');
      if (response.status >= 500) throw new Error('GROQ_PROVIDER_ERROR');
      throw new Error('GROQ_REQUEST_ERROR');
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('GROQ_EMPTY_RESPONSE');
    return content.trim();
  }

  async classify(message, history, agentDescriptions) {
    const instructions = [
      'Eres el enrutador de FacturaBot. Responde solo JSON válido con las claves: agente, tarea, requiereAclaracion, pregunta.',
      'agente debe ser exactamente uno de: facturas, datos, reportes, correo, archivos.',
      'Elige el especialista que corresponda a la intención principal. No ejecutes acciones externas ni inventes resultados.',
      'Si el usuario pide procesar/revisar/validar facturas elige facturas; consultar cantidades, proveedores o estados elige datos; resumen/KPI/auditoría elige reportes; redactar un correo elige correo; organizar o estructurar texto extraído de documentos elige archivos.',
      'Si una petición necesita un archivo o dato que no fue proporcionado, marca requiereAclaracion=true y pregunta qué falta. No afirmes que puedes leer un archivo no adjunto.',
      'Siempre responde en español.',
      `Especialistas: ${JSON.stringify(agentDescriptions)}`,
    ].join('\n');
    const raw = await this.chat([
      { role: 'system', content: instructions },
      ...(history || []).slice(-6).map((item) => ({ role: item.role, content: item.content })),
      { role: 'user', content: message },
    ], { temperature: 0, maxTokens: 350, jsonMode: true });
    const parsed = JSON.parse(raw);
    const valid = ['facturas', 'datos', 'reportes', 'correo', 'archivos'].includes(parsed.agente);
    if (!valid || typeof parsed.tarea !== 'string') throw new Error('GROQ_INVALID_ROUTING');
    return {
      agente: parsed.agente,
      tarea: parsed.tarea.slice(0, 2000),
      requiereAclaracion: Boolean(parsed.requiereAclaracion),
      pregunta: String(parsed.pregunta || '').slice(0, 500),
    };
  }

  async composeAnswer(message, result, history) {
    return this.chat([
      {
        role: 'system',
        content: 'Eres FacturaBot, asistente administrativo para facturas costarricenses. Responde en español claro y conciso. Usa exclusivamente los datos del resultado de la herramienta. No inventes cifras ni declares que enviaste correos, guardaste archivos o consultaste servicios externos. Si algo no está disponible, dilo expresamente. No repitas cédulas completas u otros datos sensibles sin necesidad.',
      },
      ...(history || []).slice(-4).map((item) => ({ role: item.role, content: item.content })),
      { role: 'user', content: `Solicitud original: ${message}\nResultado verificado del especialista (fuente de verdad): ${JSON.stringify(result)}\nRedacta la respuesta para el usuario.` },
    ], { temperature: 0.2, maxTokens: 700 });
  }
}
