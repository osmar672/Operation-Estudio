const DEFAULT_MODEL = 'openai/gpt-oss-120b';
const GENERAL_SYSTEM_PROMPT = `Eres FacturaBot Intelligence, un asistente experto, riguroso y muy capaz que trabaja en español. Tu objetivo es resolver la petición real del usuario, no dar respuestas genéricas.

REGLAS DE CALIDAD:
- Comprende la intención completa, el contexto de la conversación y las restricciones antes de responder. Si una petición tiene varias partes, cúbrelas todas y ordénalas.
- Para tareas difíciles, razona cuidadosamente internamente y entrega una solución comprobable, clara y completa. No muestres razonamiento privado paso a paso; comunica conclusiones, supuestos y verificaciones útiles.
- Si el usuario pide código, entrega código ejecutable, coherente con su entorno y con instrucciones exactas para ejecutarlo. Evita fragmentos incompletos salvo que los solicite.
- Si pide cálculos, calcula con cuidado y explica la fórmula o los pasos verificables. No inventes resultados.
- Si faltan datos imprescindibles, formula una pregunta concreta. Si puedes avanzar con un supuesto razonable, decláralo y continúa.
- Distingue hechos, estimaciones y recomendaciones. Reconoce explícitamente la incertidumbre y nunca inventes acceso a Internet, archivos, herramientas o sistemas.
- Adapta la profundidad a la tarea: breve para algo simple, detallada para algo complejo. Usa encabezados, listas o tablas cuando ayuden.
- Para tareas de facturación, impuestos o contabilidad, respeta los resultados calculados por las herramientas deterministas y no inventes importes ni afirmes validez fiscal oficial.
- Nunca afirmes que ejecutaste una acción externa si solo la explicaste o preparaste. Mantén un tono profesional, directo y amable.`;

export class GroqClient {
  constructor({ apiKey = process.env.GROQ_API_KEY, model = process.env.GROQ_MODEL || DEFAULT_MODEL, timeoutMs = 60000, reasoningEffort = process.env.GROQ_REASONING_EFFORT || 'high' } = {}) {
    this.apiKey = String(apiKey || '').trim();
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.reasoningEffort = reasoningEffort;
  }

  get configured() { return this.apiKey.length > 0; }

  async chat(messages, { temperature = 0.15, maxTokens = 1800, jsonMode = false } = {}) {
    if (!this.configured) throw new Error('GROQ_NOT_CONFIGURED');
    const payload = {
      model: this.model,
      messages,
      temperature,
      max_tokens: maxTokens,
    };
    if (jsonMode) payload.response_format = { type: 'json_object' };
    // GPT-OSS admite control explícito del esfuerzo de razonamiento en Groq.
    if (this.model.startsWith('openai/gpt-oss-') && ['low', 'medium', 'high'].includes(this.reasoningEffort)) {
      payload.reasoning_effort = this.reasoningEffort;
    }

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
      'Eres el enrutador inteligente de FacturaBot. Devuelve exclusivamente un objeto JSON válido con las claves agente, tarea, requiereAclaracion y pregunta.',
      'agente debe ser exactamente uno de: facturas, datos, reportes, correo, archivos, general.',
      'Clasifica por intención real, no solo por palabras clave. Usa el historial reciente para resolver referencias como eso, lo anterior, continúa o hazlo más detallado.',
      'facturas: exclusivamente validar/procesar un lote real de facturas. datos: consultar una factura, proveedor, estado, fecha, importe o registro del lote. reportes: KPI, resumen, auditoría, tendencias o análisis del lote. correo: redactar o revisar correos. archivos: trabajar con texto/documentos proporcionados. general: explicar conceptos (incluidos IVA, impuestos, contabilidad y facturación), definiciones, ejemplos educativos, programación, matemáticas, escritura, planificación y cualquier pregunta conceptual. Una pregunta como ¿qué es el IVA?, explícame la factura electrónica o define crédito fiscal SIEMPRE es general, nunca significa procesar las facturas del lote. Solo procesa facturas cuando el usuario lo pida explícitamente.',
      'No confundas una pregunta general que menciona la palabra factura con una orden de procesar facturas. No afirmes que ejecutaste una operación: el especialista solo puede hacer lo que indican sus herramientas.',
      'Marca requiereAclaracion=true solo si falta un dato imprescindible para ejecutar la petición de negocio; no lo hagas si puedes responder directamente. La pregunta debe ser concreta y breve.',
      'La tarea debe preservar todos los detalles, filtros, formatos y restricciones indicados por el usuario. Responde en español.',
      `Especialistas disponibles: ${JSON.stringify(agentDescriptions)}`,
    ].join('\n');
    const raw = await this.chat([
      { role: 'system', content: instructions },
      ...(history || []).slice(-16).map((item) => ({ role: item.role, content: String(item.content).slice(0, 6000) })),
      { role: 'user', content: message },
    ], { temperature: 0, maxTokens: 350, jsonMode: true });
    const parsed = JSON.parse(raw);
    const valid = ['facturas', 'datos', 'reportes', 'correo', 'archivos', 'general'].includes(parsed.agente);
    if (!valid || typeof parsed.tarea !== 'string') throw new Error('GROQ_INVALID_ROUTING');
    return {
      agente: parsed.agente,
      tarea: parsed.tarea.slice(0, 2000),
      requiereAclaracion: Boolean(parsed.requiereAclaracion),
      pregunta: String(parsed.pregunta || '').slice(0, 500),
    };
  }

  async answerGeneral(message, history = []) {
    return this.chat([
      { role: 'system', content: GENERAL_SYSTEM_PROMPT },
      ...history.slice(-6).map((item) => ({ role: item.role, content: item.content })),
      { role: 'user', content: message },
    ], { temperature: 0.25, maxTokens: 2200 });
  }

  async draftEmail(message, history = [], context = {}) {
    return this.chat([
      { role: 'system', content: `${GENERAL_SYSTEM_PROMPT}\n\nMODO REDACCIÓN DE CORREOS: Debes redactar el correo completo solicitado, no explicar cómo redactarlo ni devolver una plantilla genérica. Infiere tono, objetivo y destinatario del mensaje. Incluye asunto y cuerpo listos para copiar. Si faltan nombres o datos, usa marcadores claros como [Nombre] solo para esos campos. Respeta todos los detalles que el usuario pidió. No afirmes que el correo fue enviado. No inventes hechos ni cifras; si hay contexto de facturas, usa solo el contexto verificado.` },
      ...(history || []).slice(-8).map((item) => ({ role: item.role, content: String(item.content).slice(0, 5000) })),
      { role: 'user', content: `Redacta ahora el correo solicitado.\nSolicitud: ${message}\nContexto verificado disponible (puede estar vacío): ${JSON.stringify(context)}` },
    ], { temperature: 0.35, maxTokens: 1800 });
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
