"use client";

/**
 * MaterialIA — la tarjeta del MATERIAL: los audios, lo que se pega del bloc de
 * notas y el botón que se lo manda a la IA (04/09/2026).
 *
 * (Componente propio y no dentro de cada pantalla, regla #2 de /lib llevada a
 * /components: lo comparten el REGISTRO DE SESIÓN —donde nació el 26/08— y el
 * INFORME CLÍNICO, que estrena su pantalla de redacción hoy. Escribir el
 * informe «como el registro, con su IA, sus notas y sus campos» (Rodrigo) con
 * una copia de estas 200 líneas de JSX significaría que la próxima mejora del
 * dictado —otro formato de audio, otro aviso, otro tope— se quedaría en una de
 * las dos pantallas y nadie se enteraría hasta que un cliente lo contara.)
 *
 * ── QUÉ ES Y QUÉ NO ES ─────────────────────────────────────────────────────
 * Es MARCADO, no lógica. El estado —la lista de audios (`useAudios`), la
 * grabadora, la zona de soltar, las notas, si el audio entra en esta pasada—
 * vive en la pantalla que la usa, y aquí llega por props ya resuelto. Así el
 * registro sigue haciendo exactamente lo que hacía: mismos manejadores, mismo
 * `queEntra`, mismos avisos.
 *
 * Lo único que se parametriza es lo que de verdad cambia entre un documento y
 * otro: cómo se llama («el registro», «el informe»), qué se le explica al que
 * llega y qué ayuda se enseña al lado del título.
 */

import HelpTooltip from "@/components/ui/HelpTooltip.jsx";
import { fmtSegundos } from "@/components/clinica/useGrabadora.js";
import { MAX_NOTAS } from "@/lib/clinica/registroCompleto.js";

const TA = "w-full px-3 py-2 text-xs border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400 leading-relaxed";

/** Lo que admite el campo de audio. Lo leen el `accept` y la zona de soltar. */
export const ACEPTA_AUDIO = "audio/*,.m4a,.mp3,.wav,.ogg,.webm,.mp4";

