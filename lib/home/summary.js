import { Op, fn, col, literal } from "sequelize";
import { getKpisForPeriod } from "../billing/billingSummary.js";
import { veTodaLaAgenda, soloLoSuyo, NADIE_DEL_EQUIPO } from "../citas/visibilidad.js";
import { vocabularioCliente } from "../clients/vocabulario.js";
import { cuentasDe } from "../clients/urgentes.js";
import { aggregateTeamProductivity } from "../clinica/productivityQuery.js";
import { statusLabel, priorityLabel } from "../clinica/incidencias.js";
import { whereIncidenciasDe } from "../clinica/incidenciasDe.js";
import { veTodoElEquipo } from "../clinica/coordinadoras.js";
import { cuentaPendientes } from "../documents/lecturas.js";

/**
 * Agregador de la portada (rediseño «Hoy y el negocio», 26/08/2026, Rodrigo).
 *
 * `buildPortada(ctx)` compone en el servidor (RSC) todo lo que pinta la home:
 *
 *   - `finance`   → las tres cifras de dinero (reutiliza el cálculo de siempre).
 *   - `agenda`    → «Mi agenda» de HOY: lo mío y, si se puede, todo el centro.
 *   - `pendiente` → lo que espera algo de alguien, como botones con destino.
 *   - `vistas`    → las series de la gráfica rotatoria (una por módulo activo).
 *   - `trabajo`   → SOLO para quien no está adherido a facturación: la mitad
 *                   derecha operativa (bandeja, semana, documentos por leer y
 *                   tareas) en vez de gráficas. Ver «SIN FACTURACIÓN NO HAY
 *                   GRÁFICAS» abajo.
 *
 * Principios, heredados del agregador anterior y con la misma prueba encima:
 *
 *  - GATING: `ctx.hasModule(key)` cruza módulo del tenant ∩ `user.moduleAccess`.
 *    Las magnitudes sensibles de finanzas (cobrado, márgenes) se gatean además
 *    por rol admin.
 *  - LA AGENDA NO ES DE TODO EL NEGOCIO. Misma regla que el listado y el
 *    calendario (`lib/citas/visibilidad.js`): admin lo ve todo, un tenant con
 *    agenda compartida también, y el resto solo lo suyo. Aplica a la lista de
 *    citas Y a las series/contadores que salen de `bookings` — un contador por
 *    día también cuenta la agenda de otra persona. La pestaña «Centro» solo
 *    existe para quien puede ver toda la agenda, y la vista por profesional
 *    también. Cuando no se puede resolver quién mira, se falla CERRADO
 *    (centinela `NADIE_DEL_EQUIPO`): un fallo técnico no destapa a un paciente.
 *    Lo fija `scripts/_smoke-portada-agenda.mjs` con modelos de mentira.
 *  - TOLERANCIA A SCHEMA PARCIAL: cada pieza corre dentro de `safeBlock` y
 *    degrada a null/[] si su tabla no existe o su query falla. La portada NUNCA
 *    da 500 por un widget.
 *  - EL SERVIDOR VA EN UTC: los días y los meses de las series se calculan en
 *    hora de Madrid (`AT TIME ZONE 'Europe/Madrid'`), no con el día del
 *    servidor — si no, una cita de las 00:30 contaría en el día anterior
 *    (docs/decisions: fechas sin zona se guardan desplazadas).
 */

function isMissingRelation(err) {
  const code = err?.parent?.code || err?.original?.code;
  return code === "42P01" || /relation .* does not exist/i.test(err?.message || "");
}

// Ejecuta un builder tolerando fallos: si la tabla no existe (schema parcial) o
// la query revienta, devuelve null y la portada simplemente no pinta esa pieza.
async function safeBlock(builder) {
  try {
    return await builder();
  } catch (err) {
    if (isMissingRelation(err)) return null;
    console.error("[home] bloque falló:", err?.message || err);
    return null;
  }
}

/**
 * La ficha de equipo de quien mira, o el centinela si no tiene ninguna.
 *
 * Devuelve el centinela y NO null a propósito: quien llama lo usa para filtrar, y
 * un null se leería como «no filtres». Si esto falla, la agenda sale vacía.
 */
const NADIE = NADIE_DEL_EQUIPO;
async function miFichaDeEquipo(models, userId) {
  try {
    const { TeamMember } = models;
    if (!TeamMember || !userId) return NADIE;
    const tm = await TeamMember.findOne({ where: { userId }, attributes: ["id"] });
    return tm ? tm.id : NADIE;
  } catch {
    return NADIE;
  }
}

function isAdmin(user) {
  return !!user && (user.role === "admin" || user.role === "superadmin");
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

// Fecha civil de Madrid en YYYY-MM-DD ('en-CA' la da en ese orden). Todos los
// «hoy», semanas y meses de este fichero salen de aquí, no del reloj UTC del
// servidor.
function fechaMadrid(d = new Date()) {
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" });
}

// Aritmética de días sobre la fecha civil (en UTC para que no haya sorpresas
// de horario de verano a medias).
function sumaDias(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// El lunes de la semana en curso (Madrid).
function lunesDeEstaSemana() {
  const d = new Date(fechaMadrid() + "T00:00:00Z");
  const desdeLunes = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - desdeLunes);
  return d.toISOString().slice(0, 10);
}

// Los últimos 6 meses con su clave YYYY-MM y sus etiquetas en castellano.
function mesesUltimos(n = 6) {
  const out = [];
  const hoy = new Date(fechaMadrid() + "T00:00:00Z");
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - i, 1));
    out.push({
      clave: d.toISOString().slice(0, 7),
      etiqueta: d.toLocaleDateString("es-ES", { month: "short", timeZone: "UTC" }).replace(".", ""),
      larga: d.toLocaleDateString("es-ES", { month: "long", timeZone: "UTC" }),
    });
  }
  return out;
}

// Rango del mes en curso para las finanzas: [día 1, hoy] en fecha de Madrid.
function monthRange() {
  const today = fechaMadrid();
  return { from: today.slice(0, 7) + "-01", to: today, today };
}

// ─── Finanzas (billing): las tres cifras de la portada ──────────────────────
// Dos magnitudes operativas visibles para cualquier usuario con billing:
//   - Facturado del mes (base imponible).
//   - Vencido (cartera vencida efectiva) — mismo cálculo que /api/billing/operations.
// NO se muestra un "pendiente del mes": junto al "vencido" (que es cartera
// histórica, no acotada al mes) se leería como contradictorio y, además,
// exponer facturado + pendiente permitiría deducir el "cobrado" por resta,
// que es una magnitud sensible reservada a admin. La rentabilidad (cobrado,
// márgenes) se gatea a admin y usa las cifras canónicas de getKpisForPeriod.
//
// Los no-admin corren solo 2 queries (facturado del mes + vencido); las
// agregaciones de coste/márgenes de getKpisForPeriod solo se ejecutan para admin.
const ACTIVE_INVOICE_STATUSES = { [Op.notIn]: ["draft", "cancelled", "rectified"] };

