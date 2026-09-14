/**
 * lib/ai/errorLegible.js — qué se le dice al usuario cuando la IA falla.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten los endpoints que llaman a
 * Claude, y la frase tiene que ser la misma en todos.)
 *
 * ── QUÉ RESUELVE (01/09/2026, Rodrigo: «la IA de Proyectos no funciona») ────
 * Cuando la llamada a Anthropic reventaba, el error subía tal cual hasta
 * `handleRouteError`, que en producción lo convierte en «Error interno del
 * servidor» y escribe el motivo REAL solo en los logs del contenedor. Desde la
 * pantalla eso es indistinguible de un bug: no se sabe si falta la clave, si
 * está caducada, si el modelo elegido ya no existe o si sencillamente había
 * que esperar más. Y sin saberlo, nadie puede arreglarlo solo.
 *
 * Aquí se traduce el error del SDK a una frase que dice QUÉ pasa y DÓNDE se
 * toca. Se reconoce por pato (`status`, `name`), sin importar el SDK: así esto
 * se puede probar con `node:test` sin arrastrar `@anthropic-ai/sdk` ni Next.
 *
 * `esErrorDeIa(err)` dice si el error viene de la llamada a la IA; quien llama
 * decide el código HTTP (503 cuando el problema es de configuración o del
 * proveedor, que es lo que son todos estos).
 *
 * (13/09/2026, regla #2) Ya no es solo de los endpoints que llaman a Claude:
 * lo leen también Whisper (`lib/clinica/whisper.js`, cuyos errores llevan desde
 * ese día `status`, `proveedor` y `servicio: "audio"`) y el aviso a dirección
 * del cliente central (`lib/ai/avisoDeCuentaIa.js`, que titula con
 * `cuentaDelError`). Por eso las frases de clave y permiso nombran la CUENTA
 * (Anthropic u OpenAI), `esFalloDeCuenta` reconoce los códigos de Whisper y
 * `esFalloDeSaldo` lee también el código del cuerpo. Dos frases nuevas:
 * `avisoSinIa`, para los sustitutos sin IA (bot, huecos, semana, portal), y
 * `motivoDelFalloIa`, que es `mensajeDeErrorIa` con el corte por tiempo dicho
 * en general —la frase de siempre habla de «describir el proyecto», porque
 * este fichero nació en Proyectos—.
 */

/*
 * Desde el 12/09/2026 la IA de texto puede ser Claude o ChatGPT
 * (`lib/ai/proveedorIa.js`), y las frases que nombran LA CUENTA tienen que
 * nombrar la que toca: el error de OpenAI llega con `proveedor: "openai"`
 * (`lib/ai/openai.js`); sin esa marca, es de Anthropic, que es lo que había.
 */
function proveedorDe(err) {
  return err?.proveedor === "openai" ? "openai" : "anthropic";
}

const CUENTA = { anthropic: "Anthropic", openai: "OpenAI" };

/**
 * «Anthropic» u «OpenAI»: la cuenta a la que pertenece el error. Lo usa el
 * título de la campana (`lib/ai/avisoDeCuentaIa.js`) desde el 13/09/2026, para
 * que el fallo de una cuenta no tape 12 h el de la otra.
 */
export function cuentaDelError(err) {
  return CUENTA[proveedorDe(err)];
}

/*
 * (13/09/2026) El 401 y el 403 nombran la cuenta: con los dos proveedores, «la
 * clave de IA» ya no dice cuál de las dos claves hay que revisar.
 */
function porEstado(status, proveedor) {
  const cuenta = CUENTA[proveedor] ?? CUENTA.anthropic;
  return {
    400: "La IA ha rechazado la petición. Prueba a acortar o reformular el texto.",
    401: `La clave de ${cuenta} de este cliente no es válida o ha caducado. Revísala en Configuración → IA.`,
    403: `La clave de ${cuenta} no tiene permiso para este modelo. Revisa el modelo elegido en Configuración → IA.`,
    404: "El modelo de IA configurado ya no existe. Elige otro en Configuración → IA.",
    413: "El texto es demasiado largo para la IA. Prueba a acortarlo.",
    429: `La cuenta de IA ha llegado a su límite de uso. Espera unos minutos o revisa el saldo en la cuenta de ${cuenta}.`,
    500: "La IA ha fallado por su lado. Vuelve a intentarlo en un momento.",
    529: "La IA está saturada ahora mismo. Vuelve a intentarlo en un par de minutos.",
  }[status];
}

