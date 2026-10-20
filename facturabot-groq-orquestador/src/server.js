import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile, rename } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
const env = process.env;
import { GroqClient } from './services/groq-client.js';
import { Orquestador } from './services/orchestrator.js';
import { procesarLote, FabricaFacturas } from './domain/invoices.js';
import { sampleInvoices } from './data/sample-invoices.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const STORAGE_DIR = path.join(ROOT, 'storage');
const USER_INVOICES_FILE = path.join(STORAGE_DIR, 'user-invoices.json');

function loadEnvFile() {
  const file = path.join(ROOT, '.env');
  if (!existsSync(file)) return;
  const text = readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!Object.hasOwn(env, key)) env[key] = value;
  }
}
loadEnvFile();

const PORT = Number(env.PORT || 3000);
const HOST = env.HOST || '127.0.0.1';
const llm = new GroqClient();
const orchestrator = new Orquestador({ llm });
const rateWindows = new Map();
const sessionBatches = new Map();
let userInvoices = [];

async function loadUserInvoices() {
  try {
    const content = await readFile(USER_INVOICES_FILE, 'utf8');
    const parsed = JSON.parse(content);
    userInvoices = Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object') : [];
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('[FacturaBot] No se pudieron cargar las facturas guardadas:', error.message);
    userInvoices = [];
  }
}

async function persistUserInvoices(invoices) {
  await mkdir(STORAGE_DIR, { recursive: true });
  const temporaryFile = `${USER_INVOICES_FILE}.tmp`;
  await writeFile(temporaryFile, JSON.stringify(invoices, null, 2), { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryFile, USER_INVOICES_FILE);
}

function currentRawInvoices() { return [...sampleInvoices, ...userInvoices]; }
function currentReport() {
  const report = procesarLote(currentRawInvoices());
  report.facturasRegistradas = userInvoices.length;
  return report;
}

function normalizedSessionId(value) {
  return String(value || 'local').slice(0, 80).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function rememberBatch(sessionId, invoices) {
  if (!sessionBatches.has(sessionId) && sessionBatches.size >= 100) {
    sessionBatches.delete(sessionBatches.keys().next().value);
  }
  sessionBatches.set(sessionId, invoices);
}
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };

function headers(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  res.setHeader('Cache-Control', 'no-store');
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function readBody(req, maxBytes = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('El cuerpo de la solicitud es demasiado grande.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw Object.assign(new Error('El cuerpo debe ser JSON válido.'), { statusCode: 400 }); }
}

function rateLimit(req, res, { limit = 60, bucket = 'api' } = {}) {
  const ip = req.socket.remoteAddress || 'local';
  const key = `${ip}:${bucket}`;
  const now = Date.now();
  const previous = rateWindows.get(key) || [];
  const recent = previous.filter((stamp) => now - stamp < 60_000);
  if (recent.length >= limit) {
    json(res, 429, { error: 'Demasiadas solicitudes. Espera un minuto e inténtalo otra vez.' });
    return false;
  }
  recent.push(now);
  rateWindows.set(key, recent);
  if (rateWindows.size > 500) {
    for (const [ip, stamps] of rateWindows) if (!stamps.some((stamp) => now - stamp < 60_000)) rateWindows.delete(ip);
  }
  return true;
}

async function staticFile(urlPath, res) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch { json(res, 400, { error: 'Ruta inválida.' }); return; }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const target = path.resolve(PUBLIC_DIR, relative);
  if (!(target === PUBLIC_DIR || target.startsWith(PUBLIC_DIR + path.sep))) {
    json(res, 403, { error: 'Acceso denegado.' }); return;
  }
  try {
    const info = await stat(target);
    if (!info.isFile()) { json(res, 404, { error: 'No encontrado.' }); return; }
    const content = await readFile(target);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] || 'application/octet-stream' });
    res.end(content);
  } catch {
    json(res, 404, { error: 'No encontrado.' });
  }
}

