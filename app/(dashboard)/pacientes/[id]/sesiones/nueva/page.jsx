"use client";

/**
 * /pacientes/[id]/sesiones/nueva — «Nuevo registro» de sesión (26/08/2026,
 * Rodrigo: «en lugar de Subir audio, Nuevo registro; que se pueda hacer todo
 * el registro en texto, y el audio dentro y opcional»).
 *
 * Hasta hoy el camino principal era el audio: la página abría con la zona de
 * soltar el fichero y el formulario solo aparecía DESPUÉS de que la IA lo
 * estructurara (o como preparación-borrador). Ahora es al revés:
 *
 *   - La página abre con el REGISTRO COMPLETO en texto, las tres partes del
 *     sprint 2026-07: 1·Preparación (con adjuntos), 2·Informe (objetivos,
 *     actividades, desempeño, observaciones) y 3·Devolución de la familia.
 *   - El audio es un bloque OPCIONAL dentro: si se sube y procesa, la IA
 *     propone el registro entero y ella elige apartado por apartado.
 *
 * «Preparar la sesión» (borrador antes de darla, 26/08 por la mañana) sigue
 * igual: se llega con ?preparar=1 desde el modal de la cita o con su enlace de
 * abajo.
 *
 * ── EL BORRADOR NO SE PODÍA GUARDAR DESDE EL REGISTRO (01/09/2026, Rodrigo) ─
 * «Guardar la preparación no funciona: no se guarda nada como borrador.» Las
 * dos pantallas de esta página escribían la preparación en estados DISTINTOS
 * —el registro en `form.prepText`, la de preparar en un `prepSolo` suyo—, así
 * que el enlace «Guárdala solo como preparación» te llevaba a un recuadro
 * vacío con el botón apagado: lo escrito se quedaba atrás y no había forma de
 * guardarlo. Ahora la preparación es UNA (`form.prepText`), como ya lo eran el
 * día y los adjuntos, y el texto cruza en los dos sentidos. Y como del
 * registro completo solo viaja la preparación, la pantalla avisa si hay algo
 * más escrito en vez de tirarlo callando.
 *
 * ── EL AUDIO YA RELLENA EL REGISTRO ENTERO (01/09/2026, Rodrigo) ───────────
 * Hasta hoy «Procesar con IA» solo tocaba SIETE apartados —los de fábrica del
 * punto 2— y solo si estaban vacíos. Quedaban siempre en blanco la preparación,
 * la devolución de la familia, las notas internas y los apartados propios de la
 * plantilla del centro, aunque estuvieran dictados en el audio.
 *
 * Ahora la pantalla manda al servidor SUS apartados (los de la plantilla
 * elegida más los sueltos que se hayan añadido aquí) y lo ya tecleado, y lo que
 * vuelve se enseña en `PropuestaIA`: lo tuyo al lado de lo propuesto, con
 * mantener / añadir al final / sustituir. Nada entra solo — que era la otra
 * mitad del encargo: antes, lo que la IA proponía para un apartado ya escrito
 * se tiraba sin que nadie lo viera.
 *
 * ── Y NO HACE FALTA AUDIO (01/09/2026, Rodrigo, el mismo día) ─────────────
 * «También debe poder coger texto libre, no solo la transcripción del audio.
 * Por si apuntan todo en un bloc de notas y lo pasan ahí.» La tarjeta del audio
 * pasa a ser la del MATERIAL: la zona de soltar el fichero y, debajo, un
 * recuadro donde pegar lo apuntado. Un botón para las dos, y si se dan las dos
 * se usan las dos. Sin audio no se sube nada ni se llama a Whisper — ni se
 * pintan sus pasos, ni hace falta clave de OpenAI.
 *
 * ── LOS APARTADOS DEL PUNTO 2 SALEN DE UNA PLANTILLA (29/08/2026) ──────────
 * El «Informe de la sesión» tenía siete campos escritos a mano aquí dentro.
 * Ahora los da `lib/clinica/plantillas.js` —la plantilla de registro del centro
 * o los siete de fábrica—, se pintan con `ApartadosEditor` (el mismo del cajón
 * del informe) y se pueden añadir apartados sueltos para ESTA sesión, que se
 * aplican aquí y no se guardan en ninguna plantilla. Los puntos 1 y 3
 * —preparación y devolución de la familia— siguen fuera: no son apartados del
 * informe de la sesión, son el envoltorio del registro.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import HelpTooltip from "@/components/ui/HelpTooltip.jsx";
import useZonaSoltar, { useEvitarSoltarFuera } from "@/components/ui/useZonaSoltar.js";
import { anchoPantalla } from "@/components/layout/anchoPantalla.js";
import {
  fechaDePreparacion,
  paraInputLocal,
  payloadDePreparacion,
  pidePreparar,
} from "@/lib/clinica/prepararSesion.js";
import ApartadosEditor from "@/components/clinica/ApartadosEditor.jsx";
import PropuestaIA from "@/components/clinica/PropuestaIA.jsx";
import {
  CLAVE_PLANTILLA,
  PLANTILLA_BASE,
  desdeFormulario,
  repartirValoresDeSesion,
} from "@/lib/clinica/plantillas.js";
import { bloquesDelRegistro, esEnvoltorio, MAX_NOTAS } from "@/lib/clinica/registroCompleto.js";

const STATE = { FORM: "form", PROCESSING: "processing", PREPARING: "preparing" };

// Lo que admite cada campo de fichero. En una constante porque ahora lo leen
// DOS sitios: el `accept` del input (filtra el explorador) y la zona de soltar
// (filtra lo que llega arrastrado, que el navegador no filtra por su cuenta).
const ACEPTA_AUDIO = "audio/*,.m4a,.mp3,.wav,.ogg,.webm,.mp4";
const ACEPTA_PREP = "image/*,audio/*,application/pdf";
const MAX_PREP = 10;

// Los pasos que se pintan mientras la petición está en vuelo. Los dos primeros
// solo cuando hay audio de verdad: sin él no se sube nada ni se llama a Whisper,
// y enseñarlos sería contar un trabajo que no se está haciendo.
const PASOS_AUDIO = ["Subiendo audio…", "Transcribiendo con Whisper…"];
const PASOS_IA = [
  "Identificando objetivos trabajados…",
  "Repartiendo por los apartados del registro…",
  "Preparación, devolución y notas internas…",
];
const pasosDelProceso = (conAudio) => (conAudio ? [...PASOS_AUDIO, ...PASOS_IA] : ["Leyendo tus notas…", ...PASOS_IA]);

// Lo que NO es un apartado de plantilla: los puntos 1 y 3 del registro. Los del
// punto 2 se añaden a este mismo objeto según los pida la plantilla, con la
// clave del apartado; por eso aquí solo están estos dos.
const FORM_VACIO = {
  prepText: "",
  parentFeedback: "",
  internalNotes: "",
};

// Cómo entra en el registro lo que devuelve la IA del audio, por si el apartado
// no está en la plantilla del centro y hay que crearlo al vuelo: un botón que
// trae contenido no puede escribirlo en un sitio que no se ve.
const NOMBRES_AUDIO = {
  objectives: "Objetivos trabajados",
  activities: "Actividades realizadas",
  performance: "Desempeño",
  familyComments: "Comentarios familiares",
  nextSessionNotes: "Próximas sesiones",
  homeworkTasks: "Tareas para casa",
  incidents: "Incidencias",
};
const TIPO_AUDIO = { objectives: "lista" };

const fmtSize = (b) => (b == null ? "" : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`);
const fmtDur = (s) => (s == null ? "" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);

export default function NuevaSesionPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id;
  const query = useSearchParams();

  const [patient, setPatient] = useState(null);
  const [loadingPatient, setLoadingPatient] = useState(true);
  // Quien llega desde una cita («Preparar sesión») entra DIRECTO al formulario
  // de preparación: el enlace ya dijo a qué venía. Va en el estado inicial y no
  // en un efecto, para que volver al registro a mano no se deshaga solo.
  const [state, setState] = useState(() => (pidePreparar(query.get("preparar")) ? STATE.PREPARING : STATE.FORM));
  // La fecha de la cita, si viene; si no, ahora. Se acota en `fechaDePreparacion`
  // porque llega por la barra de direcciones. La comparten el registro y la
  // preparación: es «cuándo es (o fue) la sesión».
  const [fecha, setFecha] = useState(() => paraInputLocal(fechaDePreparacion(query.get("fecha")) ?? new Date()));
  // ⚠️ La preparación vive en UN solo sitio: `form.prepText`. Las dos pantallas
  // —el registro completo y «Preparar la sesión»— escriben en él. Hasta el
  // 01/09/2026 la de preparación tenía su propio estado (`prepSolo`) y el texto
  // NO cruzaba: se escribía la preparación en el registro, se pulsaba «Guárdala
  // solo como preparación» y aparecía el recuadro VACÍO con el botón apagado.
  // Desde fuera eso es «guardar la preparación no funciona, no se guarda nada
  // como borrador» — y era cierto: no había manera de guardarla desde ahí. El
  // día y los adjuntos ya se compartían; el texto era el único que se caía.
  const [form, setForm] = useState(FORM_VACIO);
  // Los apartados del punto 2. Arrancan con los de fábrica para que la pantalla
  // se pinte entera antes de que conteste /api/clinica/plantillas; en cuanto
  // llega la plantilla del centro se sustituyen (el formulario está vacío
  // todavía, así que no se pierde nada escrito).
  const [apartados, setApartados] = useState(() => PLANTILLA_BASE.registro.apartados.map((a) => ({ ...a })));
  const [plantillas, setPlantillas] = useState([]);
  const [plantillaKey, setPlantillaKey] = useState("");
  const [file, setFile] = useState(null);
  // Lo apuntado a mano (01/09/2026, Rodrigo): la otra puerta al mismo botón.
  // No se borra al quitar el audio — son dos cosas independientes que se pueden
  // dar por separado o juntas.
  const [notas, setNotas] = useState("");
  const [processingStep, setProcessingStep] = useState(0);
  const [result, setResult] = useState(null); // { transcription, propuesta, structured, audioDurationSec, demo }
  // La propuesta se guarda aparte del `result` porque se puede volver a abrir
  // después de aplicarla (o de cerrarla sin aplicar): el panel es una decisión,
  // no un paso del que no se vuelve.
  const [propuesta, setPropuesta] = useState(null);
  const [verPropuesta, setVerPropuesta] = useState(false);
  const [avisoAudio, setAvisoAudio] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [saving, setSaving] = useState(false);
  // Adjuntos de la PREPARACIÓN (punto 4 del sprint). Se quedan en memoria hasta
  // que la sesión existe: el endpoint de adjuntos necesita su id.
  const [prepFiles, setPrepFiles] = useState([]);
  const fileRef = useRef(null);

  useEffect(() => {
    fetch(`/api/pacientes/${id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => j.ok && setPatient(j.data))
      .catch(() => {})
      .finally(() => setLoadingPatient(false));
    fetch("/api/clinica/plantillas", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const lista = j?.data?.registro ?? [];
        if (!lista.length) return;
        setPlantillas(lista);
        setPlantillaKey(lista[0].key);
        setApartados(lista[0].apartados.map((a) => ({ ...a })));
      })
      .catch(() => {});
  }, [id]);

  /**
   * Cambiar de plantilla rehace la lista de apartados. Lo escrito no se pierde:
   * los que compartan clave conservan su texto y el resto sigue en `form` por si
   * se vuelve atrás — al registro solo va lo que esté en la lista al guardar.
   */
  function elegirPlantilla(key) {
    const p = plantillas.find((x) => x.key === key);
    if (!p) return;
    setPlantillaKey(key);
    setApartados(p.apartados.map((a) => ({ ...a })));
  }

  /**
   * Mete contenido en el registro y, si un apartado no está en la plantilla de
   * esta sesión, lo AÑADE al final en vez de escribir en un sitio invisible.
   */
  function ponerContenido(nuevos) {
    setForm((f) => ({ ...f, ...nuevos }));
    setApartados((prev) => {
      // Los tres del envoltorio —preparación, devolución y notas internas— NO
      // son apartados de plantilla: tienen su propia tarjeta y su columna. Si
      // se colaran aquí saldrían DOS veces en la pantalla y, peor, se guardarían
      // también dentro de `contentSections`.
      const faltan = Object.keys(nuevos).filter((k) => !esEnvoltorio(k) && !prev.some((a) => a.key === k));
      if (!faltan.length) return prev;
      return [...prev, ...faltan.map((k) => ({ key: k, label: NOMBRES_AUDIO[k] ?? k, tipo: TIPO_AUDIO[k] ?? "texto" }))];
    });
  }

  const pasos = pasosDelProceso(!!file);

  // Animación de los pasos mientras la petición está en vuelo.
  useEffect(() => {
    if (state !== STATE.PROCESSING) return;
    setProcessingStep(0);
    const t = setInterval(() => setProcessingStep((s) => Math.min(s + 1, pasos.length - 1)), 700);
    return () => clearInterval(t);
  }, [state, pasos.length]);

  /**
   * Los bloques de ESTE registro, en el orden de la pantalla: preparación · los
   * apartados de la plantilla elegida (con los sueltos añadidos aquí) ·
   * devolución de la familia · notas internas. Es la misma función que usa el
   * servidor para montar el prompt, así que lo que vuelve cae exactamente en los
   * apartados que se están viendo.
   */
  const bloques = bloquesDelRegistro(apartados);

  /**
   * Manda el MATERIAL —el audio, las notas escritas, o los dos— y PROPONE el
   * registro entero. No escribe nada: lo que vuelve se enseña en el panel y ella
   * decide apartado por apartado (01/09/2026, Rodrigo).
   */
  async function procesarConIA() {
    const texto = notas.trim();
    if (!file && !texto) return;
    setState(STATE.PROCESSING);
    setErrorMsg(null);
    setAvisoAudio(null);
    try {
      const fd = new FormData();
      if (file) fd.append("file", file, file.name);
      if (texto) fd.append("texto", texto);
      // Los apartados del centro y lo ya tecleado viajan con el material: sin
      // ellos el servidor no sabría qué apartados tiene esta sesión y volvería a
      // proponer los siete de fábrica.
      fd.append("apartados", JSON.stringify(apartados));
      fd.append("escrito", JSON.stringify(form));
      const r = await fetch("/api/clinica/sessions/transcribe", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo procesar");
      setResult(j.data);
      const p = j.data.propuesta ?? {};
      const cuantos = Object.values(p).filter((v) => String(v ?? "").trim()).length;
      setPropuesta(p);
      // Con propuesta se abre el panel directamente: es a lo que ha venido.
      setVerPropuesta(cuantos > 0);
      const deDonde = file && texto ? "Audio y notas leídos" : file ? "Audio transcrito" : "Notas leídas";
      setAvisoAudio(
        j.data.avisoIA ??
          (cuantos > 0
            ? `${deDonde}. La IA propone ${cuantos} apartado(s): revísalos y elige cuáles entran.`
            : `${deDonde}, pero la IA no ha sacado nada que repartir.`)
      );
      setState(STATE.FORM);
    } catch (e) {
      setErrorMsg(e.message);
      setState(STATE.FORM);
    }
  }

  // Quitar el audio NO borra las notas escritas: son dos fuentes distintas y
  // quien tenga las dos puede querer deshacerse solo de una.
  function quitarAudio() {
    setFile(null);
    setResult(null);
    setPropuesta(null);
    setVerPropuesta(false);
    setAvisoAudio(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  /** Lo elegido en el panel entra en el formulario. Guardar sigue siendo suyo. */
  function aplicarPropuesta(cambios) {
    const cuantos = Object.keys(cambios).length;
    ponerContenido(cambios);
    setVerPropuesta(false);
    setAvisoAudio(
      cuantos > 0
        ? `Se han escrito ${cuantos} apartado(s) con la propuesta de la IA. Revisa y edita antes de guardar.`
        : "No has aplicado ningún apartado."
    );
  }

  /**
   * Guardar una sesión que TODAVÍA NO SE HA DADO (flujo de la mañana del 26/08,
   * intacto). El cuerpo lo arma `payloadDePreparacion`, que NO manda los campos
   * de la IA: una sesión preparada no ha pasado por Whisper ni por Claude.
   */
  async function guardarPreparacion() {
    if (!patient?.mainTherapistId) {
      setErrorMsg("El paciente no tiene terapeuta asignado. Asígnale uno en su ficha antes de guardar.");
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    try {
      // El input de fecha manda hora LOCAL sin zona y `new Date` la lee como
      // local: es exactamente la hora que ve quien la escribe.
      const escrita = fecha ? new Date(fecha) : new Date();
      const payload = payloadDePreparacion({
        patientId: id,
        therapistId: patient.mainTherapistId,
        fecha: Number.isNaN(escrita.getTime()) ? new Date() : escrita,
        prepText: form.prepText,
      });
      const r = await fetch("/api/clinica/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo guardar la preparación");
      await subirAdjuntos(j.data.id, "Preparación guardada");
    } catch (e) {
      setErrorMsg(e.message);
      setSaving(false);
    }
  }

  // Los adjuntos van DESPUÉS del POST: necesitan el id de la sesión recién
  // creada. Si alguno falla no se pierde la sesión: se avisa y se queda aquí.
  async function subirAdjuntos(sessionId, etiquetaOk) {
    const fallidos = [];
    for (const f of prepFiles) {
      const fd = new FormData();
      fd.append("file", f, f.name);
      const up = await fetch(`/api/clinica/sessions/${sessionId}/prep-files`, { method: "POST", body: fd });
      if (!up.ok) fallidos.push(f.name);
    }
    if (fallidos.length) {
      setErrorMsg(`${etiquetaOk}, pero no se pudieron subir: ${fallidos.join(", ")}. Puedes añadirlos desde la ficha.`);
      setSaving(false);
      return;
    }
    router.push(`/pacientes/${id}`);
  }

  // Un registro sin NADA escrito no es un registro: algo tiene que llevar.
  const hayContenido = Object.values(form).some((v) => String(v ?? "").trim());

  // Lo escrito FUERA de la preparación. Guardar solo la preparación NO se lo
  // lleva —`payloadDePreparacion` manda `prepText` y nada más—, así que la
  // pantalla lo dice antes en vez de tirarlo en silencio.
  const hayMasQueLaPreparacion = Object.entries(form).some(
    ([k, v]) => k !== "prepText" && String(v ?? "").trim()
  );

  async function guardarRegistro() {
    if (!patient?.mainTherapistId) {
      setErrorMsg("El paciente no tiene terapeuta asignado. Asígnale uno en su ficha antes de guardar.");
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    try {
      const escrita = fecha ? new Date(fecha) : new Date();
      // Los apartados de fábrica van a sus columnas de siempre y los nuevos a
      // `contentSections`, junto con la foto de con qué apartados se escribió
      // esto (lib/clinica/plantillas.js). Ese reparto NO se hace a mano aquí: lo
      // comparten este formulario y el cajón del informe.
      const reparto = repartirValoresDeSesion(desdeFormulario(form, apartados), apartados);
      reparto.contentSections[CLAVE_PLANTILLA] = plantillaKey;
      const payload = {
        patientId: id,
        therapistId: patient.mainTherapistId,
        sessionDate: (Number.isNaN(escrita.getTime()) ? new Date() : escrita).toISOString(),
        ...reparto,
        prepText: form.prepText,
        parentFeedback: form.parentFeedback,
        internalNotes: form.internalNotes,
        status: "registered",
        // Solo si pasó por la IA. `aiTranscription` guarda el MATERIAL entero
        // —la transcripción del audio, las notas pegadas, o las dos—: es de
        // dónde salió el registro, y sin esto lo que ella escribiera y la IA no
        // supiera colocar se perdería al guardar. `audioDurationSec` viene a
        // null cuando no hubo audio, que es lo que distingue las dos vías. Un
        // registro escrito a mano de principio a fin no manda nada de esto.
        ...(result
          ? {
              aiTranscription: result.material ?? result.transcription,
              aiStructured: result.structured,
              audioDurationSec: result.audioDurationSec,
              aiReviewedAt: new Date().toISOString(),
            }
          : {}),
      };
      const r = await fetch("/api/clinica/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo guardar la sesión");
      await subirAdjuntos(j.data.id, "Sesión guardada");
    } catch (e) {
      setErrorMsg(e.message);
      setSaving(false);
    }
  }

  /*
   * ── ARRASTRAR Y SOLTAR (28/08/2026, Lau de Aumenta) ───────────────────────
   * El audio le llega por WhatsApp y lo descarga: le queda a la vista en la
   * barra de descargas del navegador. Pulsar «Añadir audio» abría el explorador
   * de Windows y la obligaba a ir a buscar en Descargas el fichero que ya tenía
   * delante. Ahora se puede soltar encima de la tarjeta (y pegar con Ctrl+V),
   * sin quitar el clic de siempre para quien lo prefiera.
   *
   * Los ganchos van AQUÍ, antes de los `return` de carga: son hooks.
   */
  useEvitarSoltarFuera();

  const zonaAudio = useZonaSoltar({
    accept: ACEPTA_AUDIO,
    queSeEspera: "un audio de la sesión",
    // Con el audio ya procesado no se admite otro: primero hay que quitarlo.
    apagada: state !== STATE.FORM || !!result,
    pegar: true,
    onFicheros: ([f]) => {
      setFile(f);
      setErrorMsg(null);
    },
    onAviso: setErrorMsg,
  });

  const zonaPrep = useZonaSoltar({
    accept: ACEPTA_PREP,
    varios: true,
    queSeEspera: "fotos, audios o PDF",
    onFicheros: (nuevos) => {
      setPrepFiles((prev) => [...prev, ...nuevos].slice(0, MAX_PREP));
      setErrorMsg(null);
    },
    onAviso: setErrorMsg,
  });

  const therapistName = patient?.therapist?.name ?? "—";
  const ta = "w-full px-3 py-2 text-xs border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400 leading-relaxed";

  if (loadingPatient) return <div className="p-4 lg:p-8 text-sm text-neutral-400">Cargando…</div>;
  if (!patient) {
    return (
      <div className={anchoPantalla("listado")}>
        <div className="bg-white border border-neutral-100 rounded-xl p-10 text-center mt-5">
          <p className="text-sm text-neutral-600">Paciente no encontrado.</p>
          <Link href="/pacientes" className="text-xs text-[var(--color-primary,#1B3A2D)] hover:underline mt-2 inline-block">← Volver al listado</Link>
        </div>
      </div>
    );
  }

  const adjuntosPrep = (
    <div
      {...zonaPrep.props}
      className={`-mx-2 px-2 py-1.5 rounded-lg border border-dashed transition-colors ${
        zonaPrep.arrastrando ? "border-[var(--color-primary,#1B3A2D)] bg-neutral-50" : "border-transparent"
      }`}
    >
      <label className="text-[11px] text-[var(--color-primary,#1B3A2D)] hover:underline cursor-pointer">
        {zonaPrep.arrastrando ? "Suelta aquí los archivos" : "+ Adjuntar fotos, audio o PDF (o arrástralos aquí)"}
        <input
          type="file"
          multiple
          accept={ACEPTA_PREP}
          className="hidden"
          onChange={(e) => {
            const nuevos = Array.from(e.target.files ?? []);
            e.target.value = "";
            setPrepFiles((prev) => [...prev, ...nuevos].slice(0, MAX_PREP));
          }}
        />
      </label>
      {prepFiles.length > 0 && (
        <ul className="mt-2 space-y-1">
          {prepFiles.map((f, i) => (
            <li key={`${f.name}-${i}`} className="text-[11px] text-neutral-600 flex items-center gap-2">
              <span className="truncate">{f.name}</span>
              <span className="text-neutral-400 shrink-0">{fmtSize(f.size)}</span>
              <button
                onClick={() => setPrepFiles((prev) => prev.filter((_, idx) => idx !== i))}
                className="text-rose-500 hover:text-rose-700 shrink-0"
              >
                quitar
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[10px] text-neutral-400 mt-1">
        Material interno del equipo: no se comparte con la familia.
      </p>
    </div>
  );

  return (
    <div className={`${anchoPantalla("listado")} space-y-5`}>
      <nav className="flex items-center gap-1.5 text-xs text-neutral-500">
        <Link href="/pacientes" className="hover:text-[var(--color-primary,#1B3A2D)]">Pacientes</Link>
        <span className="text-neutral-300">/</span>
        <Link href={`/pacientes/${id}`} className="hover:text-[var(--color-primary,#1B3A2D)]">{patient.firstName} {patient.lastName}</Link>
        <span className="text-neutral-300">/</span>
        <span className="text-neutral-700">Nuevo registro</span>
      </nav>

      <input
        ref={fileRef}
        type="file"
        accept={ACEPTA_AUDIO}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); setErrorMsg(null); } }}
      />

      {errorMsg && <div className="px-4 py-3 rounded-lg bg-rose-50 border border-rose-100 text-xs text-rose-700">{errorMsg}</div>}

      {/* Lo que ha sacado la IA, para elegir apartado por apartado. Se le pasa
          `form` como «lo tuyo»: si ya habías escrito, la propuesta se enseña al
          lado y viene marcada la tuya. */}
      {verPropuesta && propuesta && (
        <PropuestaIA
          bloques={bloques}
          escrito={form}
          propuesta={propuesta}
          // El texto del que salió, tal cual se le mandó a la IA: si hubo audio
          // y notas, las dos cosas con su rótulo. El panel lo enseña plegado.
          transcription={result?.material ?? result?.transcription ?? ""}
          // El rótulo dice la verdad de por dónde entró: decir «del audio»
          // sobre unas notas pegadas es pequeño, pero es mentira.
          titulo={
            result?.audioDurationSec != null && notas.trim()
              ? "Lo que ha sacado la IA del audio y tus notas"
              : result?.audioDurationSec != null
                ? "Lo que ha sacado la IA del audio"
                : "Lo que ha sacado la IA de tus notas"
          }
          onAplicar={aplicarPropuesta}
          onCerrar={() => setVerPropuesta(false)}
          textoAplicar="Escribir en el registro"
        />
      )}

      {/* ── FORM: el registro completo, en texto y con el audio opcional ── */}
      {state === STATE.FORM && (
        <>
          <div className="bg-white border border-neutral-100 rounded-xl p-5 lg:p-7">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="eyebrow mb-1">Nuevo registro de sesión</div>
                <h1 className="font-display text-2xl lg:text-3xl text-[var(--ink-900)] tracking-tight">{patient.firstName} {patient.lastName}</h1>
                <p className="text-xs text-neutral-500 mt-1">{therapistName}</p>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1.5">Día y hora de la sesión</div>
                <input type="datetime-local" className={ta} value={fecha} onChange={(e) => setFecha(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Audio, opcional. Dentro del registro y no como puerta de entrada
              (26/08/2026, Rodrigo): el registro se escribe; el audio, si lo
              hay, lo adelanta. */}
          <div
            {...zonaAudio.props}
            className={`bg-white rounded-xl p-4 lg:p-5 border transition-colors ${
              zonaAudio.arrastrando
                ? "border-2 border-dashed border-[var(--color-primary,#1B3A2D)] bg-neutral-50"
                : "border-neutral-100"
            }`}
          >
            <div className="flex flex-wrap items-center gap-3">
              <div className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-white" style={{ background: "var(--color-primary, #1B3A2D)" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" /></svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-[var(--ink-900)]">
                  ¿Tienes audio o notas de la sesión? <span className="font-normal text-neutral-400">(opcional)</span>
                  <HelpTooltip title="Qué se guarda y qué no" className="ml-1.5 tracking-normal normal-case">
                    El audio sirve para sacar el texto y se descarta: en la sesión quedan la
                    transcripción y la duración, no la grabación. Si quieres conservarla, guárdala tú.
                    El texto que pegues sí se guarda con la sesión, como constancia de dónde salió el
                    registro. Lo que adjuntes en «Preparación» también se queda.
                  </HelpTooltip>
                </div>
                {!file ? (
                  <p className="text-[11px] text-neutral-500 mt-0.5">
                    {zonaAudio.arrastrando
                      ? "Suéltalo aquí."
                      : "Arrastra el audio aquí, pégalo con Ctrl+V o búscalo — o pega abajo lo que tengas apuntado. La IA te propone el registro entero, de la preparación a las notas internas; tú eliges qué entra. m4a, mp3, wav, ogg, webm · máx. 25 MB."}
                  </p>
                ) : (
                  <p className="text-[11px] text-neutral-600 mt-0.5 truncate">
                    {file.name} · {fmtSize(file.size)}{result?.audioDurationSec != null ? ` · ${fmtDur(result.audioDurationSec)}` : ""}
                  </p>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                {!file && (
                  <button type="button" onClick={() => fileRef.current?.click()} className="text-xs font-medium px-3 py-2 rounded-lg border border-neutral-200 bg-white hover:border-neutral-400 text-neutral-700">
                    Añadir audio
                  </button>
                )}
                {file && (
                  <button type="button" onClick={quitarAudio} className="text-xs px-3 py-2 text-neutral-500 hover:underline">
                    {result ? "Quitar audio" : "Quitar"}
                  </button>
                )}
              </div>
            </div>

            {/* ── Las notas escritas (01/09/2026, Rodrigo) ──────────────────
                «Por si apuntan todo en un bloc de notas y lo pasan ahí.» No
                todo el mundo graba, y para la IA el audio y esto son lo mismo:
                texto del que sacar el registro. Por eso comparten tarjeta y
                comparten botón — y si se dan las dos cosas, se usan las dos. */}
            <div className="mt-3 border-t border-neutral-100 pt-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1.5">
                <div className="eyebrow">{file ? "…y tus notas" : "O pega tus notas"}</div>
                <span className={`text-[10px] ${notas.length > MAX_NOTAS ? "text-rose-600 font-medium" : "text-neutral-400"}`}>
                  {notas.length > 0 && `${notas.length.toLocaleString("es-ES")} / ${MAX_NOTAS.toLocaleString("es-ES")}`}
                </span>
              </div>
              <textarea
                className={ta}
                rows={notas ? 5 : 3}
                placeholder="Pega aquí lo que tengas apuntado: el bloc de notas, el móvil, lo escrito a mano pasado a limpio… Tal cual, sin ordenarlo."
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
              />
            </div>

            {(file || notas.trim()) && (
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={procesarConIA}
                  disabled={notas.length > MAX_NOTAS}
                  className="text-xs font-medium px-4 py-2 rounded-lg text-white hover:opacity-90 inline-flex items-center gap-2 disabled:opacity-40"
                  style={{ background: "var(--color-primary, #1B3A2D)" }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
                  {/* Se puede volver a pulsar: si añade más notas después de la
                      primera pasada, obligarla a quitar el audio para volver a
                      empezar sería absurdo. */}
                  {result
                    ? "Volver a procesar con IA"
                    : file && notas.trim()
                      ? "Procesar audio y notas con IA"
                      : file
                        ? "Procesar el audio con IA"
                        : "Rellenar el registro con mis notas"}
                </button>
              </div>
            )}

            {avisoAudio && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-100 text-[11px] text-emerald-800 flex flex-wrap items-center gap-2">
                <span className="flex-1 min-w-[12rem]">{avisoAudio}{result?.demo ? " (datos de demostración)" : ""}</span>
                {/* El panel se puede volver a abrir mientras no se quite el
                    audio: se cierra sin querer, o se aplica media propuesta y
                    luego se ve que faltaba un apartado. */}
                {propuesta && Object.values(propuesta).some((v) => String(v ?? "").trim()) && (
                  <button
                    type="button"
                    onClick={() => setVerPropuesta(true)}
                    className="shrink-0 font-medium text-emerald-900 underline hover:no-underline"
                  >
                    Ver la propuesta de la IA
                  </button>
                )}
              </div>
            )}
            {result?.transcription && (
              <div className="mt-3 border-t border-neutral-100 pt-3">
                <div className="eyebrow mb-1.5">Transcripción literal</div>
                <p className="text-xs text-neutral-600 leading-relaxed italic">«{result.transcription}»</p>
              </div>
            )}
          </div>

          {/* 1 · Preparación */}
          <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5 space-y-3">
            <div className="eyebrow">1 · Preparación</div>
            <p className="text-[10px] text-neutral-400 -mt-2">
              Lo que preparaste antes de la sesión. Se guarda con ella y sirve para redactar el informe.
            </p>
            <textarea
              className={ta}
              rows={3}
              placeholder="Material previsto, hipótesis de trabajo, qué observar…"
              value={form.prepText}
              onChange={(e) => setForm({ ...form, prepText: e.target.value })}
            />
            {adjuntosPrep}
          </div>

          {/* 2 · Informe — sus apartados salen de la plantilla del centro
              (29/08/2026), y aquí se pueden añadir sueltos para esta sesión. */}
          <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5 space-y-4">
            <div className="eyebrow">2 · Informe de la sesión</div>
            <ApartadosEditor
              apartados={apartados}
              valores={form}
              onValor={(clave, v) => setForm((f) => ({ ...f, [clave]: v }))}
              onApartados={setApartados}
              plantillas={plantillas}
              plantillaKey={plantillaKey}
              onPlantilla={elegirPlantilla}
              clavesDePlantilla={
                new Set(
                  (plantillas.find((x) => x.key === plantillaKey)?.apartados ?? PLANTILLA_BASE.registro.apartados).map(
                    (a) => a.key
                  )
                )
              }
            />
          </div>

          {/* 3 · Devolución de la familia */}
          <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5 space-y-3">
            <div className="eyebrow">3 · Devolución de la familia</div>
            <p className="text-[10px] text-neutral-400 -mt-2">
              Lo que te han contado los padres al recoger: cómo ha ido la semana, qué han notado en casa.
            </p>
            <textarea
              className={ta}
              rows={3}
              placeholder="Qué dice la familia…"
              value={form.parentFeedback}
              onChange={(e) => setForm({ ...form, parentFeedback: e.target.value })}
            />
          </div>

          {/* 4 · Notas internas — el único apartado que la familia no puede leer. */}
          <div className="bg-white border border-amber-200 rounded-xl p-4 lg:p-5 space-y-3">
            <div className="eyebrow text-amber-700">4 · Notas internas del equipo</div>
            <p className="text-[10px] text-neutral-400 -mt-2">
              Solo para vosotros: implicación de la familia, cómo están los padres, actitudes.
              No sale en el informe que recibe la familia ni en su área privada, aunque se anexen los registros.
            </p>
            <textarea
              className={ta}
              rows={3}
              placeholder="Lo que conviene que sepa el equipo y no la familia…"
              value={form.internalNotes}
              onChange={(e) => setForm({ ...form, internalNotes: e.target.value })}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 justify-end">
            <p className="text-[11px] text-neutral-500 mr-auto">
              ¿Todavía no la has dado?{" "}
              <button
                type="button"
                onClick={() => setState(STATE.PREPARING)}
                className="font-medium text-[var(--color-primary,#1B3A2D)] hover:underline"
              >
                Guárdala solo como preparación
              </button>
            </p>
            <button onClick={() => router.push(`/pacientes/${id}`)} disabled={saving} className="text-xs px-4 py-2 text-neutral-500 hover:underline disabled:opacity-50">Cancelar</button>
            <button
              onClick={guardarRegistro}
              disabled={saving || !hayContenido}
              title={!hayContenido ? "Escribe algo del registro (o procesa un audio) para poder guardarlo" : undefined}
              className="text-xs font-medium px-4 py-2 rounded-lg text-white hover:opacity-90 inline-flex items-center gap-2 disabled:opacity-50"
              style={{ background: "var(--color-primary, #1B3A2D)" }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
              {saving ? "Guardando…" : "Guardar registro"}
            </button>
          </div>
        </>
      )}

      {/* ── PREPARING: la sesión que aún no se ha dado (flujo intacto) ────── */}
      {state === STATE.PREPARING && (
        <div className="bg-white border border-neutral-100 rounded-xl p-6 lg:p-10">
          <div className="text-center mb-6">
            <div className="eyebrow mb-2">Preparar la sesión</div>
            <h1 className="font-display text-2xl lg:text-3xl text-[var(--ink-900)] tracking-tight">{patient.firstName} {patient.lastName}</h1>
            <p className="text-xs text-neutral-500 mt-1">{therapistName}</p>
          </div>

          <div className="max-w-2xl mx-auto space-y-4">
            <p className="text-[11px] text-neutral-600 leading-relaxed bg-neutral-50 border border-neutral-100 rounded-lg px-3 py-2.5">
              Se guarda como <strong>borrador</strong>: queda apuntada en la ficha con lo que
              prepares, y el día de la sesión se completa encima —escribiéndola o con el audio.
              Mientras su fecha no haya llegado no cuenta como sesión dada.
            </p>

            {/* Se llega aquí desde el registro completo, y de ahí solo viaja la
                preparación. Si hay algo más escrito se avisa: perderlo sin
                decirlo es justo lo que hacía esta pantalla antes del 01/09. */}
            {hayMasQueLaPreparacion && (
              <p className="text-[11px] text-amber-800 leading-relaxed bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                Aquí se guarda <strong>solo la preparación</strong>. Lo que hayas escrito en el
                informe de la sesión, en la devolución de la familia o en las notas internas no
                entra en el borrador: vuelve al{" "}
                <button
                  type="button"
                  onClick={() => setState(STATE.FORM)}
                  className="font-medium underline"
                >
                  registro completo
                </button>{" "}
                si quieres guardarlo todo.
              </p>
            )}

            <div>
              <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1.5">Día y hora de la sesión</div>
              <input
                type="datetime-local"
                className={ta}
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
              />
            </div>

            <div>
              <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1.5">Preparación</div>
              <textarea
                className={ta}
                rows={6}
                placeholder="Material previsto, hipótesis de trabajo, qué observar…"
                value={form.prepText}
                onChange={(e) => setForm((f) => ({ ...f, prepText: e.target.value }))}
              />
            </div>

            {adjuntosPrep}

            <div className="flex flex-wrap gap-2 justify-end pt-1">
              <button onClick={() => router.push(`/pacientes/${id}`)} disabled={saving} className="text-xs px-4 py-2 text-neutral-500 hover:underline disabled:opacity-50">Cancelar</button>
              <button onClick={() => setState(STATE.FORM)} disabled={saving} className="text-xs px-4 py-2 rounded-lg border border-neutral-200 hover:border-neutral-400 text-neutral-700 disabled:opacity-50">Hacer el registro completo</button>
              <button
                onClick={guardarPreparacion}
                disabled={saving || !form.prepText.trim()}
                title={!form.prepText.trim() ? "Escribe la preparación para poder guardarla" : undefined}
                className="text-xs font-medium px-4 py-2 rounded-lg text-white hover:opacity-90 inline-flex items-center gap-2 disabled:opacity-50"
                style={{ background: "var(--color-primary, #1B3A2D)" }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                {saving ? "Guardando…" : "Guardar preparación"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── PROCESSING ── */}
      {state === STATE.PROCESSING && (
        <div className="bg-white border border-neutral-100 rounded-xl p-8 lg:p-12 text-center">
          <div className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center text-white mb-5" style={{ background: "var(--color-primary, #1B3A2D)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-7 h-7 animate-spin"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
          </div>
          <h2 className="font-display text-xl lg:text-2xl text-[var(--ink-900)]">
            {file ? "Procesando audio con IA" : "Rellenando el registro con tus notas"}
          </h2>
          <p className="text-xs text-neutral-500 mt-1">
            {file?.name ?? `${notas.trim().length.toLocaleString("es-ES")} caracteres`}
          </p>
          <ul className="mt-8 max-w-md mx-auto space-y-2 text-left">
            {pasos.map((step, i) => {
              const done = i < processingStep;
              const current = i === processingStep;
              return (
                <li key={i} className="flex items-center gap-2.5 text-xs">
                  <span className={`shrink-0 w-4 h-4 rounded-full flex items-center justify-center ${done ? "bg-emerald-500 text-white" : current ? "bg-neutral-100" : "bg-neutral-50"}`}>
                    {done && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="w-2.5 h-2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                    {current && <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary,#1B3A2D)] animate-pulse" />}
                  </span>
                  <span className={done ? "text-neutral-500 line-through" : current ? "text-[var(--ink-900)] font-medium" : "text-neutral-400"}>{step}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

