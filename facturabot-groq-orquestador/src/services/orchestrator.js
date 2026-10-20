import { AgenteFacturas, AgenteDatos, AgenteReportes, AgenteCorreo, AgenteArchivos } from '../agents/agents.js';

const AGENT_CLASSES = [AgenteFacturas, AgenteDatos, AgenteReportes, AgenteCorreo, AgenteArchivos];

// Las preguntas educativas deben ir al modelo general antes de evaluar palabras
// como IVA, factura o impuesto, que también aparecen en preguntas conceptuales.
function isExplicitLearningRequest(message) {
  const text = String(message || '').trim();
  const asksToLearn = /\b(?:expl[ií]ca(?:me)?|explica(?:r)?|qu[eé] es|qu[eé] significa|define|definici[oó]n|significado|para qu[eé] sirve|c[oó]mo funciona|c[oó]mo se calcula|diferencia entre|dame un ejemplo|ens[eé][ñn]ame|quiero entender|ay[uú]dame a entender)\b/i.test(text);
  if (!asksToLearn) return false;
  // Si se menciona un identificador de factura o se pide una operación real,
  // mantener la consulta con el especialista de negocio.
  const hasRecordId = /\b(?:F|FAC|INV|DEMO)-?\d{2,}\b/i.test(text);
  const asksOperationalAction = /\b(?:procesa(?:r)?|valida(?:r)?|importa(?:r)?|revisa(?:r)? el lote|genera(?:r)? reporte|busca(?:r)? la factura|estado de la factura|mis facturas|estas facturas|este lote)\b/i.test(text);
  return !hasRecordId && !asksOperationalAction;
}

function heuristicRoute(message) {
  if (isExplicitLearningRequest(message)) return 'general';
  if (/(?:cuánto es|calcula|resuelve|resultado de)\s+[\d\s()+.,*/%-]+\??$/i.test(message) && !/factura|iva|impuesto/i.test(message)) return 'general';
  if (!/factura|facturas|iva|impuesto|proveedor|validar|procesar|reporte|resumen|estadíst|estadist|kpi|auditor|anomal|rechazad|correo|email|e-mail|redact|notificar|pdf|adjunt|archivo|documento|extraer|cuánto|cuantos|cuántos|estado|estatus|buscar|datos/i.test(message)) return 'general';
  if (/correo|email|e-mail|redact|notificar/i.test(message)) return 'correo';
  if (/\b(?:F|FAC|INV|DEMO)-?\d{2,}\b/i.test(message) && /explica|significa|por qu[eé]|rechazad|estado|motivo|detalle/i.test(message)) return 'datos';
  if (/reporte|resume|resumen|estadíst|estadist|kpi|auditor|anomal|rechazad/i.test(message)) return 'reportes';
  if (/pdf|adjunt|archivo|documento|extraer/i.test(message)) return 'archivos';
  if (/cuánto|cuantos|cuántos|estado|estatus|buscar|proveedor|datos|\b[A-Z0-9]+(?:-[A-Z0-9]+)+\b/i.test(message) && !/procesar|procesa|validar|factura(s)?$/i.test(message)) return 'datos';
  return 'facturas';
}

