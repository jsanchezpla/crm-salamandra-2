/**
 * lib/clinica/registroDeDiagnostico.js — los REGISTROS de un expediente de
 * diagnóstico: cómo se titulan, cómo se ordenan, a qué URL abren y qué texto
 * llevan a la IA para unirse en el informe (12/09/2026, segunda entrega del
 * Diagnóstico; Rodrigo con Isa, Aumenta).
 *
 * (Fichero nuevo en /lib, regla #2: el título por defecto lo enseñan la ficha
 * del expediente, el editor del registro y el material que se manda a la IA;
 * la URL de «Nuevo registro» la montan la fila del expediente y cada cita; y la
 * cola `&diagnostico=&titulo=` la escribe la fila y la lee el editor. Escrito
 * en cada sitio, el día que uno cambiara el nombre del parámetro el editor
 * abriría un registro suelto sin avisar. PURO a propósito: sin ORM, para que
 * lo importe el navegador y se pruebe sin base.)
 *
 * ── EL ENCARGO (Rodrigo, 11/09/2026) ───────────────────────────────────────
 * «Informe de diagnóstico por paciente: entradas por fecha y título (registros
 * de diagnóstico, con IA como un registro de sesión) que al final se unen con
 * IA en el informe completo.»
 *
 * ── QUÉ ES UN REGISTRO DE DIAGNÓSTICO ──────────────────────────────────────
 * Una fila de `clinic_sessions` con `diagnostico_id`: el mismo registro de
 * sesión de siempre —apartados de plantilla, audio → Whisper → IA, firma con
 * desplegable— escrito con la plantilla `sesion_diagnostico` (o
 * `entrevista_inicial` si es la entrevista), y con un TÍTULO (`titulo`,
 * columna nueva) porque es una entrada de un índice: «Sesión de diagnóstico 3»,
 * «Pruebas WISC-V». Sin título, se enseña el de por defecto con su número
 * correlativo entre las de horas; la entrevista se llama «Entrevista inicial».
 *
 * ── LO QUE VIAJA A LA IA, Y LO QUE NO ──────────────────────────────────────
 * `materialDeLosRegistros` junta, por registro, `### <fecha> · <título>` y
 * cada apartado con su rótulo (listas como «- ítem»), más la devolución de la
 * familia si la hay. NUNCA `prepText`, `prepFiles`, `internalNotes` ni
 * `aiTranscription`: es material interno del equipo, la misma frontera que
 * `sesionesDelInforme.js` pone al PDF que recibe la familia. Ni el nombre del
 * paciente: lo sabe `estiloClinico.js`, no este texto. Quien llama decide QUÉ
 * registros entran (los terminados, `ESTADOS_TERMINADOS`): aquí no se filtra.
 */

import { esEntrevistaInicial } from "./entrevistaInicial.js";
import {
  PLANTILLA_BASE,
  PLANTILLAS_EXTRA,
  PLANTILLA_ENTREVISTA,
  PLANTILLA_SESION_DIAGNOSTICO,
  apartadosConPlantillas,
  valoresDeSesion,
  valorDeApartado,
} from "./plantillas.js";
import { colaDePreparacion, limpiarTitulo, MAX_TITULO } from "./prepararSesion.js";
import { TRAMO_ENTREVISTA, TRAMO_HORAS } from "../citas/altaDesdeDiagnostico.js";

/** El tope del título y su limpieza viven con el resto del payload del registro. */
export { MAX_TITULO, limpiarTitulo };

/**
 * Un registro «terminado» es material para el informe; un borrador no lo es.
 * La misma regla que `desde-sesiones` (`ESTADOS_UTILES`).
 */
