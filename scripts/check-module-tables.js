/**
 * check-module-tables.js — ¿tiene cada cliente las tablas y columnas de los
 * módulos que le hemos encendido?
 *
 * EL HUECO QUE TAPA
 * Ya teníamos tres redes, y ninguna miraba esto:
 *   · check-links.js          registros sueltos (sin cliente, sin equipo)
 *   · check-module-access.js  quién NO ve un módulo que su cliente sí tiene
 *   · check-migration-order.js coherencia del mapa de migraciones, en disco
 * Nadie comprobaba lo más básico: que un módulo encendido TENGA su sitio donde
 * guardar las cosas. Es el fallo del 2026-07-21 (se activa el módulo, el schema
 * se queda como estaba, y la primera lectura revienta con 42703) y es el que
 * más caro sale, porque el cliente entra en la pantalla y ve un error, no un
 * "esto todavía no está".
 *
 * Y comprueba DOS cosas, no una, porque las dos revientan igual:
 *   1. LA TABLA. Sin ella el módulo está muerto: 42P01 en cuanto se abre.
 *   2. LAS COLUMNAS. Sequelize hace SELECT de TODOS los atributos del modelo,
 *      así que un modelo con una columna que la migración no llegó a crear es
 *      un 500 garantizado en la primera lectura, con la tabla ahí y todo. Esta
 *      mitad no necesita mantenimiento: las columnas salen del propio modelo.
 *
 * SOLO LECTURA. No toca nada. Sale con código 1 si hay algo roto de verdad,
 * para poder colgarlo de un despliegue; los avisos (!) no cambian el código.
 *
 * USO
 *   npm run db:check-tables
 *   node --env-file=.env.local scripts/check-module-tables.js
 *   node --env-file=.env.local scripts/check-module-tables.js nutri_laura
 *   docker exec crm-salamandra-app-1 node scripts/check-module-tables.js
 *
 * SI SALE ROJO, casi siempre se arregla con el disparador de migraciones:
 *   docker exec crm-salamandra-app-1 node scripts/ensure-tenant-schema.js <slug>
 *
 * ── DE DÓNDE SALE QUÉ TABLAS NECESITA CADA MÓDULO ──────────────────────────
 * De la lista de aquí abajo, escrita a mano. Se miró antes si podía deducirse
 * y no sale bien por ninguno de los dos caminos:
 *
 *   · Por los MODELOS (models/tenant/): lib/db/tenantDb.js registra los modelos
 *     para TODOS los tenants, sin mirar módulos. No hay ahí ninguna pista de a
 *     qué módulo pertenece cada tabla.
 *   · Por las MIGRACIONES (_module-migrations.js + _migration-order.js): eso sí
 *     dice qué tablas CREA cada módulo, y se usa más abajo para vigilar que
 *     esta lista no se quede vieja. Pero no sirve como fuente única: media
 *     docena de tablas no las crea ninguna migración (vienen de `sequelize.sync()`
 *     — `leads`, `invoices`, `clients`…) y varias migraciones crean tablas SOLO
 *     si el schema ya tiene otra, así que darlas por obligatorias llenaría el
 *     informe de falsos positivos. Un informe con ruido no se lee.
 *
 * CÓMO SE MANTIENE: no de memoria. Al final el script se audita a sí mismo y
 * avisa (a) si hay un modelo cuya tabla no está en ninguna lista y (b) si las
 * migraciones de un módulo crean una tabla que aquí no aparece. Quien añada un
 * modelo o una migración se entera al primer `npm run db:check-tables`.
 *
 * DOS NIVELES, a propósito:
 *   `nucleo`  la pantalla principal del módulo no abre sin ella  → ✗ (código 1)
 *   `extras`  pantallas secundarias y sprints posteriores        → ! (aviso)
 * La distinción no es cosmética, y la regla para decidir es UNA: si el código
 * atrapa el 42P01 y sigue, va en `extras`. Pasa de verdad en sitios muy vivos:
 * `healim` lleva meses con `citas` y sin `session_packs` (lib/citas/packs.js y
 * lib/citas/tiposVisibles.js lo dan por bueno a propósito) y `nutri_laura` no
 * tiene `interactions` (app/api/clients/[id]/route.js degrada la ficha en vez
 * de romperla). Marcar eso en rojo cada día enseñaría a ignorar el informe
 * entero, que es la forma más rápida de perder una red.
 *
 * LO QUE NO SE MIRA: tablas que EXISTEN teniendo el módulo apagado. Se descartó
 * porque no es un problema, es el estado normal: `lib/provisioning/altaTenant.js`
 * hace `sequelize.sync()` al dar de alta, así que TODO cliente nuevo nace con
 * todas las tablas tenga los módulos que tenga. Avisar de eso serían decenas de
 * líneas por cliente que nadie puede ni debe arreglar (borrar una tabla vacía no
 * gana nada y se lleva por delante el histórico si alguien contrata el módulo).
 */

