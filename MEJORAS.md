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