async function buildFinance(models, { from, to, today, admin }) {
  const { Invoice } = models;

  // Vencido efectivo (cartera actual): emitidas/enviadas/parciales, vencidas y
  // no cobradas del todo. Importe = deuda pendiente (total − pagado), con IVA.
  const overdueRows = await Invoice.findAll({
    where: {
      status: { [Op.in]: ["issued", "sent", "partially_paid"] },
      dueDate: { [Op.lt]: today },
      paidAmount: { [Op.lt]: col("total") },
    },
    attributes: [
      [fn("COUNT", col("id")), "n"],
      [literal("COALESCE(SUM(total - paid_amount), 0)"), "sum"],
    ],
    raw: true,
  });
  const overdue = {
    count: Number(overdueRows[0]?.n || 0),
    amount: round2(Number(overdueRows[0]?.sum || 0)),
  };

  if (!admin) {
    // Operativo ligero: facturado del mes (base imponible) + nº facturas.
    const rows = await Invoice.findAll({
      where: { issueDate: { [Op.between]: [from, to] }, status: ACTIVE_INVOICE_STATUSES },
      attributes: [
        [fn("SUM", col("tax_base")), "billed"],
        [fn("COUNT", col("id")), "n"],
      ],
      raw: true,
    });
    return {
      month: { billed: round2(Number(rows[0]?.billed || 0)), invoices: Number(rows[0]?.n || 0) },
      overdue,
    };
  }

  // Admin: cifras canónicas completas (cobrado proporcional en base + márgenes)
  // reutilizando getKpisForPeriod — idénticas al Resumen de Facturación.
  const kpis = await getKpisForPeriod({ tenantModels: models, from, to });
  return {
    month: { billed: kpis.income.billedBase, invoices: kpis.income.invoiceCount },
    overdue,
    collected: kpis.income.collectedBase,
    collectedPct: kpis.income.collectedPct,
  };
}

// ─── Mi agenda de HOY ───────────────────────────────────────────────────────
// «Mías» siempre con el filtro de lo suyo (también para el admin: la pestaña
// significa "mis citas"); «Centro» solo existe para quien ve toda la agenda.
// En un tenant sin equipo no hay profesionales que separar: una sola lista.
async function buildAgendaHoy(models, { conEquipo, veTodo, miFiltro }) {
  const { Booking, EventType, TeamMember } = models;
  const hoy = fechaMadrid();
  const manana = sumaDias(hoy, 1);
  const enHoy = [
    literal(`(scheduled_at AT TIME ZONE 'Europe/Madrid') >= '${hoy}'`),
    literal(`(scheduled_at AT TIME ZONE 'Europe/Madrid') < '${manana}'`),
  ];
  const base = { [Op.and]: enHoy, status: { [Op.notIn]: ["cancelled", "no_show"] } };

  const lista = async (where, conProfesional) => {
    const filas = await Booking.findAll({
      where,
      attributes: ["id", "clientName", "scheduledAt", "status", "teamMemberId"],
      include: [
        { model: EventType, as: "eventType", attributes: ["name"], required: false },
        ...(conProfesional
          ? [{ model: TeamMember, as: "teamMember", attributes: ["displayName"], required: false }]
          : []),
      ],
      order: [["scheduledAt", "ASC"]],
      limit: 40,
    });
    return filas.map((b) => ({
      id: b.id,
      clientName: b.clientName,
      scheduledAt: b.scheduledAt,
      status: b.status,
      tipo: b.eventType?.name || null,
      profesional: conProfesional ? b.teamMember?.displayName || null : null,
    }));
  };

  const agenda = { conEquipo, veTodo, mias: null, centro: null };
  if (conEquipo) {
    const mias = { ...base, teamMemberId: miFiltro };
    const [n, citas] = await Promise.all([Booking.count({ where: mias }), lista(mias, false)]);
    agenda.mias = { count: n, citas };
    if (veTodo) {
      const [nc, cc] = await Promise.all([Booking.count({ where: base }), lista(base, true)]);
      agenda.centro = { count: nc, citas: cc };
    }
  } else {
    const [nc, cc] = await Promise.all([Booking.count({ where: base }), lista(base, false)]);
    agenda.centro = { count: nc, citas: cc };
  }
  return agenda;
}

// ─── Las vistas de la gráfica rotatoria ─────────────────────────────────────
// Cada vista: { key, titulo, unidad, datos: [{etiqueta, tooltip, valor, resalte}] }.
// `unidad` es "eur", "pct" o el par [singular, plural] para el globito. Una
// vista sin un solo dato distinto de cero no se enseña (una gráfica a cero no
// informa)… salvo que traiga `vacio` (29/08/2026, Rodrigo: «que no desaparezcan
// las gráficas ni se escondan, sino que salgan vacías»): esa se enseña SIEMPRE,
// y cuando no tiene datos la tarjeta pinta ese texto, que dice por qué está
// vacía y qué falta por rellenar.
function vista(key, titulo, unidad, datos, { vacio = null } = {}) {
  const lista = Array.isArray(datos) ? datos : [];
  if (!vacio) {
    if (!lista.length || !lista.some((d) => d.valor > 0)) return null;
    return { key, titulo, unidad, datos: lista };
  }
  return { key, titulo, unidad, datos: lista, vacio };
}

// Serie de 6 meses sobre una columna de fecha, contando filas o sumando.
async function seriePorMes(Model, columnaSql, { where = {}, suma = null } = {}) {
  const meses = mesesUltimos(6);
  const desde = meses[0].clave + "-01";
  const mes = `to_char(${columnaSql}, 'YYYY-MM')`;
  const filas = await Model.findAll({
    attributes: [
      [literal(mes), "mes"],
      [suma ? fn("SUM", col(suma)) : fn("COUNT", col("id")), "v"],
    ],
    where: { [Op.and]: [literal(`${columnaSql} >= '${desde}'`)], ...where },
    group: [literal(mes)],
    raw: true,
  });
  const porMes = new Map(filas.map((f) => [f.mes, Number(f.v || 0)]));
  return meses.map((m, i) => ({
    etiqueta: m.etiqueta,
    tooltip: m.larga,
    valor: round2(porMes.get(m.clave) || 0),
    resalte: i === meses.length - 1,
  }));
}

