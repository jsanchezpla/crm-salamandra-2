/**
 * lib/clinica/citaDeDiagnostico.js — una cita que es DE UN DIAGNÓSTICO: qué
 * pide el alta, qué comprueba el servidor antes de crearla y qué cuenta después
 * la ficha de la cita (12/09/2026, Rodrigo con Isa, Aumenta).
 *
 * (Fichero nuevo en /lib, regla #2: lo necesitan DOS rutas que no se conocen
 * —`POST /api/citas/bookings`, que decide si la cita cabe y con qué dinero
 * nace, y `GET /api/citas/bookings/[id]`, que le cuenta al modal por dónde va
 * el expediente— y el alta de la agenda, que enseña los mismos mensajes. Con
 * una copia en cada sitio, la primera que cambiara una frase o un tope dejaría
 * a las otras diciendo otra cosa. Es el mismo reparto que `citaDeTaller.js`:
 * la regla del expediente vive en `diagnostico.js` (puro) y aquí va lo que
 * toca base de datos y lo que traduce un cuerpo HTTP a esa regla.)
 *
 * ── LO QUE MANDA EL ALTA ───────────────────────────────────────────────────
 *   · `diagnosticoId`    — el expediente (uuid). Sin él, la cita es de siempre
 *                          y NADA de este fichero se ejecuta.
 *   · `diagnosticoTramo` — `entrevista` (la entrevista inicial) u `horas` (una
 *                          sesión más del diagnóstico). Los dos valores viven
 *                          en `lib/citas/altaDesdeDiagnostico.js`.
 *   · `duration`         — minutos, múltiplo de 30 entre 30 y 480. SOLO se
 *                          escucha con `diagnosticoId`: en el resto de citas la
 *                          duración la pone el tipo, como siempre.
 *
 * ── LO QUE COMPRUEBA EL SERVIDOR, EN ORDEN ─────────────────────────────────
 *   1. que el expediente existe y sigue abierto (`entrevista` o `en_curso`);
 *   2. que para «horas» ya tiene su bono (nace al «Seguir con el diagnóstico»);
 *   3. que el paciente de la cita es EL del expediente;
 *   4. que con esta cita no se pasa de las horas del producto (`cabeHora`).
 * Lo que no cabe se rechaza con 422 y la misma frase que enseña la lista de
 * Diagnósticos, para que quien apunta la cita sepa dónde desbloquearlas.
 *
 * ── CON QUÉ DINERO NACE ────────────────────────────────────────────────────
 *   · entrevista → `sin_coste` con el texto de `ENTREVISTA.cobroTexto`: el
 *     cobro de verdad nace después, al parar (50 €) o al seguir (el producto).
 *   · horas      → modo `bono`, con el bono SIN TOPE del expediente, por la
 *     misma puerta que cualquier bono elegido a mano (`elegirPack`). El bono no
 *     se agota nunca (`totalSessions` a null): lo que acota es el expediente.
 */

import {
  TRAMOS,
  TRAMO_ENTREVISTA,
  TRAMO_HORAS,
  DURACION_ENTREVISTA_MIN,
  duracionLimpia,
} from "../citas/altaDesdeDiagnostico.js";
import { ENTREVISTA, ROTULO_ESTADO, estaAbierto, horasDe, cabeHora, rotuloDeBarra } from "./diagnostico.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 42P01 = la tabla no existe en este schema (un centro sin la migración). */
const esTablaAusente = (err) => err?.parent?.code === "42P01" || err?.original?.code === "42P01";

/**
 * Las frases que devuelve el alta cuando una cita de diagnóstico no puede
 * crearse. Están aquí, con nombre, para que el drawer y la prueba las lean de
 * un sitio y no se copien a mano. La del tope NO está: la da `cabeHora`
 * (`mensajeTope`), que es la misma que enseña la lista de Diagnósticos.
 */