const server = createServer(async (req, res) => {
  headers(res);
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      json(res, 200, { ok: true, app: 'FacturaBot', version: '1.9.0', groqConfigured: llm.configured, model: llm.model, agents: orchestrator.listarAgentes().map((agent) => agent.nombre), dataPersistence: 'local-json+session-memory' });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/invoices') {
      const sessionId = url.searchParams.get('sessionId');
      if (sessionId) rememberBatch(normalizedSessionId(sessionId), currentRawInvoices());
      json(res, 200, currentReport());
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/invoices') {
      if (!rateLimit(req, res, { limit: 30, bucket: 'invoice-create' })) return;
      const body = await readBody(req, 100_000);
      const raw = body.invoice && typeof body.invoice === 'object' ? body.invoice : body;
      const id = String(raw.id ?? '').trim();
      const proveedor = String(raw.proveedor ?? '').trim();
      const cedulaJuridica = String(raw.cedulaJuridica ?? '').trim();
      const fecha = String(raw.fecha ?? '').trim();
      const tipo = String(raw.tipo ?? '').trim().toLowerCase();
      if (!id || id.length > 60 || !proveedor || proveedor.length > 200 || !cedulaJuridica || cedulaJuridica.length > 30 || !fecha) {
        json(res, 400, { error: 'Completa número, proveedor, cédula jurídica y fecha. Revisa también la longitud de los campos.' }); return;
      }
      if (!FabricaFacturas.tiposDisponibles().includes(tipo)) {
        json(res, 400, { error: 'Selecciona un tipo de factura disponible.' }); return;
      }
      if ([...sampleInvoices, ...userInvoices].some((item) => String(item.id).toLocaleLowerCase('es-CR') === id.toLocaleLowerCase('es-CR'))) {
        json(res, 409, { error: `Ya existe una factura con el número ${id}. Usa un número único.` }); return;
      }
      const rawLines = Array.isArray(raw.lineas) ? raw.lineas : [];
      if (!rawLines.length || rawLines.length > 50) {
        json(res, 400, { error: 'La factura debe incluir entre 1 y 50 líneas de producto o servicio.' }); return;
      }
      const lineas = [];
      for (const line of rawLines) {
        const descripcion = String(line?.descripcion ?? '').trim();
        const cantidad = Number(line?.cantidad);
        const precioUnitario = Number(line?.precioUnitario);
        if (!descripcion || descripcion.length > 250 || !Number.isFinite(cantidad) || cantidad <= 0 || !Number.isFinite(precioUnitario) || precioUnitario < 0) {
          json(res, 400, { error: 'Cada línea necesita descripción, cantidad mayor que cero y precio unitario no negativo.' }); return;
        }
        lineas.push({ descripcion, cantidad, precioUnitario });
      }
      const esExtranjera = tipo === 'extranjera';
      const moneda = esExtranjera ? String(raw.moneda || 'USD').trim().toUpperCase() : 'CRC';
      const tipoCambio = esExtranjera ? Number(raw.tipoCambio) : null;
      if (esExtranjera && (!moneda || moneda === 'CRC' || !Number.isFinite(tipoCambio) || tipoCambio <= 0)) {
        json(res, 400, { error: 'Para una factura extranjera, indica una moneda distinta de CRC y un tipo de cambio positivo.' }); return;
      }
      const porcentajeIVA = ['nacional', 'reducida'].includes(tipo) ? Number(raw.porcentajeIVA ?? (tipo === 'reducida' ? 0.04 : 0.13)) : undefined;
      if (porcentajeIVA !== undefined && (!Number.isFinite(porcentajeIVA) || porcentajeIVA < 0 || porcentajeIVA > 1)) {
        json(res, 400, { error: 'La tarifa IVA debe enviarse como decimal entre 0 y 1 (por ejemplo, 0.13 para 13%).' }); return;
      }
      const invoice = { id, tipo, proveedor, cedulaJuridica, fecha, moneda, tipoCambio, lineas };
      if (porcentajeIVA !== undefined) invoice.porcentajeIVA = porcentajeIVA;
      const updated = [...userInvoices, invoice];
      await persistUserInvoices(updated);
      userInvoices = updated;
      const sessionId = normalizedSessionId(body.sessionId);
      rememberBatch(sessionId, currentRawInvoices());
      const report = currentReport();
      const savedResult = report.resultados.find((item) => item.id === id);
      json(res, 201, { ok: true, factura: savedResult, report });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/process') {
      if (!rateLimit(req, res, { limit: 30, bucket: 'process' })) return;
      const body = await readBody(req);
      const invoices = body.invoices ?? currentRawInvoices();
      if (!Array.isArray(invoices) || invoices.length > 150) {
        json(res, 400, { error: 'Envía una lista de hasta 150 facturas.' }); return;
      }
      const sessionId = normalizedSessionId(body.sessionId);
      rememberBatch(sessionId, invoices);
      const report = procesarLote(invoices);
      if (!body.invoices) report.facturasRegistradas = userInvoices.length;
      json(res, 200, report);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/assistant') {
      if (!rateLimit(req, res, { limit: 15, bucket: 'assistant' })) return;
      const body = await readBody(req, 100_000);
      const message = String(body.message || '').trim();
      const sessionId = normalizedSessionId(body.sessionId);
      if (!message) { json(res, 400, { error: 'Escribe una pregunta.' }); return; }
      if (message.length > 2000) { json(res, 413, { error: 'La pregunta supera el límite de 2000 caracteres.' }); return; }
      json(res, 200, await orchestrator.procesar(message, { sessionId, invoices: sessionBatches.get(sessionId) }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/assistant/reset') {
      if (!rateLimit(req, res, { limit: 15, bucket: 'assistant-reset' })) return;
      const body = await readBody(req, 10_000);
      const sessionId = normalizedSessionId(body.sessionId);
      orchestrator.limpiarMemoria(sessionId);
      json(res, 200, { ok: true });
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/')) {
      json(res, 404, { error: 'Endpoint no encontrado.' }); return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      json(res, 405, { error: 'Método no permitido.' }); return;
    }
    await staticFile(url.pathname, res);
  } catch (error) {
    if (!res.headersSent) json(res, error.statusCode || 500, { error: error.statusCode ? error.message : 'Ocurrió un error interno. Inténtalo nuevamente.' });
    else res.end();
    if (error.statusCode !== 400 && error.statusCode !== 413) console.error(`[FacturaBot] ${req.method} ${url.pathname}:`, error.message);
  }
});

await loadUserInvoices();

server.listen(PORT, HOST, () => {
  console.log(`Facturas nuevas guardadas: ${userInvoices.length}`);
  console.log(`FacturaBot disponible en http://${HOST}:${PORT}`);
  console.log(`Groq: ${llm.configured ? `configurado (${llm.model})` : 'sin clave: modo local de demostración'}`);
  console.log('Para producción: configura autenticación, HTTPS, persistencia y monitoreo antes de exponerlo a Internet.');
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
