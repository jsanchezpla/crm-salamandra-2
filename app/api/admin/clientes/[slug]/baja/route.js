import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { isDemoTenant } from "../../../../../../lib/demo/isDemo.js";
import { esSlugDemo } from "../../../../../../lib/demo/demos.js";
import { radiografiaParaBaja, darDeBajaTenant } from "../../../../../../lib/provisioning/bajaTenant.js";
import { auditar, datosPeticion } from "../../../../../../lib/utils/auditoria.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * Cerrar la cuenta de un cliente desde el back-office.
 *
 * GET  → QUÉ hay dentro (tablas con filas, usuarios, módulos, ficheros). Solo
 *        lee, y es lo que la pantalla enseña ANTES de pedir nada.
 * POST → lo aparta. `{ confirmo: "<slug>", conDatos: true }`.
 *
 * ── POR QUÉ ES UN POST Y NO UN DELETE ───────────────────────────────────────
 * Hace falta mandar cuerpo (el slug tecleado y la aceptación de que hay datos
 * dentro), y un DELETE con cuerpo es de las cosas que un proxy puede tirar por
 * el camino sin decir nada. Este pasa por nginx.
 *
 * Y hay un motivo mejor: esto NO es un borrado. Aparta al cliente y se puede
 * deshacer. `app/api/admin/clientes/[slug]/route.js` sigue sin tener DELETE, y
 * la purga —que sí destruye— sigue siendo SSH y no tiene endpoint ninguno.
 *
 * ── LOS CANDADOS ────────────────────────────────────────────────────────────
 * Los tres del alta (módulo `provisioning`, rol admin fresco de BD, nunca desde
 * una demo) y tres más que solo tienen sentido aquí:
 *   · hay que TECLEAR el identificador del cliente, como al suspender;
 *   · si tiene datos dentro hay que aceptarlo a propósito, y se enseña cuántos;
 *   · no se puede dar de baja al tenant desde el que estás trabajando, ni a una
 *     demo (que se rehacen con su script, no se cierran).
 */
function candado(ctx) {
  if (!ctx.hasModule("provisioning")) return forbidden("Este panel es solo para Salamandra Solutions");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo admin");
  if (isDemoTenant(ctx)) return forbidden("No disponible en la demo");
  return null;
}

function comprobarDestino(slug, ctx) {
  if (!slug || !/^[a-z0-9_]+$/.test(slug)) return error("Cliente no encontrado", 404);
  if (slug === ctx.slug) {
    return error(
      "No puedes dar de baja el tenant desde el que estás trabajando: te quedarías sin back-office y sin forma de volver.",
      409
    );
  }
  if (esSlugDemo(slug)) {
    return error(
      "Las demos no se dan de baja: se rehacen con scripts/crear-demos-por-oficio.js. Darlas de baja dejaría el botón público de la web apuntando a un cliente que ya no existe.",
      409
    );
  }
  return null;
}

export const GET = withTenant(async (_request, { params }, ctx) => {
  try {
    const veto = candado(ctx);
    if (veto) return veto;

    const { slug } = await params;
    const malDestino = comprobarDestino(slug, ctx);
    if (malDestino) return malDestino;

    const rx = await radiografiaParaBaja(slug);
    if (rx.error) return error(rx.error, 404);

    return ok({
      slug,
      nombre: rx.tenant.nombre,
      estado: rx.tenant.estado,
      alta: rx.tenant.alta,
      tablas: rx.tablas,
      usuarios: rx.usuarios.map((u) => ({ email: u.email, rol: u.rol })),
      modulos: rx.modulos,
      filas: rx.filasTotales,
      // Las diez con más filas: cuarenta nombres de tabla no ayudan a decidir.
      datos: rx.conDatos.slice(0, 10),
      tablasConDatos: rx.conDatos.length,
      ficheros: rx.ficheros,
    });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, { params }, ctx) => {
  try {
    const veto = candado(ctx);
    if (veto) return veto;

    const { slug } = await params;
    const malDestino = comprobarDestino(slug, ctx);
    if (malDestino) return malDestino;

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const res = await darDeBajaTenant({
      slug,
      confirmo: String(body?.confirmo ?? "").trim(),
      conDatos: body?.conDatos === true,
      // Desde el panel NUNCA a nosotros mismos, ni pidiéndolo: eso solo se puede
      // por SSH, con la bandera larga que hay que escribir entera.
      permitirNosotros: false,
    });
    if (res.error) {
      // 428 lleva además QUÉ hay dentro, para que la pantalla pueda enseñarlo
      // en vez de repetir «tiene datos» sin decir cuáles.
      return error(res.error, res.status ?? 400, res.conDatos ?? null);
    }

    // Rastro. Va a nombre de NOSOTROS porque el tenant al que se refiere ya no
    // existe y una FK a una fila borrada no se puede guardar. `entityId` guarda
    // su UUID, que es lo que permite encontrarlo después.
    const { userId, ip } = datosPeticion(request);
    await auditar({
      tenantId: ctx.tenant.id,
      userId,
      action: "provisioning.cliente_baja",
      entity: "Tenant",
      entityId: res.tenantId,
      before: {
        slug,
        nombre: res.nombre,
        modulos: res.modulos,
        usuarios: res.usuarios,
        filas: res.filas,
        ficheros: res.ficheros.movidos,
      },
      after: { schemaApartado: res.schemaApartado, rollback: res.rollback, desde: "panel" },
      ip,
    });

    return ok(res);
  } catch (err) {
    return serverError(err);
  }
});
