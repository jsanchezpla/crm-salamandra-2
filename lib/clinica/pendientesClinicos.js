/**
 * lib/clinica/pendientesClinicos.js — los planes de intervención a completar y
 * las entrevistas iniciales sin registrar de una profesional (15/09/2026,
 * AV-0078 de Aumenta, segunda vuelta).
 *
 * (Fichero nuevo en /lib, regla #2: lo usan la Bandeja de cada una y la tabla
 * del equipo, y tiene que decir lo mismo en las dos. Puro: sin base de datos.
 * Prueba en `scripts/_smoke-pendientes-clinicos.mjs`.)
 *
 * ── DE QUÉ PETICIÓN NACE ───────────────────────────────────────────────────
 * Daniela (coordinadora): que la Bandeja diga «si los planes de intervención
 * están completos (incluyendo diagnóstico y motivo de consulta, junto a
 * objetivos)» y «si las entrevistas o valoraciones realizadas por terapeutas
 * están hechas», para dar feedback a las compañeras y que lo vea Dirección.
 *
 * ── POR QUÉ «PACIENTES QUE VIENEN» Y NO «PACIENTES ACTIVOS» ────────────────
 * El 09/09 se decidió NO hacer la lista de «planes por hacer» porque, medida
 * sobre pacientes activos, salían cientos: Aumenta tiene 1.052 pacientes en
 * `active` y la mayoría no viene desde hace meses (AV-0130: 620 familias sin
 * cita ni sesión en seis meses). Medido el 15/09 con «ha tenido cita en los
 * últimos 30 días»: 252 pacientes, 150 sin plan y 12 con el plan incompleto,
 * repartidos entre 15 profesionales. Eso sí es una lista de trabajo.
 *
 * Y la profesional a la que se le reclama es la que le ha dado cita en esa
 * ventana: el plan es uno por paciente y no tiene autora, así que un paciente
 * de dos terapeutas sale en las dos bandejas. Mejor que en ninguna.
 *
 * ── LA ENTREVISTA: PACIENTE NUEVO POR SU FECHA DE ALTA ─────────────────────
 * «Nuevo» no puede leerse de `patients.created_at`: 1.174 se crearon el día de
 * la migración. Tampoco de la primera cita: la agenda importada solo trae citas
 * desde agosto de 2026, así que TODOS parecerían nuevos (medido el 15/09: 252
 * de 252). Se lee de la FECHA DE ALTA del paciente (`enrollmentDate`, que sí vino
 * de Organízate) y, si no la tiene, de cuándo se creó la ficha. Medido el 15/09:
 * 18 pacientes nuevos que ya vienen, 11 sin entrevista. Entrevista hecha = un
 * registro con la plantilla de entrevista inicial (`esEntrevistaInicial`), en
 * cualquier estado: si está en borrador ya sale en «Registros a medias».
 *
 * «Valoraciones» NO entra: hoy no existen como documento, solo como tipo de cita.
 *
 * ── LA QUE NO HACE FALTA (15/09/2026, AV-0141) ─────────────────────────────
 * Daniela: «determinados pacientes no cuentan con entrevista inicial». Un
 * paciente marcado en `patients.entrevista_no_necesaria` (desde la propia
 * Bandeja, `POST /api/clinica/entrevistas/no-necesaria`) deja de reclamarse,
 * igual que si la tuviera escrita. Quitar la marca la vuelve a pedir.
 */

import { tieneMotivo } from "./motivosDelPlan.js";

export const DIAS_PACIENTE_QUE_VIENE = 30;
export const DIAS_PACIENTE_NUEVO = 30;

const vacio = (v) => typeof v !== "string" || v.trim() === "";

/** Qué le falta al plan de un paciente. `[]` = completo. Sin plan: `["plan"]`. */
export function loQueFaltaAlPlan(plan) {
  if (!plan) return ["plan"];
  const falta = [];
  if (vacio(plan.diagnosis)) falta.push("diagnóstico");
  // General o de alguna terapia (AV-0143): cualquiera de los dos cuenta.
  if (!tieneMotivo(plan)) falta.push("motivo de consulta");
  const objetivos = Array.isArray(plan.objectives) ? plan.objectives : [];
  const conTexto = objetivos.filter((o) => !vacio(typeof o === "string" ? o : o?.texto));
  if (!conTexto.length) falta.push("objetivos");
  return falta;
}

/**
 * Reparte lo pendiente por profesional.
 *
 * @param {object}   p
 * @param {Array}    p.citas        citas pasadas de la ventana: `{patientId, teamMemberId, scheduledAt}`.
 * @param {Array}    p.planes       planes de esos pacientes: `{patientId, diagnosis, consultationReasons, objectives}`.
 * @param {Map}      p.altaDelPaciente patientId → su fecha de alta (o de creación de la ficha).
 * @param {Set}      p.conEntrevista patientIds que ya tienen entrevista inicial registrada.
 * @param {Set}      [p.noNecesitanEntrevista] patientIds marcados como «no hace falta» (AV-0141).
 * @param {Date}     [p.ahora]
 * @returns {Map<string, {planes: Array<{patientId, falta}>, entrevistas: Array<{patientId, alta}>}>}
 */
export function pendientesPorProfesional({ citas = [], planes = [], altaDelPaciente = new Map(), conEntrevista = new Set(), noNecesitanEntrevista = new Set(), ahora = new Date() }) {
  const planDe = new Map((planes ?? []).map((pl) => [String(pl.patientId), pl]));
  const limiteNuevo = new Date(ahora).getTime() - DIAS_PACIENTE_NUEVO * 24 * 60 * 60 * 1000;
  const salida = new Map();
  const vistos = new Set();

  for (const c of citas ?? []) {
    if (!c?.patientId || !c?.teamMemberId) continue;
    const prof = String(c.teamMemberId);
    const pac = String(c.patientId);
    const clave = `${prof}|${pac}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    if (!salida.has(prof)) salida.set(prof, { planes: [], entrevistas: [] });
    const suyo = salida.get(prof);

    const falta = loQueFaltaAlPlan(planDe.get(pac));
    if (falta.length) suyo.planes.push({ patientId: pac, falta });

    const alta = altaDelPaciente.get(pac);
    const t = alta ? new Date(alta).getTime() : NaN;
    if (!Number.isNaN(t) && t >= limiteNuevo && !conEntrevista.has(pac) && !noNecesitanEntrevista.has(pac)) {
      suyo.entrevistas.push({ patientId: pac, alta });
    }
  }
  return salida;
}
