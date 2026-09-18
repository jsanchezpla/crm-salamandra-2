/**
 * lib/provisioning/queHaceCadaModulo.js — qué hace cada módulo POR DENTRO, para
 * nosotros.
 *
 * QUÉ RESUELVE (18/09/2026, Jorge). En `/admin/modulos` los módulos salían como
 * la clave cruda: `billing_banco · clients_avanzado · productos_avanzado`. Quien
 * no lleve el CLAUDE.md en la cabeza no sabe qué es `productos_avanzado` ni qué
 * pantallas trae, y averiguarlo costaba abrir `docs/modules/` o preguntar. Aquí
 * queda escrito, en una frase y una lista, para poder mirarlo de un vistazo.
 *
 * POR QUÉ NO VA EN `catalogo.js`. El catálogo declara en su cabecera su trabajo:
 * «lo que se le puede vender a un cliente nuevo». Su `desc` es lo que se le DICE
 * AL CLIENTE, y lo leen la pantalla de alta y `/provisioning`. Esto es lo otro:
 * lo que hay que saber ANTES DE TOCARLO. Mezclarlos acabaría con un aviso
 * interno («esta pantalla tiene reina») pintado en una superficie de venta.
 *
 * ESTE FICHERO NO DECIDE QUÉ MÓDULOS EXISTEN. Eso sigue siendo `CLAVES_VALIDAS`
 * de `catalogo.js`; aquí solo se describen. `_smoke-fichas-modulos.mjs` impone
 * la biyección entre los dos, así que un módulo nuevo sin ficha pone la prueba
 * en rojo.
 *
 * CÓMO SE ESCRIBE UNA FICHA
 *   · `hace`  una frase, MÁXIMO 120 CARACTERES — se lee con el desplegable
 *             cerrado, y es lo único que evita que «de un vistazo» acabe siendo
 *             tres párrafos. La prueba lo mide.
 *   · `trae`  las pantallas de verdad: `{ que, donde }`, con `donde` = la ruta
 *             real. La prueba comprueba que esa carpeta existe con su
 *             `page.jsx`, así que el día que una pantalla se renombre o se
 *             borre, esta lista no puede quedarse mintiendo en silencio.
 *   · `ojo`   lo que hay que saber antes de tocarlo: reinas, interruptores,
 *             dependencias no obvias, trampas conocidas. Opcional.
 *   · `doc`   su doc en `docs/modules/`, como TEXTO — la imagen de Docker no
 *             lleva `docs/`, un enlace daría 404 en producción. Solo `calendar`
 *             va sin doc, y la prueba lo fija para que un módulo nuevo sin
 *             documentar chille.
 *
 * LO QUE NO VA AQUÍ: la matriz de dependencias. Ya está entera —con su porqué y
 * sus rutas de código— en `dependencias.js` y en `/admin/integraciones`. En la
 * ficha se pinta una sola línea de `textoNecesita()` y un enlace allí. Dos
 * sitios con lo mismo acaban contradiciéndose.
 */

