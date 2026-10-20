# Mejoras aplicadas

- Se agregó una ruta de asistente general con Groq para preguntas, redacción, planificación, programación y tareas fuera del dominio de facturas.
- El modo local reconoce consultas generales, informa con honestidad sus límites y resuelve expresiones aritméticas básicas sin `eval`.
- Se amplió el enrutamiento para distinguir mejor las solicitudes generales de las operaciones de facturación.
- Se refinó la interfaz: espacios, lectura, tarjetas, área de conversación, campos de entrada y distribución adaptable a escritorio, tablet y móvil.
- Se reparó el paquete n8n que faltaba: se añadieron el manifiesto y dos workflows sencillos independientes. El workflow SUPER original se conserva.
- Se añadió cobertura de pruebas para el asistente general y la calculadora local.
- Se eliminó cualquier archivo `.env` y se limpió `.env.example` para que no contenga credenciales.

## Límites que siguen siendo importantes

- Para respuestas generales completas, la variable `GROQ_API_KEY` debe contener una clave válida y vigente.
- La app no envía correos ni extrae archivos PDF por sí sola; esas integraciones requieren conectar servicios y credenciales.
- Los datos de negocio siguen siendo temporales y locales; no se implementaron autenticación ni base de datos multiusuario, por lo que este ZIP no debe exponerse directamente a Internet ni considerarse listo para producción fiscal.
- Si una clave real se compartió en un ZIP anterior, revócala desde Groq y crea una nueva.

## Verificación

Ejecutado con Node.js 22: `npm run verify` — 31 pruebas aprobadas, 0 fallidas.


## v1.7 — navegación contraíble rehecha
- Se movió el control de contraer/expandir al encabezado del menú, junto al logotipo, para que sea fácil de encontrar.
- Se conservan las etiquetas accesibles y los `title` de cada elemento de navegación cuando el menú muestra solo iconos.
- Se sincronizan `aria-expanded`, `aria-pressed` y la etiqueta accesible del menú.
- La preferencia se conserva en `localStorage`; si el navegador lo bloquea, el control sigue funcionando durante la sesión.
- Se respetan las reglas del menú móvil.
- Se añadió una prueba automatizada de estructura y persistencia del control.


## v1.8 — Arreglo de enrutamiento de IA

Las preguntas educativas sobre IVA, facturación, impuestos y términos contables ahora tienen prioridad sobre las palabras clave financieras. No se procesan facturas salvo que el usuario solicite una operación real. Incluye definiciones locales para términos frecuentes y pruebas de regresión para el caso reportado.
