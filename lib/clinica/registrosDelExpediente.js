/**
 * lib/clinica/registrosDelExpediente.js — lo que la FICHA de un expediente de
 * diagnóstico necesita de la base de datos además de la barra: sus registros,
 * qué citas ya tienen registro, su informe y la fila entera con todo eso
 * (12/09/2026, segunda entrega del Diagnóstico; Rodrigo con Isa, Aumenta).
 *
 * (Fichero nuevo en /lib, regla #2: es la mitad con Sequelize de
 * `lib/clinica/registroDeDiagnostico.js`, que es puro. Lo piden tres
 * endpoints —`GET/PATCH /api/clinica/diagnosticos/[id]`, `/[id]/informe` y
 * `/[id]/unir`—, y los tres tienen que ver los MISMOS registros: si cada uno
 * escribiera su consulta, el informe podría unir un registro que la ficha no
 * enseña, o al revés.)
 *
 * ── EL CANDADO DE PACIENTE NO ES OPCIONAL ──────────────────────────────────
 * `clinic_sessions.diagnostico_id` lo escribe el servidor (`POST
 * /api/clinica/sessions`), que ya comprueba que el expediente es del mismo
 * paciente. Aun así, aquí se pide SIEMPRE `diagnosticoId` Y `patientId`: los
 * registros que se unen en el informe son texto clínico de un niño, y una
 * fila mal atada —una adopción a mano, una migración— no puede colar la
 * sesión de otro en su informe. La misma regla que `sesionesDelInforme.js`.
 *
 * ── LO QUE NO SE PIDE, Y NO ES UN OLVIDO ───────────────────────────────────
 * `prep_text`, `prep_files`, `internal_notes` y `ai_transcription`: material
 * interno del equipo. Estas filas van a `materialDeLosRegistros`, que es lo
 * que se manda a la IA para escribir el informe que recibe la familia; si no
 * están en la fila, no pueden salir por ahí ni por descuido.
 *
 * ── UN INFORME BORRADO NO DEJA UN ENLACE ROTO ──────────────────────────────
 * `diagnosticos.informe_id` apunta sin FK (hay Clínica sin la tabla en algún
 * schema, y borrar un informe no puede llevarse el expediente). Si el informe
 * ya no existe, `informeDe` LIMPIA la columna y devuelve null: la ficha vuelve
 * a ofrecer «Unir en informe» en vez de un botón que abre un 404.
 */

import { Op } from "sequelize";

import { REPORT_STATUS_LABEL } from "./serialize.js";
import { nombreDe } from "./diagnosticoFila.js";
import { tablaAusente, citasDeExpedientes, filasDe } from "./diagnosticoDb.js";
import { siguienteTitulo } from "./registroDeDiagnostico.js";

/** 42703 = la columna no existe (tenant sin `migrate-diagnosticos-2`). */
const columnaAusente = (err) => err?.parent?.code === "42703" || err?.original?.code === "42703";

/**
 * Las columnas de un registro que la ficha y el material de la IA necesitan.
 * Nada del bloque interno (ver la cabecera).
 */
const ATRIBUTOS_DE_REGISTRO = [
  "id",
  "patientId",
  "therapistId",
  "sessionDate",
  "duration",
  "status",
  "titulo",
  "bookingId",
  "diagnosticoId",
  "objectives",
  "activities",
  "performance",
  "observations",
  "parentFeedback",
  "contentSections",
  "createdAt",
  "updatedAt",
];

/**
 * Los registros de un expediente —las filas de `clinic_sessions` con su
 * `diagnosticoId` Y su `patientId`—, por fecha ascendente y con quien firma
 * ya resuelto (`terapeuta: { id, nombre }` o null).
 *
 * Devuelve JSON plano (no instancias): lo consumen `registrosPorFecha`,
 * `materialDeLosRegistros` y `filaDeExpediente`, que leen campos, no métodos.
 * Lista vacía en un centro sin la tabla o sin la columna.
 */
export async function registrosDe(tenantModels, expediente) {
  const { ClinicSession, TeamMember } = tenantModels ?? {};
  const id = expediente?.id ?? null;
  const patientId = expediente?.patientId ?? null;
  if (!ClinicSession || !id || !patientId) return [];
  try {
    const filas = await ClinicSession.findAll({
      where: { diagnosticoId: id, patientId },
      attributes: ATRIBUTOS_DE_REGISTRO,
      include: TeamMember ? [{ model: TeamMember, as: "therapist", attributes: ["id", "displayName"] }] : [],
      order: [["sessionDate", "ASC"], ["createdAt", "ASC"]],
    });
    return filas.map((f) => {
      const j = f.toJSON ? f.toJSON() : f;
      const { therapist, ...resto } = j;
      return { ...resto, terapeuta: therapist ? { id: therapist.id, nombre: nombreDe(therapist) } : null };
    });
  } catch (err) {
    if (tablaAusente(err) || columnaAusente(err)) return [];
    throw err;
  }
}

