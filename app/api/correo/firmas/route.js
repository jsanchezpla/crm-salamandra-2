import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../lib/utils/apiResponse.js";
import { ForbiddenError, ValidationError } from "../../../../lib/utils/errors.js";
import { auditar, datosPeticion } from "../../../../lib/utils/auditoria.js";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { normalizarFirmaEntrada } from "../../../../lib/correo/composicion.js";

/**
 * /api/correo/firmas — el pie de firma de cada persona del equipo.
 *
 * Pedido por Rodrigo el 26/08/2026: «poder crear pies de firma (ya sea ahí o
 * subiendo una imagen/html) para cada persona del equipo y adjuntarlos de forma
 * automática».
 *
 * ── QUIÉN PUEDE TOCAR QUÉ ──────────────────────────────────────────────────
 *   · Cada persona ve y edita SU firma (la de su cuenta).
 *   · Admin además puede ver y editar la de cualquiera del centro: es quien
 *     «crea los pies de firma para cada persona del equipo» sin esperar a que
 *     cada una entre a hacérselo.
 *
 * La firma viaja saneada (lib/correo/composicion.js) y se guarda con su versión
 * de texto derivada, para que el correo HTML y el plano digan lo mismo. El
 * adjuntado automático vive en el envío (`/api/correo/envios`), no aquí.
 */

const ROLES_ADMIN = new Set(["admin", "owner", "superadmin"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function puedeUsarCorreo(ctx) {
  return ctx.hasModule("clients") || ctx.hasModule("outreach");
}

function esAdmin(ctx) {
  return ROLES_ADMIN.has(String(ctx.user?.role ?? ""));
}

/**
 * A quién apunta la petición: uno mismo, o —solo admin— otra cuenta DEL MISMO
 * centro. La comprobación contra master.users es la que impide que un admin
 * edite firmas de otro tenant cambiando el UUID.
 */
async function usuarioObjetivo(ctx, pedido) {
  const yo = String(ctx.user?.id ?? "");
  if (!pedido || pedido === yo) return yo;
  if (!esAdmin(ctx)) throw new ForbiddenError();
  if (!UUID_RE.test(pedido)) throw new ValidationError("Usuario inválido");
  const { User } = getMasterModels();
  const existe = await User.findOne({ where: { id: pedido, tenantId: ctx.tenant.id }, attributes: ["id"] });
  if (!existe) throw new ValidationError("Esa cuenta no es de este centro");
  return pedido;
}

export const GET = withTenant(async (request, _rc, ctx) => {
  if (!puedeUsarCorreo(ctx)) throw new ForbiddenError();

  const sp = new URL(request.url).searchParams;
  const objetivo = await usuarioObjetivo(ctx, (sp.get("usuario") || "").trim() || null);

  const { CorreoFirma } = ctx.tenantModels;
  const fila = objetivo ? await CorreoFirma.findOne({ where: { userId: objetivo } }) : null;

  const respuesta = {
    firma: fila
      ? {
          html: fila.html ?? "",
          texto: fila.texto ?? "",
          imagen: fila.imagen ?? null,
          actualizadaEn: fila.updatedAt,
          actualizadaPor: fila.updatedBy ?? null,
        }
      : null,
    puedeGestionarEquipo: esAdmin(ctx),
  };

  // Al admin se le da además la lista del equipo, para el desplegable de «la
  // firma de quién». Sin las cuentas solo-backoffice: esas no escriben correos.
  if (esAdmin(ctx)) {
    try {
      const { User } = getMasterModels();
      const cuentas = await User.findAll({
        where: { tenantId: ctx.tenant.id },
        attributes: ["id", "email", "soloBackoffice"],
        order: [["email", "ASC"]],
      });
      const conFirma = new Set((await CorreoFirma.findAll({ attributes: ["userId"] })).map((f) => f.userId));
      respuesta.usuarios = cuentas
        .filter((u) => !u.soloBackoffice)
        .map((u) => ({ id: u.id, email: u.email, tieneFirma: conFirma.has(u.id) }));
    } catch {
      // Sin la lista se puede vivir: la pantalla edita entonces solo la propia.
    }
  }

  return ok(respuesta);
});

export const PUT = withTenant(async (request, _rc, ctx) => {
  if (!puedeUsarCorreo(ctx)) throw new ForbiddenError();

  let body;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError("Body inválido");
  }

  const objetivo = await usuarioObjetivo(ctx, String(body?.usuarioId ?? "").trim() || null);
  if (!objetivo) throw new ValidationError("No se sabe de quién es la firma");

  const firma = normalizarFirmaEntrada({ html: body?.html, imagen: body?.imagen ?? null });
  if (firma.error) throw new ValidationError(firma.error);

  const { CorreoFirma } = ctx.tenantModels;
  const peticion = datosPeticion(request);

  // Sin contenido ninguno, guardar equivale a quitar la firma.
  if (!firma.html && !firma.imagen) {
    const borradas = await CorreoFirma.destroy({ where: { userId: objetivo } });
    if (borradas) {
      await auditar({
        tenantId: ctx.tenant.id,
        ...peticion,
        action: "correo.firma_borrada",
        entity: "correo_firma",
        entityId: objetivo,
      });
    }
    return ok({ firma: null });
  }

  const [fila] = await CorreoFirma.upsert({
    userId: objetivo,
    html: firma.html,
    texto: firma.texto,
    imagen: firma.imagen,
    updatedBy: ctx.user?.email ?? null,
  });

  await auditar({
    tenantId: ctx.tenant.id,
    ...peticion,
    action: "correo.firma_actualizada",
    entity: "correo_firma",
    entityId: objetivo,
    after: { conHtml: !!firma.html, conImagen: !!firma.imagen },
  });

  return ok({
    firma: {
      html: fila.html ?? "",
      texto: fila.texto ?? "",
      imagen: fila.imagen ?? null,
      actualizadaEn: fila.updatedAt,
    },
  });
});
