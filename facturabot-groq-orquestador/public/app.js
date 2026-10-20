import { csvToInvoices } from './csv-utils.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = {
  report: null,
  allInvoices: [],
  visibleInvoices: [],
  activeInvoices: null,
  activities: [],
  sessionId: `session-${cryptoRandomId()}`,
  toastTimer: null,
  busy: false,
  theme: 'dark',
};

function cryptoRandomId() {
  try { return crypto.randomUUID().replaceAll('-', '').slice(0, 12); }
  catch { return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`; }
}
const currency = (amount) => amount == null || !Number.isFinite(Number(amount))
  ? '—'
  : `₡${Number(amount).toLocaleString('es-CR', { maximumFractionDigits: 2 })}`;
const percent = (part, total) => total ? `${Math.round((part / total) * 100)}%` : '0%';
const statusText = { aprobada: 'Aprobada', revision: 'En revisión', rechazada: 'Rechazada' };
const statusClass = { aprobada: 'status-approved', revision: 'status-review', rechazada: 'status-rejected' };
const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove('visible'), 3400);
}
function costaRicaISODate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function updateClock() {
  const now = new Date();
  $('#today-label').textContent = now.toLocaleDateString('es-CR', { day: '2-digit', month: 'short', year: 'numeric' });
  $('#weekday-label').textContent = now.toLocaleDateString('es-CR', { weekday: 'long' }).toLocaleUpperCase('es-CR');
}
function setUpdatedTime() {
  $('#last-updated').textContent = `Actualizado ${new Date().toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' })}`;
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}
function animateNumber(element, target, formatter = (value) => String(Math.round(value))) {
  const end = Number(target) || 0;
  const startValue = Number(element.dataset.numericValue || 0);
  element.dataset.numericValue = String(end);
  if (prefersReducedMotion() || startValue === end) {
    element.textContent = formatter(end);
    return;
  }
  const startTime = performance.now();
  const duration = 550;
  const frame = (now) => {
    const progress = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = formatter(startValue + (end - startValue) * eased);
    if (progress < 1) requestAnimationFrame(frame);
    else element.textContent = formatter(end);
  };
  requestAnimationFrame(frame);
}
function addActivity(title, detail, icon = '✓') {
  state.activities.unshift({ title, detail, icon, time: new Date().toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' }) });
  state.activities = state.activities.slice(0, 12);
  renderActivity();
}
function renderActivity() {
  $('#activity-count').textContent = `${state.activities.length} ${state.activities.length === 1 ? 'evento' : 'eventos'}`;
  $('#activity-list').innerHTML = state.activities.length
    ? state.activities.map((event) => `<div class="activity-item"><span class="activity-marker">${escapeHtml(event.icon)}</span><div class="activity-description"><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.detail)}</small></div><span class="activity-time">${escapeHtml(event.time)}</span></div>`).join('')
    : '<div class="activity-empty"><span class="activity-empty-icon">⌁</span><span>Aquí aparecerán las acciones que ejecutes.</span></div>';
}
function renderInvoices() {
  const search = $('#invoice-search').value.trim().toLocaleLowerCase('es-CR');
  const filter = $('#status-filter').value;
  const list = state.allInvoices.filter((invoice) => {
    const searchable = `${invoice.id} ${invoice.proveedor} ${invoice.tipo} ${invoice.estado} ${invoice.motivo || ''} ${(invoice.errores || []).join(' ')}`.toLocaleLowerCase('es-CR');
    return searchable.includes(search) && (filter === 'todos' || invoice.estado === filter);
  });
  state.visibleInvoices = list;
  const tbody = $('#invoice-table');
  tbody.innerHTML = list.length ? list.map((invoice) => `<tr>
    <td><span class="invoice-id"><span class="invoice-icon">▤</span>${escapeHtml(invoice.id)}</span></td>
    <td><span class="provider-name" title="${escapeHtml(invoice.proveedor)}">${escapeHtml(invoice.proveedor || '—')}</span></td>
    <td><span class="type-cell">${escapeHtml(invoice.tipo || '—')}</span></td>
    <td class="money-cell">${currency(invoice.total)}</td>
    <td><span class="status-badge ${statusClass[invoice.estado] || ''}">${escapeHtml(statusText[invoice.estado] || invoice.estado || 'Desconocido')}</span></td>
    <td><button class="detail-button" type="button" data-detail="${escapeHtml(invoice.id)}" aria-label="Ver detalle de ${escapeHtml(invoice.id)}">Detalle ↗</button></td>
    </tr>`).join('') : '<tr><td colspan="6" class="empty-row">No hay facturas que coincidan con la búsqueda o el filtro.</td></tr>';
  $('#table-count').textContent = `Mostrando ${list.length} de ${state.allInvoices.length} ${state.allInvoices.length === 1 ? 'factura' : 'facturas'}`;
  $('#nav-count').textContent = String(state.allInvoices.length);
}
function renderAnalytics(report) {
  const invoices = state.allInvoices;
  const amountChart = $('#invoice-amount-chart');
  const validAmounts = invoices.filter((invoice) => invoice.total != null && Number.isFinite(Number(invoice.total)));
  const maxAmount = Math.max(1, ...validAmounts.map((invoice) => Number(invoice.total) || 0));

  $('#chart-amount-total').textContent = currency(report.totalFacturado);
  $('#chart-amount-count').textContent = `${report.cantidad} ${report.cantidad === 1 ? 'documento' : 'documentos'}`;

  amountChart.innerHTML = invoices.length ? invoices.map((invoice) => {
    const amount = invoice.total == null || !Number.isFinite(Number(invoice.total)) ? null : Number(invoice.total);
    const width = amount == null ? 0 : Math.max(amount > 0 ? 2 : 0, amount / maxAmount * 100);
    const tone = invoice.estado === 'aprobada' ? 'approved' : invoice.estado === 'revision' ? 'review' : 'rejected';
    const provider = invoice.proveedor || 'Proveedor sin nombre';
    return `<button class="amount-chart-row" type="button" data-chart-invoice="${escapeHtml(invoice.id)}" title="Abrir ${escapeHtml(invoice.id)} · ${escapeHtml(provider)}">
      <span class="chart-invoice-label"><strong>${escapeHtml(invoice.id || 'Sin ID')}</strong><small>${escapeHtml(provider)}</small></span>
      <svg class="chart-track" viewBox="0 0 100 9" preserveAspectRatio="none" aria-hidden="true"><rect class="chart-track-bg" x="0" y="0" width="100" height="9" rx="4.5"></rect><rect class="chart-fill fill-${tone}" x="0" y="0" width="${width}" height="9" rx="4.5"></rect></svg>
      <span class="chart-value">${amount == null ? '—' : currency(amount)}</span>
    </button>`;
  }).join('') : '<div class="chart-empty-state">No hay facturas disponibles para graficar.</div>';
  const totalCount = Number(report.cantidad) || 0;
  const approved = Number(report.aprobadas) || 0;
  const review = Number(report.revision) || 0;
  const rejected = Number(report.rechazadas) || 0;
  const safeCount = Math.max(totalCount, 1);
  const approvedPercent = approved / safeCount * 100;
  const reviewPercent = review / safeCount * 100;
  const rejectedPercent = rejected / safeCount * 100;
  const donut = $('#status-donut');
  const circumference = 2 * Math.PI * 46;
  let segmentOffset = 0;
  [
    ['approved', approvedPercent],
    ['review', reviewPercent],
    ['rejected', rejectedPercent],
  ].forEach(([name, pct]) => {
    const segment = donut.querySelector(`[data-donut-segment="${name}"]`);
    const length = circumference * pct / 100;
    segment.setAttribute('stroke-dasharray', `${length} ${circumference}`);
    segment.setAttribute('stroke-dashoffset', String(-segmentOffset));
    segmentOffset += length;
  });
  donut.setAttribute('aria-label', `Distribución de ${totalCount} facturas: ${approved} aprobadas, ${review} en revisión y ${rejected} rechazadas.`);
  $('#status-donut-count').textContent = String(totalCount);
  $('#status-donut-legend').innerHTML = [
    ['Aprobadas', approved, approvedPercent, 'approved'],
    ['En revisión', review, reviewPercent, 'review'],
    ['Rechazadas', rejected, rejectedPercent, 'rejected'],
  ].map(([label, count, pct, tone]) => `<div class="donut-legend-item"><span class="donut-legend-label"><i class="donut-legend-dot ${tone}"></i>${label}</span><strong>${count}</strong><small>${Math.round(pct)}%</small></div>`).join('');

  const typeLabels = { nacional: 'Nacional', exenta: 'Exenta', extranjera: 'Extranjera', reducida: 'Tarifa reducida' };
  const taxByType = new Map();
  invoices.filter((invoice) => invoice.estado !== 'rechazada' && invoice.impuesto != null && Number.isFinite(Number(invoice.impuesto))).forEach((invoice) => {
    const type = String(invoice.tipo || 'otro').toLocaleLowerCase('es-CR');
    const entry = taxByType.get(type) || { amount: 0, count: 0 };
    entry.amount += Number(invoice.impuesto) || 0;
    entry.count += 1;
    taxByType.set(type, entry);
  });
  const taxRows = [...taxByType.entries()].sort((a, b) => b[1].amount - a[1].amount);
  const maxTax = Math.max(1, ...taxRows.map(([, item]) => item.amount));
  $('#chart-tax-total').textContent = currency(report.ivaTotal);
  $('#tax-type-chart').innerHTML = taxRows.length ? taxRows.map(([type, item]) => {
    const label = typeLabels[type] || type.replaceAll('_', ' ').replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase('es-CR'));
    const width = item.amount > 0 ? Math.max(2, item.amount / maxTax * 100) : 0;
    const tone = type === 'exenta' ? 'tax-exempt' : type === 'extranjera' ? 'tax-foreign' : type === 'reducida' ? 'tax-reduced' : 'tax-national';
    return `<div class="tax-type-row" title="${escapeHtml(label)} · ${item.count} ${item.count === 1 ? 'factura' : 'facturas'}">
      <div class="tax-type-meta"><span>${escapeHtml(label)}</span><strong>${currency(item.amount)}</strong></div>
      <svg class="chart-track tax-track" viewBox="0 0 100 9" preserveAspectRatio="none" aria-hidden="true"><rect class="chart-track-bg" x="0" y="0" width="100" height="9" rx="4.5"></rect><rect class="tax-fill ${tone}" x="0" y="0" width="${width}" height="9" rx="4.5"></rect></svg>
    </div>`;
  }).join('') : '<div class="chart-empty-state">No hay impuestos calculados en este lote.</div>';
  $('#summary-base').textContent = currency(report.totalFacturado);
  $('#summary-iva').textContent = currency(report.ivaTotal);
  $('#summary-approval').textContent = percent(approved, totalCount);
  $('#summary-limit').textContent = currency(report.montoLimiteRevisionCRC);
}

function renderReport(report) {
  state.report = report;
  state.allInvoices = Array.isArray(report.resultados) ? report.resultados : [];
  animateNumber($('#metric-total'), report.totalFacturado, (value) => currency(value));
  animateNumber($('#metric-approved'), report.aprobadas);
  animateNumber($('#metric-review'), report.revision);
  animateNumber($('#metric-rejected'), report.rechazadas);
  $('#approved-share').textContent = percent(report.aprobadas, report.cantidad);
  $('#rejected-share').textContent = percent(report.rechazadas, report.cantidad);
  renderAnalytics(report);
  $('#table-source').textContent = state.activeInvoices ? 'CSV importado · Memoria de esta sesión' : 'Lote de demostración · Solo lectura';
  $('#process-button').querySelector('span:nth-child(2)').textContent = state.activeInvoices ? 'Procesar lote importado' : 'Procesar lote';
  renderInvoices();
  renderImportHint();
  setUpdatedTime();
}
async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
      signal: options.signal || AbortSignal.timeout(35000),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new Error('La solicitud tardó demasiado. Inténtalo de nuevo.');
    throw new Error('No se pudo conectar con FacturaBot. Comprueba que el servidor esté iniciado.');
  }
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) throw new Error(data.error || `Error HTTP ${response.status}`);
  return data;
}
async function loadHealth() {
  try {
    const health = await api('/api/health');
    $('#connection-indicator').classList.add('online');
    $('#connection-title').textContent = 'Servidor conectado';
    $('#connection-detail').textContent = `API local · v${health.version || '1.0'}`;
    $('#groq-description').textContent = health.groqConfigured ? health.model : 'Clave no configurada';
    $('#groq-status').textContent = health.groqConfigured ? 'Configurado' : 'Modo local';
    $('#model-chip').lastElementChild.textContent = health.groqConfigured ? `Groq · ${health.model}` : 'Modo local disponible';
    $('#model-chip').classList.toggle('is-groq', Boolean(health.groqConfigured));
    $('#chat-mode-text').textContent = health.groqConfigured ? `Groq configurado · ${health.model}` : 'Respuestas locales activas';
    $('#agent-count').textContent = `${health.agents?.length || 5} agentes`;
    $('#system-status').classList.add('is-ok');
    $('#system-status').innerHTML = '<span></span> Operativo';
  } catch (error) {
    $('#connection-indicator').classList.remove('online');
    $('#connection-title').textContent = 'API no disponible';
    $('#connection-detail').textContent = 'Inicia el servidor Node';
    $('#groq-description').textContent = 'No se pudo consultar';
    $('#groq-status').textContent = 'Sin conexión';
    $('#chat-mode-text').textContent = 'Esperando al servidor';
    $('#system-status').classList.remove('is-ok');
    $('#system-status').innerHTML = '<span></span> Sin conexión';
    showToast(error.message);
  }
}
async function loadInvoices() {
  try {
    const report = state.activeInvoices
      ? await api('/api/process', { method: 'POST', body: JSON.stringify({ invoices: state.activeInvoices, sessionId: state.sessionId }) })
      : await api('/api/invoices');
    renderReport(report);
  } catch (error) {
    $('#invoice-table').innerHTML = `<tr><td colspan="6" class="empty-row">${escapeHtml(error.message)}</td></tr>`;
    showToast(error.message);
  }
}
async function processBatch() {
  if (state.busy) return;
  const button = $('#process-button');
  state.busy = true;
  button.disabled = true;
  button.classList.add('is-loading');
  button.querySelector('.button-icon').textContent = '↻';
  button.querySelector('span:nth-child(2)').textContent = 'Procesando…';
  try {
    const payload = { sessionId: state.sessionId };
    if (state.activeInvoices) payload.invoices = state.activeInvoices;
    const report = await api('/api/process', { method: 'POST', body: JSON.stringify(payload) });
    renderReport(report);
    addActivity(state.activeInvoices ? 'Lote importado procesado' : 'Lote de demostración procesado', `${report.cantidad} facturas · ${report.aprobadas} aprobadas · ${report.revision} en revisión · ${report.rechazadas} rechazadas.`, '✓');
    showToast(`Lote procesado: ${report.aprobadas} aprobadas, ${report.revision} en revisión y ${report.rechazadas} rechazadas.`);
  } catch (error) {
    showToast(error.message);
  } finally {
    state.busy = false;
    button.disabled = false;
    button.classList.remove('is-loading');
    button.querySelector('.button-icon').textContent = '▶';
    button.querySelector('span:nth-child(2)').textContent = state.activeInvoices ? 'Procesar lote importado' : 'Procesar lote';
  }
}
function addMessage(role, content, meta = '', { typing = false } = {}) {
  const row = document.createElement('div');
  row.className = `message-row ${role}`;
  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = role === 'assistant' ? 'F' : 'T';
  if (role === 'assistant') {
    const spark = document.createElement('span'); spark.textContent = '✦'; avatar.append(spark);
  }
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  if (meta) {
    const label = document.createElement('div');
    label.className = 'message-label';
    label.textContent = meta;
    bubble.append(label);
  }
  if (typing) {
    const text = document.createElement('p'); text.textContent = content; bubble.append(text);
    const indicator = document.createElement('span'); indicator.className = 'typing-indicator'; indicator.setAttribute('aria-label', 'Procesando respuesta');
    indicator.innerHTML = '<i></i><i></i><i></i>'; bubble.append(indicator);
  } else {
    const paragraph = document.createElement('p');
    paragraph.textContent = content;
    bubble.append(paragraph);
  }
  if (role === 'assistant' && meta && !typing) {
    const actions = document.createElement('div'); actions.className = 'message-actions';
    const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'copy-answer'; copy.textContent = 'Copiar respuesta';
    copy.addEventListener('click', async () => {
      try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(content);
        else {
          const field = document.createElement('textarea'); field.value = content; field.style.position = 'fixed'; field.style.opacity = '0'; document.body.append(field); field.select(); document.execCommand('copy'); field.remove();
        }
        showToast('Respuesta copiada al portapapeles.');
      } catch { showToast('No se pudo copiar la respuesta en este navegador.'); }
    });
    actions.append(copy); bubble.append(actions);
  }
  row.append(avatar, bubble);
  $('#chat-messages').append(row);
  const messages = $('#chat-messages');
  messages.scrollTo({ top: messages.scrollHeight, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  return row;
}
async function sendChat(message) {
  const trimmed = String(message || '').trim();
  if (!trimmed || state.busy) return;
  if (trimmed.length > 2000) { showToast('La consulta supera el límite de 2000 caracteres.'); return; }
  addMessage('user', trimmed);
  $('#chat-input').value = '';
  $('#send-button').disabled = true;
  state.busy = true;
  const pending = addMessage('assistant', 'El orquestador está analizando tu solicitud', '', { typing: true });
  try {
    const response = await api('/api/assistant', { method: 'POST', body: JSON.stringify({ message: trimmed, sessionId: state.sessionId }) });
    pending.remove();
    const meta = `${response.agent || 'asistente'} · ${response.aiMode === 'groq' ? 'Groq' : 'modo local'}`;
    addMessage('assistant', response.answer, meta);
    if (response.warning) showToast(response.warning);
    addActivity(`Agente ${response.agent || 'asistente'} ejecutado`, trimmed.slice(0, 110), response.aiMode === 'groq' ? '✳' : '◇');
    $('#chat-mode-text').textContent = response.aiMode === 'groq' ? 'Respuesta generada con Groq' : 'Respuesta con herramientas locales';
    if (response.agent === 'facturas' && response.result?.resultados) renderReport(response.result);
  } catch (error) {
    pending.remove();
    addMessage('assistant', error.message || 'No se pudo procesar la solicitud.', 'Error');
  } finally {
    state.busy = false;
    $('#send-button').disabled = false;
    $('#chat-input').focus();
  }
}
function downloadText(filename, content, type = 'text/csv;charset=utf-8;') {
  const blob = new Blob(['\uFEFF', content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
const csvHeaders = ['id', 'tipo', 'proveedor', 'cedulaJuridica', 'fecha', 'moneda', 'tipoCambio', 'porcentajeIVA', 'descripcion', 'cantidad', 'precioUnitario'];
function exportCurrentCsv() {
  if (!state.visibleInvoices.length) { showToast('No hay facturas visibles para exportar.'); return; }
  const rows = [csvHeaders.join(',')];
  for (const invoice of state.visibleInvoices) {
    const lines = Array.isArray(invoice.lineas) && invoice.lineas.length ? invoice.lineas : [{ descripcion: '', cantidad: '', precioUnitario: '' }];
    for (const line of lines) {
      const record = {
        id: invoice.id, tipo: invoice.tipo, proveedor: invoice.proveedor, cedulaJuridica: invoice.cedulaJuridica,
        fecha: invoice.fecha, moneda: invoice.moneda, tipoCambio: invoice.tipoCambio,
        porcentajeIVA: invoice.porcentajeIVA, descripcion: line.descripcion, cantidad: line.cantidad, precioUnitario: line.precioUnitario,
      };
      rows.push(csvHeaders.map((header) => csvCell(record[header])).join(','));
    }
  }
  downloadText(`facturabot-${new Date().toISOString().slice(0, 10)}.csv`, rows.join('\r\n'));
  addActivity('Exportación CSV creada', `${state.visibleInvoices.length} facturas exportadas desde la vista actual.`, '↓');
  showToast('CSV exportado. Recuerda que contiene datos demostrativos o del lote en memoria.');
}
function downloadTemplate() {
  const sample = [
    csvHeaders,
    ['DEMO-001', 'nacional', 'Proveedor Ejemplo', '3-101-123456', costaRicaISODate(), 'CRC', '', '0.13', 'Material de oficina', '2', '12500'],
    ['DEMO-002', 'exenta', 'Servicios de Ejemplo', '3-101-234567', costaRicaISODate(), 'CRC', '', '', 'Servicio profesional exento', '1', '45000'],
  ].map((row) => row.map(csvCell).join(','));
  downloadText('plantilla-facturabot.csv', sample.join('\r\n'));
  showToast('Plantilla CSV descargada. Sustituye los datos por registros de prueba.');
}
function renderImportHint() {
  const hint = $('#import-hint');
  if (state.activeInvoices) {
    hint.hidden = false;
    hint.innerHTML = `<span>✓ Lote importado: <strong>${state.activeInvoices.length} facturas</strong>. Se conserva solo en la memoria de esta sesión y también se usará al consultar el agente.</span><button type="button" class="template-download" id="reset-demo">Volver a la demo</button>`;
  } else {
    hint.hidden = true;
    hint.innerHTML = '';
  }
}
function statusPill(status) {
  return `<span class="status-badge ${statusClass[status] || ''}">${escapeHtml(statusText[status] || status || 'Desconocido')}</span>`;
}
function openInvoiceDetail(invoiceId) {
  const invoice = state.allInvoices.find((item) => item.id === invoiceId);
  if (!invoice) return;
  const lines = Array.isArray(invoice.lineas) ? invoice.lineas : [];
  const detail = $('#invoice-detail-content');
  detail.innerHTML = `<div class="detail-hero"><div><div class="detail-id">${escapeHtml(invoice.id)}</div><div class="detail-provider">${escapeHtml(invoice.proveedor || 'Proveedor no indicado')}</div>${statusPill(invoice.estado)}</div><div><div class="detail-total-label">TOTAL REGISTRADO</div><div class="detail-total">${currency(invoice.total)}</div></div></div>
    <div class="detail-grid"><div class="detail-field"><span>Tipo de factura</span><strong>${escapeHtml(invoice.tipo || '—')}</strong></div><div class="detail-field"><span>Fecha</span><strong>${escapeHtml(invoice.fecha || '—')}</strong></div><div class="detail-field"><span>Subtotal</span><strong>${currency(invoice.subtotal)}</strong></div><div class="detail-field"><span>IVA / impuesto</span><strong>${currency(invoice.impuesto)}</strong></div><div class="detail-field"><span>Moneda de origen</span><strong>${escapeHtml(invoice.moneda || 'CRC')}</strong></div><div class="detail-field"><span>Tipo de cambio</span><strong>${invoice.tipoCambio == null ? 'No aplica' : escapeHtml(invoice.tipoCambio)}</strong></div></div>
    ${lines.length ? `<div class="detail-section-title">Líneas de factura</div><div class="detail-lines">${lines.map((line) => `<div class="detail-line"><span>${escapeHtml(line.descripcion || 'Línea sin descripción')}<br><span class="type-cell">${escapeHtml(line.cantidad ?? '—')} × ${currency(line.precioUnitario)}</span></span><strong>${currency(line.subtotal ?? (Number(line.cantidad) * Number(line.precioUnitario)))}</strong></div>`).join('')}</div>` : ''}
    <div class="detail-section-title">Validación y observaciones</div><div class="detail-note ${invoice.estado === 'aprobada' ? 'is-ok' : ''}"><strong>${invoice.estado === 'aprobada' ? 'Validación correcta' : invoice.estado === 'revision' ? 'Requiere revisión humana' : 'Factura rechazada'}</strong>${escapeHtml(invoice.motivo || (invoice.errores || []).join(' ') || 'No se reportan errores de validación.')}</div>`;
  $('#dialog-title').textContent = `Factura ${invoice.id}`;
  const dialog = $('#invoice-dialog');
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}
function closeInvoiceDialog() {
  const dialog = $('#invoice-dialog');
  if (typeof dialog.close === 'function' && dialog.open) dialog.close();
  else dialog.removeAttribute('open');
}
function setTheme(theme) {
  state.theme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = state.theme;
  $('#theme-button').textContent = state.theme === 'dark' ? '☼' : '☾';
  $('#theme-button').setAttribute('aria-label', state.theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro');
  $('#theme-button').title = state.theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro';
  $('meta[name="theme-color"]').setAttribute('content', state.theme === 'dark' ? '#11111b' : '#f5f5fb');
  try { localStorage.setItem('facturabot-theme-v2', state.theme); } catch { /* el tema sigue activo durante esta vista */ }
}
function openMobileMenu() {
  $('#sidebar').classList.add('is-open');
  $('#sidebar-backdrop').classList.add('is-visible');
  $('#menu-button').setAttribute('aria-expanded', 'true');
}
function closeMobileMenu() {
  $('#sidebar').classList.remove('is-open');
  $('#sidebar-backdrop').classList.remove('is-visible');
  $('#menu-button').setAttribute('aria-expanded', 'false');
}

$('#chat-form').addEventListener('submit', (event) => { event.preventDefault(); sendChat($('#chat-input').value); });
$('#process-button').addEventListener('click', processBatch);
$('#refresh-button').addEventListener('click', async () => {
  const button = $('#refresh-button'); button.classList.add('is-refreshing'); button.disabled = true;
  try { await Promise.all([loadHealth(), loadInvoices()]); showToast('Datos actualizados desde el motor de demostración.'); }
  finally { button.classList.remove('is-refreshing'); button.disabled = false; }
});
$('#invoice-search').addEventListener('input', renderInvoices);
$('#status-filter').addEventListener('change', renderInvoices);
$('#view-all').addEventListener('click', () => { $('#invoice-search').value = ''; $('#status-filter').value = 'todos'; renderInvoices(); $('#facturas').scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' }); });
$('#invoice-table').addEventListener('click', (event) => {
  const button = event.target.closest('[data-detail]');
  if (button) openInvoiceDetail(button.dataset.detail);
});
$('#invoice-amount-chart').addEventListener('click', (event) => {
  const button = event.target.closest('[data-chart-invoice]');
  if (button) openInvoiceDetail(button.dataset.chartInvoice);
});
$$('[data-prompt]').forEach((button) => button.addEventListener('click', () => sendChat(button.dataset.prompt)));
$$('[data-nav]').forEach((link) => link.addEventListener('click', () => {
  $$('[data-nav]').forEach((item) => item.classList.toggle('active', item === link));
  const target = link.dataset.nav;
  $('#current-section').textContent = ({ inicio: 'Resumen', facturas: 'Facturas', asistente: 'Agente IA', actividad: 'Actividad' })[target] || 'Resumen';
  document.getElementById(target)?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  closeMobileMenu();
}));
$('#clear-chat').addEventListener('click', async () => {
  if (state.busy) { showToast('Espera a que termine la solicitud actual.'); return; }
  try { await api('/api/assistant/reset', { method: 'POST', body: JSON.stringify({ sessionId: state.sessionId }) }); }
  catch { /* la limpieza visual sigue disponible */ }
  $('#chat-messages').innerHTML = '';
  addMessage('assistant', 'Conversación reiniciada. Puedo ayudarte a revisar el lote actual, incluido el CSV importado.');
  $('#chat-mode-text').textContent = 'Conversación reiniciada';
  showToast('Conversación reiniciada. El lote en memoria se conserva.');
});
$('#theme-button').addEventListener('click', () => setTheme(state.theme === 'dark' ? 'light' : 'dark'));
$('#menu-button').addEventListener('click', () => $('#sidebar').classList.contains('is-open') ? closeMobileMenu() : openMobileMenu());
const sidebarToggle = $('#sidebar-toggle');
const SIDEBAR_PREFERENCE_KEY = 'facturabot-sidebar-collapsed';
function setSidebarCollapsed(collapsed, { savePreference = true } = {}) {
  const isCollapsed = Boolean(collapsed);
  document.body.classList.toggle('sidebar-collapsed', isCollapsed);
  sidebarToggle.setAttribute('aria-expanded', String(!isCollapsed));
  sidebarToggle.setAttribute('aria-pressed', String(isCollapsed));
  sidebarToggle.setAttribute('aria-label', isCollapsed ? 'Expandir menú lateral' : 'Contraer menú lateral');
  sidebarToggle.title = isCollapsed ? 'Expandir menú lateral' : 'Contraer menú lateral';
  const icon = $('.sidebar-toggle-icon', sidebarToggle);
  if (icon) icon.textContent = isCollapsed ? '›' : '‹';
  $('#sidebar').setAttribute('aria-label', isCollapsed ? 'Menú principal contraído; usa los iconos para navegar' : 'Menú principal');
  if (savePreference) {
    try { localStorage.setItem(SIDEBAR_PREFERENCE_KEY, String(isCollapsed)); }
    catch { /* La preferencia sigue aplicada durante esta sesión si el navegador bloquea localStorage. */ }
  }
}
sidebarToggle.addEventListener('click', () => {
  setSidebarCollapsed(!document.body.classList.contains('sidebar-collapsed'));
});
let initialSidebarCollapsed = false;
try { initialSidebarCollapsed = localStorage.getItem(SIDEBAR_PREFERENCE_KEY) === 'true'; }
catch { /* Los navegadores privados pueden bloquear localStorage. */ }
setSidebarCollapsed(initialSidebarCollapsed, { savePreference: false });
$('#sidebar-backdrop').addEventListener('click', closeMobileMenu);
$('#import-button').addEventListener('click', () => {
  if (!state.activeInvoices) {
    const hint = $('#import-hint');
    hint.hidden = false;
    hint.innerHTML = '<span>CSV compatible: id, tipo, proveedor, cedulaJuridica, fecha, moneda, tipoCambio, porcentajeIVA, descripcion, cantidad y precioUnitario. Usa números sin símbolos.</span><button type="button" class="template-download" id="download-template">Descargar plantilla ↗</button>';
  }
  $('#csv-file').click();
});
$('#template-button').addEventListener('click', downloadTemplate);
$('#csv-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 512 * 1024) { showToast('El CSV supera el límite de 512 KB.'); event.target.value = ''; return; }
  const importButton = $('#import-button'); importButton.disabled = true; importButton.innerHTML = '<span>↻</span> Leyendo…';
  if (state.busy) { showToast('Espera a que termine la operación actual.'); event.target.value = ''; importButton.disabled = false; importButton.innerHTML = '<span>↑</span> Importar CSV'; return; }
  state.busy = true;
  try {
    const invoices = csvToInvoices(await file.text());
    const report = await api('/api/process', { method: 'POST', body: JSON.stringify({ invoices, sessionId: state.sessionId }) });
    state.activeInvoices = invoices;
    renderReport(report);
    addActivity('Lote CSV importado', `${file.name} · ${invoices.length} facturas únicas procesadas.`, '↑');
    showToast(`Se importaron ${invoices.length} facturas. Este lote queda en memoria, no en una base de datos.`);
  } catch (error) { showToast(error.message || 'No se pudo importar el CSV.'); }
  finally { state.busy = false; importButton.disabled = false; importButton.innerHTML = '<span>↑</span> Importar CSV'; event.target.value = ''; }
});
$('#export-button').addEventListener('click', exportCurrentCsv);
$('#invoice-dialog').addEventListener('click', (event) => { if (event.target === $('#invoice-dialog')) closeInvoiceDialog(); });
$('#close-dialog').addEventListener('click', closeInvoiceDialog);
$('#dialog-close-bottom').addEventListener('click', closeInvoiceDialog);
$('#import-hint').addEventListener('click', async (event) => {
  const template = event.target.closest('#download-template');
  if (template) { downloadTemplate(); return; }
  const reset = event.target.closest('#reset-demo');
  if (!reset) return;
  if (state.busy) { showToast('Espera a que termine la solicitud actual.'); return; }
  const previousBatch = state.activeInvoices;
  try {
    const report = await api('/api/process', { method: 'POST', body: JSON.stringify({ sessionId: state.sessionId }) });
    state.activeInvoices = null;
    renderReport(report);
    addActivity('Lote de demostración restaurado', 'Se volvió a cargar el conjunto original de siete facturas.', '↻');
    showToast('Lote de demostración restaurado.');
  } catch (error) { state.activeInvoices = previousBatch; renderImportHint(); showToast(error.message); }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeMobileMenu();
  if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault(); $('#invoice-search').focus();
  }
});

try { setTheme(localStorage.getItem('facturabot-theme-v2') || 'light'); }
catch { setTheme('light'); }
updateClock();
Promise.all([loadHealth(), loadInvoices()]).then(() => {
  addActivity('Panel iniciado', 'Estado del servidor y lote de facturas consultados.', '✓');
});
