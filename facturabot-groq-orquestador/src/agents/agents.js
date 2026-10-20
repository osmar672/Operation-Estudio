import { AgenteBase } from './base-agent.js';
import { procesarLote } from '../domain/invoices.js';
import { sampleInvoices } from '../data/sample-invoices.js';

const money = (value) => `₡${Number(value || 0).toLocaleString('es-CR', { maximumFractionDigits: 2 })}`;

export class AgenteFacturas extends AgenteBase {
  constructor() { super('facturas', 'Procesa y valida facturas con las reglas deterministas de FacturaBot.'); }
  puedeManejar(message) { return /factura|facturas|iva|impuesto|proveedor|validar|procesar/i.test(message); }
  async ejecutar({ message = '', invoices = sampleInvoices } = {}) {
    const resultado = procesarLote(invoices);
    const detalle = resultado.resultados.map((f) => `${f.id}: ${f.estado}${f.total == null ? ` — ${f.motivo}` : ` — ${money(f.total)}`}`).join('\n');
    return { ...resultado, resumen: `Procesé ${resultado.cantidad} facturas: ${resultado.aprobadas} aprobadas, ${resultado.revision} en revisión y ${resultado.rechazadas} rechazadas. Total procesable ${money(resultado.totalFacturado)}; IVA ${money(resultado.ivaTotal)}.`, detalle, nota: /pdf|adjunt|archivo/i.test(message) ? 'No se ha recibido el contenido del PDF. La extracción automática de archivos requiere conectar un nodo extractor en n8n.' : undefined };
  }
}

export class AgenteDatos extends AgenteBase {
  constructor() { super('datos', 'Consulta el lote activo y sus estados sin modificar los datos de entrada.'); }
  puedeManejar(message) { return /cuánto|cuantos|cuántos|estado|estatus|proveedor|buscar|registro|datos|\b[A-Z0-9]+(?:-[A-Z0-9]+)+\b/i.test(message); }
  async ejecutar({ message = '', invoices = sampleInvoices } = {}) {
    const report = procesarLote(invoices);
    const requestedId = report.resultados.find((item) => new RegExp(`\\b${String(item.id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(message))?.id;
    const invoice = requestedId ? report.resultados.find((item) => item.id === requestedId) : null;
    if (requestedId) return invoice ? { tipo: 'consulta', factura: invoice } : { tipo: 'consulta', mensaje: `No se encontró ${requestedId} en el lote actual.` };
    return { tipo: 'resumen_datos', cantidad: report.cantidad, aprobadas: report.aprobadas, revision: report.revision, rechazadas: report.rechazadas, totalFacturado: report.totalFacturado, ivaTotal: report.ivaTotal, facturas: report.resultados.map(({ id, proveedor, estado, total }) => ({ id, proveedor, estado, total })) };
  }
}

export class AgenteReportes extends AgenteBase {
  constructor() { super('reportes', 'Prepara un resumen verificable, KPIs y observaciones del lote.'); }
  puedeManejar(message) { return /reporte|resumen|estadíst|estadist|kpi|auditor|anomal|rechazad/i.test(message); }
  async ejecutar({ invoices = sampleInvoices } = {}) {
    const report = procesarLote(invoices);
    const errores = report.resultados.filter((f) => f.estado === 'rechazada').map((f) => ({ id: f.id, motivos: f.errores }));
    const facturasRevision = report.resultados.filter((invoice) => invoice.estado === 'revision');
    const hallazgos = [];
    hallazgos.push(facturasRevision.length
      ? `${facturasRevision.length} factura(s) requieren revisión humana: ${facturasRevision.map((invoice) => invoice.id).join(', ')}.`
      : 'No hay facturas en estado de revisión en este lote.');
    hallazgos.push(errores.length
      ? `${errores.length} factura(s) fueron rechazadas y deben corregirse antes de procesarlas nuevamente.`
      : 'No hay facturas rechazadas en este lote.');
    hallazgos.push('Los totales se calcularon con las reglas deterministas de FacturaBot; verifica las reglas tributarias antes de uso fiscal.');
    return {
      titulo: 'Reporte de control de facturas',
      lote: { cantidad: report.cantidad, aprobadas: report.aprobadas, revision: report.revision, rechazadas: report.rechazadas },
      finanzas: { totalFacturadoCRC: report.totalFacturado, ivaCRC: report.ivaTotal },
      porcentajeRechazo: report.cantidad ? Math.round(report.rechazadas / report.cantidad * 1000) / 10 : 0,
      hallazgos,
      errores,
    };
  }
}

export class AgenteCorreo extends AgenteBase {
  constructor() { super('correo', 'Redacta borradores de correo; no envía mensajes.'); }
  puedeManejar(message) { return /correo|email|e-mail|redact|mensaje|notificar/i.test(message); }
  async ejecutar({ message = '', invoices = sampleInvoices } = {}) {
    const report = procesarLote(invoices);
    const invoice = report.resultados.find((item) => new RegExp(`\\b${String(item.id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(message));
    const target = invoice?.id || 'la factura pendiente de corrección';
    return {
      tipo: 'borrador_correo',
      enviado: false,
      destinatario: '[Agregar correo del proveedor]',
      asunto: `Solicitud de revisión documental - ${target}`,
      cuerpo: `Estimado proveedor:\n\nDurante la revisión administrativa de ${target}${invoice ? ` (${invoice.proveedor})` : ''}, identificamos información que requiere verificación${(invoice?.motivo || invoice?.errores?.join(' ')) ? `: ${invoice.motivo || invoice.errores.join(' ')}` : ''}.\n\nPor favor, comparta la documentación corregida para continuar el proceso.\n\nSaludos cordiales,\nDepartamento de Administración`,
      advertencia: 'Es un borrador. No se ha enviado ningún correo y debe revisarse antes de usarlo.',
    };
  }
}

export class AgenteArchivos extends AgenteBase {
  constructor() { super('archivos', 'Estructura texto de documentos aportado por el usuario; no afirma leer adjuntos inaccesibles.'); }
  puedeManejar(message) { return /pdf|documento|archivo|extraer|organizar texto|texto de la factura/i.test(message); }
  async ejecutar({ message = '' } = {}) {
    return {
      tipo: 'asistencia_documental',
      estado: 'requiere_texto',
      mensaje: 'Pega aquí el texto del documento o conecta un extractor de PDF al workflow de n8n. Esta versión no afirma haber leído archivos que no recibió.',
      textoUsuario: message.slice(0, 1200),
      camposSugeridos: ['número de factura', 'proveedor', 'cédula jurídica', 'fecha', 'moneda', 'tipo de cambio', 'líneas', 'subtotal', 'impuesto', 'total'],
    };
  }
}
