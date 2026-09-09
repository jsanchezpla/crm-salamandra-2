"use client";

/**
 * SelectorDestinatarios — a quién se le pone una cuota (01/09/2026, alta en
 * grupo de la pantalla de Cuotas).
 *
 * Se buscan PACIENTES (que es como los conoce el centro) y de cada uno se
 * arrastra su familia pagadora, que es quien acaba pagando. Sin módulo
 * asistencial no hay pacientes: se cae al selector de fichas de siempre.
 *
 * Vivía dentro de `app/(dashboard)/facturacion/cuotas/page.jsx` y salió aquí el
 * 09/09/2026, cuando la ficha de un tipo de cuota necesitó lo mismo para
 * «agregar pacientes» a esa cuota. Dos buscadores de destinatarios que se
 * comportan distinto es una forma segura de crear cuotas donde no tocan.
 */

import { useEffect, useState } from "react";
import SelectorCliente from "@/components/clients/SelectorCliente.jsx";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

export default function SelectorDestinatarios({ valores, onChange, etiqueta = "A quién se le pone esta cuota *" }) {
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState([]);
  const [hayPacientes, setHayPacientes] = useState(true);
  const [buscando, setBuscando] = useState(false);

  // El vaciado va DENTRO del temporizador, no en el cuerpo del efecto: un
  // setState sincrono ahi encadena renders (y lo canta el lint).
  useEffect(() => {
    const t = texto.trim();
    const id = setTimeout(() => {
      if (t.length < 2) { setResultados([]); return; }
      setBuscando(true);
      fetch(`/api/pacientes?q=${encodeURIComponent(t)}&limit=10`, { cache: "no-store" })
        .then(async (r) => {
          // Sin modulo asistencial la puerta responde 403: se cae al selector
          // de fichas en vez de dejar el buscador mudo.
          if (r.status === 403) { setHayPacientes(false); return { data: {} }; }
          return r.json();
        })
        .then((j) => setResultados(j?.data?.patients ?? []))
        .catch(() => setResultados([]))
        .finally(() => setBuscando(false));
    }, 250);
    return () => clearTimeout(id);
  }, [texto]);

  function añadir(p) {
    if (!p.clientId) return; // sin familia pagadora no se puede cobrar
    if (valores.some((v) => v.patientId === p.id)) return;
    onChange([...valores, {
      patientId: p.id,
      clientId: p.clientId,
      etiqueta: `${p.firstName} ${p.lastName}`,
      familia: p.client?.name ?? "",
    }]);
    setTexto("");
    setResultados([]);
  }

  function añadirFamilia(clientId, ficha) {
    if (!clientId || valores.some((v) => v.clientId === clientId && !v.patientId)) return;
    onChange([...valores, { patientId: null, clientId, etiqueta: ficha?.name ?? "Familia", familia: ficha?.name ?? "" }]);
  }

  return (
    <div className="space-y-2">
      <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">
        {etiqueta}
      </label>

      {hayPacientes ? (
        <div className="relative">
          <input value={texto} onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar paciente por nombre…" className={inputCls} />
          {texto.trim().length >= 2 && (
            <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-neutral-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
              {buscando && <div className="px-3 py-2 text-xs text-neutral-400">Buscando…</div>}
              {!buscando && resultados.length === 0 && <div className="px-3 py-2 text-xs text-neutral-400">Sin resultados</div>}
              {resultados.map((p) => (
                <button key={p.id} type="button" onClick={() => añadir(p)}
                  disabled={!p.clientId}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed">
                  <span className="text-neutral-800">{p.firstName} {p.lastName}</span>
                  <span className="text-neutral-400"> · {p.client?.name ?? "sin familia pagadora"}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <SelectorCliente value="" onChange={añadirFamilia} fuente="billing" className={inputCls}
          placeholder="Buscar familia…" />
      )}

      {valores.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {valores.map((v, i) => (
            <li key={`${v.clientId}-${v.patientId ?? "x"}`}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-neutral-100 text-[11px] text-neutral-700">
              {v.etiqueta}
              <button type="button" onClick={() => onChange(valores.filter((_, j) => j !== i))}
                className="text-neutral-400 hover:text-rose-600">×</button>
            </li>
          ))}
        </ul>
      )}
      {valores.length > 1 && (
        <p className="text-[10px] text-neutral-400">
          Se creará una cuota por cada uno. Quien ya tenga una cuota activa se salta y te lo digo.
        </p>
      )}
    </div>
  );
}
