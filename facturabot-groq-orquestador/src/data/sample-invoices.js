export const sampleInvoices = [
  {
    id: 'F-001', tipo: 'nacional', proveedor: 'Suministros La Central', cedulaJuridica: '3-101-123456', fecha: '2026-09-12', moneda: 'CRC',
    lineas: [{ descripcion: 'Material de oficina', cantidad: 1, precioUnitario: 50000 }],
  },
  {
    id: 'F-002', tipo: 'exenta', proveedor: 'Fundación Horizonte', cedulaJuridica: '3-101-234567', fecha: '2026-09-13', moneda: 'CRC',
    lineas: [{ descripcion: 'Servicio exento', cantidad: 1, precioUnitario: 150000 }],
  },
  {
    id: 'F-003', tipo: 'extranjera', proveedor: 'Global Office LLC', cedulaJuridica: '3-101-345678', fecha: '2026-09-14', moneda: 'USD', tipoCambio: 510,
    lineas: [{ descripcion: 'Licencias de software', cantidad: 1, precioUnitario: 2500 }],
  },
  {
    id: 'F-004', tipo: 'nacional', proveedor: 'Proveedor con identificación inválida', cedulaJuridica: '2-101-123456', fecha: '2026-09-15', moneda: 'CRC',
    lineas: [{ descripcion: 'Sillas', cantidad: 2, precioUnitario: 25000 }],
  },
  {
    id: 'F-005', tipo: 'nacional', proveedor: 'Equipos del Valle', cedulaJuridica: '3-101-456789', fecha: '2026-09-16', moneda: 'CRC',
    lineas: [{ descripcion: 'Equipo de cómputo', cantidad: 1, precioUnitario: 1000000 }],
  },
  {
    id: 'F-006', tipo: 'credito', proveedor: 'Proveedor desconocido', cedulaJuridica: '3-101-567890', fecha: '2026-09-17', moneda: 'CRC',
    lineas: [{ descripcion: 'Servicio', cantidad: 1, precioUnitario: 10000 }],
  },
  {
    id: 'F-007', tipo: 'nacional', proveedor: 'Comercial del Futuro', cedulaJuridica: '3-101-678901', fecha: '2099-01-01', moneda: 'CRC',
    lineas: [{ descripcion: 'Suministros', cantidad: 1, precioUnitario: 10000 }],
  },
];
