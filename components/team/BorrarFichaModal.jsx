"use client";

/**
 * BorrarFichaModal — el aviso antes de borrar de verdad la ficha de alguien.
 * (26/08/2026.)
 *
 * No es un «¿seguro?». Al abrirse PREGUNTA AL SERVIDOR qué queda de esa
 * persona en todo el schema del cliente, y según la respuesta enseña una cosa
 * u otra:
 *
 *   · No queda nada  → el botón rojo, con el aviso de que no tiene vuelta.
 *   · Queda algo     → NO hay botón. Se enseña qué hay y cuántos, y se explica
 *                      que la ficha se queda inactiva, que no es un castigo:
 *                      es lo correcto cuando su nombre firma una sesión o una
 *                      factura.
 *
 * Quien decide es SIEMPRE el servidor (`/api/team/[id]/borrar`), que vuelve a
 * medir al pulsar. Esto es solo la cara.
 */

import { useEffect, useState } from "react";

export default function BorrarFichaModal({ member, onCerrar, onBorrada }) {
  const [cargando, setCargando] = useState(true);
  const [info, setInfo] = useState(null);
  const [fallo, setFallo] = useState(null);
  const [borrando, setBorrando] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setCargando(true);
      setFallo(null);
      try {
        const res = await fetch(`/api/team/${member.id}/borrar`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "No se pudo comprobar la ficha");
        if (vivo) setInfo(json.data);
      } catch (e) {
        if (vivo) setFallo(e.message);
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [member.id]);

  async function borrar() {
    setBorrando(true);
    setFallo(null);
    try {
      const res = await fetch(`/api/team/${member.id}/borrar`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "No se pudo borrar");
      onBorrada(member.displayName);
    } catch (e) {
      setFallo(e.message);
      setBorrando(false);
    }
  }

  return (
    <>
      {/* Encima del drawer de la ficha (z-50), que es desde donde se abre. */}
      <div className="fixed inset-0 bg-black/50 z-[60]" onClick={borrando ? undefined : onCerrar} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="borrar-ficha-titulo"
        className="fixed top-14 lg:top-1/2 left-1/2 -translate-x-1/2 lg:-translate-y-1/2 w-[calc(100%-2rem)] sm:w-[440px] max-h-[80vh] overflow-y-auto ink-scroll bg-white rounded-2xl shadow-pop z-[70] p-6"
      >
        <div className="eyebrow">Borrar ficha</div>
        <h3 id="borrar-ficha-titulo" className="font-display text-xl text-neutral-900 mt-1">
          {member.displayName}
        </h3>

        {cargando && <p className="text-sm text-neutral-400 mt-4">Comprobando qué queda de esta persona…</p>}

        {!cargando && fallo && !info && (
          <p className="text-sm text-red-600 mt-4">{fallo}</p>
        )}

        {!cargando && info && (
          <div className="mt-4 space-y-4">
            {info.puede ? (
              <>
                <p className="text-sm text-neutral-700">
                  No queda ningún registro suyo en el CRM. Se puede borrar la ficha.
                </p>
                <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  Esto no se puede deshacer.
                </p>
                <p className="text-[11px] text-neutral-400">
                  Comprobadas {info.columnasMiradas} columnas de este cliente.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-neutral-700">
                  Esta ficha no se puede borrar todavía:
                </p>
                <ul className="space-y-1.5">
                  {info.impedimentos.map((i) => (
                    <li key={i.codigo} className="text-sm text-neutral-700 flex gap-2">
                      <span className="text-neutral-300 mt-px">·</span>
                      <span>{i.texto}</span>
                    </li>
                  ))}
                </ul>

                {info.filas.length > 0 && (
                  <div className="rounded-lg border border-neutral-200 bg-neutral-50/60 px-3 py-2.5">
                    <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-1.5">
                      Lo que sigue a su nombre
                    </div>
                    <ul className="space-y-1">
                      {info.filas.map((f) => (
                        <li key={f.tabla} className="text-sm text-neutral-700">
                          {f.texto}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <p className="text-xs text-neutral-500">
                  La ficha se queda inactiva: no sale en la plantilla ni puede entrar al CRM, y
                  lo que firmó sigue teniendo autor.
                </p>
              </>
            )}

            {fallo && <p className="text-sm text-red-600">{fallo}</p>}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-5">
          <button
            onClick={onCerrar}
            disabled={borrando}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide text-neutral-500 hover:text-neutral-800 disabled:opacity-40"
          >
            {info && !info.puede ? "Entendido" : "Cancelar"}
          </button>
          {info?.puede && (
            <button
              onClick={borrar}
              disabled={borrando}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide text-white bg-red-600 hover:bg-red-700 disabled:opacity-40"
            >
              {borrando ? "Borrando…" : "Borrar para siempre"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
