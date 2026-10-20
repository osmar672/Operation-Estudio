# FacturaBot + Groq + Agente Orquestador · edición mejorada v1.8

Implementación de la práctica **FacturaBot: POO en el Code Node de n8n**, ampliada con un agente orquestador y cinco especialistas, siguiendo el material de clase adjunto.

## Qué incluye

- **Interfaz rediseñada y más cómoda**: mejor jerarquía visual, espacios, tipografía, panel de conversación y adaptación a móvil/tablet/escritorio.
- **Panel web de gestión financiera** con una interfaz clara de acentos turquesa/verde inspirada en patrones de software contable empresarial, navegación adaptable, tema claro/oscuro, animaciones accesibles, tipografía más legible, indicadores animados y estados de conexión. La referencia visual es conceptual: FacturaBot mantiene su marca y su propia estructura.
- **Gráficos del lote en tiempo real**: barras interactivas por factura, gráfico de dona para los estados de validación y barras de IVA calculado por tipo; los gráficos se actualizan al importar/procesar un CSV y se puede abrir el detalle al seleccionar una factura. Incluye resumen fiscal de total procesable, IVA, porcentaje aprobado y umbral de revisión.
- **Herramientas CSV**: descarga de plantilla, importación con validaciones, agrupación de múltiples líneas por factura y exportación de los registros filtrados. Los lotes importados se comparten con el asistente durante la sesión.
- **POO real en JavaScript**: `LineaFactura`, `Factura` (base abstracta), `FacturaNacional`, `FacturaExenta`, `FacturaExtranjera`, `FacturaTarifaReducida`, `FabricaFacturas`, `ValidadorFactura` y `ReporteLote`.
- **Reglas deterministas para dinero/estados**; el LLM interpreta y redacta, pero no decide los totales contables.
- **Orquestador con cinco especialistas de negocio y modo general**: facturas, datos, reportes, correo (solo borradores), archivos (texto aportado) y respuestas generales con Groq. El modo local ofrece una calculadora básica segura y explica sus límites.
- **Groq en el servidor** mediante la API compatible con Chat Completions. La clave no se envía al frontend.
- **Modo local de reserva** cuando no hay clave, se agota el límite o Groq no está disponible.
- **Modo de razonamiento alto** configurable para GPT-OSS, mayor presupuesto de respuesta y memoria conversacional ampliada para mantener mejor el contexto.
- **Instrucciones de calidad reforzadas** para resolver tareas complejas, escribir código ejecutable, cubrir solicitudes de varias partes y declarar supuestos sin inventar capacidades.
- **Memoria breve por sesión**, lote importado aislado por identificador de sesión (en memoria del servidor), validación de entradas, cabeceras de seguridad, límite básico de solicitudes y errores sin filtrar secretos.
- **Tres workflows n8n en JSON**, incluido `FacturaBot_SUPER_Workflow_Groq.json`, la variante unificada recomendada con 19 nodos que reúne chat con Groq, cinco herramientas especialistas y la rama manual POO. También se conservan los dos workflows separados para poder probarlos de forma independiente.
- **Pruebas automáticas** que comprueban la herencia, el encapsulamiento, la fábrica, los estados, el cliente Groq y los totales del documento.
- **CI y revisión semanal** con GitHub Actions: ejecuta pruebas, `npm audit` todos los lunes y en cada cambio; Dependabot revisa actualizaciones semanalmente. El proyecto no trae dependencias npm de ejecución.

## Requisitos

- Node.js 20.11 o posterior.
- No requiere instalar dependencias npm para ejecutar la app.
- Una clave de Groq es opcional para ejecutar la demo local, pero necesaria para activar el modelo.

## Ejecutar en Windows, Linux o macOS

1. Extrae el ZIP.
2. Abre una terminal dentro de `facturabot-groq-orquestador`.
3. Copia `.env.example` a `.env`. El archivo de ejemplo no contiene credenciales.
4. Obtén una clave nueva desde <https://console.groq.com/keys> y ponla en `GROQ_API_KEY` en `.env`.
5. Ejecuta:

```bash
npm start
```

6. Abre <http://127.0.0.1:3000>.

No es necesario `npm install`: el servidor usa módulos integrados de Node.js. Si no configuras Groq, el panel seguirá trabajando con respuestas locales deterministas y mostrará el modo que se está usando.

### Variables de entorno