import { Sequelize } from "sequelize";
import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";
import { MODULES } from "./_module-migrations.js";
import { extractDeps } from "./_migration-order.js";

/**
 * Tablas que tiene que haber SIEMPRE, tenga el cliente los módulos que tenga:
 * sus modelos están registrados para todos los tenants y las crea CORE. Si
 * falta una, no es "una pantalla que no va", es que algo se saltó las
 * migraciones transversales.
 */
const TRANSVERSALES = ["notifications", "ai_permissions", "payment_sessions", "stripe_webhook_events"];

const MODULOS = {
  // ── Base ──────────────────────────────────────────────────────────────────
  clients: {
    nucleo: ["clients", "client_notes", "client_attachments"],
    // `interactions` está aquí y NO en núcleo aunque suene a lo contrario: el
    // GET de la ficha (app/api/clients/[id]/route.js) atrapa el 42P01 a mano y
    // devuelve `interactions: []` — el comentario de ese fichero nombra el caso
    // real, «sucede p. ej. en crm_nutri_laura, donde el módulo legacy nunca se
    // sembró». Ponerlo en rojo pintaría de averiado a un cliente que lleva
    // meses trabajando sin enterarse. El contrato del centro es de sprints
    // posteriores y tampoco lo usa todo el mundo (spain_enzymes no lo tiene).
    extras: [
      "interactions",
      "client_contact_methods",
      "client_module_assignments",
      "contract_signatures",
      "contract_templates",
    ],
  },
  clients_avanzado: {
    // Las dos pantallas del módulo: la cola de admisión y «Fichas a completar».
    // Núcleo porque aquí NO hay degradado: solo la insignia de la ficha atrapa
    // el 42P01 (lib/clients/listaEspera.js), el listado no. `data_reviews` es
    // lo que archiva un hueco correcto; sin ella la lista no llega a cero
    // nunca (03/08/2026).
    nucleo: ["waitlist_entries", "data_reviews"],
    extras: [],
  },
  leads: { nucleo: ["leads"], extras: [] },
  // `sales` es el moduleKey heredado del área comercial (ver CLAUDE.md): misma
  // tabla, otra ruta. Se declara para que un tenant que lo tenga no salga como
  // "módulo sin tablas declaradas".
  sales: { nucleo: ["leads"], extras: [] },
  formularios: { nucleo: ["forms", "form_submissions"], extras: [] },
  team: { nucleo: ["team_members"], extras: ["team_member_modules", "team_member_hours"] },
  // Equipo avanzado no tiene tablas SUYAS: vive sobre las de team y clinica, y
  // sus submenús exigen `requiresAll` (avanzado + el módulo que aporta el
  // contenido), así que sin ese otro módulo la pantalla ni se ofrece.
  team_avanzado: { nucleo: [], extras: [] },
  documents: { nucleo: ["documents", "document_folders"], extras: [] },
  documents_avanzado: { nucleo: ["documents", "document_folders"], extras: [] },

  // ── Agenda y trabajo ──────────────────────────────────────────────────────
  citas: {
    nucleo: ["event_types", "availabilities", "bookings"],
    extras: [
      "booking_change_requests",
      "session_packs",
      "blocked_days",
      "team_blocks",
      "client_notices",
      "team_member_hours",
    ],
  },
  calendar: { nucleo: ["calendar_tasks"], extras: [] },
  projects: {
    nucleo: ["projects", "tasks", "board_columns"],
    extras: ["phases", "milestones", "project_members", "project_templates", "task_assignees"],
  },
  support: {
    // `contacts` está aquí y no en `clients` porque el modelo Contact solo lo
    // usan los tickets (app/api/tickets/*, lib/support/context.js), y ahí se
    // incluye en todas las consultas. Ojo: `OutreachContact` y `ExternalContact`
    // son otras tablas, de otros módulos.
    nucleo: ["tickets", "ticket_messages", "contacts"],
    extras: ["ticket_attachments", "ticket_categories", "ticket_templates", "support_settings"],
  },

  // ── Dinero ────────────────────────────────────────────────────────────────
  billing: {
    // `invoice_series` va en núcleo por el incidente que documenta
    // lib/provisioning/altaTenant.js: sin sus filas semilla se pueden crear
    // borradores, pero «Emitir» se lleva un 500 y la pantalla de series es de
    // solo lectura — no hay forma de desbloquearse desde la UI.
    // `quotes` no: el Panel operativo ya cuenta 0 presupuestos si falta
    // (app/api/billing/operations/route.js).
    nucleo: ["invoices", "payments", "costs", "rates", "invoice_series"],
    extras: ["recurring_invoices", "quotes", "tenant_billing_settings", "suppliers", "cash_points", "cash_closes"],
  },
  orders: { nucleo: ["orders", "order_lines"], extras: ["order_settings"] },
  inventory: {
    // Las tres del rework del 02/08/2026. `assets` (equipos internos) es
    // legacy: hoy no lo consulta ningún endpoint, por eso no es núcleo.
    nucleo: ["products", "stock_entries", "stock_movements"],
    extras: ["suppliers", "assets"],
  },

  // ── Salud ─────────────────────────────────────────────────────────────────
  pacientes: { nucleo: ["patients"], extras: ["intervention_plans", "client_module_assignments"] },
  clinica: {
    nucleo: ["clinic_sessions", "clinical_reports", "coordinations"],
    extras: [
      "external_contacts",
      "talleres",
      "taller_inscripciones",
      "performance_metrics",
      "incentive_items",
      "incidencias",
      "incidencia_assignees",
    ],
  },
  nutricion: {
    nucleo: ["foods", "plans", "plan_meals", "plan_meal_options", "plan_meal_option_foods"],
    extras: ["recipes", "recipe_foods", "plan_meal_option_recipes", "plan_meal_option_recipe_foods"],
  },

  // ── Captación, web y formación ────────────────────────────────────────────
  outreach: {
    nucleo: ["outreach_leads", "outreach_contacts", "outreach_analyses"],
    extras: ["outreach_business_lines", "outreach_settings"],
  },
  training: {
    nucleo: ["courses", "training_users", "course_enrollments"],
    extras: ["companies", "company_courses", "course_registrations", "trainings", "training_sync_log"],
  },
  cuestionarios: { nucleo: ["quiz_attempts"], extras: [] },
  analytics: { nucleo: ["web_visits_daily"], extras: [] },

  // ── Sin tablas de tenant ──────────────────────────────────────────────────
  // `provisioning` es el panel interno de salamandra_solutions: solo escribe en
  // master, por eso su tenant ni siquiera necesita schema propio. El resto son
  // placeholders del Sidebar que hoy no activa nadie; se declaran para que, si
  // alguien los enciende, el informe diga "sin tablas declaradas" en vez de
  // callarse.
  provisioning: { nucleo: [], extras: [] },
  communications: { nucleo: [], extras: ["messages"] },
  planning: { nucleo: [], extras: [] },
  ai: { nucleo: [], extras: [] },
  automations: { nucleo: [], extras: [] },
  integrations: { nucleo: [], extras: [] },
  client_portal: { nucleo: [], extras: [] },
};

