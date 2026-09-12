import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion } from "../../../../../../lib/utils/auditoria.js";
import { puedeDarBonos } from "../../../../../../lib/citas/quienDaBonos.js";
import { resolveCurrentTeamMemberId } from "../../../../../../lib/team/currentTeamMember.js";
import { clientIdOfPatient } from "../../../../../../lib/clinica/patientClient.js";
import { serializeReport } from "../../../../../../lib/clinica/serialize.js";
import { CLAVE_PLANTILLA } from "../../../../../../lib/clinica/plantillas.js";
import { TIPO_DIAGNOSTICO } from "../../../../../../lib/clinica/pruebasDiagnosticas.js";
import { UUID_RE } from "../../../../../../lib/clinica/diagnosticoFila.js";
import { tablaAusente } from "../../../../../../lib/clinica/diagnosticoDb.js";
import { ESTADOS_TERMINADOS } from "../../../../../../lib/clinica/registroDeDiagnostico.js";
import { registrosDe, informeDe, fichaDeExpediente } from "../../../../../../lib/clinica/registrosDelExpediente.js";

/**
 * POST /api/clinica/diagnosticos/[id]/informe — CREAR el informe de valoración
 * diagnóstica de un expediente (12/09/2026, segunda entrega; Rodrigo con Isa,
 * Aumenta: «los registros… que al final se unen con IA en el informe
 * completo»).
 *
 * Es el PRIMER paso de «Unir en informe», y no inventa nada: nace un
 * `clinical_reports` de tipo `diagnostico` —la plantilla de fábrica de 25
 * apartados de `pruebasDiagnosticas.js`— vacío, con `sourceSessionIds` = los
 * registros ya TERMINADOS del expediente (registrados o cerrados; un borrador
 * no es material) y `diagnosticoId` para que el editor sepa de qué expediente
 * viene. El segundo paso (`/unir`) es el que llama a la IA.
 *
 * ── UNA SOLA VEZ ───────────────────────────────────────────────────────────
 * El expediente guarda `informe_id`: si ya tiene informe, se devuelve el que
 * hay con `creado: false` (200), no se crea otro. Se relee con cerrojo dentro
 * de la transacción, por si dos pestañas pulsan a la vez. Si la columna
 * apuntaba a un informe borrado, `informeDe` la limpia y aquí nace uno nuevo.
 *
 * ── QUIÉN FIRMA ────────────────────────────────────────────────────────────
 * El terapeuta ASIGNADO del expediente; si el cuerpo trae `therapistId`
 * (alguien del equipo), ese; si el expediente no tiene asignado, quien pide.
 * Sin ninguno de los tres no hay informe: `clinical_reports.therapist_id` no
 * admite nulo, y un informe clínico lo firma una persona.
 *
 * Lo hace cualquiera con `clinica` (decisión 9): es clínico, no dinero.
 *
 * Body (opcional): `{ therapistId?: uuid }`.
 * Devuelve `{ informe, expediente, creado }`: 201 si nace, 200 si ya estaba.
 * 503 si el centro no tiene la tabla de informes.
 */
