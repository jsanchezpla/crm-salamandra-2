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
 * CÓMO SE MANTIENE
 * Igual que `integraciones.js`: se escribe leyendo el CÓDIGO y cada entrada
 * lleva `donde` con fichero y línea. Si al abrir el fichero no está, la entrada
 * se borra. Todo lo de aquí se comprobó contra el VPS el 10/08/2026, llamando a
 * los endpoints reales de los siete clientes activos.
 */

import { CATALOGO, moduloPorClave } from "./catalogo.js";

export const NIVELES = {
  obligatorio: "Sin el otro módulo no sirve para lo que se vende",
  parcial: "Funciona solo, pero pierde esta utilidad",
};

/**
 * `claves` es SIEMPRE un array. Con `cualquiera: true` basta uno de ellos —el
 * caso es Equipo avanzado, cuyas pantallas se alimentan de Clínica o de Citas—;
 * si no, hacen falta todos.
 */
export const DEPENDENCIAS = [
  // ── Se venden solos ───────────────────────────────────────────────────────
  { modulo: "clients", necesita: [] },
  { modulo: "leads", necesita: [] },
  { modulo: "team", necesita: [] },
  {
    modulo: "training",
    necesita: [],
    nota:
      "Es el más independiente del CRM: sus siete modelos son suyos y no toca ni una tabla de otro módulo. Lo que necesita no es un módulo, es el WordPress con TutorLMS del propio cliente. Ojo al venderlo: las matrículas se hacen POR EMPRESA, así que a un cliente B2C que venda cursos a particulares hoy no se le puede matricular a nadie desde el CRM.",
  },

  // ── Obligatorias ──────────────────────────────────────────────────────────
  {
    modulo: "billing",
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
        donde: ["models/tenant/Invoice.model.js:41", "app/api/billing/analytics/employees/route.js:80"],
      },
    ],
  },
  {
    modulo: "orders",
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
        claves: ["inventory"],
        nivel: "parcial",
        porque:
          "Sin Inventario el pedido se completa igual, pero no comprueba existencias ni descuenta stock.",
        donde: ["app/api/orders/[id]/complete/route.js:96", "lib/inventory/stock.js:70"],
      },
    ],
  },
  {
    modulo: "nutricion",
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
    modulo: "pacientes",
    necesita: [
      {
        claves: ["clients"],
        nivel: "obligatorio",
        porque: "El paciente cuelga de la familia que paga; el alta de la familia es la que los crea.",
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
        porque: "La ficha del paciente deja de enseñar sus citas y el estado del contrato de su familia.",
        donde: ["app/(dashboard)/pacientes/[id]/page.jsx:328"],
      },
    ],
  },
  {
    modulo: "clinica",
    necesita: [
      {
        claves: ["pacientes"],
        nivel: "obligatorio",
        porque: "No hay sesión, informe ni coordinación sin una ficha de paciente de la que colgar.",
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
    modulo: "formularios",
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
    modulo: "referidos",
    necesita: [
      {
        claves: ["leads"],
        nivel: "obligatorio",
        porque:
          "No tiene tabla propia: su pantalla lee y escribe leads filtrando por origen. Y sus endpoints exigen `leads`, NUNCA `referidos` — un cliente que comprara solo Referidos recibiría un 403 en su propio módulo. Al revés también falla: cualquiera con Leads puede abrir /referidos sin haberlo comprado.",
        donde: ["app/api/referidos/route.js:6", "app/api/referidos/[id]/route.js:8"],
      },
    ],
  },
  {
    modulo: "clients_avanzado",
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
        donde: ["lib/clients/urgentes.js:123", "lib/clients/urgentes.js:244"],
      },
    ],
  },
  {
    modulo: "team_avanzado",
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
    modulo: "documents",
    necesita: [
      {
        claves: ["citas", "clients"],
        nivel: "obligatorio",
        porque:
          "Lo que se vende es «subir el contrato del centro y que la familia lo firme en su área privada». Subirlo funciona solo; firmarlo no, porque el área privada es de Citas y la familia se identifica por su ficha. Sin los dos queda un PDF que nadie puede firmar.",
        donde: [
          "app/api/public/c/[tenantSlug]/citas-portal/contract/sign/route.js:143",
          "lib/citas/portalClient.js:65",
        ],
      },
    ],
  },
  {
    modulo: "documents_avanzado",
    necesita: [
      {
        claves: ["documents"],
        nivel: "obligatorio",
        porque: "Es el archivo completo montado sobre el básico.",
        donde: ["lib/provisioning/catalogo.js:33", "app/api/documents/route.js:31"],
      },
    ],
  },

  // ── Se venden solos, pero pierden algo ────────────────────────────────────
  {
    modulo: "citas",
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
        porque: "No se puede decir qué hijo de la familia viene a la cita: el campo se ignora en silencio.",
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
  {
    modulo: "inventory",
    necesita: [
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
        porque: "Sin Pedidos no hay salidas de almacén por venta: el stock solo baja por ajuste manual.",
        donde: ["app/api/orders/[id]/complete/route.js:96"],
      },
    ],
  },
  {
    modulo: "calendar",
    necesita: [
      {
        claves: ["projects"],
        nivel: "parcial",
        porque: "Deja de pintar los hitos y las tarjetas con fecha de Proyectos. Hay interruptor para ocultarlo.",
        donde: ["lib/calendar/projectEvents.js:26"],
      },
      {
        claves: ["team", "clients"],
        nivel: "parcial",
        porque: "La tarea se crea igual: simplemente no se ofrece responsable ni cliente.",
        donde: ["models/tenant/CalendarTask.model.js:58", "models/tenant/CalendarTask.model.js:64"],
      },
    ],
  },
  {
    modulo: "analytics",
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
 * DISCREPANCIAS CON EL CATÁLOGO — lo que de verdad justifica esta pantalla.
 *
 * Una dependencia `obligatoria` que el catálogo NO declara en `requiere` es un
 * módulo que HOY se puede marcar solo en el alta y que no va a funcionar. No es
 * una opinión: el alta no lo va a impedir.
 *
 * Se calcula, no se escribe a mano, para que no pueda quedarse desfasada: el
 * día que alguien añada el `requiere` que falta, el aviso desaparece solo.
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
      // Con `cualquiera`, el catálogo no puede expresar un «uno u otro»: basta
      // con que declare alguno para no considerarlo un descuido.
      const faltan = dep.claves.filter((k) => !declarado.has(k));
      const cubierto = dep.cualquiera ? faltan.length < dep.claves.length : faltan.length === 0;
      if (!cubierto) fuera.push({ modulo, claves: faltan, cualquiera: Boolean(dep.cualquiera), porque: dep.porque });
    }
  }

  return fuera;
}

/** Todas las claves del catálogo, en su orden, con lo que necesita cada una. */
export function matrizCompleta() {
  return CATALOGO.flatMap((g) =>
    g.modulos.map((m) => ({
      modulo: m.key,
      grupo: g.grupo,
      necesita: dependenciasDe(m.key),
      soloSeVendeSolo: seVendeSolo(m.key),
      nota: PORMODULO.get(m.key)?.nota ?? null,
      // `true` si nadie ha escrito todavía sus dependencias: es distinto de
      // «no necesita nada», y conviene que se note.
      sinEstudiar: !PORMODULO.has(m.key),
    }))
  );
}