async function vistaFacturacion(models) {
  const datos = await seriePorMes(models.Invoice, "issue_date", {
    where: { status: ACTIVE_INVOICE_STATUSES },
    suma: "tax_base",
  });
  return vista("facturacion", "Facturación · últimos 6 meses", "eur", datos);
}

const DIAS_SEMANA = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

async function vistaCitasSemana(models, { filtro }) {
  const { Booking } = models;
  const lunes = lunesDeEstaSemana();
  const fin = sumaDias(lunes, 7);
  const hoy = fechaMadrid();
  const dia = `to_char(scheduled_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD')`;
  const filas = await Booking.findAll({
    attributes: [
      [literal(dia), "dia"],
      [fn("COUNT", col("id")), "n"],
    ],
    where: {
      [Op.and]: [
        literal(`(scheduled_at AT TIME ZONE 'Europe/Madrid') >= '${lunes}'`),
        literal(`(scheduled_at AT TIME ZONE 'Europe/Madrid') < '${fin}'`),
      ],
      status: { [Op.notIn]: ["cancelled", "no_show"] },
      ...(filtro ? { teamMemberId: filtro } : {}),
    },
    group: [literal(dia)],
    raw: true,
  });
  const porDia = new Map(filas.map((f) => [f.dia, Number(f.n || 0)]));
  const datos = [];
  for (let i = 0; i < 7; i++) {
    const f = sumaDias(lunes, i);
    const esHoy = f === hoy;
    datos.push({
      etiqueta: esHoy ? "hoy" : DIAS_SEMANA[i].slice(0, 3),
      tooltip: esHoy ? "hoy" : DIAS_SEMANA[i],
      valor: porDia.get(f) || 0,
      resalte: esHoy,
    });
  }
  return vista("citas-semana", "Citas · esta semana", ["cita", "citas"], datos);
}

// Solo para quien ve toda la agenda: enseña la carga de trabajo del equipo.
async function vistaPorProfesional(models) {
  const { Booking, TeamMember } = models;
  const lunes = lunesDeEstaSemana();
  const fin = sumaDias(lunes, 7);
  const filas = await Booking.findAll({
    attributes: ["teamMemberId", [fn("COUNT", col("id")), "n"]],
    where: {
      [Op.and]: [
        literal(`(scheduled_at AT TIME ZONE 'Europe/Madrid') >= '${lunes}'`),
        literal(`(scheduled_at AT TIME ZONE 'Europe/Madrid') < '${fin}'`),
      ],
      status: { [Op.notIn]: ["cancelled", "no_show"] },
    },
    group: ["teamMemberId"],
    raw: true,
  });
  const ids = filas.map((f) => f.teamMemberId).filter(Boolean);
  const nombres = new Map();
  if (ids.length) {
    const gente = await TeamMember.findAll({ where: { id: ids }, attributes: ["id", "displayName"], raw: true });
    for (const g of gente) nombres.set(g.id, g.displayName || "—");
  }
  const datos = filas
    .map((f) => {
      const nombre = f.teamMemberId ? nombres.get(f.teamMemberId) || "—" : "Sin asignar";
      return { etiqueta: nombre.split(" ")[0].toLowerCase(), tooltip: nombre, valor: Number(f.n || 0), resalte: false };
    })
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 6);
  if (datos.length) datos[0].resalte = true;
  return vista("citas-profesional", "Citas por profesional · semana", ["cita", "citas"], datos);
}

/**
 * Etapas terminales de leads (no cuentan como "abierto"). Incluye las del
 * embudo estándar, la terminal del embudo nutricional ("paciente") y las dos
 * de booking, para no inflar el contador con conversiones ya cerradas.
 *
 * Esta lista TIENE que coincidir con GANADAS ∪ PERDIDAS de lib/leads/embudos.js.
 * Sigue escrita a mano porque la portada no importa nada del embudo, y lo que
 * vigila que no se desincronicen es `scripts/_smoke-leads-etapas.mjs`.
 */
const CLOSED_STAGES = [
  "won",
  "lost",
  "closed_yes",
  "closed_no",
  "paciente",
  "fecha_confirmada",
  "actuacion_realizada",
];

function prettyStage(s) {
  if (!s) return "—";
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
}

async function vistaEmbudo(models) {
  const { Lead } = models;
  const filas = await Lead.findAll({
    attributes: ["stage", [fn("COUNT", col("id")), "n"]],
    where: { stage: { [Op.notIn]: CLOSED_STAGES } },
    group: ["stage"],
    order: [[literal('"n"'), "DESC"]],
    limit: 6,
    raw: true,
  });
  const datos = filas.map((f, i) => ({
    etiqueta: prettyStage(f.stage).toLowerCase(),
    tooltip: prettyStage(f.stage),
    valor: Number(f.n || 0),
    resalte: i === 0,
  }));
  return vista("embudo-leads", "Embudo de leads", ["lead", "leads"], datos);
}

async function vistaAltas(models, plural) {
  const datos = await seriePorMes(models.Client, `(created_at AT TIME ZONE 'Europe/Madrid')`);
  return vista("altas", `Altas de ${plural.toLowerCase()} · 6 meses`, ["alta", "altas"], datos);
}

async function vistaSesiones(models) {
  const datos = await seriePorMes(models.ClinicSession, "session_date");
  return vista("sesiones", "Sesiones · 6 meses", ["sesión", "sesiones"], datos);
}

async function vistaMatriculas(models) {
  const datos = await seriePorMes(models.CourseEnrollment, `(enrolled_at AT TIME ZONE 'Europe/Madrid')`);
  return vista("matriculas", "Matrículas · 6 meses", ["matrícula", "matrículas"], datos);
}

/**
 * Ingresos por servicio del mes en curso, desde las FACTURAS (29/08/2026,
 * Rodrigo): «el dinero no se va a saber a través de precios de las citas; solo
 * se sabe a través de las facturas». La primera versión de esta vista
 * multiplicaba citas × precio del TIPO — valor de agenda, no caja — y por eso
 * se cambió: ahora agrupa las facturas activas del mes (mismo criterio que el
 * «Facturado» de aquí arriba: base imponible, emitidas entre el día 1 y hoy)
 * por su `eventTypeId`, el enlace interno factura→tipo de cita.
 *
 * Una factura sin tipo no cuenta: la gráfica enseña lo ATRIBUIBLE a cada
 * servicio, no el total (ese ya lo dice la cifra de Facturado). Y la vista no
 * se esconde nunca: sin datos sale vacía con su porqué, que aquí es además la
 * instrucción de qué falta (ligar facturas a tipos de cita).
 */