export const MENSAJES = Object.freeze({
  idInvalido: "diagnosticoId inválido",
  tramoInvalido: "diagnosticoTramo inválido: tiene que ser «entrevista» u «horas»",
  duracionInvalida: "duration inválida: minutos en múltiplos de 30, entre 30 y 480",
  sinDiagnosticos: "Este centro no tiene diagnósticos",
  noExiste: "El diagnóstico indicado no existe",
  taller: "Un taller no puede ser una cita de diagnóstico",
  sinBono:
    "Este diagnóstico aún no tiene su bono: pulsa «Seguir con el diagnóstico» en Diagnósticos antes de añadir horas",
  otroPaciente: "Esta cita no es del paciente del diagnóstico: elige a ese paciente o abre un diagnóstico suyo",
  sinPaciente: "Una cita de diagnóstico tiene que llevar al paciente del expediente",
});

/** «Este diagnóstico está en «No continúa»: no admite más citas». */
export function mensajeCerrado(status) {
  const rotulo = ROTULO_ESTADO[status] ?? status ?? "cerrado";
  return `Este diagnóstico está en «${rotulo}»: no admite más citas`;
}

/**
 * Lo que el alta dice del diagnóstico, leído del cuerpo del POST.
 *
 * Devuelve `null` cuando NO viene `diagnosticoId` (una cita de siempre: nada
 * que hacer), `{ error }` cuando viene pero mal, y si no
 * `{ diagnosticoId, tramo, duracion }` con `duracion` en minutos válidos o null
 * (= la pone el servidor: 60 en la entrevista, la del tipo en las horas).
 *
 * `duration` se valida SOLO aquí a propósito: sin expediente el servidor no la
 * lee, así que un `duration: 45` en una cita normal no es un error, es ruido.
 */
export function leerCitaDeDiagnostico(body) {
  const bruto = body?.diagnosticoId;
  if (bruto === undefined || bruto === null || bruto === "") return null;
  if (typeof bruto !== "string" || !UUID_RE.test(bruto.trim())) return { error: MENSAJES.idInvalido };
  const tramo = typeof body?.diagnosticoTramo === "string" ? body.diagnosticoTramo.trim() : "";
  if (!TRAMOS.includes(tramo)) return { error: MENSAJES.tramoInvalido };
  const d = body?.duration;
  let duracion = null;
  if (d !== undefined && d !== null && d !== "") {
    duracion = duracionLimpia(d);
    if (duracion === null) return { error: MENSAJES.duracionInvalida };
  }
  return { diagnosticoId: bruto.trim(), tramo, duracion };
}

/**
 * Cuánto dura la cita: lo pedido si vale; si no, 60 en la entrevista y
 * `porDefecto` (la duración de contacto del tipo) en las horas. Nunca 0: una
 * hora de diagnóstico que dure 0 min no ocuparía la barra ni la agenda.
 */
export function duracionDeCitaDeDiagnostico({ tramo, duracion = null, porDefecto = null } = {}) {
  const pedida = duracionLimpia(duracion);
  if (pedida) return pedida;
  if (tramo === TRAMO_ENTREVISTA) return DURACION_ENTREVISTA_MIN;
  const tipo = Number(porDefecto);
  return Number.isInteger(tipo) && tipo > 0 ? tipo : DURACION_ENTREVISTA_MIN;
}

/**
 * ¿Admite este expediente una cita de ese tramo? Cerrado o parado, no; y para
 * «horas» hace falta el bono, que nace al «Seguir». Devuelve `{ ok, error }`.
 */
export function admiteCita(expediente, tramo) {
  if (!expediente) return { ok: false, error: MENSAJES.noExiste };
  if (!estaAbierto(expediente)) return { ok: false, error: mensajeCerrado(expediente.status) };
  if (tramo === TRAMO_HORAS && !expediente.packId) return { ok: false, error: MENSAJES.sinBono };
  return { ok: true, error: null };
}