const TIMEOUT =
  "La IA ha tardado demasiado y se ha cortado. Vuelve a intentarlo, o describe el proyecto con menos detalle.";

// El mismo corte, sin lo del proyecto: para todo lo que no es Proyectos (13/09/2026).
const CORTE = "La IA ha tardado demasiado y se ha cortado.";

/*
 * El 403 de Whisper (13/09/2026). La frase genérica del 403 manda a revisar
 * «el modelo elegido en Configuración → IA», y en Whisper el modelo no lo elige
 * el centro (`whisper-1` va fijo): lo que falla es el permiso de la clave para
 * transcribir. Whisper marca sus errores con `servicio: "audio"`.
 */
const SIN_PERMISO_AUDIO =
  "La clave de OpenAI de este centro no tiene permiso para transcribir audio. Revísala en platform.openai.com o en Configuración → Conexiones.";

/*
 * Sin saldo (11/09/2026, Aumenta). Anthropic lo manda como **400
 * invalid_request_error**, el mismo código que «petición mal hecha», y solo se
 * distingue por el texto: «Your credit balance is too low…». Con la frase
 * genérica del 400 («acorta el texto») cuatro terapeutas pasaron una tarde
 * reintentando y abriendo tickets; el CRM no estaba roto, la cuenta estaba a
 * cero. Repetir no lo arregla: lo arregla quien lleve la cuenta de Anthropic.
 *
 * OpenAI lo manda de otra forma: un **429** con `code: "insufficient_quota"`
 * («You exceeded your current quota»), que sin mirar el código se confundiría
 * con un límite por minuto («espera unos minutos»). Se recarga en
 * platform.openai.com → Settings → Billing.
 */
const SIN_SALDO = {
  anthropic:
    "La cuenta de Anthropic de este centro se ha quedado sin saldo: la IA no responderá hasta que se recarguen créditos en console.anthropic.com (Plans & Billing). No es un fallo del CRM y repetir no lo arregla.",
  openai:
    "La cuenta de OpenAI de este centro se ha quedado sin saldo: la IA no responderá hasta que se recarguen créditos en platform.openai.com (Settings → Billing). No es un fallo del CRM y repetir no lo arregla.",
};

/**
 * El texto del error, esté donde esté: el SDK lo pone en `message` y también en
 * `error.error.message`; se miran TODOS, que un `message` de «400 status code
 * (no body)» no tape el cuerpo donde sí viene el motivo.
 */
function textoDelError(err) {
  return [err?.message, err?.error?.error?.message, err?.error?.message]
    .filter((t) => typeof t === "string" && t)
    .join(" ");
}

/** ¿El proveedor ha rechazado la llamada por falta de saldo en la cuenta? */
export function esFalloDeSaldo(err) {
  if (!err) return false;
  // Anthropic: un 400 cuyo texto habla del saldo.
  if (err.status === 400) return /credit balance/i.test(textoDelError(err));
  // OpenAI: un 429 con el código de cuota agotada (no el de límite por minuto).
  if (err.status === 429) {
    // El código puede venir en el error (`lib/ai/openai.js`) o solo en el
    // cuerpo que se guarda (`lib/clinica/whisper.js`, 13/09/2026).
    return (
      err.code === "insufficient_quota" ||
      err?.error?.error?.code === "insufficient_quota" ||
      /insufficient_quota|exceeded your current quota/i.test(textoDelError(err))
    );
  }
  return false;
}

/**
 * ¿Se arregla en la CUENTA de IA del cliente —saldo, clave, permiso del
 * modelo, límite de uso— y no volviendo a pulsar? Es lo que decide si se avisa
 * a los administradores del tenant (lib/ai/avisoDeCuentaIa.js).
 *
 * (13/09/2026) Los errores de Whisper llevan `code` BAD_KEY/QUOTA además del
 * `status`; con la marca `proveedor: "openai"` se reconocen aunque faltara el
 * estado. Sin la marca no: Google Places usa los mismos códigos y su clave no
 * es la de la IA.
 */
export function esFalloDeCuenta(err) {
  if (err?.proveedor === "openai" && (err.code === "BAD_KEY" || err.code === "QUOTA")) return true;
  if (esFalloDeSaldo(err)) return true;
  const s = typeof err?.status === "number" ? err.status : null;
  return s === 401 || s === 403 || s === 429;
}

