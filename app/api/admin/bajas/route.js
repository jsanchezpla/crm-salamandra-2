import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { isDemoTenant } from "../../../../lib/demo/isDemo.js";
import { listarBajas, eliminarBaja } from "../../../../lib/provisioning/bajaTenant.js";
import { auditar, datosPeticion } from "../../../../lib/utils/auditoria.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * Las cuentas cerradas, y su segundo acto.
 *
 * GET    → qué queda apartado de cada baja (schema, ficheros, red de rescate).
 * DELETE → lo elimina del todo. Irreversible.
 *
 * ── POR QUÉ ESTO ES UN ENDPOINT APARTE Y NO CUELGA DE `clientes/[slug]` ─────
 * Porque a estas alturas el cliente YA NO EXISTE: la baja le borró sus filas de
 * `master`, así que no hay ficha de la que colgar esto. Lo que queda es un
 * schema apartado y una carpeta, y se identifican por el par slug+sello — dos
 * bajas del mismo cliente son dos cosas distintas y se eliminan por separado.
 *
 * ── LA DECISIÓN QUE CAMBIÓ, Y LA QUE NO ────────────────────────────────────
 * Hasta el 13/08/2026 eliminar solo se podía por SSH. Rodrigo pidió poder
 * hacerlo también desde aquí. Lo que hace que eso no contradiga a
 * `cicloVida.js` —«un botón que borra los datos de un cliente es un accidente
 * esperando su turno»— es que este botón NO puede tocar a un cliente: solo
 * alcanza lo que ya está dado de baja. Para llegar hasta él hay que haber
 * cerrado la cuenta antes, tecleando el identificador, y volver a teclearlo
 * aquí reconociendo que se destruyen sus facturas.
 *
 * El detalle de qué se destruye y qué no, en lib/provisioning/bajaTenant.js.
 */
function candado(ctx) {
  if (!ctx.hasModule("provisioning")) return forbidden("Este panel es solo para Salamandra Solutions");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo admin");
  if (isDemoTenant(ctx)) return forbidden("No disponible en la demo");
  return null;
}

export const GET = withTenant(async (_request, _rc, ctx) => {
  try {
    const veto = candado(ctx);
    if (veto) return veto;
    return ok({ bajas: await listarBajas() });
  } catch (err) {
    return serverError(err);
  }
});

export const DELETE = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = candado(ctx);
    if (veto) return veto;

    // El cuerpo va en la URL y no en el body: un DELETE con cuerpo es de las
    // cosas que un proxy puede tirar por el camino sin decir nada, y esto pasa
    // por nginx. Son tres valores cortos.
    const url = new URL(request.url);
    const slug = String(url.searchParams.get("slug") ?? "").trim();
    const sello = String(url.searchParams.get("sello") ?? "").trim();
    const confirmo = String(url.searchParams.get("confirmo") ?? "").trim();
    const acepta = url.searchParams.get("facturas") === "destruir";

    const res = await eliminarBaja({
      slug,
      sello,
      confirmo,
      entiendoQueSeDestruyenSusFacturas: acepta,
    });
    if (res.error) return error(res.error, res.status ?? 400);

    // Rastro. Es lo ÚNICO que queda de este cliente cuando termina esta
    // petición, así que se guarda con detalle: qué se destruyó y quién lo pidió.
    const { userId, ip } = datosPeticion(request);
    await auditar({
      tenantId: ctx.tenant.id,
      userId,
      action: "provisioning.cliente_eliminado",
      entity: "Tenant",
      entityId: null,
      before: {
        slug: res.slug,
        baja: res.sello,
        schema: res.schemaDestruido,
        tablas: res.tablas,
        ficheros: res.ficheros,
        redes: res.redes,
      },
      after: { desde: "panel", irreversible: true },
      ip,
    });

    return ok(res);
  } catch (err) {
    return serverError(err);
  }
});
