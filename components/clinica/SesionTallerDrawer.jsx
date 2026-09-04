"use client";

/**
 * SesionTallerDrawer — donde se escribe el registro de una sesión de TALLER
 * (01/09/2026, Aumenta por Rodrigo).
 *
 * «A todos les saldrá el registro en sus sesiones como parte del taller y que
 * se pueda poner un apartado para cada paciente y que solo le salga a él. Es
 * decir, el registro general el mismo a todos menos el apartado extra privado
 * para cada paciente.»
 *
 * Por eso el formulario está partido en dos zonas que se leen distinto:
 *
 *   1. **El registro del grupo** — se escribe UNA vez, con los mismos apartados
 *      que un registro de sesión normal (`ApartadosEditor`, la plantilla del
 *      centro). Es lo que va a acabar igual en la ficha de los ocho.
 *   2. **Cada paciente** — su casilla de asistencia y SU nota, que no ve nadie
 *      más. La zona lo dice con todas las letras, porque es la única parte del
 *      CRM donde ocho familias comparten un documento y la confusión se paga
 *      cara.
 *
 * Lo que se guarda aquí lo reparte el servidor (`lib/clinica/propagarTaller.js`):
 * esta pantalla no sabe —ni tiene que saber— cómo se copia a cada ficha.
 *
 * ── EL AUDIO Y LA IA (03/09/2026, Rodrigo: «añade audio e IA a la sesión de
 * taller») ─────────────────────────────────────────────────────────────────
 * La misma tarjeta que tiene el registro de sesión normal: un audio, o lo
 * apuntado en el bloc de notas, o los dos; la IA propone el registro ENTERO
 * del taller —el cuerpo común, la nota de cada niño que vino y las notas
 * internas— y se elige bloque a bloque en `PropuestaIA`. Nada se escribe solo.
 *
 * Lo que la hace distinta del registro normal es la lista de asistentes: viaja
 * con el material para que la IA sepa a quién puede nombrar, y lo que se diga
 * de un niño va a SU nota y a ningún otro sitio (`lib/clinica/tallerCompleto.js`).
 * Un audio se transcribe una sola vez; la transcripción se guarda con la sesión
 * para poder volver a pasar la IA sin subirlo otra vez.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import ApartadosEditor from "./ApartadosEditor.jsx";
import PropuestaIA from "./PropuestaIA.jsx";
import useZonaSoltar, { useEvitarSoltarFuera } from "@/components/ui/useZonaSoltar.js";
import useGrabadora, { fmtSegundos } from "@/components/clinica/useGrabadora.js";
import useAudios from "@/components/clinica/useAudios.js";
import {
  PLANTILLA_BASE,
  PLANTILLA_TALLER,
  aFormulario,
  apartadosConPlantillas,
  desdeFormulario,
} from "@/lib/clinica/plantillas.js";
import { ETIQUETA_NOTA_POR_DEFECTO } from "@/lib/clinica/tallerSesion.js";
import { MAX_NOTAS } from "@/lib/clinica/registroCompleto.js";
import { MAX_AUDIOS } from "@/lib/clinica/audios.js";
import { BLOQUE_INTERNAS, escritoDelTaller, pacienteDeClave } from "@/lib/clinica/tallerCompleto.js";
import { leerRespuestaApi } from "@/lib/utils/respuestaApi.js";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition";
const ta =
  "w-full px-3 py-2 text-xs border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400 leading-relaxed";

const ACEPTA_AUDIO = "audio/*,.m4a,.mp3,.wav,.ogg,.webm,.mp4";
const fmtSize = (b) => (b == null ? "" : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`);
const fmtDur = (s) => (s == null ? "" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);

/** "2026-09-01T17:00:00Z" → "2026-09-01" y "19:00" en hora de Madrid. */
function partirEnMadrid(valor) {
  const d = valor ? new Date(valor) : new Date();
  if (Number.isNaN(d.getTime())) return { fecha: "", hora: "" };
  const p = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d).reduce((a, x) => ({ ...a, [x.type]: x.value }), {});
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
}