export const POST = withTenant(async (request, routeCtx, ctx) => {
  const { tenant, tenantModels, hasModule } = ctx;
  if (!hasModule("clinica")) return forbidden();
  try {
    const { Diagnostico, ClinicalReport, TeamMember } = tenantModels;
    const { id } = (await routeCtx?.params) ?? {};
    if (!Diagnostico || !UUID_RE.test(String(id ?? ""))) return notFound("Ese diagnóstico no existe");
    if (!ClinicalReport) return error("Este centro no tiene informes clínicos: hace falta el módulo de Clínica completo", 503);

    let body = {};
    try {
      body = (await request.json()) ?? {};
    } catch {
      /* sin body: firma el asignado */
    }

    const expediente = await Diagnostico.findByPk(id);
    if (!expediente) return notFound("Ese diagnóstico no existe");
    const puedeDecidir = puedeDarBonos({ role: request.headers.get("x-user-role") ?? "user", hasModule });

    // ¿Ya lo tiene? (y si la columna apuntaba a uno borrado, se limpia aquí)
    const existente = await informeDe(tenantModels, expediente);
    if (existente) {
      const informe = await ClinicalReport.findByPk(existente.id);
      const fila = await fichaDeExpediente({ tenant, tenantModels, expediente, puedeDecidir });
      return ok({ informe: serializeReport(informe, tenant), expediente: fila, creado: false });
    }

    // Quién firma: el del cuerpo (del equipo), el asignado, quien pide.
    let therapistId = null;
    if (body.therapistId !== undefined && body.therapistId !== null && body.therapistId !== "") {
      const pedido = String(body.therapistId).trim();
      if (!UUID_RE.test(pedido) || !TeamMember) return error("Ese terapeuta no es válido", 422);
      const tm = await TeamMember.findByPk(pedido, { attributes: ["id"] });
      if (!tm) return error("Ese profesional no es del centro", 422);
      therapistId = tm.id;
    }
    if (!therapistId) therapistId = expediente.therapistId ?? null;
    if (!therapistId) therapistId = await resolveCurrentTeamMemberId(request, tenantModels);
    if (!therapistId) {
      return error("Hace falta quien firme el informe: asigna un terapeuta al diagnóstico o elige uno", 422);
    }

    // Los registros terminados del expediente: la base del informe (su anexo).
    const registros = await registrosDe(tenantModels, expediente);
    const terminados = registros.filter((r) => ESTADOS_TERMINADOS.includes(r.status));
    const sourceSessionIds = terminados.map((r) => r.id);
    const clientId = expediente.clientId ?? (await clientIdOfPatient(tenantModels, expediente.patientId));

    let informe = null;
    let creado = false;
    await Diagnostico.sequelize.transaction(async (t) => {
      // Con cerrojo: si otra pestaña acaba de crearlo, se adopta el suyo.
      const fresco = await Diagnostico.findByPk(expediente.id, { transaction: t, lock: t.LOCK.UPDATE });
      if (fresco?.informeId) {
        informe = await ClinicalReport.findByPk(fresco.informeId, { transaction: t });
        if (informe) return;
      }
      informe = await ClinicalReport.create(
        {
          patientId: expediente.patientId,
          therapistId,
          reportType: TIPO_DIAGNOSTICO,
          reportDate: new Date().toISOString().slice(0, 10),
          dueDate: null,
          // La plantilla de fábrica del diagnóstico, los registros en los que
          // se basa (el anexo del PDF, `sesionesDelInforme.js`) y de qué
          // expediente viene, para que el editor ofrezca «Unir los registros».
          contentSections: { [CLAVE_PLANTILLA]: TIPO_DIAGNOSTICO, sourceSessionIds, diagnosticoId: expediente.id },
          status: "draft",
          clientId,
        },
        { transaction: t }
      );
      await expediente.update({ informeId: informe.id }, { transaction: t });
      creado = true;
    });

    if (creado) {
      // Después de la mutación y fuera de la transacción; ids y recuentos,
      // nunca texto clínico.
      await auditar({
        tenantId: tenant.id,
        ...datosPeticion(request),
        action: "diagnostico.informe_creado",
        entity: "Diagnostico",
        entityId: expediente.id,
        after: { informeId: informe.id, therapistId, registros: terminados.length, patientId: expediente.patientId },
      });
    }

    const fila = await fichaDeExpediente({ tenant, tenantModels, expediente, puedeDecidir });
    const respuesta = { informe: serializeReport(informe, tenant), expediente: fila, creado };
    return creado ? created(respuesta) : ok(respuesta);
  } catch (err) {
    if (tablaAusente(err)) return notFound("Ese diagnóstico no existe");
    return serverError(err);
  }
});
