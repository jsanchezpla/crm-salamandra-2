/**
 * lib/auth/contrasena.js — qué contraseña se acepta cuando alguien elige la suya.
 *
 * (Fichero en /lib, regla #2: lo miran el endpoint que la cambia y la pantalla
 * que la pide, y las reglas tienen que ser LAS MISMAS en los dos o la pantalla
 * dice que vale y el servidor la rechaza. Es lógica pura y la fija
 * `scripts/_smoke-contrasena.mjs`.)
 *
 * ── TRES REGLAS, Y QUE SE VEAN (26/08/2026, Jorge) ────────────────────────
 *
 * Más de siete caracteres, una mayúscula y un número. Nada más.
 *
 * No hay «y un símbolo», y no hay filtros de «esto se adivina». Este fichero
 * llegó a tener cuatro —el mismo carácter repetido, las tiradas de teclas
 * seguidas, una lista de contraseñas de siempre, y el nombre del centro o del
 * usuario con o sin el año detrás— y se quitaron todos: en un centro donde la
 * dirección reparte contraseñas por teléfono, cada regla de más es una llamada
 * de vuelta preguntando por qué no le deja.
 *
 * Lo que SÍ se hace, y es la mitad que faltaba: **decirlo antes**. `requisitosDe`
 * devuelve los tres requisitos con su frase y si se cumplen, y la pantalla los
 * pinta marcándose mientras se escribe. Una regla que solo aparece cuando ya has
 * fallado es la que hace que la gente escriba la contraseña en un papel.
 *
 * ⚠️ Sigue aceptando `Aumenta2026` y `Password1`. Los logins de un cliente son
 * adivinables por construcción (`nombre_aumenta`), así que el nombre del centro
 * con el año detrás es literalmente el primer intento de cualquiera. Se acepta
 * porque se decidió aceptarlo; volver a cerrarlo son diez líneas y su caso en la
 * prueba. Lo que hay en medio mientras tanto es el cerrojo por CUENTA+IP de
 * `lib/auth/loginGuard.js`.
 */

/**
 * Ocho, que es «más de siete».
 *
 * Empezó en diez y bajó el mismo día que se pidió dejar elegir la contraseña.
 * Ocho es el suelo que se cita en todas partes, y con la mayúscula y el número
 * delante ya no es «lo mínimo de lo mínimo».
 *
 * Si hace falta moverlo, se mueve SOLO este número: la pantalla lo lee de aquí
 * (o del servidor, que lo devuelve en `GET /api/auth/password`), así que no
 * puede quedarse una copia diciendo otra cosa. Lo vigila la prueba.
 */
export const MINIMO = 8;

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

/**
 * Los bytes que ocupa de verdad, que es lo que mira bcrypt.
 *
 * ⚠️ `TextEncoder` y no `Buffer`: este fichero lo importa también la PANTALLA
 * (`components/team/AccessSection.jsx`) para pintar los requisitos mientras se
 * escribe, y `Buffer` no existe en el navegador. Con `Buffer` aquí el módulo
 * reventaría al cargarse en cliente — y eso es exactamente lo que esta librería
 * viene a evitar: que la pantalla y el servidor cuenten cosas distintas.
 */
export const bytesDe = (texto) => new TextEncoder().encode(String(texto ?? "")).length;

/**
 * Cuántos caracteres son de verdad, contando como cuenta una persona.
 *
 * `"".length` cuenta unidades UTF-16, y un emoji ocupa DOS. Con `.length`, cinco
 * emojis pasaban por diez caracteres y colaban el mínimo. Con `[...texto]` se
 * cuentan los caracteres que se ven.
 */
export const largoDe = (texto) => [...String(texto ?? "")].length;

/**
 * Los tres requisitos, en UN solo sitio: su frase y cómo se comprueban.
 *
 * De aquí salen las dos cosas que antes se escribían por separado y se
 * desviaban: el texto que lee la persona y el `if` que la rechaza. `texto` está
 * redactado como una instrucción («Más de 7 caracteres»), no como un reproche,
 * porque se enseña ANTES de escribir nada.
 *
 * `\p{Lu}` y no `[A-Z]`: «Ñ» y «Á» son mayúsculas y alguien las va a usar.
 * `\p{Nd}` y no `[0-9]`: por lo mismo, y no cuesta nada.
 */
export const REQUISITOS = Object.freeze([
  { id: "largo", texto: `Más de ${MINIMO - 1} caracteres`, cumple: (t) => largoDe(t) >= MINIMO },
  { id: "mayuscula", texto: "Al menos una mayúscula", cumple: (t) => /\p{Lu}/u.test(t) },
  { id: "numero", texto: "Al menos un número", cumple: (t) => /\p{Nd}/u.test(t) },
]);

/**
 * Los requisitos con su estado para lo que se lleva escrito.
 *
 * La pantalla pinta esto tal cual: una lista que se va marcando. Con el campo
 * vacío devuelve los tres sin cumplir, que es justo lo que hay que enseñar al
 * abrir el formulario.
 *
 * @returns {{id: string, texto: string, cumple: boolean}[]}
 */
export function requisitosDe(texto) {
  const t = String(texto ?? "");
  return REQUISITOS.map(({ id, texto: frase, cumple }) => ({ id, texto: frase, cumple: cumple(t) }));
}

/** ¿Cumple los tres? Lo que usa la pantalla para apagar el botón. */
export const cumpleTodo = (texto) => REQUISITOS.every((r) => r.cumple(String(texto ?? "")));

/**
 * Qué está mal en una contraseña nueva, o `null` si está bien.
 *
 * Devuelve la frase que se le va a enseñar a una persona, no un código: quien
 * llama la pinta tal cual. Si se le pasa la de ahora, comprueba además que no
 * sea la misma — cambiarla por la misma es no cambiarla, y quien lo intenta se
 * cree que lo ha hecho.
 *
 * Los mensajes de los tres requisitos salen de `REQUISITOS`, así que no pueden
 * decir una cosa distinta de la que la pantalla acaba de prometer.
 *
 * `email` y `slug` se siguen aceptando y se ignoran a propósito: los pasan tres
 * sitios y quitarlos de todos por un cambio que se puede revertir en una tarde
 * es más ruido que dejarlos. Si dentro de un tiempo sigue sin haber reglas que
 * los usen, se caen.
 */
export function revisarContrasena(nueva, actual = null, { email = null, slug = null } = {}) {
  const texto = String(nueva ?? "");

  // Sin `trim`: los espacios de dentro cuentan y los de los extremos también.
  // Recortarlos aquí guardaría una contraseña distinta de la que se escribió, y
  // al entrar no valdría. (El login tampoco los recorta, y por lo mismo.)
  if (!texto) return "Escribe la contraseña nueva.";

  // El tope va ANTES que los requisitos: una contraseña larguísima los cumple
  // todos y aun así bcrypt le comería el final, y ese aviso es el que importa.
  if (bytesDe(texto) > MAXIMO) {
    return `La contraseña nueva es demasiado larga: el tope son ${MAXIMO} caracteres (algo menos si lleva tildes o emojis).`;
  }

  const faltan = requisitosDe(texto).filter((r) => !r.cumple);
  if (faltan.length) {
    // Se dicen TODOS los que faltan de una vez: enseñarlos de uno en uno obliga
    // a probar tres veces para enterarse de las tres reglas.
    return `La contraseña tiene que cumplir: ${faltan.map((r) => r.texto.toLowerCase()).join(", ")}.`;
  }

  if (actual !== null && texto === String(actual)) {
    return "Esa es la que ya tenías. Elige otra.";
  }

  return null;
}
