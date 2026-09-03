/**
 * Qué necesita cada módulo para funcionar — la matriz de dependencias.
 *
 * EN QUÉ SE DIFERENCIA DE LOS OTROS DOS FICHEROS (10/08/2026)
 * Ya había dos capas escritas y faltaba la de en medio:
 *
 *   · `catalogo.js` → `requiere`: lo que el ALTA marca sola. Es una decisión de
 *     venta, y por eso está incompleta a propósito en algunos sitios y por
 *     descuido en otros (ver DISCREPANCIAS, abajo).
 *   · `integraciones.js` → por dónde se TOCAN dos módulos que ya están los dos.
 *     Contesta «¿qué se le rompe a este cliente si le apago esto?».
 *   · esto → qué le hace falta a un módulo para que SIRVA. Contesta la pregunta
 *     que se hace ANTES de vender: «¿esto se puede vender solo?».
 *
 * POR QUÉ HACÍA FALTA
 * Se puede marcar Facturación sola en el alta de clientes. Y un cliente con
 * Facturación y sin Clientes **no puede emitir ni una factura**: `clientId` es
 * NOT NULL en `invoices` y las fichas solo se crean desde el módulo Clientes,
 * que le respondería 403. Eso no estaba escrito en ninguna parte y no lo
 * impedía nada.
 *
 * DOS NIVELES, Y LA DIFERENCIA IMPORTA AL VENDER
 *   · `obligatorio` — sin el otro, esto no hace aquello para lo que se vende.
 *   · `parcial` — funciona solo; pierde una utilidad concreta, que se nombra.
 * Un `parcial` NO es un aviso: casi siempre es deliberado (Quality Energy tiene
 * Leads y no quiere fichas). Se enseña, no se alarma.
 *
 * DOS ALTURAS DE LECTURA
 * Cada módulo lleva un `resumen` de una línea —lo que se lee en la tabla, de un
 * vistazo— y además el detalle por dependencia, con su `porque` y su `donde`.
 * No es duplicar: es que la pregunta «¿puedo vender esto suelto?» y la pregunta
 * «¿por qué exactamente?» no se hacen en el mismo momento ni con el mismo rato.
 *
 * EL ORDEN DE ESTA LISTA ES EL DE LA TABLA: primero lo que no se puede vender
 * solo, y dentro de eso lo más roto arriba. Se lee de arriba abajo y se para
 * cuando deja de doler.
 *
 * CÓMO SE MANTIENE
 * Igual que `integraciones.js`: se escribe leyendo el CÓDIGO y cada entrada
 * lleva `donde` con fichero y línea. Si al abrir el fichero no está, la entrada
 * se borra. Todo lo de aquí se comprobó contra el VPS el 10/08/2026, llamando a
 * los endpoints reales de los clientes activos.
 *
 * ── ESTO YA NO SE MIRA: MANDA (10/08/2026, Jorge) ───────────────────────────
 *
 * Hasta hoy la matriz era una tabla que se leía en el back-office, y el alta de
 * clientes seguía dejando marcar Facturación sin Clientes. Ahora `validarSeleccion()`
 * es la ÚNICA puerta por la que pasan el alta y la edición de módulos, así que
 * escribir aquí una dependencia obligatoria la hace cumplirse en producción.
 * Ojo con eso al añadir entradas: una obligatoria de más cierra una venta.
 *
 * Y NO ARREGLA NADA POR SU CUENTA. Antes el alta arrastraba las dependencias en
 * silencio: pedías Clínica y entraban Pacientes y Clientes sin decir nada. Lo
 * que entra en esa lista entra en el contrato y en la factura del cliente, así
 * que ahora se dice qué falta y se para. La pantalla ofrece completar la cadena
 * de un clic, pero es el clic de una persona.
 *
 * Las `parcial` NO bloquean nunca: son deliberadas (Quality Energy tiene Leads
 * y no quiere fichas). Se enseñan como nota y ya.
 */

import { CATALOGO, CLAVES_VALIDAS, moduloPorClave } from "./catalogo.js";

export const NIVELES = {
  obligatorio: "Sin el otro módulo no sirve para lo que se vende",
  parcial: "Funciona solo, pero pierde esta utilidad",
};

/**
 * `claves` es SIEMPRE un array. Con `cualquiera: true` basta uno de ellos —el
 * caso es Equipo avanzado, cuyas pantallas se alimentan de Clínica o de Citas—;
 * si no, hacen falta todos.
 *
 * `paraFuncionar` es la columna de la tabla, en las palabras con las que se
 * contesta al teléfono: «Sí, total» / «Sí» / «En la práctica sí» / «No».
 */