const w = (s) => process.stdout.write(s);
const log = (s) => w(`  ${s}\n`);
const header = (s) => w(`\n▶ ${s}\n`);

/**
 * tabla → { modelo, columnas } leyendo los modelos de Sequelize.
 *
 * Basta con UN tenant: initTenantDb define los mismos modelos para todos, sin
 * mirar qué ha contratado nadie. Y no se lanza ninguna consulta por esta
 * conexión — solo se le preguntan sus metadatos.
 */
function columnasQuePideCadaModelo(slug) {
  const { models } = getTenantDb(slug);
  const mapa = new Map();
  for (const [modelo, M] of Object.entries(models)) {
    const t = M.getTableName();
    const tabla = typeof t === "string" ? t : t?.tableName;
    if (!tabla) continue;
    const columnas = Object.values(M.getAttributes())
      .filter((a) => a.type?.key !== "VIRTUAL")
      .map((a) => a.field)
      .filter(Boolean);
    mapa.set(tabla, { modelo, columnas });
  }
  return mapa;
}

/** Añade `tabla → módulo que la pide` a un Map, sin perder quién más la pedía. */
function apunta(mapa, tabla, moduleKey) {
  if (!mapa.has(tabla)) mapa.set(tabla, new Set());
  mapa.get(tabla).add(moduleKey);
}

