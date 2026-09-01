/**
 * lib/clinica/propagarTaller.js — llevar el registro de una sesión de taller a
 * la ficha de cada paciente que fue (01/09/2026, Aumenta por Rodrigo).
 *
 * Separado de `tallerSesion.js` para que ese quede puro (se prueba sin base de
 * datos) y este pueda tocar Sequelize. Mismo reparto que `productivity.js` /
 * `productivityQuery.js`.
 *
 * ── QUÉ HACE, EXACTAMENTE ───────────────────────────────────────────────────
 * Reescribe la sesión de cada asistente para que diga lo que dice la sesión del
 * taller, respetando SIEMPRE su nota individual. Es idempotente: guardar dos
 * veces seguidas deja lo mismo, así que si algo falla a mitad basta con volver
 * a guardar.
 *
 *   · asistente nuevo      → se le crea su `ClinicSession`
 *   · asistente que sigue  → se reescribe la suya (cuerpo común + SU nota)
 *   · asistente quitado    → se borra la suya… salvo que ya se le haya enviado
 *     a la familia. Un registro que la familia ya tiene en su área privada no
 *     puede desaparecer del CRM: se queda, se cuenta en la respuesta y que lo
 *     decida el centro. Corregir una lista de asistencia no es lo mismo que
 *     borrar un documento que alguien ya ha leído.
 *
 * ── LO QUE NUNCA CRUZA ──────────────────────────────────────────────────────
 * La nota individual de un paciente no toca la de otro en ningún momento: se
 * lee de SU propia sesión (o de lo que mande el formulario para él) y se
 * escribe solo en la suya. Y las notas internas del grupo no bajan a ninguna.
 */

import { clientIdOfPatient } from "./patientClient.js";
import { notaIndividualDe, registroDelPaciente } from "./tallerSesion.js";

/**
 * @param TallerSesion   la fila (o su JSON) que manda
 * @param ClinicSession  el modelo
 * @param asistentes     [{ patientId, nota }] — quién fue y su nota privada
 * @param etiquetaNota   el título del apartado privado
 * @returns { creadas, actualizadas, borradas, conservadas }
 */
export async function propagarSesionDeTaller({
  tenantModels,
  sesionTaller,
  asistentes = [],
  etiquetaNota = "",
}) {
  const { ClinicSession } = tenantModels;
  if (!ClinicSession) return { creadas: 0, actualizadas: 0, borradas: 0, conservadas: [] };

  const sesionId = sesionTaller.id;
  const previas = await ClinicSession.findAll({ where: { tallerSesionId: sesionId } });
  const previaDe = new Map(previas.map((s) => [s.patientId, s]));

  // Un paciente no puede estar dos veces en la lista de asistencia: sería su
  // sesión escrita dos veces con notas distintas y ganaría la última.
  const lista = [];
  const vistos = new Set();
  for (const a of Array.isArray(asistentes) ? asistentes : []) {
    const patientId = typeof a?.patientId === "string" ? a.patientId.trim() : "";
    if (!patientId || vistos.has(patientId)) continue;
    vistos.add(patientId);
    lista.push({ patientId, nota: typeof a?.nota === "string" ? a.nota : "" });
  }

  let creadas = 0;
  let actualizadas = 0;

  for (const { patientId, nota } of lista) {
    const previa = previaDe.get(patientId);
    /*
     * Si el formulario no manda nota para este paciente, se conserva la que ya
     * tenía escrita. Guardar el registro común desde otra pantalla —o desde el
     * bloqueo de la agenda— no puede borrarle a nadie su nota individual.
     */
    const notaFinal = nota !== "" ? nota : notaIndividualDe(previa?.contentSections);
    const payload = registroDelPaciente({ sesionTaller, nota: notaFinal, etiquetaNota });

    if (previa) {
      await previa.update(payload);
      actualizadas += 1;
    } else {
      await ClinicSession.create({
        ...payload,
        patientId,
        // Regla de conexión cliente/equipo: el registro se queda con la foto de
        // quién pagaba el día que se creó.
        clientId: await clientIdOfPatient(tenantModels, patientId),
      });
      creadas += 1;
    }
  }

  // Los que ya no están en la lista.
  let borradas = 0;
  const conservadas = [];
  for (const previa of previas) {
    if (vistos.has(previa.patientId)) continue;
    if (previa.deliveredAt || previa.deliveredDocumentId) {
      // Ya está en el área privada de esa familia: no se borra. Se desengancha
      // del taller para que la próxima propagación no vuelva a reescribirla, y
      // se queda en la ficha del paciente como el registro que la familia leyó.
      await previa.update({ tallerSesionId: null });
      conservadas.push(previa.patientId);
      continue;
    }
    await previa.destroy();
    borradas += 1;
  }

  return { creadas, actualizadas, borradas, conservadas };
}

/**
 * Las notas individuales que hay guardadas hoy, para volver a pintar el
 * formulario tal como se dejó: `{ patientId: { nota } }`.
 */
export async function notasDeLaSesion({ tenantModels, sesionTallerId }) {
  const { ClinicSession } = tenantModels;
  if (!ClinicSession) return new Map();
  const filas = await ClinicSession.findAll({
    where: { tallerSesionId: sesionTallerId },
    attributes: ["id", "patientId", "contentSections", "deliveredAt"],
  });
  return new Map(
    filas.map((f) => [
      f.patientId,
      { sessionId: f.id, nota: notaIndividualDe(f.contentSections), enviada: Boolean(f.deliveredAt) },
    ])
  );
}
