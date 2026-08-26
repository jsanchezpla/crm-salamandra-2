import { Op, fn, col, literal } from "sequelize";
import { getKpisForPeriod } from "../billing/billingSummary.js";
import { veTodaLaAgenda, soloLoSuyo, NADIE_DEL_EQUIPO } from "../citas/visibilidad.js";
import { vocabularioCliente } from "../clients/vocabulario.js";
import { cuentasDe } from "../clients/urgentes.js";

/**
 * Agregador de la portada (rediseño «Hoy y el negocio», 26/08/2026, Rodrigo).
 *
 * `buildPortada(ctx)` compone en el servidor (RSC) todo lo que pinta la home:
 *
 *   - `finance`   → las tres cifras de dinero (reutiliza el cálculo de siempre).
 *   - `agenda`    → «Mi agenda» de HOY: lo mío y, si se puede, todo el centro.
 *   - `pendiente` → lo que espera algo de alguien, como botones con destino.
 *   - `vistas`    → las series de la gráfica rotatoria (una por módulo activo).
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
// `unidad` es "eur" o el par [singular, plural] para el globito. Una vista sin
// un solo dato distinto de cero no se enseña (una gráfica a cero no informa).
function vista(key, titulo, unidad, datos) {
  if (!datos || !datos.length) return null;
  if (!datos.some((d) => d.valor > 0)) return null;
  return { key, titulo, unidad, datos };
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

// ─── Orquestador ────────────────────────────────────────────────────────────

/**
 * Construye la portada para el contexto de tenant dado.
 * @returns {Promise<{admin, finance, agenda, pendiente, vistas}>}
 */
export async function buildPortada(ctx) {
  const { hasModule, tenantHasModule, tenantModels, tenantSequelize, user, tenant } = ctx;
  const vacia = { admin: false, finance: null, agenda: null, pendiente: [], vistas: [] };

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

  // «Mías» filtra siempre por la ficha de quien mira; las series y contadores
  // de citas solo llevan filtro cuando NO se puede ver toda la agenda.
  let miFiltro = null;
  let filtroSeries = null;
  if (conCitas && conEquipo) {
    const miId = await miFichaDeEquipo(tenantModels, user.id);
    miFiltro = soloLoSuyo(miId);
    if (!veTodo) filtroSeries = miFiltro;
  }

  const range = monthRange();

  const [finance, agenda, vFact, vSemana, vProf, vEmbudo, vAltas, vSesiones, vMatriculas] = await Promise.all([
    hasModule("billing")
      ? safeBlock(() => buildFinance(tenantModels, { from: range.from, to: range.to, today: range.today, admin }))
      : null,
    conCitas ? safeBlock(() => buildAgendaHoy(tenantModels, { conEquipo, veTodo, miFiltro })) : null,
    hasModule("billing") ? safeBlock(() => vistaFacturacion(tenantModels)) : null,
    conCitas ? safeBlock(() => vistaCitasSemana(tenantModels, { filtro: filtroSeries })) : null,
    conCitas && conEquipo && veTodo ? safeBlock(() => vistaPorProfesional(tenantModels)) : null,
    hasModule("leads") ? safeBlock(() => vistaEmbudo(tenantModels)) : null,
    hasModule("clients") ? safeBlock(() => vistaAltas(tenantModels, vocab.plural)) : null,
    hasModule("clinica") ? safeBlock(() => vistaSesiones(tenantModels)) : null,
    hasModule("training") ? safeBlock(() => vistaMatriculas(tenantModels)) : null,
  ]);

  const vistas = [vFact, vSemana, vProf, vEmbudo, vAltas, vSesiones, vMatriculas].filter(Boolean);

  // ── Pendiente: cada cosa con su cifra y su destino. Solo lo que existe. ──
  const pendiente = [];

  if (hasModule("clinica")) {
    const n = await safeBlock(() =>
      tenantModels.ClinicalReport.count({
        where: { status: { [Op.ne]: "delivered" }, dueDate: { [Op.lt]: new Date() } },
      })
    );
    if (n > 0)
      pendiente.push({ key: "informes", count: n, titulo: "Informes vencidos", modulo: "Clínica", href: "/clinica/informes", tono: "rojo" });
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

  return { admin, finance, agenda, pendiente, vistas };
}
