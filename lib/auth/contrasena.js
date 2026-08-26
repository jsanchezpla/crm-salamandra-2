/**
 * lib/auth/contrasena.js — qué contraseña se acepta cuando alguien elige la suya.
 *
 * (Fichero nuevo en /lib, regla #2: lo va a mirar el endpoint que la cambia y
 * la pantalla que la pide, y las reglas tienen que ser LAS MISMAS en los dos o
 * la pantalla dice que vale y el servidor la rechaza. Es lógica pura y la fija
 * `scripts/_smoke-contrasena.mjs`.)
 *
 * ── POR QUÉ TAN POCAS REGLAS ──────────────────────────────────────────────
 * Aquí no hay «una mayúscula, un número y un símbolo». Esas reglas no hacen las
 * contraseñas más difíciles de adivinar, hacen las contraseñas más difíciles de
 * RECORDAR — y lo que la gente hace entonces es escribirlas en un papel pegado
 * al monitor o repetir la del correo. En un centro donde 15 de 16 personas no
 * son admin y entran cada mañana, eso es exactamente el problema que se venía a
 * quitar: se les daba una contraseña aleatoria que no podían memorizar.
 *
 * Lo único que se exige es LARGO. Es lo que de verdad cuesta de adivinar, y es
 * la recomendación de todo el mundo desde que se dejó de creer en los símbolos.
 */

/**
 * Diez, y no ocho.
 *
 * Ocho es el suelo que se cita siempre, pero esto no es una web de tienda: da
 * acceso a fichas clínicas de más de mil familias. Diez sigue siendo una frase
 * corta («el gato gris») y no empuja a nadie al papelito. Lo que NO se acepta,
 * por corta que sea de escribir, es lo que se adivina en los primeros intentos:
 * el nombre del centro, el del usuario, y las tiradas de teclas seguidas.
 */
export const MINIMO = 10;

/**
 * Setenta y dos, y este número NO es un gusto: es un límite de bcrypt.
 *
 * bcrypt solo mira los primeros 72 BYTES y **descarta el resto en silencio**.
 * Sin este tope, dos contraseñas larguísimas que compartan los primeros 72
 * bytes abrirían la misma cuenta, y nadie lo notaría jamás. Se corta aquí, con
 * un mensaje, en vez de dejar que se pierda por debajo.
 *
 * Se cuenta en BYTES y no en caracteres a propósito: una tilde ocupa dos y un
 * emoji hasta cuatro, así que contar letras dejaría pasar cadenas que bcrypt sí
 * recorta.
 */
export const MAXIMO = 72;

/** Los bytes que ocupa de verdad, que es lo que mira bcrypt. */
export const bytesDe = (texto) => Buffer.byteLength(String(texto ?? ""), "utf8");

/**
 * Cuántos caracteres son de verdad, contando como cuenta una persona.
 *
 * `"".length` cuenta unidades UTF-16, y un emoji ocupa DOS. Con `.length`, cinco
 * emojis pasaban por diez caracteres y colaban el mínimo. Con `[...texto]` se
 * cuentan los caracteres que se ven.
 */
export const largoDe = (texto) => [...String(texto ?? "")].length;

/**
 * ── EL SUELO QUE SÍ HACE FALTA ────────────────────────────────────────────
 * No exigir composición es la decisión correcta; dejarlo SIN NINGÚN suelo, no.
 * Antes de esto la contraseña eran 12 caracteres aleatorios: para adivinarla no
 * quedaba más que la fuerza bruta. Si ahora se acepta cualquier cosa de diez, lo
 * que hay al otro lado es «nombre del centro + año» — y los logins de Aumenta
 * son adivinables por construcción (`nombre_aumenta`), con un cerrojo que
 * permite ~2.880 intentos al día por cuenta desde IPs rotadas.
 *
 * Así que se rechaza lo que se adivina en el primer puñado de intentos, y nada
 * más. No es un medidor de fuerza: son cuatro cosas concretas.
 */

/** Un solo carácter repetido: «aaaaaaaaaa», «..........». */
const UN_SOLO_CARACTER = /^(.)\1*$/u;