/** ¿La cita es del paciente del expediente? Sin paciente en la cita, no. */
export function esDelPaciente(expediente, patientId) {
  const suyo = String(expediente?.patientId ?? "").trim();
  const dado = String(patientId ?? "").trim();
  return Boolean(suyo) && Boolean(dado) && suyo === dado;
}

/**
 * El «cobro» con el que nace la entrevista inicial de un diagnóstico: sin
 * coste, y diciendo por qué. Es el tercer modo de `dineroDeLaCita.js` puesto
 * por el servidor: el alta no lo pide, y el dinero de verdad nace al decidir.
 */
export function cobroDeLaCitaDeEntrevista() {
  return { modo: "sin_coste", conceptId: null, texto: ENTREVISTA.cobroTexto, importe: 0 };
}

/** Los atributos de una cita que necesita `horasDe` para contar la barra. */
export const ATRIBUTOS_DE_HORAS = Object.freeze([
  "id",
  "status",
  "scheduledAt",
  "cancelledAt",
  "noShowJustified",
  "duration",
  "diagnosticoTramo",
]);

/**
 * El expediente por su id, o por qué no: `{ expediente }` o `{ error, status }`.
 * Un centro sin la tabla (sin la migración, o sin Clínica) recibe la misma
 * frase que uno sin el modelo: para quien apunta la cita es lo mismo.
 */
export async function cargarExpediente(tenantModels, diagnosticoId) {
  const { Diagnostico } = tenantModels ?? {};
  if (!Diagnostico) return { error: MENSAJES.sinDiagnosticos, status: 422 };
  let expediente;
  try {
    expediente = await Diagnostico.findByPk(diagnosticoId);
  } catch (err) {
    if (esTablaAusente(err)) return { error: MENSAJES.sinDiagnosticos, status: 422 };
    throw err;
  }
  if (!expediente) return { error: MENSAJES.noExiste, status: 422 };
  return { expediente };
}

/**
 * Las horas del expediente contadas desde SUS citas en la base
 * (`lib/clinica/diagnostico.js`, `horasDe`). Es lo que compara `cabeHora`.
 */
export async function horasDelExpediente(tenantModels, expediente, ahora = new Date()) {
  const { Booking } = tenantModels;
  const citas = await Booking.findAll({
    where: { diagnosticoId: expediente.id },
    attributes: [...ATRIBUTOS_DE_HORAS],
  });
  return horasDe({ expediente, citas: citas.map((c) => c.toJSON()), ahora });
}

/**
 * ¿Cabe una cita de `duracionMin` en este expediente? Devuelve lo de `cabeHora`
 * más las `horas` de antes, para que el alta pueda contestar «lleva 9 de 10».
 */
export async function cabeEnElExpediente(tenantModels, expediente, duracionMin, ahora = new Date()) {
  const horas = await horasDelExpediente(tenantModels, expediente, ahora);
  return { ...cabeHora(horas, duracionMin), horas };
}

/**
 * Lo que la ficha de una cita cuenta de su diagnóstico: en qué estado está y
 * por dónde va la barra («3 de 10 h»). Null en cuanto algo no está —sin
 * modelo, sin tabla, expediente borrado—: la cita se abre igual, sin el chip.
 * Mismo criterio que `cuentaDelBono` en la ruta de la cita.
 */
export async function resumenDelDiagnostico(tenantModels, diagnosticoId, ahora = new Date()) {
  if (!diagnosticoId) return null;
  try {
    const { expediente, error } = await cargarExpediente(tenantModels, diagnosticoId);
    if (error || !expediente) return null;
    const horas = await horasDelExpediente(tenantModels, expediente, ahora);
    return {
      id: expediente.id,
      status: expediente.status,
      estado: ROTULO_ESTADO[expediente.status] ?? expediente.status,
      productoNombre: expediente.productoNombre ?? null,
      horas,
      rotulo: rotuloDeBarra(horas),
    };
  } catch {
    return null;
  }
}
