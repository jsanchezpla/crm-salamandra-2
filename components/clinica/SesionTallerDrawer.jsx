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
import {
  PLANTILLA_BASE,
  aFormulario,
  apartadosConPlantillas,
  desdeFormulario,
} from "@/lib/clinica/plantillas.js";
import { ETIQUETA_NOTA_POR_DEFECTO } from "@/lib/clinica/tallerSesion.js";
import { MAX_NOTAS } from "@/lib/clinica/registroCompleto.js";
import { BLOQUE_INTERNAS, escritoDelTaller, pacienteDeClave } from "@/lib/clinica/tallerCompleto.js";

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
  const [file, setFile] = useState(null);
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

  const cargar = useCallback(async () => {
    setCargando(true);
    setErr(null);
    try {
      // Las plantillas del centro: son las que deciden con qué apartados se
      // escribe, igual que en un registro de sesión normal.
      const rp = await fetch("/api/clinica/plantillas", { cache: "no-store" });
      const jp = await rp.json();
      const lista = jp?.ok && Array.isArray(jp.data?.registro) && jp.data.registro.length
        ? jp.data.registro
        : [PLANTILLA_BASE.registro];
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
        const aps = apartadosConPlantillas({}, lista);
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

  /** Un audio nuevo deja vieja la transcripción del anterior. */
  function ponerAudio(f) {
    setFile(f);
    setTranscripcionAudio("");
    setDuracionAudio(null);
    setUsarAudio(true);
    setErr(null);
  }

  // Grabar desde el propio CRM (03/09/2026, AV-0037): en iPhone el selector
  // de archivo no ofrece la grabadora. Lo grabado entra por `ponerAudio`.
  const grabadora = useGrabadora({ onAudio: ponerAudio, onError: setErr });

  // Quitar el audio NO borra las notas escritas: son dos fuentes distintas.
  function quitarAudio() {
    setFile(null);
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
    queSeEspera: "un audio del taller",
    apagada: procesando || guardando || !!transcripcionAudio,
    pegar: true,
    onFicheros: ([f]) => ponerAudio(f),
    onAviso: setErr,
  });

  // Qué entra del audio en esta pasada: el fichero (hay que transcribirlo), la
  // transcripción que ya hay (si se deja marcada), o nada.
  const queEntra = file && !transcripcionAudio ? "audio" : transcripcionAudio && usarAudio ? "transcripcion" : "nada";
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
    setProcesando(true);
    setErr(null);
    setAvisoIA(null);
    try {
      const fd = new FormData();
      if (queEntra === "audio") fd.append("file", file, file.name);
      else if (queEntra === "transcripcion") fd.append("transcripcion", transcripcionAudio);
      if (texto) fd.append("texto", texto);
      fd.append("apartados", JSON.stringify(apartados));
      // Solo los que VINIERON tienen nota: a quien faltó no se le puede
      // escribir nada de una sesión a la que no fue.
      fd.append("asistentes", JSON.stringify(losQueVinieron.map((a) => ({ patientId: a.patientId, nombre: a.nombre }))));
      fd.append("etiquetaNota", etiquetaNota || ETIQUETA_NOTA_POR_DEFECTO);
      fd.append("escrito", JSON.stringify(escritoAhora));
      const r = await fetch("/api/clinica/taller-sesiones/transcribe", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo procesar");
      if (queEntra === "audio") {
        setTranscripcionAudio(String(j.data.transcription ?? "").trim());
        setDuracionAudio(j.data.audioDurationSec ?? null);
      }
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
        aiTranscription: materialIA || transcripcionAudio || "",
        audioDurationSec: duracionAudio ?? null,
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
          <button
            type="button"
            onClick={() => !guardando && onClose()}
            className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors shrink-0"
          >
            Cerrar
          </button>
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
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) ponerAudio(f); }}
                />
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-neutral-800">Audio y bloc de notas, con IA</div>
                    {!file && !transcripcionAudio ? (
                      <p className="text-[11px] text-neutral-500 mt-0.5">
                        {zonaAudio.arrastrando
                          ? "Suéltalo aquí."
                          : "Arrastra el audio del taller aquí, pégalo con Ctrl+V o búscalo — o pega abajo lo que tengas apuntado. La IA propone el registro del grupo, la nota de cada niño que vino y las notas internas; tú eliges qué entra. m4a, mp3, wav, ogg, webm · máx. 25 MB."}
                      </p>
                    ) : (
                      <p className="text-[11px] text-neutral-600 mt-0.5 truncate">
                        {file ? `${file.name} · ${fmtSize(file.size)}` : "Texto guardado con la sesión"}
                        {duracionAudio != null ? ` · ${fmtDur(duracionAudio)}` : ""}
                        {transcripcionAudio ? " · ya transcrito" : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {!file && !transcripcionAudio && grabadora.soportado && (
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
                    {!file && !transcripcionAudio && !grabadora.grabando && (
                      <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        disabled={procesando || guardando}
                        className="text-xs font-medium px-3 py-2 rounded-lg border border-neutral-200 bg-white hover:border-neutral-400 text-neutral-700 disabled:opacity-50"
                      >
                        Añadir audio
                      </button>
                    )}
                    {(file || transcripcionAudio) && (
                      <button type="button" onClick={quitarAudio} disabled={procesando || guardando} className="text-xs px-3 py-2 text-neutral-500 hover:underline disabled:opacity-50">
                        Quitar
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-3 border-t border-neutral-100 pt-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1.5">
                    <div className="eyebrow">{file || transcripcionAudio ? "…y tus notas" : "O pega tus notas"}</div>
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

                {transcripcionAudio && (
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
                      disabled={procesando || guardando || notas.length > MAX_NOTAS || (!conAudio && !notas.trim())}
                      className="text-xs font-medium px-4 py-2 rounded-lg text-white hover:opacity-90 inline-flex items-center gap-2 disabled:opacity-40"
                      style={{ background: "var(--color-primary, #1B3A2D)" }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
                      {procesando
                        ? queEntra === "audio" ? "Transcribiendo y repartiendo…" : "Repartiendo…"
                        : queEntra === "audio"
                          ? notas.trim() ? "Procesar audio y notas con IA" : "Procesar el audio con IA"
                          : queEntra === "transcripcion"
                            ? notas.trim() ? "Proponer otra vez con la transcripción y mis notas" : "Proponer otra vez con la transcripción"
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
                {transcripcionAudio && (
                  <details className="mt-3 border-t border-neutral-100 pt-3">
                    <summary className="eyebrow cursor-pointer">Texto del que sale el registro</summary>
                    <p className="mt-1.5 text-xs text-neutral-600 leading-relaxed italic whitespace-pre-line">«{transcripcionAudio}»</p>
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
                  Lo que escribas aquí <strong>solo sale en la ficha de esa persona</strong>. Nadie más lo ve, ni
                  las otras familias del taller.
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
