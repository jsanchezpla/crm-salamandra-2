import { Op, fn, col } from "sequelize";
import { withTenant } from "../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden } from "../../../lib/utils/apiResponse.js";
import { serializePatient } from "../../../lib/clinica/serialize.js";
import { logClinicaAudit, auditSummary } from "../../../lib/clinica/audit.js";
import { normalizeConsents } from "../../../lib/clinica/consents.js";
import { filtroPorNombre } from "../../../lib/utils/busqueda.js";
import { normalizeSpecialties, deriveCareType, SPECIALTY_KEYS } from "../../../lib/clinica/specialties.js";
import {
  terapeutasDe, referenciaDe, conReferencia, listaDe, terapeutasEfectivos,
  sincronizarTerapeutas, pacientesDe,
} from "../../../lib/clinica/terapeutas.js";

const cap = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// El módulo clínico es una única superficie: Pacientes (el dato) + Clínica (las
// acciones). Se permite el acceso si el tenant tiene cualquiera de los dos.
function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

// Nº de sesiones y fecha de la última por paciente, en una sola query agregada.
async function sessionAgg(ClinicSession, patientIds) {
  const map = {};
  if (patientIds.length === 0) return map;
  const rows = await ClinicSession.findAll({
    attributes: ["patientId", [fn("COUNT", col("id")), "cnt"], [fn("MAX", col("session_date")), "last"]],
    where: { patientId: { [Op.in]: patientIds } },
    group: ["patient_id"],
    raw: true,
  });
  for (const r of rows) map[r.patientId] = { sessionsCount: Number(r.cnt), lastSession: r.last };
  return map;
}

