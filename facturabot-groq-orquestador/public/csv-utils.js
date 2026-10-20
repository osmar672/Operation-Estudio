// Utilidades de importación CSV compartidas entre la interfaz y las pruebas Node.
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  const source = String(text || '').replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell); cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(cell); cell = '';
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
    } else cell += char;
  }
  if (quoted) throw new Error('El archivo CSV tiene una comilla sin cerrar.');
  if (cell.length || row.length) { row.push(cell); if (row.some((value) => value.trim() !== '')) rows.push(row); }
  return rows;
}
function normalizeHeader(value) {
  return String(value || '').trim().toLocaleLowerCase('es-CR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}
function numericCell(value, name, { optional = false } = {}) {
  let cleaned = String(value ?? '').trim().replace(/[₡$\s]/g, '');
  if (!cleaned && optional) return null;
  if (!cleaned) throw new Error(`Falta el campo numérico “${name}”.`);
  if (cleaned.includes(',') && cleaned.includes('.')) {
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    else cleaned = cleaned.replace(/,/g, '');
  }
  else if (cleaned.includes(',')) {
    const decimals = cleaned.split(',').at(-1).length;
    cleaned = decimals > 0 && decimals <= 2 ? cleaned.replace(',', '.') : cleaned.replace(/,/g, '');
  }
  const number = Number(cleaned);
  if (!Number.isFinite(number)) throw new Error(`El campo “${name}” debe ser numérico.`);
  return number;
}
export function csvToInvoices(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('El CSV debe tener una cabecera y al menos una fila de datos.');
  if (rows.length > 501) throw new Error('El archivo supera el máximo de 500 filas de detalle.');
  const headers = rows[0].map(normalizeHeader);
  const aliases = {
    id: ['id', 'factura', 'numerofactura', 'invoice', 'invoiceid'],
    tipo: ['tipo', 'type', 'tipofactura'],
    proveedor: ['proveedor', 'supplier', 'nombreproveedor'],
    cedulaJuridica: ['cedulajuridica', 'cedula', 'identificacion', 'identificacionproveedor', 'taxid'],
    fecha: ['fecha', 'date', 'fechafactura'],
    moneda: ['moneda', 'currency'],
    tipoCambio: ['tipocambio', 'exchangerate'],
    porcentajeIVA: ['porcentajeiva', 'tasaiva', 'ivatasa'],
    descripcion: ['descripcion', 'articulo', 'detalle', 'description'],
    cantidad: ['cantidad', 'quantity', 'qty'],
    precioUnitario: ['preciounitario', 'precio', 'unitprice', 'price'],
  };
  const indexes = {};
  for (const [field, options] of Object.entries(aliases)) indexes[field] = headers.findIndex((header) => options.includes(header));
  const required = ['id', 'tipo', 'proveedor', 'cedulaJuridica', 'fecha', 'descripcion', 'cantidad', 'precioUnitario'];
  const missing = required.filter((field) => indexes[field] < 0);
  if (missing.length) throw new Error(`Faltan columnas obligatorias: ${missing.join(', ')}. Usa la plantilla CSV de FacturaBot.`);
  const records = rows.slice(1).map((values, index) => {
    const read = (field) => indexes[field] < 0 ? '' : String(values[indexes[field]] ?? '').trim();
    const id = read('id');
    const tipo = read('tipo').toLocaleLowerCase('es-CR');
    const proveedor = read('proveedor');
    const cedulaJuridica = read('cedulaJuridica');
    const fecha = read('fecha');
    if (!id || !tipo || !proveedor || !cedulaJuridica || !fecha) throw new Error(`La fila ${index + 2} tiene campos obligatorios vacíos.`);
    const moneda = read('moneda') || (tipo === 'extranjera' ? 'USD' : 'CRC');
    const tipoCambio = read('tipoCambio') ? numericCell(read('tipoCambio'), 'tipoCambio') : null;
    const porcentajeIVA = read('porcentajeIVA') ? numericCell(read('porcentajeIVA'), 'porcentajeIVA') : undefined;
    const descripcion = read('descripcion');
    const cantidad = numericCell(read('cantidad'), 'cantidad');
    const precioUnitario = numericCell(read('precioUnitario'), 'precioUnitario');
    return { id, tipo, proveedor, cedulaJuridica, fecha, moneda, tipoCambio, ...(porcentajeIVA == null ? {} : { porcentajeIVA }), linea: { descripcion, cantidad, precioUnitario }, row: index + 2 };
  });
  const byId = new Map();
  for (const record of records) {
    if (!byId.has(record.id)) {
      const { linea, row, ...invoice } = record;
      invoice.lineas = [linea];
      byId.set(record.id, invoice);
    } else {
      const existing = byId.get(record.id);
      const metadataMatches = ['tipo', 'proveedor', 'cedulaJuridica', 'fecha', 'moneda', 'tipoCambio', 'porcentajeIVA'].every((key) => existing[key] === record[key]);
      if (!metadataMatches) throw new Error(`La factura ${record.id} tiene datos generales distintos en la fila ${record.row}.`);
      existing.lineas.push(record.linea);
    }
  }
  const invoices = [...byId.values()];
  if (invoices.length > 100) throw new Error('El archivo contiene más de 100 facturas distintas.');
  return invoices;
}
