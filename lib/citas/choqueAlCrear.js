/**
 * lib/citas/choqueAlCrear.js — con qué ha chocado una cita al crearla, si ese
 * choque SE PUEDE FORZAR, y QUÉ PASA si se fuerza.
 *
 * (18/09/2026, AV-0166 de Aumenta: «al crear una cita y te pone el mensaje de
 * (Ese hueco está bloqueado) si le dan a Crearla igualmente no hace nada,
 * convendría saber el funcionamiento que hace cuando sale ese mensaje».)
 *
 * ── QUÉ ARREGLÓ YA AV-0167, Y QUÉ QUEDABA ───────────────────────────────────
 * El mismo día, AV-0167 partió el 409 en dos (`motivo: "bloqueo" | "solape"`) y
 * quitó el botón muerto: encima de una cita no cabe otra, así que al solape ya
 * no se le ofrece «Crearla igualmente». Eso era la mitad de la tarea.
 *
 * Quedaban tres cosas, que son las que viven aquí:
 *
 *   1. La regla estaba en el JSX, y encima olfateando el TEXTO del error
 *      (`/^Solapa con otra cita/`). Regla #2 y regla 16 de CLAUDE.md: «se puede
 *      forzar o no» es una regla con nombre y con prueba. Si el día que se
 *      añada un cuarto motivo la pantalla tiene su propia lista, ofrecerá
 *      forzar algo que el servidor no perdona — que es el fallo de origen.
 *   2. El FESTIVO no mandaba `motivo`, así que caía en el `else` y salía con el
 *      título «Ese hueco está bloqueado». El centro cerrado no es un hueco
 *      bloqueado, y quien lo lee va a buscar un bloqueo que no existe.
 *   3. El aviso del bloqueo era la frase pelada del servidor: no decía de quién
 *      es el bloqueo ni qué pasa si se crea igualmente. Es la otra mitad de lo
 *      que se pidió, y el mismo patrón que el aviso de cancelar una cita de
 *      bono (58e4edcd): el hecho, la consecuencia, y lo que NO cambia.
 *
 * ── LOS TRES MOTIVOS ────────────────────────────────────────────────────────
 *   · festivo → se perdona con `permitirFestivo` (el centro manda: una urgencia
 *               el día del puente se apunta igual)
 *   · bloqueo → se perdona con `permitirBloqueo` (ídem: se atiende a la vuelta
 *               de unas vacaciones)
 *   · solape  → NO se perdona. No es una decisión del centro: la cita que ya
 *               está ahí seguiría estando.
 *
 * Sin imports a propósito: lo lee el navegador.
 */

export const MOTIVO_FESTIVO = "festivo";
export const MOTIVO_BLOQUEO = "bloqueo";
export const MOTIVO_SOLAPE = "solape";

/**
 * Qué perdón reabre cada puerta. El solape no tiene, y ese `null` ES la
 * respuesta a «¿se puede forzar?»: una sola lista, no dos que se desincronicen.
 */
const PERDON = {
  [MOTIVO_FESTIVO]: { permitirFestivo: true },
  [MOTIVO_BLOQUEO]: { permitirBloqueo: true },
  [MOTIVO_SOLAPE]: null,
};

/**
 * El motivo de un 409, tolerando respuestas que no lo traen.
 *
 * `motivo` se añadió el 18/09/2026: un 409 de antes —o de otro sitio— llega sin
 * él, y el texto es lo único que hay. Se mira SOLO como red de seguridad, y
 * solo para el solape, que es el que no se puede forzar: equivocarse hacia
 * «no forzable» deja a alguien sin un botón que sí valía; equivocarse hacia
 * «forzable» le devuelve el botón muerto de AV-0166.
 */
export function motivoDelChoque({ motivo = null, error = "" } = {}) {
  if (motivo && Object.prototype.hasOwnProperty.call(PERDON, motivo)) return motivo;
  if (/^Solapa con otra cita/i.test(String(error ?? "").trim())) return MOTIVO_SOLAPE;
  return motivo ?? null;
}

/** ¿Este choque se puede saltar insistiendo? Lo que no se reconoce, no. */
export function esForzable(motivo) {
  return PERDON[motivo] != null;
}

/**
 * Lo que hay que añadir al cuerpo del POST para insistir. `{}` para lo que no se
 * perdona, para que nadie reenvíe un perdón que el servidor ignora y se quede
 * esperando un resultado distinto.
 */
export function perdonDelChoque(motivo) {
  return PERDON[motivo] ? { ...PERDON[motivo] } : {};
}

