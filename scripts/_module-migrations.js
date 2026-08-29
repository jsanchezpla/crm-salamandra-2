/**
 * _module-migrations.js — mapa declarativo MÓDULO → MIGRACIONES.
 *
 * Hasta ahora este conocimiento solo vivía en los runbooks de `docs/` y en la
 * cabeza de Jorge: qué migraciones hay que correr cuando un tenant estrena un
 * módulo, y en qué orden. Ese hueco es lo que provocó el incidente del
 * 2026-07-21 (activar un módulo dejaba el schema atrás y toda lectura reventaba
 * con 42703). Aquí queda escrito para que lo sepa la máquina.
 *
 * Lo consume `scripts/ensure-tenant-schema.js`.
 *
 * ── Tres estructuras ───────────────────────────────────────────────────────
 *
 * ORDER   Orden canónico GLOBAL, CALCULADO del SQL de las migraciones (ver
 *         _migration-order.js). Hace falta porque hay dependencias CRUZADAS
 *         entre módulos, no solo dentro de uno: p. ej.
 *         `client-module-assignments` crea el índice único
 *         `patients_client_unique` que `patients-multi-per-client` luego
 *         ELIMINA — invertirlas rompe. Esa arista, y las otras 15, salen de
 *         leer el código, no de acordarse.
 *
 * MODULES Qué migraciones pertenecen a cada `module_key`. Una misma migración
 *         puede estar en varios módulos (ej. calendar-citas-fks toca tanto
 *         calendar_tasks como bookings).
 *
 * CORE    Migraciones transversales que se ejecutan SIEMPRE, tenga el tenant los
 *         módulos que tenga. Son aditivas y deciden por existencia de tabla, así
 *         que en un schema que no las necesita son un no-op. (La excepción es
 *         `migrate-leads-columnas-proyecto`, que decide leyendo el módulo `leads`
 *         de master en vez de mirar la tabla; el efecto es el mismo, pero está
 *         dicho para que nadie lo dé por hecho.)
 *
 *         El criterio para meter algo aquí y no en su módulo: la columna vive en
 *         una tabla cuyo MODELO la declara para TODOS los tenants, así que
 *         Sequelize hace SELECT de ella aunque el tenant no tenga el módulo que
 *         la estrenó. Ahí, dejarla en el módulo es un 42703 esperando.
 */

import { computeOrder } from "./_migration-order.js";

/**
 * Migraciones EXCLUIDAS a propósito: no son migraciones de módulo reutilizables,
 * son parches históricos atados a un tenant concreto (hardcodean el slug, contra
 * la regla 12 de CLAUDE.md). Ejecutarlas en otro entorno falla con "Schema
 * crm_X no existe", que es exactamente lo que pasó al probar el disparador.
 * Ya están aplicadas en producción; se dejan documentadas, no automatizadas.
 *
 * Si algún día se generalizan (leer los tenants de master.tenants en runtime),
 * muévanse a MODULES y a ORDER.
 */
