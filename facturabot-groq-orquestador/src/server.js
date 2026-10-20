import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
const env = process.env;
import { GroqClient } from './services/groq-client.js';
import { Orquestador } from './services/orchestrator.js';
import { procesarLote } from './domain/invoices.js';
import { sampleInvoices } from './data/sample-invoices.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

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
      json(res, 200, { ok: true, app: 'FacturaBot', version: '1.2.0', groqConfigured: llm.configured, model: llm.model, agents: orchestrator.listarAgentes().map((agent) => agent.nombre), dataPersistence: 'session-memory' });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/invoices') {
      json(res, 200, procesarLote(sampleInvoices));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/process') {
      if (!rateLimit(req, res, { limit: 30, bucket: 'process' })) return;
      const body = await readBody(req);
      const invoices = body.invoices ?? sampleInvoices;
      if (!Array.isArray(invoices) || invoices.length > 100) {
        json(res, 400, { error: 'Envía una lista de hasta 100 facturas.' }); return;
      }
      const sessionId = normalizedSessionId(body.sessionId);
      rememberBatch(sessionId, invoices);
      json(res, 200, procesarLote(invoices));
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

server.listen(PORT, HOST, () => {
  console.log(`FacturaBot disponible en http://${HOST}:${PORT}`);
  console.log(`Groq: ${llm.configured ? `configurado (${llm.model})` : 'sin clave: modo local de demostración'}`);
  console.log('Para producción: configura autenticación, HTTPS, persistencia y monitoreo antes de exponerlo a Internet.');
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
