import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound } from "../../../../lib/utils/apiResponse.js";
import { handleRouteError } from "../../../../lib/utils/errors.js";
import { esPeticionDeCalendario } from "../../../../lib/auth/backoffice.js";
import { isDemoTenant } from "../../../../lib/demo/isDemo.js";
import { leerEventos } from "../../../../lib/calendario-global/eventos.js";
import { fechaDeParametro } from "../../../../lib/calendario-global/fechas.js";

const SLUG = /^[a-z0-9_]+$/;

/**
 * GET /api/calendario-global/eventos?start&end[&slugs=a,b][&proyectos=0] — los
 * eventos de los clientes elegidos (03/09/2026; clientes elegidos y Proyectos
 * desde el 12/09/2026, Rodrigo).
 *
 *   · `slugs` ausente → todos los que la cuenta puede ver; `slugs=` vacío →
 *     ninguno (la pantalla con todo oculto no lee ninguna base). Un slug sin
 *     acceso se ignora en silencio.
 *   · `proyectos=0` → sin tarjetas ni hitos de Proyectos.
 *
 * Solo existe en CALENDAR_HOST (middleware.js, y aquí otra vez: 404 fuera).
 * `withTenant` da aquí el contexto del tenant PROPIO de la cuenta —el de su
 * sesión—, que solo se usa para saber quién es (fresco de BD) y para vetar la
 * demo: qué clientes ve lo decide lib/calendario-global/acceso.js.
 */
const leer = withTenant(async (request, _rc, ctx) => {
  try {
    // La demo es pública y da sesión de admin a cualquiera: aquí no entra.
    if (isDemoTenant(ctx)) return forbidden("No disponible en la demo");
    if (!ctx.user?.id) return forbidden();

    const { searchParams } = new URL(request.url);
    // `start` y `end` se validan AQUÍ, antes de leer ninguna base (12/09/2026,
    // hallazgo 7): `start=2026-13-01` llegaba a la consulta de cada cliente,
    // fallaba en todos y la pantalla los pintaba todos «no responde». Se acepta
    // `YYYY-MM-DD` o un ISO con hora, del que se toma la fecha (lo que ya hace
    // la pantalla). Ausentes o vacíos, como hasta ahora.
    const crudoStart = searchParams.get("start");
    const crudoEnd = searchParams.get("end");
    const start = crudoStart ? fechaDeParametro(crudoStart) : null;
    const end = crudoEnd ? fechaDeParametro(crudoEnd) : null;
    if (crudoStart && !start) return error("Fecha de inicio inválida");
    if (crudoEnd && !end) return error("Fecha de fin inválida");
    const slugs = searchParams.has("slugs")
      ? (searchParams.get("slugs") ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter((s) => SLUG.test(s))
      : null;
    const proyectos = searchParams.get("proyectos") !== "0";

    const datos = await leerEventos({ usuarioId: ctx.user.id, start, end, slugs, proyectos });
    return ok(datos);
  } catch (err) {
    return handleRouteError(err);
  }
});

export const GET = (request, rc) => (esPeticionDeCalendario(request) ? leer(request, rc) : notFound());
