import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { assertNotDemoPaidCall } from "../../../../../../lib/demo/isDemo.js";
import { vetoAi } from "../../../../../../lib/ai/aiAccess.js";
import { getTenantIaKey, getTenantIaModel, sinClaveDeIa } from "../../../../../../lib/ai/proveedorIa.js";
import { motivoDelFalloIa } from "../../../../../../lib/ai/errorLegible.js";
import { auditar, datosPeticion } from "../../../../../../lib/utils/auditoria.js";
import { apartadosPara, plantillasDe } from "../../../../../../lib/clinica/plantillas.js";
import { MAX_TRANSCRIPCION } from "../../../../../../lib/clinica/registroCompleto.js";
import { bloquesDelInforme, tablaDePruebasParaLaIA } from "../../../../../../lib/clinica/informeMaterial.js";
import { CLAVE_PRUEBAS, MAX_PRUEBAS_PARA_IA, normalizarPruebas } from "../../../../../../lib/clinica/pruebasDiagnosticas.js";
import { structureInforme } from "../../../../../../lib/clinica/structureInforme.js";
import { perfilDelCentro } from "../../../../../../lib/clinica/perfilDelCentro.js";
import { UUID_RE } from "../../../../../../lib/clinica/diagnosticoFila.js";
import { tablaAusente } from "../../../../../../lib/clinica/diagnosticoDb.js";
import { ESTADOS_TERMINADOS, materialDeLosRegistros } from "../../../../../../lib/clinica/registroDeDiagnostico.js";
import { registrosDe, informeDe } from "../../../../../../lib/clinica/registrosDelExpediente.js";

/**
 * POST /api/clinica/diagnosticos/[id]/unir — UNIR con la IA los registros de
 * un diagnóstico en su informe de valoración (12/09/2026, segunda entrega;
 * Rodrigo con Isa, Aumenta).
 *
 * Es el SEGUNDO paso de «Unir en informe» (el primero, `/informe`, crea el
 * informe vacío). Junta el texto de los registros TERMINADOS del expediente
 * (`materialDeLosRegistros`: por registro, su fecha y título y cada apartado
 * con su rótulo, más la devolución de la familia) y se lo da a
 * `structureInforme` con los apartados de ESE informe. Devuelve la propuesta
 * **SIN guardar**, exactamente como `/api/clinica/reports/[id]/desde-material`
 * —del que copia los gates y el manejo de errores—: en el editor del informe
 * se enseña en `PropuestaIA` y la profesional acepta apartado por apartado. Un
 * informe clínico lo firma una persona; la IA propone.
 *
 * Lo ÚNICO que se guarda es `contentSections.sourceSessionIds` puesto al día
 * con los registros unidos: son metadatos —el anexo del PDF
 * (`sesionesDelInforme.js`)—, no texto.
 *
 * ── LO QUE VIAJA A LA IA, Y LO QUE NO ──────────────────────────────────────
 * Solo registros con `status` registrado o cerrado (`ESTADOS_TERMINADOS`; un
 * borrador no es material, la misma regla que `desde-sesiones`), y de ellos
 * nunca `prepText`, `prepFiles`, `internalNotes` ni `aiTranscription`
 * (`registrosDe` ni los pide). El NOMBRE del paciente no viaja: la línea de
 * contexto la monta `estiloClinico.js` con edad y áreas. Y, en su propio
 * bloque del mensaje, la tabla de puntuaciones del informe
 * (`contentSections.pruebas`, leída de lo GUARDADO; nunca en la beca;
 * 13/09/2026).
 *
 * Body JSON (opcional): `{ apartados?, escrito? }` como los de `desde-material`
 * —los apartados tal como se están viendo en pantalla y lo ya tecleado, para
 * que la propuesta no lo contradiga—. Sin ellos, los del informe guardado.
 *
 * Devuelve `{ propuesta, nuevos, bloques, material, registros, pruebas, incidencia }`
 * (+ `avisoIA` si la respuesta vino cortada o ilegible). Errores: 409 sin
 * informe («Crea primero el informe desde el expediente») o informe ya
 * entregado; 422 sin registros terminados (o sin nada escrito en ellos); 413
 * material más largo que `MAX_TRANSCRIPCION` o tabla de pruebas más larga que
 * `MAX_PRUEBAS_PARA_IA`; 503 sin clave de Anthropic; 502
 * si la IA falla (con la frase de `motivoDelFalloIa`; el aviso a los admins
 * sale del cliente central desde el 13/09/2026).
 */
