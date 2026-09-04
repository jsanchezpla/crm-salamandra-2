"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import {
  MAX_AUDIOS,
  MAX_AUDIO_BYTES,
  duracionTotal,
  juntarTranscripciones,
  repartirEnTandas,
} from "@/lib/clinica/audios.js";
import { leerRespuestaApi } from "@/lib/utils/respuestaApi.js";

/**
 * useAudios — LOS audios de un registro (04/09/2026, Rodrigo: «queremos subir
 * más de un audio a la transcripción por audio antes de ponerlo a transcribir»
 * y «la transcripción por IA va un poco lenta»).
 *
 * ── QUÉ HABÍA ANTES ────────────────────────────────────────────────────────
 * Un audio y solo uno, en un `useState` de la pantalla. El segundo sustituía al
 * primero —y con él su transcripción, ya pagada—, así que una sesión dictada en
 * tres notas de voz había que procesarla tres veces y pegar el texto a mano.
 * Además, transcribir iba pegado al botón de la IA: se pulsaba, y se esperaba a
 * Whisper Y a Claude sin poder tocar nada.
 *
 * ── QUÉ HACE ESTE GANCHO ───────────────────────────────────────────────────
 * Guarda la LISTA, con el estado de cada audio, y sabe transcribirlos:
 *
 *  · «Transcribir» manda los pendientes a `/api/clinica/audio/transcribir` y NO
 *    bloquea la pantalla: mientras Whisper trabaja se puede seguir escribiendo
 *    el registro, añadir otro audio o pegar notas. Cuando luego se pulse la IA,
 *    la transcripción ya está hecha y solo se espera el reparto.
 *  · Dentro de cada tanda los audios se transcriben EN PARALELO (lo hace el
 *    servidor): cuatro notas de voz cuestan lo que la más larga.
 *  · Un audio ya transcrito NO se vuelve a mandar aunque se pulse otra vez: se
 *    paga una sola vez, que es la regla desde el 01/09/2026.
 *
 * Lo comparten el registro de sesión y el cajón de la sesión de taller: las dos
 * pantallas tenían el mismo estado copiado.
 */