const VACIO_INGRESOS = "Aún no hay facturas de este mes ligadas a un tipo de cita.";
async function vistaIngresosServicio(models) {
  const { Invoice, EventType } = models;
  const desde = fechaMadrid().slice(0, 7) + "-01";
  const hoy = fechaMadrid();
  const filas = await Invoice.findAll({
    attributes: ["eventTypeId", [fn("SUM", col("tax_base")), "importe"]],
    where: {
      eventTypeId: { [Op.ne]: null },
      issueDate: { [Op.between]: [desde, hoy] },
      status: ACTIVE_INVOICE_STATUSES,
    },
    group: ["eventTypeId"],
    raw: true,
  });
  const conImporte = filas.filter((f) => f.eventTypeId && Number(f.importe) > 0);
  if (!conImporte.length)
    return vista("ingresos-servicio", "Ingresos por servicio · este mes", "eur", [], { vacio: VACIO_INGRESOS });
  const tipos = await EventType.findAll({
    where: { id: conImporte.map((f) => f.eventTypeId) },
    attributes: ["id", "name"],
    raw: true,
  });
  const porId = new Map(tipos.map((t) => [t.id, t.name]));
  const datos = conImporte
    .map((f) => {
      const nombre = porId.get(f.eventTypeId) || "—";
      return { etiqueta: nombre.toLowerCase(), tooltip: nombre, valor: round2(Number(f.importe)), resalte: false };
    })
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 6);
  datos[0].resalte = true;
  return vista("ingresos-servicio", "Ingresos por servicio · este mes", "eur", datos, { vacio: VACIO_INGRESOS });
}

/**
 * Ocupación de la agenda de CADA miembro del equipo (Rodrigo, 29/08/2026:
 * «que de forma clara se vea un porcentaje por persona»). De los dos números
 * de ocupación que existen en la app, este es el de Desempeño —horas directas
 * del mes sobre el objetivo semanal prorrateado (lib/clinica/productivity.js)—
 * porque es el único que da un PORCENTAJE por persona; el informe de
 * Equipo → Ocupación cuenta citas sin denominador. Quien no tiene objetivo
 * semanal configurado no sale (un % sin denominador sería inventado); si no lo
 * tiene nadie, la vista sale VACÍA con su porqué — no se esconde (29/08/2026,
 * Rodrigo), y el texto dice justo qué hay que rellenar para estrenarla.
 *
 * SOLO ADMIN, y no «quien ve toda la agenda»: el objetivo semanal es un dato
 * de Dirección (Desempeño/Dirección/Productividad son solo-admin en toda la
 * app), y la agenda compartida comparte CITAS, no retribución.
 */
const VACIO_OCUPACION = "Nadie del equipo tiene objetivo semanal de horas; se pone en su ficha de Equipo.";
async function vistaOcupacion(models) {
  const hoy = fechaMadrid();
  const { rows } = await aggregateTeamProductivity({
    Booking: models.Booking,
    TeamMember: models.TeamMember,
    year: Number(hoy.slice(0, 4)),
    month: Number(hoy.slice(5, 7)),
  });
  // rows ya vienen ordenadas por % descendente.
  const datos = rows
    .filter((r) => r.pct != null)
    .slice(0, 10)
    .map((r, i) => ({
      etiqueta: (r.name || "—").split(" ")[0].toLowerCase(),
      tooltip: `${r.name} · ${r.directHours}h de ${r.availableHours}h`,
      valor: r.pct,
      resalte: i === 0,
    }));
  return vista("ocupacion", "Ocupación del equipo · este mes", "pct", datos, { vacio: VACIO_OCUPACION });
}

// ─── «Mi trabajo»: la mitad derecha de quien no ve gráficas ─────────────────
// Bandeja (informes + incidencias asignadas), la semana que viene, los
// documentos que le han pedido leer y las tareas propias. Cada caja con el MISMO gating que su pantalla de origen y dentro de
// safeBlock: a quien le falte el módulo, esa caja no le sale y ya.
async function buildTrabajo(models, { hasModule, conCitas, conEquipo, miId, miFiltro }) {
  const tengoFicha = miId !== NADIE;

  const [bandeja, proximas, lecturas, tareas] = await Promise.all([
    // Mismos gates que /api/clinica/bandeja: clínica o pacientes, y equipo
    // avanzado (la bandeja se vende con él). Solo lo MÍO: sin ficha no hay nada.
    (hasModule("clinica") || hasModule("pacientes")) && hasModule("team_avanzado") && tengoFicha
      ? safeBlock(async () => {
          const hoy = fechaMadrid();
          // Incidencias por la tabla PIVOTE (31/08/2026): antes el 2.º
          // responsable no veía aquí las suyas — lib/clinica/incidenciasDe.js.
          const misIncidencias = await whereIncidenciasDe(models, miId);
          const [informes, vencidos, incRows, incTotal] = await Promise.all([
            models.ClinicalReport.count({
              where: { therapistId: miId, status: { [Op.ne]: "delivered" } },
            }),
            models.ClinicalReport.count({
              where: { therapistId: miId, status: { [Op.ne]: "delivered" }, dueDate: { [Op.lt]: hoy } },
            }),
            models.Incidencia.findAll({
              where: { ...misIncidencias, status: { [Op.ne]: "resolved" } },
              attributes: ["id", "title", "status", "priority", "incidenceDate"],
              order: [["incidenceDate", "DESC"]],
              limit: 4,
              raw: true,
            }),
            models.Incidencia.count({
              where: { ...misIncidencias, status: { [Op.ne]: "resolved" } },
            }),
          ]);
          if (!informes && !incTotal) return null;
          return {
            informes,
            vencidos,
            incidencias: incRows.map((r) => ({
              id: r.id,
              titulo: r.title,
              estado: r.status,
              estadoLabel: statusLabel(r.status),
              prioridad: r.priority,
              prioridadLabel: priorityLabel(r.priority),
            })),
            incidenciasTotal: incTotal,
          };
        })
      : null,

    // La semana que viene, solo lo mío (hoy ya lo enseña «Mi agenda»).
    conCitas && conEquipo && tengoFicha
      ? safeBlock(async () => {
          const manana = sumaDias(fechaMadrid(), 1);
          const fin = sumaDias(manana, 7);
          const filas = await models.Booking.findAll({
            where: {
              [Op.and]: [
                literal(`(scheduled_at AT TIME ZONE 'Europe/Madrid') >= '${manana}'`),
                literal(`(scheduled_at AT TIME ZONE 'Europe/Madrid') < '${fin}'`),
              ],
              status: { [Op.notIn]: ["cancelled", "no_show"] },
              teamMemberId: miFiltro,
            },
            attributes: ["id", "clientName", "scheduledAt", "status"],
            include: [{ model: models.EventType, as: "eventType", attributes: ["name"], required: false }],
            order: [["scheduledAt", "ASC"]],
            limit: 8,
          });
          if (!filas.length) return null;
          return filas.map((b) => ({
            id: b.id,
            clientName: b.clientName,
            scheduledAt: b.scheduledAt,
            status: b.status,
            tipo: b.eventType?.name || null,
          }));
        })
      : null,

    // Documentos que me han pedido leer (01/09/2026). Aquí NO se gatea por
    // módulo: se le pide la lectura a una persona del equipo, y el acta de la
    // reunión no depende de tener el archivo avanzado contratado.
    conEquipo && tengoFicha
      ? safeBlock(async () => {
          const filas = await models.DocumentRead.findAll({
            where: { teamMemberId: miId, readAt: null },
            include: [
              {
                model: models.Document,
                as: "document",
                required: true,
                attributes: ["id", "fileName", "teamBlockId", "createdAt"],
              },
            ],
            order: [[{ model: models.Document, as: "document" }, "createdAt", "DESC"]],
            limit: 5,
          });
          if (!filas.length) return null;
          return filas.map((f) => ({
            id: f.document.id,
            nombre: f.document.fileName,
            // Los del bloqueo se descargan por su puerta (ver la pantalla de
            // lecturas): la del archivo central exige `documents_avanzado`.
            href: f.document.teamBlockId
              ? `/api/citas/bloqueos/${f.document.teamBlockId}/documents/${f.document.id}/download`
              : `/api/documents/${f.document.id}/download`,
          }));
        })
      : null,

    hasModule("calendar") && tengoFicha
      ? safeBlock(async () => {
          const filas = await models.CalendarTask.findAll({
            where: {
              teamMemberId: miId,
              status: "pending",
              startDate: { [Op.gte]: fechaMadrid() },
            },
            attributes: ["id", "title", "priority", "startDate", "startTime"],
            order: [["startDate", "ASC"], ["startTime", "ASC"]],
            limit: 6,
            raw: true,
          });
          return filas.length ? filas : null;
        })
      : null,
  ]);

  if (!bandeja && !proximas && !tareas && !lecturas) return null;
  return { bandeja, proximas, tareas, lecturas };
}