export const DEPENDENCIAS = [
  // ══ NO SE VENDEN SOLOS ═══════════════════════════════════════════════════
  // `referidos` encabezaba esta lista y se fue entera el 12/08/2026, con el
  // módulo y con su cliente (abarcaia). El porqué, en `catalogo.js`.
  {
    modulo: "orders",
    paraFuncionar: "Sí, total",
    resumen:
      "`Order.clientId` es NOT NULL → no se puede crear un pedido. Y completarlo da 403 sin Facturación.",
    necesita: [
      {
        claves: ["clients"],
        nivel: "obligatorio",
        porque: "El pedido exige ficha de cliente: `clientId` es NOT NULL.",
        donde: ["models/tenant/Order.model.js:24", "app/api/orders/route.js:64"],
      },
      {
        claves: ["billing"],
        nivel: "obligatorio",
        porque:
          "Dar un pedido por servido devuelve 403 sin Facturación, con ese mensaje exacto: completar es lo que genera la factura borrador. Sin ella el pedido se queda en borrador para siempre.",
        donde: ["app/api/orders/[id]/complete/route.js:35"],
      },
      {
        claves: ["productos_avanzado"],
        nivel: "obligatorio",
        porque:
          "Desde el 03/09/2026 Pedidos cuelga de Productos en el menú, y su entrada exige el avanzado: sin él la pantalla existe pero no hay por dónde llegar.",
        donde: ["components/layout/Sidebar.jsx:504"],
      },
      {
        claves: ["inventory"],
        nivel: "parcial",
        porque:
          "Sin Inventario el pedido se completa igual, pero no comprueba existencias ni descuenta stock.",
        donde: ["app/api/orders/[id]/complete/route.js:96", "lib/inventory/stock.js:70"],
      },
    ],
  },
  // Fichaje entró aquí el 19/08/2026: estaba en el catálogo (`requiere: ["team"]`)
  // desde que se hizo el módulo y nadie lo apuntó en la matriz, así que
  // `sinEstudiar()` devolvía ["fichaje"], `seVendeSolo` decía que sí y la pasada
  // de «rotos» de /admin/integraciones no veía a un cliente con Fichaje sin
  // Equipo. Lo sacó `_smoke-provisioning-dependencias.mjs`.
  {
    modulo: "fichaje",
    paraFuncionar: "Sí, total",
    resumen:
      "`Fichaje.teamMemberId` es NOT NULL y cada fila del Excel se casa con alguien de la plantilla → sin Equipo no entra ni una fila.",
    necesita: [
      {
        claves: ["team"],
        nivel: "obligatorio",
        porque:
          "Cada fichaje es de una persona de la plantilla —`teamMemberId` es NOT NULL— y el importador bloquea toda fila del Excel que no case con alguien del equipo. Sin Equipo no hay con quién casar: el preview lo bloquea todo y no entra ni una fila. Y la entrada del menú cuelga del grupo Equipo. Exige `team`, NO `team_avanzado`: quien lo compra es justo quien solo quiere plantilla.",
        donde: [
          "models/tenant/Fichaje.model.js:44",
          "lib/fichaje/importar.js:102",
          "components/layout/Sidebar.jsx:220",
          "components/layout/Sidebar.jsx:241",
        ],
      },
    ],
  },
  {
    modulo: "billing",
    paraFuncionar: "Sí",
    resumen:
      "`Invoice.clientId` es NOT NULL y las fichas solo se crean desde Clientes → no puede emitir una factura.",
    necesita: [
      {
        claves: ["clients"],
        nivel: "obligatorio",
        porque:
          "Toda factura va a nombre de una ficha —`clientId` es NOT NULL— y las fichas solo se crean desde el módulo Clientes, que sin contratar responde 403. Con Facturación sola se pueden configurar series, tarifas, gastos y el arqueo de caja, pero no se puede emitir ni una factura porque no hay a quién.",
        donde: ["models/tenant/Invoice.model.js:12", "app/api/clients/route.js:123"],
      },
      {
        claves: ["team"],
        nivel: "parcial",
        porque:
          "Sin Equipo, las facturas, gastos y tarifas no cuelgan de nadie: se pierde la rentabilidad por persona y el arqueo no queda firmado.",
        donde: [
          "models/tenant/Invoice.model.js:41",
          "app/api/billing/analytics/employees/route.js:80",
        ],
      },
    ],
  },
  {
    modulo: "billing_banco",
    paraFuncionar: "Sí, total",
    resumen:
      "La conciliación casa movimientos con cobros (`payments`) y gastos (`costs`), que son de Facturación → sin ella no hay con qué casar ni desde dónde llegar.",
    necesita: [
      {
        claves: ["billing"],
        nivel: "obligatorio",
        porque:
          "El extracto solo sirve casado: cada movimiento se ata a un cobro o a un gasto de Facturación, y la pantalla vive en su pestaña (/facturacion/banco). Sin `billing` no hay cobros, no hay gastos y no hay menú por el que entrar.",
        donde: [
          "app/api/banco/casar/route.js:1",
          "app/(dashboard)/facturacion/_components/FacturacionNav.jsx:1",
          "components/layout/Sidebar.jsx:264",
        ],
      },
    ],
  },
  {
    modulo: "nutricion",
    paraFuncionar: "Sí",
    resumen:
      "Alimentos, recetario y menús funcionan, pero no se puede asignar ni enviar una pauta a nadie.",
    necesita: [
      {
        claves: ["clients"],
        nivel: "obligatorio",
        porque:
          "Alimentos, recetario y menús funcionan solos, pero asignar una pauta exige elegir una ficha y el servidor comprueba que exista. Sin Clientes no hay a quién asignar ni a qué correo enviarla: el recetario se queda en un cuaderno.",
        donde: [
          "app/api/nutricion/plans/[id]/assign/route.js:47",
          "app/api/nutricion/plans/[id]/send-email/route.js:63",
        ],
      },
    ],
  },
  {
    modulo: "formularios",
    paraFuncionar: "Sí",
    resumen: "Aceptar una solicitud crea una ficha: sin Clientes no hay dónde caer.",
    necesita: [
      {
        claves: ["clients", "leads"],
        nivel: "obligatorio",
        porque:
          "Aceptar una solicitud crea la ficha del cliente: sin Clientes no hay dónde caer. Y una bandeja de leads comerciales sin embudo donde continuar no es un producto — por eso el catálogo exige los dos.",
        donde: ["lib/formularios/accept.js:47", "lib/provisioning/catalogo.js:64"],
      },
      {
        claves: ["pacientes"],
        nivel: "parcial",
        porque: "Con Pacientes, aceptar crea además la ficha del menor en la misma operación.",
        donde: ["lib/formularios/accept.js:113"],
      },
    ],
  },
  {
    modulo: "pacientes",
    paraFuncionar: "Sí",
    resumen: "El paciente cuelga de la familia que paga.",
    necesita: [
      {
        claves: ["clients"],
        nivel: "obligatorio",
        porque:
          "El paciente cuelga de la familia que paga; el alta de la familia es la que los crea.",
        donde: ["models/tenant/Patient.model.js:25", "app/api/clients/route.js:189"],
      },
      {
        claves: ["team"],
        nivel: "parcial",
        porque: "Sin Equipo no hay desplegable de terapeuta de referencia: el campo ni se pinta.",
        donde: ["models/tenant/Patient.model.js:88", "app/(dashboard)/pacientes/[id]/page.jsx:345"],
      },
      {
        claves: ["citas"],
        nivel: "parcial",
        porque:
          "La ficha del paciente deja de enseñar sus citas y el estado del contrato de su familia.",
        donde: ["app/(dashboard)/pacientes/[id]/page.jsx:328"],
      },
    ],
  },
  {
    modulo: "clinica",
    paraFuncionar: "Sí",
    // El «(→ Clientes)» se escribe a mano: la cadena es Clínica → Pacientes →
    // Clientes y quien lee la tabla tiene que ver que compra tres cosas.
    necesitaTexto: "Pacientes (→ Clientes)",
    resumen: "Sin ficha de paciente no hay sesión, informe ni coordinación.",
    necesita: [
      {
        claves: ["pacientes"],
        nivel: "obligatorio",
        porque:
          "No hay sesión, informe ni coordinación sin una ficha de paciente de la que colgar.",
        donde: ["lib/provisioning/catalogo.js:57", "models/tenant/ClinicSession.model.js:25"],
      },
      {
        claves: ["citas"],
        nivel: "parcial",
        porque:
          "«Enviar al paciente» archiva el informe en PDF para que la familia lo abra en su área privada, y el área privada es de Citas. Sin ella el informe se redacta pero no llega.",
        donde: ["app/api/clinica/reports/[id]/enviar/route.js:49"],
      },
      {
        claves: ["team_avanzado"],
        nivel: "parcial",
        porque:
          "Desempeño, Dirección, Productividad, Incidencias y Bandeja de trabajo se alimentan de datos clínicos pero son pantallas de Equipo avanzado: sin él, 403.",
        donde: ["app/api/clinica/bandeja/route.js:26", "components/layout/Sidebar.jsx:212"],
      },
    ],
  },
  {
    modulo: "team_avanzado",
    paraFuncionar: "Sí",
    resumen: "Con `team` solo funciona Actividad; las otras 6 pantallas dan 403.",
    necesita: [
      {
        claves: ["team"],
        nivel: "obligatorio",
        porque: "Es la capa avanzada sobre la plantilla.",
        donde: ["lib/provisioning/catalogo.js:31"],
      },
      {
        claves: ["clinica", "citas"],
        cualquiera: true,
        nivel: "obligatorio",
        porque:
          "De sus siete pantallas, seis exigen ADEMÁS el módulo que aporta el contenido: Desempeño, Dirección, Productividad, Incidencias y Bandeja necesitan Clínica; Ocupación necesita Citas. Con Equipo avanzado a secas solo funciona «Actividad». El menú lo esconde y los endpoints lo vuelven a comprobar.",
        donde: [
          "components/layout/Sidebar.jsx:212",
          "components/layout/Sidebar.jsx:222",
          "app/api/clinica/productividad/route.js:22",
          "app/api/citas/informe-ocupacion/route.js:27",
        ],
      },
    ],
  },
  {
    modulo: "clients_avanzado",
    paraFuncionar: "Sí",
    resumen: "Es una capa sobre las fichas.",
    necesita: [
      {
        claves: ["clients"],
        nivel: "obligatorio",
        porque: "Es una capa sobre las fichas: lista de espera de admisión y huecos de datos.",
        donde: ["lib/provisioning/catalogo.js:28"],
      },
      {
        claves: ["pacientes", "citas"],
        nivel: "parcial",
        porque:
          "«Fichas a completar» cruza familias, pacientes y agenda. Sin ellos quedan las carpetas que solo miran la ficha, y el módulo pierde casi todo su sentido — resuelve el problema de un centro que importó mil familias.",
        donde: ["lib/clients/urgentes.js:185", "lib/clients/urgentes.js:335"],
      },
    ],
  },
  {
    modulo: "documents_avanzado",
    paraFuncionar: "Sí",
    resumen: "Es el archivo completo sobre el básico.",
    necesita: [
      {
        claves: ["documents"],
        nivel: "obligatorio",
        porque: "Es el archivo completo montado sobre el básico.",
        donde: ["lib/provisioning/catalogo.js:33", "app/api/documents/route.js:31"],
      },
    ],
  },
  {
    modulo: "tienda",
    paraFuncionar: "Sí",
    resumen: "Es el escaparate de lo que ya hay en Inventario: sin los tres del trío no hay ni qué vender, ni dónde caer el pedido, ni a quién facturárselo.",
    necesita: [
      {
        claves: ["inventory", "orders", "clients"],
        nivel: "obligatorio",
        porque:
          "La tienda no tiene catálogo propio: vende la tabla `products` de Inventario, y al cobrar crea un pedido en Pedidos y una ficha de cliente con el comprador. Es el trío completo o no es nada — un escaparate sin almacén enseñaría una lista vacía, y un pago sin pedido dejaría el dinero cobrado y a nadie sabiendo qué hay que enviar.",
        donde: [
          "models/tenant/Product.model.js:1",
          "app/api/orders/route.js:1",
          "models/tenant/StockMovement.model.js:46",
        ],
      },
      {
        claves: ["productos", "productos_avanzado"],
        nivel: "obligatorio",
        porque:
          "La pantalla de la tienda lee y publica los productos por el endpoint del catálogo, que desde el 03/09/2026 exige `productos`; y su entrada de menú cuelga de Productos avanzado.",
        donde: ["modules/tienda/TiendaModule.jsx:30", "app/api/inventory/products/route.js:17", "components/layout/Sidebar.jsx:505"],
      },
      {
        claves: ["billing"],
        nivel: "parcial",
        porque:
          "Sin Facturación el pedido se cobra y se sirve, pero no hay de dónde sacar la factura: `orders.invoice_id` se queda vacío y el IVA que lleva cada producto no acaba en ningún sitio.",
        donde: ["models/tenant/Order.model.js:67"],
      },
    ],
  },
  /*
   * PRODUCTOS AVANZADO e INVENTARIO (03/09/2026). El día que Inventario, Pedidos
   * y Tienda pasaron a colgar de «Productos», Inventario dejó de venderse solo:
   * su lista de productos vive en el endpoint del catálogo (`productos`) y su
   * entrada de menú exige el avanzado. Y el avanzado no es nada sin el básico
   * —es la misma pantalla con estadísticas encima— ni dice gran cosa sin
   * Pedidos, que es de donde salen las ventas.
   */
  {
    modulo: "productos_avanzado",
    paraFuncionar: "Sí",
    resumen: "Son las estadísticas y los submódulos ENCIMA del catálogo básico; sin Pedidos, las cifras salen a cero.",
    necesita: [
      {
        claves: ["productos"],
        nivel: "obligatorio",
        porque:
          "La pantalla de Productos es una sola: el avanzado pinta las estadísticas encima de la lista del básico, y la página responde 404 sin `productos`.",
        donde: ["app/(dashboard)/productos/page.jsx:40", "lib/provisioning/catalogo.js:100"],
      },
      {
        claves: ["orders"],
        nivel: "parcial",
        porque:
          "Las estadísticas de venta se calculan sobre los pedidos. Sin Pedidos el bloque avisa de que no hay de dónde contar y los submódulos siguen a su aire.",
        donde: ["lib/productos/estadisticas.js:60"],
      },
    ],
  },
  {
    modulo: "inventory",
    paraFuncionar: "Sí",
    resumen:
      "El almacén de los productos del catálogo: sin `productos` su lista responde 403, y sin el avanzado no sale en el menú. Sin Equipo la entrada no queda firmada; sin Pedidos solo hay salidas por ajuste manual.",
    necesita: [
      {
        claves: ["productos", "productos_avanzado"],
        nivel: "obligatorio",
        porque:
          "La lista de productos del almacén es el endpoint del catálogo, que exige `productos`; y la entrada «Inventario» del menú cuelga de Productos avanzado.",
        donde: ["app/api/inventory/products/route.js:17", "components/layout/Sidebar.jsx:503"],
      },
      {
        claves: ["team"],
        nivel: "parcial",
        porque:
          "Las entradas y los ajustes se firman con la persona que ha entrado. Sin Equipo el histórico no dice quién lo hizo, que es la primera pregunta cuando el stock no cuadra.",
        donde: ["models/tenant/StockMovement.model.js:65", "app/api/inventory/entries/route.js:63"],
      },
      {
        claves: ["orders"],
        nivel: "parcial",
        porque:
          "Sin Pedidos no hay salidas de almacén por venta: el stock solo baja por ajuste manual.",
        donde: ["app/api/orders/[id]/complete/route.js:96"],
      },
    ],
  },
  {
    modulo: "booking",
    paraFuncionar: "Sí",
    resumen: "No trae pantallas propias: reetiqueta y reordena las de Leads y Clientes, así que sin ellas no hay módulo.",
    necesita: [
      {
        claves: ["clients", "leads"],
        nivel: "obligatorio",
        porque:
          "Booking no es una pantalla nueva, es un cambio en dos que ya existen: el embudo de Leads pasa a ser el de contratación (propuesta enviada, han respondido, negociando caché, fecha cerrada) y Clientes pasa a rotularse «Contratantes». Sin los dos módulos no hay nada que cambiar y el cliente compraría un menú vacío.",
        donde: [
          "lib/leads/embudos.js:120",
          "lib/clients/vocabulario.js:73",
          "app/(dashboard)/leads/page.jsx:67",
        ],
      },
      {
        claves: ["billing"],
        nivel: "parcial",
        porque:
          "El presupuesto de una actuación —caché, músicos, sonido, dietas— se hace en Facturación. Sin ella el embudo llega hasta «fecha cerrada» y ahí se acaba: hay bolo, pero no hay con qué presupuestarlo ni cobrarlo.",
        donde: ["app/(dashboard)/facturacion/presupuestos/page.jsx:1"],
      },
      {
        claves: ["outreach"],
        nivel: "parcial",
        porque:
          "Captación es de donde salen los objetivos que aún no se han contactado —salas, teatros, ayuntamientos— y donde vive la lista de prensa. Sin ella el embudo funciona, pero hay que meter cada festival a mano.",
        donde: ["modules/outreach/OutreachModule.jsx:7"],
      },
    ],
  },
  {
    modulo: "documents",
    paraFuncionar: "Sí",
    resumen:
      "Necesita Clientes, porque un documento cuelga de una ficha. Pierde, sin Citas, la firma en el área privada.",
    necesita: [
      {
        claves: ["clients"],
        nivel: "obligatorio",
        porque:
          "Un documento cuelga de una ficha: sin Clientes no hay a qué enlazarlo ni desde dónde abrirlo.",
        donde: ["app/api/documents/route.js:31"],
      },
      {
        // BAJADO DE `obligatorio` A `parcial` el 24/08/2026 (Rodrigo): «puede
        // venir bien y estar integrado, pero no depender de ello».
        //
        // Era una regla de VENTA, no del código: el único gate de
        // `/api/documents/contrato-servicios` siempre fue DOCUMENTS. La regla
        // se escribió pensando en centros que atienden familias, y dejó fuera
        // al primer cliente que quiso Documentos para otra cosa —guardar un
        // rider técnico y un dossier de prensa—, que no tiene ni tendrá Citas.
        claves: ["citas"],
        nivel: "parcial",
        porque:
          "Sin Citas no hay área privada, así que el contrato se sube, se ve y se descarga, pero nadie lo firma en línea. Para un centro que atiende familias eso es media función; para quien solo archiva documentos, no le falta nada.",
        donde: [
          "app/api/public/c/[tenantSlug]/citas-portal/contract/sign/route.js:143",
          "lib/citas/portalClient.js:65",
        ],
      },
    ],
  },

  // ══ SE VENDEN SOLOS, PERO PIERDEN ALGO ═══════════════════════════════════

  {
    modulo: "citas",
    paraFuncionar: "No",
    resumen:
      "La agenda y la reserva pública funcionan solas. Pierde: profesional en la cita (Equipo), ficha, permisos y área privada (Clientes), paciente concreto (Pacientes) e informe de ocupación (Equipo avanzado).",
    necesita: [
      {
        claves: ["team"],
        nivel: "parcial",
        porque:
          "Sin Equipo la cita no lleva profesional —el campo ni se ofrece— y no hay a quién asignar las que se quedan sueltas. Healim la tiene así: agenda del centro, sin reparto por persona.",
        donde: ["models/tenant/Booking.model.js:119", "app/api/citas/sin-profesional/route.js:41"],
      },
      {
        claves: ["clients"],
        nivel: "parcial",
        porque:
          "La cita se ata a la ficha por el correo. Sin Clientes se pierden los permisos de aviso de cada familia, el área privada y la autoconfirmación.",
        donde: ["models/tenant/Booking.model.js:145", "lib/clients/comunicaciones.js:129"],
      },
      {
        claves: ["pacientes"],
        nivel: "parcial",
        porque:
          "No se puede decir qué hijo de la familia viene a la cita: el campo se ignora en silencio.",
        donde: ["models/tenant/Booking.model.js:127"],
      },
      {
        claves: ["team_avanzado"],
        nivel: "parcial",
        porque: "El informe de ocupación —cuántas sillas se quedaron vacías— responde 403.",
        donde: ["app/api/citas/informe-ocupacion/route.js:27"],
      },
    ],
  },
  {
    modulo: "projects",
    paraFuncionar: "No",
    resumen: "Solo el admin edita: ser responsable exige ficha de Equipo.",
    necesita: [
      {
        claves: ["team"],
        nivel: "parcial",
        porque:
          "Ser responsable de un proyecto exige ficha de Equipo, y los miembros son fichas de Equipo. Sin él los tableros funcionan, pero solo el admin puede editar y no se reparte nada.",
        donde: ["lib/projects/projectAuth.js:27", "models/tenant/ProjectMember.model.js:29"],
      },
    ],
  },
  {
    modulo: "support",
    paraFuncionar: "No",
    resumen:
      "Tickets y portal funcionan. Sin Equipo no hay responsable, «mis tickets» sale vacío y no hay avisos.",
    necesita: [
      {
        claves: ["team"],
        nivel: "parcial",
        porque:
          "Los tickets, el portal público y la entrada por correo funcionan solos. Sin Equipo no hay responsable a quien asignarlos, «mis tickets» sale vacío y nadie recibe los avisos de plazo vencido.",
        donde: ["models/tenant/Ticket.model.js:61", "lib/support/notify.js:239"],
      },
      {
        claves: ["clients"],
        nivel: "parcial",
        porque:
          "El ticket se engancha solo a la ficha por el correo. Sin Clientes nace suelto con el nombre y el email de quien escribe — no se pierde, pero no hay historial por cliente.",
        donde: ["models/tenant/Ticket.model.js:30", "lib/support/context.js:50"],
      },
    ],
  },
  {
    modulo: "outreach",
    paraFuncionar: "No",
    resumen: "Busca y analiza igual. «Convertir en cliente» avisa en vez de crear.",
    necesita: [
      {
        claves: ["clients"],
        nivel: "parcial",
        porque:
          "Busca empresas y las analiza igual. Lo que no puede es rematar: «convertir en cliente» avisa en vez de crear la ficha.",
        donde: ["app/api/outreach/leads/[id]/convertir-cliente/route.js:33"],
      },
    ],
  },
  // `inventory` estuvo aquí (solo parciales) hasta el 03/09/2026: subió a
  // «no se venden solos» al colgar de Productos.
  {
    modulo: "calendar",
    paraFuncionar: "No",
    resumen: "Los tres son adorno: si faltan, esos campos no se pintan.",
    necesita: [
      {
        claves: ["projects"],
        nivel: "parcial",
        porque:
          "Deja de pintar los hitos y las tarjetas con fecha de Proyectos. Hay interruptor para ocultarlo.",
        donde: ["lib/calendar/projectEvents.js:26"],
      },
      {
        claves: ["team", "clients"],
        nivel: "parcial",
        porque: "La tarea se crea igual: simplemente no se ofrece responsable ni cliente.",
        donde: ["models/tenant/CalendarTask.model.js:60", "models/tenant/CalendarTask.model.js:72"],
      },
    ],
  },
  {
    modulo: "analytics",
    paraFuncionar: "No",
    resumen: "Las visitas van igual. Solo pierde la columna de leads por país.",
    necesita: [
      {
        claves: ["leads"],
        nivel: "parcial",
        porque:
          "Las visitas de la web van igual. Solo se pierde la columna que compara esas visitas con los leads del mismo periodo, y está escrita para que si falla la pantalla siga funcionando.",
        donde: ["app/api/analiticas/route.js:193"],
      },
    ],
  },

  // ══ INDEPENDIENTES ═══════════════════════════════════════════════════════
  { modulo: "clients", paraFuncionar: "No", resumen: "Funciona solo al 100 %.", necesita: [] },
  { modulo: "leads", paraFuncionar: "No", resumen: "Funciona solo al 100 %.", necesita: [] },
  { modulo: "team", paraFuncionar: "No", resumen: "Funciona solo al 100 %.", necesita: [] },
  // Productos básico (03/09/2026): el catálogo con su valor. Sus tablas las
  // crea su propia migración y su pantalla no lee nada de otro módulo.
  { modulo: "productos", paraFuncionar: "No", resumen: "Funciona solo al 100 %: el catálogo y su valor no necesitan nada más.", necesita: [] },
  {
    modulo: "training",
    paraFuncionar: "No",
    resumen: "Funciona solo al 100 %. Lo que necesita es su WordPress, no otro módulo.",
    necesita: [],
    nota: "Es el más independiente del CRM: sus nueve modelos son suyos y no toca ni una tabla de otro módulo. Ojo al venderlo: las matrículas se hacen POR EMPRESA, así que a un cliente B2C que venda cursos a particulares hoy no se le puede matricular a nadie desde el CRM.",
  },
];

