"use client";

/**
 * EnviarRegistroModal — repasar lo que se le manda a la familia antes de
 * mandarlo (04/09/2026, Rodrigo: «texto email automático resumiendo el registro
 * de sesión para la familia, editable»).
 *
 * Hasta hoy «Enviar al paciente» publicaba el PDF en el área privada y no
 * avisaba a nadie: la familia se enteraba si entraba a mirar. Ahora sale además
 * un correo con un resumen — y el resumen se PROPONE, no se manda: se ve aquí
 * escrito y se cambia entero si hace falta. Esa es la salvaguarda, porque un
 * correo no se puede retirar.
 *
 * El resumen lo compone el servidor (`lib/clinica/correoRegistro.js`) desde la
 * Devolución a la familia, con lista blanca de apartados: las notas internas,
 * la preparación y la transcripción no pueden salir por aquí ni queriendo.
 *
 * El PDF **no se adjunta** a propósito: es un documento clínico de un menor y
 * se recoge en el área privada, que pide identificarse.
 */

import { useCallback, useEffect, useState } from "react";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition";

export default function EnviarRegistroModal({ sessionId, reenvio = false, onCerrar, onEnviado }) {
  const [datos, setDatos] = useState(null);
  const [asunto, setAsunto] = useState("");
  const [texto, setTexto] = useState("");
  const [avisar, setAvisar] = useState(true);
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await fetch(`/api/clinica/sessions/${sessionId}/enviar`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo preparar el envío");
      setDatos(j.data);
      setAsunto(j.data.propuesta?.asunto ?? "");
      setTexto(j.data.propuesta?.texto ?? "");
      // Sin correo en la ficha ni en los tutores no se puede avisar: se
      // desmarca y se dice.
      setAvisar(!j.data.motivoParaNoAvisar);
    } catch (e) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, [sessionId]);

  useEffect(() => { cargar(); }, [cargar]);

  async function enviar() {
    setEnviando(true);
    setError(null);
    try {
      const r = await fetch(`/api/clinica/sessions/${sessionId}/enviar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ correo: { enviar: avisar, asunto, texto } }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo enviar el registro");
      onEnviado?.(j.data);
    } catch (e) {
      setError(e.message);
    } finally {
      setEnviando(false);
    }
  }

  const bloqueado = Boolean(datos?.motivoParaNoEnviar);

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={() => !enviando && onCerrar?.()} />
      <aside className="fixed top-14 lg:top-0 right-0 bottom-0 w-full sm:w-[520px] bg-white z-50 shadow-pop overflow-y-auto ink-scroll slide-right">
        <div className="px-6 pt-6 pb-4 border-b border-neutral-100">
          <div className="eyebrow">Clínica · Registro</div>
          <h2 className="font-display text-xl text-neutral-900 mt-1">
            {reenvio ? "Volver a enviar a la familia" : "Enviar a la familia"}
          </h2>
          <p className="text-[11px] text-neutral-400 mt-1">
            El registro se publica en su área privada.
            {reenvio ? " Se sube un PDF nuevo y se retira el anterior." : ""}
          </p>
        </div>

        {cargando ? (
          <p className="px-6 py-10 text-center text-sm text-neutral-400">Preparando…</p>
        ) : (
          <div className="px-6 py-5 space-y-4">
            {datos?.motivoParaNoEnviar && (
              <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                {datos.motivoParaNoEnviar}
              </div>
            )}

            {datos?.destinatario && (
              <div className="text-[12px] text-neutral-600">
                <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest block">Para</span>
                {datos.destinatario.nombre}
                {datos.destinatario.correos?.length ? (
                  <span className="text-neutral-400">
                    {" · "}
                    {datos.destinatario.correos.join(", ")}
                    {datos.destinatario.deTutores ? " (de sus tutores: la ficha no tiene correo)" : ""}
                  </span>
                ) : datos.destinatario.email ? (
                  <span className="text-neutral-400"> · {datos.destinatario.email}</span>
                ) : null}
              </div>
            )}

            <label className="flex items-start gap-2 text-[12.5px] text-neutral-700 cursor-pointer">
              <input
                type="checkbox"
                checked={avisar}
                disabled={Boolean(datos?.motivoParaNoAvisar)}
                onChange={(e) => setAvisar(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Avisar por correo con este resumen
                {datos?.motivoParaNoAvisar && (
                  <span className="block text-[11px] text-amber-700 mt-0.5">{datos.motivoParaNoAvisar}</span>
                )}
              </span>
            </label>

            {avisar && (
              <>
                <label className="block">
                  <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Asunto</span>
                  <input value={asunto} onChange={(e) => setAsunto(e.target.value)} className={inputCls} />
                </label>
                <label className="block">
                  <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Texto del correo</span>
                  <textarea
                    rows={12}
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    className={`${inputCls} resize-y font-sans`}
                  />
                </label>
                <p className="text-[11px] text-neutral-400">
                  {datos?.propuesta?.fuente === "devolucion"
                    ? "Sale de la «Devolución a la familia» del registro. Cámbialo si quieres antes de enviarlo."
                    : datos?.propuesta?.fuente === "registro"
                      ? "Sale de las actividades y el desempeño del registro, porque la «Devolución a la familia» está vacía. Cámbialo antes de enviarlo."
                      : "El registro no tiene nada escrito para la familia, así que el correo solo avisa. Escribe aquí lo que quieras contarles."}
                  {" "}El PDF no se adjunta: se recoge en el área privada.
                </p>
              </>
            )}

            {error && <div className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{error}</div>}

            <div className="flex gap-2 justify-end pt-3 border-t border-neutral-100">
              <button type="button" onClick={() => onCerrar?.()} disabled={enviando}
                className="px-4 py-2 text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 disabled:opacity-50">
                Cancelar
              </button>
              <button type="button" onClick={enviar} disabled={enviando || bloqueado}
                className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-50"
                style={{ background: "var(--color-primary, #1B3A2D)" }}>
                {enviando ? "Enviando…" : avisar ? "Publicar y avisar" : "Publicar sin avisar"}
              </button>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
