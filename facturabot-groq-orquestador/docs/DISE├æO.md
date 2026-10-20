# Diseño y decisiones técnicas

## Mapeo del material de clase

| Material | Implementación |
|---|---|
| Encapsulamiento `#` + getter | `Factura.#lineas`, `LineaFactura.#descripcion`, `#cantidad`, `#precioUnitario`; getter defensivo |
| Herencia y polimorfismo | Nacional, exenta, extranjera y tarifa reducida implementan `calcularImpuesto()`; la extranjera sobrescribe `total()` |
| Factory | `FabricaFacturas` mapea el tipo a su clase y rechaza tipos desconocidos |
| Validador | Campos, cédula jurídica, fecha, líneas y combinación moneda/tipo de cambio |
| Estado | primero validación; después compara el total verificado con el umbral configurable |
| Reporte de lote | recuentos, total procesable, IVA e información por factura |
| Agente orquestador | selecciona un especialista, ejecuta y genera una respuesta; fallback local |
| Memoria | historial por sesión con límite de mensajes y sesiones; memoria temporal en RAM |

## Reglas de la demo

- Factura nacional: IVA predeterminado de 13% configurable por instancia.
- Factura exenta y extranjera: impuesto 0 en el alcance demostrativo.
- Factura extranjera: total en CRC = subtotal en moneda de origen × tipo de cambio.
- Tarifa reducida (extensión): IVA predeterminado de 4% configurable por instancia.
- Un total mayor que el límite configurable de ₡1 000 000 queda en revisión.
- Los rechazos no cuentan dentro del total procesable; sus importes se dejan en `null` para impedir sumar datos inválidos.

Estas reglas reproducen la práctica, no sustituyen la normativa fiscal aplicable a una transacción real.

## Fallback de IA

Si no hay `GROQ_API_KEY`, Groq falla, entrega JSON de enrutamiento incorrecto o supera el tiempo límite, el orquestador usa heurísticas locales y los mismos especialistas. El sistema expone la modalidad utilizada y un aviso seguro sin retornar el secreto ni el cuerpo crudo del proveedor.

## Automatización de calidad

El workflow de GitHub Actions corre al hacer push/PR, permite ejecución manual y programa una auditoría de dependencias cada lunes. Dependabot también comprueba actualizaciones npm semanalmente. Como el proyecto no utiliza dependencias npm para ejecutar el servidor, el riesgo por dependencias es bajo; si se agregan, la auditoría debe seguir activa.


## Interfaz de análisis (v1.2.0)

- La página inicia con tema claro de gestión financiera; el usuario puede cambiar entre tema claro y oscuro y la preferencia se conserva localmente.
- El panel de análisis se calcula desde el reporte real del lote: barras interactivas por factura, distribución aprobada/revisión/rechazada y suma del impuesto por tipo. No se inventan series mensuales ni tendencias cuando el lote no incluye esos datos.
- El gráfico de facturas muestra `—` cuando el validador rechaza el documento y no existe total confiable. Los importes rechazados no se incorporan al total procesable.
- Los gráficos usan CSS nativo y datos generados en el navegador; no requieren una librería gráfica remota, y se adaptan a escritorio, tablet y móvil. Se respeta `prefers-reduced-motion`.
- La hoja `public/mondragon-theme.css` contiene el sistema visual nuevo (superficies, acentos verde/teal, escala tipográfica y breakpoints) sin tomar logotipos ni copiar componentes de terceros.