/** Índice por clave de módulo. */
const PORMODULO = new Map(DEPENDENCIAS.map((d) => [d.modulo, d]));

/** Las dependencias de un módulo, o `[]` si no tiene o no está escrito. */
export function dependenciasDe(clave) {
  return PORMODULO.get(clave)?.necesita ?? [];
}

/** ¿Se puede vender solo? */
export function seVendeSolo(clave) {
  return !dependenciasDe(clave).some((d) => d.nivel === "obligatorio");
}

/**
 * El texto corto de la columna «Necesita».
 *
 * Si hay obligatorias, solo se enseñan ESAS y unidas con «+»: en una tabla que
 * se lee para decidir si algo se puede vender suelto, mezclar lo imprescindible
 * con lo prescindible en la misma celda las iguala. Si no hay ninguna, se
 * enseñan las parciales separadas por comas. Un grupo `cualquiera` va entre
 * paréntesis con «o», que es como se dice en voz alta.
 */
export function textoNecesita(clave, nombreDe = (k) => k) {
  const propio = PORMODULO.get(clave);
  if (propio?.necesitaTexto) return propio.necesitaTexto;

  const deps = dependenciasDe(clave);
  if (!deps.length) return "—";

  const obligatorias = deps.filter((d) => d.nivel === "obligatorio");
  const trozo = (d) => {
    const nombres = d.claves.map(nombreDe);
    if (d.cualquiera) return `(${nombres.join(" o ")})`;
    return nombres.join(" + ");
  };

  if (obligatorias.length) return obligatorias.map(trozo).join(" + ");
  return deps.flatMap((d) => d.claves.map(nombreDe)).join(", ");
}