/* ── LAS TARJETAS POR MÓDULO (01/09/2026, Rodrigo) ──────────────────────────
 *
 * «El inicio universal tiene una gráfica gigante y ya porque no hay agenda.»
 * Y era literal: la portada se dibujaba con DOS piezas —la agenda de Citas a
 * la izquierda y las gráficas de Facturación a la derecha—, así que un cliente
 * sin Citas perdía la mitad izquierda entera y la gráfica se estiraba a lo
 * ancho de la pantalla para tapar el hueco. La portada de un cliente con
 * Proyectos, Soporte y Formación no decía NADA de sus proyectos, sus tickets
 * ni sus cursos.
 *
 * Cada función de aquí abajo devuelve una TARJETA o null, y la portada pinta
 * las que haya: la pantalla se compone con lo que el cliente tiene contratado,
 * no con lo que se decidió un día que era «lo importante».
 *
 * Forma de una tarjeta —una sola, para que la portada tenga UN componente que
 * las pinte todas y no cinco parecidos—:
 *
 *   { key, titulo, href, verMas,
 *     cifras: [{ valor, etiqueta, tono? }],   // el titular, de un vistazo
 *     lista:  [{ id, titulo, sub?, extra?, href?, tono? }],  // el detalle
 *     vacio }                                  // qué se dice cuando no hay nada
 *
 * `tono` es "rojo" | "cobre" | null, y significa lo mismo que en los botones de
 * «Pendiente»: algo que se está pasando de fecha.
 *
 * Todas corren dentro de `safeBlock`: una tarjeta que falla no se pinta, y la
 * portada sigue en pie (regla de siempre de este fichero).
 */

/** «12 sep» a partir de una fecha (ISO corta o Date). null si no hay. */
function diaCorto(valor) {
  if (!valor) return null;
  const d = typeof valor === "string" ? new Date(valor.slice(0, 10) + "T00:00:00Z") : new Date(valor);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "short", timeZone: "UTC" }).replace(".", "");
}

function tarjeta(key, titulo, href, { cifras = [], lista = [], vacio = null, verMas = null } = {}) {
  // Una tarjeta sin cifras Y sin lista Y sin texto de vacío no dice nada: no se
  // pinta. Con `vacio` sí se pinta, porque «no tienes tickets abiertos» ES una
  // respuesta y quien mira quería saberla.
  if (!cifras.length && !lista.length && !vacio) return null;
  return { key, titulo, href, cifras, lista, vacio, verMas };
}

/**
 * La agenda del CALENDARIO (módulo `calendar`), que es la que le faltaba a
 * quien no tiene Citas: reuniones, coordinaciones y lo que cada uno se apunta.
 *
 * Enseña HOY, y si hoy está vacío, lo que viene en las dos semanas siguientes
 * — un panel que dice «no hay nada» un viernes por la tarde y se calla lo del
 * lunes no sirve para organizarse.
 *
 * Sin filtrar por persona A PROPÓSITO: el Calendario del CRM es del equipo y su
 * pantalla lo enseña entero a todo el mundo. Filtrar aquí y no allí sería
 * contar dos verdades distintas del mismo día.
 */
async function buildAgendaCalendario(models) {
  const { CalendarTask, CalendarCategory } = models;
  const hoy = fechaMadrid();
  const enDosSemanas = sumaDias(hoy, 14);

  const filas = await CalendarTask.findAll({
    where: {
      startDate: { [Op.between]: [hoy, enDosSemanas] },
      status: { [Op.ne]: "cancelled" },
    },
    attributes: ["id", "title", "startDate", "startTime", "allDay", "priority", "status", "categoryId"],
    include: CalendarCategory
      ? [{ model: CalendarCategory, as: "category", attributes: ["name", "color"], required: false }]
      : [],
    order: [["startDate", "ASC"], ["startTime", "ASC"]],
    limit: 40,
  });

  const deHoy = filas.filter((t) => t.startDate === hoy);
  // De HOY se enseña todo, hecho incluido: el día se lee entero, igual que la
  // agenda de Citas enseña las citas ya pasadas en gris. De lo que VIENE, no:
  // algo ya dado por hecho no hay que anticiparlo, y llenar «lo próximo» de
  // tachados es enseñar ruido en el sitio donde se mira para organizarse.
  const proximos = deHoy.length ? deHoy : filas.filter((t) => t.status !== "done");

  /*
   * Se devuelve la caja AUNQUE ESTÉ VACÍA, igual que hace `buildAgendaHoy` con
   * las citas. Que la portada se reorganice sola según haya o no algo apuntado
   * un martes es justo lo que Rodrigo señaló el 01/09: la pantalla tiene que
   * ser la misma todos los días, y «no hay nada» es una respuesta, no un hueco.
   */

  return {
    // `esHoy` decide el rótulo de la pantalla: «Hoy» o «Lo que viene».
    esHoy: deHoy.length > 0,
    hoyCount: deHoy.length,
    eventos: proximos.slice(0, 12).map((t) => ({
      id: t.id,
      titulo: t.title,
      fecha: t.startDate,
      dia: diaCorto(t.startDate),
      hora: t.allDay ? null : t.startTime ? String(t.startTime).slice(0, 5) : null,
      todoElDia: !!t.allDay,
      hecha: t.status === "done",
      categoria: t.category?.name ?? null,
      color: t.category?.color ?? null,
    })),
  };
}