export const ONE_OFF = {
  "migrate-quality-leads": "atada a quality_energy",
  "backfill-nutricion-assignments": "DATOS: marca «Paciente Nutrición» a los clientes previos al auto-marcado (2026-07-27); repetible, se corre a mano",
  "backfill-patients-client": "DATOS: enlaza pacientes con su ficha de pagador a partir de sus citas/sesiones; dry-run por defecto, se corre a mano con --confirm",
  "migrate-contract-patient-to-client": "DATOS: mueve el contrato del paciente a la familia (sprint 2026-07, 1.1); copia el PDF a `documents` y apunta clients.contract_document_id; dry-run por defecto, se corre a mano con --confirm",
  "podar-audit-logs": "MANTENIMIENTO del schema MASTER: retención del registro de auditoría; dry-run por defecto, lo lanza un temporizador semanal",
  "migrate-documents-avanzado": "MASTER, no toca schemas de tenant: reparte el módulo Documentos en básico/avanzado y da el avanzado a quien ya tenía Documentos, para que nadie pierda el archivo por el cambio de nomenclatura. Se corre a mano una vez, idempotente",
  "migrate-audit-logs-index": "índice en el schema MASTER (audit_logs), no por-tenant; idempotente, se corre a mano una vez",
  "migrate-clients-avanzado": "MASTER, no toca schemas de tenant: saca la lista de espera de admisión de `clients` a `clients_avanzado` y se la da solo a quien admite por cola (aumenta, demo). Se corre a mano una vez, idempotente",
  "migrate-users-recuperacion": "MASTER, no toca schemas de tenant: añade `reset_token_hash` y `reset_token_expira` a `master.users` para el enlace de «¿Olvidaste tu contraseña?». Aditiva (nacen NULL) e idempotente; NO escribe ni una fila. VA ANTES del despliegue: el modelo pide esas columnas por nombre en cada SELECT",
  "migrate-users-email-contacto": "MASTER, no toca schemas de tenant: añade `email_contacto` a `master.users` —a dónde se le escribe a esa cuenta, y su segundo identificador para entrar— con su índice único. Aditiva (nace NULL en todas las filas) e idempotente; NO escribe ni una fila, rellenar las que se pueda es `backfill-correo-cuenta.js`. VA ANTES del despliegue: el modelo pide esa columna por nombre en cada SELECT",
  "migrate-usuario-backoffice": "MASTER, no toca schemas de tenant: añade `solo_backoffice` a `master.users` para separar las cuentas del panel interno de las del CRM. Se corre a mano con `npm run db:migrate:backoffice`; aditiva, con default false, idempotente",
  // Faltaba desde que se escribió (12/08/2026) y dejaba `check-migration-order`
  // en rojo con dos incoherencias: «sin módulo asignado (nadie las ejecutaría)»
  // e «ilegibles y sin arista declarada». No es la primera vez que pasa —los
  // commits 74fc6d2 y be465f5 arreglaron lo mismo— así que el despiste es del
  // flujo, no de nadie: una migración de MASTER no cae sola en ningún módulo.
  "migrate-tablero-estado": "MASTER, no toca schemas de tenant: crea `master.tablero_estado`, donde el Registro guarda el tick, el reparto, la solución y —desde el 26/08/2026— la fecha en que se apuntó cada tarea (`apuntada_en`, que añade sobre la tabla que ya existía). Se corre a mano, idempotente, y VA ANTES del despliegue: el código nuevo pide esa columna por nombre",
  "migrate-tablero-documentos": "MASTER, no toca schemas de tenant: crea `master.tablero_documentos`, donde vive el TEXTO del Registro (backlog y resuelto, una fila por versión) desde el 19/08/2026, cuando dejó de viajar en la imagen de Docker. Solo crea tabla e índice; el texto lo carga `tablero-doc.js publicar` cuando se le dice. Se corre a mano una vez, idempotente",
  "migrate-paquetes-modulos": "MASTER, no toca schemas de tenant: crea `master.paquetes_modulos` y siembra los dos paquetes que hasta ahora estaban escritos en `catalogo.js`. Se corre a mano con `npm run db:migrate:paquetes`; idempotente, y la semilla NO restaura lo que se haya borrado después",
  "migrate-auto-asignar-nutricion":
    "MASTER, no toca schemas de tenant: enciende `featureFlags.autoAsignarEnAlta` en la fila de `nutricion` de quien ya dependía del auto-marcado (nutri_laura). El flag nace apagado para todos los demás a propósito — antes, tener el módulo bastaba para que TODA ficha nueva se marcara como paciente de nutrición. Se corre a mano una vez, idempotente",
  "migrate-buzon": "MASTER, no toca schemas de tenant: crea `master.buzon_avisos`, `buzon_mensajes`, `buzon_adjuntos` y la secuencia del correlativo, que es donde caen los avisos que nos mandan los clientes. Va en master —y no en el schema de cada uno— para que sobrevivan a su baja y para que funcionen aunque su base esté rota. Desde el 13/08/2026 además AÑADE Y RELLENA `cliente_escribio_at` sobre la tabla que ya existía (la campana del panel), así que ya no solo crea: correrla es obligatorio en cada despliegue que traiga una columna nueva, y el relleno solo toca las filas a NULL. Se corre a mano con `npm run db:migrate:buzon`; idempotente",
};

/**
 * Orden canónico global. NO se escribe a mano: se DEDUCE del SQL de cada
 * migración (quién crea una tabla va antes que quien la altera) en
 * scripts/_migration-order.js. Audítalo con:
 *
 *   node scripts/check-migration-order.js
 */
export const ORDER = computeOrder();

