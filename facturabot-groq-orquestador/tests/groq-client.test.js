import test from 'node:test';
import assert from 'node:assert/strict';
import { GroqClient } from '../src/services/groq-client.js';

test('Groq utiliza el endpoint compatible con Chat Completions y el modelo configurable', async (t) => {
  let request;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ choices: [{ message: { content: 'respuesta de prueba' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  const client = new GroqClient({ apiKey: 'clave-de-prueba', model: 'openai/gpt-oss-120b' });
  const result = await client.chat([{ role: 'user', content: 'hola' }], { jsonMode: true });
  assert.equal(result, 'respuesta de prueba');
  assert.equal(request.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(request.options.headers.Authorization, 'Bearer clave-de-prueba');
  assert.equal(request.body.model, 'openai/gpt-oss-120b');
  assert.deepEqual(request.body.response_format, { type: 'json_object' });
});

test('el cliente Groq no intenta una petición si no hay clave', async () => {
  const client = new GroqClient({ apiKey: '' });
  await assert.rejects(() => client.chat([{ role: 'user', content: 'hola' }]), /GROQ_NOT_CONFIGURED/);
});

test('Groq convierte errores HTTP en códigos seguros para el usuario', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: { message: 'secret provider detail' } }), { status: 401 }));
  const client = new GroqClient({ apiKey: 'clave-de-prueba' });
  await assert.rejects(() => client.chat([{ role: 'user', content: 'hola' }]), (error) => error.message === 'GROQ_AUTH_ERROR' && !error.message.includes('secret'));
});
