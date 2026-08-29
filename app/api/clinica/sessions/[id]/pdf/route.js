import { withTenant } from "@/lib/tenant/withTenant.js";
import { forbidden, notFound, error, serverError } from "@/lib/utils/apiResponse.js";
import { contentDisposition } from "@/lib/documents/helpers.js";
import { buildSessionPdfBuffer, sessionPdfFilename } from "@/lib/clinica/sessionPdf.js";

/**
 * GET /api/clinica/sessions/[id]/pdf — el PDF de un REGISTRO DE SESIÓN
 * (29/08/2026, Rodrigo: «necesito que se puedan generar PDF también de los
 * Registros de Sesiones»).
 *
 * Gemela de la del informe (`reports/[id]/pdf`, 26/08/2026) y por el mismo
 * motivo: hasta hoy el registro de sesión solo se podía leer dentro del CRM.
 * Con 22.045 sesiones escritas en Aumenta, no poder sacar UNA en papel es una
 * carencia rara.
 *
 * Esta ruta NO escribe nada — ni fichero, ni fila, ni estado, ni correo — y no
 * publica el registro en ningún sitio: devuelve el PDF a quien ya podía leer la
 * sesión en pantalla. Por eso tampoco lleva el guard de la demo (no manda
 * correo, no gasta IA y no toca master).
 *
 * Sale `inline` para que se abra en una pestaña; con `?descargar=1` baja como
 * fichero, que es lo que hace falta para mandárselo a alguien por otro camino.
 *
 * Lo que el PDF NO imprime está decidido en `lib/clinica/sessionPdf.js`: la
 * preparación, sus adjuntos, las notas internas y la transcripción del audio
 * son material interno del equipo.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** La misma puerta que el resto del registro clínico: Clínica, o Pacientes. */
function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

export const GET = withTenant(async (request, rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido", 422);

    const { ClinicSession, Patient, TeamMember } = ctx.tenantModels;
    const session = await ClinicSession.findByPk(id, {
      include: [{ model: TeamMember, as: "therapist", attributes: ["id", "displayName"] }],
    });
    if (!session) return notFound("Sesión no encontrada");

    // El paciente va aparte: `ClinicSession` no lo trae asociado en todos los
    // sitios y aquí solo hace falta su nombre para la ficha de datos.
    const patient = await Patient.findByPk(session.patientId, { attributes: ["id", "firstName", "lastName"] });
    const patientName = `${patient?.firstName ?? ""} ${patient?.lastName ?? ""}`.trim();

    let buffer;
    try {
      buffer = await buildSessionPdfBuffer({
        session,
        patientName,
        therapistName: session.therapist?.displayName ?? null,
        tenantName: ctx.tenant.name,
        brand: ctx.tenant.settings?.brand ?? {},
        // Para caer a las plantillas DEL CENTRO cuando el registro no trae su
        // propia foto de apartados: todo lo escrito antes del 29/08/2026.
        tenant: ctx.tenant,
      });
    } catch (err) {
      process.stderr.write(`[clinica:pdf] PDF de sesión falló: ${err.message}\n`);
      return error("No se pudo generar el PDF del registro", 500);
    }

    const { searchParams } = new URL(request.url);
    const comoSale = searchParams.get("descargar") ? "attachment" : "inline";

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition(comoSale, sessionPdfFilename(session, patientName)),
        "Content-Length": String(buffer.length),
        "X-Content-Type-Options": "nosniff",
        // Lleva datos de salud: ni un intermediario ni el navegador deben
        // guardarlo. Igual que el PDF del informe.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