/**
 * El nombre del error. El SDK de Anthropic (0.110) define sus clases sin
 * sobreescribir `name`: un APIConnectionTimeoutError llega con `name: "Error"`
 * y solo su CLASE dice lo que es. Por eso se mira `constructor.name` cuando
 * `name` no cuenta nada (revisión del 11/09/2026: hasta entonces ningún
 * timeout ni fallo de red del SDK se reconocía en producción).
 */
function nombreDelError(err) {
  const propio = typeof err?.name === "string" ? err.name : "";
  if (propio && propio !== "Error") return propio;
  const clase = typeof err?.constructor?.name === "string" ? err.constructor.name : "";
  return clase && clase !== "Error" ? clase : propio;
}

/** ¿Se ha cortado por tiempo? El corte por AbortSignal del propio timeout llega a veces como AbortError. */
function esCorte(err) {
  const nombre = nombreDelError(err);
  return nombre === "APIConnectionTimeoutError" || nombre === "AbortError" || nombre === "TimeoutError";
}

/** ¿Este error viene de la llamada a la IA (y no de nuestra propia lógica)? */
export function esErrorDeIa(err) {
  if (!err) return false;
  if (err.code === "NO_API_KEY") return true;
  const nombre = nombreDelError(err);
  if (nombre.startsWith("API") || nombre.startsWith("Anthropic") || nombre.startsWith("OpenAI")) return true;
  return typeof err.status === "number" && err.status >= 400;
}

/**
 * La frase para el usuario. `porDefecto` es lo que se dice cuando el error no
 * se reconoce: nunca se enseña el mensaje crudo del SDK, que trae URLs y
 * nombres de modelo que no significan nada para quien mira.
 */
export function mensajeDeErrorIa(err, porDefecto = "La IA no ha podido responder. Vuelve a intentarlo.") {
  if (!err) return porDefecto;
  const proveedor = proveedorDe(err);
  // Antes que el estado: el sin-saldo de Anthropic es un 400 y caería en
  // «acorta el texto»; el de OpenAI, un 429 que caería en «espera unos minutos».
  if (esFalloDeSaldo(err)) return SIN_SALDO[proveedor];

  const nombre = nombreDelError(err);
  if (esCorte(err)) return TIMEOUT;
  if (nombre === "APIUserAbortError") return "La petición a la IA se canceló antes de terminar.";
  if (nombre === "APIConnectionError") {
    return "No se ha podido conectar con la IA. Comprueba la conexión y vuelve a intentarlo.";
  }

  const status = typeof err.status === "number" ? err.status : null;
  if (status === 403 && err.servicio === "audio") return SIN_PERMISO_AUDIO;
  if (status && porEstado(status, proveedor)) return porEstado(status, proveedor);
  if (status && status >= 500) return porEstado(500, proveedor);

  return porDefecto;
}

/**
 * `mensajeDeErrorIa` para todo lo que NO es Proyectos (13/09/2026): igual en
 * todo, salvo que el corte por tiempo no habla de «describir el proyecto».
 * Lo usan los 502 y avisos que nacieron ese día (Desempeño, pulir, la IA del
 * ticket, mailing, Captación, el acta de reunión).
 */
export function motivoDelFalloIa(err, porDefecto) {
  return esCorte(err) ? `${CORTE} Vuelve a intentarlo.` : mensajeDeErrorIa(err, porDefecto);
}

/**
 * El motivo, para quien recibe un SUSTITUTO sin IA —el bot que contesta con la
 * ayuda del CRM, los huecos repartidos, las propuestas calculadas de la
 * semana— (13/09/2026). Hasta hoy esos sustitutos salían sin decir nada: un
 * fallo de la cuenta se veía como una respuesta normal y nadie se enteraba.
 *
 * `mientras` es lo que se ofrece en su lugar («Mientras tanto…»). El timeout va
 * aparte porque la frase de `mensajeDeErrorIa` habla de describir el proyecto,
 * que aquí no pinta nada.
 */
export function avisoSinIa(err, mientras = "") {
  const motivo = esCorte(err) ? CORTE : mensajeDeErrorIa(err, "La IA no ha podido responder.");
  return `${motivo} ${mientras}`.trim();
}