export const CORE = [
  // Aditivas y decididas por existencia de tabla: no-op donde no aplican.
  "migrate-calendar-citas-fks",
  // Videollamada y convocatoria de un evento del Calendario (27/08/2026). CORE
  // y NO dentro de `calendar` por el criterio de arriba: el modelo
  // `CalendarTask` declara `meetUrl`, `inviteEmail` e `inviteSentAt` para TODOS
  // los tenants, así que Sequelize las pide en cada SELECT de `calendar_tasks`
  // tenga el tenant el módulo o no. Dejarla dentro del módulo es un 42703
  // esperando al próximo schema que tenga la tabla sin haber comprado Calendario.
  "migrate-calendar-videollamada",
  "migrate-patients-clients-phase1",
  // Tabla notifications (transversal): la usa el sistema de alertas de Clínica,
  // pero se crea en todos los schemas porque el modelo Notification está
  // registrado para todos los tenants (evita 42703 si algún código la consulta).
  "migrate-notifications-table",
  // Tabla ai_permissions (transversal): permisos de empleados para usar la IA
  // de pago cuando el tenant activa settings.aiAccess = "restringido". Modelo
  // registrado para todos los tenants, mismo criterio que notifications.
  "migrate-ai-permissions",
  // Capa de pagos online (payment_sessions + stripe_webhook_events). Transversal
  // por el mismo motivo: los modelos están registrados para todos los tenants.
  // Cobrar o no depende de que el tenant tenga sus claves de Stripe, no de que
  // exista la tabla.
  "migrate-payments-sprint-1",
  // Sprint Aumenta 2026-07: cobros sin factura, faltas justificadas, registro
  // de sesión en 3 partes, tipo "Derivación", tutores del cliente, festivos,
  // lista de espera, plan de intervención y multi-responsable en incidencias.
  // CORE y no por módulo porque toca tablas de VARIOS módulos (billing, citas,
  // clinica, clients) y cada bloque decide por existencia de tabla: en un
  // tenant sin esa tabla es un no-op. Sin registrarla aquí, un cliente dado de
  // alta desde el panel nacía sin blocked_days ni intervention_plans y esas
  // pantallas le respondían 503.
  "migrate-sprint-aumenta-2026-07",
  // Terapeuta asignado en la cola de admisión. CORE por el mismo motivo que la
  // de arriba —que es quien crea `waitlist_entries`—: decide por existencia de
  // tabla, así que en un tenant sin `clients_avanzado` es un no-op.
  "migrate-waitlist-therapist",
  // Contrato del portal con datos y anexos (04/08/2026). CORE porque AMPLÍA
  // `contract_signatures`, que la crea `migrate-sprint-aumenta-2026-07` para
  // todos los tenants: sin esta, un cliente nuevo nace con la tabla vieja y la
  // primera firma revienta pidiendo `template_key`. La tabla de plantillas sí
  // se crea solo donde hay `citas` (lo decide el propio script).
  "migrate-contrato-estructurado",
  // Una persona MENOR firma su contrato SIN dibujar la firma (06/08/2026): quita
  // el NOT NULL de `contract_signatures.signature_path`. CORE por lo mismo que la
  // de arriba, y pegada a ella a propósito: las dos AMPLÍAN la misma tabla, que
  // se crea para todos los tenants. Dejarla en `citas` partiría el estado de esa
  // tabla en dos —schemas con el contrato estructurado pero con la columna aún
  // NOT NULL—, y el modelo ContractSignature ya la declara nullable: la primera
  // firma de una menor reventaría con 23502.
  "migrate-firma-opcional-menores",
  // NIF/CIF de facturación (08/08/2026): a nombre de quién se emite la factura,
  // que no siempre es el titular de la ficha. CORE y no dentro de `billing`
  // porque la columna vive en `clients` y el MODELO Client la declara para
  // todos los tenants: Sequelize hace SELECT de todos los atributos, así que un
  // cliente sin la columna vería su /clientes caerse entero con 42703 aunque no
  // tenga facturación. Decide por existencia de tabla `clients`.
  "migrate-client-fiscal-taxid",
  // Citas autoconfirmadas paciente a paciente (06/08/2026): la profesional exime
  // de la bandeja de confirmación a la de siempre, desde su ficha. Mismo caso que
  // la de arriba: suena a `citas`, pero la columna vive en `clients` y el MODELO
  // Client declara `autoConfirmBookings` para todos los tenants, así que sin ella
  // CUALQUIER lectura de una ficha se cae con 42703, tenga citas o no.
  // Y tampoco vale con apuntarla solo en `clients`: `citas` NO requiere `clients`
  // en el catálogo de alta, y quien compre solo Citas se quedaría sin la exención
  // en silencio — la reserva pública se traga el 42703 a propósito (para que
  // reservar nunca falle por esto) y trata a todo el mundo como no eximido.
  // Aditiva y por existencia de tabla `clients`.
  "migrate-citas-autoconfirmadas-por-paciente",
  // Las dos columnas de conversión a proyecto que viven en `leads`
  // (`converted_project_id`, `converted_to_project_at`). CORE y NO dentro de
  // `projects` porque no son de Proyectos: son de LEADS, y el MODELO Lead las
  // declara para todos los tenants —`lib/db/tenantDb.js` registra los modelos sin
  // gatear por módulo—, así que Sequelize hace SELECT de ellas en CUALQUIER
  // consulta de leads. Mientras solo las creaba `migrate-projects-sprint-1`, que
  // filtra por el módulo `projects` y hace bien, los tenants con `leads` y sin
  // `projects` se quedaron sin ellas: `abarcaia` estuvo del 05/05 al 10/08/2026
  // sin registrar UN SOLO lead de su formulario público, porque `Lead.create`
  // moría con 42703 antes de guardar nada.
  // No choca con `migrate-projects-sprint-1`: aquella añade estas dos con
  // `addColumnIfNotExists`, así que corra antes o después, la segunda es un no-op
  // (y el analizador de orden no las ata entre sí porque `leads` no la crea
  // ninguna migración: nace de los modelos vía db:sync).
  "migrate-leads-columnas-proyecto",
  // Color de los bloqueos por profesional (`team_members.block_color`,
  // 10/08/2026). CORE y NO junto a su hermana `migrate-team-members-avatar-color`
  // en `team`, aunque la columna viva en la misma tabla: quien la LEE es CITAS
  // —`app/api/citas/bloqueos/route.js` la pide en el include de TeamMember—, y
  // `citas` NO requiere `team` en el catálogo de alta (`lib/provisioning/catalogo.js`).
  // Dejarla en `team` haría que un tenant de solo Citas con tabla `team_members`
  // se quedara sin la columna y la agenda de bloqueos cayera con 42703. Es el
  // mismo caso que `migrate-citas-autoconfirmadas-por-paciente`, aquí arriba.
  // Decide por existencia de `team_members`: donde no está —healim, que solo
  // tiene Citas— es un no-op.
  "migrate-team-members-block-color",

  // Nº de colegiada y titulación de quien firma un informe
  // (`team_members.collegiate_number` y `.qualification`, 28/08/2026, Aumenta).
  // CORE y NO en `team` por el criterio de la cabecera, que es el mismo caso
  // EXACTO de `migrate-team-members-block-color` aquí arriba: el modelo
  // TeamMember se registra para TODOS los tenants (`lib/db/tenantDb.js`), así
  // que Sequelize hace SELECT de las dos columnas en cualquier consulta de
  // `team_members` —tenga el cliente el módulo Equipo o no—. Dejarlas en `team`
  // sería un 42703 en la pantalla de Equipo, en los desplegables de
  // profesionales y en la agenda del primer cliente con la tabla y sin el
  // módulo. Decide por existencia de `team_members`: donde no está, es un no-op.
  "migrate-team-colegiada",

  // Documento adjunto a una incidencia (`documents.incidencia_id`, 26/08/2026,
  // Aumenta). CORE por el mismo criterio que migrate-documents-patient-link, que
  // es su hermana: la columna vive en `documents` y el MODELO Document la declara
  // para TODOS los tenants, así que sin ella cualquier lectura del archivo
  // central da 42703, tenga el tenant incidencias o no. Aditiva y por existencia
  // de tabla `documents`; la FK a `incidencias` solo donde esa tabla existe.
  "migrate-documents-incidencia-link",

  // Alinea el ON DELETE de las cuatro FKs de `team_members` que decían cosas
  // distintas en cada cliente (26/08/2026). CORE porque el destrozo no depende
  // del módulo sino de CÓMO NACIÓ el schema: el alta lanza `sync()` antes que
  // las migraciones, así que la FK que quedaba era la que Sequelize se inventa
  // —y `clinical_reports.therapist_id` salía CASCADE, o sea que borrar a un
  // profesional le borraba sus informes clínicos—. Decide por existencia de
  // tabla: donde no hay Clínica ni bloqueos, es un no-op.
  //
  // ⚠️ Va aquí ADEMÁS de haberse ejecutado a mano, porque un tenant que se
  // reactive o que estrene Clínica tiene que nacer alineado. La causa (que
  // `sync()` se adelante) está tapada por su lado en `lib/db/tenantDb.js`, que
  // ya declara el `onDelete` de las cuatro.
  "migrate-fks-equipo-alineadas",

  // Tablas de la pantalla /correo (26/08/2026): `correo_listas`,
  // `correo_plantillas` y `correo_firmas`. CORE por el criterio de siempre: los
  // tres modelos están registrados en `lib/db/tenantDb.js` para TODOS los
  // tenants (la pantalla se ve con `clients` O con `outreach`, que no comparten
  // módulo), así que la tabla tiene que existir en todos los schemas o la
  // primera lectura da 42703. Solo crea tablas nuevas: idempotente y aditiva.
  "migrate-correo-herramientas",
];

