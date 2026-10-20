import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/mondragon-theme.css', import.meta.url), 'utf8');

test('el dashboard incluye los tres gráficos y todos los destinos del renderizador', () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  for (const id of ['invoice-amount-chart', 'chart-amount-total', 'chart-amount-count', 'status-donut', 'status-donut-count', 'status-donut-legend', 'chart-tax-total', 'tax-type-chart', 'summary-base', 'summary-iva', 'summary-approval', 'summary-limit']) {
    assert.ok(ids.has(id), `Falta el destino HTML #${id}`);
  }
  assert.match(html, /href="\/mondragon-theme\.css"/);
  assert.match(js, /function renderAnalytics\(report\)/);
  assert.match(js, /data-chart-invoice/);
});

test('la hoja visual tiene modo oscuro, diseño responsive y movimiento reducido', () => {
  assert.match(css, /:root\[data-theme="dark"\]/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /@media \(max-width: 540px\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /--chart-approved/);
  assert.match(css, /:root, :root\[data-theme=\"light\"\]/);
  assert.doesNotMatch(js, /style=\"width:/);
  assert.match(css, /\.status-donut/);
});

test('el renderizador usa los datos del lote sin crear una serie mensual artificial', () => {
  assert.match(js, /const invoices = state\.allInvoices/);
  assert.match(js, /invoice\.impuesto/);
  assert.match(js, /report\.totalFacturado/);
  assert.doesNotMatch(js, /syntheticMonthlyData|fakeRevenueSeries/i);
});


test('el menú lateral permite contraer y expandir desde su cabecera y conserva la preferencia', () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  assert.ok(ids.has('sidebar-toggle'), 'Debe existir el botón de contraer');
  assert.match(html, /class="sidebar-header"/);
  assert.match(html, /aria-controls="sidebar"/);
  assert.match(html, /title="Facturas"/);
  assert.match(js, /SIDEBAR_PREFERENCE_KEY = 'facturabot-sidebar-collapsed'/);
  assert.match(js, /setSidebarCollapsed\(!document\.body\.classList\.contains\('sidebar-collapsed'\)\)/);
  assert.match(js, /aria-expanded/);
  assert.match(css, /body\.sidebar-collapsed/);
  assert.match(css, /@media \(max-width: 760px\)/);
});


test('el formulario de nueva factura está conectado a un endpoint de registro persistente', () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  for (const id of ['new-invoice-button', 'invoice-create-dialog', 'invoice-create-form', 'new-invoice-id', 'new-invoice-provider', 'new-invoice-cedula', 'new-invoice-date', 'new-invoice-type', 'new-invoice-description', 'new-invoice-quantity', 'new-invoice-price', 'save-new-invoice']) {
    assert.ok(ids.has(id), `Falta el control de registro #${id}`);
  }
  assert.match(js, /api\('\/api\/invoices'/);
  assert.match(js, /function saveNewInvoice/);
  assert.match(js, /syncInvoiceTypeFields/);
  assert.match(css, /invoice-form-grid/);
});