/* ══════════════════════════════════════════════════════════════════════════
 * LO QUE EL ALTA EXIGE DE VERDAD
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Las obligatorias de un módulo, mezcladas con lo que declare el catálogo.
 *
 * La mezcla existe para que nadie pierda nada por el camino: la matriz sale de
 * leer el código y el `requiere` del catálogo es una decisión de venta, y hay
 * casos donde lo segundo dice más que lo primero. Leads comerciales exige Leads
 * profesionales no porque el código reviente sin él, sino porque una bandeja sin
 * embudo donde continuar no es un producto. Eso no está en ningún `NOT NULL` y
 * tiene que seguir cumpliéndose.
 */
export function exigenciasDe(clave) {
  const propias = dependenciasDe(clave)
    .filter((d) => d.nivel === "obligatorio")
    .map((d) => ({
      claves: d.claves,
      cualquiera: Boolean(d.cualquiera),
      porque: d.porque,
    }));

  const yaDicho = new Set(propias.flatMap((d) => d.claves));
  const soloDelCatalogo = (moduloPorClave(clave)?.requiere ?? [])
    .filter((k) => !yaDicho.has(k))
    .map((k) => ({
      claves: [k],
      cualquiera: false,
      porque: "Lo exige el catálogo de venta: no se ofrece lo uno sin lo otro.",
      delCatalogo: true,
    }));

  return [...propias, ...soloDelCatalogo];
}

