"use client";

/**
 * PatientReparto — reparto de una cuota del paciente en VARIAS facturas (Fase 2b).
 *
 * Aumenta: cuando una cuota la pagan varios (fundación + familia, o "este mes la
 * tía/abuelo"), se emite UNA factura por pagador con el importe que abonó — NO un
 * motor de porcentajes. Aquí se teclean N filas {pagador, importe} y se crea un
 * BORRADOR por fila, todos enlazados al mismo paciente y compartiendo un
 * customFields.splitGroupId + billingPeriod para poder agruparlos luego.
 *
 * Fiscal-neutral: el importe es la BASE de una línea; el IVA lo aplica la config
 * del tenant y se ajusta en el editor de facturas (pendiente confirmar exención).
 */

import { useEffect, useMemo, useState } from "react";
import Select from "@/components/ui/Select.jsx";

const eur = (n) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(n) || 0);

export default function PatientReparto({ patientId, defaultPayerClientId, onClose, onCreated }) {
  const [clients, setClients] = useState([]);
  const [concept, setConcept] = useState("Cuota");
  const [period, setPeriod] = useState("");
  const [rows, setRows] = useState([
    { clientId: defaultPayerClientId || "", amount: "" },
    { clientId: "", amount: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/clients?limit=200`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (alive && d.ok) setClients(d.data.clients || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const clientOptions = useMemo(
    () => [{ value: "", label: "Selecciona pagador…" }, ...clients.map((c) => ({ value: c.id, label: c.name }))],
    [clients]
  );
  const total = useMemo(() => rows.reduce((s, r) => s + (Number(r.amount) || 0), 0), [rows]);

  const setRow = (i, k, v) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  const addRow = () => setRows((rs) => [...rs, { clientId: "", amount: "" }]);
  const removeRow = (i) => setRows((rs) => (rs.length <= 1 ? rs : rs.filter((_, idx) => idx !== i)));

  async function submit() {
    if (busy) return;
    const valid = rows.filter((r) => r.clientId && Number(r.amount) > 0);
    if (valid.length < 2) { setError("Añade al menos dos pagadores con importe."); return; }
    setBusy(true);
    setError(null);
    try {
      const splitGroupId =
        typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${patientId}-${Date.now()}`;
      const issueDate = new Date().toISOString().slice(0, 10);
      const billingPeriod = period.trim() || null;
      const results = [];
      for (const r of valid) {
        const res = await fetch(`/api/billing/invoices`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: r.clientId,
            patientId,
            issueDate,
            lines: [{ description: `${concept.trim() || "Cuota"}${billingPeriod ? ` (${billingPeriod})` : ""}`, quantity: 1, unitPrice: Number(r.amount) }],
            customFields: { splitGroupId, billingPeriod, source: "split" },
          }),
        });
        const d = await res.json();
        results.push(res.ok);
        if (!res.ok) throw new Error(d.error || "No se pudo crear una de las facturas del reparto");
      }
      onCreated?.(results.length);
    } catch (e) {
      setError(e.message + " (puede que se hayan creado borradores parciales; revísalos en Facturación)");
    } finally {
      setBusy(false);
    }
  }

  const labelCls = "block text-[11px] font-medium text-neutral-500 mb-1";
  const inputCls = "w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm";

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} aria-hidden="true" />
      <div className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-lg bg-white rounded-xl shadow-2xl p-5 max-h-[88vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="eyebrow">Reparto de cuota</div>
            <p className="text-[11px] text-neutral-500 mt-0.5">Una factura por pagador, con el importe que abona cada uno.</p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700 p-1 -m-1" aria-label="Cerrar">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className={labelCls}>Concepto</label>
            <input className={inputCls} value={concept} onChange={(e) => setConcept(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Periodo (opcional)</label>
            <input className={inputCls} value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="p. ej. Junio 2026" />
          </div>
        </div>

        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-end gap-2">
              <div className="flex-1 min-w-0">
                {i === 0 && <label className={labelCls}>Pagador</label>}
                <Select value={r.clientId} onChange={(v) => setRow(i, "clientId", v)} options={clientOptions} searchable className={inputCls} />
              </div>
              <div className="w-28">
                {i === 0 && <label className={labelCls}>Importe (base)</label>}
                <input type="number" min="0" step="0.01" className={inputCls} value={r.amount} onChange={(e) => setRow(i, "amount", e.target.value)} placeholder="0,00" />
              </div>
              <button
                onClick={() => removeRow(i)}
                disabled={rows.length <= 1}
                className="mb-1 text-neutral-400 hover:text-rose-600 disabled:opacity-30 px-1"
                title="Quitar pagador"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between mt-2">
          <button onClick={addRow} className="text-[11px] font-medium text-[var(--color-primary,#1B3A2D)] hover:underline">+ Añadir pagador</button>
          <span className="text-[11px] text-neutral-500">Total repartido: <span className="font-medium text-neutral-800">{eur(total)}</span></span>
        </div>

        {error && <p className="text-[11px] text-rose-600 mt-2">{error}</p>}

        <div className="flex items-center gap-2 mt-4">
          <button onClick={submit} disabled={busy} className="text-sm font-medium px-3 py-1.5 rounded-md bg-[var(--color-primary,#1B3A2D)] text-white disabled:opacity-40">
            {busy ? "Creando…" : "Crear borradores"}
          </button>
          <button onClick={onClose} className="text-sm text-neutral-500">Cancelar</button>
        </div>
        <p className="text-[10px] text-neutral-400 mt-2">
          Se crean borradores editables. Ajusta importe/concepto/IVA y emite cada uno por separado en Facturación.
        </p>
      </div>
    </>
  );
}