/**
 * Qué citas ya tienen registro: Map id de cita → id de sesión, en UNA
 * consulta para todas las citas del expediente. Si dos sesiones apuntan a la
 * misma cita (una adopción a mano, dos pestañas), gana la tocada más
 * recientemente —la que se estaba escribiendo—, como `sesionDeLaCita`.
 */
export async function sesionesDeLasCitas(tenantModels, citas) {
  const { ClinicSession } = tenantModels ?? {};
  const mapa = new Map();
  const ids = [...new Set((Array.isArray(citas) ? citas : []).map((c) => c?.id ?? c).filter(Boolean).map(String))];
  if (!ClinicSession || !ids.length) return mapa;
  try {
    const filas = await ClinicSession.findAll({
      where: { bookingId: { [Op.in]: ids } },
      attributes: ["id", "bookingId", "updatedAt"],
      // De la más reciente a la más vieja: la primera de cada cita es la que vale.
      order: [["updatedAt", "DESC"]],
      raw: true,
    });
    for (const f of filas) {
      const k = String(f.bookingId);
      if (!mapa.has(k)) mapa.set(k, f.id);
    }
  } catch (err) {
    if (tablaAusente(err) || columnaAusente(err)) return mapa;
    throw err;
  }
  return mapa;
}

/**
 * El informe de valoración diagnóstica del expediente, resumido para la fila:
 * `{ id, status, statusLabel, reportDate, url }` o null.
 *
 * Se pide por id Y por paciente (candado). Si `informeId` apunta a un informe
 * que ya no existe —o que no es de este paciente—, se LIMPIA la columna y se
 * devuelve null (ver la cabecera). Un centro sin la tabla de informes: null.
 */
export async function informeDe(tenantModels, expediente) {
  const { ClinicalReport } = tenantModels ?? {};
  const informeId = expediente?.informeId ?? null;
  if (!ClinicalReport || !informeId) return null;
  let fila = null;
  try {
    fila = await ClinicalReport.findOne({
      where: { id: informeId, patientId: expediente.patientId },
      attributes: ["id", "status", "reportDate"],
      raw: true,
    });
  } catch (err) {
    if (tablaAusente(err)) return null;
    throw err;
  }
  if (!fila) {
    if (typeof expediente?.update === "function") await expediente.update({ informeId: null });
    return null;
  }
  return {
    id: fila.id,
    status: fila.status ?? null,
    statusLabel: REPORT_STATUS_LABEL[fila.status] ?? fila.status ?? null,
    reportDate: fila.reportDate ?? null,
    url: `/clinica/informes/${fila.id}`,
  };
}

/**
 * LA FILA de la ficha de un expediente: la misma que la lista (`filasDe`,
 * que es quien sabe la barra, el dinero y el cobro al seguir) más lo que solo
 * la ficha enseña —los registros por fecha, qué cita tiene ya su registro, el
 * informe, el título que toca y los enlaces de todo eso—, pasado a `filasDe`
 * por su `extras` para que `filaDeExpediente` lo monte una sola vez.
 *
 * Existe aparte porque la lista pinta cincuenta expedientes con cuatro
 * consultas, y esto son cuatro consultas más por UN expediente; en la lista
 * serían doscientas. Las citas se piden dos veces (aquí, para saber de qué
 * citas buscar registro, y dentro de `filasDe`): es una consulta ligera de un
 * solo expediente, y la alternativa era abrirle a `filasDe` una puerta más.
 */
export async function fichaDeExpediente({ tenant, tenantModels, expediente, puedeDecidir = false, ahora = new Date() } = {}) {
  const [citasPorExpediente, registros, informe] = await Promise.all([
    citasDeExpedientes(tenantModels, [expediente.id]),
    registrosDe(tenantModels, expediente),
    informeDe(tenantModels, expediente),
  ]);
  const citas = citasPorExpediente.get(String(expediente.id)) ?? [];
  const sesionesPorCita = await sesionesDeLasCitas(tenantModels, citas);
  const extras = new Map([[String(expediente.id), { registros, sesionesPorCita, informe, siguienteTitulo: siguienteTitulo(registros) }]]);
  const [fila] = await filasDe({ tenantModels, tenant, expedientes: [expediente], puedeDecidir, ahora, conCitas: true, extras });
  return fila;
}