/** ¿La selección cumple esta exigencia? Con alternativa basta uno; si no, todos. */
function cumple(dep, tiene) {
  return dep.cualquiera
    ? dep.claves.some((k) => tiene.has(k))
    : dep.claves.every((k) => tiene.has(k));
}

/** Orden del catálogo, para que dos altas iguales den exactamente la misma lista. */
const ORDEN = () => CATALOGO.flatMap((g) => g.modulos.map((m) => m.key));

/**
 * Las claves de una selección, venga como venga. Lo que no sea un array es una
 * selección vacía, igual que `null` y `undefined` ya lo eran.
 *
 * Por qué lo tolera la función y no lo valida quien llama (21/08/2026): de las
 * tres puertas que entran aquí, `cicloVida.js` ya comprueba `Array.isArray`
 * antes, `paquetes.js` normaliza en `loQueFalta()`, y `altaTenant.js` le pasa
 * `body.modulos` tal cual —el route de `/api/provisioning/clientes` no lo mira—.
 * Con un body `{"modulos": "clients"}` esto reventaba con TypeError y el
 * `catch` del route lo convertía en un 500, cuando la respuesta correcta es el
 * 422 de «Elige al menos un módulo» que ya existe justo debajo. Arreglarlo en
 * un llamador deja a los otros esperando su turno; el contrato de LA PUERTA es
 * «dime qué selección tienes y te digo si se sostiene», y una selección que no
 * es una lista no sostiene nada. Filtrar aquí lo cierra para los tres a la vez
 * y no cambia ni un resultado de los que ya funcionaban.
 */
