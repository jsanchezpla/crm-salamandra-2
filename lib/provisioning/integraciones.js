/**
 * Mapa de integraciones entre módulos — por dónde se tocan.
 *
 * QUÉ ES ESTO Y EN QUÉ SE DIFERENCIA DE `catalogo.js` (09/08/2026)
 * El catálogo dice qué módulo NECESITA a otro para poder existir: Clínica no
 * tiene sentido sin Pacientes, y por eso el alta lo marca solo. Eso es una
 * dependencia dura, de instalación.
 *
 * Esto es la otra capa, la que se nota a diario: que un lead se convierta en
 * ficha de cliente, que una cita quede colgada de esa ficha, que una factura
 * sepa de qué persona del equipo es. Dos módulos pueden vivir perfectamente el
 * uno sin el otro y aun así hablarse cuando están los dos. Ninguna de esas
 * conexiones estaba escrita en ningún sitio: solo las sabía quien hubiera leído
 * ese trozo de código, y era lo primero que hacía falta para contestar «¿qué se
 * le rompe a este cliente si le apago esto?».
 *
 * CÓMO SE MANTIENE
 * Se escribe leyendo el CÓDIGO, no la documentación. Cada entrada lleva
 * `donde` con fichero y línea: es lo que permite comprobar dentro de seis meses
 * que sigue siendo verdad, y lo que obliga a que nadie apunte aquí una
 * integración que le suena. Si al abrir el fichero no está, la entrada se borra.
 *
 * Al añadir un módulo nuevo o mover un flujo, esto se actualiza en el mismo
 * commit. Es lo que ve `/admin/integraciones`.
 */

import { CATALOGO } from "./catalogo.js";

/**
 * Nombre comercial de cada módulo, sacado del catálogo de venta para que no se
 * digan dos cosas distintas en dos pantallas.
 *
 * Los que no están en el catálogo se añaden aquí a mano. `provisioning` no está
 * a propósito: es nuestro panel, no un módulo que se venda. `cuestionarios`
 * tampoco, pero por otro motivo: dejó de venderse el 10/08/2026 y sigue escrito
 * aquí porque dos clientes (aumenta y demo) conservan la fila en
 * `master.tenant_modules` y sin nombre saldrían en blanco en el back-office.
 */
export const NOMBRES_MODULO = {
  ...Object.fromEntries(CATALOGO.flatMap((g) => g.modulos.map((m) => [m.key, m.nombre]))),
  provisioning: "Alta de clientes",
  cuestionarios: "Cuestionarios (dentro de Formación)",
};

/** Qué significa cada tipo, en una frase. Se enseña al pasar el ratón. */
export const TIPOS = {
  conversion: "Un registro de un módulo se transforma en otro de otro módulo",
  enlace: "Una ficha de un módulo queda apuntada a la de otro",
  gating: "Un módulo condiciona lo que se puede hacer en el otro",
  cascada: "Cambiar o borrar en un módulo arrastra registros del otro",
  agregacion: "Un módulo lee datos del otro para contar, resumir o listar",
  aviso: "Un correo o notificación que salta en un módulo por algo del otro",
  compartido: "Una misma entidad que usan los dos módulos",
  // Ni conversión (no nace un registro nuevo) ni enlace (no es una clave
  // ajena): un módulo RELLENA un campo que es del otro. El caso que lo trajo:
  // la familia firma el permiso de imagen desde el área privada de Citas y eso
  // se escribe en la ficha clínica del niño.
  escritura: "Un módulo escribe datos dentro de la ficha del otro",
};

/**
 * ¿Se NOTA que falte el módulo de destino?
 *
 * SE COMPRUEBA UNA A UNA, NO SE DEDUCE DEL TIPO (09/08/2026)
 * La primera versión lo decidía por tipo: toda conversión, enlace o cascada sin
 * destino salía marcada. Daba 33 avisos en producción y la mayoría eran
 * mentira. A Retorika —una academia online— le salía que «le falta Nutrición»
 * porque existe una integración clientes→nutrición; y no le falta nada, es que
 * eso no va con ella. Un aviso que casi siempre es falso se deja de mirar en
 * dos días, y entonces el que sí importa pasa desapercibido.
 *
 * Así que la pregunta no es de qué tipo es, sino QUÉ VE una persona que tiene
 * el módulo de origen y no el de destino:
 *   · si el botón no se pinta, la sección no se monta y la ruta da 404, no se
 *     nota nada y aquí no aparece;
 *   · si ve un botón que muere, una cifra clavada a cero o un texto que promete
 *     algo que no puede pasar, lleva `seNotaSinDestino: true`.
 *
 * Se comprobaron las 19 que salían a medias en algún cliente de producción:
 * trece estaban bien escondidas y seis no. Las seis llevan la marca abajo, y
 * cinco de ellas están en el backlog como fallo.
 *
 * ⚠️ Al añadir una integración nueva, la marca se pone SOLO después de mirarlo.
 * Por defecto no avisa: callar de más es menos dañino que avisar en falso, que
 * es justo lo que rompió la primera versión.
 */
export function necesitaDestino(integracion) {
  return integracion?.seNotaSinDestino === true;
}

/**
 * El mapa.
 *
 * `desde` es donde NACE el flujo, `hacia` donde acaba. `automatico` distingue lo
 * que pasa solo de lo que pasa porque alguien pulsa un botón — que es la
 * diferencia entre «se le va a llenar esto sin hacer nada» y «tiene que
 * acordarse de hacerlo».
 */