| Variable | Uso | Valor por defecto |
|---|---|---|
| `GROQ_API_KEY` | Clave secreta de Groq | Vacía (modo local) |
| `GROQ_MODEL` | ID del modelo | `openai/gpt-oss-120b` |
| `GROQ_REASONING_EFFORT` | Esfuerzo de razonamiento para GPT-OSS (`low`, `medium`, `high`) | `high` |
| `PORT` | Puerto HTTP | `3000` |
| `HOST` | Interfaz de escucha | `127.0.0.1` |

El modelo predeterminado usa esfuerzo de razonamiento `high` cuando el proveedor y modelo lo admiten; puedes reducirlo con `GROQ_REASONING_EFFORT=medium` o `low` si priorizas velocidad/costo. Esto mejora el uso del modelo, pero no garantiza respuestas perfectas. El ID del modelo es configurable. Verifica los modelos activos y sus límites en <https://console.groq.com/docs/models> antes de cambiarlo. La clave permanece en el servidor y nunca se envía al navegador.

## Probar la implementación

```bash
npm run verify
```

El lote de referencia esperado es:

- 7 facturas procesadas.
- 2 aprobadas, 2 en revisión y 3 rechazadas.
- Total procesable: **₡2 611 500**.
- IVA total: **₡136 500**.

Los resultados coinciden con los números del PDF entregado. Las facturas son ficticias y solo sirven para pruebas.

### Importar un CSV

Usa **Plantilla** para descargar un CSV de ejemplo. El archivo debe incluir `id`, `tipo`, `proveedor`, `cedulaJuridica`, `fecha`, `descripcion`, `cantidad` y `precioUnitario`. `moneda`, `tipoCambio` y `porcentajeIVA` son opcionales según el tipo. `porcentajeIVA` se expresa como decimal: `0.13` significa 13% y `0.04` significa 4%. Usa números sin símbolo monetario; cada fila representa una línea, y las filas con el mismo `id` se agrupan en una única factura. Tipos soportados: `nacional`, `exenta`, `extranjera` y `reducida`. Se permiten hasta 100 facturas únicas y archivos CSV de 512 KB. El lote vive en memoria de la sesión de la aplicación y se pierde al reiniciar el servidor; se limita el número de lotes en memoria y no se guarda en una base de datos.

## Arquitectura

```text
Navegador
   │ HTTP same-origin
   ▼
Servidor Node.js ─── Groq API (clave solo en servidor)
   │                  └─ clasifica intención y redacta respuesta
   ▼
Orquestador POO + memoria de sesión
   ├─ AgenteFacturas ── motor determinista FacturaBot
   ├─ AgenteDatos ───── consultas al lote activo de la sesión
   ├─ AgenteReportes ── indicadores y hallazgos
   ├─ AgenteCorreo ──── crea borradores; no envía
   └─ AgenteArchivos ── estructura texto suministrado
```

La IA **no calcula ni altera** el IVA, los totales, la validez de la cédula o el estado de una factura. Esas decisiones corresponden a las clases y reglas comprobables. La memoria es volátil y se pierde al reiniciar el proceso.

## Importar en n8n

Los JSON se encuentran en `n8n/`.

1. **Recomendado:** importa `FacturaBot_SUPER_Workflow_Groq.json` desde **Workflows → Import from File**. Es la versión unificada: contiene el `Chat Trigger`, `AI Agent`, modelo Groq, memoria, cinco herramientas de especialistas y la rama manual POO con `Switch`, tres ramas, `Merge` y reporte final.
2. En el nodo **Groq Chat Model**, crea/selecciona tus credenciales de Groq. No pegues la clave directamente dentro del JSON.
3. Prueba el chat y, por separado, ejecuta `Inicio manual` para procesar las siete facturas.
4. Las variantes `FacturaBot_Procesamiento_POO.json` y `FacturaBot_Orquestador_Groq.json` siguen incluidas si prefieres probar las piezas por separado.
5. La compatibilidad de los parámetros de los nodos de IA puede variar con la versión de n8n; si aparece un aviso de actualización, adapta el nodo en el editor y guarda. La importación estructural no sustituye una ejecución de prueba en tu instancia.

## Seguridad y límites conocidos

Este ZIP es una base funcional de desarrollo/demo, **no debe publicarse directamente como sistema fiscal de producción**. Si una clave de Groq real estuvo en un archivo compartido, revócala y genera una nueva antes de usar el proyecto. Antes de exponerlo a Internet hay que añadir:

