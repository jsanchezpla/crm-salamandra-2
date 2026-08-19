/**
 * lib/fichaje/parseHora.js — leer HORAS y DURACIONES de una celda de Excel.
 *
 * Fichero nuevo a propósito: `lib/training/parseDate.js` resuelve las FECHAS y
 * se reutiliza tal cual (regla #2, no se toca). Lo genuinamente distinto aquí
 * son las horas de reloj y las duraciones, que en un Excel llegan de cinco
 * formas y ninguna avisa de cuál es.
 *
 * ── LAS CINCO FORMAS, VISTAS EN EL FICHERO REAL DE AUMENTA ──────────────────
 * En la MISMA columna, en filas contiguas, conviven:
 *
 *   1. `Date` con época 1899-12-30 → ExcelJS convierte así una celda con
 *      formato de hora. `1899-12-30T14:00:00.000Z` es «las 14:00». Se leen los
 *      componentes en **UTC**: pasarlos por la zona local los movería una hora.
 *   2. Texto `"13:50"` — la misma información escrita a mano.
 *   3. Texto `"8:30:00"` con segundos.
 *   4. Número fraccionario `0.5` = mediodía, que es como Excel guarda una hora
 *      por dentro.
 *   5. Fórmula: llega como objeto con `result`, y el resultado puede ser
 *      cualquiera de los cuatro anteriores.
 *
 * ── POR QUÉ NO SE FÍA DE LAS FÓRMULAS PARA LOS TOTALES ──────────────────────
 * Las columnas calculadas del fichero de Aumenta devuelven cosas como
 * `21.000000000000245` minutos: son restas de horas en coma flotante. Sirven
 * para mirar, no para pagar. El módulo recalcula los minutos a partir de las
 * horas de entrada y salida, y solo usa el total del Excel cuando no hay horas
 * de las que sacarlo.
 *
 * Todas las funciones devuelven `{ ok, valor, motivo }` — nunca lanzan y nunca
 * devuelven un número a medias. Un fichaje mal leído es una nómina mal pagada,
 * así que «no lo entiendo» tiene que poder decirse.
 */

const MIN_POR_DIA = 24 * 60;

/**
 * Desenvuelve una celda de ExcelJS: fórmulas, texto enriquecido, valor pelado.
 *
 * ⚠️ El acceso a `.text` va dentro de un try. No es paranoia: en una celda
 * COMBINADA cuyo valor es nulo, ExcelJS define `text` como un getter que hace
 * `this.value.toString()` y revienta con un TypeError. El fichero real de
 * Aumenta tiene celdas así, y sin esta guarda la importación entera se cae —
 * con un error de dentro de la librería, que además no dice ni en qué fila.
 */
export function valorDeCelda(celda) {
  let v;
  try {
    v = celda?.value ?? celda;
  } catch {
    return null;
  }
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if (v.result !== undefined) return v.result;
    if (Array.isArray(v.richText)) return v.richText.map((x) => x.text ?? "").join("");
    try {
      if (v.text !== undefined && v.text !== null) return v.text;
    } catch {
      return null;
    }
    return null;
  }
  return v;
}

function fallo(motivo) {
  return { ok: false, valor: null, motivo };
}
function exito(valor) {
  return { ok: true, valor, motivo: null };
}

