import test from 'node:test';
import assert from 'node:assert/strict';
import { csvToInvoices, parseCsv } from '../public/csv-utils.js';

const header = 'id,tipo,proveedor,cedulaJuridica,fecha,moneda,tipoCambio,porcentajeIVA,descripcion,cantidad,precioUnitario';

test('el lector CSV respeta comas y comillas dentro de campos', () => {
  const rows = parseCsv(`${header}\nDEMO-001,nacional,"Proveedor, S.A.",3-101-123456,2026-10-20,CRC,,0.13,"Servicio ""Premium""",1,1500`);
  assert.equal(rows.length, 2);
  assert.equal(rows[1][2], 'Proveedor, S.A.');
  assert.equal(rows[1][8], 'Servicio "Premium"');
});

test('la importación agrupa líneas y lee importes con formato numérico costarricense', () => {
  const csv = `${header}\r\nDEMO-001,nacional,"Proveedor, S.A.",3-101-123456,2026-10-20,CRC,,0.13,Primera línea,2,"1.500,00"\r\nDEMO-001,nacional,"Proveedor, S.A.",3-101-123456,2026-10-20,CRC,,0.13,Segunda línea,1,"2.500,50"`;
  const invoices = csvToInvoices(csv);
  assert.equal(invoices.length, 1);
  assert.equal(invoices[0].proveedor, 'Proveedor, S.A.');
  assert.equal(invoices[0].lineas.length, 2);
  assert.equal(invoices[0].lineas[0].precioUnitario, 1500);
  assert.equal(invoices[0].lineas[1].precioUnitario, 2500.5);
});

test('el importador valida cabeceras y comillas incompletas', () => {
  assert.throws(() => csvToInvoices('id,tipo\n1,nacional'), /columnas obligatorias/i);
  assert.throws(() => parseCsv(`${header}\n"DEMO-001,nacional`), /comilla sin cerrar/i);
});

test('el mismo número de factura no puede tener datos generales inconsistentes entre filas', () => {
  const csv = `${header}\nDEMO-001,nacional,Proveedor A,3-101-123456,2026-10-20,CRC,,0.13,Línea A,1,100\nDEMO-001,nacional,Proveedor B,3-101-123456,2026-10-20,CRC,,0.13,Línea B,1,200`;
  assert.throws(() => csvToInvoices(csv), /datos generales distintos/i);
});