function clavesDe(seleccion) {
  if (!Array.isArray(seleccion)) return [];
  return [...new Set(seleccion.filter((k) => CLAVES_VALIDAS.has(k)))];
}

/**
 * LA PUERTA. Dice si una selección se sostiene, y NO la arregla por su cuenta.
 *
 * Aquí había antes una cascada silenciosa: pedías Clínica y el alta metía
 * Pacientes y Clientes sin decir nada. Se quitó el 10/08/2026 a petición de
 * Jorge, y el motivo es de negocio, no de código: lo que entra en esa lista
 * entra en el contrato y en la factura del cliente. Que el sistema añada solo
 * dos módulos que nadie ha nombrado es exactamente lo que no puede pasar.
 *
 * Ahora se dice qué falta y no se sigue. Para no obligar a marcar en orden
 * inverso —Clínica te manda a Pacientes y Pacientes a Clientes— la pantalla
 * ofrece completar la cadena de un clic con `completarSeleccion()`, pero es un
 * clic de una persona, y las casillas quedan marcadas a la vista.
 */
export function validarSeleccion(seleccion) {
  const claves = clavesDe(seleccion);
  const tiene = new Set(claves);

  const problemas = [];
  for (const k of claves) {
    for (const dep of exigenciasDe(k)) {
      if (cumple(dep, tiene)) continue;
      // `faltan` es lo que hay que ir a marcar, no el requisito entero. Con
      // Clientes ya puesto, «Documentos básico necesita Citas y Clientes» hace
      // dudar de si Clientes está o no; «necesita Citas» se ejecuta sin pensar.
      // Con alternativa no falta ninguna en concreto: falta elegir.
      const faltan = dep.cualquiera ? dep.claves : dep.claves.filter((c) => !tiene.has(c));
      problemas.push({
        modulo: k,
        claves: dep.claves,
        faltan,
        cualquiera: dep.cualquiera,
        porque: dep.porque,
      });
    }
  }

  return { modulos: ORDEN().filter((k) => tiene.has(k)), problemas };
}

