const asMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export class LineaFactura {
  #descripcion;
  #cantidad;
  #precioUnitario;

  constructor({ descripcion, cantidad, precioUnitario }) {
    this.#descripcion = String(descripcion ?? '').trim();
    this.#cantidad = Number(cantidad);
    this.#precioUnitario = Number(precioUnitario);
  }

  get descripcion() { return this.#descripcion; }
  get cantidad() { return this.#cantidad; }
  get precioUnitario() { return this.#precioUnitario; }
  subtotal() { return asMoney(this.#cantidad * this.#precioUnitario); }
  toJSON() {
    return {
      descripcion: this.#descripcion,
      cantidad: this.#cantidad,
      precioUnitario: this.#precioUnitario,
      subtotal: this.subtotal(),
    };
  }
}

export class Factura {
  #lineas;

  constructor(datos = {}) {
    if (new.target === Factura) {
      throw new TypeError('Factura es una clase base abstracta; usa una subclase concreta.');
    }
    this.id = String(datos.id ?? '').trim();
    this.proveedor = String(datos.proveedor ?? '').trim();
    this.cedulaJuridica = String(datos.cedulaJuridica ?? '').trim();
    this.fecha = String(datos.fecha ?? '').trim();
    this.moneda = String(datos.moneda ?? 'CRC').trim().toUpperCase();
    this.tipoCambio = datos.tipoCambio == null ? null : Number(datos.tipoCambio);
    this.#lineas = Array.isArray(datos.lineas)
      ? datos.lineas.map((linea) => linea instanceof LineaFactura ? linea : new LineaFactura(linea))
      : [];
  }

  get lineas() { return this.#lineas.map((linea) => new LineaFactura(linea.toJSON())); }
  subtotal() { return asMoney(this.#lineas.reduce((sum, linea) => sum + linea.subtotal(), 0)); }
  calcularImpuesto() {
    throw new Error('Las subclases concretas deben implementar calcularImpuesto().');
  }
  total() { return asMoney(this.subtotal() + this.calcularImpuesto()); }
  toJSON() {
    const impuesto = this.calcularImpuesto();
    return {
      id: this.id,
      tipo: this.constructor.tipoFactura,
      proveedor: this.proveedor,
      cedulaJuridica: this.cedulaJuridica,
      fecha: this.fecha,
      moneda: this.moneda,
      tipoCambio: this.tipoCambio,
      lineas: this.#lineas.map((linea) => linea.toJSON()),
      subtotal: this.subtotal(),
      impuesto,
      total: this.total(),
    };
  }
}

export class FacturaNacional extends Factura {
  static tipoFactura = 'nacional';
  constructor(datos = {}) {
    super({ ...datos, moneda: datos.moneda ?? 'CRC' });
    this.porcentajeIVA = Number(datos.porcentajeIVA ?? 0.13);
  }
  calcularImpuesto() { return asMoney(this.subtotal() * this.porcentajeIVA); }
  toJSON() { return { ...super.toJSON(), porcentajeIVA: this.porcentajeIVA }; }
}

export class FacturaExenta extends Factura {
  static tipoFactura = 'exenta';
  constructor(datos = {}) { super({ ...datos, moneda: datos.moneda ?? 'CRC' }); }
  calcularImpuesto() { return 0; }
}

export class FacturaExtranjera extends Factura {
  static tipoFactura = 'extranjera';
  constructor(datos = {}) { super(datos); }
  calcularImpuesto() { return 0; }
  total() { return asMoney(this.subtotal() * this.tipoCambio); }
  toJSON() {
    return { ...super.toJSON(), total: this.total(), totalMonedaOrigen: this.subtotal(), moneda: this.moneda };
  }
}

// Reto extra del documento: nueva subclase con tarifa configurable.
export class FacturaTarifaReducida extends Factura {
  static tipoFactura = 'reducida';
  constructor(datos = {}) {
    super({ ...datos, moneda: datos.moneda ?? 'CRC' });
    this.porcentajeIVA = Number(datos.porcentajeIVA ?? 0.04);
  }
  calcularImpuesto() { return asMoney(this.subtotal() * this.porcentajeIVA); }
  toJSON() { return { ...super.toJSON(), porcentajeIVA: this.porcentajeIVA }; }
}

export class FabricaFacturas {
  static #tipos = new Map([
    ['nacional', FacturaNacional],
    ['exenta', FacturaExenta],
    ['extranjera', FacturaExtranjera],
    ['reducida', FacturaTarifaReducida],
  ]);

  static registrarTipo(tipo, claseFactura) {
    if (typeof tipo !== 'string' || !tipo.trim() || typeof claseFactura !== 'function') {
      throw new TypeError('Debe proporcionar un tipo y una clase de factura válida.');
    }
    if (!(claseFactura.prototype instanceof Factura)) {
      throw new TypeError('La clase registrada debe extender Factura.');
    }
    this.#tipos.set(tipo.trim().toLowerCase(), claseFactura);
  }

  static crear(datos) {
    const tipo = String(datos?.tipo ?? '').trim().toLowerCase();
    const ClaseFactura = this.#tipos.get(tipo);
    if (!ClaseFactura) throw new Error(`Tipo de factura desconocido: ${tipo || '(vacío)'}`);
    return new ClaseFactura(datos);
  }

  static tiposDisponibles() { return [...this.#tipos.keys()]; }
}

export class ValidadorFactura {
  constructor({ limiteRevision = 1_000_000, permitirFechaFutura = false } = {}) {
    const limite = Number(limiteRevision);
    if (!Number.isFinite(limite) || limite < 0) throw new RangeError('El límite de revisión debe ser un número finito no negativo.');
    this.limiteRevision = limite;
    this.permitirFechaFutura = Boolean(permitirFechaFutura);
  }

  validar(factura) {
    const errores = [];
    if (!factura.id || !factura.proveedor || !factura.cedulaJuridica) {
      errores.push('Faltan datos obligatorios: número, proveedor o cédula jurídica.');
    }

    const cedula = factura.cedulaJuridica.replace(/\D/g, '');
    if (cedula.length !== 10 || cedula[0] !== '3') {
      errores.push('Cédula jurídica inválida: debe contener 10 dígitos y comenzar con 3.');
    }

    const fechaValida = /^\d{4}-\d{2}-\d{2}$/.test(factura.fecha)
      && !Number.isNaN(Date.parse(`${factura.fecha}T00:00:00Z`))
      && new Date(`${factura.fecha}T00:00:00Z`).toISOString().slice(0, 10) === factura.fecha;
    if (!fechaValida) {
      errores.push('Fecha inválida: utiliza el formato YYYY-MM-DD.');
    } else if (!this.permitirFechaFutura && factura.fecha > todayISO()) {
      errores.push('La fecha de la factura no puede estar en el futuro.');
    }

    if (!factura.lineas.length || factura.lineas.some((linea) =>
      !linea.descripcion || !Number.isFinite(linea.cantidad) || linea.cantidad <= 0
      || !Number.isFinite(linea.precioUnitario) || linea.precioUnitario < 0
    )) {
      errores.push('Las líneas deben tener descripción, cantidad mayor que cero y precio no negativo.');
    }

    if (factura.constructor.tipoFactura === 'extranjera') {
      if (!factura.moneda || factura.moneda === 'CRC' || !Number.isFinite(factura.tipoCambio) || factura.tipoCambio <= 0) {
        errores.push('La factura extranjera requiere moneda de origen y tipo de cambio positivo.');
      }
    } else if (factura.moneda !== 'CRC') {
      errores.push('Las facturas nacionales o exentas deben expresarse en CRC.');
    }

    if (['nacional', 'reducida'].includes(factura.constructor.tipoFactura)
      && (!Number.isFinite(factura.porcentajeIVA) || factura.porcentajeIVA < 0 || factura.porcentajeIVA > 1)) {
      errores.push('La tarifa de IVA debe estar entre 0 y 1 (0% a 100%).');
    }
    if (!Number.isFinite(factura.subtotal())) {
      errores.push('El subtotal no es un importe numérico válido.');
    }

    return { valida: errores.length === 0, errores };
  }
}

export class ReporteLote {
  constructor(resultados = []) { this.resultados = [...resultados]; }

  generar() {
    const aprobadas = this.resultados.filter((r) => r.estado === 'aprobada');
    const revision = this.resultados.filter((r) => r.estado === 'revision');
    const rechazadas = this.resultados.filter((r) => r.estado === 'rechazada');
    const procesables = this.resultados.filter((r) => r.estado !== 'rechazada');
    const sumar = (lista, campo) => asMoney(lista.reduce((sum, r) => sum + (Number(r[campo]) || 0), 0));
    return {
      generadoEn: new Date().toISOString(),
      cantidad: this.resultados.length,
      aprobadas: aprobadas.length,
      revision: revision.length,
      rechazadas: rechazadas.length,
      totalFacturado: sumar(procesables, 'total'),
      ivaTotal: sumar(procesables, 'impuesto'),
      montoLimiteRevisionCRC: this.resultados.find((r) => Number.isFinite(r.limiteRevision))?.limiteRevision ?? 1_000_000,
      resultados: this.resultados,
    };
  }
}

export function procesarFactura(datos, validador = new ValidadorFactura()) {
  let factura;
  try {
    factura = datos instanceof Factura ? datos : FabricaFacturas.crear(datos);
  } catch (error) {
    return {
      id: String(datos?.id ?? 'SIN-ID'),
      tipo: String(datos?.tipo ?? 'desconocido'),
      proveedor: String(datos?.proveedor ?? ''),
      fecha: String(datos?.fecha ?? ''),
      subtotal: null,
      impuesto: null,
      total: null,
      estado: 'rechazada',
      errores: [error.message],
      motivo: error.message,
      limiteRevision: validador.limiteRevision,
    };
  }

  const { valida, errores } = validador.validar(factura);
  if (!valida) {
    return {
      id: factura.id,
      tipo: factura.constructor.tipoFactura,
      proveedor: factura.proveedor,
      fecha: factura.fecha,
      subtotal: null,
      impuesto: null,
      total: null,
      estado: 'rechazada',
      errores,
      motivo: errores.join(' '),
      limiteRevision: validador.limiteRevision,
    };
  }

  const subtotal = factura.subtotal();
  const impuesto = factura.calcularImpuesto();
  const total = factura.total();
  const estado = total > validador.limiteRevision ? 'revision' : 'aprobada';
  return {
    ...factura.toJSON(),
    subtotal,
    impuesto,
    total,
    estado,
    errores: [],
    motivo: estado === 'revision' ? `Supera el límite de revisión de ₡${validador.limiteRevision.toLocaleString('es-CR')}.` : '',
    limiteRevision: validador.limiteRevision,
  };
}

export function procesarLote(datos = [], opciones = {}) {
  const validador = opciones.validador ?? new ValidadorFactura(opciones);
  const resultados = datos.map((item) => procesarFactura(item, validador));
  return new ReporteLote(resultados).generar();
}
