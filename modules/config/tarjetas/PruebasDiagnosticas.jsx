"use client";

/**
 * modules/config/tarjetas/PruebasDiagnosticas.jsx — el catálogo de pruebas
 * diagnósticas del centro (05/09/2026, AV-0045 de Aumenta: «sería importante
 * que el sistema quedara preparado para añadir nuevas pruebas en el futuro sin
 * tener que modificar toda la plantilla»).
 *
 * Las de fábrica —el listado de 13 áreas que mandó el centro— se ven y no se
 * tocan; las del centro se añaden aquí con su nombre, qué evalúa y su área, y
 * desde ese momento salen en el desplegable del informe de diagnóstico. Solo
 * dirección: es el catálogo con el que se firma un diagnóstico.
 */

import { useEffect, useState } from "react";
import Select from "@/components/ui/Select.jsx";

const INPUT = "w-full px-2.5 py-1.5 text-xs border border-neutral-200 rounded-md focus:outline-none focus:border-neutral-400";

export default function PruebasDiagnosticasCard() {
  const [datos, setDatos] = useState(null);
  const [nueva, setNueva] = useState({ nombre: "", uso: "", area: "" });
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [verFabrica, setVerFabrica] = useState(false);

  useEffect(() => {
    fetch("/api/clinica/pruebas", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.data && setDatos(j.data)) // 403: sin Clínica → no se pinta
      .catch(() => {});
  }, []);

  if (!datos) return null;

  const propias = datos.pruebas.filter((p) => !p.deFabrica);
  const deFabrica = datos.pruebas.filter((p) => p.deFabrica);
  const nombreDeArea = (k) => datos.areas.find((a) => a.key === k)?.nombre ?? k;

  async function guardar(lista) {
    setGuardando(true);
    setAviso(null);
    try {
      const r = await fetch("/api/clinica/pruebas", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pruebas: lista }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo guardar");
      setDatos(j.data);
      setAviso("Catálogo guardado");
    } catch (e) {
      setAviso(e.message);
    } finally {
      setGuardando(false);
    }
  }

  function anadir() {
    if (!nueva.nombre.trim()) return;
    const lista = [...propias.map(({ nombre, uso, areas }) => ({ nombre, uso, areas })), { nombre: nueva.nombre, uso: nueva.uso, areas: nueva.area ? [nueva.area] : [] }];
    guardar(lista);
    setNueva({ nombre: "", uso: "", area: "" });
  }

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="text-sm font-semibold text-neutral-800">Pruebas diagnósticas</div>
      <p className="text-xs text-neutral-400 mt-0.5 max-w-lg">
        Las pruebas que se pueden elegir en un informe de valoración diagnóstica. Las de fábrica son
        las del listado del centro ({deFabrica.length}); aquí se añaden las nuevas sin tocar la plantilla.
      </p>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-[1fr_1.4fr_1fr_auto] gap-2 items-end">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-neutral-400">Nombre</label>
          <input value={nueva.nombre} onChange={(e) => setNueva((n) => ({ ...n, nombre: e.target.value }))} placeholder="Ej. WISC-V" className={INPUT} />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-neutral-400">Qué evalúa</label>
          <input value={nueva.uso} onChange={(e) => setNueva((n) => ({ ...n, uso: e.target.value }))} placeholder="Uso principal" className={INPUT} />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-neutral-400">Área</label>
          <Select
            value={nueva.area}
            onChange={(v) => setNueva((n) => ({ ...n, area: v }))}
            options={[{ value: "", label: "Otras" }, ...datos.areas.filter((a) => a.key !== "otras").map((a) => ({ value: a.key, label: a.nombre }))]}
            className={INPUT}
          />
        </div>
        <button
          type="button"
          onClick={anadir}
          disabled={guardando || !nueva.nombre.trim()}
          className="text-xs font-medium px-3 py-2 rounded-lg text-white disabled:opacity-40"
          style={{ background: "var(--color-primary, #1B3A2D)" }}
        >
          Añadir
        </button>
      </div>

      {propias.length > 0 && (
        <ul className="mt-4 divide-y divide-neutral-100 border border-neutral-100 rounded-lg">
          {propias.map((p) => (
            <li key={p.key} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <div className="text-xs font-medium text-neutral-800">{p.nombre}</div>
                <div className="text-[10px] text-neutral-400 truncate">{p.uso || "—"} · {p.areas.map(nombreDeArea).join(", ")}</div>
              </div>
              <button
                type="button"
                disabled={guardando}
                onClick={() => guardar(propias.filter((x) => x.key !== p.key).map(({ nombre, uso, areas }) => ({ nombre, uso, areas })))}
                className="text-[11px] text-neutral-400 hover:text-rose-600 shrink-0"
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}

      <button type="button" onClick={() => setVerFabrica((v) => !v)} className="mt-3 text-[11px] text-neutral-500 hover:underline">
        {verFabrica ? "Ocultar las de fábrica" : "Ver las de fábrica"}
      </button>
      {verFabrica && (
        <div className="mt-2 space-y-2">
          {datos.areas.filter((a) => a.key !== "otras").map((a) => (
            <div key={a.key}>
              <div className="text-[10px] uppercase tracking-wider text-neutral-400">{a.nombre}</div>
              <div className="text-[11px] text-neutral-600">
                {deFabrica.filter((p) => p.areas.includes(a.key)).map((p) => p.nombre).join(" · ")}
              </div>
            </div>
          ))}
        </div>
      )}

      {aviso && <div className="mt-3 text-[11px] text-neutral-600">{aviso}</div>}
    </div>
  );
}