export default function useAudios({ onError, onAviso } = {}) {
  const [lista, setLista] = useState([]);
  const [transcribiendo, setTranscribiendo] = useState(false);
  // Contador propio: dos ficheros pueden llamarse igual (WhatsApp los nombra
  // por fecha) y el nombre no sirve de identidad.
  const contador = useRef(0);

  /**
   * Añade audios al final. El orden ES el del registro: los textos se juntan en
   * el mismo en el que se subieron, que es como se dictó la sesión.
   */
  const añadir = useCallback(
    (ficheros) => {
      const entran = Array.from(ficheros ?? []).filter(Boolean);
      if (!entran.length) return;
      setLista((prev) => {
        const hueco = MAX_AUDIOS - prev.length;
        if (hueco <= 0) {
          onError?.(`No caben más de ${MAX_AUDIOS} audios en un registro. Quita alguno para añadir otro.`);
          return prev;
        }
        const gordo = entran.find((f) => typeof f.size === "number" && f.size > MAX_AUDIO_BYTES);
        if (gordo) onError?.(`«${gordo.name}» pasa de 25 MB y no se puede transcribir. Pártelo o súbelo más ligero.`);
        const buenos = entran.filter((f) => !(typeof f.size === "number" && f.size > MAX_AUDIO_BYTES));
        if (buenos.length > hueco) onError?.(`Solo caben ${hueco} audio(s) más: los demás no se han añadido.`);
        return [
          ...prev,
          ...buenos.slice(0, hueco).map((file) => ({
            id: `a${++contador.current}`,
            file,
            nombre: file.name || `audio ${contador.current}`,
            tamano: file.size ?? 0,
            texto: "",
            durationSec: null,
            error: null,
          })),
        ];
      });
    },
    [onError]
  );

  /** Quitar uno se lleva SU transcripción, no la de los demás. */
  const quitar = useCallback((id) => setLista((prev) => prev.filter((a) => a.id !== id)), []);

  const limpiar = useCallback(() => setLista([]), []);

  const pendientes = useMemo(() => lista.filter((a) => !a.texto && !a.error), [lista]);
  const conTexto = useMemo(() => lista.filter((a) => a.texto), [lista]);
  const texto = useMemo(() => juntarTranscripciones(conTexto.map((a) => a.texto)), [conTexto]);
  const duracion = useMemo(() => duracionTotal(conTexto.map((a) => a.durationSec)), [conTexto]);

  /**
   * Transcribe los que aún no lo están. En tandas, porque el nginx del CRM
   * corta los cuerpos a 30 MB y cinco audios no caben en una sola petición.
   *
   * Devuelve el texto de TODOS los audios transcritos —los de antes y los de
   * ahora—, para que quien la llame pueda encadenar con la IA sin esperar a que
   * React repinte.
   */
  const transcribir = useCallback(async () => {
    if (!pendientes.length || transcribiendo) return texto;
    setTranscribiendo(true);
    // Lo que se va sabiendo, por id: al acabar se vuelca sobre la lista de ESE
    // momento, que puede tener audios nuevos añadidos mientras tanto —
    // transcribir no bloquea la pantalla, en eso está la gracia.
    const sabido = new Map();
    const volcar = () => setLista((prev) => prev.map((a) => (sabido.has(a.id) ? { ...a, ...sabido.get(a.id) } : a)));
    const juntoLoSabido = () => juntarTranscripciones(lista.map((a) => sabido.get(a.id)?.texto ?? a.texto));

    try {
      for (const tanda of repartirEnTandas(pendientes.map((a) => a.file))) {
        const fd = new FormData();
        for (const f of tanda) fd.append("file", f, f.name);
        const r = await fetch("/api/clinica/audio/transcribir", { method: "POST", body: fd });
        const j = await leerRespuestaApi(r, {
          siGrande: "Los audios pesan demasiado para subirlos de una vez. Transcribe primero unos cuantos y luego el resto.",
        });
        if (!r.ok || j.ok === false) throw new Error(j.error || "No se han podido transcribir los audios");
        const vueltos = Array.isArray(j.data?.audios) ? j.data.audios : [];
        // Vuelven en el mismo orden en que se mandaron: eso es lo que casa cada
        // texto con su audio. Por el nombre no se puede — dos pueden repetirlo.
        tanda.forEach((f, i) => {
          const cual = pendientes.find((a) => a.file === f);
          const v = vueltos[i];
          if (!cual || !v) return;
          const suTexto = String(v.texto ?? "").trim();
          sabido.set(cual.id, {
            texto: suTexto,
            durationSec: v.durationSec ?? null,
            error: v.error ?? (suTexto ? null : "De este audio no ha salido texto (¿tiene voz?)"),
          });
        });
      }
    } catch (e) {
      // Lo que sí se transcribió antes de romperse se queda: no se tira una
      // tanda buena porque la siguiente fallara.
      volcar();
      setTranscribiendo(false);
      onError?.(e.message);
      return juntoLoSabido();
    }

    volcar();
    setTranscribiendo(false);
    const fallados = [...sabido.values()].filter((v) => v.error).length;
    if (fallados) onAviso?.(`${fallados} audio(s) no han dado texto. Los demás sí: puedes seguir.`);
    return juntoLoSabido();
  }, [lista, pendientes, texto, transcribiendo, onError, onAviso]);

  return {
    lista,
    añadir,
    quitar,
    limpiar,
    transcribir,
    transcribiendo,
    /** Audios subidos que todavía no han pasado por Whisper. */
    pendientes: useMemo(() => pendientes.map((a) => a.file), [pendientes]),
    hayPendientes: pendientes.length > 0,
    /** ¿Hay texto que mandarle a la IA sin volver a subir nada? */
    hayTexto: conTexto.length > 0,
    texto,
    duracion,
    hueco: MAX_AUDIOS - lista.length,
  };
}
