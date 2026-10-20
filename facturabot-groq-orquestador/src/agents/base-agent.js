export class AgenteBase {
  constructor(nombre, descripcion) {
    if (new.target === AgenteBase) throw new TypeError('AgenteBase es abstracta.');
    this.nombre = nombre;
    this.descripcion = descripcion;
  }
  puedeManejar() { return false; }
  async ejecutar() { throw new Error(`${this.nombre} debe implementar ejecutar().`); }
}