- Autenticación y autorización de usuarios (RBAC), HTTPS y un proxy con límites por usuario.
- Base de datos persistente, migraciones, copias de seguridad y controles de acceso por organización.
- Revisión tributaria/legal de las reglas de IVA, cédula y conservación documental con fuentes oficiales vigentes.
- Integración real y autorizada con correo/Drive y extractor de PDF; los especialistas de correo y archivos de esta versión no envían ni extraen adjuntos por sí solos.
- Registro de auditoría durable, métricas, alertas, gestión/rotación de secretos y análisis de dependencias del despliegue.
- Pruebas de carga, de autorización, de abuso de prompts y de recuperación ante errores externos.

El servidor escucha en `127.0.0.1` por defecto. Cambiar `HOST` a `0.0.0.0` solo hace que escuche en otras interfaces; **no agrega autenticación ni vuelve segura la exposición pública**. La revisión automática semanal está en `.github/workflows/ci-security.yml` y la política de Dependabot en `.github/dependabot.yml`; se activan al subir el proyecto a GitHub.

## Estructura

```text
facturabot-groq-orquestador/
├── public/                     # interfaz web, dashboard con gráficos, tema y animaciones
│   ├── mondragon-theme.css      # rediseño visual responsive inspirado en UI contable
│   └── csv-utils.js             # lector CSV validado y reutilizable
├── src/domain/invoices.js      # modelo, fábrica, validación y reporte POO
├── src/data/sample-invoices.js # datos ficticios de prueba
├── src/agents/                 # especialistas polimórficos
├── src/services/               # cliente Groq y orquestador/memoria
├── src/server.js               # API local con Node.js
├── tests/                      # pruebas de dominio, Groq, orquestación y CSV
├── n8n/                        # workflow SUPER unificado + workflows separados
├── .github/workflows/          # CI, tests y auditoría semanal
├── .env.example
└── package.json
```


## Mejoras de usabilidad y redacción (v1.5)
- La redacción de correos usa una instrucción generativa dedicada: produce asunto y cuerpo completos según la petición y el contexto conversacional, en vez de limitarse a una plantilla fija.
- Los correos siguen siendo borradores: la aplicación no afirma haberlos enviado.
- Ajustes de tamaño de navegación, tipografía, campo de chat y área de mensajes para mejorar lectura y comodidad.
- Verificación local: `npm run verify`.


### v1.7 — Menú lateral contraíble
En escritorio, usa el botón ⇤ junto a la ruta superior para contraer el menú a una barra de iconos; vuelve a pulsarlo para expandirlo. La preferencia se guarda localmente en el navegador. En móviles se mantiene el menú desplegable existente.


## Menú lateral contraíble (v1.7)

En escritorio, utiliza el botón de flecha junto al logotipo FacturaBot para contraer la barra lateral y ganar espacio de trabajo. Los iconos conservan sus nombres accesibles y sus descripciones emergentes; vuelve a presionar el botón para recuperar las opciones. La preferencia se guarda en `localStorage`. En pantallas pequeñas se conserva el menú móvil desplegable y se oculta el control de contracción para evitar conflictos de navegación.


## v1.8 — Corrección de preguntas conceptuales

- Las solicitudes educativas como «¿qué es el IVA?» o «explícame la factura electrónica» se envían directamente al asistente general y no al procesador de lotes.
- Se ajustaron las instrucciones del clasificador para separar explicaciones teóricas de operaciones reales sobre facturas.
- El modo local incluye explicaciones breves de conceptos frecuentes de facturación cuando Groq no está configurado.
- Las consultas operativas identificadas por un número de factura conservan el enrutamiento al especialista de datos.


## Registrar una factura nueva

En la sección **Facturas**, utiliza **Nueva factura**. Completa el número, proveedor, cédula jurídica, fecha, tipo y al menos una línea de producto/servicio. Para facturas extranjeras también se solicita moneda y tipo de cambio; para nacionales o de tarifa reducida se puede ajustar el IVA. Al guardar, FacturaBot registra los datos en `storage/user-invoices.json`, vuelve a procesar el lote y muestra el estado de validación. Las facturas quedan guardadas después de reiniciar el servidor local. Evita usar datos reales sensibles en este prototipo: antes de producción hacen falta autenticación, autorización, auditoría y una base de datos con copias de seguridad.