export const MODULES = {
  leads: ["migrate-stage-to-string"],

  // Tabla donde el CRM guarda su propia foto diaria de las visitas. Hace falta
  // porque Cloudflare solo conserva 7 días: sin esta copia no hay forma de
  // enseñar meses ni años, y el dato viejo se pierde para siempre.
  analytics: ["migrate-web-visits-daily"],

  clients: [
    // Cada paciente con SU profesional (06/08/2026): la agenda pública le
    // enseña solo los huecos de quien lleva su seguimiento.
    // «Consultas externas» (07/08/2026): pacientes de acuerdos con empresas.
    // Se guardan aquí como los demás, pero sin cuenta en la web.
    "migrate-consultas-externas",
    "migrate-nutricionista-asignada",
    // «Ya lo he mirado y está bien»: sin esto, la pantalla de fichas a
    // completar no llega a cero nunca (03/08/2026).
    "migrate-data-reviews",
    "migrate-client-attachments-and-notes",
    "migrate-patients-clients-phase1",
    "migrate-client-module-assignments",
    // Consentimiento de comunicaciones de la familia (01/08/2026): aditiva,
    // una columna JSONB en clients.
    "migrate-client-communication-prefs",
    // Fecha de nacimiento del cliente (04/08/2026): en un centro de nutrición
    // el paciente ES el cliente, y es lo que decide si al firmar el contrato
    // hace falta además el consentimiento de su tutor legal.
    "migrate-client-birthdate",
    "migrate-interactions-notes-team",
    "migrate-documents-transversal",
    // El archivo central (documents) se crea para cualquier tenant con clients;
    // patient_id también debe llegar ahí (la columna es incondicional, la FK
    // solo si existe patients). Si no, un tenant solo-clientes tendría documents
    // sin patient_id y el modelo reventaría con 42703 al leer adjuntos.
    "migrate-documents-patient-link",
    "migrate-onedrive-archivo",
    // Mismo motivo: el modelo Document referencia client_visible y
    // uploaded_by_client en TODOS los tenants con tabla documents, así que las
    // columnas tienen que existir aunque el tenant no tenga portal de paciente.
    "migrate-documents-client-portal",
  ],

  citas: [
    // «Vacaciones» (06/08/2026): tramos con hora en los que alguien no pasa
    // consulta. Los festivos cierran el centro un día entero; esto es por
    // persona y con hora, que es lo que pasa de verdad en un equipo.
    "migrate-vacaciones",
    "migrate-citas-sprint-1",
    "migrate-calendar-citas-fks",
    "migrate-booking-pending",
    "migrate-booking-client-link",
    "migrate-booking-change-requests",
    // Marca de "ya se le mandó el recordatorio de la víspera".
    "migrate-booking-reminder",
    // Retención de tarjeta (autorizado sin cobrar): valores nuevos del enum de
    // payment_status y `authorization_expires_at`. Va aquí porque un tenant que
    // estrene Citas nace con `bookings`, y sin esta migración el modelo pide una
    // columna que no existe y CUALQUIER consulta de citas revienta con un 500
    // (visto en local el 31/07). El script se salta solo los schemas sin las
    // tablas de pagos, así que es inofensivo para quien no cobre online.
    "migrate-booking-authorization",
    // El correo de la cita deja de ser obligatorio (02/08/2026): una cita que
    // apunta recepción por teléfono, o que llega importada, puede no tenerlo.
    // SIN ESTO la importación de una agenda revienta a mitad.
    "migrate-booking-email-opcional",
    // Y el teléfono, por lo mismo (28/08/2026). Aquella migración dejó el
    // trabajo a medias sin querer: quitó la obligación del correo y dejó la del
    // teléfono, y como la pantalla exigía los dos nadie lo notó. De los 1.050
    // pacientes activos de Aumenta había 164 a los que no se podía citar porque
    // su familia no tiene ninguno de los dos. SIN ESTO, crear una cita sin
    // teléfono revienta con un 500 en vez de crearse.
    "migrate-booking-telefono-opcional",
    // Horario propio del profesional (team_member_hours): lo usa la generación
    // de huecos de citas, pero su tabla base es team_members (por eso está
    // también en `team`).
    "migrate-team-member-hours",
    // Avisos del centro al cliente (03/08/2026): salen por correo y quedan
    // publicados en el portal. Cuelga de `citas` porque el portal donde se leen
    // ES el de citas y la sesión que los autoriza es la suya.
    "migrate-avisos-cliente",
    // Tipos de cita OCULTOS de la agenda pública (`is_hidden`). Estaba escrita
    // pero sin registrar aquí, así que `ensure-tenant-schema` no la ejecutaba
    // nunca: el modelo pedía una columna que en un schema nuevo no existe, y
    // CUALQUIER consulta de tipos de cita reventaba. Es exactamente el agujero
    // del 2026-07-21 que este mapa existe para cerrar; lo destapó la batería de
    // pruebas al sincronizar (05/08/2026).
    "migrate-citas-tipos-ocultos",
    // Bonos de sesiones, precio fraccionado y formulario por tipo de cita
    // (04/08/2026). Un tipo de cita pasa a poder valer por N sesiones, con su
    // numeración («3 de 10») visible en el calendario.
    "migrate-packs-sesiones",
    // «Esta es la valoración inicial» (04/08/2026): la marca del tipo de cita
    // al que se entra SIN firmar contratos, porque es la primera visita.
    "migrate-valoracion-inicial",
    // Preguntas propias del tipo de cita (04/08/2026), en vez de enganchar un
    // formulario del módulo Formularios.
    "migrate-preguntas-cita",
  ],

  calendar: ["migrate-calendar-citas-fks"],

  pacientes: [
    // La tabla `patients` la crea migrate-clinica-module (que ya está escrita
    // para «clinica O pacientes»); sin ella aquí, activar `pacientes` suelto
    // corría las seis de abajo —todas ALTER sobre patients— sin tabla. Está
    // también en el bloque `clinica`, como migrate-patients-care-type: el
    // analizador de orden deduplica (19/08/2026).
    "migrate-clinica-module",
    "migrate-patients-clients-phase1",
    "migrate-client-module-assignments",
    "migrate-patients-multi-per-client",
    "migrate-patients-care-type",
    "migrate-patients-specialties",
    "migrate-documents-patient-link",
    "migrate-onedrive-archivo",
    // Varios terapeutas por paciente (25/08/2026, Lau de Aumenta). Solo crea la
    // tabla `patient_therapists`: `main_therapist_id` se queda y sigue siendo el
    // de referencia, así que no hay nada que rellenar para que funcione.
    "migrate-patients-terapeutas",
  ],

  clinica: [
    // Agenda de profesionales externos del paciente + enlace desde las actas
    // de coordinación (02/08/2026).
    "migrate-external-contacts",
    // Un contacto externo puede constar solo por su papel («Tutora») o solo por
    // su nombre («Blanca»): así vienen escritos en las actas (02/08/2026).
    "migrate-contactos-externos-nombre-opcional",
    // Talleres: actividades de grupo (02/08/2026). Necesita `patients`, que la
    // crea migrate-pacientes-sprint-1; el orden lo resuelve el analizador.
    "migrate-talleres",
    "migrate-clinica-module",
    // El autor del acta puede no estar en la plantilla (02/08/2026): campo de
    // texto libre y created_by_id opcional.
    "migrate-coordinaciones-autor-libre",
    // El terapeuta de una sesión deja de ser obligatorio (02/08/2026): en un
    // histórico importado hay sesiones firmadas por quien ya no está.
    "migrate-sesion-terapeuta-opcional",
    "migrate-clinica-client-link",
    "migrate-patients-care-type",
    "migrate-patients-specialties",
    "migrate-documents-patient-link",
    "migrate-onedrive-archivo",
    "migrate-incidencias-module",
    "migrate-incidencias-verificacion",
    "migrate-incentive-items",
    // Desempeño por roles: role_key + area_scores en performance_metrics.
    "migrate-clinica-performance-roles",
    // El informe para la beca NEAE (26/08/2026, Aumenta): añade 'beca' al enum
    // de tipos de informe. Sus apartados van en contentSections (JSONB).
    "migrate-informe-beca",
    // Apartados del registro de sesión (29/08/2026, Aumenta): content_sections
    // JSONB en clinic_sessions, el mismo cajón que ya tenían los informes. El
    // MODELO lo declara, así que sin esta migración el primer SELECT de
    // /pacientes/[id] revienta con 42703 en el schema que no la tenga.
    "migrate-clinica-apartados-sesion",
    // Notas internas del registro de sesión (29/08/2026, Aumenta): lo que el
    // equipo escribe para sí mismo y la familia no lee. El MODELO ClinicSession
    // declara la columna, así que sin esta migración el primer SELECT de
    // /pacientes/[id] revienta con 42703 en el schema que no la tenga.
    "migrate-clinica-notas-internas",
    // Enviar un registro de sesión al área privada de la familia (29/08/2026,
    // Aumenta): `delivered_document_id` y `delivered_at` en clinic_sessions. El
    // MODELO las declara, así que sin esta migración el primer SELECT de
    // /pacientes/[id] revienta con 42703 en el schema que no las tenga.
    "migrate-clinica-registro-enviado",
  ],

  // Control horario. Depende de `team_members`, que crea el módulo Equipo: la
  // arista está declarada en _migration-order.js porque la migración se salta
  // sola el schema que no tenga esa tabla, y saltarse algo en silencio es
  // justo lo que no se puede permitir aquí.
  fichaje: ["migrate-fichaje-module"],

  team: [
    "migrate-team-fields",
    "migrate-rename-therapist-to-employee",
    "migrate-team-modules-salary",
    "migrate-team-members-avatar-color",
    "migrate-team-specialties",
    "migrate-team-weekly-hours",
    "migrate-team-member-hours",
  ],

  billing: [
    // Proveedores como entidad (02/08/2026). Va en billing y no en inventory
    // porque crea el enlace desde `costs`; Inventario lo usará cuando se rehaga.
    "migrate-suppliers",
    // Arqueo de caja (02/08/2026): lo único de Contabilidad de Organízate que
    // nuestro módulo de Facturación no cubría.
    "migrate-arqueo",
    // Impuestos como tipo de gasto propio + varios arqueos por día
    // (02/08/2026, Rodrigo). Universal, no solo de Aumenta.
    "migrate-impuestos-y-arqueo",
    "migrate-billing-rework",
    "migrate-billing-fix-kind-enum",
    "migrate-billing-quotes",
    "migrate-billing-correction-reason",
    "migrate-billing-tax-regime",
    "migrate-billing-vat-exempt",
    "migrate-billing-irpf-partners",
    "migrate-rename-therapist-to-employee",
    // A quién se le emitió cada factura, congelado al emitir. Sin esta columna
    // el modelo pide `fiscal_snapshot` y toda lectura de factura da 42703.
    "migrate-invoice-fiscal-snapshot",
    // Qué tipo de cita se cobró con cada factura (29/08/2026): de aquí salen
    // los «Ingresos por servicio» de la portada. Sin esta columna el modelo
    // pide `event_type_id` y toda lectura de factura da 42703.
    "migrate-invoice-tipo-cita",
    // Borrar una ficha ya no borra sus facturas: la relación pasa de CASCADE a
    // RESTRICT (y de paso deja UNA sola, que había hasta cuatro duplicadas).
    "migrate-invoices-client-restrict",
  ],

  projects: [
    "migrate-projects-sprint-1",
    "migrate-projects-sprint-2",
    "migrate-projects-task-priority",
  ],

  training: [
    "migrate-training-fields",
    "migrate-training-archive",
    "migrate-course-registrations",
  ],

  inventory: [
    // Rework completo del 02/08/2026: Product/StockEntry sustituyen a
    // Inbound/Outbound/Formula. Va DESPUÉS de migrate-suppliers, que crea la
    // tabla a la que apunta stock_entries.supplier_id.
    //
    // ⚠️ Ya NO se declara `migrate-inventory-rework` (el de 2026-04, sin la «a»).
    // Creaba inbound_products / outbound_products / formulas, que son justo las
    // tablas que el rework nuevo elimina: dejarlo aquí hacía que un tenant
    // recién dado de alta se las volviera a encontrar. El fichero se conserva
    // como histórico de lo que se hizo entonces, pero no se ejecuta.
    "migrate-inventario-rework",
  ],

  /**
   * Tienda (25/08/2026). Su migración va sobre las tablas de Inventario y
   * Pedidos, así que se declara TAMBIÉN en `inventory` de arriba… y no: se
   * declara solo aquí, porque las columnas de escaparate no le hacen falta a
   * quien tiene almacén y no vende online. `migrate-tienda` es idempotente y
   * se salta los schemas sin `products`, así que activarla dos veces no rompe.
   */
  tienda: ["migrate-tienda"],

  documents: ["migrate-documents-sprint-1", "migrate-documents-client-link", "migrate-documents-transversal", "migrate-documents-patient-link", "migrate-documents-client-portal"],

  // Documentos AVANZADO (01/08/2026): mismas tablas que el básico —el archivo
  // ya existe, lo que cambia es quién puede verlo entero—, así que comparte
  // migraciones. Se declara para que un cliente que estrene el avanzado sin
  // haber tenido el básico no nazca sin `documents`.
  documents_avanzado: ["migrate-documents-sprint-1", "migrate-documents-client-link", "migrate-documents-transversal", "migrate-documents-patient-link", "migrate-documents-client-portal"],
  nutricion: [
    // ⚠️ VA LA PRIMERA Y NO ES COSMÉTICO (13/08/2026). Crea las CINCO tablas
    // cimiento del módulo (foods, plans, plan_meals, plan_meal_options,
    // plan_meal_option_foods), que hasta hoy no creaba ninguna migración: las
    // hacían dos scripts de un solo uso con `crm_nutri_laura` escrito dentro
    // (add-nutricion-module-nutri-laura.js y add-nutricion-c2-plans-nutri-laura.js),
    // ninguno declarado aquí. Sin ella, activar `nutricion` en un tenant
    // antiguo dejaba las seis de abajo saltándose solas por no encontrar
    // `foods` —lo dicen por pantalla— y al cliente con el módulo en el menú y
    // nada debajo. Las seis siguientes DEPENDEN de que esta haya corrido.
    "migrate-nutricion-base",
    "migrate-nutricion-recipes",
    "migrate-nutricion-week-recipe-media",
    "migrate-nutricion-day-comments",
    "migrate-nutricion-show-macros",
    // Tipo, etiquetas, alérgenos, preferencias, duración y raciones en las
    // recetas (04/08/2026): con mil recetas, sin filtros no hay recetario.
    "migrate-recetas-clasificacion",
    "migrate-plan-team",
    // Congela pasos y foto DENTRO de la pauta (13/08/2026): antes se leían en
    // vivo de la receta, así que reescribir unos pasos cambiaba pautas de hace
    // meses y corregir una cantidad no llegaba a nadie. Lleva backfill desde la
    // receta viva, para que el día del despliegue no se note nada.
    "migrate-nutricion-congelar-receta",
  ],

  outreach: [
    "migrate-outreach-sprint-1",
    "migrate-outreach-google-usage",
    "migrate-outreach-convert",
    "migrate-outreach-website-text",
  ],

  // Formularios públicos → bandeja en el CRM → ficha de cliente al aceptar.
  formularios: ["migrate-formularios-module", "migrate-formsubmission-team"],

  // Helpdesk del tenant hacia SUS clientes: tickets numerados, hilo con notas
  // internas, adjuntos, SLA y portal público de seguimiento.
  support: ["migrate-support-module"],
};

