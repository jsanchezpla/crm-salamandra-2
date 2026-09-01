import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { logCitasAudit } from "../../../../../../lib/citas/audit.js";
import { apartadosConPlantillas, plantillasDe } from "../../../../../../lib/clinica/plantillas.js";
import {
  DOC_ACTA,
  actaVacia,
  bloquesDelActa,
  limpiarActa,
  puedeTenerActa,
} from "../../../../../../lib/reuniones/acta.js";

/**
 * EL ACTA de una reunión de equipo (01/09/2026, Aumenta por Rodrigo).
 *
 *   GET /api/citas/bloqueos/[id]/acta   el acta y con qué apartados se escribe
 *   PUT /api/citas/bloqueos/[id]/acta   guardarla (o borrarla, si va en blanco)
 *
 * ── EL ENCARGO ──────────────────────────────────────────────────────────────
 * «Implantar una plantilla para actas de reunión para que las haga directamente
 * el CRM a través de un audio o unas notas que le suba, como los registros de
 * sesión. Esas actas de reunión son para la categoría de Reunión de equipo.»
 *
 * Esta ruta es la mitad que GUARDA. La que redacta con IA es su hermana
 * `acta/redactar`, y no escribe nada: propone, y una persona confirma. Mismo
 * reparto que en el registro de sesión (`/api/clinica/sessions/transcribe`), y
 * por la misma razón — la IA no firma actas.
 *
 * ── GATE ────────────────────────────────────────────────────────────────────
 * `citas`, el mismo que el bloqueo del que cuelga. NO `clinica`: un acta de
 * equipo no tiene paciente y un centro sin módulo clínico también hace
 * reuniones. Reutiliza `lib/clinica/plantillas.js` porque ahí vive el editor de
 * plantillas, no porque el acta sea clínica.
 *
 * ── SOLO LAS REUNIONES DE EQUIPO ────────────────────────────────────────────
 * Un bloqueo de vacaciones o de descanso no tiene acta, y decirlo con un 409 y
 * no con un 404 es a propósito: el tramo existe, lo que no procede es el acta.
 * Si alguien cambia la categoría del bloqueo después de escribir el acta, esta
 * NO se borra —el texto es del centro— pero deja de poder editarse desde aquí
 * hasta que vuelva a ser una reunión.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function gate(ctx) {
  if (!ctx.hasModule("citas")) return forbidden("Módulo citas no activo");
  return null;
}

/**
 * Los apartados con los que se escribe ESTE acta: la foto que guardó el acta si
 * ya la tiene, y si no la plantilla del centro. Es la misma regla que el
 * informe y el registro: un acta de hace un año se sigue leyendo con SUS
 * títulos aunque la plantilla haya cambiado entera después.
 */
function apartadosDelBloqueo(bloqueo, tenant) {
  return apartadosConPlantillas(bloqueo.actaSections, plantillasDe(tenant, DOC_ACTA));
}

async function cargar(tenantModels, id) {
  if (!UUID_RE.test(String(id ?? ""))) return null;
  const { TeamBlock } = tenantModels;
  if (!TeamBlock) return null;
  return TeamBlock.findByPk(id);
}

export const GET = withTenant(async (_request, { params }, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;

    const { id } = await params;
    const bloqueo = await cargar(ctx.tenantModels, id);
    if (!bloqueo) return notFound("Bloqueo no encontrado");

    const apartados = apartadosDelBloqueo(bloqueo, ctx.tenant);
    return ok({
      // Se devuelve aunque la categoría ya no sea Reunión de equipo: lo escrito
      // se lee siempre. `puedeEditarse` es lo que decide si la pantalla enseña
      // el cajón o solo el texto.
      puedeEditarse: puedeTenerActa(bloqueo),
      acta: bloqueo.actaSections ?? null,
      transcripcion: bloqueo.actaTranscript ?? null,
      actualizada: bloqueo.actaUpdatedAt ?? null,
      bloques: bloquesDelActa(apartados),
      plantillas: plantillasDe(ctx.tenant, DOC_ACTA),
    });
  } catch (err) {
    return serverError(err);
  }
});

export const PUT = withTenant(async (request, { params }, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;

    const { id } = await params;
    const bloqueo = await cargar(ctx.tenantModels, id);
    if (!bloqueo) return notFound("Bloqueo no encontrado");
    if (!puedeTenerActa(bloqueo)) {
      return error("Solo los bloqueos de la categoría «Reunión de equipo» llevan acta", 409);
    }

    const body = await request.json().catch(() => ({}));

    /*
     * Los apartados los manda la PANTALLA, igual que en el registro de sesión:
     * es quien sabe qué plantilla se ha elegido y qué apartado suelto se ha
     * añadido a mano para esta reunión. Sin ellos se usan los de la plantilla
     * del centro (o los de fábrica), nunca una lista vacía.
     */
    const apartados = Array.isArray(body.apartados) && body.apartados.length
      ? body.apartados
      : apartadosDelBloqueo(bloqueo, ctx.tenant);
    const bloques = bloquesDelActa(apartados);
    const acta = limpiarActa(body.acta, bloques);

    /*
     * Guardar un acta en blanco es BORRARLA. Es lo que espera quien vacía todos
     * los campos y pulsa guardar, y evita dejar en la base un JSONB con cinco
     * cadenas vacías que luego la agenda tendría que distinguir de «no hay».
     * La transcripción se va con ella: sin acta, guardar de qué texto salía es
     * quedarse con la grabación de una reunión y nada más.
     */
    const vacia = actaVacia(acta);
    const transcripcion = String(body.transcripcion ?? "").trim().slice(0, 200_000);

    await bloqueo.update({
      actaSections: vacia ? null : acta,
      actaTranscript: vacia ? null : transcripcion || bloqueo.actaTranscript || null,
      actaUpdatedAt: vacia ? null : new Date(),
    });

    await logCitasAudit({
      tenantId: ctx.tenant.id,
      userId: ctx.user?.id ?? null,
      // Prefijo `citas.` como el resto de acciones de bloqueos: es lo que hace
      // que la Actividad las clasifique en Citas y no en «Otros».
      action: vacia ? "citas.bloqueo_acta_borrada" : "citas.bloqueo_acta_guardada",
      entity: "TeamBlock",
      entityId: bloqueo.id,
      // Un RESUMEN, nunca el acta entera: en master no se duplica lo que se
      // dice de familias y compañeros en una reunión de equipo (regla de
      // auditoría de CLAUDE.md).
      after: vacia
        ? null
        : {
            apartadosConTexto: bloques.filter((b) => String(acta[b.key] ?? "").trim()).length,
            conTranscripcion: Boolean(transcripcion),
          },
    });

    return ok({ acta: vacia ? null : acta, actualizada: vacia ? null : bloqueo.actaUpdatedAt });
  } catch (err) {
    return serverError(err);
  }
});
