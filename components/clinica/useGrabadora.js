"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useGrabadora — grabar audio desde el propio CRM (03/09/2026, AV-0037 de
 * Aumenta: «en dispositivos de Apple no deja directamente enlazar con
 * grabadora cuando pulsas añadir audio, solo dando la opción de archivos»).
 *
 * ── POR QUÉ ────────────────────────────────────────────────────────────────
 * «Añadir audio» abre un `<input type="file" accept="audio/*">`. Android
 * ofrece la grabadora en ese selector; Safari en iPhone y iPad no la ofrece
 * nunca (solo Archivos y Fotos), así que allí había que grabar en Notas de
 * voz, guardar y volver. Con MediaRecorder —que Safari entiende desde 2021—
 * se graba aquí y el audio entra como si se hubiera elegido un archivo:
 * `onAudio(file)` recibe un `File` normal, y el resto del flujo (transcribir,
 * IA, guardar) no cambia.
 *
 * ── QUÉ FORMATO SALE ───────────────────────────────────────────────────────
 * El que el navegador sepa hacer: `audio/mp4` (Safari: .m4a) o `audio/webm`
 * (Chrome, Firefox). Whisper acepta los dos. A 64 kb/s, una hora son ~28 MB:
 * se corta a los 50 minutos para no pasar del tope de 25 MB del transcriptor.
 *
 * Devuelve `{ soportado, grabando, segundos, empezar, parar }`. Un fallo
 * (permiso denegado, sin micrófono) va a `onError(mensaje)` y nunca lanza.
 */
const MAX_SEGUNDOS = 50 * 60;
const BITS_POR_SEGUNDO = 64_000;
const TIPOS = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];

function tipoSoportado() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const t of TIPOS) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      /* navegadores viejos sin isTypeSupported */
    }
  }
  return "";
}

function extensionDe(tipo) {
  if (!tipo) return "webm";
  if (tipo.startsWith("audio/mp4")) return "m4a";
  if (tipo.startsWith("audio/ogg")) return "ogg";
  return "webm";
}

function nombreDeFichero(tipo) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `grabacion-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${extensionDe(tipo)}`;
}

export function fmtSegundos(s) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export default function useGrabadora({ onAudio, onError } = {}) {
  const [grabando, setGrabando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const recRef = useRef(null);
  const streamRef = useRef(null);
  const trozosRef = useRef([]);
  const relojRef = useRef(null);
  // Los callbacks, siempre los últimos: el `onstop` del grabador se ata una
  // vez y tiene que llamar al `ponerAudio` de la última renderización.
  const cbRef = useRef({ onAudio, onError });
  useEffect(() => {
    cbRef.current = { onAudio, onError };
  }, [onAudio, onError]);

  const soportado =
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;

  const limpiar = useCallback(() => {
    if (relojRef.current) clearInterval(relojRef.current);
    relojRef.current = null;
    for (const t of streamRef.current?.getTracks?.() ?? []) t.stop();
    streamRef.current = null;
    recRef.current = null;
    setGrabando(false);
  }, []);

  const parar = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    if (rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        limpiar();
      }
    }
  }, [limpiar]);

  const empezar = useCallback(async () => {
    if (!soportado || recRef.current) return;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const denegado = e?.name === "NotAllowedError" || e?.name === "SecurityError";
      cbRef.current.onError?.(
        denegado
          ? "El navegador no deja usar el micrófono. Permítelo en el candado de la barra de direcciones y vuelve a pulsar Grabar."
          : "No se encuentra ningún micrófono. Conecta uno o elige un archivo de audio."
      );
      return;
    }
    const tipo = tipoSoportado();
    let rec;
    try {
      rec = new MediaRecorder(stream, { ...(tipo ? { mimeType: tipo } : {}), audioBitsPerSecond: BITS_POR_SEGUNDO });
    } catch {
      for (const t of stream.getTracks()) t.stop();
      cbRef.current.onError?.("Este navegador no sabe grabar audio. Elige un archivo de audio.");
      return;
    }
    trozosRef.current = [];
    rec.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) trozosRef.current.push(ev.data);
    };
    rec.onerror = () => {
      limpiar();
      cbRef.current.onError?.("La grabación se ha cortado. Vuelve a intentarlo o elige un archivo.");
    };
    rec.onstop = () => {
      const mime = rec.mimeType || tipo || "audio/webm";
      const blob = new Blob(trozosRef.current, { type: mime });
      trozosRef.current = [];
      limpiar();
      if (blob.size === 0) {
        cbRef.current.onError?.("No se ha grabado nada: la grabación estaba vacía.");
        return;
      }
      const file = new File([blob], nombreDeFichero(mime), { type: mime, lastModified: Date.now() });
      cbRef.current.onAudio?.(file);
    };
    streamRef.current = stream;
    recRef.current = rec;
    setSegundos(0);
    setGrabando(true);
    // Un trozo por segundo: si el navegador se cierra a medias, se pierde un
    // segundo, no la sesión entera.
    rec.start(1000);
    const desde = Date.now();
    relojRef.current = setInterval(() => {
      const s = Math.floor((Date.now() - desde) / 1000);
      setSegundos(s);
      if (s >= MAX_SEGUNDOS) parar();
    }, 500);
  }, [soportado, limpiar, parar]);

  // Si el componente se va con la grabación en marcha, se suelta el micrófono.
  useEffect(() => () => limpiar(), [limpiar]);

  return { soportado, grabando, segundos, empezar, parar };
}
