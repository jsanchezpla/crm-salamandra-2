"use client";

import { useEffect, useState } from "react";

/**
 * Editor de la tabla de TRAMOS de incentivo (Dirección).
 * "Desde X puntos → Y €". La propuesta de cada terapeuta se deriva de aquí, así
 * que al guardar se avisa al panel (onSaved) para recalcular.
 */
export default function IncentiveTiersEditor({ onSaved }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [isDefault, setIsDefault] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = () => {
    setLoading(true);
    fetch("/api/clinica/performance/incentive-tiers", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          setRows(j.data.tiers.map((t) => ({ from: String(t.from), amount: String(t.amount) })));
          setIsDefault(j.data.isDefault);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const setRow = (i, key, val) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)));
  const addRow = () => setRows((rs) => [...rs, { from: "", amount: "" }]);
  const removeRow = (i) => setRows((rs) => rs.filter((_, idx) => idx !== i));

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const tiers = rows
        .map((r) => ({ from: Number(r.from), amount: Number(r.amount) }))
        .filter((t) => Number.isFinite(t.from) && Number.isFinite(t.amount));
      const r = await fetch("/api/clinica/performance/incentive-tiers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tiers }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo guardar");
      setRows(j.data.tiers.map((t) => ({ from: String(t.from), amount: String(t.amount) })));
      setIsDefault(false);
      setMsg("Tramos guardados. Las propuestas se han recalculado.");
      onSaved?.();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-4 lg:px-5 py-3 flex items-center justify-between border-b border-neutral-100 text-left"
      >
        <div>
          <h2 className="eyebrow">Tramos de incentivo</h2>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            Puntuación total → importe. De aquí sale la propuesta de cada terapeuta.
            {isDefault && <span className="ml-1 text-amber-600">Usando valores por defecto.</span>}
          </p>
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-4 h-4 text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="p-4 lg:p-5 space-y-3">
          {loading ? (
            <p className="text-xs text-neutral-400">Cargando…</p>
          ) : (
            <>
              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-[10px] uppercase tracking-wider text-neutral-400 px-1">
                  <span>Desde (pts)</span>
                  <span>Incentivo (€)</span>
                  <span></span>
                </div>
                {rows.map((r, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                    <input
                      type="number" min={0} max={100} value={r.from}
                      onChange={(e) => setRow(i, "from", e.target.value)}
                      className="px-3 py-2 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400 tabular"
                      placeholder="0"
                    />
                    <input
                      type="number" min={0} step={10} value={r.amount}
                      onChange={(e) => setRow(i, "amount", e.target.value)}
                      className="px-3 py-2 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400 tabular"
                      placeholder="0"
                    />
                    <button
                      onClick={() => removeRow(i)}
                      disabled={rows.length <= 1}
                      className="p-2 text-neutral-400 hover:text-rose-600 disabled:opacity-30"
                      title="Quitar tramo"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                ))}
              </div>

              <button onClick={addRow} className="text-[11px] text-[var(--color-primary,#1B3A2D)] hover:underline">+ Añadir tramo</button>

              <p className="text-[10px] text-neutral-400 leading-snug">
                Cada tramo aplica desde su puntuación (incluida) hasta la del siguiente. Siempre debe existir un tramo base "Desde 0".
              </p>

              {msg && <div className="text-[11px] text-neutral-600 bg-neutral-50 border border-neutral-100 rounded-lg px-3 py-2">{msg}</div>}

              <div className="flex justify-end gap-2 pt-1">
                <button onClick={load} disabled={busy} className="px-4 py-2 rounded-lg border border-neutral-200 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-50">Deshacer</button>
                <button onClick={save} disabled={busy} className="px-4 py-2 rounded-lg text-white text-xs font-medium disabled:opacity-50" style={{ background: "var(--color-primary, #1B3A2D)" }}>
                  {busy ? "Guardando…" : "Guardar tramos"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