export const FICHAS = {
  // ── Base ────────────────────────────────────────────────────────────────
  clients: {
    hace: "La ficha de cada cliente: quién es, quién le atiende y todo lo que le cuelga.",
    trae: [
      { que: "Listado, alta por perfil (salud / comercial) y ficha con contactos, notas, adjuntos e historial", donde: "/clientes" },
      { que: "WhatsApp sin asignar: mensajes entrantes que aún no cuelgan de ninguna ficha", donde: "/clientes/whatsapp" },
    ],
    ojo: [
      "El rótulo lo deciden los módulos, no el slug: con `nutricion` y sin `clinica` se llama «Pacientes», con `booking` «Contratantes» (lib/clients/vocabulario.js).",
      "Casi todo cuelga de aquí: `invoices.client_id` es NOT NULL, y sin Clientes no se puede emitir una factura.",
      "`Client.address` es JSONB, no texto. Tratarlo como string tumbó la ficha una vez.",
      "Los paneles de la ficha se eligen por módulos en `lib/clients/piezasFicha.js`; la ficha base tiene la forma de Aumenta.",
    ],
    doc: "docs/modules/clients.md",
  },
  clients_avanzado: {
    hace: "Dos pantallas para centros con muchas fichas: quién espera plaza y a qué fichas les faltan datos.",
    trae: [
      { que: "Lista de espera de admisión, por orden de llegada", donde: "/clientes/lista-espera" },
      { que: "«Fichas a completar»: el repaso de huecos de datos, por carpetas", donde: "/clientes/urgentes" },
    ],
    ojo: [
      "Gatea las TRES puertas: el menú, la página (con `notFound()`) y el endpoint. Si se olvida una, el módulo se regala.",
      "Un centro de nutrición no admite por cola: no le sobra la pantalla, le sobra el concepto. Por eso es módulo aparte y no viene con `clients`.",
    ],
    doc: "docs/modules/clients.md",
  },
  team: {
    hace: "La plantilla y quién entra al CRM: personas, usuarios, roles y a qué módulos accede cada una.",
    trae: [{ que: "Plantilla, altas, usuarios, roles y accesos por módulo", donde: "/equipo" }],
    ojo: [
      "Activar un módulo tiene DOS puertas: `tenant_modules` y `users.module_access`. `scripts/enable-module.js` abre las dos; `npm run db:check-access` dice quién no ve qué.",
      "El rol se lee fresco de la base en cada petición (`withTenant` reescribe `x-user-role`): degradar a alguien surte efecto al instante.",
      "La FK de Facturación al equipo se llama `employeeId`, con alias `employee`.",
    ],
    doc: "docs/modules/team.md",
  },
  team_avanzado: {
    hace: "Las pantallas de dirección: números del equipo, incidencias, ocupación y registro de actividad.",
    trae: [
      { que: "Dirección: el cuadro de mando del centro", donde: "/equipo/direccion" },
      { que: "Productividad por persona", donde: "/equipo/productividad" },
      { que: "Desempeño (cada persona ve el suyo)", donde: "/equipo/mi-desempeno" },
      { que: "Incidencias", donde: "/equipo/incidencias" },
      { que: "Bandeja de trabajo", donde: "/equipo/bandeja" },
      { que: "Ocupación de la agenda", donde: "/equipo/ocupacion" },
      { que: "Registro de actividad", donde: "/equipo/actividad" },
    ],
    ojo: [
      "Casi todos sus submenús exigen `requiresAll` (el avanzado MÁS el módulo que aporta el contenido: `clinica` o `citas`). Sin ellos no hay números que enseñar.",
      "En Aumenta, Desempeño / Dirección / Productividad son SOLO admin.",
      "Son números automáticos. La valoración a mano y cualitativa es `auditorias`, que es otro módulo y no se solapa.",
    ],
    doc: "docs/modules/team.md",
  },
  auditorias: {
    hace: "La revisión mensual de cada profesional, a mano: apto / no apto por áreas, con acuerdo y plazo.",
    trae: [{ que: "Auditorías: cuatro áreas de criterios, cierre con fortalezas, acción acordada y plazo, e histórico por persona", donde: "/equipo/auditorias" }],
    ojo: [
      "Exige `team` y NO `team_avanzado`: lo compra cualquier centro con varias personas y alguien que dirija.",
      "Un «no apto» NO decide el resultado y no hay puntuaciones: se pidió así (AV-0100 de Aumenta).",
      "Material laboral: dirección escribe todas; cada persona ve las suyas solo una vez CERRADAS.",
      "Las reglas viven en `lib/team/auditoriaDesempeno.js`, con su prueba.",
    ],
    doc: "docs/modules/auditorias.md",
  },
  fichaje: {
    hace: "Control horario: se vuelca el Excel del reloj de fichar y queda el registro por persona y día.",
    trae: [{ que: "Fichaje: horas por persona y día, extras, avisos y correcciones a mano justificadas", donde: "/equipo/fichaje" }],
    ojo: [
      "Universal por dentro, pero cada cliente necesita SU lector: un fichero en `lib/fichaje/parsers/` y una línea en `POR_TENANT`. Hay que ver un mes real antes de activarlo.",
      "Exige `team` y NO `team_avanzado`.",
    ],
    doc: "docs/modules/fichaje.md",
  },
  documents: {
    hace: "Solo el Contrato de Prestación de Servicios del centro: subirlo, verlo y descargarlo.",
    trae: [
      { que: "El contrato del centro", donde: "/documentos" },
      { que: "«Para leer»: lo que cada persona tiene pendiente de leer", donde: "/documentos/lecturas" },
    ],
    ojo: [
      "YA NO EXIGE `citas` (24/08/2026): era una regla de venta, no del código. Sin Citas se sube, se ve y se descarga, pero no hay área privada donde la familia lo firme.",
      "Sigue exigiendo `clients`: un documento cuelga de una ficha.",
    ],
    doc: "docs/modules/documents.md",
  },
  documents_avanzado: {
    hace: "El archivo entero: carpetas, buscador, subida libre y cuota de disco por cliente.",
    trae: [{ que: "Todos los documentos, con carpetas y buscador", donde: "/documentos/todos" }],
    ojo: [
      "Es el ÚNICO sitio donde `logicOverrides` se lee de verdad hoy: `documents.quotaBytes` fija la cuota de disco (`quotaBytesDe(ctx)` en lib/documents/documentStorage.js).",
    ],
    doc: "docs/modules/documents.md",
  },

  // ── Agenda y trabajo ────────────────────────────────────────────────────
  citas: {
    hace: "La agenda: reservas, recordatorios, página pública de reserva y portal del paciente.",
    trae: [
      { que: "La agenda del centro", donde: "/citas" },
      { que: "Tipos de cita (duración, color, precio)", donde: "/citas/tipos" },
      { que: "Disponibilidad por profesional", donde: "/citas/disponibilidad" },
      { que: "Bloqueos y ausencias", donde: "/citas/bloqueos" },
      { que: "Citas sin profesional asignado (dirección y recepción)", donde: "/citas/sin-profesional" },
      { que: "«Mi horario»: lo que ve cada persona del equipo", donde: "/mi-horario" },
    ],
    ojo: [
      "Dos interruptores suyos: `citas.autoConfirmPublicBookings` (¿la reserva de la web se confirma sola?) y `citas.sinHorarioPropio`.",
      "El equipo NO ve el dinero de las citas: la regla está en `lib/citas/dinero.js`, con prueba. No repetirla en los endpoints.",
      "Para reservar desde la web del cliente hay que incrustar el widget (`docs/modules/citas-embed.md`).",
      "Aumenta tiene la agenda COMPARTIDA: todo el equipo ve la agenda y los datos de contacto.",
    ],
    doc: "docs/modules/citas.md",
  },
  calendar: {
    hace: "Calendario interno de tareas y eventos del equipo, con sus categorías.",
    trae: [
      { que: "El calendario", donde: "/calendario" },
      { que: "Categorías de evento", donde: "/calendario/categorias" },
    ],
    ojo: ["Es el único módulo sin doc en `docs/modules/`. No confundirlo con `citas`, que es la agenda de pacientes."],
    doc: null,
  },
  projects: {
    hace: "Tableros kanban: proyectos con fases, hitos y tareas asignadas a personas.",
    trae: [{ que: "Proyectos y su tablero", donde: "/proyectos" }],
    ojo: ["Ojo con `BoardColumn`: su índice usa nombres de atributo en vez de snake_case y rompe `sync({alter:true})` en tenants nuevos."],
    doc: "docs/modules/projects.md",
  },
  support: {
    hace: "Helpdesk del cliente hacia SUS clientes: tickets con número, SLA y portal público.",
    trae: [{ que: "Tickets, con su portal público y avisos por correo", donde: "/soporte" }],
    ojo: [
      "No confundirlo con el Buzón: el Buzón es el cliente escribiéndonos a NOSOTROS (/ayuda → /admin/buzon); esto es su propio helpdesk.",
      "El correo ENTRANTE sigue sin dar de alta en Resend.",
    ],
    doc: "docs/modules/support.md",
  },

  // ── Dinero ──────────────────────────────────────────────────────────────
  billing: {
    hace: "Todo el dinero: presupuestos, facturas con PDF, cobros, cuotas, bonos, gastos y arqueo.",
    trae: [
      { que: "Presupuestos", donde: "/facturacion/presupuestos" },
      { que: "Facturas con PDF y numeración", donde: "/facturacion/facturas" },
      { que: "Cobros y morosidad", donde: "/facturacion/cobros" },
      { que: "Cuotas recurrentes", donde: "/facturacion/cuotas" },
      { que: "Bonos de sesiones", donde: "/facturacion/bonos" },
      { que: "Gastos y proveedores", donde: "/facturacion/costes" },
      { que: "Arqueo de caja", donde: "/facturacion/arqueo" },
      { que: "Analítica de facturación (clientes, empleados, IVA, socios)", donde: "/facturacion/analitica" },
      { que: "Resumen del ejercicio", donde: "/facturacion/resumen" },
    ],
    ojo: [
      "La FK al equipo se llama `employeeId` (alias `employee`), no `teamMemberId`.",
      "El webhook de Stripe registra SOLO los cobros online (`lib/billing/cobroDesdeStripe.js`); Cobros enlaza a Stripe y al banco.",
      "Verifactu va por la API de Facturantia: el CRM crea la factura y ellos devuelven número y `qrUrl`.",
      "Todo lo que mueve dinero se audita DESPUÉS de la mutación y FUERA de la transacción, con un resumen. Ojo: `Cost` no tiene campo `amount`.",
    ],
    doc: "docs/modules/billing.md",
  },
  billing_banco: {
    hace: "El extracto real del banco dentro del CRM (PSD2, solo lectura) y su casado con cobros y gastos.",
    trae: [{ que: "Movimientos del banco y conciliación; desde un cobro se salta a su movimiento", donde: "/facturacion/banco" }],
    ojo: [
      "Submódulo de Facturación, con la convención de la casa (clave con el prefijo del padre). Nunca se vende suelto.",
      "Credenciales BYOK de GoCardless del PROPIO cliente (Configuración → Conexiones), y el consentimiento del banco caduca cada 90 días.",
    ],
    doc: "docs/modules/banco.md",
  },

  // ── Productos ───────────────────────────────────────────────────────────
  productos: {
    hace: "El catálogo de lo que se vende: cada producto con su referencia, su unidad y su precio.",
    trae: [{ que: "Catálogo: alta, edición y precio de venta y de compra", donde: "/productos" }],
    ojo: [
      "EL PRODUCTO Y SU PRECIO SON DE AQUÍ (03/09/2026): Inventario ya no da de alta ni edita, y la Tienda enseña el precio pero no lo toca.",
      "Una sola tabla `products`, la del rework de Inventario. Los endpoints `/api/inventory/products*` exigen `productos`.",
    ],
    doc: "docs/modules/productos.md",
  },
  productos_avanzado: {
    hace: "Las estadísticas de venta encima del catálogo, y la puerta del menú a Inventario, Pedidos y Tienda.",
    trae: [{ que: "Estadísticas de venta en la pantalla de Productos (solo dirección)", donde: "/productos" }],
    ojo: [
      "Es LA PUERTA, no el paquete: Inventario, Pedidos y Tienda siguen siendo claves propias y se marcan (y se facturan) aparte.",
      "Los tres hijos del menú exigen `requiresAll`: el avanzado más su propia clave.",
    ],
    doc: "docs/modules/productos.md",
  },
  inventory: {
    hace: "El almacén de los productos del catálogo: entradas, ajustes, movimientos y mínimos.",
    trae: [{ que: "Stock, entradas de mercancía, movimientos y avisos de mínimo", donde: "/inventario" }],
    ojo: [
      "El stock es la SUMA DE MOVIMIENTOS, no un número guardado (rework del 02/08/2026).",
      "`Supplier` es compartido con Gastos de Facturación.",
      "Desde el 03/09/2026 ya no da de alta productos: eso es `productos`.",
    ],
    doc: "docs/modules/inventory.md",
  },
  orders: {
    hace: "Pedidos de cliente con líneas y estados; sus líneas son productos del catálogo.",
    trae: [
      { que: "Pedidos, con sus líneas y estados", donde: "/pedidos" },
      { que: "Configuración de pedidos", donde: "/pedidos/configuracion" },
    ],
    ojo: [
      "Dar un pedido por servido es lo que genera la factura borrador: sin `billing` responde 403 y el pedido se queda en borrador para siempre.",
      "Sus tablas las crea `migrate-orders` desde el 03/09/2026 (antes era un script de `_hechos/`).",
    ],
    doc: "docs/modules/productos.md",
  },
  tienda: {
    hace: "Escaparate público del catálogo con carrito y pago por Stripe; el pedido entra en Pedidos.",
    trae: [{ que: "Qué se publica, con qué foto y con qué variantes", donde: "/tienda" }],
    ojo: [
      "El pedido nace en `draft` y SOLO el webhook de Stripe lo confirma y descuenta stock. Nunca confirmar desde el navegador.",
      "Los productos son los del catálogo: aquí solo se añaden campos de escaparate. El precio se cambia en Productos.",
      "Se incrusta con un widget o el shortcode `[crm_tienda]`. Reina: laura_ubeda.",
    ],
    doc: "docs/modules/tienda.md",
  },

  // ── Salud ───────────────────────────────────────────────────────────────
  pacientes: {
    hace: "Separa al paciente de quien paga: el cliente es la familia, el paciente es el hijo.",
    trae: [{ que: "Fichas de paciente, con sus contratos y su familia detrás", donde: "/pacientes" }],
    ojo: [
      "El alta crea cliente y pacientes EN LA MISMA TRANSACCIÓN.",
      "Los registros clínicos toman su `client_id` del paciente al crearse: es una foto, no se recalcula.",
      "Interruptor `pacientes.altaPorPaciente`.",
    ],
    doc: "docs/modules/pacientes.md",
  },
  clinica: {
    hace: "El trabajo clínico: sesiones (audio→Whisper→IA), informes, coordinaciones y diagnósticos.",
    trae: [
      { que: "Sesiones del centro", donde: "/clinica" },
      { que: "Informes clínicos", donde: "/clinica/informes" },
      { que: "Coordinaciones con colegios y otros profesionales", donde: "/clinica/coordinaciones" },
      { que: "Talleres", donde: "/clinica/talleres" },
      { que: "Diagnósticos: el expediente de un producto de horas, con su barra contada desde las citas", donde: "/clinica/diagnosticos" },
      { que: "Estadísticas del centro (solo dirección)", donde: "/clinica/estadisticas" },
    ],
    ojo: [
      "Reina: Aumenta, y con mucho (22.045 sesiones). No se siembra ni se wipea nada suyo sin permiso.",
      "Transcribir es SIEMPRE Whisper (clave de OpenAI); redactar va por el proveedor que elija el tenant (Claude o ChatGPT). Sin clave del cliente, 503.",
      "Nada de IA se dispara solo: cuesta dinero.",
      "Datos de salud: la auditoría guarda un RESUMEN, nunca la fila.",
    ],
    doc: "docs/modules/clinica.md",
  },
  nutricion: {
    hace: "Alimentos, recetas, menús semanales y las pautas asignadas a cada paciente.",
    trae: [
      { que: "Alimentos (497 de fábrica al activar)", donde: "/nutricion/alimentos" },
      { que: "Recetario", donde: "/nutricion/recetas" },
      { que: "Menús (plantillas)", donde: "/nutricion/plantillas" },
      { que: "Pautas: qué menú tiene asignado cada persona", donde: "/nutricion/asignados" },
    ],
    ojo: [
      "Reina: nutri_laura. Sus pacientes son `Client` con plan: NO tiene `clinica` ni `pacientes`.",
      "Interruptor `nutricion.autoAsignarEnAlta`. En Aumenta está APAGADO a propósito: con 1.083 familias marcaría de dietas a quien solo va a terapia.",
      "Sus componentes viven en `modules/nutricion/`.",
    ],
    doc: "docs/modules/nutricion.md",
  },

  // ── Captación y web ─────────────────────────────────────────────────────
  leads: {
    hace: "El embudo por etapas de quien deriva o pregunta: profesionales, centros y contactos directos.",
    trae: [
      { que: "El embudo", donde: "/leads" },
      { que: "Estadísticas del embudo (es el padre del grupo en el menú)", donde: "/leads/estadisticas" },
    ],
    ojo: [
      "Las etapas son POR CLIENTE y se declaran en `lib/leads/embudos.js` (con `_smoke-leads-etapas.mjs`), no en la pantalla.",
      "Es donde más pantallas propias hay: cuatro clientes (aumenta, nutri_laura, retorika, spain_enzymes). El base es el de Aumenta.",
      "No confundir `Lead` (oportunidad) con `OutreachLead` (empresa captada): no hay FK entre ellos.",
    ],
    doc: "docs/modules/leads.md",
  },
  formularios: {
    hace: "Lo que llega por la web: formularios públicos que caen en una bandeja y se convierten en ficha.",
    trae: [{ que: "Bandeja de solicitudes: aceptar, rechazar y convertir en ficha", donde: "/formularios" }],
    ojo: [
      "Requiere `leads`: en el menú son los dos hijos del mismo grupo (Profesionales / Comerciales).",
      "La web del cliente publica contra `/api/public/leads`. Cambiar ese contrato rompe webs de terceros (spain_enzymes).",
    ],
    doc: "docs/modules/formularios.md",
  },
  outreach: {
    hace: "Captación en frío: buscar empresas y puntuarlas con IA antes de llamarlas.",
    trae: [
      { que: "Empresas captadas, con su análisis y su puntuación", donde: "/outreach" },
      { que: "Configuración de la búsqueda", donde: "/outreach/configuracion" },
    ],
    ojo: [
      "Gasta IA y Google Places con las claves DEL PROPIO CLIENTE. Sin clave, 503.",
      "`OutreachLead` es una empresa captada, no una oportunidad: `Lead` es otra cosa.",
    ],
    doc: "docs/modules/outreach.md",
  },
  mailing: {
    hace: "Email marketing: campañas y newsletters a quien ya es cliente y ha marcado «novedades».",
    trae: [
      { que: "Campañas, con editor por bloques, A/B de asunto y métricas de clic", donde: "/mailing" },
      { que: "Segmentos con datos del CRM", donde: "/mailing/segmentos" },
      { que: "Secuencias por eventos (alta, cumpleaños, sin cita)", donde: "/mailing/secuencias" },
      { que: "La lista de suscriptores", donde: "/mailing/lista" },
      { que: "Bajas y supresión", donde: "/mailing/bajas" },
    ],
    ojo: [
      "SALE POR AMAZON SES (BYOK, cuenta del propio cliente), NUNCA por Resend: una campaña con quejas no puede arrastrar a los recordatorios de cita.",
      "Sin SDK de AWS: la firma se hace a mano en `lib/mailing/sigv4.js`.",
      "Solo a quien ha consentido (`lib/clients/comunicaciones.js`). No requiere `clients`: sin él, solo correos sueltos.",
      "El envío va por lotes reanudable, con el temporizador `crm-mailing.timer` cada minuto.",
    ],
    doc: "docs/modules/mailing.md",
  },
  booking: {
    hace: "Para quien vende actuaciones: NO trae pantallas, cambia las que ya hay.",
    trae: [
      { que: "El embudo de Leads pasa a ser el de contratación (propuesta, respuesta, caché, fecha cerrada) y se rotula «Propuestas»", donde: "/leads" },
      { que: "Clientes pasa a llamarse «Contratantes»", donde: "/clientes" },
    ],
    ojo: [
      "Es el primer módulo que decide VOCABULARIO y EMBUDO, y siempre se pregunta por módulo, nunca por slug: el segundo cliente del sector tiene que salir bien de fábrica.",
      "Cambia el embudo y el rótulo para TODO el cliente, no para una pantalla.",
      "Reina: laura_ubeda.",
    ],
    doc: "docs/modules/booking.md",
  },
  analytics: {
    hace: "Las visitas de la web del cliente, día a día y con su histórico, dentro del CRM.",
    trae: [{ que: "Visitas web", donde: "/analiticas" }],
    ojo: [
      "Credenciales de Cloudflare POR CLIENTE. Sin ellas la pantalla dice «sin configurar»: no es un fallo.",
      "Vive en el área Comercial del menú.",
    ],
    doc: "docs/modules/analytics.md",
  },
  training: {
    hace: "Formación: cursos, alumnos, matrículas por empresa y resultados de los cuestionarios.",
    trae: [
      { que: "Portada de Formación", donde: "/formacion" },
      { que: "Cursos", donde: "/formacion/cursos" },
      { que: "Alumnos", donde: "/formacion/usuarios" },
      { que: "Matrículas", donde: "/formacion/alumnos" },
      { que: "Empresas (se matricula POR EMPRESA, no alumno a alumno)", donde: "/formacion/empresas" },
      { que: "Cuestionarios y sus intentos", donde: "/formacion/cuestionarios" },
    ],
    ojo: [
      "Reina: retorika, con 526 intentos reales. La tabla `quiz_attempts` no se toca.",
      "Se sincroniza con TutorLMS por webhooks firmados con HMAC: exige un WordPress con TutorLMS.",
      "Interruptor `training.formacionAbierta` (portada abierta): esconde Empresas y Cuestionarios. Encendido en Aumenta.",
      "Cuestionarios NO es un módulo: es una pantalla de este (10/08/2026).",
    ],
    doc: "docs/modules/training.md",
  },
};