const fmtSize = (b) => (b == null ? "" : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`);
const fmtDur = (s) => (s == null ? "" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);

export default function MaterialIA({
  // El gancho `useAudios` de la pantalla, tal cual.
  audios,
  grabadora,
  // La zona de soltar (`useZonaSoltar`) y el input de fichero, que los crea la
  // pantalla porque también decide cuándo están apagados.
  zonaAudio,
  fileRef,
  onAudios,
  onQuitarAudio,
  onQuitarTodos,
  onTranscribir,
  notas,
  onNotas,
  usarAudio,
  onUsarAudio,
  // "audio" (hay que transcribirlo), "transcripcion" (ya está) o "notas".
  queEntra,
  conAudio,
  onProcesar,
  procesando = false,
  aviso = null,
  // Lo que se cuela dentro del aviso verde: en el registro, el enlace para
  // volver a abrir la propuesta.
  avisoExtra = null,
  // Cómo se llama el documento en los botones: «el registro», «el informe».
  sustantivo = "el registro",
  titulo,
  descripcion,
  ayuda = null,
  ayudaTitulo = "Qué se guarda y qué no",
}) {
  const hayNotas = notas.trim().length > 0;
  return (
    <div
      {...zonaAudio.props}
      className={`bg-white rounded-xl p-4 lg:p-5 border transition-colors ${
        zonaAudio.arrastrando
          ? "border-2 border-dashed border-[var(--color-primary,#1B3A2D)] bg-neutral-50"
          : "border-neutral-100"
      }`}
    >
      <input
        ref={fileRef}
        type="file"
        accept={ACEPTA_AUDIO}
        multiple
        className="hidden"
        onChange={(e) => {
          const fs = Array.from(e.target.files ?? []);
          if (fs.length) onAudios(fs);
        }}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-white" style={{ background: "var(--color-primary, #1B3A2D)" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" /></svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-[var(--ink-900)]">
            {titulo} <span className="font-normal text-neutral-400">(opcional)</span>
            {ayuda && (
              <HelpTooltip title={ayudaTitulo} className="ml-1.5 tracking-normal normal-case">
                {ayuda}
              </HelpTooltip>
            )}
          </div>
          {!audios.lista.length ? (
            <p className="text-[11px] text-neutral-500 mt-0.5">
              {zonaAudio.arrastrando ? "Suéltalos aquí." : descripcion}
            </p>
          ) : (
            <p className="text-[11px] text-neutral-600 mt-0.5">
              {audios.lista.length === 1 ? "1 audio" : `${audios.lista.length} audios`}
              {audios.duracion != null ? ` · ${fmtDur(audios.duracion)} transcritos` : ""}
              {audios.hayPendientes ? " · sin transcribir todavía" : ""}
            </p>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          {audios.hueco > 0 && grabadora.soportado && (
            <button
              type="button"
              onClick={grabadora.grabando ? grabadora.parar : grabadora.empezar}
              className={`text-xs font-medium px-3 py-2 rounded-lg border ${grabadora.grabando ? "border-rose-300 bg-rose-50 text-rose-700" : "border-neutral-200 bg-white hover:border-neutral-400 text-neutral-700"}`}
              title={grabadora.grabando ? "Parar y usar la grabación" : "Grabar con el micrófono del dispositivo"}
            >
              {grabadora.grabando ? `■ Parar · ${fmtSegundos(grabadora.segundos)}` : "● Grabar"}
            </button>
          )}
          {audios.hueco > 0 && !grabadora.grabando && (
            <button type="button" onClick={() => fileRef.current?.click()} className="text-xs font-medium px-3 py-2 rounded-lg border border-neutral-200 bg-white hover:border-neutral-400 text-neutral-700">
              {audios.lista.length ? "Añadir otro" : "Añadir audio"}
            </button>
          )}
          {audios.lista.length > 1 && (
            <button type="button" onClick={onQuitarTodos} className="text-xs px-3 py-2 text-neutral-500 hover:underline">
              Quitar todos
            </button>
          )}
        </div>
      </div>

      {/* ── La lista de audios (04/09/2026, Rodrigo) ──────────────────
          Se ven todos con su estado, y cada uno se quita por su cuenta:
          el que sobra no se lleva por delante la transcripción de los
          demás, que es lo que pasaba cuando el audio era uno solo. */}
      {audios.lista.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {audios.lista.map((a, i) => (
            <li key={a.id} className="flex items-center gap-2 text-[11px] rounded-lg border border-neutral-100 bg-neutral-50 px-2.5 py-1.5">
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
                onClick={() => onQuitarAudio(a.id)}
                disabled={audios.transcribiendo}
                className="shrink-0 text-neutral-400 hover:text-rose-600 disabled:opacity-40"
                title="Quitar este audio"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Transcribir SIN llamar a la IA: es lo que quita la espera de
          Whisper de delante del botón. No bloquea nada — mientras
          transcribe se puede seguir escribiendo aquí abajo. */}
      {audios.hayPendientes && (
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-neutral-500">
            {audios.transcribiendo
              ? "Transcribiendo… puedes seguir escribiendo mientras."
              : "Transcríbelos ahora y sigue escribiendo: cuando pulses la IA no habrá que esperar al audio."}
          </p>
          <button
            type="button"
            onClick={onTranscribir}
            disabled={audios.transcribiendo || procesando}
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

      {/* ── Las notas escritas (01/09/2026, Rodrigo) ──────────────────
          «Por si apuntan todo en un bloc de notas y lo pasan ahí.» No
          todo el mundo graba, y para la IA el audio y esto son lo mismo:
          texto del que sacar el documento. Por eso comparten tarjeta y
          comparten botón — y si se dan las dos cosas, se usan las dos. */}
      <div className="mt-3 border-t border-neutral-100 pt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1.5">
          <div className="eyebrow">{audios.lista.length ? "…y tus notas" : "O pega tus notas"}</div>
          <span className={`text-[10px] ${notas.length > MAX_NOTAS ? "text-rose-600 font-medium" : "text-neutral-400"}`}>
            {notas.length > 0 && `${notas.length.toLocaleString("es-ES")} / ${MAX_NOTAS.toLocaleString("es-ES")}`}
          </span>
        </div>
        <textarea
          className={TA}
          rows={notas ? 5 : 3}
          placeholder="Pega aquí lo que tengas apuntado: el bloc de notas, el móvil, lo escrito a mano pasado a limpio… Tal cual, sin ordenarlo."
          value={notas}
          onChange={(e) => onNotas(e.target.value)}
        />
      </div>

      {/* ── Dejar el audio fuera de una pasada (01/09/2026, Rodrigo) ──
          Solo aparece cuando ya hay transcripción, que es cuando tiene
          sentido: hasta entonces quitar los audios no cuesta nada. A
          partir de ahí, quitarlos tiraba lo transcrito, así que quien
          quería usar la IA solo con lo que acababa de escribir no tenía
          puerta. Esta es la puerta. */}
      {audios.hayTexto && (
        <label className="mt-3 flex items-start gap-2 text-[11px] text-neutral-600 cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={usarAudio} onChange={(e) => onUsarAudio(e.target.checked)} />
          <span>
            Usar también {audios.lista.length > 1 ? "los audios" : "el audio"} en esta pasada.
            <span className="text-neutral-400">
              {" "}
              Desmárcalo para que la IA lea solo tus notas. La transcripción no se pierde ni se vuelve a pagar.
            </span>
          </span>
        </label>
      )}

      {(audios.lista.length > 0 || hayNotas) && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={onProcesar}
            // Sin audio en la pasada y sin notas no hay nada que leer. Y
            // mientras Whisper trabaja no se lanza la IA: leería medio
            // documento — el audio que está en vuelo aún no tiene texto.
            disabled={notas.length > MAX_NOTAS || (!conAudio && !hayNotas) || audios.transcribiendo || procesando}
            className="text-xs font-medium px-4 py-2 rounded-lg text-white hover:opacity-90 inline-flex items-center gap-2 disabled:opacity-40"
            style={{ background: "var(--color-primary, #1B3A2D)" }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
            {/* El rótulo dice lo que va a pasar de verdad. El de antes
                —«Volver a procesar con IA» en cuanto había un `result`—
                hacía creer que se volvía a transcribir el audio, que es
                exactamente lo que la pantalla hacía y ya no hace. */}
            {queEntra === "audio"
              ? hayNotas
                ? `Transcribir y procesar ${audios.pendientes.length > 1 ? "los audios" : "el audio"} y mis notas`
                : `Transcribir y procesar ${audios.pendientes.length > 1 ? "los audios" : "el audio"} con IA`
              : queEntra === "transcripcion"
                ? hayNotas
                  ? `Proponer ${sustantivo} con la transcripción y mis notas`
                  : `Proponer ${sustantivo} con la transcripción`
                : `Rellenar ${sustantivo} con mis notas`}
          </button>
        </div>
      )}

      {aviso && (
        <div className="mt-3 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-100 text-[11px] text-emerald-800 flex flex-wrap items-center gap-2">
          <span className="flex-1 min-w-[12rem]">{aviso}</span>
          {avisoExtra}
        </div>
      )}

      {/* La del AUDIO, no la de la última pasada: si la última fue solo de
          notas, la transcripción sigue estando y se sigue enseñando. */}
      {audios.hayTexto && (
        <div className="mt-3 border-t border-neutral-100 pt-3">
          <div className="eyebrow mb-1.5">Transcripción literal</div>
          <p className="text-xs text-neutral-600 leading-relaxed italic whitespace-pre-line">«{audios.texto}»</p>
        </div>
      )}
    </div>
  );
}
