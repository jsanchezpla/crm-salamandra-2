import { NextResponse } from "next/server";
import { withTenant } from "../../../lib/tenant/withTenant.js";
import { ok, created, forbidden } from "../../../lib/utils/apiResponse.js";
import { ValidationError } from "../../../lib/utils/errors.js";
import { handleRouteError } from "../../../lib/utils/errors.js";
import { aceptaEtapa, etapasDe } from "../../../lib/leads/embudos.js";
import { getTenantContext } from "../../../lib/tenant/tenantResolver.js";
import { Op } from "sequelize";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const ADMIN_DENY = "Solo administradores pueden modificar leads";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-tenant",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * El reparto de leads por etapa, contado en la base de datos.
 *
 * NACE DE UN FALLO QUE ESTABA EN LOS OCHO OVERRIDES (12/08/2026). Cada uno
 * calculaba sus contadores con un `reduce` sobre la lista que acababa de
 * recibir — y esa lista viene FILTRADA. Al pulsar una etapa, las demás caían a
 * cero y el «X en total» de la cabecera se contagiaba. Solo se notaba con el
 * embudo lleno, así que la tarea del backlog nombraba tres clientes; el fallo
 * estaba en los ocho.
 *
 * Se cuenta con el MISMO `where` que la lista pero **sin la etapa**: los demás
 * filtros (búsqueda, empresa, motivo, promo) sí tienen que afectar al desglose,
 * porque describen el conjunto que se está mirando. La etapa no, porque es
 * justamente lo que el desglose sirve para elegir.
 *
 * ── POR QUÉ SE RESTA EN VEZ DE EXCLUIR ──────────────────────────────────────
 * `excluirOrigen` existe por abarcaia y quality-energy, que apartan de su
 * embudo los leads que entraron por el formulario de referidos. En vez de un
 * `NOT (custom_fields @> ...)`, que en una fila con `custom_fields` a NULL
 * devuelve NULL y borraría ese lead de la cuenta sin que se note, se cuenta dos
 * veces con `@>` —que es positivo y por tanto seguro con NULL— y se resta. Sale
 * el mismo número y no hay forma de que una fila vieja desaparezca en silencio.
 */
/**
 * ¿Este cliente usa de verdad los campos heredados del embudo de Aumenta?
 *
 * `motivo` (diagnóstico / servicios / cursos / talleres), `tipo_usuario`
 * (ciudadano / profesional) y el detalle que cuelga de ellos son columnas de
 * `Lead` para TODOS los tenants, y la tabla pintaba sus tres columnas siempre.
 * En un CRM de booking eso son tres columnas fijas en «—» y un filtro «Todos
 * los motivos» que no filtra nada, con valores —«diagnóstico»— que ahí no
 * significan nada.
 *
 * Se responde con datos y no con módulos a propósito. Se midió en producción
 * (25/08/2026) y la regla por módulos no valía: `spain_enzymes` y `retorika`
 * tienen `tipo_usuario` relleno y NINGÚN módulo clínico ni de formación, así
 * que gatear por módulo les habría escondido un dato que sí usan. Es además el
 * criterio que este mismo módulo ya aplica a las ofertas de empleo: se enseña
 * si lo hay, no si lo compraste.
 *
 * Va DENTRO del `if (desglose)` porque son tres `count` más y solo las necesita
 * la pantalla; el exportador y el buscador del panel no las piden.
 *
 * Se cuenta sobre TODA la tabla, sin el `where` de los filtros: si se contara
 * sobre lo filtrado, acotar por etapa haría desaparecer una columna a media
 * sesión.
 */
async function camposConDatos(Lead) {
  const hay = async (where) => (await Lead.count({ where })) > 0;
  const [motivo, detalle] = await Promise.all([
    hay({ motivo: { [Op.ne]: null } }),
    hay({
      [Op.or]: [
        { servicio: { [Op.ne]: null } },
        { curso: { [Op.ne]: null } },
        { taller: { [Op.ne]: null } },
      ],
    }),
  ]);
  return { motivo, detalle };
}