export const ESTADOS_TERMINADOS = Object.freeze(["registered", "published"]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TITULO_ENTREVISTA = "Entrevista inicial";
const TITULO_SESION = "Sesión de diagnóstico";

/* ═══ Títulos ══════════════════════════════════════════════════════════════ */

/**
 * El título con el que nace un registro cuando nadie ha puesto otro:
 * «Entrevista inicial» para el tramo entrevista; «Sesión de diagnóstico N» si
 * se sabe el número; «Sesión de diagnóstico» si no.
 */
export function tituloPorDefecto({ tramo = TRAMO_HORAS, numero = null } = {}) {
  if (tramo === TRAMO_ENTREVISTA) return TITULO_ENTREVISTA;
  const n = Number(numero);
  return Number.isInteger(n) && n > 0 ? `${TITULO_SESION} ${n}` : TITULO_SESION;
}

/**
 * Cómo se llama ESTE registro: el suyo si lo tiene; si no, «Entrevista
 * inicial» cuando se escribió con esa plantilla; si no, el de por defecto con
 * el número que le toque (`numero`, que sabe quien tiene la lista entera).
 */
export function tituloDe(sesion, { numero = null } = {}) {
  const s = sesion?.toJSON ? sesion.toJSON() : sesion;
  const propio = limpiarTitulo(s?.titulo);
  if (propio) return propio;
  if (esEntrevistaInicial(s)) return tituloPorDefecto({ tramo: TRAMO_ENTREVISTA });
  return tituloPorDefecto({ tramo: TRAMO_HORAS, numero });
}

/* ═══ La URL ═══════════════════════════════════════════════════════════════ */

/**
 * Lo que el editor lee de la barra de direcciones: `?diagnostico=<uuid>` y
 * `?titulo=`. Recibe cualquier cosa con `.get` (el `useSearchParams()` de
 * Next). El id se acota a UUID por lo mismo que `profesionalDePreparacion`:
 * lo escribe quien quiera, y aquí decide a qué expediente se ata una nota
 * clínica. Sin forma de id, `""`, y el registro nace suelto.
 */
export function leerDiagnosticoDeLaUrl(query) {
  const get = typeof query?.get === "function" ? (k) => query.get(k) : () => null;
  const id = String(get("diagnostico") ?? "").trim();
  return {
    diagnosticoId: UUID_RE.test(id) ? id : "",
    titulo: limpiarTitulo(get("titulo")) ?? "",
  };
}

/**
 * La cola que se PEGA a la de `colaDePreparacion`: `&diagnostico=<id>` y, si
 * hay, `&titulo=<enc>`. Vacía sin expediente. Quien escribe es laxo y quien
 * lee es estricto (misma pareja que `cita=` / `profesionalDePreparacion`).
 */
export function colaDeRegistroDeDiagnostico({ diagnosticoId, titulo = null } = {}) {
  const id = String(diagnosticoId ?? "").trim();
  if (!id) return "";
  const q = new URLSearchParams();
  q.set("diagnostico", id);
  const t = limpiarTitulo(titulo);
  if (t) q.set("titulo", t);
  return `&${q.toString()}`;
}

/**
 * El enlace de «Nuevo registro» (desde el expediente) o de «Escribir registro»
 * (desde una de sus citas): la pantalla de nueva sesión del paciente con la
 * cola de preparar —fecha, cita, firma y PLANTILLA— y detrás el expediente y
 * el título.
 *
 * La plantilla, si no se dice otra: `entrevista_inicial` en el tramo
 * entrevista, `sesion_diagnostico` en las horas (la misma regla que
 * `plantillaDeLaCita`). Sin `scheduledAt` la cola lleva `preparar=1` igual:
 * es lo que abre el editor listo para escribir, con la fecha de hoy.
 *
 * Lanza si falta el paciente o el expediente: son errores de programación, y
 * un enlace a medias abriría un registro suelto sin que nadie lo notara.
 */
export function urlDeNuevoRegistro({
  patientId,
  diagnosticoId,
  tramo = TRAMO_HORAS,
  bookingId = null,
  therapistId = null,
  scheduledAt = null,
  titulo = null,
  plantilla = null,
  ahora = new Date(),
} = {}) {
  const pid = String(patientId ?? "").trim();
  const did = String(diagnosticoId ?? "").trim();
  if (!pid) throw new TypeError("urlDeNuevoRegistro: falta patientId");
  if (!did) throw new TypeError("urlDeNuevoRegistro: falta diagnosticoId");
  const clave = plantilla ?? (tramo === TRAMO_ENTREVISTA ? PLANTILLA_ENTREVISTA.key : PLANTILLA_SESION_DIAGNOSTICO.key);
  const cola = colaDePreparacion(scheduledAt, { bookingId, profesionalId: therapistId, plantilla: clave, ahora });
  return `/pacientes/${encodeURIComponent(pid)}/sesiones/nueva${cola}${colaDeRegistroDeDiagnostico({ diagnosticoId: did, titulo })}`;
}

/** El enlace para SEGUIR un registro que ya existe. */
export function urlDeRegistro({ patientId, sessionId } = {}) {
  const pid = String(patientId ?? "").trim();
  const sid = String(sessionId ?? "").trim();
  if (!pid || !sid) throw new TypeError("urlDeRegistro: faltan patientId o sessionId");
  return `/pacientes/${encodeURIComponent(pid)}/sesiones/${encodeURIComponent(sid)}`;
}

/* ═══ La lista ═════════════════════════════════════════════════════════════ */

/** El instante de un registro, o 0 si no tiene fecha legible (nunca NaN). */
function cuando(s) {
  const t = new Date(s?.sessionDate ?? 0).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function aJson(s) {
  return s?.toJSON ? s.toJSON() : s;
}

/**
 * Los registros de un expediente, por fecha ASCENDENTE y con su título: las de
 * horas se numeran correlativamente (1, 2, 3…) en ese orden, y la entrevista
 * no cuenta para el número. Un registro con título propio conserva su número
 * de sitio (el siguiente no lo hereda).
 *
 * Devuelve `{ id, sessionDate, titulo, therapistId, status, bookingId,
 * esEntrevista, diagnosticoId, updatedAt }` y, si la fila lo traía ya
 * resuelto, `terapeuta` (la API lo pone; aquí no se inventa).
 */
export function registrosPorFecha(sesiones) {
  const lista = (Array.isArray(sesiones) ? sesiones : []).map(aJson).filter(Boolean);
  lista.sort((a, b) => cuando(a) - cuando(b));
  let n = 0;
  return lista.map((s) => {
    const esEntrevista = esEntrevistaInicial(s);
    if (!esEntrevista) n += 1;
    return {
      id: s.id,
      sessionDate: s.sessionDate ?? null,
      titulo: tituloDe(s, { numero: esEntrevista ? null : n }),
      therapistId: s.therapistId ?? null,
      status: s.status ?? null,
      bookingId: s.bookingId ?? null,
      esEntrevista,
      diagnosticoId: s.diagnosticoId ?? null,
      updatedAt: s.updatedAt ?? null,
      ...(s.terapeuta !== undefined ? { terapeuta: s.terapeuta } : {}),
    };
  });
}

/** El título con el que nace el SIGUIENTE registro de horas: el número que toca. */
export function siguienteTitulo(sesiones) {
  const deHoras = (Array.isArray(sesiones) ? sesiones : []).map(aJson).filter((s) => s && !esEntrevistaInicial(s));
  return tituloPorDefecto({ tramo: TRAMO_HORAS, numero: deHoras.length + 1 });
}

/* ═══ El material para la IA ═══════════════════════════════════════════════ */

/** «03/09/2026», o «» si la fecha no se lee. */
function fechaCorta(valor) {
  const d = new Date(valor ?? NaN);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Las plantillas de fábrica del registro: la base y las extra (entrevista, taller, sesión de diagnóstico). */
function plantillasDeFabrica() {
  return [PLANTILLA_BASE.registro, ...(PLANTILLAS_EXTRA.registro ?? [])];
}

/**
 * Las plantillas con las que se LEEN los apartados: las del centro primero (si
 * guardó una con la clave de una de fábrica, manda la suya, como en
 * `plantillasDe`) y detrás las de fábrica que no haya sustituido.
 */
function plantillasParaLeer(plantillasDelCentro) {
  const propias = (Array.isArray(plantillasDelCentro) ? plantillasDelCentro : []).filter((p) => p && p.key);
  const vistas = new Set(propias.map((p) => p.key));
  return [...propias, ...plantillasDeFabrica().filter((p) => !vistas.has(p.key))];
}

/** El cuerpo de un apartado como texto: las listas, una viñeta por línea. */
function cuerpoDeApartado(bolsa, apartado) {
  const v = valorDeApartado(bolsa, apartado);
  if (Array.isArray(v)) return v.map((x) => `- ${x}`).join("\n");
  return String(v ?? "").trim();
}

/**
 * El texto de los registros que se le da a la IA para unirlos en el informe:
 * uno detrás de otro, por fecha, cada uno con su título y sus apartados
 * escritos (los vacíos no van). Un registro sin nada escrito no aparece: una
 * fecha suelta no es material, y la IA no tiene que inventarle contenido.
 *
 * `""` si no hay nada. Quien llama pone el tope (`MAX_TRANSCRIPCION`).
 */
export function materialDeLosRegistros(sesiones, { plantillasDelCentro = [] } = {}) {
  const plantillas = plantillasParaLeer(plantillasDelCentro);
  const ordenadas = (Array.isArray(sesiones) ? sesiones : []).map(aJson).filter(Boolean);
  ordenadas.sort((a, b) => cuando(a) - cuando(b));
  // Ya vienen ordenadas, y el orden es estable: la lista de títulos va en
  // paralelo por posición (no por id: un registro sin id no puede perder el suyo).
  const titulos = registrosPorFecha(ordenadas).map((r) => r.titulo);

  const bloques = [];
  ordenadas.forEach((s, i) => {
    const apartados = apartadosConPlantillas(s.contentSections, plantillas);
    const bolsa = valoresDeSesion(s);
    const partes = [];
    for (const a of apartados) {
      const cuerpo = cuerpoDeApartado(bolsa, a);
      if (cuerpo) partes.push(`**${a.label}**\n${cuerpo}`);
    }
    const familia = String(s.parentFeedback ?? "").trim();
    if (familia) partes.push(`**Devolución de la familia**\n${familia}`);
    if (!partes.length) return;
    const titulo = titulos[i];
    const fecha = fechaCorta(s.sessionDate);
    bloques.push(`### ${fecha ? `${fecha} · ` : ""}${titulo}\n\n${partes.join("\n\n")}`);
  });
  return bloques.join("\n\n");
}
