/**
 * lib/citas/altaDesdeDiagnostico.js — el CONTRATO entre Diagnósticos y la
 * agenda: cómo se le pide a Citas que abra el alta de una cita ya preparada
 * (12/09/2026, Rodrigo con Isa, Aumenta).
 *
 * (Fichero nuevo en /lib, regla #2: lo escriben los dos botones de la lista de
 * Diagnósticos —«Abrir entrevista inicial» y «Añadir horas»— y lo lee
 * `modules/default/CitasModule.jsx` al montarse. Escrito en cada lado, el día
 * que uno renombrara un parámetro el otro abriría un cajón vacío sin avisar.
 * PURO: dos funciones sobre una URL, sin ORM, para que lo importe el navegador.)
 *
 * ── LA URL ─────────────────────────────────────────────────────────────────
 *   /citas?nueva=1&diagnostico=<id>&tramo=entrevista|horas&paciente=<id>&duracion=60
 *
 *   · `nueva=1`      — que la agenda abra el cajón de alta nada más montarse
 *   · `diagnostico`  — el expediente al que se engancha la cita
 *   · `tramo`        — `entrevista` (la entrevista inicial: 60 min, sin coste,
 *                      «el cobro nace al decidir si sigue») u `horas` (una
 *                      sesión más del diagnóstico: tipo DIAGNÓSTICO, modo de
 *                      cobro `bono` con el bono sin tope del expediente)
 *   · `paciente`     — el paciente, ya puesto
 *   · `duracion`     — minutos, múltiplo de 30 y como mucho 480. En la
 *                      entrevista es siempre 60; en las horas es lo que se
 *                      elija al abrir (si no viene, la agenda pone la del tipo)
 *
 * Los dos tramos son las DOS únicas cosas que Citas tiene que distinguir: qué
 * plantilla abre el registro (`entrevista_inicial` en la entrevista, aunque el
 * tipo de cita sea DIAGNÓSTICO) y cómo se cobra. El resto —tipo de cita,
 * paciente, bono— lo resuelve la agenda con lo que ya sabe hacer.
 */

/** Los dos tramos de un diagnóstico, tal cual se guardan en `bookings.diagnostico_tramo`. */
export const TRAMO_ENTREVISTA = "entrevista";
export const TRAMO_HORAS = "horas";
export const TRAMOS = Object.freeze([TRAMO_ENTREVISTA, TRAMO_HORAS]);

/** Duración de la entrevista inicial de un diagnóstico, en minutos. */
export const DURACION_ENTREVISTA_MIN = 60;

/** La duración de una sesión de diagnóstico va de media en media hora, hasta 8 h. */
export const DURACION_PASO_MIN = 30;
export const DURACION_MAX_MIN = 480;

/** Minutos válidos para una sesión de diagnóstico, o null. */
export function duracionLimpia(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < DURACION_PASO_MIN || n > DURACION_MAX_MIN) return null;
  return n % DURACION_PASO_MIN === 0 ? n : null;
}

/**
 * La URL que abre la agenda con la cita preparada.
 *
 * Lanza si falta el expediente o el tramo no es uno de los dos: son errores de
 * programación, no de datos, y un enlace a medias abriría un cajón que no sabe
 * a qué engancharse. `patientId` y `duracion` son opcionales; en la entrevista
 * la duración es siempre la de la entrevista, se pida lo que se pida.
 */
export function urlDeAltaDesdeDiagnostico({ diagnosticoId, tramo, patientId = null, duracion = null } = {}) {
  const id = String(diagnosticoId ?? "").trim();
  if (!id) throw new TypeError("urlDeAltaDesdeDiagnostico: falta diagnosticoId");
  if (!TRAMOS.includes(tramo)) throw new TypeError(`urlDeAltaDesdeDiagnostico: tramo desconocido «${tramo}»`);

  const q = new URLSearchParams();
  q.set("nueva", "1");
  q.set("diagnostico", id);
  q.set("tramo", tramo);
  const paciente = String(patientId ?? "").trim();
  if (paciente) q.set("paciente", paciente);
  const min = tramo === TRAMO_ENTREVISTA ? DURACION_ENTREVISTA_MIN : duracionLimpia(duracion);
  if (min) q.set("duracion", String(min));
  return `/citas?${q.toString()}`;
}

/**
 * Lo que la agenda lee de sus parámetros, o `null` si no viene de un
 * diagnóstico (que es el 100 % de las veces que se abre `/citas`).
 *
 * Acepta un `URLSearchParams` (el `useSearchParams()` de Next), una cadena
 * (`"?nueva=1&…"` o la URL entera) o un objeto plano (`searchParams` de una
 * página de servidor, donde un parámetro repetido llega como array).
 *
 * Devuelve `{ diagnosticoId, tramo, patientId, duracion }`: `patientId` null si
 * no vino; `duracion` en minutos válidos o null (la agenda pone la del tipo).
 * `nueva=1` no se exige aquí: es la señal de «abre el cajón», no parte del
 * encargo.
 */
export function leerAltaDesdeDiagnostico(searchParams) {
  const get = lector(searchParams);
  const diagnosticoId = String(get("diagnostico") ?? "").trim();
  const tramo = String(get("tramo") ?? "").trim();
  if (!diagnosticoId || !TRAMOS.includes(tramo)) return null;
  const patientId = String(get("paciente") ?? "").trim() || null;
  const duracion = tramo === TRAMO_ENTREVISTA ? DURACION_ENTREVISTA_MIN : duracionLimpia(get("duracion"));
  return { diagnosticoId, tramo, patientId, duracion };
}

/** Un `get(clave)` sea cual sea la forma en que lleguen los parámetros. */
function lector(sp) {
  if (!sp) return () => null;
  if (typeof sp === "string") {
    const i = sp.indexOf("?");
    const u = new URLSearchParams(i >= 0 ? sp.slice(i + 1) : sp);
    return (k) => u.get(k);
  }
  if (typeof sp.get === "function") return (k) => sp.get(k);
  if (typeof sp === "object") {
    return (k) => {
      const v = sp[k];
      return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
    };
  }
  return () => null;
}