export const INTEGRACIONES = [
  // ── team ──────────────────────────────────────────────────────────────
  {
    desde: "team",
    hacia: "citas",
    tipo: "gating",
    titulo:
      "La agenda pública enseña los huecos de tu profesional, no los del centro",
    queHace:
      "Si la ficha de quien pregunta tiene profesional asignada, los huecos que se ofrecen son la parte de la agenda del centro que además cae dentro del horario de esa persona. Si ella no trabaja ese día, no se ofrece nada. Sin profesional asignada se sigue viendo la agenda del centro entero.",
    donde: [
      "lib/citas/horarioProfesional.js:67",
      "lib/citas/horarioProfesional.js:109",
      "lib/citas/quienPregunta.js:26",
      "lib/citas/quienPregunta.js:52",
      "app/api/public/c/[tenantSlug]/availability/route.js:95",
      "app/api/public/c/[tenantSlug]/availability/month/route.js:87",
      "app/api/team/[id]/hours/route.js:42",
    ],
    automatico: true,
    nota:
      "Criterio cambiado el 07/08/2026: antes, sin horario propio se servía la agenda del centro y eso dejaba reservar las tardes de otra compañera. Por eso el listado de Equipo marca a quién le falta el horario.",
  },
  {
    desde: "team",
    hacia: "clients",
    tipo: "gating",
    titulo:
      "Las consultas externas solo las ve la profesional que las lleva",
    queHace:
      "Una ficha marcada como consulta externa desaparece del listado y de la búsqueda para todo el mundo menos dirección y la profesional que la tiene asignada. Al intentar abrirla directamente responde «no existe», para no confirmar siquiera que esa persona está en el centro.",
    donde: [
      "lib/clients/consultaExterna.js:46",
      "lib/clients/consultaExterna.js:78",
      "app/api/clients/route.js:39",
      "app/api/clients/[id]/route.js:77",
    ],
    automatico: true,
    nota:
      "El filtro entra en la misma consulta del listado para que el total no se descuadre, y se aplica tenga o no el cliente el módulo Equipo.",
  },
  {
    desde: "team",
    hacia: "provisioning",
    tipo: "gating",
    titulo:
      "El usuario del CRM se crea en Equipo, y ahí se decide qué módulos ve",
    queHace:
      "Desde la ficha del empleado se le crea el usuario y se marcan los módulos a los que entra; la lista se filtra contra los módulos que ese cliente tiene contratados. Es la segunda puerta: con el módulo contratado pero sin marcar aquí, la persona no lo ve en el menú y el CRM le responde que no.",
    donde: [
      "lib/team/access.js:64",
      "lib/team/access.js:78",
      "app/api/team/[id]/access/route.js:136",
      "app/api/team/[id]/access/route.js:219",
      "app/api/team/modules/route.js:20",
    ],
    automatico: true,
    nota:
      "En el alta se exige al menos un módulo; al editar se puede dejar vacío, que es «bloquear sin borrar la cuenta». Lo pongo apuntando a provisioning porque lo que se marca son los módulos contratados del cliente; en el código no hay un módulo destino concreto.",
  },
  {
    desde: "team",
    hacia: "clients",
    tipo: "enlace",
    titulo:
      "Notas y llamadas de la ficha quedan firmadas por quien las escribió",
    queHace:
      "Al apuntar una nota o registrar una llamada en la ficha de un cliente, el CRM identifica al miembro del equipo que ha entrado y lo guarda como autor. No hay que elegir autor a mano.",
    donde: [
      "models/tenant/ClientNote.model.js:38",
      "models/tenant/Interaction.model.js:36",
      "app/api/clients/[id]/notes/route.js:76",
      "app/api/clients/[id]/interactions/route.js:42",
      "lib/team/currentTeamMember.js:17",
      "lib/db/tenantDb.js:342",
    ],
    automatico: true,
  },
  {
    desde: "team",
    hacia: "pacientes",
    tipo: "enlace",
    titulo:
      "Cada paciente tiene su terapeuta de referencia",
    queHace:
      "La ficha del paciente guarda quién es su profesional principal, elegido de un desplegable con el equipo activo. Si el cliente no tiene el módulo Equipo, el desplegable no se pinta.",
    donde: [
      "models/tenant/Patient.model.js:88",
      "lib/db/tenantDb.js:615",
      "app/(dashboard)/pacientes/[id]/page.jsx:345",
    ],
    automatico: false,
  },
  {
    desde: "team",
    hacia: "clinica",
    tipo: "enlace",
    titulo:
      "Sesiones, informes, métricas e incentivos cuelgan del profesional",
    seNotaSinDestino: true,
    queHace:
      "Las sesiones, los informes, las métricas de desempeño (con quién las aprobó), los incentivos y las actas de coordinación apuntan todos a una persona del equipo. Es el hilo del que tira después el desempeño de cada uno.",
    donde: [
      "models/tenant/ClinicSession.model.js:25",
      "models/tenant/PerformanceMetric.model.js:32",
      "models/tenant/IncentiveItem.model.js:29",
      "models/tenant/IncidenciaAssignee.model.js:25",
      "lib/db/tenantDb.js:634",
      "lib/db/tenantDb.js:660",
    ],
    automatico: false,
    nota:
      "La sesión puede quedarse sin terapeuta desde agosto de 2026: al importar el histórico de un centro salieron más de cuatro mil sesiones de gente que ya no está.",
  },
  {
    desde: "team",
    hacia: "billing",
    tipo: "enlace",
    titulo:
      "Facturas, gastos, tarifas y presupuestos cuelgan de una persona",
    seNotaSinDestino: true,
    queHace:
      "Facturas, gastos, tarifas y presupuestos pueden ir a nombre de un miembro del equipo; una tarifa sin persona es la tarifa general. El alta de un gasto incluso rellena sola a quien lo registra si no se indica otro. Es lo que permite después medir cuánto factura y cuánto cuesta cada uno.",
    donde: [
      "models/tenant/Invoice.model.js:41",
      "models/tenant/Cost.model.js:67",
      "models/tenant/Rate.model.js:12",
      "models/tenant/Quote.model.js:34",
      "lib/db/tenantDb.js:484",
      "lib/db/tenantDb.js:487",
      "app/(dashboard)/facturacion/costes/page.jsx:74",
    ],
    automatico: false,
    nota:
      "Estos campos se llamaban «terapeuta» y se renombraron a «empleado» en abril de 2026, porque el CRM es genérico.",
  },
  {
    desde: "team",
    hacia: "inventory",
    tipo: "enlace",
    titulo:
      "Cada entrada y cada ajuste de almacén lleva quién lo hizo",
    queHace:
      "Las entradas de mercancía y los ajustes de existencias se firman solos con la persona que ha entrado, y el histórico enseña su nombre. Es la primera pregunta cuando el stock no cuadra. El ajuste además exige explicar el motivo y no deja dejar el stock en negativo.",
    donde: [
      "models/tenant/StockMovement.model.js:65",
      "app/api/inventory/entries/route.js:63",
      "app/api/inventory/stock-movements/route.js:83",
      "lib/db/tenantDb.js:547",
      "app/(dashboard)/inventario/page.jsx:327",
    ],
    automatico: true,
  },
  {
    desde: "team",
    hacia: "orders",
    tipo: "enlace",
    titulo:
      "Al dar un pedido por servido queda quién lo despachó",
    queHace:
      "Al completar un pedido, la salida de almacén queda firmada con la persona que ha entrado y atada a ese pedido, en el mismo movimiento que crea la factura borrador.",
    donde: [
      "app/api/orders/[id]/complete/route.js:124",
      "app/api/orders/[id]/complete/route.js:164",
    ],
    automatico: true,
    nota:
      "Sin módulo Inventario no se descuenta ni se firma nada.",
  },
  {
    desde: "team",
    hacia: "calendar",
    tipo: "enlace",
    titulo:
      "Las tareas del calendario se reparten entre el equipo",
    queHace:
      "Una tarea del calendario puede tener responsable, elegido de un desplegable con el equipo, y el calendario se puede filtrar por persona. El «reorganizar la semana con IA» usa lo mismo: filtra las tareas de esa persona y le pasa los nombres al asistente.",
    donde: [
      "models/tenant/CalendarTask.model.js:64",
      "lib/calendar/calendarEvent.js:59",
      "lib/calendar/calendarEvent.js:83",
      "app/api/calendar/tasks/route.js:28",
      "app/api/calendar/reorganize/route.js:36",
      "app/(dashboard)/calendario/page.jsx:93",
    ],
    automatico: false,
    nota:
      "Si el cliente no tiene Equipo, el responsable se ignora y la tarea se crea igual; si se da de baja a la persona, la tarea se queda sin responsable pero no se borra.",
  },
  {
    desde: "team",
    hacia: "projects",
    tipo: "enlace",
    titulo:
      "El empleado entra en proyectos y en tarjetas del tablero",
    queHace:
      "Las personas del equipo se apuntan a los proyectos con su papel (responsable, miembro o solo mirar) y a las tarjetas del tablero. Desde su ficha se ven sus proyectos activos y qué papel tiene en cada uno.",
    donde: [
      "models/tenant/ProjectMember.model.js:29",
      "models/tenant/TaskAssignee.model.js:29",
      "app/api/team/[id]/projects/route.js:8",
      "app/api/team/[id]/projects/route.js:21",
    ],
    automatico: false,
    nota:
      "Esa pestaña de la ficha exige el módulo Proyectos: un cliente con Equipo y sin Proyectos no la ve.",
  },
  {
    desde: "team",
    hacia: "documents",
    tipo: "compartido",
    titulo:
      "La documentación personal del empleado va al mismo archivo",
    queHace:
      "El currículum o las titulaciones que sube cada miembro del equipo se guardan como documentos privados suyos, y solo él los ve. No hace falta contratar Documentos, pero gastan la misma cuota de 1 GB del cliente y el mismo tope de 25 MB por archivo.",
    donde: [
      "app/api/team/me/documents/route.js:23",
      "app/api/team/me/documents/route.js:71",
      "app/api/team/me/documents/route.js:92",
      "components/team/MiEquipo.jsx:57",
      "lib/documents/documentStorage.js:28",
    ],
    automatico: false,
  },

  // ── clients ───────────────────────────────────────────────────────────
  {
    desde: "clients",
    hacia: "pacientes",
    tipo: "conversion",
    titulo:
      "El alta de la familia crea también a sus pacientes",
    queHace:
      "Con el módulo Pacientes activo, el formulario de alta permite dar de alta a los hijos ahí mismo: o entra la familia con sus pacientes, o no entra nada. Después, desde la ficha ya creada, se siguen añadiendo desde la sección «Pacientes», que se esconde entera si ese cliente no tiene el módulo.",
    donde: [
      "app/api/clients/route.js:189",
      "app/api/clients/route.js:305",
      "lib/clients/formularioAlta.js:316",
      "components/clients/PacientesDelAlta.jsx:42",
      "components/clients/ClientPatientsSection.jsx:48",
      "components/clients/ClientPatientsSection.jsx:104",
      "components/clients/ClientPatientsSection.jsx:122",
      "modules/default/ClientDetailModule.jsx:572",
    ],
    automatico: false,
    nota:
      "La casilla «el paciente es el propio cliente» prerrellena nombre y apellidos partiendo el nombre de la familia, a la vista y editables. Marcar el módulo Clínica en la ficha ya no crea pacientes solo: se decidió que se creen explícitamente.",
  },
  {
    desde: "clients",
    hacia: "clients_avanzado",
    tipo: "conversion",
    titulo:
      "Una casilla del alta mete a la familia en la cola de admisión",
    queHace:
      "Al dar de alta la ficha se puede marcar que esa familia entra en la lista de espera, y entra en el mismo movimiento con su número de orden. Queda esperando plaza aunque ya tenga ficha, y la cabecera de la ficha enseña «En lista de espera desde el…».",
    donde: [
      "app/api/clients/route.js:188",
      "app/api/clients/route.js:313",
      "lib/clients/listaEspera.js:65",
      "lib/clients/listaEspera.js:88",
      "app/api/clients/[id]/route.js:28",
    ],
    automatico: false,
    nota:
      "Sin el módulo avanzado la casilla se ignora en silencio. Por eso la lista ofrece «Ya tiene plaza» en vez de «Convertir en cliente» a quien ya tiene ficha.",
  },
  {
    desde: "clients",
    hacia: "citas",
    tipo: "gating",
    titulo:
      "Si la familia dijo que no quiere avisos, no se le escribe",
    queHace:
      "La ficha guarda tres permisos —correo de citas, WhatsApp de citas y novedades— con quién los marcó y cuándo. Todos los envíos de Citas pasan por ahí: confirmación, cambio de hora, cancelación, recordatorio de la víspera y WhatsApp. Sin ficha se aplica lo razonable: correo sí, WhatsApp no.",
    donde: [
      "lib/clients/comunicaciones.js:129",
      "lib/clients/comunicaciones.js:142",
      "app/api/citas/bookings/route.js:417",
      "app/api/citas/bookings/[id]/route.js:88",
      "app/api/citas/bookings/[id]/confirm/route.js:306",
      "lib/citas/recordatorios.js:113",
      "lib/citas/avisosWhatsapp.js:96",
      "app/api/citas/avisos/route.js:126",
      "app/api/public/c/[tenantSlug]/book/route.js:1027",
    ],
    automatico: true,
    nota:
      "La familia se resuelve por la ficha de la cita y, si no la tiene, por el correo con el que se reservó. Solo un «no» explícito bloquea.",
  },
  {
    desde: "clients",
    hacia: "citas",
    tipo: "gating",
    titulo:
      "Un interruptor de la ficha autoconfirma las citas de esa persona",
    queHace:
      "En la ficha se puede marcar que a esa familia se le confirmen las citas solas, sin pasar por la bandeja del centro. Solo la exime de esa espera: sigue pasando por el formulario, por el contrato y por el pago si la cita tiene precio.",
    donde: [
      "app/api/clients/[id]/route.js:170",
      "components/clients/ClientCitasSection.jsx:34",
      "components/clients/ClientCitasSection.jsx:40",
      "app/api/public/c/[tenantSlug]/book/route.js:472",
      "app/api/public/c/[tenantSlug]/book/route.js:493",
    ],
    automatico: true,
    nota:
      "La sección de citas de la ficha solo se pinta si ese cliente tiene el módulo Citas, y el interruptor solo cambia si viene marcado a propósito, para que otro guardado no lo apague.",
  },
  {
    desde: "clients",
    hacia: "citas",
    tipo: "gating",
    titulo:
      "El correo de la ficha (o el de un tutor) es la llave del área privada",
    queHace:
      "Para saber a qué familia entra alguien, el CRM busca su correo en la ficha y, si no, entre los tutores guardados en ella. Por eso el alta rechaza un correo de tutor que ya esté en otra familia: repetirlo le abriría a esa persona la documentación de una familia que no es la suya.",
    donde: [
      "lib/citas/portalClient.js:65",
      "lib/citas/portalClient.js:99",
      "lib/citas/portalClient.js:120",
      "app/api/clients/route.js:222",
      "app/api/clients/route.js:239",
    ],
    automatico: true,
  },
  {
    desde: "clients",
    hacia: "citas",
    tipo: "cascada",
    titulo:
      "Borrar una ficha borra sus documentos y sus citas futuras, avisando antes",
    seNotaSinDestino: true,
    queHace:
      "Al eliminar un cliente, el CRM borra sus documentos (fichero y ficha del archivo) y sus citas futuras, y antes de borrarlas manda a cada una el correo de cancelación de siempre. Las citas ya pasadas se conservan. Si algo de esto falla, el borrado sigue adelante y queda registrado cuántas cosas se llevó.",
    donde: [
      "lib/clients/borrarRastro.js:45",
      "lib/clients/borrarRastro.js:54",
      "lib/clients/borrarRastro.js:62",
      "lib/clients/borrarRastro.js:78",
      "lib/clients/borrarRastro.js:97",
      "lib/clients/borrarRastro.js:102",
      "app/api/clients/[id]/route.js:261",
    ],
    automatico: true,
    nota:
      "Las citas se buscan por ficha y también por correo. En la demo pública no se manda ningún correo. Antes de esto los documentos quedaban huérfanos: papeles de salud sin ficha, invisibles y ocupando cuota para siempre.",
  },
  {
    desde: "clients",
    hacia: "billing",
    tipo: "gating",
    titulo:
      "Un cliente con facturas no se puede borrar",
    queHace:
      "Antes de eliminar una ficha se cuentan sus facturas y, si tiene alguna, el CRM se niega y propone marcarla como inactiva. Es la protección del histórico fiscal.",
    donde: [
      "app/api/clients/[id]/route.js:237",
      "app/api/clients/[id]/route.js:239",
      "app/api/clients/[id]/route.js:241",
    ],
    automatico: true,
    nota:
      "En un cliente sin la tabla de facturas (una consulta que no tiene Facturación) el candado se salta y deja borrar, dejando aviso en el registro del servidor.",
  },
  {
    desde: "clients",
    hacia: "billing",
    tipo: "compartido",
    titulo:
      "Los datos fiscales de la ficha son los que salen en la factura",
    queHace:
      "La factura y el informe de IVA sacan de la ficha la razón social y el NIF, usando primero los campos fiscales («a nombre de quién se emite», que puede ser el otro progenitor o una empresa) y, si no los hay, los de la persona. Al emitir, si falta alguno, el CRM se niega diciendo exactamente qué falta y manda a editar la ficha.",
    donde: [
      "lib/billing/nifCliente.js:27",
      "lib/billing/nifCliente.js:35",
      "lib/billing/invoicePdf.js:93",
      "lib/billing/buildIvaReport.js:81",
      "app/api/billing/invoices/[id]/issue/route.js:53",
      "app/api/clients/[id]/route.js:139",
    ],
    automatico: true,
    nota:
      "Los campos fiscales solo se piden en clientes con Facturación. Hay una lista blanca de campos en el guardado de la ficha: si se añade uno fiscal y se olvida ahí, la pantalla dice «guardado» y el servidor lo tira en silencio.",
  },
  {
    desde: "clients",
    hacia: "nutricion",
    tipo: "conversion",
    titulo:
      "En una consulta de nutrición, todo cliente nuevo nace marcado como paciente",
    queHace:
      "Al dar de alta una ficha —a mano o importando un Excel— el CRM le pone sola la marca de «paciente de nutrición», que es la que hace que aparezca en el buscador de citas y en las pautas. Con Clínica no se hace, a propósito, porque quien paga no siempre es quien viene.",
    donde: [
      "lib/clients/moduleAssignments.js:28",
      "lib/clients/moduleAssignments.js:94",
      "app/api/clients/route.js:326",
      "app/api/clients/import/route.js:77",
    ],
    automatico: true,
    nota:
      "Decide por el módulo que tiene contratado el cliente, no por los permisos de quien teclea el alta, y si falla no impide crear la ficha.",
  },
  {
    desde: "clients",
    hacia: "citas",
    tipo: "agregacion",
    titulo:
      "Al poner una cita a mano se busca entre los pacientes, no se teclea",
    queHace:
      "El alta manual de una cita ofrece un buscador con las fichas marcadas como paciente de Nutrición o de Clínica, y al elegir una rellena sola el correo y el teléfono. Hay una opción para ver todas las fichas, y si el cliente no usa esas marcas se ofrecen todas antes que un desplegable vacío. Las fichas archivadas también salen, marcadas y con cupo propio: si no salieran, quien vuelve tras una baja acabaría con una cita sin ficha.",
    donde: [
      "app/api/citas/clientes/route.js:26",
      "app/api/citas/clientes/route.js:70",
      "app/api/citas/clientes/route.js:89",
      "app/api/citas/clientes/route.js:126",
      "lib/clients/moduleAssignments.js:14",
    ],
    automatico: true,
  },
  {
    desde: "clients",
    hacia: "pacientes",
    tipo: "compartido",
    titulo:
      "Casi todo el CRM cuelga de la ficha de cliente",
    queHace:
      "La ficha de cliente es el eje del producto: de ella cuelgan pacientes, citas, documentos, sesiones, informes, coordinaciones, tickets, facturas, cobros, presupuestos, gastos, pedidos, incidencias, proyectos y pautas de nutrición. Todo eso puede quedarse sin cliente sin desaparecer; la única excepción es la factura, que siempre tiene que tener uno.",
    donde: [
      "lib/db/tenantDb.js:298",
      "lib/db/tenantDb.js:311",
      "lib/db/tenantDb.js:326",
      "lib/db/tenantDb.js:363",
      "lib/db/tenantDb.js:429",
      "lib/db/tenantDb.js:472",
      "lib/db/tenantDb.js:581",
      "lib/db/tenantDb.js:600",
      "lib/db/tenantDb.js:678",
      "lib/db/tenantDb.js:730",
      "models/tenant/Invoice.model.js:14",
    ],
    automatico: true,
    nota:
      "Es una observación de fondo sobre cómo está montado el producto, no una integración concreta entre dos módulos: el par que encabeza la ficha es orientativo. Va la última a propósito.",
  },

  // ── clinica ───────────────────────────────────────────────────────────
  {
    desde: "clinica",
    hacia: "documents",
    tipo: "conversion",
    titulo:
      "El informe clínico llega a la familia como PDF de su área privada",
    queHace:
      "«Enviar al paciente» imprime el informe a PDF, lo guarda en el archivo de documentos marcado como visible para la familia y deja el informe en estado entregado apuntando a ese PDF. Reenviar es reemplazar: crea el nuevo y borra el anterior para que nadie tenga dos versiones.",
    donde: [
      "app/api/clinica/reports/[id]/enviar/route.js:49",
      "app/api/clinica/reports/[id]/enviar/route.js:60",
      "app/api/clinica/reports/[id]/enviar/route.js:94",
      "app/api/clinica/reports/[id]/enviar/route.js:119",
      "models/tenant/ClinicalReport.model.js:74",
    ],
    automatico: false,
    nota:
      "Si el paciente no tiene familia pagadora enlazada, se niega con un mensaje que lo explica: el portal filtra por familia y el informe no tendría a dónde llegar. También corta si el cliente se pasa de cuota de almacenamiento.",
  },
  {
    desde: "clinica",
    hacia: "team",
    tipo: "aviso",
    titulo:
      "La campana avisa a cada profesional de sus informes vencidos",
    queHace:
      "Al abrir la campana, el CRM busca los informes clínicos de esa persona que ya pasaron de fecha sin entregar y las incidencias que tiene asignadas sin resolver, y se los enseña. Se recalculan cada vez: al entregar el informe, el aviso desaparece solo.",
    donde: [
      "app/api/notifications/route.js:19",
      "lib/notifications/alerts.js:51",
      "lib/notifications/alerts.js:61",
      "lib/notifications/alerts.js:73",
    ],
    automatico: true,
    nota:
      "Quien no tiene ficha de equipo no recibe estos avisos. Si algo falla, la campana sigue funcionando.",
  },
  {
    desde: "clinica",
    hacia: "leads",
    tipo: "agregacion",
    titulo:
      "Las estadísticas del centro cuentan de dónde llega cada familia",
    queHace:
      "Un solo cálculo alimenta la pantalla, el Excel y el PDF de dirección, y mezcla tres mundos: la actividad clínica, la agenda con su tasa de ausencias por profesional, y la captación (leads por origen, si cada alta nueva vino de un lead, de la lista de espera o directa, y cuánta gente sigue esperando plaza). El dinero se deja fuera a propósito: vive en Facturación.",
    donde: [
      "lib/clinica/estadisticas.js:29",
      "lib/clinica/estadisticas.js:175",
      "lib/clinica/estadisticas.js:227",
      "lib/clinica/estadisticas.js:242",
      "lib/clinica/estadisticas.js:253",
      "app/api/clinica/estadisticas/route.js:24",
    ],
    automatico: true,
    nota:
      "Solo dirección, y hace falta Clínica o Pacientes. Los días medios de espera se calculan con la fecha de última modificación de la entrada, que es una aproximación.",
  },
  {
    desde: "clinica",
    hacia: "team_avanzado",
    tipo: "agregacion",
    titulo:
      "La bandeja de trabajo junta informes, incidencias y citas del día",
    queHace:
      "Una sola pantalla con lo que tiene pendiente una persona: sus informes clínicos sin entregar (marcando los que ya se pasaron de fecha), las incidencias que tiene asignadas sin resolver y sus citas de hoy. Tres cosas de módulos distintos en la misma lista.",
    donde: [
      "app/api/clinica/bandeja/route.js:26",
      "app/api/clinica/bandeja/route.js:49",
      "app/api/clinica/bandeja/route.js:72",
      "app/api/clinica/bandeja/route.js:97",
    ],
    automatico: true,
    nota:
      "Quien tiene ficha de equipo ve siempre la suya; solo quien no la tiene (dirección) puede mirar la de otra persona.",
  },
  {
    desde: "clinica",
    hacia: "team_avanzado",
    tipo: "agregacion",
    titulo:
      "El cumplimiento de los planes se agrupa por terapeuta",
    queHace:
      "Cada paciente tiene pactado en su plan cuántos informes y cuántos registros de sesión le tocan por trimestre. Esta vista da la vuelta al dato y enseña, por terapeuta principal, cuánto de lo prometido lleva hecho este trimestre, contando solo pacientes activos.",
    donde: [
      "app/api/clinica/performance/planes/route.js:42",
      "app/api/clinica/performance/planes/route.js:57",
      "app/api/clinica/performance/planes/route.js:107",
      "app/api/pacientes/[id]/plan/route.js:72",
    ],
    automatico: true,
    nota:
      "No hay contador guardado: se cuenta al mirar, sobre los informes y las sesiones reales, y cada parte se topa a lo previsto para que hacer registros de más no tape un informe sin entregar.",
  },
  {
    desde: "clinica",
    hacia: "team_avanzado",
    tipo: "gating",
    titulo:
      "Desempeño, Dirección, Productividad, Incidencias y Bandeja exigen los dos módulos",
    queHace:
      "Todo el paquete de gestión de equipo que se alimenta de datos clínicos necesita a la vez Equipo avanzado y Clínica: el menú lo esconde si falta uno y los endpoints lo vuelven a comprobar. Sin esa doble puerta, un cliente con el avanzado y sin Clínica vería entradas de menú que su propio CRM le rechazaría.",
    donde: [
      "components/layout/Sidebar.jsx:203",
      "components/layout/Sidebar.jsx:207",
      "app/api/clinica/dashboard/route.js:21",
      "app/api/clinica/bandeja/route.js:26",
      "app/api/clinica/productividad/route.js:22",
      "app/api/clinica/performance/route.js:66",
      "app/api/clinica/incidencias/route.js:45",
    ],
    automatico: true,
    nota:
      "Dirección, Productividad y Desempeño son además solo para dirección; Incidencias y Bandeja las usa todo el equipo. Ocupación es la excepción: depende de Citas.",
  },
  {
    desde: "clinica",
    hacia: "clients",
    tipo: "enlace",
    titulo:
      "Sesiones, informes y coordinaciones guardan también la familia",
    queHace:
      "Al crear una sesión, un informe o un acta de coordinación, el CRM anota además qué familia pagaba entonces. Así la actividad clínica se puede ver desde la ficha de la familia sin depender del salto paciente-familia, que muchas veces está vacío. No se resincroniza: lo viejo conserva el pagador de entonces.",
    donde: [
      "lib/clinica/patientClient.js:13",
      "app/api/clinica/sessions/route.js:70",
      "app/api/clinica/reports/route.js:58",
      "app/api/clinica/coordinations/route.js:106",
      "lib/db/tenantDb.js:330",
    ],
    automatico: true,
  },
  {
    desde: "clinica",
    hacia: "team",
    tipo: "enlace",
    titulo:
      "Cada incidencia apunta al paciente, a su familia y a quien la resuelve",
    queHace:
      "Una incidencia puede colgar de un paciente y de su familia, y tiene responsables del equipo, ahora varios a la vez. El filtro «mis incidencias» mira esa lista de responsables y no el campo antiguo, para que el segundo responsable también las vea.",
    donde: [
      "models/tenant/Incidencia.model.js:65",
      "models/tenant/Incidencia.model.js:70",
      "lib/db/tenantDb.js:676",
      "lib/db/tenantDb.js:678",
      "app/api/clinica/incidencias/route.js:68",
    ],
    automatico: false,
    nota:
      "De aquí salen la bandeja de trabajo y el recuento por categoría del panel de Dirección, que son pantallas de Equipo avanzado.",
  },
  {
    desde: "clinica",
    hacia: "clients",
    tipo: "cascada",
    titulo:
      "Borrar una familia no borra su historial clínico",
    queHace:
      "Las sesiones, los informes y las coordinaciones se quedan sin familia si la ficha desaparece, pero no se borran. Lo mismo con las citas y los documentos al borrar un paciente: se quedan sin paciente, no se van.",
    donde: [
      "scripts/migrate-clinica-client-link.js:40",
      "scripts/migrate-clinica-client-link.js:51",
      "scripts/migrate-patients-clients-phase1.js:165",
      "scripts/migrate-documents-patient-link.js:61",
    ],
    automatico: true,
    nota:
      "Las columnas se añaden siempre, pero el enlace duro solo si la tabla de destino existe en ese cliente.",
  },

  // ── citas ─────────────────────────────────────────────────────────────
  {
    desde: "citas",
    hacia: "documents",
    tipo: "conversion",
    titulo:
      "Firmar el contrato en el área privada archiva el PDF en la ficha",
    queHace:
      "Cuando la familia firma desde su área privada, el CRM guarda la firma con su traza legal y después fabrica el PDF con el clausulado, los datos declarados y la imagen de la firma dentro, y lo archiva como documento de esa familia. Esa copia es la que ve luego en «Mis documentos».",
    donde: [
      "app/api/public/c/[tenantSlug]/citas-portal/contract/sign/route.js:143",
      "app/api/public/c/[tenantSlug]/citas-portal/contract/sign/route.js:189",
      "lib/documents/contratoFirmadoArchivo.js:31",
      "lib/documents/contratoFirmadoArchivo.js:55",
      "lib/documents/contratoFirmadoArchivo.js:69",
    ],
    automatico: true,
    nota:
      "El PDF va después de la firma y a prueba de fallos: si no sale, la firma sigue siendo válida. La firma vuelca además a la ficha los datos que faltaban (DNI, tutor declarado).",
  },
  {
    desde: "citas",
    hacia: "pacientes",
    tipo: "escritura",
    titulo:
      "La familia firma en el área privada el permiso de imagen de cada hijo",
    queHace:
      "Desde su área privada, el tutor autoriza o deniega las imágenes de cada uno de sus pacientes, y el CRM lo guarda en la ficha clínica del niño con firma dibujada, quién firmó, fecha y desde dónde. Es por paciente: con dos hermanos se contesta dos veces, y el «no» también se guarda con su fecha, sin pedir firma.",
    donde: [
      "app/api/public/c/[tenantSlug]/citas-portal/consentimiento-imagen/route.js:32",
      "app/api/public/c/[tenantSlug]/citas-portal/consentimiento-imagen/route.js:111",
      "app/api/public/c/[tenantSlug]/citas-portal/consentimiento-imagen/route.js:127",
      "lib/clinica/consents.js:1",
    ],
    automatico: false,
    nota:
      "Antes de escribir se comprueba que ese paciente sea de esa familia, para que nadie firme por el hijo de otro.",
  },
  {
    desde: "citas",
    hacia: "formularios",
    tipo: "aviso",
    titulo:
      "Si la edad de la ficha no cuadra con la del formulario, salta el aviso",
    queHace:
      "Cuando la familia guarda su fecha de nacimiento en el área privada, el CRM la compara con la edad que declaró en el formulario y, si no cuadran, avisa a dirección. Tolera un año por el cumpleaños de por medio y no bloquea nada.",
    donde: [
      "app/api/public/c/[tenantSlug]/citas-portal/mis-datos/route.js:127",
      "lib/formularios/edadDeclarada.js:46",
    ],
    automatico: true,
  },
  {
    desde: "citas",
    hacia: "clients",
    tipo: "aviso",
    titulo:
      "Avisos del centro a una familia, colgados de una cita",
    queHace:
      "El centro puede mandar un aviso a una familia: sale por correo y queda publicado en su área privada. Si el aviso nace desde una cita, el CRM comprueba que esa cita sea de ese mismo correo, y guarda quién lo escribió. Respeta el permiso de correo de la familia.",
    donde: [
      "models/tenant/ClientNotice.model.js:46",
      "models/tenant/ClientNotice.model.js:53",
      "app/api/citas/avisos/route.js:119",
      "app/api/citas/avisos/route.js:158",
      "lib/db/tenantDb.js:352",
    ],
    automatico: false,
    nota:
      "El correo se intenta antes de guardar para poder anotar si salió; que falle no impide que el aviso quede publicado.",
  },
  {
    desde: "citas",
    hacia: "team_avanzado",
    tipo: "agregacion",
    titulo:
      "La productividad de cada profesional sale de las horas de sus citas",
    queHace:
      "El CRM suma la duración de las citas confirmadas y atendidas de cada profesional en el mes y la compara con las horas de intervención directa que tiene pactadas en su ficha. Nadie teclea nada: sale de la agenda, y el mismo cálculo alimenta la pantalla de Productividad y el panel de Dirección.",
    donde: [
      "lib/clinica/productivityQuery.js:13",
      "lib/clinica/productivityQuery.js:17",
      "app/api/clinica/productividad/route.js:37",
      "app/api/clinica/dashboard/route.js:29",
    ],
    automatico: true,
    nota:
      "Los datos son de Citas y de Equipo; de Clínica viene solo el permiso para entrar (hace falta Clínica o Pacientes, Equipo avanzado y ser dirección).",
  },
  {
    desde: "citas",
    hacia: "team_avanzado",
    tipo: "agregacion",
    titulo:
      "Informe de ocupación: cuántas sillas se quedaron vacías",
    queHace:
      "Agrupa las citas del mes por profesional y por estado, separando las que ya pasaron de las futuras, y da citas y minutos atendidos, anulados y ausencias. Hacen falta Citas, Equipo avanzado y ser dirección.",
    donde: [
      "app/api/citas/informe-ocupacion/route.js:27",
      "app/api/citas/informe-ocupacion/route.js:48",
      "components/layout/Sidebar.jsx:213",
      "app/(dashboard)/equipo/ocupacion/page.jsx:64",
    ],
    automatico: true,
    nota:
      "Contar como atendida una cita futura inflaba las horas y hundía el porcentaje de ausencias; por eso se separan. Es el único informe del bloque que depende de la agenda y no de Clínica.",
  },
  {
    desde: "citas",
    hacia: "clients",
    tipo: "enlace",
    titulo:
      "Cada cita queda atada a la ficha de la familia",
    queHace:
      "Al reservar, tanto desde la web como a mano desde el CRM, la cita se guarda enlazada a la ficha, buscándola por el correo sin distinguir mayúsculas. Antes se cruzaban textos de correo y se rompía en cuanto alguien lo cambiaba.",
    donde: [
      "models/tenant/Booking.model.js:145",
      "lib/db/tenantDb.js:311",
      "app/api/public/c/[tenantSlug]/book/route.js:465",
      "app/api/citas/bookings/route.js:227",
      "app/api/citas/bookings/route.js:383",
    ],
    automatico: true,
    nota:
      "El nombre, el correo y el teléfono con los que se reservó se guardan también como foto del momento. Si se borra la ficha, la cita se queda sin ella pero no desaparece.",
  },
  {
    desde: "citas",
    hacia: "pacientes",
    tipo: "enlace",
    titulo:
      "La cita se agenda para un paciente concreto de la familia",
    queHace:
      "Además de la familia, la cita puede decir qué hijo viene. Hay desplegable de paciente en el alta y en el detalle, y el servidor comprueba que ese paciente exista. En un cliente sin Clínica ni Pacientes el campo se ignora en silencio en vez de dar error.",
    donde: [
      "models/tenant/Booking.model.js:127",
      "lib/db/tenantDb.js:304",
      "app/api/citas/bookings/route.js:34",
      "app/api/citas/bookings/route.js:149",
      "app/api/citas/bookings/[id]/route.js:134",
      "modules/default/CitasModule.jsx:1506",
    ],
    automatico: false,
    nota:
      "El listado de la agenda sigue enseñando los datos de la familia, no los del paciente.",
  },
  {
    desde: "citas",
    hacia: "team",
    tipo: "enlace",
    titulo:
      "Cada cita y cada bloqueo de agenda llevan nombre de profesional",
    seNotaSinDestino: true,
    queHace:
      "La cita guarda a quién se le asigna, y los bloqueos de agenda (vacaciones, un día que no viene) también van por persona; sin persona, cierran el centro entero. La profesional se resuelve antes de comprobar solapes, porque el solape se mira por profesional, no por sala.",
    donde: [
      "models/tenant/Booking.model.js:119",
      "models/tenant/TeamBlock.model.js:47",
      "app/api/citas/bookings/route.js:307",
      "app/api/citas/bookings/route.js:129",
      "app/api/citas/bloqueos/route.js:73",
      "app/api/citas/sin-profesional/route.js:41",
    ],
    automatico: false,
    nota:
      "Sin módulo Equipo el campo ni se ofrece. Quien no es dirección solo ve sus citas, salvo que el centro tenga la agenda compartida encendida. Hay pantalla propia para las citas que se quedaron sin nadie.",
  },

  // ── pacientes ─────────────────────────────────────────────────────────
  {
    desde: "pacientes",
    hacia: "citas",
    tipo: "gating",
    titulo:
      "Un «no» en la ficha del paciente veta el WhatsApp de su cita",
    queHace:
      "Antes de mandar un WhatsApp de cita se mira lo que ha dicho la familia y, si la cita está enlazada a un paciente, también el consentimiento de ese paciente: un «no» en su ficha corta el envío aunque la familia haya dicho que sí. Si no se puede comprobar, tampoco se manda.",
    donde: [
      "lib/citas/avisosWhatsapp.js:41",
      "lib/citas/avisosWhatsapp.js:96",
      "lib/citas/avisosWhatsapp.js:103",
      "lib/citas/avisosWhatsapp.js:106",
    ],
    automatico: true,
    nota:
      "Solo bloquea un «no» explícito: sin ficha de paciente o sin ese consentimiento anotado, se envía.",
  },
  {
    desde: "pacientes",
    hacia: "clients",
    tipo: "gating",
    titulo:
      "Tener módulo de salud cambia el formulario de alta de clientes",
    queHace:
      "Si el cliente tiene Pacientes, Clínica o Nutrición, el alta cambia de cara: desaparece el campo Empresa, la ficha nace como persona y se piden DNI, fecha de nacimiento, domicilio y motivo de consulta, que es lo que hace falta para el contrato. Con Pacientes aparece además el parentesco del titular con el paciente.",
    donde: [
      "lib/clients/formularioAlta.js:43",
      "lib/clients/formularioAlta.js:80",
      "lib/clients/formularioAlta.js:143",
      "app/api/clients/route.js:184",
    ],
    automatico: true,
    nota:
      "Lo deciden los módulos contratados, no una lista de clientes, y el mismo criterio lo usan la pantalla y el servidor.",
  },
  {
    desde: "pacientes",
    hacia: "billing",
    tipo: "agregacion",
    titulo:
      "La lista de morosos sale de las familias con pacientes activos",
    queHace:
      "La pantalla de morosidad no parte de todas las fichas: parte de las familias que tienen algún paciente en activo, que en un centro de cuota mensual es quien debería pagar. Da por al día a quien tenga un cobro registrado de ese mes y ordena al resto por meses seguidos sin pagar, mirando seis atrás.",
    donde: [
      "app/api/billing/morosidad/route.js:43",
      "app/api/billing/morosidad/route.js:53",
      "app/api/billing/morosidad/route.js:66",
      "app/api/billing/morosidad/route.js:107",
    ],
    automatico: true,
    nota:
      "El criterio de «ha pagado» es a propósito el mismo que abre los documentos del mes en el área privada, aunque hoy son dos consultas copiadas y no una regla compartida. En un cliente con Facturación y sin la tabla de pacientes, la pantalla daría error en vez de decir «no aplica».",
  },
  {
    desde: "pacientes",
    hacia: "billing",
    tipo: "agregacion",
    titulo:
      "Facturar desde la ficha del paciente, repartiendo entre pagadores",
    queHace:
      "La ficha del paciente lista sus facturas y crea el borrador ya con el pagador puesto: por defecto su familia, o uno de los pagadores habituales que el CRM deduce de sus facturas anteriores. El reparto de cuota permite una factura con varios cobros, o una factura por pagador exigiendo que la suma cuadre con el total.",
    donde: [
      "app/(dashboard)/pacientes/[id]/page.jsx:642",
      "components/billing/PatientBillingSection.jsx:45",
      "components/billing/PatientBillingSection.jsx:84",
      "components/billing/PatientReparto.jsx:61",
      "components/billing/PatientReparto.jsx:107",
    ],
    automatico: false,
    nota:
      "La pestaña se esconde sola si ese cliente no tiene Facturación. Si el reparto falla a medias, se borran los borradores ya creados.",
  },
  {
    desde: "pacientes",
    hacia: "clients_avanzado",
    tipo: "agregacion",
    titulo:
      "«Fichas a completar» cruza familias, pacientes, agenda y equipo",
    queHace:
      "Ocho carpetas de huecos de datos, partidas en dos bloques: lo que impide trabajar (con cita y sin terapeuta, con cita y sin forma de contacto, ficha muda) y la ficha incompleta (sin terapeuta, sin tutor, sin correo, activos sin ninguna cita del curso). Cada carpeta consulta a la vez pacientes, fichas y agenda, y el total y las filas salen de la misma fuente para que el número se pueda creer. Las fichas archivadas no cuentan, salvo que tengan citas reservadas: ahí el problema deja de ser el dato que falta y pasa a ser la hora cogida.",
    donde: [
      "lib/clients/urgentes.js:70",
      "lib/clients/urgentes.js:185",
      "lib/clients/urgentes.js:308",
      "lib/clients/urgentes.js:335",
      "lib/clients/urgentes.js:368",
      "lib/clients/urgentes.js:443",
      "app/api/clients/urgentes/route.js:29",
      "models/tenant/DataReview.model.js:43",
    ],
    automatico: true,
    nota:
      "Las filas se archivan («esto ya lo he mirado y está bien») y el contador baja; sin eso no llegaría a cero nunca, porque hay huecos correctos. Antes de preguntar se comprueba que la tabla de pacientes exista: a la consulta de nutrición le tumbaba la pantalla entera.",
  },
  {
    desde: "pacientes",
    hacia: "citas",
    tipo: "agregacion",
    titulo:
      "La ficha del paciente enseña sus citas y el contrato de su familia",
    queHace:
      "Al abrir un paciente se piden a la vez sus sesiones, informes y coordinaciones, y también sus citas de la agenda. Si además tiene familia pagadora, la cabecera dice si el contrato está subido o pendiente, con enlace para descargarlo o para gestionarlo en la ficha de la familia.",
    donde: [
      "app/(dashboard)/pacientes/[id]/page.jsx:304",
      "app/(dashboard)/pacientes/[id]/page.jsx:328",
      "app/(dashboard)/pacientes/[id]/page.jsx:613",
    ],
    automatico: true,
    nota:
      "Si el cliente no tiene Citas, esa parte se ignora y la ficha sigue funcionando.",
  },
  {
    desde: "pacientes",
    hacia: "clients",
    tipo: "enlace",
    titulo:
      "Cada paciente cuelga de la familia que paga",
    queHace:
      "El paciente guarda a qué ficha de cliente pertenece, y su ficha carga esa familia con sus teléfonos y correos. Desde la ficha de la familia se llega a sus pacientes. Puede ir vacío a propósito: los pacientes históricos entraron sin pagador.",
    donde: [
      "models/tenant/Patient.model.js:25",
      "lib/db/tenantDb.js:298",
      "app/api/pacientes/route.js:117",
      "app/api/pacientes/[id]/route.js:36",
    ],
    automatico: false,
    nota:
      "Existe un script que deduce el pagador de las propias citas e informes del paciente y deja para revisión humana los ambiguos (padres separados); nunca cruza por nombre, porque confundir familias sería una fuga de datos clínicos.",
  },
  {
    desde: "pacientes",
    hacia: "billing",
    tipo: "enlace",
    titulo:
      "Una factura puede decir de qué paciente es, aunque la pague otro",
    queHace:
      "El pagador de la factura sigue siendo la familia; el paciente es la trazabilidad de a quién se atendió. Sirve cuando paga una abuela, una fundación o el otro progenitor, y cuando una familia tiene dos hijos en el centro. Si el cliente no tiene Clínica ni Pacientes, el dato se ignora en vez de fallar.",
    donde: [
      "models/tenant/Invoice.model.js:28",
      "lib/billing/patientLink.js:17",
      "lib/billing/patientLink.js:26",
      "lib/billing/patientLink.js:38",
      "app/api/billing/invoices/route.js:106",
      "lib/db/tenantDb.js:631",
    ],
    automatico: false,
    nota:
      "Va en columna propia y no en los campos libres porque la factura rectificativa los reinicia.",
  },
  {
    desde: "pacientes",
    hacia: "documents",
    tipo: "enlace",
    titulo:
      "Los documentos del paciente van al archivo central, marcados con su nombre",
    queHace:
      "Lo que se sube desde la ficha de un paciente se guarda en el archivo de documentos del CRM marcado con ese paciente, y se lee filtrando por él. Sin esa marca, «los documentos de este paciente» traería los de todos los hermanos de la misma familia. Tope de 100 por paciente.",
    donde: [
      "models/tenant/Document.model.js:89",
      "app/api/pacientes/[id]/documents/route.js:26",
      "app/api/pacientes/[id]/documents/route.js:50",
      "app/api/pacientes/[id]/documents/route.js:111",
      "app/api/documents/route.js:54",
    ],
    automatico: false,
    nota:
      "Se abre con Clínica o Pacientes, nunca con el módulo Documentos: hay centros con la tabla de documentos y sin ese módulo contratado.",
  },

  // ── formularios ───────────────────────────────────────────────────────
  {
    desde: "formularios",
    hacia: "clients",
    tipo: "conversion",
    titulo:
      "La solicitud de la web se convierte en ficha de cliente",
    queHace:
      "Al pulsar «Aceptar» en la bandeja, el CRM crea la ficha con el nombre, el correo, el teléfono y el DNI que puso la familia, y la solicitud queda aceptada apuntando a esa ficha. También se puede enlazar con una ficha que ya existe: entonces solo se rellenan los huecos y nunca se pisa lo que escribió el equipo.",
    donde: [
      "lib/formularios/accept.js:47",
      "lib/formularios/accept.js:183",
      "lib/formularios/accept.js:280",
      "lib/formularios/accept.js:312",
      "app/api/formularios/[id]/accept/route.js:88",
      "models/tenant/FormSubmission.model.js:93",
    ],
    automatico: false,
    nota:
      "Doble candado contra duplicados: se sale si la solicitud ya tiene ficha, y el UPDATE final exige que siga sin ficha; si no, deshace la ficha recién creada. El GET avisa de posibles duplicados por correo o teléfono.",
  },
  {
    desde: "formularios",
    hacia: "pacientes",
    tipo: "conversion",
    titulo:
      "Aceptar la solicitud crea también la ficha del hijo",
    queHace:
      "Si el formulario recoge los datos del menor y el centro tiene Pacientes, aceptar crea al paciente colgando de la familia en la misma operación. Si no se puede, la pantalla dice por qué (es el propio titular, falta el nombre, no hay datos, no hay módulo).",
    donde: [
      "lib/formularios/accept.js:113",
      "lib/formularios/accept.js:302",
      "lib/formularios/accept.js:349",
      "app/api/formularios/[id]/accept/route.js:112",
    ],
    automatico: false,
    nota:
      "Solo se crea en la rama de ficha nueva; al enlazar con una ficha existente el motivo es «ficha_existente». El módulo se comprueba antes de abrir la transacción para que un centro sin la tabla no tumbe la aceptación entera.",
  },
  {
    desde: "formularios",
    hacia: "citas",
    tipo: "conversion",
    titulo:
      "Aceptar la solicitud le crea la cuenta del área privada",
    queHace:
      "Al aceptar, el CRM pide al WordPress del centro que dé de alta a esa persona y que le mande ella misma el enlace para poner su contraseña. Es la misma cuenta con la que entra al área privada de Citas. Desde la ficha del cliente hay un botón que hace exactamente lo mismo para quien se quedó sin cuenta.",
    donde: [
      "lib/formularios/portalUser.js:27",
      "lib/formularios/portalUser.js:51",
      "app/api/formularios/[id]/accept/route.js:127",
      "app/api/clients/[id]/portal-user/route.js:50",
      "app/api/clients/[id]/portal-user/route.js:123",
    ],
    automatico: false,
    nota:
      "Nunca viaja una contraseña: solo el centro, la web, el correo y el nombre. Si WordPress falla, la ficha ya está creada y solo se informa. Las consultas externas no llevan cuenta, y el botón de la ficha es solo para dirección.",
  },
  {
    desde: "formularios",
    hacia: "citas",
    tipo: "gating",
    titulo:
      "Sin solicitud aceptada no se puede pedir cita",
    queHace:
      "El centro puede exigir que quien reserve haya pasado antes por la bandeja de solicitudes. La agenda pública lo comprueba antes de enseñar huecos y, si no, manda al formulario en vez de dejar reservar; el área privada avisa de la puerta por delante.",
    donde: [
      "lib/citas/puertaFormulario.js:25",
      "lib/citas/puertaFormulario.js:67",
      "app/api/public/c/[tenantSlug]/book/route.js:241",
      "app/api/public/c/[tenantSlug]/citas-portal/admision/route.js:51",
      "app/api/public/c/[tenantSlug]/info/route.js:49",
    ],
    automatico: true,
    nota:
      "«Aceptada» significa además que la ficha existe. Si la bandeja no se puede leer, esta puerta cierra.",
  },
  {
    desde: "formularios",
    hacia: "citas",
    tipo: "gating",
    titulo:
      "A la primera visita solo se llega por el formulario",
    queHace:
      "El centro puede exigir el formulario solo para la valoración inicial, aunque la puerta general esté apagada. Se corta al reservar, después de comprobar que esa persona no haya tenido ya su valoración.",
    donde: [
      "lib/citas/puertaValoracion.js:39",
      "lib/citas/puertaValoracion.js:68",
      "lib/citas/puertaValoracion.js:72",
      "app/api/public/c/[tenantSlug]/book/route.js:281",
    ],
    automatico: true,
    nota:
      "Al revés que la puerta general, esta abre si el centro no tiene el módulo de formularios o no ha configurado la URL.",
  },
  {
    desde: "formularios",
    hacia: "team",
    tipo: "enlace",
    titulo:
      "Al aceptar se elige con qué profesional va la familia",
    queHace:
      "La bandeja ofrece un desplegable con el equipo activo y, al aceptar, esa profesional queda asignada en la ficha del cliente; es lo que después recorta los huecos de la agenda pública a su horario. Queda registrado también quién de la casa atendió la solicitud, al aceptarla o al descartarla.",
    donde: [
      "app/api/formularios/[id]/accept/route.js:86",
      "app/api/formularios/[id]/accept/route.js:99",
      "app/api/formularios/[id]/route.js:84",
      "lib/formularios/accept.js:225",
      "lib/formularios/accept.js:247",
      "modules/formularios/FormulariosModule.jsx:70",
      "lib/citas/quienPregunta.js:37",
    ],
    automatico: false,
    nota:
      "La profesional es el único dato que sí se pisa al enlazar con una ficha existente. Si a esa persona le falta el horario, la bandeja lo avisa en ámbar. Sin módulo Equipo, el desplegable no aparece.",
  },
  {
    desde: "formularios",
    hacia: "clients",
    tipo: "gating",
    titulo:
      "Quien se registra en la web solo entra en la bandeja si no tiene ficha",
    queHace:
      "Cuando alguien se da de alta en la web del centro, el CRM deja una solicitud pendiente, pero antes comprueba que esa persona no sea ya cliente ni tenga otra solicitud esperando. Así el alta que el propio CRM provoca al aceptar no vuelve a generar trabajo. Hay un botón para poner al día de golpe las cuentas antiguas.",
    donde: [
      "lib/formularios/registroWeb.js:104",
      "lib/formularios/registroWeb.js:112",
      "app/api/public/c/[tenantSlug]/registro-web/route.js:35",
      "app/api/public/c/[tenantSlug]/registro-web/sync/route.js:42",
    ],
    automatico: true,
    nota:
      "El formulario interno que recoge estos registros está desactivado a propósito para que nadie pueda colar solicitudes desde el navegador.",
  },

  // ── billing ───────────────────────────────────────────────────────────
  {
    desde: "billing",
    hacia: "clients",
    tipo: "conversion",
    titulo:
      "Dar de alta un cliente sin salir de la factura",
    queHace:
      "Desde la pantalla de facturas y desde la de presupuestos se crea la ficha en el momento y queda seleccionada en el documento que estabas haciendo. En facturas solo se piden nombre y NIF; en presupuestos también correo, teléfono y razón social. En los dos casos es una ficha de Clientes normal.",
    donde: [
      "app/(dashboard)/facturacion/facturas/page.jsx:133",
      "app/(dashboard)/facturacion/facturas/page.jsx:139",
      "app/(dashboard)/facturacion/presupuestos/page.jsx:103",
      "app/(dashboard)/facturacion/presupuestos/page.jsx:108",
    ],
    automatico: false,
  },
  {
    desde: "billing",
    hacia: "documents",
    tipo: "gating",
    titulo:
      "El mes sin pagar tapa los documentos de ese mes en el área privada",
    queHace:
      "El centro puede pedir que los documentos del área privada se abran mes a mes: un mes se abre si hay un cobro registrado de ese mes o si administración lo abre a mano desde la ficha. Lo que ha subido la propia familia nunca se tapa, y a la familia se le dicen los meses bloqueados, no los títulos.",
    donde: [
      "lib/citas/portalMeses.js:25",
      "lib/citas/portalMeses.js:48",
      "lib/citas/portalMeses.js:73",
      "app/api/public/c/[tenantSlug]/citas-portal/documents/route.js:128",
      "app/api/clients/[id]/portal-months/route.js:50",
      "app/api/clients/[id]/portal-months/route.js:99",
    ],
    automatico: true,
    nota:
      "Cruza tres módulos: los cobros los pone Facturación, los ficheros Documentos y la excepción manual Clientes. Viene apagado de fábrica: encenderlo donde no se registran cobros por mes escondería toda la documentación de golpe.",
  },
  {
    desde: "billing",
    hacia: "inventory",
    tipo: "aviso",
    titulo:
      "Avisa si una factura lleva productos y no viene de un pedido",
    queHace:
      "Al emitir una factura con productos del catálogo que no nació de un pedido, el CRM avisa de que ese stock no se ha descontado y de que hay que hacerlo desde Pedidos o con un ajuste. No bloquea la emisión.",
    donde: [
      "app/api/billing/invoices/[id]/issue/route.js:93",
      "lib/inventory/applyStockMovementsForInvoice.js:29",
      "lib/inventory/applyStockMovementsForInvoice.js:38",
    ],
    automatico: true,
    nota:
      "La regla del producto es que el stock se mueve en Pedidos y la factura es solo el documento contable. Antes descontaba también al emitir y eso restaba el doble en las ventas normales.",
  },
  {
    desde: "billing",
    hacia: "clients",
    tipo: "agregacion",
    titulo:
      "La ficha del cliente enseña lo que factura y lo que debe",
    queHace:
      "Dentro de la ficha hay un bloque con lo facturado, lo cobrado, lo pendiente, los costes imputados a ese cliente, el margen y sus últimas facturas. Las cifras de cabecera van sin IVA y el total con IVA se da aparte. Si ese cliente no tiene Facturación, el bloque no se pinta.",
    donde: [
      "app/api/clients/[id]/billing-summary/route.js:12",
      "app/api/clients/[id]/billing-summary/route.js:18",
      "lib/billing/billingSummary.js:169",
      "components/billing/ClientBillingSection.jsx:31",
      "modules/default/ClientDetailModule.jsx:590",
    ],
    automatico: true,
  },
  {
    desde: "billing",
    hacia: "team",
    tipo: "agregacion",
    titulo:
      "Rentabilidad por persona: lo que factura contra lo que cuesta",
    queHace:
      "Facturación agrupa sus facturas por empleado y da, de cada uno, lo facturado, cuántas facturas y clientes, el ticket medio, el coste salarial real y el previsto, el margen y la tasa de cancelación. El mismo resumen aparece dentro de su ficha en Equipo, para que no puedan discrepar.",
    donde: [
      "app/api/billing/analytics/employees/route.js:80",
      "app/api/billing/analytics/employees/route.js:120",
      "app/api/team/[id]/billing-summary/route.js:31",
      "app/api/team/[id]/billing-summary/route.js:40",
      "components/billing/EmployeeBillingSection.jsx:36",
      "lib/billing/billingSummary.js:234",
    ],
    automatico: true,
    nota:
      "El sueldo y el coste previsto se borran de la respuesta si quien mira no es dirección, en los dos sitios. El resumen de la ficha lo abre Facturación: quien tiene Equipo y no Facturación no ve el bloque.",
  },
  {
    desde: "billing",
    hacia: "team",
    tipo: "enlace",
    titulo:
      "El arqueo de caja guarda quién contó el dinero",
    queHace:
      "Al cerrar la caja, el servidor recalcula por su cuenta lo que debería haber (fondo inicial más los cobros en efectivo del día), lo compara con lo contado, guarda la diferencia y la firma con la persona que ha entrado. Si no cuadra, exige escribir el motivo antes de cerrar.",
    donde: [
      "app/api/arqueo/cierres/route.js:28",
      "app/api/arqueo/cierres/route.js:136",
      "app/api/arqueo/cierres/route.js:144",
      "lib/db/tenantDb.js:524",
      "app/(dashboard)/facturacion/arqueo/page.jsx:271",
    ],
    automatico: true,
    nota:
      "El cobro no guarda en qué caja se hizo, así que con dos cajas el «esperado» saldría igual para las dos.",
  },
  {
    desde: "billing",
    hacia: "projects",
    tipo: "enlace",
    titulo:
      "Los presupuestos cuelgan de un proyecto; en facturas y gastos está dormido",
    queHace:
      "Un presupuesto se puede crear y filtrar por proyecto, cambiárselo y verlo en su ficha, y al convertirlo en factura ese proyecto viaja con ella. En facturas y gastos el campo existe pero nadie lo usa todavía: no hay selector en pantalla ni entra en ningún cálculo.",
    donde: [
      "models/tenant/Invoice.model.js:54",
      "models/tenant/Cost.model.js:99",
      "app/api/billing/quotes/route.js:113",
      "app/api/billing/quotes/[id]/route.js:19",
      "app/api/billing/quotes/[id]/convert/route.js:52",
      "lib/db/tenantDb.js:551",
    ],
    automatico: false,
    nota:
      "Los propios modelos lo documentan como enlace pendiente de activar en un sprint posterior de Proyectos.",
  },

  // ── leads ─────────────────────────────────────────────────────────────
  {
    desde: "leads",
    hacia: "clients",
    tipo: "conversion",
    titulo:
      "Un lead se convierte en ficha de cliente",
    seNotaSinDestino: true,
    queHace:
      "Desde el panel del lead hay un botón que crea la ficha con su nombre, teléfono y correo, y deja el lead cerrado apuntando a esa ficha. Solo lo tienen dos clientes con embudo propio: la consulta de nutrición lo cierra como «paciente» y Spain Enzymes como «ganado».",
    donde: [
      "modules/overrides/nutri-laura/LeadsModule.jsx:200",
      "modules/overrides/nutri-laura/LeadsModule.jsx:235",
      "modules/overrides/spain-enzymes/LeadsModule.jsx:312",
      "modules/overrides/spain-enzymes/LeadsModule.jsx:343",
      "app/api/clients/route.js:176",
      "app/api/leads/[id]/route.js:65",
    ],
    automatico: false,
    nota:
      "Son dos llamadas seguidas desde el navegador, sin transacción: si crea la ficha y falla el cierre del lead, queda la ficha creada y el lead sin enlazar. Reintentar no duplica la ficha porque el servidor ignora el enlace si el lead ya tiene una.",
  },
  {
    desde: "leads",
    hacia: "projects",
    tipo: "conversion",
    titulo:
      "Un lead ganado se convierte en proyecto",
    queHace:
      "El CRM crea el proyecto con su código, su presupuesto y sus cuatro columnas de tablero, heredando el cliente del lead y dejando como responsable a quien lo convierte. Después marca el lead como convertido y lo pasa a ganado. Todo de una vez: aquí no puede quedarse a medias.",
    donde: [
      "app/api/leads/[id]/convert-to-project/route.js:19",
      "app/api/leads/[id]/convert-to-project/route.js:56",
      "app/api/leads/[id]/convert-to-project/route.js:85",
      "models/tenant/Lead.model.js:101",
      "lib/db/tenantDb.js:426",
    ],
    automatico: false,
    nota:
      "Hace falta tener los dos módulos, y un lead ya convertido se rechaza. Ojo: el botón existe en el código pero no está puesto en ninguna pantalla, así que hoy solo se puede disparar llamando a la API.",
  },
  {
    desde: "leads",
    hacia: "formularios",
    tipo: "agregacion",
    titulo:
      "Las estadísticas de Leads suman los dos orígenes",
    queHace:
      "Una sola pantalla junta el embudo de leads profesionales (etapas, conversión sobre los cerrados y orígenes) con la bandeja de leads comerciales (pendientes, aceptadas, rechazadas, tasa de aceptación y cuánto lleva esperando la más vieja), y las entradas por mes de cada puerta.",
    donde: [
      "lib/leads/estadisticas.js:130",
      "lib/leads/estadisticas.js:181",
      "lib/leads/estadisticas.js:191",
      "lib/leads/estadisticas.js:202",
      "app/(dashboard)/leads/estadisticas/page.jsx:222",
    ],
    automatico: true,
    nota:
      "Si el cliente no tiene Leads Comerciales, ese bloque no se pinta en vez de salir a cero: no es lo mismo cero que «esto no va contigo».",
  },
  {
    desde: "leads",
    hacia: "analytics",
    tipo: "agregacion",
    titulo:
      "Las visitas de la web se comparan con los leads del mismo periodo",
    queHace:
      "La pantalla de analíticas, además de las visitas por país, cuenta los leads creados en ese mismo rango agrupados por el país que declara quien rellena el formulario, y los pinta en el mapa y en el ranking. Van en columna aparte porque son dos mediciones distintas: una la mide la red, la otra la declara la persona.",
    donde: [
      "app/api/analiticas/route.js:62",
      "app/api/analiticas/route.js:193",
      "app/api/analiticas/route.js:196",
      "modules/analytics/AnaliticasModule.jsx:535",
    ],
    automatico: true,
    nota:
      "Es un extra: solo se calcula si el cliente tiene Leads y, si falla, la pantalla de visitas sigue funcionando sin esa columna.",
  },
  {
    desde: "leads",
    hacia: "clients",
    tipo: "enlace",
    titulo:
      "El lead guarda a qué ficha acabó apuntando",
    seNotaSinDestino: true,
    queHace:
      "El lead recuerda con qué ficha de cliente terminó, y al editarlo el servidor comprueba que esa ficha exista de verdad. De ahí salen las estadísticas de cuántos leads acabaron con ficha, y de ahí hereda el cliente el proyecto cuando un lead se convierte.",
    donde: [
      "models/tenant/Lead.model.js:12",
      "app/api/leads/[id]/route.js:65",
      "lib/leads/estadisticas.js:187",
      "app/api/leads/[id]/convert-to-project/route.js:61",
      "lib/db/tenantDb.js:360",
    ],
    automatico: true,
    nota:
      "El enlace solo se navega de lead a ficha: desde la ficha no hay hoy ninguna pantalla que liste sus leads, aunque la relación esté declarada.",
  },

  // ── orders ────────────────────────────────────────────────────────────
  {
    desde: "orders",
    hacia: "billing",
    tipo: "conversion",
    titulo:
      "Al dar el pedido por servido sale su factura en borrador",
    queHace:
      "Marcar un pedido como completado crea la factura con las líneas del pedido y una línea de transporte si la hay. Nace en borrador con número provisional: hay que pulsar «Emitir» para numerarla de verdad. El pedido y la factura se quedan apuntándose el uno al otro.",
    donde: [
      "app/api/orders/[id]/complete/route.js:35",
      "app/api/orders/[id]/complete/route.js:130",
      "app/api/orders/[id]/complete/route.js:144",
      "app/api/orders/[id]/complete/route.js:174",
      "models/tenant/Order.model.js:67",
      "lib/db/tenantDb.js:611",
    ],
    automatico: true,
    nota:
      "Sin Facturación contratada, el pedido no se puede completar. El IVA sale de los ajustes de Pedidos con respaldo en los de Facturación; el plazo de pago sale solo de Facturación (30 días por defecto).",
  },
  {
    desde: "orders",
    hacia: "inventory",
    tipo: "cascada",
    titulo:
      "Completar un pedido descuenta el stock del almacén",
    queHace:
      "Antes de completar, el CRM comprueba que hay existencias de cada producto y, si falta algo, dice de qué falta, cuánto se pide y cuánto hay. Si hay de todo, la salida de almacén y el pedido completado se guardan a la vez: o pasan las dos cosas o no pasa ninguna.",
    donde: [
      "app/api/orders/[id]/complete/route.js:96",
      "app/api/orders/[id]/complete/route.js:117",
      "app/api/orders/[id]/complete/route.js:153",
      "lib/inventory/stock.js:70",
      "models/tenant/StockMovement.model.js:60",
    ],
    automatico: true,
    nota:
      "Las líneas escritas a mano, sin producto del catálogo, no tocan el almacén. Un cliente sin Inventario completa el pedido igual, sin comprobar nada.",
  },
  {
    desde: "orders",
    hacia: "billing",
    tipo: "gating",
    titulo:
      "Un pedido ya facturado no se puede borrar",
    queHace:
      "Si el pedido está completado y tiene factura, el CRM se niega a borrarlo y pide cancelar antes la factura. Así no queda una factura apuntando al vacío.",
    donde: [
      "app/api/orders/[id]/route.js:124",
    ],
    automatico: true,
  },
  {
    desde: "orders",
    hacia: "inventory",
    tipo: "enlace",
    titulo:
      "Las líneas del pedido se eligen del catálogo del almacén",
    queHace:
      "Cada línea del pedido se rellena eligiendo producto de un desplegable, que trae su precio de venta y lo deja editable para pactar otro con un cliente concreto. Desde la misma pantalla se da de alta un producto nuevo y queda elegido en esa línea.",
    donde: [
      "models/tenant/OrderLine.model.js:23",
      "lib/db/tenantDb.js:608",
      "app/(dashboard)/pedidos/[id]/page.jsx:86",
      "app/(dashboard)/pedidos/[id]/page.jsx:120",
      "app/(dashboard)/pedidos/[id]/page.jsx:139",
    ],
    automatico: false,
    nota:
      "El nombre y el precio se copian a la línea como foto del momento: un pedido de hace un año no cambia de importe si luego se retoca el producto.",
  },
  {
    desde: "orders",
    hacia: "clients",
    tipo: "enlace",
    titulo:
      "Todo pedido va a nombre de una ficha de cliente",
    queHace:
      "El pedido exige cliente: se elige de la lista de fichas y el listado y la portada enseñan su nombre. Ese mismo cliente es el que hereda la factura cuando el pedido se completa.",
    donde: [
      "models/tenant/Order.model.js:24",
      "app/api/orders/route.js:64",
      "lib/db/tenantDb.js:600",
      "app/(dashboard)/pedidos/page.jsx:68",
      "lib/home/summary.js:390",
    ],
    automatico: false,
  },

  // ── nutricion ─────────────────────────────────────────────────────────
  {
    desde: "nutricion",
    hacia: "clients",
    tipo: "conversion",
    titulo:
      "La pauta de nutrición se asigna a una ficha de cliente",
    queHace:
      "Asignar un menú exige elegir una ficha y el servidor comprueba que exista antes de crear nada. El plan que se le queda es una copia entera de la plantilla, así que retocar la plantilla no le cambia el menú a nadie, y las pautas anteriores de esa persona se archivan para que solo haya una vigente.",
    donde: [
      "app/api/nutricion/plans/[id]/assign/route.js:49",
      "app/api/nutricion/plans/[id]/assign/route.js:64",
      "app/api/nutricion/plans/[id]/assign/route.js:76",
      "models/tenant/Plan.model.js:45",
      "lib/db/tenantDb.js:730",
    ],
    automatico: false,
  },
  {
    desde: "nutricion",
    hacia: "clients",
    tipo: "aviso",
    titulo:
      "La pauta se envía por correo al email de la ficha",
    queHace:
      "Desde el listado de pautas se manda el menú en PDF, con la marca del centro, al correo que tenga la ficha del paciente y saliendo de la cuenta de correo del propio cliente. Si la pauta no tiene ficha o la ficha no tiene correo, corta con un mensaje que manda a arreglarlo en Clientes.",
    donde: [
      "app/api/nutricion/plans/[id]/send-email/route.js:63",
      "app/api/nutricion/plans/[id]/send-email/route.js:67",
      "app/api/nutricion/plans/[id]/send-email/route.js:97",
    ],
    automatico: false,
    nota:
      "No deja enviar un menú vacío (comprueba que alguna comida tenga alimentos o recetas) y no permite reenviar el mismo antes de 30 segundos. En la demo pública no se envía nada.",
  },
  {
    desde: "nutricion",
    hacia: "clients",
    tipo: "gating",
    titulo:
      "En una consulta de nutrición, el módulo Clientes se llama «Pacientes»",
    queHace:
      "Donde el cliente es el propio paciente —tiene Nutrición y no tiene Pacientes ni Clínica— el módulo se rotula «Pacientes» en el menú, en la pantalla, en la portada y en la pestaña del navegador. En un centro clínico no, porque allí el cliente es la familia y los pacientes son los hijos, que ya tienen su propia entrada.",
    donde: [
      "lib/clients/vocabulario.js:45",
      "components/layout/Sidebar.jsx:368",
      "app/(dashboard)/clientes/page.jsx:42",
    ],
    automatico: true,
    nota:
      "Va por módulos, no por cliente, y ante la duda pone «Clientes». Sin la condición negativa, un centro clínico tendría dos «Pacientes» en el mismo menú.",
  },
  {
    desde: "nutricion",
    hacia: "clients",
    tipo: "agregacion",
    titulo:
      "La ficha del cliente enseña su historial de pautas",
    queHace:
      "Dentro de la ficha hay una pestaña con todas las pautas asignadas a esa persona, activas y archivadas, diciendo de qué plantilla salió cada una y si esa plantilla ya se retiró.",
    donde: [
      "app/api/clients/[id]/plans/route.js:23",
      "app/api/clients/[id]/plans/route.js:34",
      "modules/default/ClientDetailModule.jsx:704",
      "modules/nutricion/ClientPlansPanel.jsx:73",
      "app/(dashboard)/clientes/[id]/page.jsx:48",
    ],
    automatico: true,
    nota:
      "La dirección cuelga de la ficha del cliente, pero se abre con el módulo Nutrición, porque el dato es de allí.",
  },

  // ── documents ─────────────────────────────────────────────────────────
  {
    desde: "documents",
    hacia: "citas",
    tipo: "gating",
    titulo:
      "Sin el contrato firmado no se puede pedir cita",
    queHace:
      "El centro puede exigir el papeleo firmado antes de reservar. El CRM mira las plantillas activas, las firmas hechas por pantalla y el contrato que se subió a la ficha (el firmado en papel vale igual), y solo bloquea si de verdad hay algo pendiente. La valoración inicial se salta la puerta, porque si no nadie podría entrar nunca.",
    donde: [
      "lib/citas/puertaContrato.js:44",
      "lib/citas/puertaContrato.js:80",
      "lib/citas/puertaContrato.js:113",
      "lib/citas/puertaContrato.js:150",
      "lib/clients/clientContract.js:47",
      "app/api/public/c/[tenantSlug]/book/route.js:306",
    ],
    automatico: true,
    nota:
      "Viene apagada de fábrica y, a propósito, cualquier «no he podido comprobarlo» deja pasar en vez de cerrar. El estado de las firmas vive en el módulo Clientes y el PDF en el de Documentos.",
  },
  {
    desde: "documents",
    hacia: "clients",
    tipo: "compartido",
    titulo:
      "Los adjuntos de la ficha son documentos del archivo central",
    queHace:
      "La pestaña Adjuntos de la ficha escribe y lee en el mismo archivo de documentos del CRM, así que lo que se sube en un sitio se ve en el otro. El contrato de la familia es otra fila de ese archivo, y la ficha guarda cuál es para poder decir «contrato subido».",
    donde: [
      "app/api/clients/[id]/attachments/route.js:25",
      "app/api/clients/[id]/attachments/route.js:53",
      "app/api/clients/[id]/attachments/route.js:146",
      "models/tenant/Client.model.js:180",
      "lib/clients/clientContract.js:23",
      "lib/clients/clientContract.js:47",
      "app/api/clients/[id]/contract/route.js:250",
      "app/api/clients/[id]/contract/route.js:265",
    ],
    automatico: true,
    nota:
      "Los adjuntos se abren con el módulo Clientes, no con Documentos, y siempre acotados a esa ficha y a ese origen: sin ese filtro se podría sacar por ahí un documento privado de otra persona. Si alguien borra el contrato desde Documentos, la ficha lo detecta y no miente.",
  },
  {
    desde: "documents",
    hacia: "citas",
    tipo: "compartido",
    titulo:
      "«Mis documentos» del área privada",
    queHace:
      "El área privada enseña a la familia los documentos de su ficha: los de la ficha, los informes clínicos entregados y los contratos firmados, y solo si están marcados como visibles o los subió ella misma. La misma regla la usan el listado y la descarga, para que no aparezca algo que luego no se puede abrir.",
    donde: [
      "lib/citas/portalDocumentos.js:25",
      "lib/citas/portalDocumentos.js:31",
      "app/api/public/c/[tenantSlug]/citas-portal/documents/route.js:117",
      "app/api/public/c/[tenantSlug]/citas-portal/documents/[id]/route.js:8",
      "app/api/public/c/[tenantSlug]/citas-portal/documents/route.js:217",
    ],
    automatico: true,
    nota:
      "Lo que sube la familia entra como documento de su ficha marcado como suyo, con tope de 20 por familia frente a los 50 que puede subir el centro.",
  },
  {
    desde: "documents",
    hacia: "pacientes",
    tipo: "compartido",
    titulo:
      "El contrato del centro es uno solo y se sube desde dos sitios",
    queHace:
      "La plantilla de contrato de prestación de servicios vive en un único sitio y se puede subir o reemplazar desde Documentos o desde Pacientes: dos puertas al mismo documento. Un centro sin módulo clínico no tenía manera de subirlo, y sin contrato el área privada no le pide la firma a nadie.",
    donde: [
      "lib/documents/contratoServicios.js:38",
      "lib/documents/contratoServicios.js:49",
      "app/api/documents/contrato-servicios/route.js:26",
      "app/api/pacientes/contract-template/route.js:4",
    ],
    automatico: false,
  },

  // ── clients_avanzado ──────────────────────────────────────────────────
  {
    desde: "clients_avanzado",
    hacia: "clients",
    tipo: "conversion",
    titulo:
      "La familia que esperaba plaza pasa a ser cliente",
    queHace:
      "Desde la lista de espera de admisión se crea la ficha copiando nombre, teléfono y correo, y la entrada queda marcada como convertida apuntando a esa ficha. La entrada no se borra: se queda para poder decir cuánto esperó cada familia.",
    donde: [
      "app/api/clients/waitlist/[id]/route.js:59",
      "app/api/clients/waitlist/[id]/route.js:63",
      "app/api/clients/waitlist/[id]/route.js:71",
      "models/tenant/WaitlistEntry.model.js:53",
    ],
    automatico: false,
    nota:
      "La ficha nace con el origen «lista_espera», que es lo que después usa el informe de dirección para decir de dónde vino cada alta. Si la entrada ya tenía ficha, responde 409 en vez de duplicarla.",
  },
  {
    desde: "clients_avanzado",
    hacia: "team",
    tipo: "enlace",
    titulo:
      "A la familia en cola se le puede asignar ya su profesional",
    queHace:
      "Una entrada de la lista de espera puede llevar profesional asignada, y el listado resuelve los nombres de una vez. Puede ir vacía a propósito: «esperando asignación» es un estado legítimo.",
    donde: [
      "models/tenant/WaitlistEntry.model.js:57",
      "models/tenant/WaitlistEntry.model.js:65",
      "lib/clients/listaEspera.js:34",
      "app/api/clients/waitlist/route.js:67",
      "app/api/clients/waitlist/[id]/route.js:102",
    ],
    automatico: false,
    nota:
      "Si el cliente no tiene la tabla de equipo, las filas salen sin nombre en vez de romper la pantalla. Dar de baja a alguien en el CRM no borra su ficha, así que la asignación se queda como estaba.",
  },

  // ── support ───────────────────────────────────────────────────────────
  {
    desde: "support",
    hacia: "clients",
    tipo: "conversion",
    titulo:
      "El ticket se engancha solo a la ficha por el correo",
    queHace:
      "Tanto el ticket que entra por el portal público como el que llega por correo buscan ese email entre los contactos y las fichas de clientes, y nacen ya atados a la ficha correcta. Si no hay coincidencia, el ticket nace suelto con el nombre y el correo de quien escribe, y no se pierde.",
    donde: [
      "app/api/public/c/[tenantSlug]/soporte/route.js:144",
      "app/api/public/c/[tenantSlug]/soporte/route.js:163",
      "app/api/webhooks/resend-inbound/route.js:226",
      "app/api/webhooks/resend-inbound/route.js:238",
      "models/tenant/Ticket.model.js:30",
      "lib/support/context.js:50",
    ],
    automatico: true,
    nota:
      "En el alta manual, el servidor comprueba que cliente, contacto, categoría y responsable existan y que el contacto sea de ese cliente.",
  },
  {
    desde: "support",
    hacia: "team",
    tipo: "aviso",
    titulo:
      "El ticket avisa a la persona que lo lleva",
    queHace:
      "Cada ticket tiene un responsable del equipo y sus mensajes salen firmados con su nombre. Al asignarlo, o al cambiarlo de manos, esa persona recibe aviso en la campana y por correo. Y cada vez que alguien abre la campana se le recuerdan sus tickets con el plazo vencido; a dirección, además, los que no tiene nadie.",
    donde: [
      "models/tenant/Ticket.model.js:61",
      "app/api/tickets/route.js:203",
      "app/api/tickets/[id]/route.js:211",
      "lib/support/notify.js:239",
      "lib/support/context.js:26",
      "lib/notifications/alerts.js:98",
    ],
    automatico: true,
    nota:
      "Los avisos se recalculan en cada visita, así que al responder o resolver desaparecen solos. Quien no tiene ficha de equipo ve «mis tickets» vacío, sin error.",
  },

  // `referidos` tenía aquí sus dos integraciones con Leads —el formulario
  // público y la pantalla filtrada por origen— y se fueron con el módulo el
  // 12/08/2026. El porqué, en `catalogo.js`.

  // ── calendar ──────────────────────────────────────────────────────────
  {
    desde: "calendar",
    hacia: "projects",
    tipo: "agregacion",
    titulo:
      "Las fechas de los proyectos se pintan solas en el calendario",
    queHace:
      "El calendario mezcla sus tareas con lo que lee en vivo de Proyectos: tarjetas con fecha límite, con el color de su columna, e hitos con el color de su estado. No se copia nada. Arrastrar un evento cambia de verdad la fecha en Proyectos, y si el servidor dice que no, el evento vuelve a su sitio.",
    donde: [
      "lib/calendar/projectEvents.js:26",
      "lib/calendar/projectEvents.js:36",
      "lib/calendar/projectEvents.js:48",
      "lib/calendar/projectEvents.js:86",
      "app/api/calendar/tasks/route.js:42",
      "app/(dashboard)/calendario/page.jsx:324",
    ],
    automatico: true,
    nota:
      "Se dejan fuera los proyectos archivados o cancelados y las tarjetas ya hechas; los hitos cumplidos no se pueden arrastrar. Hay un interruptor para ocultar el bloque, y sin el módulo Proyectos el calendario funciona igual.",
  },
  {
    desde: "calendar",
    hacia: "clients",
    tipo: "enlace",
    titulo:
      "Una tarea del calendario se puede colgar de un cliente",
    queHace:
      "La tarea puede ir asociada a una ficha de cliente, su nombre se ve en el evento y el calendario se puede filtrar por cliente. Si se borra la ficha, la tarea sigue viva y se queda sin cliente; si llega un cliente que no existe, avisa en vez de romper.",
    donde: [
      "models/tenant/CalendarTask.model.js:58",
      "lib/calendar/calendarEvent.js:40",
      "lib/calendar/calendarEvent.js:79",
      "app/api/calendar/tasks/route.js:27",
      "app/api/calendar/tasks/route.js:71",
      "scripts/migrate-calendar-citas-fks.js:60",
    ],
    automatico: false,
  },

  // ── provisioning ──────────────────────────────────────────────────────
  {
    desde: "provisioning",
    hacia: "billing",
    tipo: "conversion",
    titulo:
      "El alta de un cliente deja Facturación lista para emitir",
    queHace:
      "Si en el alta se contrata Facturación y se rellenan los datos fiscales, el CRM los guarda como configuración de facturación del cliente nuevo. Y antes lanza la preparación del cliente con los módulos elegidos, que es lo que crea las series de factura: sin ellas, «Emitir» daba error el primer día.",
    donde: [
      "lib/provisioning/altaTenant.js:64",
      "lib/provisioning/altaTenant.js:198",
      "lib/provisioning/altaTenant.js:221",
      "lib/provisioning/catalogo.js:48",
    ],
    automatico: true,
    nota:
      "Si la preparación falla, el alta no se aborta: deja un aviso con el comando exacto que hay que lanzar.",
  },
  {
    desde: "provisioning",
    hacia: "clinica",
    tipo: "gating",
    titulo:
      "Vender Clínica enciende sola Pacientes y Clientes",
    queHace:
      "El alta de clientes conoce las dependencias entre módulos y las arrastra: Clínica trae Pacientes y Pacientes trae Clientes; Nutrición trae Clientes; Equipo avanzado trae Equipo; Documentos avanzado trae Documentos; Leads Comerciales trae Clientes y Leads; Cuestionarios trae Formación. Al editar los módulos de un cliente, el CRM avisa de lo que se enciende de rebote y de lo que no se puede quitar porque otro módulo lo necesita.",
    donde: [
      "lib/provisioning/catalogo.js:56",
      "lib/provisioning/catalogo.js:64",
      "lib/provisioning/catalogo.js:89",
      "lib/provisioning/cicloVida.js:148",
      "lib/provisioning/cicloVida.js:175",
      "lib/provisioning/cicloVida.js:197",
    ],
    automatico: true,
    nota:
      "Desactivar un módulo no borra datos: vuelven al reactivarlo. Estas dependencias solo se aplican en el alta y en la edición de módulos; un cliente antiguo puede estar en una combinación que hoy no se vendería.",
  },

  // ── projects ──────────────────────────────────────────────────────────
  {
    desde: "projects",
    hacia: "team",
    tipo: "gating",
    titulo:
      "Quién puede tocar un proyecto lo decide su ficha de Equipo",
    queHace:
      "Un proyecto lo edita dirección o quien sea su responsable, y ser responsable exige tener ficha de equipo: la pertenencia a un proyecto es siempre de una ficha de equipo, no de un usuario suelto. Al crear un proyecto, quien lo crea se apunta como responsable si tiene ficha.",
    donde: [
      "lib/projects/projectAuth.js:27",
      "lib/projects/projectAuth.js:55",
      "lib/projects/projectAuth.js:70",
      "app/api/projects/route.js:138",
      "models/tenant/ProjectMember.model.js:29",
    ],
    automatico: true,
  },
  {
    desde: "projects",
    hacia: "clients",
    tipo: "enlace",
    titulo:
      "Cada proyecto se cuelga de un cliente",
    queHace:
      "El proyecto puede ir a nombre de una ficha de cliente; el listado y el detalle enseñan su nombre y la pantalla permite filtrar por cliente. Hay además una consulta para pedir los proyectos de una ficha concreta.",
    donde: [
      "models/tenant/Project.model.js:24",
      "app/api/projects/route.js:66",
      "app/api/projects/[id]/route.js:45",
      "app/api/clients/[id]/projects/route.js:7",
      "app/(dashboard)/proyectos/page.jsx:77",
    ],
    automatico: false,
    nota:
      "El bloque «Proyectos» de la ficha de cliente está escrito pero no está puesto en ninguna pantalla: la consulta funciona y hoy nadie la llama.",
  },

  // ── inventory ─────────────────────────────────────────────────────────
  {
    desde: "inventory",
    hacia: "billing",
    tipo: "compartido",
    titulo:
      "El proveedor es la misma ficha para el almacén y para los gastos",
    queHace:
      "El proveedor es una sola ficha compartida: la pantalla vive en Facturación y el alta de entrada de mercancía la usa como desplegable, avisando de dónde se crean si está vacía. Se abre teniendo Facturación o Inventario, para que un centro con uno solo de los dos mantenga su lista.",
    donde: [
      "app/api/proveedores/route.js:14",
      "app/api/proveedores/[id]/route.js:23",
      "app/api/proveedores/[id]/route.js:93",
      "lib/billing/bajaProveedor.js",
      "models/tenant/StockEntry.model.js:47",
      "models/tenant/Cost.model.js:86",
      "app/(dashboard)/inventario/page.jsx:398",
    ],
    automatico: true,
    nota:
      "Las dos mitades quedaron cableadas en agosto de 2026 y esta nota contaba lo de antes: hasta el 20/08 la pantalla de gastos no pedía proveedor y el «total pagado» de su ficha salía cero para todos (lo abrió f09a764), y hasta el 21/08 la baja del proveedor solo contaba gastos, así que uno del que solo hubiera mercancía se borraba de verdad y sus entregas se quedaban apuntando a un proveedor inexistente —StockEntry.supplierId no tiene clave foránea y nadie se quejaba—. Hoy la baja cuenta las dos cosas, cada una gateada por su módulo, y dice de qué son los usos; un proveedor con algo colgando se desactiva en vez de borrarse. Lo que sigue abierto es que la lista de gastos filtra por proveedor pero su buscador libre se aplica en el navegador, así que con una búsqueda escrita el Excel trae más filas que la tabla.",
  },
  {
    desde: "inventory",
    hacia: "orders",
    tipo: "cascada",
    titulo:
      "Retirar un producto no borra los pedidos que lo llevaban",
    queHace:
      "Si un producto se borra, las líneas de pedido que lo usaban se quedan sin enlace pero conservan el nombre y el precio: ni el pedido desaparece ni cambia de importe. Un producto con movimientos de almacén no se borra, se marca inactivo.",
    donde: [
      "scripts/migrate-inventario-rework.js:326",
      "models/tenant/OrderLine.model.js:3",
      "app/api/inventory/products/[id]/route.js:89",
    ],
    automatico: true,
    nota:
      "La protección solo mira los movimientos de almacén, no los pedidos: un producto usado en un pedido en borrador y sin ningún movimiento se borra sin avisar.",
  },

  // ── outreach ──────────────────────────────────────────────────────────
  {
    desde: "outreach",
    hacia: "clients",
    tipo: "conversion",
    titulo:
      "Una empresa captada se convierte en ficha de cliente",
    queHace:
      "En la ficha de una empresa captada hay un botón que crea el cliente con su nombre, notas, teléfono y correo, y guarda de dónde salió (web, sector, ciudad, origen «captación»). La empresa no se borra: queda marcada como convertida, sale del listado de captación y la siguiente búsqueda ya no la vuelve a meter.",
    donde: [
      "app/api/outreach/leads/[id]/convertir-cliente/route.js:33",
      "app/api/outreach/leads/[id]/convertir-cliente/route.js:51",
      "app/api/outreach/leads/[id]/convertir-cliente/route.js:86",
      "modules/outreach/OutreachLeadDetail.jsx:397",
      "models/tenant/OutreachLead.model.js:93",
      "lib/outreach/persistLeads.js:54",
    ],
    automatico: false,
    nota:
      "El correo solo se copia si tiene forma de correo, para que un dato mal raspado no tumbe el alta. Si el cliente no tiene el módulo Clientes, avisa en vez de crear nada.",
  },

  // ── documents_avanzado ────────────────────────────────────────────────
  {
    desde: "documents_avanzado",
    hacia: "documents",
    tipo: "agregacion",
    titulo:
      "El buscador de Documentos ve el archivo entero del CRM",
    queHace:
      "Con Documentos avanzado, el buscador rebusca en todo el archivo por nombre, cliente, paciente u origen, ignorando las carpetas: ahí caen los adjuntos de las fichas, los informes clínicos, los contratos firmados y los papeles del equipo. Borrar desde ahí borra el fichero de verdad. Quien solo tiene Documentos básico llega únicamente al contrato del centro.",
    donde: [
      "app/api/documents/route.js:31",
      "app/api/documents/route.js:44",
      "app/api/documents/[id]/route.js:42",
      "lib/documents/documentStorage.js:28",
      "lib/documents/documentStorage.js:179",
    ],
    automatico: true,
    nota:
      "La cuota de 1 GB por cliente es común a todos los módulos que guardan documentos. Un contrato firmado en el área privada no tiene dueño, así que desde aquí no lo puede borrar nadie.",
  },

  // ── training ──────────────────────────────────────────────────────────
  // AQUÍ HABÍA UNA INTEGRACIÓN training↔cuestionarios. Se borró el 10/08/2026,
  // cuando Cuestionarios dejó de ser un módulo: una integración es un puente
  // entre dos cosas que se venden por separado, y esto ya es una pantalla de
  // Formación sobre la tabla de Formación. Lo que decía —que comparten
  // `quiz_attempts` y la entrada desde TutorLMS— sigue siendo verdad, pero es
  // funcionamiento interno de un módulo, no un cruce entre dos.
];