export const GET = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica/Pacientes no activo");
  const { Patient, ClinicSession, TeamMember } = ctx.tenantModels;
  const sp = new URL(request.url).searchParams;

  const where = {};
  const q = sp.get("q")?.trim();
  /*
   * El buscador parte lo escrito en PALABRAS y las exige TODAS (28/08/2026).
   * Antes buscaba la frase entera dentro de cada columna por separado, así que
   * «hugo castro» no encontraba a «Hugo Castro Díaz»: esa cadena no está entera
   * ni en `first_name` ni en `last_name`. Medido antes de tocarlo: los 1.174
   * pacientes de Aumenta, los 1.174, eran imposibles de encontrar escribiendo su
   * propio nombre y su primer apellido. El porqué entero, en `lib/utils/busqueda.js`.
   *
   * Va a `Op.and` y no a `where[Op.or]` a propósito: ver la nota del filtro por
   * terapeuta, aquí debajo. Dos `Op.or` en el mismo objeto se pisan en silencio.
   */
  if (q) {
    const porNombre = await filtroPorNombre(ctx.tenantSequelize, q, ["Patient.first_name", "Patient.last_name"]);
    if (porNombre) (where[Op.and] ||= []).push(porNombre);
  }
  /*
   * Filtrar por terapeuta mira la LISTA ENTERA, no solo al de referencia
   * (25/08/2026). Si mirara solo la columna, una terapeuta que se filtra por sí
   * misma no vería a los pacientes que comparte con otra compañera — que es
   * justo el caso que hizo falta arreglar.
   *
   * Va como `Op.or` DENTRO de un `Op.and` porque el buscador de arriba ya usa
   * `where[Op.or]`: dos `Op.or` en el mismo objeto se pisan y el segundo se
   * lleva por delante al primero, en silencio.
   *
   * Y sigue mirando `mainTherapistId` además de la tabla: mientras un paciente
   * no tenga filas, la columna es su lista (`lib/clinica/terapeutas.js`).
   */
  if (sp.get("therapistId")) {
    const tid = sp.get("therapistId");
    if (!UUID_RE.test(tid)) return error("therapistId inválido", 422);
    const suyos = await pacientesDe(ctx.tenantModels, ctx.tenantSequelize, tid);
    if (suyos === null) {
      where.mainTherapistId = tid;
    } else {
      (where[Op.and] ||= []).push({
        [Op.or]: [{ mainTherapistId: tid }, { id: { [Op.in]: suyos } }],
      });
    }
  }
  // Pacientes de un cliente pagador concreto (sección "Pacientes" de su ficha).
  // Un clientId presente pero malformado NO debe caer al listado completo.
  const clientId = sp.get("clientId");
  if (clientId) {
    if (!UUID_RE.test(clientId)) return error("clientId inválido", 422);
    where.clientId = clientId;
  }
  const status = sp.get("status");
  if (status && ["active", "paused", "discharged"].includes(status)) where.status = status;
  // Filtro por módulo asistencial (Terapia / Nutrición) — útil para vistas que
  // solo quieran uno de los dos tipos de paciente.
  const careType = sp.get("careType");
  if (careType && ["terapia", "nutricion"].includes(careType)) where.careType = careType;
  // Filtro por especialidad concreta (logopedia, psicología…): pacientes cuya
  // lista de especialidades CONTIENE la pedida (JSONB @>).
  const specialty = sp.get("specialty");
  if (specialty && SPECIALTY_KEYS.includes(specialty)) where.specialties = { [Op.contains]: [specialty] };

  // Paginación (02/08/2026). Antes pedía 300 fijos y devolvía como `total` el
  // tamaño de la página, así que con los 1.174 pacientes de Aumenta la pantalla
  // decía "300" y no había forma de llegar al resto.
  //
  // El límite por defecto sigue siendo 300 A PROPÓSITO: la pantalla actual
  // filtra y calcula sus indicadores sobre TODO lo que recibe, así que bajarlo
  // aquí le rompería el buscador. Lo que sí se arregla ya es el `total`, que
  // ahora es el de verdad. Quien quiera páginas pequeñas manda `limit`.
  const page = Math.max(1, parseInt(sp.get("page") ?? "1"));
  const limit = Math.min(parseInt(sp.get("limit") ?? "300"), 300);

  const { rows, count } = await Patient.findAndCountAll({
    where,
    include: [{ model: TeamMember, as: "mainTherapist", attributes: ["id", "displayName", "position", "avatarColor"] }],
    order: [["lastName", "ASC"], ["firstName", "ASC"]],
    limit,
    offset: (page - 1) * limit,
    // Con include + findAndCountAll, Sequelize cuenta filas del JOIN si no se
    // le dice esto, y el total saldría inflado.
    distinct: true,
  });
  const agg = await sessionAgg(ClinicSession, rows.map((r) => r.id));
  // Los terapeutas de toda la página en UNA consulta, como las sesiones de
  // arriba. Con un include hacia la tabla de muchos a muchos, `findAndCountAll`
  // contaría filas del JOIN y la paginación se iría (lib/clinica/terapeutas.js).
  const equipos = await listaDe(ctx.tenantModels, ctx.tenantSequelize, rows.map((r) => r.id));
  const patients = rows.map((p) =>
    serializePatient(p, {
      ...(agg[p.id] ?? { sessionsCount: 0, lastSession: null }),
      therapists: terapeutasEfectivos(p, equipos[p.id]),
    })
  );

  // Resumen sobre TODOS los pacientes que cumplen el filtro, no solo la página.
  // Sin esto, al paginar los indicadores de la cabecera contarían 50 y dirían
  // que el centro tiene 50 pacientes activos.
  const porEstado = await Patient.findAll({
    where,
    attributes: ["status", [fn("COUNT", col("id")), "n"]],
    group: ["status"],
    raw: true,
  });
  const resumen = { active: 0, paused: 0, discharged: 0, total: count };
  for (const r of porEstado) resumen[r.status] = Number(r.n);

  return ok({ patients, total: count, page, pages: Math.ceil(count / limit), resumen });
});