/**
 * Qué habría que añadir para que una selección se sostenga. NO se aplica sola:
 * la usa el botón «añadir también …» de la pantalla de alta.
 *
 * Las alternativas no se resuelven —elegir Clínica o Citas por alguien es
 * meterle un módulo al cliente— y salen en `sinResolver` para que quien mira
 * decida. Si algo sale ahí, el botón no se ofrece: no hay una cadena que
 * completar, hay una decisión que tomar.
 */
export function completarSeleccion(seleccion) {
  const pedidos = clavesDe(seleccion);

  const dentro = new Set();
  const pendientes = [...pedidos];
  while (pendientes.length) {
    const k = pendientes.pop();
    if (dentro.has(k)) continue;
    dentro.add(k);
    for (const dep of exigenciasDe(k)) {
      if (dep.cualquiera) continue;
      for (const necesaria of dep.claves) if (!dentro.has(necesaria)) pendientes.push(necesaria);
    }
  }

  const modulos = ORDEN().filter((k) => dentro.has(k));
  return {
    modulos,
    anadidos: modulos.filter((k) => !pedidos.includes(k)),
    sinResolver: validarSeleccion(modulos).problemas,
  };
}

/**
 * La frase que lee quien está vendiendo, con los nombres de venta y no con las
 * claves internas: «Para activar Nutrición hace falta también Clientes.»
 */