export default function SesionTallerDrawer({
  tallerId,
  tallerName,
  sesionId,
  // El GRUPO del que es la sesión (01/09/2026). Sin él la sesión sería «de la
  // actividad», que desde que hay varios grupos no dice de quién es.
  grupoId = null,
  // Y la CITA de la que sale, cuando se escribe desde la agenda. Es lo que hace
  // que entrar y salir siga editando el MISMO registro (una cita, un registro).
  bookingId = null,
  /*
   * Cuándo y cuánto duró, cuando se escribe desde una cita. Sin esto el
   * registro nacía con la fecha y la hora de AHORA, y el taller del martes
   * apuntado el jueves quedaba fechado el jueves — en la ficha de los ocho.
   * `cuando` es un ISO; `duracionCita`, minutos.
   */
  cuando = null,
  duracionCita = null,
  onClose,
  onSaved,
  // Desde la agenda el taller abre DIRECTAMENTE este registro (03/09/2026,
  // Aumenta); la ficha de la cita queda a un clic, aquí arriba. `null` = no
  // hay cita que abrir (se escribe desde la pestaña del taller).
  onVerCita = null,
}) {
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState(null);

  const [plantillas, setPlantillas] = useState([PLANTILLA_BASE.registro]);
  const [apartados, setApartados] = useState([]);
  const [valores, setValores] = useState({});
  const [etiquetaNota, setEtiquetaNota] = useState(ETIQUETA_NOTA_POR_DEFECTO);

  // La de la CITA si viene de una; si no, ahora. Un taller se apunta a menudo
  // días después, y la fecha del registro es la de la tarde que se dio.
  const arranque = partirEnMadrid(cuando);
  const [fecha, setFecha] = useState(arranque.fecha);
  const [hora, setHora] = useState(arranque.hora);
  const [duracion, setDuracion] = useState(duracionCita ? String(duracionCita) : "");
  const [internas, setInternas] = useState("");
  const [cerrada, setCerrada] = useState(false);
  /** [{ patientId, nombre, asistio, nota, enviada, yaNoApuntado }] */
  const [asistentes, setAsistentes] = useState([]);
  /*
   * Quién hizo el registro (01/09/2026, Rodrigo: «para los registros de
   * sesiones se podrá elegir qué terapeuta los hace dentro del propio
   * registro»). Un taller lo dan varios y lo escribe uno; y a veces lo escribe
   * quien no estaba, porque la que estaba se puso mala. Se elige aquí.
   */
  const [equipo, setEquipo] = useState([]);
  const [teamMemberId, setTeamMemberId] = useState("");

  // ── El audio y la IA (03/09/2026) ─────────────────────────────────────────
  // Mismas piezas que en el registro normal: el fichero, lo que sacó Whisper
  // de ESE fichero (se transcribe una sola vez), si entra en esta pasada, las
  // notas escritas, y la propuesta —que se puede volver a abrir—.
  // Los audios NUEVOS de esta pasada, en plural desde el 04/09/2026 (Rodrigo:
  // «queremos subir más de un audio antes de ponerlo a transcribir»); los dos
  // estados de al lado son lo que ya venía GUARDADO con la sesión, que se sigue
  // pudiendo volver a pasar por la IA sin audio ninguno.
  const [transcripcionAudio, setTranscripcionAudio] = useState("");
  const [duracionAudio, setDuracionAudio] = useState(null);
  const [usarAudio, setUsarAudio] = useState(true);
  const [notas, setNotas] = useState("");
  // De qué texto salió el registro (lo que LEYÓ la IA en la última pasada):
  // es lo que se guarda con la sesión, como en el registro normal.
  const [materialIA, setMaterialIA] = useState("");
  const [procesando, setProcesando] = useState(false);
  const [propuesta, setPropuesta] = useState(null);
  const [bloquesIA, setBloquesIA] = useState([]);
  const [verPropuesta, setVerPropuesta] = useState(false);
  const [avisoIA, setAvisoIA] = useState(null);
  const [demoIA, setDemoIA] = useState(false);
  const fileRef = useRef(null);
  // La lista de audios de esta pasada, con su estado y su transcripción.
  const audios = useAudios({ onError: setErr, onAviso: setAvisoIA });

  const cargar = useCallback(async () => {
    setCargando(true);
    setErr(null);
    try {
      // Las plantillas del centro: son las que deciden con qué apartados se
      // escribe, igual que en un registro de sesión normal.
      const rp = await fetch("/api/clinica/plantillas", { cache: "no-store" });
      const jp = await rp.json();
      const efectivas = jp?.ok && Array.isArray(jp.data?.registro) && jp.data.registro.length
        ? jp.data.registro
        : [PLANTILLA_BASE.registro];
      /*
       * La plantilla del TALLER va la primera y es la de una sesión nueva
       * (03/09/2026, Aumenta: objetivos, actividades, desempeño, comentarios
       * familiares, preparación previa y devolución a la familia). Si el
       * centro ha guardado la suya con la misma clave, manda la suya; si el
       * servidor aún no la ofrece, se pone la de fábrica delante.
       */
      const lista = efectivas.some((p) => p?.key === PLANTILLA_TALLER.key)
        ? efectivas
        : [PLANTILLA_TALLER, ...efectivas];
      setPlantillas(lista);

      if (sesionId) {
        const r = await fetch(`/api/clinica/taller-sesiones/${sesionId}`, { cache: "no-store" });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || "No se ha podido abrir la sesión");
        const d = j.data;
        const aps = apartadosConPlantillas(d.contentSections, lista);
        setApartados(aps);
        setValores(aFormulario(d.contentSections, aps));
        const p = partirEnMadrid(d.sessionDate);
        setFecha(p.fecha);
        setHora(p.hora);
        setDuracion(d.duration ?? "");
        setInternas(d.internalNotes ?? "");
        setCerrada(d.status === "published");
        setEtiquetaNota(d.etiquetaNota || ETIQUETA_NOTA_POR_DEFECTO);
        setAsistentes(d.asistentes ?? []);
        setTeamMemberId(d.teamMemberId ?? "");
        // Lo que ya leyó la IA otro día: se puede volver a pasar sin audio.
        const material = String(d.aiTranscription ?? "").trim();
        setTranscripcionAudio(material);
        setMaterialIA(material);
        setDuracionAudio(d.audioDurationSec ?? null);
      } else {
        // Sesión nueva: con los apartados del registro de taller.
        const aps = apartadosConPlantillas({ plantilla: PLANTILLA_TALLER.key }, lista);
        setApartados(aps);
        setValores(aFormulario({}, aps));
        /*
         * Sesión nueva. De dónde sale la lista, por orden:
         *   · de la CITA, si se escribe desde la agenda: los que ya se marcaron
         *     como que vinieron. Quien pasó lista no lo hace dos veces.
         *   · del GRUPO, si se escribe desde la pestaña: los apuntados hoy,
         *     todos marcados. Quien faltó se desmarca.
         */
        let puestos = [];
        if (bookingId) {
          const rc = await fetch(`/api/citas/bookings/${bookingId}/taller`, { cache: "no-store" });
          const jc = await rc.json();
          if (jc?.ok) {
            puestos = (jc.data?.asistentes ?? []).map((a) => ({
              patientId: a.patientId,
              nombre: a.nombre,
              // Con la lista ya pasada, manda lo que se marcó; si nadie la ha
              // tocado (todos «prevista»), vienen todos marcados.
              asistio: a.status !== "no_show",
              nota: "",
            }));
            // El registro lo firma, de entrada, quien coordina el taller.
            const primero = (jc.data?.impartidores ?? [])[0];
            if (primero) setTeamMemberId(primero.teamMemberId);
          }
        }
        if (!puestos.length) {
          const url = grupoId
            ? `/api/clinica/talleres/${tallerId}/grupos/${grupoId}`
            : `/api/clinica/talleres/${tallerId}`;
          const r = await fetch(url, { cache: "no-store" });
          const j = await r.json();
          const apuntados = j?.ok ? (j.data?.apuntados ?? []) : [];
          puestos = apuntados.map((i) => ({
            patientId: i.patientId,
            nombre: [i.patient?.firstName, i.patient?.lastName].filter(Boolean).join(" ") || "—",
            asistio: true,
            nota: "",
          }));
        }
        setAsistentes(puestos);
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setCargando(false);
    }
  }, [sesionId, tallerId, grupoId, bookingId]);

  useEffect(() => { cargar(); }, [cargar]);

  // El equipo, para poder elegir y CORREGIR quién hizo el registro.
  useEffect(() => {
    fetch("/api/team?status=active&limit=200", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.ok) setEquipo(j.data?.members ?? []); })
      .catch(() => {});
  }, []);

  function cambiarAsistente(patientId, campo, valor) {
    setAsistentes((prev) => prev.map((a) => (a.patientId === patientId ? { ...a, [campo]: valor } : a)));
  }

  // ── La pasada de IA ───────────────────────────────────────────────────────
  useEvitarSoltarFuera();

  /** Los audios se SUMAN; el primero deja vieja la transcripción guardada. */
  function ponerAudio(...ficheros) {
    audios.añadir(ficheros.flat());
    setUsarAudio(true);
    setErr(null);
  }

  /**
   * Transcribir SIN llamar a la IA (04/09/2026): se mandan los audios en cuanto
   * están y se sigue escribiendo mientras Whisper trabaja.
   */
  async function transcribirAudios() {
    setErr(null);
    setAvisoIA(null);
    const cuantos = audios.pendientes.length;
    const texto = await audios.transcribir();
    if (texto) setAvisoIA(`${cuantos > 1 ? `${cuantos} audios transcritos` : "Audio transcrito"}. Ya puedes pulsar la IA sin esperar.`);
  }

  // Grabar desde el propio CRM (03/09/2026, AV-0037): en iPhone el selector
  // de archivo no ofrece la grabadora. Lo grabado entra por `ponerAudio`.
  const grabadora = useGrabadora({ onAudio: ponerAudio, onError: setErr });

  // Quitar los audios NO borra las notas escritas: son fuentes distintas.
  function quitarAudio() {
    audios.limpiar();
    setTranscripcionAudio("");
    setDuracionAudio(null);
    setMaterialIA("");
    setUsarAudio(true);
    setPropuesta(null);
    setVerPropuesta(false);
    setAvisoIA(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  const zonaAudio = useZonaSoltar({
    accept: ACEPTA_AUDIO,
    varios: true,
    queSeEspera: "audios del taller",
    apagada: procesando || guardando || audios.hueco <= 0,
    pegar: true,
    onFicheros: (nuevos) => ponerAudio(nuevos),
    onAviso: setErr,
  });

  // Qué entra del audio en esta pasada: el fichero (hay que transcribirlo), la
  // transcripción que ya hay (si se deja marcada), o nada.
  // El texto del audio: el de los audios de ahora si ya se transcribieron, y si
  // no, el que venía guardado con la sesión.
  const textoAudio = audios.hayTexto ? audios.texto : transcripcionAudio;
  const duracionDelAudio = audios.hayTexto ? audios.duracion : duracionAudio;
  const queEntra = audios.hayPendientes && usarAudio ? "audio" : textoAudio && usarAudio ? "transcripcion" : "nada";
  const conAudio = queEntra !== "nada";
  const losQueVinieron = asistentes.filter((a) => a.asistio);
  const escritoAhora = escritoDelTaller({ valores, asistentes: losQueVinieron, internalNotes: internas });

  /**
   * Manda el material —el audio, las notas, o los dos— con la lista de los que
   * vinieron, y PROPONE el registro entero del taller. No escribe nada: lo que
   * vuelve se elige bloque a bloque.
   */
  async function procesarConIA() {
    const texto = notas.trim();
    if (!conAudio && !texto) return;
    setErr(null);
    setAvisoIA(null);
    // Lo que falte por transcribir se transcribe primero y aparte, para que el
    // texto quede guardado pase lo que pase después con Claude. Lo normal es
    // que no falte nada: se ha pulsado «Transcribir» mientras se escribía.
    let transcrito = textoAudio;
    if (queEntra === "audio") {
      setProcesando(true);
      transcrito = await audios.transcribir();
      if (!transcrito && !texto) {
        setProcesando(false);
        return;
      }
    }
    setProcesando(true);
    try {
      const fd = new FormData();
      if (conAudio && transcrito) fd.append("transcripcion", transcrito);
      if (texto) fd.append("texto", texto);
      fd.append("apartados", JSON.stringify(apartados));
      // Solo los que VINIERON tienen nota: a quien faltó no se le puede
      // escribir nada de una sesión a la que no fue.
      fd.append("asistentes", JSON.stringify(losQueVinieron.map((a) => ({ patientId: a.patientId, nombre: a.nombre }))));
      fd.append("etiquetaNota", etiquetaNota || ETIQUETA_NOTA_POR_DEFECTO);
      fd.append("escrito", JSON.stringify(escritoAhora));
      const r = await fetch("/api/clinica/taller-sesiones/transcribe", { method: "POST", body: fd });
      const j = await leerRespuestaApi(r);
      if (!r.ok) throw new Error(j.error || "No se pudo procesar");
      setMaterialIA(String(j.data.material ?? "").trim());
      setDemoIA(!!j.data.demo);
      const p = j.data.propuesta ?? {};
      const cuantos = Object.values(p).filter((v) => String(v ?? "").trim()).length;
      setPropuesta(p);
      setBloquesIA(Array.isArray(j.data.bloques) ? j.data.bloques : []);
      setVerPropuesta(cuantos > 0);
      const notasDeNinos = Object.keys(j.data.reparto?.notas ?? {}).length;
      setAvisoIA(
        j.data.avisoIA ??
          (cuantos > 0
            ? `La IA propone ${cuantos} bloque(s)${notasDeNinos ? `, con nota para ${notasDeNinos} asistente(s)` : ""}: revísalos y elige cuáles entran.`
            : "La IA no ha sacado nada que repartir.")
      );
    } catch (e) {
      setErr(e.message);
    } finally {
      setProcesando(false);
    }
  }

  /**
   * Lo elegido en el panel entra en el formulario: lo común a sus apartados,
   * la nota de cada niño a SU casilla, lo interno a las notas internas.
   * Guardar sigue siendo cosa de quien escribe.
   */
  function aplicarPropuesta(cambios) {
    let cuantos = 0;
    for (const [clave, valor] of Object.entries(cambios ?? {})) {
      const pid = pacienteDeClave(clave);
      if (pid) {
        if (!asistentes.some((a) => a.patientId === pid)) continue;
        cambiarAsistente(pid, "nota", valor);
      } else if (clave === BLOQUE_INTERNAS.key) {
        setInternas(valor);
      } else if (apartados.some((a) => a.key === clave)) {
        setValores((prev) => ({ ...prev, [clave]: valor }));
      } else {
        continue;
      }
      cuantos += 1;
    }
    setVerPropuesta(false);
    setAvisoIA(cuantos > 0 ? `Se han escrito ${cuantos} bloque(s) con la propuesta de la IA. Revisa y edita antes de guardar.` : "No has aplicado ningún bloque.");
  }

  async function guardar() {
    setErr(null);
    if (!fecha) { setErr("Pon la fecha de la sesión"); return; }
    setGuardando(true);
    try {
      /*
       * La hora se manda como un ISO completo construido en el navegador. Aquí
       * NO hace falta la ceremonia de los bloqueos (fecha + hora por separado,
       * que el servidor interpreta en Madrid): el navegador de quien escribe
       * está en la hora del centro y el ISO que sale de aquí ya lleva su zona,
       * así que no hay ambigüedad que resolver en el servidor.
       */
      const cuando = new Date(`${fecha}T${hora || "00:00"}`);
      if (Number.isNaN(cuando.getTime())) throw new Error("La fecha o la hora no se entienden");

      const cuerpo = {
        sessionDate: cuando.toISOString(),
        duration: duracion === "" ? null : Number(duracion),
        grupoId: grupoId || undefined,
        bookingId: bookingId || undefined,
        teamMemberId: teamMemberId || null,
        contentSections: { ...desdeFormulario(valores, apartados), apartados },
        internalNotes: internas,
        etiquetaNota,
        status: cerrada ? "published" : "registered",
        // De qué texto salió (03/09/2026): lo que leyó la IA, si se usó. Se
        // guarda con la sesión para poder volver a pasarla sin el audio.
        aiTranscription: materialIA || textoAudio || "",
        audioDurationSec: duracionDelAudio ?? null,
        // Solo los que vinieron. A los desmarcados se les quita su registro —
        // salvo que ya se le haya enviado a su familia, que eso lo frena el
        // servidor y lo cuenta en la respuesta.
        asistentes: asistentes.filter((a) => a.asistio).map((a) => ({ patientId: a.patientId, nota: a.nota ?? "" })),
      };

      const r = await fetch(
        sesionId ? `/api/clinica/taller-sesiones/${sesionId}` : `/api/clinica/talleres/${tallerId}/sesiones`,
        {
          method: sesionId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cuerpo),
        }
      );
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se ha podido guardar");
      onSaved?.(j.data);
    } catch (e) {
      setErr(e.message);
      setGuardando(false);
    }
  }

  const vinieron = losQueVinieron.length;
  const hayPropuesta = propuesta && Object.values(propuesta).some((v) => String(v ?? "").trim());

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={() => !guardando && onClose()} />
      {/* top-14 lg:top-0 … bottom-0: la barra móvil (regla 13). */}
      <div className="fixed top-14 lg:top-0 right-0 bottom-0 z-50 w-full max-w-2xl bg-white shadow-pop flex flex-col">
        <div className="px-5 py-4 border-b border-neutral-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="eyebrow">Registro de taller</div>
            <h3 className="font-display text-lg text-neutral-900 mt-0.5 truncate">{tallerName || "Taller"}</h3>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {onVerCita && (
              <button
                type="button"
                onClick={() => !guardando && onVerCita()}
                className="text-[11px] px-2.5 py-1 rounded-md border border-neutral-200 text-neutral-600 hover:bg-neutral-50 transition-colors"
                title="La ficha de la cita: hora, quién lo imparte, pasar lista"
              >
                Ver la cita
              </button>
            )}
            <button
              type="button"
              onClick={() => !guardando && onClose()}
              className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors"
            >
              Cerrar
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {cargando ? (
            <p className="text-xs text-neutral-400">Cargando…</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="text-xs">
                  <span className="block text-neutral-500 mb-1">Día</span>
                  <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputCls} />
                </label>
                <label className="text-xs">
                  <span className="block text-neutral-500 mb-1">Hora</span>
                  <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className={inputCls} />
                </label>
                <label className="text-xs">
                  <span className="block text-neutral-500 mb-1">Duración (min)</span>
                  <input
                    type="number" min="1" value={duracion} placeholder="90"
                    onChange={(e) => setDuracion(e.target.value)} className={inputCls}
                  />
                </label>
              </div>

              {/* ── Quién lo hizo (01/09/2026, Rodrigo) ─────────────────────
                  «Para los registros de sesiones se podrá elegir qué terapeuta
                  los hace dentro del propio registro.» Un taller lo dan varios
                  y lo escribe uno; y a veces lo escribe quien no estaba, porque
                  la que estaba se puso mala. Se elige, y se puede corregir. */}
              <label className="text-xs block">
                <span className="block text-neutral-500 mb-1">Quién lo hizo</span>
                <select value={teamMemberId} onChange={(e) => setTeamMemberId(e.target.value)} className={inputCls}>
                  <option value="">— Sin firmar —</option>
                  {equipo.map((m) => (
                    <option key={m.id} value={m.id}>{m.displayName}</option>
                  ))}
                </select>
              </label>

              {/* ── 0. El audio y el bloc de notas, con IA (03/09/2026) ─── */}
              <section
                {...zonaAudio.props}
                className={`rounded-xl border p-4 transition-colors ${
                  zonaAudio.arrastrando ? "border-[var(--color-primary,#1B3A2D)] bg-emerald-50/40" : "border-neutral-200 bg-neutral-50/60"
                }`}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept={ACEPTA_AUDIO}
                  multiple
                  className="hidden"
                  onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) ponerAudio(fs); }}
                />
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-neutral-800">Audio y bloc de notas, con IA</div>
                    {!audios.lista.length && !transcripcionAudio ? (
                      <p className="text-[11px] text-neutral-500 mt-0.5">
                        {zonaAudio.arrastrando
                          ? "Suéltalos aquí."
                          : `Arrastra aquí los audios del taller, pégalos con Ctrl+V o búscalos — puedes añadir varios (hasta ${MAX_AUDIOS}) y transcribirlos de una vez. O pega abajo lo que tengas apuntado. La IA propone el registro del grupo, la nota de cada niño que vino y las notas internas; tú eliges qué entra. m4a, mp3, wav, ogg, webm · máx. 25 MB cada uno.`}
                      </p>
                    ) : (
                      <p className="text-[11px] text-neutral-600 mt-0.5 truncate">
                        {audios.lista.length
                          ? audios.lista.length === 1 ? "1 audio" : `${audios.lista.length} audios`
                          : "Texto guardado con la sesión"}
                        {duracionDelAudio != null ? ` · ${fmtDur(duracionDelAudio)}` : ""}
                        {audios.hayPendientes ? " · sin transcribir todavía" : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {audios.hueco > 0 && grabadora.soportado && (
                      <button
                        type="button"
                        onClick={grabadora.grabando ? grabadora.parar : grabadora.empezar}
                        disabled={procesando || guardando}
                        className={`text-xs font-medium px-3 py-2 rounded-lg border disabled:opacity-50 ${grabadora.grabando ? "border-rose-300 bg-rose-50 text-rose-700" : "border-neutral-200 bg-white hover:border-neutral-400 text-neutral-700"}`}
                        title={grabadora.grabando ? "Parar y usar la grabación" : "Grabar con el micrófono del dispositivo"}
                      >
                        {grabadora.grabando ? `■ Parar · ${fmtSegundos(grabadora.segundos)}` : "● Grabar"}
                      </button>
                    )}
                    {audios.hueco > 0 && !grabadora.grabando && (
                      <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        disabled={procesando || guardando}
                        className="text-xs font-medium px-3 py-2 rounded-lg border border-neutral-200 bg-white hover:border-neutral-400 text-neutral-700 disabled:opacity-50"
                      >
                        {audios.lista.length ? "Añadir otro" : "Añadir audio"}
                      </button>
                    )}
                    {(audios.lista.length > 0 || transcripcionAudio) && (
                      <button type="button" onClick={quitarAudio} disabled={procesando || guardando} className="text-xs px-3 py-2 text-neutral-500 hover:underline disabled:opacity-50">
                        Quitar
                      </button>
                    )}
                  </div>
                </div>

                {/* La lista de audios, cada uno con su estado y su aspa: quitar
                    el que sobra no se lleva la transcripción de los demás. */}
                {audios.lista.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {audios.lista.map((a, i) => (
                      <li key={a.id} className="flex items-center gap-2 text-[11px] rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5">
                        <span className="w-4 shrink-0 text-neutral-400 tabular-nums">{i + 1}.</span>
                        <span className="flex-1 min-w-0 truncate text-neutral-700">{a.nombre}</span>
                        <span className="shrink-0 text-neutral-400">{fmtSize(a.tamano)}</span>
                        <span
                          className={`shrink-0 font-medium ${a.error ? "text-rose-600" : a.texto ? "text-emerald-700" : audios.transcribiendo ? "text-neutral-500" : "text-amber-700"}`}
                          title={a.error || undefined}
                        >
                          {a.error
                            ? "no ha salido texto"
                            : a.texto
                              ? `transcrito${a.durationSec != null ? ` · ${fmtDur(a.durationSec)}` : ""}`
                              : audios.transcribiendo
                                ? "transcribiendo…"
                                : "pendiente"}
                        </span>
                        <button
                          type="button"
                          onClick={() => audios.quitar(a.id)}
                          disabled={audios.transcribiendo || procesando || guardando}
                          className="shrink-0 text-neutral-400 hover:text-rose-600 disabled:opacity-40"
                          title="Quitar este audio"
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {audios.hayPendientes && (
                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] text-neutral-500">
                      {audios.transcribiendo
                        ? "Transcribiendo… puedes seguir escribiendo mientras."
                        : "Transcríbelos ahora y sigue escribiendo: al pulsar la IA no habrá que esperar al audio."}
                    </p>
                    <button
                      type="button"
                      onClick={transcribirAudios}
                      disabled={audios.transcribiendo || procesando || guardando}
                      className="text-xs font-medium px-3 py-2 rounded-lg border border-neutral-200 bg-white hover:border-neutral-400 text-neutral-700 disabled:opacity-40"
                    >
                      {audios.transcribiendo
                        ? "Transcribiendo…"
                        : audios.pendientes.length > 1
                          ? `Transcribir los ${audios.pendientes.length} audios`
                          : "Transcribir el audio"}
                    </button>
                  </div>
                )}

                <div className="mt-3 border-t border-neutral-100 pt-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1.5">
                    <div className="eyebrow">{audios.lista.length || transcripcionAudio ? "…y tus notas" : "O pega tus notas"}</div>
                    <span className={`text-[10px] ${notas.length > MAX_NOTAS ? "text-rose-600 font-medium" : "text-neutral-400"}`}>
                      {notas.length > 0 && `${notas.length.toLocaleString("es-ES")} / ${MAX_NOTAS.toLocaleString("es-ES")}`}
                    </span>
                  </div>
                  <textarea
                    className={ta}
                    rows={notas ? 5 : 3}
                    placeholder="Pega aquí lo que tengas apuntado del taller: lo del grupo y lo de cada niño, tal cual, nombrándolos."
                    value={notas}
                    onChange={(e) => setNotas(e.target.value)}
                    disabled={procesando || guardando}
                  />
                </div>

                {textoAudio && (
                  <label className="mt-3 flex items-start gap-2 text-[11px] text-neutral-600 cursor-pointer">
                    <input type="checkbox" className="mt-0.5" checked={usarAudio} onChange={(e) => setUsarAudio(e.target.checked)} />
                    <span>
                      Usar también el texto ya transcrito en esta pasada.
                      <span className="text-neutral-400"> Desmárcalo para que la IA lea solo tus notas. No se vuelve a transcribir nada.</span>
                    </span>
                  </label>
                )}

                {(conAudio || notas.trim()) && (
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={procesarConIA}
                      disabled={procesando || guardando || audios.transcribiendo || notas.length > MAX_NOTAS || (!conAudio && !notas.trim())}
                      className="text-xs font-medium px-4 py-2 rounded-lg text-white hover:opacity-90 inline-flex items-center gap-2 disabled:opacity-40"
                      style={{ background: "var(--color-primary, #1B3A2D)" }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
                      {procesando
                        ? queEntra === "audio" ? "Transcribiendo y repartiendo…" : "Repartiendo…"
                        : queEntra === "audio"
                          ? notas.trim() ? "Transcribir y procesar con mis notas" : "Transcribir y procesar con IA"
                          : queEntra === "transcripcion"
                            ? notas.trim() ? "Proponer el registro con la transcripción y mis notas" : "Proponer el registro con la transcripción"
                            : "Rellenar el registro con mis notas"}
                    </button>
                  </div>
                )}
                {vinieron === 0 && (conAudio || notas.trim()) && (
                  <p className="mt-2 text-[11px] text-amber-700">
                    No hay nadie marcado como que vino: la IA solo propondrá el registro del grupo, sin notas individuales.
                  </p>
                )}

                {avisoIA && (
                  <div className="mt-3 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-100 text-[11px] text-emerald-800 flex flex-wrap items-center gap-2">
                    <span className="flex-1 min-w-[12rem]">{avisoIA}{demoIA ? " (datos de demostración)" : ""}</span>
                    {hayPropuesta && (
                      <button type="button" onClick={() => setVerPropuesta(true)} className="shrink-0 font-medium text-emerald-900 underline hover:no-underline">
                        Ver la propuesta de la IA
                      </button>
                    )}
                  </div>
                )}
                {textoAudio && (
                  <details className="mt-3 border-t border-neutral-100 pt-3">
                    <summary className="eyebrow cursor-pointer">Texto del que sale el registro</summary>
                    <p className="mt-1.5 text-xs text-neutral-600 leading-relaxed italic whitespace-pre-line">«{textoAudio}»</p>
                  </details>
                )}
              </section>

              {/* ── 1. El registro del grupo ───────────────────────────── */}
              <section>
                <div className="text-sm font-semibold text-neutral-800">Registro del grupo</div>
                <p className="text-[11px] text-neutral-400 mt-0.5 mb-2">
                  Se escribe una vez y sale <strong>igual</strong> en la ficha de todos los que vinieron.
                </p>
                <ApartadosEditor
                  apartados={apartados}
                  valores={valores}
                  onValor={(k, v) => setValores((prev) => ({ ...prev, [k]: v }))}
                  onApartados={setApartados}
                  plantillas={plantillas}
                  disabled={guardando}
                />
              </section>

              {/* ── 2. Cada paciente ───────────────────────────────────── */}
              <section>
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <div className="text-sm font-semibold text-neutral-800">
                    Quién vino <span className="font-normal text-neutral-400">({vinieron} de {asistentes.length})</span>
                  </div>
                </div>
                <p className="text-[11px] text-neutral-400 mt-0.5 mb-2">
                  Las observaciones de cada uno son para <strong>su familia</strong>: salen solo en la ficha de
                  esa persona y en lo que reciba su familia. Nadie más las ve, ni las otras familias del taller.
                </p>

                <label className="text-xs block mb-3">
                  <span className="block text-neutral-500 mb-1">Cómo se titula ese apartado en su registro</span>
                  <input
                    value={etiquetaNota}
                    onChange={(e) => setEtiquetaNota(e.target.value)}
                    placeholder={ETIQUETA_NOTA_POR_DEFECTO}
                    className={inputCls}
                  />
                </label>

                {asistentes.length === 0 ? (
                  <p className="text-xs text-neutral-400 border border-dashed border-neutral-200 rounded-lg px-4 py-5 text-center">
                    No hay nadie apuntado a este taller todavía. Se apunta gente desde su ficha.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {asistentes.map((a) => (
                      <li key={a.patientId} className="border border-neutral-200 rounded-lg p-3">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!a.asistio}
                            onChange={(e) => cambiarAsistente(a.patientId, "asistio", e.target.checked)}
                            className="accent-[var(--color-primary,#1B3A2D)]"
                          />
                          <span className="text-sm font-medium text-neutral-800">{a.nombre}</span>
                          {a.yaNoApuntado && (
                            <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-100 rounded px-1.5 py-0.5">
                              ya no está apuntado
                            </span>
                          )}
                          {a.enviada && (
                            <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded px-1.5 py-0.5">
                              ya enviado a su familia
                            </span>
                          )}
                        </label>
                        {a.asistio && (
                          <textarea
                            rows={2}
                            value={a.nota ?? ""}
                            onChange={(e) => cambiarAsistente(a.patientId, "nota", e.target.value)}
                            placeholder={`${etiquetaNota || ETIQUETA_NOTA_POR_DEFECTO} de ${a.nombre}…`}
                            className="mt-2 w-full px-3 py-2 text-xs border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400 leading-relaxed"
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {asistentes.some((a) => !a.asistio && a.enviada) && (
                  <p className="text-[11px] text-amber-700 mt-2">
                    A quien ya tenga el registro enviado a su familia no se le borra aunque lo desmarques: ese
                    documento ya está en su área privada.
                  </p>
                )}
              </section>

              {/* ── 3. Notas internas del grupo ────────────────────────── */}
              <section>
                <div className="text-sm font-semibold text-neutral-800">Notas internas del grupo</div>
                <p className="text-[11px] text-neutral-400 mt-0.5 mb-2">
                  Solo para el equipo. <strong>No sale del CRM</strong>: ni en la ficha de los pacientes, ni en
                  informes, ni en lo que recibe la familia.
                </p>
                <textarea
                  rows={3}
                  value={internas}
                  onChange={(e) => setInternas(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400 leading-relaxed"
                />
              </section>

              <label className="flex items-center gap-2 text-xs text-neutral-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cerrada}
                  onChange={(e) => setCerrada(e.target.checked)}
                  className="accent-[var(--color-primary,#1B3A2D)]"
                />
                Cerrar el registro (queda cerrado también en la ficha de cada paciente)
              </label>
            </>
          )}

          {err && <div className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{err}</div>}
        </div>

        <div className="px-5 py-3 border-t border-neutral-100 flex justify-end gap-2">
          <button
            type="button" onClick={() => !guardando && onClose()}
            className="px-3 py-1.5 text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button" onClick={guardar} disabled={guardando || cargando || procesando}
            className="px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-50 transition"
            style={{ background: "var(--color-primary, #1B3A2D)" }}
          >
            {guardando ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>

      {/* La propuesta de la IA, bloque a bloque: lo del grupo, la nota de cada
          niño y las internas. `escritoAhora` es «lo tuyo»; si ya escribiste,
          se enseña al lado y se respeta salvo que digas otra cosa. */}
      {verPropuesta && propuesta && (
        <PropuestaIA
          bloques={bloquesIA}
          escrito={escritoAhora}
          propuesta={propuesta}
          transcription={materialIA}
          titulo="Lo que ha sacado la IA del taller"
          onAplicar={aplicarPropuesta}
          onCerrar={() => setVerPropuesta(false)}
        />
      )}
    </>
  );
}