/** Proyectos: cuántos vivos, qué se pasa de fecha y los próximos hitos. */
async function buildProyectos(models) {
  const { Project, Task, Milestone, BoardColumn } = models;
  const hoy = fechaMadrid();
  const enUnMes = sumaDias(hoy, 30);
  const vivos = { archivedAt: null, status: { [Op.notIn]: ["cancelled", "completed"] } };

  const [activos, hitos, tareasTarde] = await Promise.all([
    Project.count({ where: vivos }),
    Milestone.findAll({
      where: { status: "pending", dueDate: { [Op.between]: [hoy, enUnMes] } },
      attributes: ["id", "name", "dueDate", "projectId"],
      include: [{ model: Project, as: "project", attributes: ["id", "name", "code"], where: vivos, required: true }],
      order: [["dueDate", "ASC"]],
      limit: 4,
    }),
    // Tarjetas con la fecha límite pasada que NO están en una columna de
    // «Hecho»: el mismo criterio con el que el calendario evita pintar trabajo
    // terminado (lib/calendar/projectEvents.js).
    Task.findAll({
      where: { dueDate: { [Op.lt]: hoy } },
      attributes: ["id", "boardColumnId"],
      include: [
        { model: Project, as: "project", attributes: ["id"], where: vivos, required: true },
        ...(BoardColumn
          ? [{ model: BoardColumn, as: "boardColumn", attributes: ["isDoneColumn"], required: false }]
          : []),
      ],
      limit: 400,
    }),
  ]);

  const retrasadas = tareasTarde.filter((t) => !t.boardColumn?.isDoneColumn).length;
  const cifras = [{ valor: activos, etiqueta: activos === 1 ? "proyecto activo" : "proyectos activos" }];
  if (retrasadas > 0) {
    cifras.push({ valor: retrasadas, etiqueta: retrasadas === 1 ? "tarea vencida" : "tareas vencidas", tono: "rojo" });
  }

  return tarjeta("proyectos", "Proyectos", "/proyectos", {
    cifras,
    lista: hitos.map((h) => ({
      id: h.id,
      titulo: h.name,
      sub: h.project?.code || h.project?.name || null,
      extra: diaCorto(h.dueDate),
      href: `/proyectos/${h.projectId}`,
    })),
    vacio: activos === 0 ? "Todavía no hay proyectos en marcha." : "Ningún hito en el próximo mes.",
    verMas: hitos.length ? "Próximos hitos" : null,
  });
}

/** Soporte: los tickets que esperan a alguien. */
async function buildSoporte(models) {
  const { Ticket } = models;
  const abiertos = { status: { [Op.notIn]: ["resolved", "closed"] } };

  const [n, sinAsignar, ultimos] = await Promise.all([
    Ticket.count({ where: abiertos }),
    Ticket.count({ where: { ...abiertos, assignedTo: null } }),
    Ticket.findAll({
      where: abiertos,
      attributes: ["id", "number", "title", "priority", "createdAt"],
      order: [["createdAt", "DESC"]],
      limit: 4,
    }),
  ]);

  const cifras = [{ valor: n, etiqueta: n === 1 ? "ticket abierto" : "tickets abiertos" }];
  if (sinAsignar > 0) cifras.push({ valor: sinAsignar, etiqueta: "sin asignar", tono: "cobre" });

  return tarjeta("soporte", "Soporte", "/soporte", {
    cifras,
    lista: ultimos.map((t) => ({
      id: t.id,
      titulo: t.title,
      sub: t.number != null ? `#${t.number}` : null,
      extra: t.priority === "critical" ? "Crítica" : t.priority === "high" ? "Alta" : null,
      tono: t.priority === "critical" ? "rojo" : null,
      href: `/soporte/${t.id}`,
    })),
    vacio: "Ningún ticket abierto ahora mismo.",
    verMas: ultimos.length ? "Los últimos" : null,
  });
}

/** Leads: lo que hay en el embudo y lo que ha entrado esta semana. */
async function buildLeads(models) {
  const { Lead } = models;
  const lunes = lunesDeEstaSemana();
  const enCurso = { stage: { [Op.notIn]: CLOSED_STAGES } };

  const [abiertos, nuevos, ultimos] = await Promise.all([
    Lead.count({ where: enCurso }),
    Lead.count({ where: { [Op.and]: [literal(`(created_at AT TIME ZONE 'Europe/Madrid') >= '${lunes}'`)] } }),
    Lead.findAll({
      where: enCurso,
      attributes: ["id", "name", "stage", "createdAt"],
      order: [["createdAt", "DESC"]],
      limit: 4,
    }),
  ]);

  const cifras = [{ valor: abiertos, etiqueta: abiertos === 1 ? "lead en curso" : "leads en curso" }];
  if (nuevos > 0) cifras.push({ valor: nuevos, etiqueta: "esta semana" });

  return tarjeta("leads", "Leads", "/leads", {
    cifras,
    lista: ultimos.map((l) => ({
      id: l.id,
      titulo: l.name || "Sin nombre",
      sub: prettyStage(l.stage),
      href: "/leads",
    })),
    vacio: "El embudo está vacío.",
    verMas: ultimos.length ? "Los últimos en entrar" : null,
  });
}

