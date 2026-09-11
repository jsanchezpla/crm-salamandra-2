import { withTenant } from "@/lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "@/lib/utils/apiResponse.js";
import { isDemoTenant } from "@/lib/demo/isDemo.js";
import { vetoAi } from "@/lib/ai/aiAccess.js";
import { getTenantAnthropicKey } from "@/lib/ai/anthropicKey.js";
import { getTenantAnthropicModel } from "@/lib/ai/anthropicModel.js";
import { mensajeDeErrorIa } from "@/lib/ai/errorLegible.js";
import { avisarAdminsDelFalloIa } from "@/lib/ai/avisoDeCuentaIa.js";
import { completeConParada } from "@/lib/outreach/analysis/anthropic.js";
import { auditar, datosPeticion } from "@/lib/utils/auditoria.js";
import { aFormulario, apartadosPara, valoresDeSesion } from "@/lib/clinica/plantillas.js";
import { bloquesDelRegistro } from "@/lib/clinica/registroCompleto.js";
import { perfilDelCentro } from "@/lib/clinica/perfilDelCentro.js";
import { esEntrevistaInicial } from "@/lib/clinica/entrevistaInicial.js";
import {
  MAX_PETICION,
  MAX_TOKENS,
  clavesPermitidas,
  contextoDelEncargo,
  destinoDelEncargo,
  limpiarRespuesta,
  mensajeDeEncargo,
  partesDelPromptDeEncargo,
  resumenDelEncargo,
} from "@/lib/clinica/encargoIa.js";

/**
 * POST /api/clinica/sessions/[id]/encargo — pedirle algo a la IA desde el
 * registro de sesión (09/09/2026, AV-0077 de Araceli).
 *
 * Body: `{ peticion, destino, claves, valores }`.
 *
 *   · `peticion` — lo que necesita, con sus palabras.
 *   · `destino`  — "familia" | "equipo" | "externo". Cambia el registro del
 *                  texto Y lo que puede viajar (las notas internas no van a la
 *                  familia, ni marcándolas).
 *   · `claves`   — qué apartados de SU pantalla quiere que viajen. Pasan por
 *                  `clavesPermitidas`, que es la lista blanca de verdad: se
 *                  valida contra los apartados que tiene esta sesión.
 *   · `valores`  — lo que hay escrito EN PANTALLA, que puede no estar guardado
 *                  todavía. Es su propio texto y no se guarda aquí; solo se
 *                  leen las claves que hayan pasado la lista blanca.
 *
 * ── LO QUE NO SALE DE AQUÍ ─────────────────────────────────────────────────
 * La transcripción del audio no se ofrece por ninguna parte: no está entre los
 * bloques del registro, así que no hay clave con la que pedirla. Y de la ficha
 * solo pueden entrar dos cosas, las dos marcándolas a mano y las dos leídas
 * AQUÍ con candado de paciente: la entrevista inicial y los objetivos del plan.
 *
 * ── NO GUARDA NADA ─────────────────────────────────────────────────────────
 * Devuelve texto. No escribe en la sesión, no crea apartados y no manda ningún
 * correo: «redactar no es enviar» era la condición de la decisión de Rodrigo.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Un objetivo del plan es una línea; con 40 va sobrado y no infla el prompt. */
const MAX_OBJETIVOS_PLAN = 40;

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

/**
 * La entrevista inicial del paciente, si la tiene. Con candado de paciente por
 * lo mismo que `sesionesDelInforme`: aquí se arma material clínico y una fila
 * de otro paciente sería un incidente de datos de salud.
 */
async function entrevistaDelPaciente(ClinicSession, tenant, patientId) {
  const filas = await ClinicSession.findAll({
    where: { patientId },
    /*
     * Lista blanca también aquí. Lo que NO se pide, y no es un olvido:
     * `ai_transcription` (la entrevista entera en crudo, con todo lo que se
     * dijo), `internal_notes`, `prep_text` y `prep_files`. La misma frontera
     * del PDF y del correo del registro.
     */
    attributes: ["id", "sessionDate", "contentSections", "objectives", "activities", "performance", "observations"],
    order: [["sessionDate", "ASC"]],
    limit: 50,
  });
  const e = filas.map((f) => (f.toJSON ? f.toJSON() : f)).find(esEntrevistaInicial);
  if (!e) return "";
  // Con sus TÍTULOS, que es lo que la hace legible para el modelo: los mismos
  // apartados con los que se escribió, por la puerta de siempre.
  const apartados = apartadosPara(e.contentSections, tenant, "registro");
  const valores = aFormulario(valoresDeSesion(e), apartados);
  const partes = [];
  for (const a of apartados) {
    const v = valores[a.key];
    const t = Array.isArray(v) ? v.join("\n") : String(v ?? "").trim();
    if (t) partes.push(`${a.label}:\n${t}`);
  }
  return partes.join("\n\n").slice(0, 12_000);
}

