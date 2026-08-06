/**
 * ¿La fecha de nacimiento cuadra con la edad que dijo en el formulario?
 * (06/08/2026, Rodrigo)
 *
 * Son dos declaraciones de la misma persona en dos momentos distintos: la edad
 * que escribe en el formulario público de la web, y la fecha de nacimiento que
 * pone después en su ficha, antes de firmar. Nadie las comparaba.
 *
 * Importa porque la edad decide cosas que no se pueden dejar al azar: si hace
 * falta el consentimiento de su tutor legal, si se le puede exigir el DNI y si
 * puede consentir ella sola (art. 7 LOPDGDD). Alguien que declara 20 en el
 * formulario y luego pone una fecha de nacimiento de hace 15 años no es
 * necesariamente un fraude —una madre que rellena el formulario poniendo SU edad
 * y luego la fecha de su hija es el caso más probable—, pero es exactamente el
 * tipo de cosa que la profesional tiene que ver antes de dar la primera cita.
 *
 * SE PERMITE UN AÑO DE MÁS a propósito: entre rellenar el formulario y firmar
 * pueden pasar semanas, y por medio puede caer un cumpleaños. Solo se avisa de
 * lo que no se explica por eso.
 *
 * No bloquea nada: avisa. Decidir qué hacer con un desajuste es de la consulta,
 * no del software.
 */

import { Op } from "sequelize";
import { edadDesde } from "../clients/formularioAlta.js";

/** Saca la edad declarada de las respuestas guardadas (array de {key,value}). */
export function edadDeLasRespuestas(answers) {
  const lista = Array.isArray(answers) ? answers : [];
  const fila = lista.find((r) => r && r.key === "edad");
  const n = Number.parseInt(String(fila?.value ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 && n < 130 ? n : null;
}

/**
 * Compara ficha y formulario.
 *
 * Devuelve `null` cuando no hay nada que decir (sin bandeja, sin solicitud, sin
 * edad declarada, sin fecha de nacimiento, o cuadran). Cuando NO cuadran,
 * devuelve `{ declarada, real }`.
 *
 * Nunca lanza: es una comprobación de cortesía dentro de una operación que tiene
 * que salir bien igualmente.
 */
export async function desajusteDeEdad({ FormSubmission, email, birthDate }) {
  try {
    if (!FormSubmission || !email || !birthDate) return null;

    const real = edadDesde(String(birthDate).slice(0, 10));
    if (real == null) return null;

    const solicitud = await FormSubmission.findOne({
      where: { email: { [Op.iLike]: String(email) } },
      order: [["createdAt", "DESC"]],
      attributes: ["answers"],
    });
    const declarada = edadDeLasRespuestas(solicitud?.answers);
    if (declarada == null) return null;

    // La solicitud es anterior a la ficha, así que la edad real solo puede ser
    // la misma o una más. Cualquier otra diferencia —en los dos sentidos— es la
    // que se enseña.
    if (real === declarada || real === declarada + 1) return null;
    return { declarada, real };
  } catch {
    return null;
  }
}
