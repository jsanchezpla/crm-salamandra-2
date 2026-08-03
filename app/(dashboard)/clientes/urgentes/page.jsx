"use client";

/**
 * Fichas a completar — los huecos de datos, por carpetas desplegables.
 *
 * Sale de la migración de Aumenta (Rodrigo, 03/08/2026): al traer 1.083
 * familias de Organízate quedaron miles de huecos —pacientes sin terapeuta,
 * familias sin teléfono— y no había ningún sitio donde verlos juntos.
 *
 * Tres decisiones de la pantalla:
 *
 * · DOS BLOQUES. Arriba lo que rompe algo esta semana (decenas de filas, se
 *   puede terminar); abajo la ficha incompleta (miles, es una campaña). Si
 *   todo saliera junto, lo urgente quedaría enterrado y nadie volvería a abrir
 *   la pantalla.
 * · CARPETAS con su total a la derecha, cerradas por defecto. Abrir la pantalla
 *   no debe ser recibir 3.700 nombres a la cara.
 * · Cada fila se puede marcar REVISADA. Hay huecos correctos —un paciente en
 *   lista de espera no tiene terapeuta— y sin poder archivarlos la pantalla no
 *   llega a cero nunca.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

const fmt = (v) => {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return v || "—";
  return new Date(v + "T00:00:00").toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
};

function Carpeta({ carpeta, abierta, onToggle, onRevisar, marcando }) {
  const vacia = carpeta.total === 0;
  return (
    <div className={`rounded-xl border bg-white overflow-hidden ${carpeta.bloquea && !vacia ? "border-amber-200" : "border-neutral-200"}`}>
      <button
        onClick={onToggle}
        disabled={vacia}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-neutral-50 transition disabled:hover:bg-white"
      >
        <span className={`text-neutral-400 text-xs transition-transform ${abierta ? "rotate-90" : ""}`}>▶</span>
        <span className="flex-1 min-w-0">
          <span className={`block text-[13px] font-medium ${vacia ? "text-neutral-400" : "text-neutral-800"}`}>
            {carpeta.label}
          </span>
          <span className="block text-[11px] text-neutral-500 mt-0.5">{carpeta.ayuda}</span>
        </span>
        <span
          className={`shrink-0 text-[12px] font-medium tabular px-2.5 py-1 rounded-full ${
            vacia ? "bg-emerald-50 text-emerald-700"
              : carpeta.bloquea ? "bg-amber-100 text-amber-800" : "bg-neutral-100 text-neutral-600"
          }`}
        >
          {vacia ? "✓ 0" : carpeta.total}
        </span>
      </button>

      {abierta && carpeta.filas.length > 0 && (
        <div className="border-t border-neutral-100 overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <tbody>
              {carpeta.filas.map((f) => (
                <tr key={f.id} className="border-b border-neutral-50 last:border-0">
                  <td className="px-4 py-2">
                    <Link
                      href={carpeta.entidad === "patient" ? `/pacientes/${f.id}` : `/clientes/${f.id}`}
                      className="font-medium text-[var(--color-primary,#1B3A2D)] hover:underline"
                    >
                      {f.nombre}
                    </Link>
                    {f.familia && carpeta.entidad === "patient" && (
                      <span className="text-neutral-400"> · {f.familia}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-neutral-500 whitespace-nowrap">{fmt(f.dato)}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => onRevisar(carpeta, f)}
                      disabled={marcando === `${carpeta.key}|${f.id}`}
                      className="text-[11px] text-neutral-500 hover:text-neutral-800 underline disabled:opacity-40"
                    >
                      {marcando === `${carpeta.key}|${f.id}` ? "…" : "Está bien así"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {carpeta.total > carpeta.filas.length && (
            <div className="px-4 py-2 text-[11px] text-neutral-400 border-t border-neutral-100">
              Se ven las {carpeta.filas.length} primeras de {carpeta.total}. Ve cerrando y aparecerán las siguientes.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function FichasACompletarPage() {
  const [datos, setDatos] = useState(null);
  const [abiertas, setAbiertas] = useState(new Set());
  const [cargando, setCargando] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const [marcando, setMarcando] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await fetch("/api/clients/urgentes", { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo cargar");
      setDatos(j.data);
      setErrorMsg(null);
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  function toggle(key) {
    setAbiertas((prev) => {
      const s = new Set(prev);
      if (s.has(key)) s.delete(key); else s.add(key);
      return s;
    });
  }

  async function revisar(carpeta, fila) {
    const id = `${carpeta.key}|${fila.id}`;
    setMarcando(id);
    try {
      await fetch("/api/clients/urgentes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkKey: carpeta.key, entityId: fila.id, entidad: carpeta.entidad }),
      });
      await cargar();
    } finally {
      setMarcando(null);
    }
  }

  const todoOk = datos && datos.totalBloquea === 0 && datos.totalCompletar === 0;

  return (
    <div className="p-4 lg:p-8 max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-neutral-800">Fichas a completar</h1>
        <p className="text-[12.5px] text-neutral-500 mt-0.5">
          Datos que faltan en las fichas. Lo de arriba rompe algo esta semana; lo de abajo
          se puede ir cerrando poco a poco.
        </p>
      </div>

      {errorMsg && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{errorMsg}</div>}
      {cargando && <div className="text-[12.5px] text-neutral-400">Cargando…</div>}

      {todoOk && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-6 text-center">
          <div className="text-emerald-800 font-medium text-sm">No queda ninguna ficha a medias.</div>
          <div className="text-[12px] text-emerald-700 mt-1">Todo revisado. Buen trabajo.</div>
        </div>
      )}

      {datos && !todoOk && (
        <>
          <section className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[13px] font-medium text-amber-800">Bloquea el trabajo</h2>
              <span className="text-[11px] text-neutral-400">{datos.totalBloquea} pendiente(s)</span>
            </div>
            {datos.bloquea.map((c) => (
              <Carpeta
                key={c.key} carpeta={c} abierta={abiertas.has(c.key)}
                onToggle={() => toggle(c.key)} onRevisar={revisar} marcando={marcando}
              />
            ))}
            {/* Las citas sin profesional ya tienen su pantalla, con asignación en
                bloque. Se enlaza en vez de repetirla aquí a medias. */}
            <Link
              href="/citas/sin-profesional"
              className="block rounded-xl border border-neutral-200 bg-white px-4 py-3 hover:bg-neutral-50 transition"
            >
              <span className="text-[13px] font-medium text-neutral-800">Citas del curso sin profesional →</span>
              <span className="block text-[11px] text-neutral-500 mt-0.5">
                Se asignan en bloque desde Citas → Sin profesional.
              </span>
            </Link>
          </section>

          <section className="space-y-2 pt-2">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[13px] font-medium text-neutral-700">Ficha incompleta</h2>
              <span className="text-[11px] text-neutral-400">{datos.totalCompletar} pendiente(s)</span>
            </div>
            {datos.completar.map((c) => (
              <Carpeta
                key={c.key} carpeta={c} abierta={abiertas.has(c.key)}
                onToggle={() => toggle(c.key)} onRevisar={revisar} marcando={marcando}
              />
            ))}
          </section>
        </>
      )}
    </div>
  );
}
