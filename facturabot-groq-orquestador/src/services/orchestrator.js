import { AgenteFacturas, AgenteDatos, AgenteReportes, AgenteCorreo, AgenteArchivos } from '../agents/agents.js';

const AGENT_CLASSES = [AgenteFacturas, AgenteDatos, AgenteReportes, AgenteCorreo, AgenteArchivos];

function heuristicRoute(message) {
  if (/correo|email|e-mail|redact|notificar/i.test(message)) return 'correo';
  if (/reporte|resume|resumen|estadíst|estadist|kpi|auditor|anomal|rechazad/i.test(message)) return 'reportes';
  if (/pdf|adjunt|archivo|documento|extraer/i.test(message)) return 'archivos';
  if (/cuánto|cuantos|cuántos|estado|estatus|buscar|proveedor|datos|\b[A-Z0-9]+(?:-[A-Z0-9]+)+\b/i.test(message) && !/procesar|procesa|validar|factura(s)?$/i.test(message)) return 'datos';
  return 'facturas';
}

export class MemoriaConversacion {
  #sessions = new Map();
  constructor({ maxMessages = 8, maxSessions = 200 } = {}) {
    this.maxMessages = maxMessages;
    this.maxSessions = maxSessions;
  }
  get(sessionId) { return [...(this.#sessions.get(sessionId) || [])]; }
  add(sessionId, ...messages) {
    if (!this.#sessions.has(sessionId) && this.#sessions.size >= this.maxSessions) {
      this.#sessions.delete(this.#sessions.keys().next().value);
    }
    const history = this.#sessions.get(sessionId) || [];
    history.push(...messages);
    this.#sessions.set(sessionId, history.slice(-this.maxMessages));
  }
  clear(sessionId) { this.#sessions.delete(sessionId); }
}

export class Orquestador {
  #agentes = new Map();
  #memoria;
  #llm;

  constructor({ llm, memoria = new MemoriaConversacion(), agentes = AGENT_CLASSES.map((Agent) => new Agent()) } = {}) {
    this.#llm = llm;
    this.#memoria = memoria;
    for (const agente of agentes) this.registrar(agente);
  }

  registrar(agente) {
    if (!agente?.nombre || typeof agente.ejecutar !== 'function') throw new TypeError('El agente debe tener nombre y ejecutar().');
    this.#agentes.set(agente.nombre, agente);
  }

  listarAgentes() {
    return [...this.#agentes.values()].map(({ nombre, descripcion }) => ({ nombre, descripcion }));
  }

  async procesar(mensaje, { sessionId = 'local', invoices = undefined } = {}) {
    const text = String(mensaje || '').trim();
    if (!text) throw new TypeError('Escribe una solicitud antes de enviarla.');
    if (text.length > 2000) throw new RangeError('La solicitud supera el límite de 2000 caracteres.');

    const history = this.#memoria.get(sessionId);
    let route = { agente: heuristicRoute(text), tarea: text, requiereAclaracion: false, pregunta: '' };
    let aiMode = this.#llm?.configured ? 'groq' : 'local';
    let warning = '';

    if (this.#llm?.configured) {
      try {
        route = await this.#llm.classify(text, history, this.listarAgentes());
      } catch (error) {
        aiMode = 'local';
        warning = this.#friendlyGroqError(error);
      }
    }

    if (route.requiereAclaracion) {
      const answer = route.pregunta || 'Necesito un dato adicional para continuar. ¿Puedes especificarlo?';
      this.#memoria.add(sessionId, { role: 'user', content: text }, { role: 'assistant', content: answer });
      return { answer, agent: route.agente, aiMode, warning, needsInput: true, result: null };
    }

    const agente = this.#agentes.get(route.agente) || this.#agentes.get(heuristicRoute(text));
    let result;
    try {
      result = await agente.ejecutar({ message: route.tarea, sessionId, ...(Array.isArray(invoices) ? { invoices } : {}) });
    } catch {
      throw new Error('El especialista no pudo completar la tarea. Revisa la solicitud e inténtalo de nuevo.');
    }

    let answer = this.#formatLocalAnswer(agente.nombre, result);
    if (this.#llm?.configured && aiMode === 'groq') {
      try {
        answer = await this.#llm.composeAnswer(text, result, history);
      } catch (error) {
        aiMode = 'local';
        warning = this.#friendlyGroqError(error);
      }
    }

    this.#memoria.add(sessionId, { role: 'user', content: text }, { role: 'assistant', content: answer });
    return { answer, agent: agente.nombre, aiMode, warning, needsInput: false, result };
  }

  limpiarMemoria(sessionId) { this.#memoria.clear(sessionId); }

  #formatLocalAnswer(agent, result) {
    if (agent === 'facturas') return result.resumen || 'Lote procesado.';
    if (agent === 'reportes') {
      const resumen = `${result.titulo}: ${result.lote.aprobadas} aprobadas, ${result.lote.revision} en revisión y ${result.lote.rechazadas} rechazadas. Total: ₡${Number(result.finanzas.totalFacturadoCRC).toLocaleString('es-CR')}; IVA: ₡${Number(result.finanzas.ivaCRC).toLocaleString('es-CR')}.`;
      const hallazgos = Array.isArray(result.hallazgos) ? result.hallazgos.join(' ') : '';
      const rechazos = Array.isArray(result.errores) && result.errores.length
        ? ` Detalle de rechazos: ${result.errores.map((item) => `${item.id}: ${(item.motivos || []).join(' ')}`).join(' | ')}`
        : '';
      return `${resumen} ${hallazgos}${rechazos}`.trim();
    }
    if (agent === 'datos' && result.factura) return `${result.factura.id}: ${result.factura.estado}. ${result.factura.motivo || (result.factura.errores || []).join(' ') || (result.factura.total == null ? '' : `Total: ₡${Number(result.factura.total).toLocaleString('es-CR')}.`)}`;
    if (agent === 'datos' && result.tipo === 'consulta') return result.mensaje;
    if (agent === 'datos') return `Hay ${result.cantidad} registros: ${result.aprobadas} aprobados, ${result.revision} en revisión y ${result.rechazadas} rechazados. Total: ₡${Number(result.totalFacturado).toLocaleString('es-CR')}; IVA: ₡${Number(result.ivaTotal).toLocaleString('es-CR')}.`;
    if (agent === 'correo') return `Preparé un borrador: “${result.asunto}”. No se ha enviado. Revisa el destinatario y el contenido antes de utilizarlo.\n\n${result.cuerpo}`;
    return result.mensaje || 'El especialista preparó una respuesta.';
  }

  #friendlyGroqError(error) {
    const messages = {
      GROQ_NOT_CONFIGURED: 'Groq no está configurado; usé el modo local de demostración.',
      GROQ_TIMEOUT: 'Groq tardó demasiado en responder; usé el modo local.',
      GROQ_NETWORK_ERROR: 'No se pudo conectar con Groq; usé el modo local.',
      GROQ_AUTH_ERROR: 'Groq rechazó la clave. Revisa GROQ_API_KEY; usé el modo local.',
      GROQ_RATE_LIMIT: 'Groq alcanzó un límite de uso; usé el modo local.',
      GROQ_PROVIDER_ERROR: 'Groq está temporalmente indisponible; usé el modo local.',
      GROQ_REQUEST_ERROR: 'Groq no pudo procesar la solicitud; usé el modo local.',
      GROQ_EMPTY_RESPONSE: 'Groq devolvió una respuesta vacía; usé el modo local.',
      GROQ_INVALID_ROUTING: 'Groq devolvió un formato de enrutamiento no válido; usé el modo local.',
    };
    return messages[error?.message] || 'La IA no estuvo disponible; usé el modo local.';
  }
}