/**
 * ¿Este texto es una hora de RELOJ («8:30», «8h30», «8:30:00», «8.30»)? Si sí,
 * devuelve sus trozos; si no, `null` y quien llama prueba la lectura decimal.
 *
 * LA REGLA DEL PUNTO (19/08/2026). Con `:` o `h` no hay duda. Con PUNTO la hay:
 * «8.30» lo escribe quien quiere decir las ocho y media, pero «7.5» lo escribe
 * quien quiere decir siete horas y media —la plantilla genérica lo promete así:
 * «7:30, 7,5 o 7.5»—. Hasta hoy el regex de reloj admitía el punto con uno o
 * dos dígitos detrás y lo atrapaba ANTES que la rama decimal: «7.5» se leía
 * como 7 h 05 y pagaba 25 minutos de menos por celda (lo sacó
 * `_smoke-fichaje-horas.mjs` el día que se escribió). Así que:
 *
 *   · punto + DOS dígitos («8.30», «8.05», «8.50») → reloj;
 *   · punto + UN dígito o TRES o más («8.5», «8.333») → decimal, no es reloj;
 *   · la coma es SIEMPRE decimal («8,30» son 8,3 horas), como hasta ahora.
 *
 * `maxDigitosHora` es 2 para una hora del día y 3 para una duración (que puede
 * pasar de 99 horas en un total de mes).
 */
function trozosDeReloj(s, maxDigitosHora) {
  const re = new RegExp(
    `^(\\d{1,${maxDigitosHora}})(?:[:h](\\d{1,2})(?::(\\d{1,2}))?|\\.(\\d{2}))$`,
    "i"
  );
  const m = re.exec(s);
  if (!m) return null;
  return { h: Number(m[1]), min: Number(m[2] ?? m[4]) };
}

/**
 * HORA DEL DÍA → minutos desde medianoche (0..1439).
 *
 * Devuelve `{ok:false}` para lo que no sea una hora reconocible, incluido el
 * vacío: «esta celda está en blanco» es una respuesta legítima y la decide
 * quien llama, no esta función.
 */
export function parseHoraDelDia(bruto) {
  const v = bruto instanceof Date || typeof bruto !== "object" ? bruto : valorDeCelda(bruto);

  if (v === null || v === undefined || v === "") return fallo("vacío");

  // 1. Date de ExcelJS (época 1899-12-30). En UTC: la celda no tiene zona.
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return fallo("fecha inválida");
    return exito(v.getUTCHours() * 60 + v.getUTCMinutes());
  }

  // 2. Número: fracción de día (0.5 = 12:00). Un entero >= 1 no es una hora
  // del día sino un serial de fecha, y ahí no hay hora que sacar.
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return fallo("número inválido");
    if (v < 0) return fallo("hora negativa");
    const frac = v % 1;
    if (v >= 1 && frac === 0) return fallo("parece una fecha, no una hora");
    return exito(Math.round(frac * MIN_POR_DIA) % MIN_POR_DIA);
  }

  // 3. Texto "H:MM", "HH:MM", "HH:MM:SS", "8.30" (reloj con punto), o "8,5" /
  //    "8.5" (horas con decimales). Qué es reloj y qué es decimal lo decide
  //    `trozosDeReloj`, que es donde está escrita la regla.
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return fallo("vacío");

    const reloj = trozosDeReloj(s, 2);
    if (reloj) {
      if (reloj.h > 23) return fallo(`hora fuera de rango: ${s}`);
      if (reloj.min > 59) return fallo(`minutos fuera de rango: ${s}`);
      return exito(reloj.h * 60 + reloj.min);
    }

    // "8,5" o "8.5" como hora del día = 8:30.
    const decimal = /^(\d{1,2})[,.](\d+)$/.exec(s);
    if (decimal) {
      const horas = Number(s.replace(",", "."));
      if (!Number.isFinite(horas) || horas >= 24) return fallo(`hora fuera de rango: ${s}`);
      return exito(Math.round(horas * 60));
    }

    // "14" a secas: las 14:00.
    if (/^\d{1,2}$/.test(s)) {
      const h = Number(s);
      if (h > 23) return fallo(`hora fuera de rango: ${s}`);
      return exito(h * 60);
    }

    return fallo(`no parece una hora: «${s.slice(0, 30)}»`);
  }

  return fallo("tipo de celda no reconocido");
}

/**
 * DURACIÓN → minutos. Lo mismo, pero admitiendo más de 24 h y sin tratar el
 * entero como fecha: aquí un `8` son ocho horas, no las ocho de la mañana.
 */
