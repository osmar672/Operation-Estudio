import test from 'node:test';
import assert from 'node:assert/strict';
import { GroqClient } from '../src/services/groq-client.js';
import { Orquestador, MemoriaConversacion } from '../src/services/orchestrator.js';

test('el orquestador tiene los cinco agentes del diseño', () => {
  const orchestrator = new Orquestador({ llm: new GroqClient({ apiKey: '' }) });
  assert.deepEqual(orchestrator.listarAgentes().map((agent) => agent.nombre), ['facturas', 'datos', 'reportes', 'correo', 'archivos']);
});

test('modo local enrutado a reportes responde con datos verificados', async () => {
  const orchestrator = new Orquestador({ llm: new GroqClient({ apiKey: '' }) });
  const result = await orchestrator.procesar('Haz un reporte con un resumen de las facturas', { sessionId: 'test-1' });
  assert.equal(result.agent, 'reportes');
  assert.equal(result.aiMode, 'local');
  assert.match(result.answer, /2 aprobadas/);
  assert.equal(result.result.finanzas.ivaCRC, 136500);
});

test('el agente de correo solo redacta y nunca declara enviar', async () => {
  const orchestrator = new Orquestador({ llm: new GroqClient({ apiKey: '' }) });
  const result = await orchestrator.procesar('Redacta un correo para corregir F-004', { sessionId: 'test-mail' });
  assert.equal(result.agent, 'correo');
  assert.equal(result.result.enviado, false);
  assert.match(result.answer, /No se ha enviado/i);
});

test('la memoria limita la cantidad de mensajes almacenados', () => {
  const memory = new MemoriaConversacion({ maxMessages: 2, maxSessions: 1 });
  memory.add('a', { role: 'user', content: '1' }, { role: 'assistant', content: '2' }, { role: 'user', content: '3' });
  assert.deepEqual(memory.get('a').map((entry) => entry.content), ['2', '3']);
  memory.add('b', { role: 'user', content: 'otro' });
  assert.equal(memory.get('a').length, 0);
});

test('la entrada vacía o demasiado larga se rechaza', async () => {
  const orchestrator = new Orquestador({ llm: new GroqClient({ apiKey: '' }) });
  await assert.rejects(() => orchestrator.procesar('  '), /solicitud/i);
  await assert.rejects(() => orchestrator.procesar('a'.repeat(2001)), /2000/);
});

test('el orquestador utiliza el lote importado por el usuario en vez de los datos de ejemplo', async () => {
  const orchestrator = new Orquestador({ llm: new GroqClient({ apiKey: '' }) });
  const customInvoices = [{
    id: 'DEMO-001', tipo: 'nacional', proveedor: 'Proveedor de prueba', cedulaJuridica: '3-101-123456',
    fecha: '2025-01-15', moneda: 'CRC',
    lineas: [{ descripcion: 'Servicio de prueba', cantidad: 1, precioUnitario: 1000 }],
  }];
  const summary = await orchestrator.procesar('Genera un reporte de este lote', { sessionId: 'custom-batch', invoices: customInvoices });
  assert.equal(summary.result.lote.cantidad, 1);
  assert.equal(summary.result.lote.aprobadas, 1);
  assert.equal(summary.result.finanzas.totalFacturadoCRC, 1130);
  assert.equal(summary.result.finanzas.ivaCRC, 130);

  const detail = await orchestrator.procesar('¿Qué estado tiene DEMO-001?', { sessionId: 'custom-batch', invoices: customInvoices });
  assert.equal(detail.agent, 'datos');
  assert.equal(detail.result.factura.id, 'DEMO-001');
  assert.equal(detail.result.factura.estado, 'aprobada');
});

test('el modo local reconoce consultas generales sin enviarlas a un especialista financiero', async () => {
  const orchestrator = new Orquestador({ llm: { configured: false } });
  const response = await orchestrator.procesar('Hola, ¿me puedes ayudar a programar?');
  assert.equal(response.agent, 'general');
  assert.match(response.answer, /Groq|cálculos|explicaciones/i);
});

test('la calculadora local resuelve operaciones aritméticas sencillas sin eval', async () => {
  const orchestrator = new Orquestador({ llm: { configured: false } });
  const response = await orchestrator.procesar('¿Cuánto es 12 * (3 + 2)?');
  assert.equal(response.agent, 'general');
  assert.match(response.answer, /60/);
});


test('una pregunta conceptual sobre IVA se explica y no procesa el lote local', async () => {
  const orchestrator = new Orquestador({ llm: { configured: false } });
  const response = await orchestrator.procesar('Explícame qué es el IVA');
  assert.equal(response.agent, 'general');
  assert.match(response.answer, /Impuesto al Valor Agregado/i);
  assert.match(response.answer, /impuesto indirecto/i);
  assert.equal(response.result, null);
  assert.doesNotMatch(response.answer, /Procesé 7 facturas/i);
});

test('las preguntas educativas van al modelo general sin pasar por el clasificador ambiguo', async () => {
  let classifyCalls = 0;
  let generalCalls = 0;
  const llm = {
    configured: true,
    async classify() { classifyCalls += 1; throw new Error('No debería clasificar una pregunta conceptual'); },
    async answerGeneral(message) { generalCalls += 1; return `Explicación directa de: ${message}`; },
  };
  const orchestrator = new Orquestador({ llm });
  const response = await orchestrator.procesar('¿Qué significa crédito fiscal?');
  assert.equal(response.agent, 'general');
  assert.match(response.answer, /Explicación directa/);
  assert.equal(classifyCalls, 0);
  assert.equal(generalCalls, 1);
});

test('una consulta operativa por ID de factura sigue llegando al especialista de datos', async () => {
  const orchestrator = new Orquestador({ llm: { configured: false } });
  const response = await orchestrator.procesar('Explícame por qué F-004 fue rechazada');
  assert.equal(response.agent, 'datos');
  assert.match(response.answer, /F-004/i);
});