/** Formación: cursos activos, matrículas y las últimas que han entrado. */
async function buildFormacion(models) {
  const { Course, CourseEnrollment } = models;
  const [cursos, matriculas, recientes] = await Promise.all([
    Course.count({ where: { active: true } }),
    CourseEnrollment.count(),
    CourseEnrollment.findAll({
      attributes: ["id", "courseId", "enrolledAt"],
      include: [{ model: Course, as: "course", attributes: ["name"], required: false }],
      order: [["enrolledAt", "DESC"]],
      limit: 4,
    }),
  ]);

  const cifras = [
    { valor: cursos, etiqueta: cursos === 1 ? "curso activo" : "cursos activos" },
    { valor: matriculas, etiqueta: matriculas === 1 ? "matrícula" : "matrículas" },
  ];

  return tarjeta("formacion", "Formación", "/formacion", {
    cifras,
    lista: recientes.map((m) => ({
      id: m.id,
      titulo: m.course?.name || "Curso",
      extra: diaCorto(m.enrolledAt),
      href: "/formacion",
    })),
    vacio: cursos === 0 ? "Aún no hay cursos dados de alta." : "Sin matrículas todavía.",
    verMas: recientes.length ? "Últimas matrículas" : null,
  });
}

/** Fichas: cuántas hay y cuántas se han dado de alta este mes. */
async function buildFichas(models, plural) {
  const { Client } = models;
  const primeroDeMes = fechaMadrid().slice(0, 7) + "-01";
  const [total, delMes] = await Promise.all([
    Client.count(),
    Client.count({
      where: { [Op.and]: [literal(`(created_at AT TIME ZONE 'Europe/Madrid') >= '${primeroDeMes}'`)] },
    }),
  ]);
  if (!total && !delMes) return null;

  const cifras = [{ valor: total, etiqueta: plural.toLowerCase() }];
  if (delMes > 0) cifras.push({ valor: delMes, etiqueta: "este mes" });
  return tarjeta("fichas", plural, "/clientes", { cifras });
}

// ─── Orquestador ────────────────────────────────────────────────────────────

/**
 * Construye la portada para el contexto de tenant dado.
 * @returns {Promise<{admin, finance, agenda, pendiente, vistas}>}
 */
