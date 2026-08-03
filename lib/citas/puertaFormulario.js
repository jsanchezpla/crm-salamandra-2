/**
 * Puerta de admisión: quién puede reservar cita.
 *
 * Nace de nutri_laura (03/08/2026). Su web manda a la gente al formulario de
 * las siete preguntas, ella lo revisa en la bandeja y acepta o descarta. Pero
 * la agenda pública NO miraba nada de eso: cualquiera con el enlace del widget
 * reservaba, hubiera pasado por el formulario o no. Con retención de tarjeta de
 * por medio eso es peor todavía, porque se le bloquea dinero a alguien que la
 * profesional no ha admitido.
 *
 * Regla, decidida por el usuario: **se aplica a todos** —también a los
 * pacientes de antes, que ya están avisados— y **a todos los tipos de cita**.
 * Y no es una puerta cerrada: a quien no ha pasado por el formulario se le
 * enseña el aviso con el enlace, no un "no".
 *
 * Apagada por defecto. Se enciende por tenant en Configuración → Citas, y solo
 * tiene efecto si el tenant tiene el módulo `formularios`: sin bandeja donde
 * aceptar a nadie, la puerta dejaría fuera al 100% de la gente.
 */

import { Op } from "sequelize";

/** ¿Este tenant exige formulario aceptado para reservar? */
export function exigeFormularioAceptado(tenant) {
  return tenant?.settings?.citas?.formularioObligatorio === true;
}

/** Enlace al formulario público (vive en la web del cliente, no en el CRM). */
export function urlDelFormulario(tenant) {
  const url = tenant?.settings?.citas?.formularioUrl;
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

/**
 * Estado de admisión de un email.
 *
 * Devuelve uno de:
 *   "aceptada"    — tiene solicitud aceptada: puede reservar
 *   "pendiente"   — la mandó y está en la bandeja, sin revisar
 *   "descartada"  — la mandó y no se aceptó
 *   "sin_enviar"  — no hay ninguna solicitud con ese email
 *   "sin_bandeja" — no se pudo mirar (tabla ausente, BD caída): se cierra
 *
 * Se mira SOLO por email porque es lo único que compartimos entre el
 * formulario y la reserva. Con `iLike` porque el formulario guarda lo que la
 * persona teclee y nadie escribe su correo dos veces igual.
 */
export async function estadoDeAdmision(FormSubmission, email) {
  if (!FormSubmission || !email) return "sin_enviar";

  let suyas;
  try {
    suyas = await FormSubmission.findAll({
      where: { email: { [Op.iLike]: email } },
      attributes: ["status"],
      limit: 50,
    });
  } catch (err) {
    // Tener el módulo NO garantiza tener la tabla: el schema de nutri_laura en
    // local tiene `formularios` activo y `form_submissions` sin crear. Sin este
    // try la agenda pública devolvería un 500 a cada persona que intente pedir
    // cita, que es la peor de las tres salidas posibles.
    //
    // Se cierra, no se abre: quien enciende la puerta quiere filtrar, y dejar
    // pasar a todo el mundo en silencio vacía la única defensa que había. El
    // comprobador previo (scripts/comprobar-citas.js) avisa de esto ANTES de
    // que le pase a nadie.
    process.stderr.write(`[puerta-formulario] no se pudo consultar la bandeja: ${err.message}\n`);
    return "sin_bandeja";
  }

  if (!suyas.length) return "sin_enviar";
  // Una aceptada manda sobre el resto: quien fue admitido y luego mandó otra
  // solicitud sin revisar sigue siendo paciente, no vuelve a la cola.
  if (suyas.some((s) => s.status === "accepted")) return "aceptada";
  if (suyas.some((s) => s.status === "pending")) return "pendiente";
  return "descartada";
}

/**
 * Traduce el estado a lo que se le responde a quien intenta reservar.
 *
 * `identificado` = la petición trae sesión verificada del portal, así que
 * sabemos que el email es de verdad suyo. Solo entonces se le puede decir
 * "tu solicitud está en revisión": a una petición anónima, decirle si un email
 * concreto está aceptado o pendiente convierte este endpoint en un buscador de
 * pacientes de la consulta. A esos se les da siempre el mismo mensaje.
 */
export function mensajeDePuerta(estado, { identificado = false, nombre = null } = {}) {
  const quien = nombre ? ` de ${nombre}` : "";

  // No se ha podido mirar la bandeja: no es culpa suya y no hay nada que
  // pueda hacer, así que ni se le manda al formulario ni se le insinúa que le
  // falte algo.
  if (estado === "sin_bandeja") {
    return {
      codigo: "ADMISION_NO_DISPONIBLE",
      titulo: "Ahora mismo no podemos dar cita",
      texto: "Estamos teniendo un problema técnico con las solicitudes. Inténtalo de nuevo en un rato.",
      mostrarEnlace: false,
    };
  }

  if (identificado && estado === "pendiente") {
    return {
      codigo: "ADMISION_PENDIENTE",
      titulo: "Tu solicitud está en revisión",
      texto: `Ya hemos recibido tus respuestas. En cuanto el equipo${quien} las revise te avisamos por correo y podrás reservar.`,
      mostrarEnlace: false,
    };
  }

  return {
    codigo: "ADMISION_REQUERIDA",
    titulo: "Antes de reservar, cuéntanos tu caso",
    texto: `Para dar cita hace falta que completes primero un formulario breve. Es lo que el equipo${quien} necesita para preparar tu consulta.`,
    mostrarEnlace: true,
  };
}