const quien = (mods) => [...mods].sort().join(", ");

async function main() {
  const soloTenant = process.argv[2] || null;

  w("\n══════════════════════════════════════════════════════\n");
  w(" ¿Tiene cada cliente las tablas de los módulos que usa?\n");
  w("══════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n\n");
    process.exit(1);
  }

  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  // Regla 12: la lista de clientes y sus módulos se lee SIEMPRE de master en
  // tiempo de ejecución. Local y producción no tienen los mismos tenants ni los
  // mismos módulos, y un script con slugs escritos a mano miente en cuanto se
  // vende algo.
  const [tenants] = await s.query(
    `SELECT t.slug, t.status,
            coalesce(array_agg(tm.module_key ORDER BY tm.module_key)
                     FILTER (WHERE tm.enabled), '{}') AS modulos
       FROM master.tenants t
       LEFT JOIN master.tenant_modules tm ON tm.tenant_id = t.id
      GROUP BY t.slug, t.status
      ORDER BY t.slug`
  );

  const aRevisar = soloTenant ? tenants.filter((t) => t.slug === soloTenant) : tenants;
  if (!aRevisar.length) {
    process.stderr.write(`\n✗ No hay ningún cliente que encaje con "${soloTenant}"\n\n`);
    await s.close();
    process.exit(1);
  }

  const slugParaModelos = tenants.map((t) => t.slug).find((x) => /^[a-z0-9_]+$/.test(x));
  const modelos = columnasQuePideCadaModelo(slugParaModelos);

  let fallos = 0;
  let avisos = 0;
  const clientesTocados = new Set();

  for (const t of aRevisar) {
    const schema = `crm_${t.slug}`;

    // ⚠️ El alias `AS tabla` no es un capricho. El driver de postgres de
    // Sequelize 6 mira si el SQL EMPIEZA por
    // `SELECT table_name FROM information_schema.tables` (es su atajo interno
    // para showAllTables, ver `isTableNameQuery` en
    // node_modules/sequelize/lib/dialects/postgres/query.js) y, cuando encaja,
    // devuelve cada fila como un valor suelto en vez de un objeto y sin
    // metadatos. Escrito sin alias, este script leía `undefined` en cada fila y
    // daba TODAS las tablas por ausentes en TODOS los clientes — un informe
    // rojo entero y falso. Cualquier alias rompe la coincidencia.
    const [filasTablas] = await s.query(
      `SELECT table_name AS tabla FROM information_schema.tables
        WHERE table_schema = :schema AND table_type = 'BASE TABLE'`,
      { replacements: { schema } }
    );
    const hay = new Set(filasTablas.map((r) => r.tabla));

    // Una sola consulta por schema para TODAS las columnas: son ~1.500 filas y
    // sale más barato que preguntar tabla a tabla.
    const [filasColumnas] = await s.query(
      `SELECT table_name AS tabla, column_name AS columna
         FROM information_schema.columns WHERE table_schema = :schema`,
      { replacements: { schema } }
    );
    const columnasReales = new Map();
    for (const r of filasColumnas) {
      if (!columnasReales.has(r.tabla)) columnasReales.set(r.tabla, new Set());
      columnasReales.get(r.tabla).add(r.columna);
    }

    const nucleo = new Map();
    const extras = new Map();
    const sinDeclarar = [];
    for (const x of TRANSVERSALES) apunta(nucleo, x, "todos");
    for (const k of t.modulos) {
      const m = MODULOS[k];
      if (!m) {
        sinDeclarar.push(k);
        continue;
      }
      for (const x of m.nucleo) apunta(nucleo, x, k);
      for (const x of m.extras) apunta(extras, x, k);
    }
    // Si una tabla es núcleo para un módulo y extra para otro, manda el núcleo.
    for (const x of nucleo.keys()) extras.delete(x);

    const lineas = [];
    const rojo = (m) => {
      lineas.push(`✗ ${m}`);
      fallos++;
      clientesTocados.add(t.slug);
    };
    const naranja = (m) => {
      lineas.push(`! ${m}`);
      avisos++;
    };

    if (!hay.size) {
      // Ojo: no siempre es un error. salamandra_solutions solo tiene
      // `provisioning`, que escribe en master, y no necesita schema.
      if (nucleo.size > TRANSVERSALES.length) {
        rojo(`el schema ${schema} no existe (o está vacío) y hay módulos que necesitan tablas`);
      } else {
        lineas.push(`· sin schema propio: ninguno de sus módulos guarda nada en su schema`);
      }
      for (const k of sinDeclarar) naranja(`módulo "${k}" encendido y sin tablas declaradas en este script: no se ha comprobado`);
    } else {
      for (const tabla of [...nucleo.keys()].sort()) {
        if (!hay.has(tabla)) rojo(`falta la tabla ${tabla}  (${quien(nucleo.get(tabla))})`);
      }
      for (const tabla of [...extras.keys()].sort()) {
        if (!hay.has(tabla)) naranja(`falta la tabla ${tabla}  (${quien(extras.get(tabla))}, pantalla secundaria)`);
      }
      // Las columnas solo se miran en las tablas de los módulos que el cliente
      // TIENE. Mirarlas todas sacaría, por ejemplo, las columnas que le faltan
      // a `tickets` en clientes que jamás han comprado Soporte: cierto, inútil
      // y ruidoso.
      for (const tabla of [...nucleo.keys(), ...extras.keys()].sort()) {
        if (!hay.has(tabla)) continue;
        const modelo = modelos.get(tabla);
        if (!modelo) continue;
        const presentes = columnasReales.get(tabla) ?? new Set();
        const faltan = modelo.columnas.filter((c) => !presentes.has(c));
        if (faltan.length) rojo(`${tabla}: el modelo ${modelo.modelo} lee columnas que no existen → ${faltan.join(", ")}`);
      }
      for (const k of sinDeclarar) naranja(`módulo "${k}" encendido y sin tablas declaradas en este script: no se ha comprobado`);
    }

    header(`${t.slug}${t.status !== "active" ? ` (${t.status})` : ""} · ${t.modulos.length} módulo(s)`);
    if (!lineas.length) log("✓ todas las tablas y columnas de sus módulos");
    else for (const l of lineas) log(l);
  }

  // ── Salud del propio mapa ───────────────────────────────────────────────────
  // No cambia el código de salida a propósito: el 1 habla de la base de datos de
  // los clientes, que es lo que rompe hoy. Esto de aquí es deuda del script.
  const declaradas = new Set([
    ...TRANSVERSALES,
    ...Object.values(MODULOS).flatMap((m) => [...m.nucleo, ...m.extras]),
  ]);

  header("Salud del mapa de este script");
  const huerfanos = [...modelos.keys()].filter((x) => !declaradas.has(x)).sort();
  if (huerfanos.length) {
    log(`! modelos cuya tabla no está en ninguna lista: ${huerfanos.join(", ")}`);
    log("  Añádelos al módulo que corresponda o nadie comprobará nunca esas tablas.");
  } else {
    log(`✓ los ${modelos.size} modelos de models/tenant/ tienen su módulo`);
  }

  const deps = extractDeps();
  const nuevas = [];
  for (const [k, migraciones] of Object.entries(MODULES)) {
    const crea = new Set(
      migraciones.flatMap((m) => (deps[m]?.provides ?? []).filter((p) => !p.startsWith("idx:")))
    );
    const sueltas = [...crea].filter((x) => !declaradas.has(x)).sort();
    if (sueltas.length) nuevas.push(`${k} → ${sueltas.join(", ")}`);
  }
  if (nuevas.length) {
    log(`! las migraciones de un módulo crean tablas que aquí no aparecen: ${nuevas.join(" | ")}`);
    log("  Decide si son núcleo o extras y apúntalas arriba.");
  } else {
    log("✓ el mapa cubre todas las tablas que crean las migraciones de cada módulo");
  }

  // ── Resumen ─────────────────────────────────────────────────────────────────
  header("Resumen");
  if (!fallos && !avisos) {
    log("✓ Todos los clientes tienen lo que sus módulos necesitan.");
  } else {
    if (fallos) {
      log(`✗ ${fallos} fallo(s) en ${clientesTocados.size} cliente(s): eso es una pantalla que hoy da error.`);
      log("  Arreglo:  docker exec crm-salamandra-app-1 node scripts/ensure-tenant-schema.js <slug>");
    }
    if (avisos) log(`! ${avisos} aviso(s) de pantallas secundarias: mirar, pero no urge.`);
  }
  w("\n");

  await s.close();
  await closeAllConnections();
  // process.exit explícito: importar lib/db/tenantDb.js deja vivo su temporizador
  // de purga de conexiones (setInterval sin unref), y sin esto el script se
  // quedaría colgado al acabar (mismo motivo que en comprobar-citas.js).
  process.exit(fallos ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