async function desglosePorEtapa(Lead, whereSinEtapa, excluirOrigen) {
  const contar = async (where) => {
    const filas = await Lead.findAll({
      where,
      attributes: ["stage", [Lead.sequelize.fn("COUNT", Lead.sequelize.col("id")), "n"]],
      group: ["stage"],
      raw: true,
    });
    return Object.fromEntries(filas.map((f) => [f.stage, Number(f.n)]));
  };

  const todos = await contar(whereSinEtapa);
  if (!excluirOrigen) return todos;

  const fuera = await contar({
    ...whereSinEtapa,
    customFields: { [Op.contains]: { source: excluirOrigen } },
  });
  const neto = {};
  for (const [etapa, n] of Object.entries(todos)) {
    const restante = n - (fuera[etapa] ?? 0);
    if (restante > 0) neto[etapa] = restante;
  }
  return neto;
}

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("leads")) return forbidden();

  const { Lead } = tenantModels;
  const { searchParams } = new URL(request.url);

  const where = {};
  const stage = searchParams.get("stage");
  const search = searchParams.get("search");
  const empresa = searchParams.get("empresa");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "100"), 200);
  const offset = parseInt(searchParams.get("offset") ?? "0");

  const motivo = searchParams.get("motivo");
  const promo = searchParams.get("promo");

  if (motivo) where.motivo = motivo;
  if (promo) where.metadata = { [Op.contains]: { promo } };
  if (empresa) where.customFields = { [Op.contains]: { empresa } };
  if (search) {
    where[Op.or] = [
      { name: { [Op.iLike]: `%${search}%` } },
      { email: { [Op.iLike]: `%${search}%` } },
      { phone: { [Op.iLike]: `%${search}%` } },
      { title: { [Op.iLike]: `%${search}%` } },
    ];
  }

  // Se guarda ANTES de meter la etapa: es el conjunto que el desglose describe.
  const whereSinEtapa = { ...where };
  if (stage) where.stage = stage;

  const { rows, count } = await Lead.findAndCountAll({
    where,
    limit,
    offset,
    order: [["createdAt", "DESC"]],
  });

  // Solo cuando se pide, que son dos consultas más. Los demás consumidores del
  // endpoint —exportar, el buscador del panel— no las necesitan.
  let desglose = null;
  let totalSinEtapa = null;
  let campos = null;
  if (searchParams.get("desglose") === "1") {
    const excluir = searchParams.get("excluirOrigen");
    // Whitelist estrecha: es un valor que se compara dentro de un JSONB y no
    // hay motivo para que lleve nada más.
    const origen = excluir && /^[a-z0-9_]{1,40}$/.test(excluir) ? excluir : null;
    desglose = await desglosePorEtapa(Lead, whereSinEtapa, origen);
    totalSinEtapa = Object.values(desglose).reduce((a, b) => a + b, 0);
    campos = await camposConDatos(Lead);
  }

  return ok({ leads: rows, total: count, desglose, totalSinEtapa, campos });
});

export async function POST(request) {
  try {
    const ctx = await getTenantContext(request);
    const role = request.headers.get("x-user-role");
    if (!ADMIN_ROLES.has(role)) {
      return NextResponse.json(
        { ok: false, error: ADMIN_DENY },
        { status: 403, headers: CORS_HEADERS }
      );
    }
    const { Lead } = ctx.tenantModels;

    const body = await request.json();

    const {
      name,
      phone,
      email,
      title,
      stage,
      probability,
      value,
      expectedCloseDate,
      assignedTo,
      notes,
      customFields,
      tipo_usuario,
      motivo,
      servicio,
      curso,
      taller,
      mensaje,
      message,
      source,
      promo,
      metadata,
    } = body;

    if (!name && !title) {
      return NextResponse.json(
        { ok: false, error: "Se requiere nombre o título del lead" },
        { status: 422, headers: CORS_HEADERS }
      );
    }

    const resolvedMetadata = metadata ?? {};
    if (promo) resolvedMetadata.promo = promo;

    /*
     * La etapa, contra el embudo de este cliente (26/08/2026).
     *
     * Esta puerta no validaba NADA: `stage` entraba del cuerpo tal cual y
     * `Lead.stage` es un texto de 50 sin enum, así que cabía cualquier cosa. Era
     * la más abierta de las cuatro por las que puede entrar una etapa.
     *
     * Sin `stage` se nace en `new`, que está en todos los embudos.
     */
    if (stage !== undefined && stage !== null && !aceptaEtapa(ctx.slug, stage, ctx.hasModule)) {
      return NextResponse.json(
        {
          ok: false,
          error: `«${stage}» no es una etapa de este embudo. Las suyas: ${etapasDe(ctx.slug, ctx.hasModule).join(", ")}.`,
        },
        { status: 422, headers: CORS_HEADERS }
      );
    }

    const VALID_TIPO_USUARIO = ["ciudadano", "profesional"];
    const VALID_MOTIVO = ["diagnostico", "servicios", "cursos", "talleres"];

    const lead = await Lead.create({
      name: name?.trim() ?? null,
      phone: phone?.trim() ?? null,
      email: email?.trim().toLowerCase() || null,
      title: title?.trim() ?? name?.trim() ?? null,
      stage: stage ?? "new",
      probability: probability ?? null,
      value: value ?? null,
      expectedCloseDate: expectedCloseDate ?? null,
      assignedTo: assignedTo ?? null,
      notes: notes ?? null,
      customFields: customFields ?? {},
      tipo_usuario: VALID_TIPO_USUARIO.includes(tipo_usuario) ? tipo_usuario : null,
      motivo: VALID_MOTIVO.includes(motivo) ? motivo : null,
      servicio: servicio?.trim() ?? null,
      curso: curso?.trim() ?? null,
      taller: taller?.trim() ?? null,
      mensaje: mensaje?.trim() ?? message?.trim() ?? null,
      source: source?.trim() ?? null,
      metadata: resolvedMetadata,
    });

    return NextResponse.json({ ok: true, data: lead }, { status: 201, headers: CORS_HEADERS });
  } catch (err) {
    const response = handleRouteError(err);
    response.headers.set("Access-Control-Allow-Origin", "*");
    return response;
  }
}
