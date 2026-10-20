import test from 'node:test';
import assert from 'node:assert/strict';
import { Factura, FacturaNacional, FacturaExenta, FacturaExtranjera, FacturaTarifaReducida, FabricaFacturas, ValidadorFactura, procesarLote } from '../src/domain/invoices.js';
import { sampleInvoices } from '../src/data/sample-invoices.js';

test('la clase base Factura impide instanciación directa', () => {
  assert.throws(() => new Factura({}), /abstracta/i);
});

test('la fábrica crea subclases concretas usando el polimorfismo', () => {
  assert.ok(FabricaFacturas.crear(sampleInvoices[0]) instanceof FacturaNacional);
  assert.ok(FabricaFacturas.crear(sampleInvoices[1]) instanceof FacturaExenta);
  assert.ok(FabricaFacturas.crear(sampleInvoices[2]) instanceof FacturaExtranjera);
  assert.ok(FabricaFacturas.crear({ ...sampleInvoices[0], tipo: 'reducida' }) instanceof FacturaTarifaReducida);
  assert.throws(() => FabricaFacturas.crear({ tipo: 'credito' }), /desconocido/i);
});

test('encapsulamiento: el getter de líneas entrega una copia', () => {
  const factura = FabricaFacturas.crear(sampleInvoices[0]);
  const lineas = factura.lineas;
  lineas.pop();
  assert.equal(factura.lineas.length, 1);
});

test('la factura nacional calcula 13% y la exenta no calcula impuesto', () => {
  assert.equal(FabricaFacturas.crear(sampleInvoices[0]).calcularImpuesto(), 6500);
  assert.equal(FabricaFacturas.crear(sampleInvoices[1]).calcularImpuesto(), 0);
  assert.equal(FabricaFacturas.crear(sampleInvoices[2]).total(), 1275000);
});

test('el lote mantiene los resultados de referencia del documento', () => {
  const report = procesarLote(sampleInvoices);
  assert.equal(report.cantidad, 7);
  assert.equal(report.aprobadas, 2);
  assert.equal(report.revision, 2);
  assert.equal(report.rechazadas, 3);
  assert.equal(report.totalFacturado, 2611500);
  assert.equal(report.ivaTotal, 136500);
  assert.equal(report.resultados.find((invoice) => invoice.id === 'F-004').estado, 'rechazada');
  assert.equal(report.resultados.find((invoice) => invoice.id === 'F-006').estado, 'rechazada');
  assert.equal(report.resultados.find((invoice) => invoice.id === 'F-007').estado, 'rechazada');
});

test('el umbral de revisión es configurable', () => {
  const report = procesarLote(sampleInvoices.slice(0, 1), { limiteRevision: 50000 });
  assert.equal(report.revision, 1);
  assert.equal(report.resultados[0].limiteRevision, 50000);
});

test('el validador rechaza fecha futura y documentos sin líneas', () => {
  const validador = new ValidadorFactura();
  const result = validador.validar(FabricaFacturas.crear(sampleInvoices[6]));
  assert.equal(result.valida, false);
  assert.ok(result.errores.some((error) => /futuro/i.test(error)));
  const noLines = FabricaFacturas.crear({ ...sampleInvoices[0], lineas: [] });
  assert.ok(validador.validar(noLines).errores.some((error) => /líneas/i.test(error)));
});


test('el validador bloquea una tarifa IVA fuera del rango', () => {
  const factura = FabricaFacturas.crear({ ...sampleInvoices[0], porcentajeIVA: 3 });
  const result = new ValidadorFactura().validar(factura);
  assert.ok(result.errores.some((error) => /tarifa de IVA/i.test(error)));
});

test('el límite de revisión no admite valores negativos', () => {
  assert.throws(() => new ValidadorFactura({ limiteRevision: -1 }), /no negativo/i);
});


test('la serialización conserva la tarifa de IVA configurable para CSV y reportes', () => {
  const reduced = FabricaFacturas.crear({
    id: 'TASA-001', tipo: 'reducida', proveedor: 'Proveedor de prueba', cedulaJuridica: '3-101-123456',
    fecha: '2025-01-15', moneda: 'CRC', porcentajeIVA: 0.02,
    lineas: [{ descripcion: 'Producto', cantidad: 1, precioUnitario: 1000 }],
  });
  assert.equal(reduced.toJSON().porcentajeIVA, 0.02);
  assert.equal(reduced.toJSON().impuesto, 20);
});