export async function buildPortada(ctx) {
  const { hasModule, tenantHasModule, tenantModels, tenantSequelize, user, tenant } = ctx;
  const vacia = {
    admin: false,
    finance: null,
    agenda: null,
    agendaCalendario: null,
    pendiente: [],
    vistas: [],
    tarjetas: [],
    trabajo: null,
  };

  // Sin usuario identificable no se compone nada. ctx.hasModule() falla ABIERTO
  // cuando user es null (pensado para webhooks públicos); en la portada eso
  // expondría datos a un principal que no podemos identificar.
  if (!user) return vacia;

  const admin = isAdmin(user);
  const conCitas = hasModule("citas");
  // ⚠️ `tenantHasModule` y NO `hasModule`: la pregunta es si el CENTRO tiene
  // equipo, no si quien mira puede entrar en la pantalla de Equipo. El porqué
  // (el caso de Rocío), en lib/citas/visibilidad.js.
  const conEquipo = tenantHasModule("team");
  const veTodo = veTodaLaAgenda({ tenant, role: user.role });
  const vocab = vocabularioCliente(tenantHasModule);

  // ── SIN FACTURACIÓN NO HAY GRÁFICAS (Rodrigo, 29/08/2026) ──
  // Un miembro del equipo NO adherido al módulo de facturación no ve gráficas
  // de NINGÚN tipo: ni dinero ni actividad (embudo, altas, citas del centro…
  // también son «el negocio»). Su mitad derecha es operativa: bandeja, semana,
  // documentos por leer y tareas (`trabajo`). La condición cruza tenant Y usuario a propósito: en un
  // tenant que no ha comprado facturación no hay «adhesión» que negar, y sus
  // usuarios conservan las gráficas de actividad de siempre.
  const sinGraficas = tenantHasModule("billing") && !hasModule("billing");

  // «Mías» filtra siempre por la ficha de quien mira; las series y contadores
  // de citas solo llevan filtro cuando NO se puede ver toda la agenda.
  const miId = conEquipo ? await miFichaDeEquipo(tenantModels, user.id) : NADIE;
  let miFiltro = null;
  let filtroSeries = null;
  if (conCitas && conEquipo) {
    miFiltro = soloLoSuyo(miId);
    if (!veTodo) filtroSeries = miFiltro;
  }

  const range = monthRange();

  const [finance, agenda, vFact, vIngresos, vSemana, vProf, vOcupacion, vEmbudo, vAltas, vSesiones, vMatriculas, trabajo] =
    await Promise.all([
      hasModule("billing")
        ? safeBlock(() => buildFinance(tenantModels, { from: range.from, to: range.to, today: range.today, admin }))
        : null,
      conCitas ? safeBlock(() => buildAgendaHoy(tenantModels, { conEquipo, veTodo, miFiltro })) : null,
      !sinGraficas && hasModule("billing") ? safeBlock(() => vistaFacturacion(tenantModels)) : null,
      !sinGraficas && hasModule("billing") && conCitas ? safeBlock(() => vistaIngresosServicio(tenantModels)) : null,
      !sinGraficas && conCitas ? safeBlock(() => vistaCitasSemana(tenantModels, { filtro: filtroSeries })) : null,
      !sinGraficas && conCitas && conEquipo && veTodo ? safeBlock(() => vistaPorProfesional(tenantModels)) : null,
      !sinGraficas && conCitas && conEquipo && admin ? safeBlock(() => vistaOcupacion(tenantModels)) : null,
      !sinGraficas && hasModule("leads") ? safeBlock(() => vistaEmbudo(tenantModels)) : null,
      !sinGraficas && hasModule("clients") ? safeBlock(() => vistaAltas(tenantModels, vocab.plural)) : null,
      !sinGraficas && hasModule("clinica") ? safeBlock(() => vistaSesiones(tenantModels)) : null,
      !sinGraficas && hasModule("training") ? safeBlock(() => vistaMatriculas(tenantModels)) : null,
      sinGraficas
        ? safeBlock(() => buildTrabajo(tenantModels, { hasModule, conCitas, conEquipo, miId, miFiltro }))
        : null,
    ]);

  const vistas = [vFact, vIngresos, vSemana, vProf, vOcupacion, vEmbudo, vAltas, vSesiones, vMatriculas].filter(Boolean);

  /*
   * LAS TARJETAS DE LOS MÓDULOS (01/09/2026). Aquí se decide QUÉ pinta la
   * portada de este cliente: una por módulo contratado, en el orden en que se
   * trabaja (lo de hoy primero, el negocio después). Cada una se pide solo si
   * el módulo está, y cada una puede devolver null sin romper nada.
   *
   * El gate es `hasModule` —módulo del tenant ∩ acceso del usuario—: quien no
   * puede entrar en Soporte tampoco ve en la portada cuántos tickets hay.
   */
  const [agendaCalendario, tProyectos, tSoporte, tLeads, tFormacion, tFichas] = await Promise.all([
    hasModule("calendar") ? safeBlock(() => buildAgendaCalendario(tenantModels)) : null,
    hasModule("projects") ? safeBlock(() => buildProyectos(tenantModels)) : null,
    hasModule("support") ? safeBlock(() => buildSoporte(tenantModels)) : null,
    hasModule("leads") ? safeBlock(() => buildLeads(tenantModels)) : null,
    hasModule("training") ? safeBlock(() => buildFormacion(tenantModels)) : null,
    hasModule("clients") ? safeBlock(() => buildFichas(tenantModels, vocab.plural)) : null,
  ]);
  const tarjetas = [tProyectos, tSoporte, tLeads, tFormacion, tFichas].filter(Boolean);

  // ── Pendiente: cada cosa con su cifra y su destino. Solo lo que existe. ──
  const pendiente = [];

  /*
   * Informes vencidos: SOLO LOS MÍOS salvo para quien ve todo el equipo
   * (02/09/2026, AV-0022 de Aumenta). Nació contando los de todo el centro
   * para todo el mundo, igual que las incidencias de abajo, y por el mismo
   * motivo se corrige: un aviso solo es un aviso si es para ti. Dirección y
   * las coordinadoras (Configuración → Módulos, lib/clinica/coordinadoras.js)
   * siguen viendo el total del centro; sin ficha de equipo no hay informes
   * propios y la tarjeta no sale.
   */
  if (hasModule("clinica")) {
    const todoElCentro = veTodoElEquipo({ tenant, role: user.role, teamMemberId: miId });
    const deQuien = todoElCentro ? {} : miId !== NADIE ? { therapistId: miId } : null;
    const n = deQuien === null ? 0 : await safeBlock(() =>
      tenantModels.ClinicalReport.count({
        where: { ...deQuien, status: { [Op.ne]: "delivered" }, dueDate: { [Op.lt]: new Date() } },
      })
    );
    if (n > 0)
      pendiente.push({ key: "informes", count: n, titulo: "Informes vencidos", modulo: "Clínica", href: "/clinica/informes", tono: "rojo" });
  }

  // Incidencias abiertas (01/09/2026, Rodrigo). Nació el 31/08 contando las de
  // TODO el centro para TODO el mundo, y avisaba a cada uno de incidencias que
  // no le tocan: un aviso solo es un aviso si es para ti. Ahora depende de
  // quién mira, y son dos lecturas distintas de la misma tarjeta:
  //
  //   · quien dirige (admin)  → el total del centro, que es su panorama;
  //   · el resto              → SOLO las suyas, con la misma regla de la
  //     pivote que usan la campana, Equipo → Bandeja y Mi trabajo
  //     (lib/clinica/incidenciasDe.js) — segundo y tercer responsable
  //     incluidos. Sin ficha de equipo no hay incidencias propias: no sale.
  //
  // El listado de /equipo/incidencias sigue enseñándolas todas a todos: ahí se
  // va a mirar, aquí a que te avisen. Mismos gates que
  // /api/clinica/incidencias (clínica o pacientes + equipo avanzado). Ojo:
  // Pendiente corta en 6 tarjetas — esta entra detrás de informes y facturas.
  if ((hasModule("clinica") || hasModule("pacientes")) && hasModule("team_avanzado") && (admin || miId !== NADIE)) {
    const n = await safeBlock(async () => {
      const dequien = admin ? {} : await whereIncidenciasDe(tenantModels, miId);
      return tenantModels.Incidencia.count({ where: { ...dequien, status: { [Op.ne]: "resolved" } } });
    });
    if (n > 0)
      pendiente.push({
        key: "incidencias",
        count: n,
        titulo: n === 1 ? "Incidencia abierta" : "Incidencias abiertas",
        modulo: "Equipo",
        href: "/equipo/incidencias",
        tono: "cobre",
      });
  }

  /*
   * Documentos por leer (01/09/2026, Rodrigo): «que les salte un aviso de que
   * ese documento lo tienen que leer en la pantalla de inicio». Es literalmente
   * esta tarjeta.
   *
   * SOLO LAS MÍAS, también para el admin: una lectura pedida es de una persona,
   * y el panorama del centro —quién va al día— vive en la propia pantalla de
   * lecturas. Sin ficha de equipo no hay lecturas propias y no sale nada.
   *
   * `tenantHasModule("team")` y no `hasModule`: la pregunta es si el centro
   * tiene equipo, no si quien mira puede entrar en la pantalla de Equipo.
   */
  if (conEquipo && miId !== NADIE) {
    const n = await safeBlock(() => cuentaPendientes({ tenantModels, teamMemberId: miId }));
    if (n > 0)
      pendiente.push({
        key: "lecturas",
        count: n,
        titulo: n === 1 ? "Documento por leer" : "Documentos por leer",
        modulo: "Documentos",
        href: "/documentos/lecturas",
        tono: "cobre",
      });
  }

  if (finance?.overdue?.count > 0) {
    pendiente.push({
      key: "facturas",
      count: finance.overdue.count,
      titulo: finance.overdue.count === 1 ? "Factura por reclamar" : "Facturas por reclamar",
      modulo: "Facturación",
      href: "/facturacion/cobros",
      tono: "rojo",
    });
  }

  if (hasModule("clients_avanzado") && tenantSequelize && tenant?.slug) {
    const n = await safeBlock(async () => {
      const { bloquea } = await cuentasDe(tenantSequelize, `crm_${tenant.slug}`);
      return bloquea;
    });
    if (n > 0)
      pendiente.push({ key: "fichas", count: n, titulo: "Fichas por completar", modulo: vocab.plural, href: "/clientes/urgentes", tono: "cobre" });
  }

  if (conCitas) {
    const hoy = fechaMadrid();
    const n = await safeBlock(() =>
      tenantModels.Booking.count({
        where: {
          status: "pending",
          [Op.and]: [literal(`(scheduled_at AT TIME ZONE 'Europe/Madrid') >= '${hoy}'`)],
          ...(filtroSeries ? { teamMemberId: filtroSeries } : {}),
        },
      })
    );
    if (n > 0)
      pendiente.push({
        key: "citas-pendientes",
        count: n,
        titulo: n === 1 ? "Cita sin confirmar" : "Citas sin confirmar",
        modulo: "Agenda",
        href: "/citas",
        tono: "cobre",
      });
  }

  return { admin, finance, agenda, agendaCalendario, pendiente, vistas, tarjetas, trabajo };
}