/**
 * Migraciones que corresponden a una lista de módulos, deduplicadas y ordenadas
 * por el orden canónico global. Siempre incluye CORE.
 */
export function migrationsFor(moduleKeys = []) {
  const set = new Set(CORE);
  for (const k of moduleKeys) for (const m of MODULES[k] || []) set.add(m);
  return ORDER.filter((m) => set.has(m));
}

/**
 * MÓDULO → SEMILLAS de DATOS que hay que sembrar al activarlo.
 *
 * Las migraciones dejan la ESTRUCTURA; esto deja el CONTENIDO mínimo sin el
 * cual el módulo, aun estando bien montado, no sirve de nada el primer día.
 * Hoy solo hay un caso, y es el que lo motiva: un recetario sin un solo
 * alimento no deja escribir ni un menú, porque toda receta y toda pauta se
 * construyen eligiendo alimentos del catálogo. Laura no lo sufrió porque su
 * catálogo se sembró a mano en el sprint C1.
 *
 * Cada entrada es `{ script, args }` y la lanza `enable-module.js` DESPUÉS de
 * las migraciones (necesita las tablas ya creadas). El `--tenant` acota la
 * siembra al cliente que estrena el módulo, sin tocar a los demás.
 *
 * ⚠️ Solo DATOS SEMILLA, idempotentes y neutros: catálogos de referencia que
 * cualquier cliente querría. Nada de datos de escaparate — eso son los seeds
 * de demo, que se lanzan a mano y a propósito.
 */
export const MODULE_SEEDS = {
  nutricion: [{ script: "seed-foods-base-catalog.js", args: ["--tenant"] }],
};

/**
 * Salud del mapa. Como ORDER se calcula de los ficheros que hay en disco, esto
 * detecta las dos formas de que el mapa se desincronice del repo:
 *   sinOrden   declaradas en MODULES/CORE pero cuyo fichero ya no existe.
 *   huerfanas  ficheros de migración que nadie ejecutaría nunca: sin módulo, sin
 *              CORE y sin marcar como ONE_OFF. Lo normal es que alguien haya
 *              añadido una migración y se le haya olvidado apuntarla aquí.
 */
export function mapInconsistencies() {
  const inOrder = new Set(ORDER);
  const declared = new Set([...CORE, ...Object.values(MODULES).flat()]);
  const oneOff = new Set(Object.keys(ONE_OFF));
  return {
    sinOrden: [...declared].filter((m) => !inOrder.has(m)),
    huerfanas: ORDER.filter((m) => !declared.has(m) && !oneOff.has(m)),
  };
}