/**
 * Claves que viven en `master.tenant_modules` y NUNCA van a estar en el
 * catálogo. Sin esta lista salen como «desconocidas» en `/admin/modulos` y
 * parece un fallo cada vez que se mira la pantalla. La prueba comprueba que
 * ninguna está en `CLAVES_VALIDAS`: el día que una se promocione, chirría.
 */
export const FUERA_DEL_CATALOGO = {
  provisioning: "Nuestro propio panel (admin.). No se vende: solo lo tiene el tenant salamandra_solutions.",
  cuestionarios: "Retirado el 10/08/2026: es una pantalla de Formación, no un módulo. Sus endpoints siempre exigieron `training`.",
  referidos: "Retirado el 12/08/2026 con su cliente (abarcaia). Nunca tuvo tabla propia.",
  sales: "Retirado el 12/08/2026: la única clave comercial es `leads`.",
  planning: "Placeholder del sidebar, sin página detrás. Nadie lo activa.",
  ai: "Placeholder del sidebar, sin página detrás.",
  automations: "Placeholder del sidebar, sin página detrás. Las automatizaciones van por n8n, fuera del CRM.",
  integrations: "Placeholder del sidebar, sin página detrás. La Configuración es universal.",
  communications: "Placeholder del sidebar, sin página detrás.",
};

/** La ficha de un módulo, o null si esa clave no tiene ninguna. */
export function fichaDe(clave) {
  return FICHAS[clave] ?? null;
}