/**
 * Los perdones de una cita que ya se decidió forzar, para arrastrarlos a las
 * repeticiones de la serie.
 *
 * Van los DOS a propósito, como desde AV-0105: la decisión se toma una vez y
 * vale para toda la serie, y las repeticiones caen en días distintos donde lo
 * que choca puede ser el otro. Volver a preguntarlo cuarenta veces no es
 * prudencia, es no dejar trabajar.
 */
export function perdonesDeSerie({ insistio = false, desdeBloqueo = false } = {}) {
  return {
    ...(insistio ? { ...PERDON[MOTIVO_FESTIVO], ...PERDON[MOTIVO_BLOQUEO] } : {}),
    ...(desdeBloqueo ? { ...PERDON[MOTIVO_BLOQUEO] } : {}),
  };
}

/**
 * QUÉ SE LE DICE A QUIEN APUNTA LA CITA.
 *
 * La consecuencia que más importa y que nadie sabía: **forzar la cita no quita
 * el bloqueo**. El hueco sigue cerrado, así que el widget público sigue sin
 * ofrecer esa hora (`restarAusencias` en las dos rutas de disponibilidad, y
 * `book/route.js` la rechaza además al reservar). Lo que queda es una cita
 * dentro de un rato marcado como no disponible, visible solo por dentro.
 *
 * @param motivo      uno de los tres; lo que no se reconozca se trata como NO
 *                    forzable (ofrecer un botón que no hace nada es el fallo)
 * @param error       la frase del servidor, que ya da el detalle (cuántos
 *                    bloqueos hay y con qué rótulo, con qué cita solapa)
 * @param deQuien     "centro" | "profesional" — de quién es el bloqueo
 * @param profesional nombre de quien atiende, si se sabe
 * @param enSerie     hay repeticiones detrás: el solape no corta la serie
 * @param cuantas     cuántas repeticiones quedan (solo con `enSerie`)
 * @returns { forzable, titulo, texto, confirmar? }
 */
export function avisoDeChoque({
  motivo,
  error = "",
  deQuien = null,
  profesional = null,
  enSerie = false,
  cuantas = 0,
} = {}) {
  const cual = motivoDelChoque({ motivo, error });
  const detalle = String(error ?? "").trim();
  const conDetalle = (resto) => (detalle ? `${detalle}\n\n${resto}` : resto);

  if (cual === MOTIVO_BLOQUEO) {
    const duenoEs =
      deQuien === "centro"
        ? "Es un bloqueo del centro: tapa la agenda de todo el mundo."
        : profesional
          ? `Es un bloqueo de ${profesional}, que es quien atiende esta cita.`
          : "Es un bloqueo de la persona que atiende esta cita.";
    return {
      forzable: true,
      titulo: "Ese hueco está bloqueado",
      texto: conDetalle(
        `${duenoEs}\n\n` +
          "Si la creas igualmente, la cita se apunta dentro del bloqueo y el bloqueo SE QUEDA: " +
          "el hueco sigue cerrado, así que en la web esa hora no se le ofrece a nadie. " +
          "La cita solo se ve desde dentro del CRM.\n\n" +
          "Para abrir el hueco de verdad, quita el bloqueo en Citas → Bloqueos."
      ),
      confirmar: "Crearla igualmente",
    };
  }

  if (cual === MOTIVO_FESTIVO) {
    return {
      forzable: true,
      titulo: "Ese día el centro está cerrado",
      texto: conDetalle(
        "Si la creas igualmente, la cita queda apuntada ese día y el cierre SE QUEDA: " +
          "el día sigue sin ofrecerse en la web, y las demás agendas siguen cerradas.\n\n" +
          "Al paciente se le avisa como en cualquier otra cita."
      ),
      confirmar: "Crearla igualmente",
    };
  }

  // Solape, y cualquier motivo que no se reconozca: no hay nada que forzar.
  // Con una serie detrás no se corta —las repeticiones sí saben saltarse las
  // que chocan— y se ofrece seguir con ellas (AV-0167).
  if (enSerie) {
    return {
      forzable: false,
      titulo: "Ahí ya hay otra cita",
      texto: conDetalle(
        "Esa primera no se puede crear: encima de una cita no cabe otra.\n\n" +
          `¿Sigo con las otras ${cuantas} y te digo cuáles entran?`
      ),
      confirmar: cuantas === 1 ? "Probar con la otra" : `Probar con las otras ${cuantas}`,
    };
  }
  return {
    forzable: false,
    titulo: "Ahí ya hay otra cita",
    texto: conDetalle(
      "Esa hora ya está ocupada en su agenda y no es algo que se pueda forzar: " +
        "sería la misma persona en dos sitios a la vez.\n\n" +
        "Ponla a otra hora, elige a otra persona, o mueve primero la cita que ya está ahí."
    ),
  };
}