export function parseDuracion(bruto) {
  const v = bruto instanceof Date || typeof bruto !== "object" ? bruto : valorDeCelda(bruto);

  if (v === null || v === undefined || v === "") return fallo("vacío");

  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return fallo("fecha inválida");
    // Una duración guardada como hora: los días por encima de la época cuentan.
    const epoca = Date.UTC(1899, 11, 30);
    const dias = Math.floor((v.getTime() - epoca) / 86400000);
    const total = dias * MIN_POR_DIA + v.getUTCHours() * 60 + v.getUTCMinutes();
    // Una duración NEGATIVA no existe, y aquí no es una rareza teórica: cuando
    // en el Excel de Aumenta falta la hora de salida, la fórmula del total
    // resta contra una celda vacía y devuelve una fecha ANTERIOR a la época
    // (1899-12-29), que son −956 minutos. Ese número no puede acabar en una
    // nómina disfrazado de horas trabajadas: se rechaza y quien llame decidirá
    // si lo pregunta o lo marca como error.
    if (total < 0)
      return fallo("la duración sale negativa (probablemente falta una hora en el Excel)");
    return exito(total);
  }

  if (typeof v === "number") {
    if (!Number.isFinite(v)) return fallo("número inválido");
    // Un número suelto es fracción de día si viene de una celda de hora
    // (0.354 = 8h30) y horas si alguien lo tecleó (8,5). No se puede
    // distinguir, así que manda el formato: por debajo de 1 es fracción.
    if (v < 0) return fallo("duración negativa");
    if (v < 1) return exito(Math.round(v * MIN_POR_DIA));
    return exito(Math.round(v * 60));
  }

  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return fallo("vacío");

    const reloj = trozosDeReloj(s, 3);
    if (reloj) {
      if (reloj.min > 59) return fallo(`minutos fuera de rango: ${s}`);
      return exito(reloj.h * 60 + reloj.min);
    }

    const decimal = /^(\d{1,3})([,.](\d+))?$/.exec(s);
    if (decimal) {
      const horas = Number(s.replace(",", "."));
      if (!Number.isFinite(horas)) return fallo(`no parece una duración: «${s}»`);
      return exito(Math.round(horas * 60));
    }

    return fallo(`no parece una duración: «${s.slice(0, 30)}»`);
  }

  return fallo("tipo de celda no reconocido");
}

/** minutos → "8h 30min", para pantalla. */
export function formatearMinutos(min) {
  if (min === null || min === undefined || !Number.isFinite(Number(min))) return "—";
  const n = Math.round(Number(min));
  const signo = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${signo}${m}min`;
  if (m === 0) return `${signo}${h}h`;
  return `${signo}${h}h ${String(m).padStart(2, "0")}min`;
}

/** minutos desde medianoche → "08:30", para pantalla y para la columna TIME. */
export function formatearHora(min) {
  if (min === null || min === undefined || !Number.isFinite(Number(min))) return null;
  const n = ((Math.round(Number(min)) % MIN_POR_DIA) + MIN_POR_DIA) % MIN_POR_DIA;
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}

/**
 * Minutos trabajados entre dos horas del día.
 *
 * Si la salida es ANTERIOR a la entrada se asume que la jornada cruzó la
 * medianoche y se suman 24 h. Es lo correcto para un turno de noche y es un
 * disparate para un error de tecleo, así que quien llama recibe además
 * `cruzaMedianoche` y decide si eso merece un aviso. Aquí no se adivina.
 */
export function minutosEntre(entradaMin, salidaMin) {
  if (entradaMin === null || salidaMin === null) return { minutos: null, cruzaMedianoche: false };
  let d = salidaMin - entradaMin;
  let cruza = false;
  if (d < 0) {
    d += MIN_POR_DIA;
    cruza = true;
  }
  return { minutos: d, cruzaMedianoche: cruza };
}
