import { Op } from "sequelize";
import { withTenant } from "../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, serverError } from "../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../lib/db/masterDb.js";
import { serializeTeamMember, serializeProfesional } from "../../../lib/team/serializeTeamMember.js";
import { normalizeSpecialties } from "../../../lib/clinica/specialties.js";
import { correoDeCuenta } from "../../../lib/auth/correoCuenta.js";
import { limpiaColorBloqueo } from "../../../lib/citas/coloresBloqueo.js";
import { isValidHexColor } from "../../../lib/citas/validation.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const VALID_STATUS = new Set(["active", "inactive", "on_leave"]);
const VALID_PERIODS = new Set([12, 14]);

function normalizeEmail(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed.toLowerCase();
}

function normalizeString(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

function normalizeAmount(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined; // sentinel: inválido
  return Math.round(n * 100) / 100;
}

async function userBelongsToTenant(userId, tenantId) {
  if (!userId) return true;
  const { User } = getMasterModels();
  const user = await User.findByPk(userId, { attributes: ["id", "tenantId"] });
  return !!user && user.tenantId === tenantId;
}

async function userAlreadyLinked(TeamMember, userId, excludeMemberId = null) {
  if (!userId) return false;
  const where = { userId };
  if (excludeMemberId) where.id = { [Op.ne]: excludeMemberId };
  const existing = await TeamMember.findOne({ where, attributes: ["id"] });
  return !!existing;
}

async function emailAlreadyUsed(TeamMember, email, excludeMemberId = null) {
  if (!email) return false;
  const where = { email };
  if (excludeMemberId) where.id = { [Op.ne]: excludeMemberId };
  const existing = await TeamMember.findOne({ where, attributes: ["id"] });
  return !!existing;
}

async function logAudit({ tenantId, userId, action, entityId, before, after, ip }) {
  try {
    const { AuditLog } = getMasterModels();
    await AuditLog.create({
      tenantId, userId, action, entity: "TeamMember", entityId, before, after, ip,
    });
  } catch {
    // no romper la respuesta principal por un fallo de auditoría
  }
}

// ───────────────────────────────────────────────────────────────────────────
// GET /api/team
// ───────────────────────────────────────────────────────────────────────────
/**
 * ⚠️ DOS PUERTAS, NO UNA (26/08/2026).
 *
 * `tenantHasModule("team")` → ¿el CENTRO tiene equipo? Si no, aquí no hay nada
 * que contar y es un 403 como siempre.
 *
 * `hasModule("team")` → ¿puede ESTA PERSONA entrar en la pantalla de Equipo? Si
 * no, se le sirve la LISTA RECORTADA: nombres, colores y especialidades, sin
 * correos, teléfonos, notas ni dinero (lib/team/serializeProfesional).
 *
 * El porqué entero está en lib/team/serializeTeamMember.js. En corto: una
 * docena de pantallas usan este endpoint solo para rellenar un desplegable de
 * profesionales, y hasta hoy se lo comía un 403 en silencio —las quince
 * terapeutas de Aumenta veían media plantilla en el filtro de /pacientes, y
 * cambiaba al pasar de página—. Es el primo hermano del fallo de
 * lib/citas/visibilidad.js: preguntar por el usuario lo que era del centro.
 *
 * Escribir (POST/PATCH/DELETE) NO se toca: sigue pidiendo el módulo y rol de
 * dirección.
 */
export const GET = withTenant(async (request, _ctx, { tenant, tenantModels, hasModule, tenantHasModule }) => {
  try {
    if (!tenantHasModule("team")) return forbidden("Módulo team no activo");

    const { TeamMember } = tenantModels;
    const userRole = request.headers.get("x-user-role") ?? "user";
    const isAdmin = ADMIN_ROLES.has(userRole);
    // Quien no tiene el módulo en SUS accesos recibe la lista para desplegables.
    const listaReducida = !hasModule("team");

    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get("status") ?? "default";
    const role = searchParams.get("role");
    const q = (searchParams.get("q") ?? "").trim();
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));
    const offset = Math.max(0, parseInt(searchParams.get("offset") || "0", 10));

    const where = {};
    if (statusParam === "all") {
      // sin filtro
    } else if (statusParam === "default") {
      where.status = { [Op.in]: ["active", "on_leave"] };
    } else if (VALID_STATUS.has(statusParam)) {
      where.status = statusParam;
    } else {
      return error("status inválido");
    }

    if (role) where.position = role;

    if (q) {
      // Con la lista recortada NO se busca por correo: devolver un correo está
      // cerrado, así que poder adivinarlo letra a letra también.
      const porNombre = { displayName: { [Op.iLike]: `%${q}%` } };
      where[Op.and] = [
        listaReducida ? porNombre : { [Op.or]: [porNombre, { email: { [Op.iLike]: `%${q}%` } }] },
      ];
    }

    const { count, rows } = await TeamMember.findAndCountAll({
      where,
      order: [["displayName", "ASC"]],
      limit,
      offset,
    });

    // Lista de roles únicos presentes en el tenant (para selector dinámico)
    const roleRows = await TeamMember.findAll({
      attributes: ["position"],
      where: { position: { [Op.ne]: null } },
      group: ["position"],
      raw: true,
    });
    const availableRoles = roleRows
      .map((r) => r.position)
      .filter(Boolean)
      .sort();

    /*
     * ¿Quién tiene horario propio puesto? (07/08/2026, Rodrigo)
     *
     * Desde hoy, una paciente asignada a alguien SIN horario no ve ni un hueco
     * —antes veía la agenda del centro entera, y con ella las horas de otra
     * compañera—. Es lo correcto, pero deja de serlo si nadie se entera: quien
     * asigna tiene que ver a quién le falta el horario ANTES de asignar, no
     * cuando la paciente llame diciendo que no le sale nada.
     *
     * Best-effort: si la tabla no está o falla, sale la lista sin la marca.
     */
    const conHorario = new Set();
    try {
      const { TeamMemberHours } = tenantModels;
      if (TeamMemberHours) {
        const filas = await TeamMemberHours.findAll({ attributes: ["teamMemberId"] });
        for (const f of filas) conHorario.add(String(f.teamMemberId));
      }
    } catch { /* la lista se sirve igual, sin la marca */ }

    /*
     * ¿Quién tiene cuenta del CRM pero SIN correo? (26/08/2026, Jorge: «un aviso
     * en cada integrante que tenga una cuenta del CRM diciendo que cuanto antes
     * se le asigne un correo».)
     *
     * Misma idea que la marca de arriba y por el mismo motivo: una cuenta sin
     * correo no puede recuperar su contraseña sola, y eso hoy no se ve en
     * ninguna parte —había que abrir la ficha de cada uno, de uno en uno—. El
     * día que alguien se queda fuera, la dirección se entera por teléfono.
     *
     * Se cuenta sobre TODAS las fichas con login del cliente, no solo las de
     * esta página: el rótulo de arriba dice cuántas faltan en total, y paginar
     * no puede cambiar ese número.
     *
     * Solo para quien ve la pantalla de Equipo de verdad: con la lista recortada
     * no se manda (ahí no hay ni cuentas ni nada que hacer con ellas).
     *
     * Best-effort, como la de horarios: si master falla, la lista sale igual.
     */
    const cuentaSinCorreo = new Set();
    let fichasConLogin = 0;
    if (isAdmin && !listaReducida) {
      try {
        const conLogin = await TeamMember.findAll({
          where: { userId: { [Op.ne]: null } },
          attributes: ["id", "userId"],
        });
        fichasConLogin = conLogin.length;
        if (conLogin.length) {
          const { User } = getMasterModels();
          const cuentas = await User.findAll({
            where: { id: { [Op.in]: conLogin.map((m) => m.userId) } },
            attributes: ["id", "email", "emailContacto"],
          });
          const mudas = new Set(cuentas.filter((u) => !correoDeCuenta(u)).map((u) => String(u.id)));
          for (const m of conLogin) {
            if (mudas.has(String(m.userId))) cuentaSinCorreo.add(String(m.id));
          }
        }
      } catch { /* la lista se sirve igual, sin la marca */ }
    }

    return ok({
      members: rows.map((m) => ({
        ...(listaReducida ? serializeProfesional(m) : serializeTeamMember(m, { isAdmin })),
        tieneHorario: conHorario.has(String(m.id)),
        // `true` solo si TIENE cuenta y esa cuenta no tiene a dónde escribir.
        cuentaSinCorreo: cuentaSinCorreo.has(String(m.id)),
      })),
      // Para el rótulo de arriba: cuántas de TODO el cliente, no de esta página.
      cuentasSinCorreo: cuentaSinCorreo.size,
      fichasConLogin,
      total: count,
      limit,
      offset,
      availableRoles,
      // Con la lista recortada nadie es «admin» a efectos de esta pantalla: sin
      // el módulo en sus accesos no entra en Equipo aunque tenga el rol.
      viewerIsAdmin: isAdmin && !listaReducida,
      // Que la pantalla pueda decirlo en vez de dar por hecho que lo trae todo.
      listaReducida,
    });
  } catch (err) {
    return serverError(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// POST /api/team
// ───────────────────────────────────────────────────────────────────────────
export const POST = withTenant(async (request, _ctx, { tenant, tenantModels, hasModule }) => {
  try {
    if (!hasModule("team")) return forbidden("Módulo team no activo");

    const userRole = request.headers.get("x-user-role") ?? "user";
    const userId = request.headers.get("x-user-id");
    const ip = request.headers.get("x-forwarded-for") ?? null;

    if (!ADMIN_ROLES.has(userRole)) return forbidden("Solo admin puede crear miembros");

    const { TeamMember } = tenantModels;
    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const displayName = normalizeString(body.displayName);
    if (!displayName) return error("displayName es obligatorio");

    const email = normalizeEmail(body.email);
    const role = normalizeString(body.role);
    const department = normalizeString(body.department);
    const phone = normalizeString(body.phone);
    const avatarUrl = normalizeString(body.avatarUrl);
    // Color de sus bloqueos en la agenda. Vacío = hereda el general del centro.
    const blockColor = limpiaColorBloqueo(body.blockColor);
    if (!isValidHexColor(blockColor)) return error("El color de los bloqueos tiene que ser un hex tipo #RRGGBB");
    const notes = body.notes != null ? String(body.notes) : null;
    const status = body.status ?? "active";
    const linkedUserId = body.userId || null;
    const startDate = normalizeString(body.startDate);
    const currency = (normalizeString(body.currency) ?? "EUR").toUpperCase().slice(0, 3);

    const hourlyCost = normalizeAmount(body.hourlyCost);
    const hourlyRate = normalizeAmount(body.hourlyRate);
    if (hourlyCost === undefined) return error("hourlyCost inválido");
    if (hourlyRate === undefined) return error("hourlyRate inválido");

    // Retribución: bruto anual + pagas → mensual CALCULADO (single source).
    const annualGross = normalizeAmount(body.annualGross);
    if (annualGross === undefined) return error("annualGross inválido");
    let paymentPeriods = 12;
    if (body.paymentPeriods != null && body.paymentPeriods !== "") {
      paymentPeriods = Number(body.paymentPeriods);
      if (!VALID_PERIODS.has(paymentPeriods)) return error("paymentPeriods debe ser 12 o 14");
    }
    const monthlySalary = annualGross != null ? Math.round((annualGross / paymentPeriods) * 100) / 100 : null;

    if (!VALID_STATUS.has(status)) return error("status inválido");

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return error("email inválido");
    if (await emailAlreadyUsed(TeamMember, email)) {
      return error("Ya existe un miembro con ese email", 409);
    }

    if (linkedUserId) {
      if (!(await userBelongsToTenant(linkedUserId, tenant.id))) {
        return error("userId no pertenece al tenant", 400);
      }
      if (await userAlreadyLinked(TeamMember, linkedUserId)) {
        return error("Ese userId ya está vinculado a otro miembro", 409);
      }
    }

    const member = await TeamMember.create({
      userId: linkedUserId,
      displayName,
      email,
      position: role,
      department,
      phone,
      avatarUrl,
      blockColor,
      hourlyCost,
      hourlyRate,
      annualGross,
      paymentPeriods,
      monthlySalary,
      currency,
      status,
      hiredAt: startDate,
      notes,
      specialties: normalizeSpecialties(body.specialties),
      customFields: {},
    });

    await logAudit({
      tenantId: tenant.id,
      userId,
      action: "team.created",
      entityId: member.id,
      before: null,
      after: { displayName, email, role, status, hourlyCost, hourlyRate },
      ip,
    });

    return created(serializeTeamMember(member, { isAdmin: true }));
  } catch (err) {
    return serverError(err);
  }
});