export function fraseDeExigencia({ modulo, claves, faltan, cualquiera }, nombreDe = (k) => k) {
  const lista = (faltan ?? claves).map(nombreDe).join(cualquiera ? " o " : " y ");
  return `Para activar ${nombreDe(modulo)} hace falta también ${lista}.`;
}

/**
 * El catálogo con lo que exige cada módulo pegado a cada entrada.
 *
 * Va en la respuesta del alta para que la PANTALLA aplique exactamente la misma
 * regla que el servidor sin copiarla. Una copia de estas reglas en el cliente
 * se desincroniza el día que alguien toque la matriz, y entonces el formulario
 * deja pulsar y el servidor responde 422 sin que se entienda por qué.
 */
export function catalogoConExigencias() {
  return CATALOGO.map((g) => ({
    ...g,
    modulos: g.modulos.map((m) => ({ ...m, exige: exigenciasDe(m.key) })),
  }));
}

/**
 * DISCREPANCIAS CON EL CATÁLOGO — hoy es una autocomprobación, no una alarma.
 *
 * Nació diciendo otra cosa: «esto se puede marcar solo en el alta y no va a
 * funcionar». Dejó de ser cierto el 10/08/2026, cuando el alta pasó a obedecer
 * esta matriz: lo que se declare aquí se cumple, lo diga o no el catálogo. Lo
 * que queda es un aviso de MANTENIMIENTO — el catálogo es lo que se lee al
 * vender, y si dice menos de lo que el alta va a exigir, alguien ofrecerá un
 * módulo suelto y se llevará la sorpresa al ir a marcarlo.
 *
 * Los grupos con alternativa quedan fuera: `requiere` es una lista y significa
 * «todos», así que un «Clínica o Citas» no se puede escribir ahí. Contarlo como
 * descuido sería pedir que se arregle algo que no tiene arreglo en ese formato.
 *
 * Se calcula, no se escribe a mano: el día que alguien ponga el `requiere` que
 * falta, el aviso desaparece solo.
 */
export function discrepanciasConCatalogo() {
  const fuera = [];

  for (const { modulo, necesita } of DEPENDENCIAS) {
    // Un módulo que ni siquiera está en el catálogo no se puede vender desde el
    // alta, así que tampoco puede venderse mal.
    if (!moduloPorClave(modulo)) continue;

    const declarado = new Set(moduloPorClave(modulo)?.requiere ?? []);

    for (const dep of necesita) {
      if (dep.nivel !== "obligatorio") continue;
      if (dep.cualquiera) continue; // inexpresable en `requiere`, ver cabecera
      const faltan = dep.claves.filter((k) => !declarado.has(k));
      if (faltan.length)
        fuera.push({ modulo, claves: faltan, cualquiera: false, porque: dep.porque });
    }
  }

  return fuera;
}

/** El grupo de venta de cada módulo, para poder enseñarlo en la tabla. */
const GRUPO = new Map(CATALOGO.flatMap((g) => g.modulos.map((m) => [m.key, g.grupo])));

/**
 * La matriz entera, EN EL ORDEN DE LA TABLA (lo más roto arriba).
 *
 * Se recorre `DEPENDENCIAS` y no `CATALOGO` justamente por eso: el catálogo va
 * en orden de venta, que es el bueno para armar un presupuesto y el malo para
 * ver de un vistazo qué no se puede vender suelto.
 */
export function matrizCompleta() {
  return DEPENDENCIAS.map((d) => {
    const obligatorias = d.necesita.filter((x) => x.nivel === "obligatorio");
    return {
      modulo: d.modulo,
      grupo: GRUPO.get(d.modulo) ?? null,
      necesita: d.necesita,
      paraFuncionar: d.paraFuncionar ?? (obligatorias.length ? "Sí" : "No"),
      resumen: d.resumen ?? null,
      necesitaTexto: d.necesitaTexto ?? null,
      soloSeVendeSolo: obligatorias.length === 0,
      // rojo / ambar / verde, que es como se lee la tabla.
      severidad: obligatorias.length ? "rojo" : d.necesita.length ? "ambar" : "verde",
      nota: d.nota ?? null,
      // Un módulo del catálogo que nadie haya estudiado todavía no es lo mismo
      // que uno que no necesita nada. Se calcula fuera, en `sinEstudiar()`.
      sinEstudiar: false,
    };
  });
}

/**
 * Módulos del catálogo que NO están en esta matriz. Debería ser siempre vacío;
 * si algún día no lo es, es que se vendió algo que nadie repasó.
 */
export function sinEstudiar() {
  return CATALOGO.flatMap((g) => g.modulos.map((m) => m.key)).filter((k) => !PORMODULO.has(k));
}