export const POST = withTenant(async (request, _rc, ctx) => {
  if (!gate(ctx)) return forbidden("Módulo Clínica/Pacientes no activo");
  const { Patient, Client } = ctx.tenantModels;
  const userId = request.headers.get("x-user-id");
  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body inválido");
  }
  if (!body?.firstName?.trim() || !body?.lastName?.trim()) return error("Nombre y apellidos son obligatorios");

  // Cliente pagador opcional. Si viene, debe existir en este tenant (evita
  // enlazar un paciente a un client_id inventado / de otro schema).
  let clientId = null;
  if (body.clientId != null && body.clientId !== "") {
    if (!UUID_RE.test(String(body.clientId))) return error("clientId inválido", 422);
    if (!Client) return error("Módulo clientes no disponible en este tenant", 422);
    const owner = await Client.findByPk(body.clientId, { attributes: ["id"] });
    if (!owner) return error("El cliente indicado no existe", 422);
    clientId = owner.id;
  }

  // Especialidad(es) del paciente. El módulo grueso `careType` se DERIVA de la
  // lista (compat con lo desplegado antes de la taxonomía); si no viene lista,
  // se respeta el careType explícito o 'terapia' por defecto.
  const specialties = normalizeSpecialties(body.specialties);
  const careType = deriveCareType(specialties)
    || (["terapia", "nutricion"].includes(body.careType) ? body.careType : "terapia");

  const payload = {
    clientId,
    careType,
    specialties,
    firstName: body.firstName.trim(),
    lastName: body.lastName.trim(),
    age: body.age != null && body.age !== "" ? Number(body.age) : null,
    birthDate: body.birthDate || null,
    educationCenter: body.educationCenter?.trim() || null,
    educationLevel: body.educationLevel?.trim() || null,
    referralReason: body.referralReason?.trim() || null,
    referredBy: body.referredBy?.trim() || null,
    objectives: Array.isArray(body.objectives) ? body.objectives : [],
    // Lo pone `sincronizarTerapeutas` unas líneas más abajo, ya validado contra
    // las fichas de equipo. Antes entraba `body.mainTherapistId` tal cual: un id
    // que no fuera UUID llegaba a Postgres y salía un 500 (22P02).
    mainTherapistId: null,
    enrollmentDate: body.enrollmentDate || null,
    attendanceFrequency: body.attendanceFrequency?.trim() || null,
    status: ["active", "paused", "discharged"].includes(body.status) ? body.status : "active",
    notes: body.notes?.trim() || null,
    // ── Datos personales / legales ──────────────────────────────────────
    dni: cap(body.dni, 20),
    address: cap(body.address, 255),
    relationship: cap(body.relationship, 60),
    consents: normalizeConsents(body.consents, { previous: {}, userId, now: new Date().toISOString() }),
    contractSigned: !!body.contractSigned,
  };
  /*
   * Terapeutas del alta. `therapists`/`therapistIds` es la lista; el
   * `mainTherapistId` de siempre —que es lo que manda hoy la pantalla de alta—
   * se aplica ENCIMA con `conReferencia`, que sube a esa persona al puesto 0 sin
   * echar a nadie. Traducirlo a una lista de uno habría borrado al resto cada
   * vez que guardara un cliente antiguo de la API.
   */
  const pedidos = conReferencia(terapeutasDe(body) ?? [], referenciaDe(body));

  const p = await ctx.tenantSequelize.transaction(async (transaction) => {
    const nuevo = await Patient.create(payload, { transaction });
    await sincronizarTerapeutas({
      models: ctx.tenantModels,
      sequelize: ctx.tenantSequelize,
      paciente: nuevo,
      entradas: pedidos,
      transaction,
    });
    return nuevo;
  });

  await logClinicaAudit({
    tenantId: ctx.tenant.id,
    userId: request.headers.get("x-user-id"),
    action: "pacientes.created",
    entity: "Patient",
    entityId: p.id,
    after: { ...auditSummary(p), therapistIds: pedidos.map((e) => e.id) },
    ip: request.headers.get("x-forwarded-for"),
  });
  const equipo = await listaDe(ctx.tenantModels, ctx.tenantSequelize, [p.id]);
  return created(serializePatient(p, {
    sessionsCount: 0,
    lastSession: null,
    therapists: terapeutasEfectivos(p, equipo[p.id]),
  }));
});