export const POST = withTenant(async (request, routeCtx, ctx) => {
  const { tenant, tenantModels, hasModule } = ctx;
  if (!hasModule("clinica")) return forbidden();
  // La demo es pública (sesión de admin anónima): nunca llamar a Claude con la
  // clave del tenant desde ahí. Va FUERA del try: lanza un `ForbiddenError` que
  // tiene que subir hasta `withTenant` para salir como 403 y no como un 500.
  assertNotDemoPaidCall(ctx, "Unir los registros con IA");

  try {
    const { Diagnostico, ClinicalReport, ClinicSession, Patient } = tenantModels;
    const { id } = (await routeCtx?.params) ?? {};
    if (!Diagnostico || !UUID_RE.test(String(id ?? ""))) return notFound("Ese diagnóstico no existe");
    if (!ClinicalReport || !ClinicSession) return error("Este centro no tiene informes ni registros clínicos", 503);

    const expediente = await Diagnostico.findByPk(id);
    if (!expediente) return notFound("Ese diagnóstico no existe");

    // El informe del expediente (candado de paciente; limpia la columna si
    // apuntaba a uno borrado). Del paciente se traen los campos con los que
    // `lineaDePaciente` monta el contexto del prompt: el NOMBRE no se pide.
    const resumen = await informeDe(tenantModels, expediente);
    const informe = resumen
      ? await ClinicalReport.findByPk(resumen.id, {
          include: Patient
            ? [{ model: Patient, as: "patient", attributes: ["id", "age", "birthDate", "specialties", "educationLevel", "careType"] }]
            : [],
        })
      : null;
    if (!informe) return error("Crea primero el informe desde el expediente", 409);
    if (informe.status === "delivered") {
      // Reescribir un informe ya entregado dejaría a la familia con un PDF que
      // no coincide con lo que hay en el CRM.
      return error("Este informe ya se envió a la familia: duplícalo o crea uno nuevo para reescribirlo", 409);
    }

    const veto = await vetoAi(ctx, request, "unir los registros de un diagnóstico en su informe");
    if (veto) return veto;

    let body = {};
    try {
      body = (await request.json()) ?? {};
    } catch {
      /* sin body: los apartados del informe guardado */
    }

    // Los registros terminados, y su texto.
    const registros = await registrosDe(tenantModels, expediente);
    const terminados = registros.filter((r) => ESTADOS_TERMINADOS.includes(r.status));
    if (!terminados.length) {
      return error("No hay registros terminados que unir: registra o cierra al menos uno de los registros del diagnóstico", 422);
    }
    const material = materialDeLosRegistros(terminados, { plantillasDelCentro: plantillasDe(tenant, "registro") });
    if (!material) return error("Los registros terminados de este diagnóstico no tienen nada escrito que unir", 422);
    if (material.length > MAX_TRANSCRIPCION) {
      return error("Los registros juntos son demasiado largos para unirlos de una vez: cierra el informe por partes o acorta los registros.", 413);
    }

    const iaKey = getTenantIaKey(ctx);
    if (!iaKey) {
      return error(sinClaveDeIa(ctx, "para unir los registros en el informe"), 503);
    }

    // Con qué apartados: los que manda la pantalla (sabe la plantilla elegida y
    // los sueltos añadidos a mano) y, si no, los del informe guardado.
    const cs = informe.contentSections && typeof informe.contentSections === "object" ? informe.contentSections : {};
    const apartados = Array.isArray(body.apartados) && body.apartados.length ? body.apartados : apartadosPara(cs, tenant, "informe");
    const escrito = body.escrito && typeof body.escrito === "object" && !Array.isArray(body.escrito) ? body.escrito : null;

    // La tabla de puntuaciones del propio informe (13/09/2026): no es registro
    // ni apartado, así que `materialDeLosRegistros` no la trae y la IA escribía
    // la integración sin resultados. Viaja en su propio bloque del mensaje, leída
    // de lo GUARDADO (la pantalla guarda antes de llamar). En la beca, nada.
    const tablaDePruebas = tablaDePruebasParaLaIA({ pruebas: cs[CLAVE_PRUEBAS], tipo: informe.reportType });
    if (tablaDePruebas.length > MAX_PRUEBAS_PARA_IA) {
      return error("La tabla de pruebas del informe es demasiado larga para mandarla a la IA de una vez: acorta las descripciones o las interpretaciones de las pruebas.", 413);
    }
    const pruebasQueViajan = tablaDePruebas ? normalizarPruebas(cs[CLAVE_PRUEBAS]).length : 0;

    let salida;
    const t0 = Date.now();
    try {
      salida = await structureInforme({
        centro: perfilDelCentro(tenant),
        transcription: material,
        apartados,
        escrito,
        pruebas: cs[CLAVE_PRUEBAS],
        paciente: informe.patient,
        tipo: informe.reportType,
        apiKey: iaKey,
        model: getTenantIaModel(ctx),
      });
      console.info("[clinica:diagnostico-unir] claude", `${Date.now() - t0}ms`, `${material.length} chars`, `${terminados.length} registros`, `${tablaDePruebas.length} chars de pruebas`);
    } catch (e) {
      if (e?.code === "NO_API_KEY") return error("El informe con IA no está configurado (falta la clave de IA).", 503);
      console.error("[clinica:diagnostico-unir]", e);
      // Si es la cuenta de IA del centro (sin saldo, clave, límite), la frase
      // dice ESO; la campana a sus admins ya ha salido del cliente central.
      return error(motivoDelFalloIa(e, "La IA no ha podido unir los registros en el informe. Vuelve a intentarlo: los registros siguen ahí."), 502);
    }

    // Lo único que se guarda: en qué registros se basa el informe (el anexo).
    const sourceSessionIds = terminados.map((r) => r.id);
    await informe.update({ contentSections: { ...cs, sourceSessionIds } });

    // Se audita QUÉ se propuso, nunca su texto: el contenido de un informe
    // clínico no se duplica en master.audit_logs.
    await auditar({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "diagnostico.informe_unido",
      entity: "Diagnostico",
      entityId: expediente.id,
      after: {
        informeId: informe.id,
        registros: terminados.length,
        pruebas: pruebasQueViajan,
        apartados: Object.keys(salida.propuesta ?? {}).length,
        nuevos: (salida.nuevos ?? []).length,
        incidencia: salida.incidencia ?? null,
      },
    });

    // Lo que le pasó a la respuesta de Claude, dicho en cristiano: una
    // respuesta cortada no puede llegar a pantalla como «no ha sacado nada».
    const aviso =
      salida.incidencia === "cortada"
        ? "La IA se ha quedado sin sitio antes de terminar: tienes lo que llegó entero. Revisa si falta algún apartado y, si falta, vuelve a unir."
        : salida.incidencia === "ilegible" || salida.incidencia === "vacia"
          ? "La IA ha contestado en un formato que no se ha podido leer. Vuelve a unir: los registros siguen ahí."
          : null;

    return ok({
      propuesta: salida.propuesta,
      nuevos: salida.nuevos,
      bloques: salida.bloques ?? bloquesDelInforme(apartados),
      material,
      registros: terminados.length,
      pruebas: pruebasQueViajan,
      incidencia: salida.incidencia ?? null,
      ...(aviso ? { avisoIA: aviso } : {}),
    });
  } catch (err) {
    if (tablaAusente(err)) return notFound("Ese diagnóstico no existe");
    return serverError(err);
  }
});
