import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const workflowsDir = new URL('../n8n/', import.meta.url);
const workflowFiles = (await readdir(workflowsDir)).filter((file) => file.endsWith('.json') && file !== 'manifest.json');
const workflows = new Map();
for (const file of workflowFiles) {
  workflows.set(file, JSON.parse(await readFile(new URL(file, workflowsDir), 'utf8')));
}

test('el directorio n8n conserva los dos workflows separados y el SUPER unificado', () => {
  assert.ok(workflows.has('FacturaBot_Procesamiento_POO.json'));
  assert.ok(workflows.has('FacturaBot_Orquestador_Groq.json'));
  assert.ok(workflows.has('FacturaBot_SUPER_Workflow_Groq.json'));
  const superFlow = workflows.get('FacturaBot_SUPER_Workflow_Groq.json');
  assert.equal(superFlow.nodes.length, 19);
  const nodeTypes = new Set(superFlow.nodes.map((node) => node.type));
  assert.ok(nodeTypes.has('@n8n/n8n-nodes-langchain.agent'));
  assert.ok(nodeTypes.has('@n8n/n8n-nodes-langchain.lmChatGroq'));
  assert.ok(nodeTypes.has('n8n-nodes-base.manualTrigger'));
  assert.ok(nodeTypes.has('n8n-nodes-base.switch'));
  assert.ok(nodeTypes.has('n8n-nodes-base.merge'));
});

test('cada workflow tiene IDs únicos y todas sus conexiones apuntan a nodos existentes', () => {
  for (const [file, workflow] of workflows) {
    const ids = workflow.nodes.map((node) => node.id);
    assert.equal(new Set(ids).size, ids.length, `${file}: IDs duplicados`);
    const names = new Set(workflow.nodes.map((node) => node.name));
    for (const [source, outputs] of Object.entries(workflow.connections || {})) {
      assert.ok(names.has(source), `${file}: origen inexistente ${source}`);
      for (const branches of Object.values(outputs)) {
        for (const branch of branches) {
          for (const edge of branch) assert.ok(names.has(edge.node), `${file}: destino inexistente ${edge.node}`);
        }
      }
    }
  }
});

test('el manifiesto identifica como primera opción el workflow unificado', async () => {
  const manifest = JSON.parse(await readFile(new URL('../n8n/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.version, '1.2.0');
  assert.equal(manifest.workflows[0].file, 'FacturaBot_SUPER_Workflow_Groq.json');
});


test('el servidor expone la creación de facturas y persistencia local', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.match(source, /req\.method === 'POST' && url\.pathname === '\/api\/invoices'/);
  assert.match(source, /persistUserInvoices/);
  assert.match(source, /Ya existe una factura/);
  assert.match(source, /currentRawInvoices/);
});