/**
 * Secuencias que se escriben sin pensar, en los dos sentidos.
 *
 * ⚠️ Los dígitos llevan el 0 A LOS DOS LADOS, y no es un descuido (26/08/2026).
 * En un teclado la fila va `1234567890`, no `0123456789`, así que la tirada que
 * la gente escribe de verdad es la que EMPIEZA por el 1 y acaba en el 0. Con la
 * tira canónica, `"0123456789".includes("1234567890")` es falso —y su reverso
 * también—, o sea que `1234567890` pasaba el filtro y se aceptaba como
 * contraseña. Lo cazó `_smoke-team-contrasena-elegida.mjs` el día que se
 * permitió a dirección escribir la contraseña de otra persona, pero el agujero
 * estaba desde que se escribió este fichero y afectaba igual a «cambiar mi
 * contraseña». Con el 0 repetido, la tira contiene las dos vueltas.
 */
const SEGUIDAS = ["abcdefghijklmnopqrstuvwxyz", "01234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm"];

/** Las que aparecen siempre en cualquier lista de las más usadas en castellano. */
const DE_SIEMPRE = [
  "contrasena", "contraseña", "password", "123456", "administrador", "salamandra",
  "bienvenido", "usuario", "clinica", "consulta", "paciente", "iloveyou", "qwerty",
];

/** ¿Es `texto` un trozo seguido de alguna de las tiras de arriba? */
function esUnaSeguida(texto) {
  const t = texto.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (t.length < 4) return false;
  for (const tira of SEGUIDAS) {
    const alReves = [...tira].reverse().join("");
    if (tira.includes(t) || alReves.includes(t)) return true;
  }
  return false;
}

/**
 * Quita del texto los números del final y los separadores, para que «aumenta»,
 * «aumenta2026» y «Aumenta-2026» se traten como lo mismo: añadir el año no
 * convierte el nombre del centro en una contraseña.
 */
const desnudar = (texto) =>
  String(texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .replace(/[0-9]+$/, "");

/**
 * Qué está mal en una contraseña nueva, o `null` si está bien.
 *
 * Devuelve la frase que se le va a enseñar a una persona, no un código: quien
 * llama la pinta tal cual. Si se le pasa la de ahora, comprueba además que no
 * sea la misma — cambiarla por la misma es no cambiarla, y quien lo intenta se
 * cree que lo ha hecho.
 */
export function revisarContrasena(nueva, actual = null, { email = null, slug = null } = {}) {
  const texto = String(nueva ?? "");

  // Sin `trim`: los espacios de dentro cuentan y los de los extremos también.
  // Recortarlos aquí guardaría una contraseña distinta de la que se escribió, y
  // al entrar no valdría. (El login tampoco los recorta, y por lo mismo.)
  if (!texto) return "Escribe la contraseña nueva.";

  if (largoDe(texto) < MINIMO) {
    return `La contraseña nueva tiene que tener al menos ${MINIMO} caracteres.`;
  }
  if (bytesDe(texto) > MAXIMO) {
    return `La contraseña nueva es demasiado larga: el tope son ${MAXIMO} caracteres (algo menos si lleva tildes o emojis).`;
  }
  if (actual !== null && texto === String(actual)) {
    return "Esa es la que ya tenías. Elige otra.";
  }

  if (UN_SOLO_CARACTER.test(texto)) {
    return "Esa es el mismo carácter repetido. Elige algo que puedas recordar y que no se adivine.";
  }
  if (esUnaSeguida(texto)) {
    return "Esa es una tirada de teclas seguidas. Se adivina en los primeros intentos.";
  }

  /*
   * Que no sea el nombre del cliente ni el del usuario, ni con el año detrás.
   * Es la contraseña que pone todo el mundo cuando le dejas elegir, y es la
   * PRIMERA que probaría cualquiera que sepa a qué centro está atacando —que es
   * público, está en la web—.
   */
  const desnuda = desnudar(texto);
  const prohibidas = [
    ...DE_SIEMPRE,
    slug ? desnudar(slug) : null,
    // Solo la parte de delante del correo: el dominio lo comparte todo el centro.
    email ? desnudar(String(email).split("@")[0]) : null,
  ].filter((p) => p && p.length >= 4);

  /*
   * ⚠️ El `desnuda.length >= 4` no es una optimización: sin él, una contraseña
   * que al desnudarla se queda VACÍA —«0987654321», que es todo dígitos y
   * `desnudar` les quita los del final— casaba con todas las prohibidas, porque
   * `"loquesea".includes("")` es verdad. Rechazaba cosas legítimas dando el
   * motivo equivocado.
   */
  if (desnuda.length >= 4) {
    for (const mala of prohibidas) {
      if (desnuda === mala || desnuda.includes(mala) || mala.includes(desnuda)) {
        return "Esa se adivina demasiado fácil: no uses tu nombre de usuario, el del centro, ni una contraseña conocida.";
      }
    }
  }

  return null;
}
