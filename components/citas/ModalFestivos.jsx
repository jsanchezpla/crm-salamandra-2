"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * ModalFestivos — festivos y cierres del centro, en una pantalla del CRM.
 *
 * SUSTITUYE A UNA CADENA DE DIÁLOGOS DEL NAVEGADOR (12/08/2026, Rodrigo: «modal
 * para festivos, que ahora es una notificación de navegador extraña»). Marcar
 * el 24 de diciembre eran hasta cuatro ventanas seguidas del navegador: una
 * pidiendo la fecha en DD-MM-AAAA a mano, otra el motivo, un `confirm` si el
 * día ya estaba marcado y un `alert` si ese día ya había citas. Y para saber
 * qué días estaban cerrados había que ir mes a mes mirando el calendario.
 *
 * Aquí se ve la LISTA de lo que hay cerrado por delante y se marca o se quita
 * sin salir del sitio.
 *
 * ── LA LISTA ES SUYA, NO LA DEL CALENDARIO ─────────────────────────────────
 * El calendario carga solo los festivos del mes que se está mirando. Si el
 * modal enseñara esa lista, marcar el 24-12 estando en agosto lo haría
 * desaparecer del listado al instante — que se lee como que no ha funcionado.
 * Por eso pide los suyos: de hoy en adelante, un año largo por delante.
 *
 * `onCambio` avisa al calendario para que recargue LOS SUYOS (el mes visible)
 * y repinte las celdas.
 */

const DIAS_POR_DELANTE = 400;

/** Fecha local en YYYY-MM-DD. `toISOString()` pasaría a UTC y en España restaría un día. */
function hoyYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function sumarDias(ymd, dias) {
  const [a, m, d] = ymd.split("-").map(Number);
  const f = new Date(a, m - 1, d + dias);
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(f.getDate()).padStart(2, "0")}`;
}

/** "2026-12-24" → "jueves, 24 de diciembre de 2026". La fecha se lee, no se descifra. */
function bonita(ymd) {
  const [a, m, d] = String(ymd ?? "").split("-").map(Number);
  if (!a || !m || !d) return String(ymd ?? "");
  return new Date(a, m - 1, d).toLocaleDateString("es-ES", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

export default function ModalFestivos({ onCerrar, onCambio }) {
  const [dias, setDias] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [fecha, setFecha] = useState(hoyYmd());
  const [motivo, setMotivo] = useState("Festivo");
  const [guardando, setGuardando] = useState(false);
  const [fallo, setFallo] = useState(null);
  const [aviso, setAviso] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const desde = hoyYmd();
      const hasta = sumarDias(desde, DIAS_POR_DELANTE);
      const r = await fetch(`/api/citas/blocked-days?from=${desde}&to=${hasta}`, { cache: "no-store" });
      const j = await r.json();
      if (j?.ok) setDias(j.data.blockedDays ?? []);
    } catch {
      /* la lista se queda como estaba */
    }
    setCargando(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  useEffect(() => {
    function alPulsar(e) { if (e.key === "Escape") onCerrar(); }
    document.addEventListener("keydown", alPulsar);
    return () => document.removeEventListener("keydown", alPulsar);
  }, [onCerrar]);

  async function marcar() {
    setFallo(null);
    setAviso(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { setFallo("Elige una fecha."); return; }
    setGuardando(true);
    try {
      const r = await fetch("/api/citas/blocked-days", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: fecha, label: motivo.trim() || null }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "No se pudo marcar");
      // Las citas ya puestas NO se tocan: se avisa para que alguien decida.
      setAviso(
        j.data?.citasEseDia > 0
          ? `Marcado. Ojo: ese día ya hay ${j.data.citasEseDia} cita(s) puestas. No se han tocado: decide tú si avisar o reubicar.`
          : "Día cerrado."
      );
      await cargar();
      onCambio?.();
    } catch (e) {
      setFallo(e.message);
    }
    setGuardando(false);
  }

  async function quitar(dia) {
    setFallo(null);
    setAviso(null);
    try {
      const r = await fetch(`/api/citas/blocked-days?date=${dia.date}`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json())?.error || "No se pudo quitar");
      setDias((lista) => lista.filter((d) => d.date !== dia.date));
      onCambio?.();
    } catch (e) {
      setFallo(e.message);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 z-40" onClick={onCerrar} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-50 w-full max-w-lg max-h-[88vh] bg-white rounded-xl shadow-2xl flex flex-col"
      >
        <div className="px-5 py-4 border-b border-neutral-100 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">Festivos y cierres del centro</h2>
            <p className="text-[11px] text-neutral-500 mt-0.5 leading-relaxed">
              Los días cerrados dejan de ofrecer huecos en la agenda pública y salen atenuados en
              el calendario. Las citas que ya hubiera ese día no se tocan.
            </p>
          </div>
          <button
            onClick={onCerrar}
            className="text-neutral-400 hover:text-neutral-700 p-0.5 shrink-0"
            aria-label="Cerrar"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Alta */}
        <div className="px-5 py-4 border-b border-neutral-100 bg-neutral-50/70">
          <div className="flex items-end gap-2 flex-wrap">
            <label className="text-xs">
              <span className="block text-neutral-500 mb-1">Día</span>
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="border border-neutral-200 rounded-md px-2 py-1.5 text-sm bg-white"
              />
            </label>
            <label className="text-xs flex-1 min-w-[140px]">
              <span className="block text-neutral-500 mb-1">Motivo</span>
              <input
                type="text"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Festivo, puente, formación…"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); marcar(); } }}
                className="w-full border border-neutral-200 rounded-md px-2 py-1.5 text-sm bg-white placeholder-neutral-300"
              />
            </label>
            <button
              type="button"
              onClick={marcar}
              disabled={guardando}
              className="text-xs font-medium px-3 py-1.5 rounded-md bg-[#0F0F0F] text-white hover:bg-[#222] disabled:opacity-50"
            >
              {guardando ? "Guardando…" : "Cerrar ese día"}
            </button>
          </div>
          {fallo && <p className="text-[11px] text-red-600 mt-2">{fallo}</p>}
          {aviso && <p className="text-[11px] text-emerald-700 mt-2">{aviso}</p>}
        </div>

        {/* Lo que ya está cerrado */}
        <div className="flex-1 overflow-y-auto divide-y divide-neutral-100">
          {cargando && <p className="px-5 py-4 text-xs text-neutral-400">Cargando…</p>}
          {!cargando && dias.length === 0 && (
            <p className="px-5 py-5 text-xs text-neutral-400">
              No hay ningún día cerrado por delante.
            </p>
          )}
          {dias.map((d) => (
            <div key={d.date} className="px-5 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] text-neutral-800 first-letter:uppercase truncate">
                  {bonita(d.date)}
                </p>
                <p className="text-[11px] text-neutral-500 truncate">{d.label || "Cerrado"}</p>
              </div>
              <button
                onClick={() => quitar(d)}
                className="text-xs px-2.5 py-1 rounded-md border border-red-200 text-red-600 hover:bg-red-50 shrink-0"
              >
                Quitar
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