export class MemoriaConversacion {
  #sessions = new Map();
  constructor({ maxMessages = 20, maxSessions = 300 } = {}) {
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

    // No permitimos que el clasificador convierta una pregunta conceptual en
    // procesamiento de lote solo porque el texto incluya 'IVA' o 'factura'.
    const forceGeneral = isExplicitLearningRequest(text);
    if (this.#llm?.configured && !forceGeneral) {
      try {
        route = await this.#llm.classify(text, history, this.listarAgentes());
      } catch (error) {
        aiMode = 'local';
        warning = this.#friendlyGroqError(error);
      }
    }

    if (route.agente === 'general') {
      let answer;
      if (this.#llm?.configured && aiMode === 'groq') {
        try { answer = await this.#llm.answerGeneral(text, history); }
        catch (error) { aiMode = 'local'; warning = this.#friendlyGroqError(error); }
      }
      if (!answer) answer = this.#formatGeneralFallback(text);
      this.#memoria.add(sessionId, { role: 'user', content: text }, { role: 'assistant', content: answer });
      return { answer, agent: 'general', aiMode, warning, needsInput: false, result: null };
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
        // La redacción es una tarea generativa: no devolver solo la plantilla fija del agente.
        answer = agente.nombre === 'correo'
          ? await this.#llm.draftEmail(text, history, result)
          : await this.#llm.composeAnswer(text, result, history);
      } catch (error) {
        aiMode = 'local';
        warning = this.#friendlyGroqError(error);
      }
    }

    this.#memoria.add(sessionId, { role: 'user', content: text }, { role: 'assistant', content: answer });
    return { answer, agent: agente.nombre, aiMode, warning, needsInput: false, result };
  }

  limpiarMemoria(sessionId) { this.#memoria.clear(sessionId); }

  #formatGeneralFallback(text) {
    const query = text.trim();
    const conceptAnswer = this.#offlineConceptExplanation(query);
    if (conceptAnswer) return conceptAnswer;
    const arithmetic = query.match(/(?:cuánto es|calcula|resuelve|resultado de)\s+([\d\s()+.,*/%-]+)\??$/i);
    if (arithmetic) {
      const expression = arithmetic[1].replace(/,/g, '.').replace(/\s+/g, '');
      if (/^[\d.+*/()%-]+$/.test(expression) && !/[+*/%.-]{2,}/.test(expression)) {
        try {
          const tokens = expression.match(/\d+(?:\.\d+)?|[()+*/%-]/g) || [];
          if (tokens.join('') === expression) {
            const values = []; const ops = []; const precedence = (op) => (op === '+' || op === '-') ? 1 : (op === '*' || op === '/' || op === '%') ? 2 : 0;
            const apply = () => { const op = ops.pop(), b = values.pop(), a = values.pop(); if (op === '+') values.push(a+b); else if (op === '-') values.push(a-b); else if (op === '*') values.push(a*b); else if (op === '/') values.push(a/b); else if (op === '%') values.push(a%b); };
            let prev = 'start';
            for (const token of tokens) {
              if (/^\d/.test(token)) { values.push(Number(token)); prev = 'number'; }
              else if (token === '(') { ops.push(token); prev = '('; }
              else if (token === ')') { while (ops.length && ops.at(-1) !== '(') apply(); if (ops.pop() !== '(') throw new Error(); prev = ')'; }
              else { if (prev === 'start' || prev === '(') { if (token === '-') values.push(0); else throw new Error(); } while (ops.length && ops.at(-1) !== '(' && precedence(ops.at(-1)) >= precedence(token)) apply(); ops.push(token); prev = 'op'; }
            }
            while (ops.length) { if (ops.at(-1) === '(') throw new Error(); apply(); }
            if (values.length === 1 && Number.isFinite(values[0])) return `El resultado es **${Number(values[0].toPrecision(12)).toLocaleString('es-CR')}**.`;
          }
        } catch { /* expresión inválida: no ejecutar */ }
      }
    }
    return 'No pude generar una explicación completa porque la IA no está disponible. Configura una clave válida de Groq en `.env` y vuelve a intentarlo. Puedes seguir usando el procesamiento local de facturas y la calculadora.';
  }

  #offlineConceptExplanation(text) {
    const normalized = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const concepts = [
      { keys: ['iva', 'impuesto al valor agregado'], title: 'IVA (Impuesto al Valor Agregado)', body: 'Es un impuesto indirecto aplicado al consumo de bienes y servicios. En una factura, normalmente se calcula sobre la base imponible según la tarifa aplicable; el total suele ser subtotal más IVA, menos descuentos o retenciones que correspondan. En Costa Rica existen tarifas y tratamientos distintos, por lo que no todas las operaciones llevan necesariamente la misma tasa.' },
      { keys: ['factura electronica', 'comprobante electronico'], title: 'Factura electrónica', body: 'Es un comprobante digital que documenta una venta o prestación de servicios. Incluye datos del emisor y receptor, fecha, detalle, moneda, impuestos y total. En Costa Rica debe cumplir los requisitos tributarios vigentes y su validez no se determina únicamente por que el documento sea un PDF.' },
      { keys: ['base imponible', 'base gravable'], title: 'Base imponible', body: 'Es el monto sobre el que se calcula un impuesto. Por ejemplo, si un producto cuesta ₡10 000 antes de impuesto y corresponde una tarifa hipotética del 13%, el impuesto sería ₡1 300 y el importe con impuesto ₡11 300, sin considerar descuentos u otros ajustes.' },
      { keys: ['subtotal'], title: 'Subtotal', body: 'Es el importe de los productos o servicios antes de sumar impuestos y, según el formato, antes o después de aplicar descuentos. Conviene verificar cómo está definido en cada factura para no sumar un impuesto dos veces.' },
      { keys: ['credito fiscal'], title: 'Crédito fiscal', body: 'En términos generales, es el IVA soportado en compras que un contribuyente puede utilizar para compensar el IVA que debe pagar, siempre que cumpla los requisitos legales y documentales aplicables. No todo impuesto pagado da derecho automáticamente a crédito fiscal.' },
      { keys: ['debito fiscal'], title: 'Débito fiscal', body: 'Es el IVA generado o cobrado en las ventas gravadas de un contribuyente. En la liquidación del impuesto suele compararse con el crédito fiscal permitido para determinar el saldo a pagar o el crédito resultante, según las reglas aplicables.' },
      { keys: ['retencion', 'retenciones'], title: 'Retención', body: 'Es una cantidad que una persona o entidad descuenta de un pago y entrega a la autoridad o al destinatario que corresponda, según el tipo de retención. No debe confundirse con el IVA ni aplicarse sin confirmar la regla, el porcentaje y la operación concreta.' },
      { keys: ['nota de credito', 'nota credito'], title: 'Nota de crédito', body: 'Es un comprobante usado, por ejemplo, para corregir o reducir el valor de una operación anterior, documentar una devolución o aplicar un ajuste autorizado. Debe relacionarse con el comprobante original y seguir las reglas tributarias aplicables.' },
      { keys: ['nota de debito', 'nota debito'], title: 'Nota de débito', body: 'Es un comprobante que documenta un aumento o ajuste al monto de una operación previa cuando corresponde. Debe tener una razón válida y vincularse con la operación original conforme a las reglas aplicables.' },
      { keys: ['cuentas por pagar'], title: 'Cuentas por pagar', body: 'Son las obligaciones que una empresa tiene pendientes con sus proveedores. Un control típico registra proveedor, número de factura, fecha de emisión, vencimiento, importe, estado de pago y comprobante de cancelación.' },
      { keys: ['conciliacion', 'conciliar facturas'], title: 'Conciliación de facturas', body: 'Es la comparación de las facturas con órdenes de compra, recepción de bienes o servicios y registros de pago para encontrar diferencias en importes, fechas, cantidades o impuestos antes de aprobar o pagar.' },
      { keys: ['factura proforma', 'proforma'], title: 'Factura proforma', body: 'Es un documento preliminar que presenta una oferta o estimación de una operación. Por sí sola, normalmente no sustituye la factura fiscal definitiva ni demuestra que se haya realizado la venta o el pago.' },
      { keys: ['exento', 'exencion', 'factura exenta'], title: 'Exención de IVA', body: 'Significa que una operación no está sujeta al cobro del impuesto por una norma o condición específica. No es lo mismo que una tarifa del 0% en todos los contextos; debe verificarse el fundamento y la documentación correspondiente.' },
    ];
    const found = concepts.find((concept) => concept.keys.some((key) => normalized.includes(key)));
    if (!found) return null;
    return `**${found.title}**

${found.body}

*Nota:* esta es una explicación general, no una determinación fiscal para una transacción concreta. Para confirmar el tratamiento de un caso real, revisa la normativa vigente o consulta a un profesional tributario.`;
  }

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