export const POST = withTenant(async (request, rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
    // Gasta clave de Anthropic del tenant y las demos dan sesión de admin a
    // cualquiera con el enlace.
    if (isDemoTenant(ctx)) return forbidden("Pedirle cosas a la IA está desactivado en la demo: usa datos de ejemplo.");

    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido");

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Body inválido", 400);
    }

    const peticion = String(body?.peticion ?? "").trim();
    if (!peticion) return error("Escribe qué necesitas antes de pedírselo a la IA.", 422);
    if (peticion.length > MAX_PETICION) {
      return error(`Lo que le pidas no puede pasar de ${MAX_PETICION.toLocaleString("es-ES")} caracteres.`, 413);
    }
    const destino = destinoDelEncargo(body?.destino);

    const { ClinicSession, Patient, InterventionPlan } = ctx.tenantModels;
    const s = await ClinicSession.findByPk(id);
    if (!s) return notFound("Sesión no encontrada");

    const veto = await vetoAi(ctx, request, "pedirle un texto a la IA desde un registro");
    if (veto) return veto;

    const anthropicKey = getTenantAnthropicKey(ctx);
    if (!anthropicKey) {
      return error("Configura la clave de Anthropic en Configuración → IA para usar la IA.", 400);
    }

    // Los apartados que de verdad tiene ESTA sesión: su propia foto si la
    // tiene y, si no, la plantilla del centro. Es contra esto contra lo que se
    // valida lo que el navegador dice querer mandar.
    const bloques = bloquesDelRegistro(apartadosPara(s.contentSections, ctx.tenant, "registro"));

    const plan = InterventionPlan ? await InterventionPlan.findOne({ where: { patientId: s.patientId } }).catch(() => null) : null;
    const objetivosPlan = (Array.isArray(plan?.objectives) ? plan.objectives : [])
      .map((o) => (typeof o === "string" ? o : o?.texto ?? o?.text ?? ""))
      .map((t) => String(t ?? "").trim())
      .filter(Boolean)
      .slice(0, MAX_OBJETIVOS_PLAN);

    const entrevista = await entrevistaDelPaciente(ClinicSession, ctx.tenant, s.patientId).catch(() => "");

    const opciones = { destino, hayEntrevista: !!entrevista, hayPlan: objetivosPlan.length > 0 };
    const { dentro, fuera } = clavesPermitidas(body?.claves, bloques, opciones);

    const contexto = contextoDelEncargo({
      bloques,
      valores: body?.valores && typeof body.valores === "object" ? body.valores : {},
      claves: dentro,
      entrevista,
      plan: objetivosPlan.join("\n"),
    });

    const paciente = await Patient.findByPk(s.patientId).catch(() => null);

    let texto;
    let parada = null;
    try {
      const r = await completeConParada({
        // El núcleo clínico va aparte para que Anthropic lo cachee: son los
        // mismos ~29.000 tokens de los otros cuatro prompts clínicos.
        ...partesDelPromptDeEncargo({ destino, paciente, centro: perfilDelCentro(ctx.tenant) }),
        user: mensajeDeEncargo({ peticion, contexto }),
        model: getTenantAnthropicModel(ctx),
        maxTokens: MAX_TOKENS,
        apiKey: anthropicKey,
        stream: true,
      });
      texto = limpiarRespuesta(r.texto);
      parada = r.parada;
    } catch (e) {
      if (e.code === "NO_API_KEY") return error("La IA no está configurada (falta la clave de Anthropic).", 503);
      console.error("[clinica:encargo]", e);
      // Si es la cuenta de IA del centro (sin saldo, clave, límite), que lo
      // sepan sus admins y que la frase diga ESO (11/09/2026, Aumenta).
      await avisarAdminsDelFalloIa(ctx, e);
      return error(mensajeDeErrorIa(e, "La IA no ha podido escribirlo. Inténtalo de nuevo."), 502);
    }

    /*
     * Sin texto Y por tope es un caso distinto de «no ha sacado nada»: el
     * modelo razona antes de escribir y ese razonamiento cuenta en el tope, así
     * que un encargo enrevesado se puede quedar sin sitio ANTES de la primera
     * letra. Decirlo aparte evita el «a veces falla» que costó dos semanas en
     * el registro de sesión.
     */
    if (!texto) {
      return parada === "max_tokens"
        ? error("La IA se ha quedado sin sitio antes de escribir. Pídele una cosa cada vez, o más corto.", 422)
        : error("La IA no ha escrito nada. Prueba a contarle con más detalle qué necesitas.", 422);
    }

    // Cuenta lo que pasó y NADA de lo que decía: `master` es un schema
    // compartido y esto es material clínico. Sin nombre de paciente.
    await auditar({
      tenantId: ctx.tenant.id,
      ...datosPeticion(request),
      action: "clinica.encargo.ia",
      entity: "ClinicSession",
      entityId: s.id,
      after: resumenDelEncargo({ destino, claves: dentro, descartadas: fuera, peticion, respuesta: texto }),
    });

    // `cortado` lo enseña la pantalla: un borrador que se corta a mitad de una
    // frase parece terminado si nadie lo dice.
    return ok({ texto, usadas: dentro, descartadas: fuera, cortado: parada === "max_tokens" });
  } catch (err) {
    return serverError(err);
  }
});

/**
 * GET — qué se le puede ofrecer a la profesional para ESTA sesión.
 *
 * La pantalla ya sabe sus apartados (los tiene delante); lo que no puede saber
 * es si este paciente tiene entrevista inicial y objetivos de plan. Sin esto,
 * la pantalla ofrecería marcar «la entrevista inicial» a un paciente que no
 * tiene ninguna, que es peor que no ofrecerla.
 *
 * No gasta IA: es una lectura.
 */
export const GET = withTenant(async (_request, rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica no activo");
    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido");

    const { ClinicSession, InterventionPlan } = ctx.tenantModels;
    const s = await ClinicSession.findByPk(id, { attributes: ["id", "patientId"] });
    if (!s) return notFound("Sesión no encontrada");

    const entrevista = await entrevistaDelPaciente(ClinicSession, ctx.tenant, s.patientId).catch(() => "");
    const plan = InterventionPlan
      ? await InterventionPlan.findOne({ where: { patientId: s.patientId }, attributes: ["id", "objectives"] }).catch(() => null)
      : null;
    const objetivos = Array.isArray(plan?.objectives) ? plan.objectives.filter(Boolean) : [];

    return ok({ hayEntrevista: !!entrevista, hayPlan: objetivos.length > 0 });
  } catch (err) {
    return serverError(err);
  }
});
