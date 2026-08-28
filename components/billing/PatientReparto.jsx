"use client";

/**
 * PatientReparto — reparto de una cuota del paciente, con DOS modos claros
 * (para no confundir el caso "fraccionar el cobro" con "repartir entre pagadores"):
 *
 *   A) "Una factura, varios cobros": UNA factura por el importe total a un único
 *      pagador; el IVA se aplica UNA vez sobre el total y los cobros parciales se
 *      registran luego en la propia factura.
 *   B) "Varias facturas, un pagador cada una": el total se reparte en N facturas
 *      (una por pagador), cada una con su IVA proporcional como si fuera individual.
 *      Se valida que la suma de las N CUADRE con el total; si algo falla a medias,
 *      se borran los borradores ya creados (no se queda a medias).
 */

import { useEffect, useMemo, useState } from "react";
import Select from "@/components/ui/Select.jsx";
import SelectorCliente from "@/components/clients/SelectorCliente.jsx";

const eur = (n) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(n) || 0);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export default function PatientReparto({ patientId, defaultPayerClientId, onClose, onCreated }) {
  const [mode, setMode] = useState("split"); // 'single' | 'split'
  const [concept, setConcept] = useState("Cuota");
  const [period, setPeriod] = useState("");
  const [total, setTotal] = useState("");
  const [singlePayer, setSinglePayer] = useState(defaultPayerClientId || "");
  const [rows, setRows] = useState([
    { clientId: defaultPayerClientId || "", amount: "" },
    { clientId: "", amount: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Las fichas ya no se bajan aquí (28/08/2026). Había buscador, sí, pero
  // filtraba sobre las 200 que cabían: con las 1.083 de Aumenta se quedaban
  // fuera 883 familias y escribir su nombre no las traía. Ahora pregunta
  // SelectorCliente al servidor.
  const opcionesPagador = useMemo(() => [{ value: "", label: "Selecciona pagador…" }], []);
  const repartido = useMemo(() => round2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)), [rows]);
  const totalNum = round2(total);
  const cuadra = totalNum > 0 && Math.abs(repartido - totalNum) < 0.005;
  const restante = round2(totalNum - repartido);

  const setRow = (i, k, v) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  const addRow = () => setRows((rs) => [...rs, { clientId: "", amount: "" }]);
  const removeRow = (i) => setRows((rs) => (rs.length <= 1 ? rs : rs.filter((_, idx) => idx !== i)));

  const lineDesc = () => `${concept.trim() || "Cuota"}${period.trim() ? ` (${period.trim()})` : ""}`;

  async function createInvoice(clientId, amount, extraCF) {
    const res = await fetch(`/api/billing/invoices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        patientId,
        issueDate: new Date().toISOString().slice(0, 10),
        lines: [{ description: lineDesc(), quantity: 1, unitPrice: Number(amount) }],
        customFields: { source: "reparto", ...(extraCF || {}) },
      }),
    });
    const d = await res.json().catch(() => null);
    if (!res.ok) throw new Error(d?.error || "No se pudo crear la factura");
    return d.data.id;
  }

  async function submitSingle() {
    if (busy) return;
    if (!singlePayer) { setError("Selecciona el pagador."); return; }
    if (!(totalNum > 0)) { setError("Indica el importe total."); return; }
    setBusy(true); setError(null);
    try {
      await createInvoice(singlePayer, totalNum, { source: "single" });
      onCreated?.(1);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function submitSplit() {
    if (busy) return;
    const valid = rows.filter((r) => r.clientId && Number(r.amount) > 0);
    if (valid.length < 2) { setError("Añade al menos dos pagadores con importe."); return; }
    if (!(totalNum > 0)) { setError("Indica el importe total del servicio."); return; }
    if (!cuadra) { setError(`La suma (${eur(repartido)}) no cuadra con el total (${eur(totalNum)}).`); return; }
    setBusy(true); setError(null);
    const created = [];
    try {
      const splitGroupId =
        typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${patientId}-split`;
      const billingPeriod = period.trim() || null;
      for (const r of valid) {
        const id = await createInvoice(r.clientId, r.amount, { splitGroupId, billingPeriod, source: "split" });
        created.push(id);
      }
      onCreated?.(created.length);
    } catch (e) {
      // No dejar borradores a medias: se borran los ya creados en este intento.
      await Promise.all(created.map((id) => fetch(`/api/billing/invoices/${id}`, { method: "DELETE" }).catch(() => {})));
      setError(`${e.message} — no se creó ninguna factura (se revirtió lo parcial).`);
    } finally { setBusy(false); }
  }

  const labelCls = "block text-[11px] font-medium text-neutral-500 mb-1";
  const inputCls = "w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm";
  const tabCls = (on) =>
    `px-3 py-1.5 rounded-lg text-xs border transition ${on ? "border-transparent text-white" : "border-neutral-200 text-neutral-500 hover:bg-neutral-50"}`;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} aria-hidden="true" />
      <div className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-lg bg-white rounded-xl shadow-2xl p-5 max-h-[88vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="eyebrow">Reparto de cuota</div>
            <p className="text-[11px] text-neutral-500 mt-0.5">Elige cómo cobrar el servicio.</p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700 p-1 -m-1" aria-label="Cerrar">✕</button>
        </div>

        {/* Elección de modo */}
        <div className="flex flex-wrap gap-2 mb-2">
          <button type="button" onClick={() => setMode("single")} className={tabCls(mode === "single")} style={mode === "single" ? { backgroundColor: "var(--color-primary,#1B3A2D)" } : undefined}>
            Una factura, varios cobros
          </button>
          <button type="button" onClick={() => setMode("split")} className={tabCls(mode === "split")} style={mode === "split" ? { backgroundColor: "var(--color-primary,#1B3A2D)" } : undefined}>
            Varias facturas, un pagador cada una
          </button>
        </div>
        <p className="text-[11px] text-neutral-400 mb-3">
          {mode === "single"
            ? "Una sola factura por el total a un pagador. El IVA se aplica una vez sobre el total; los cobros parciales se registran luego en la factura."
            : "El total se reparte en varias facturas (una por pagador), cada una con su IVA proporcional. La suma debe cuadrar con el total."}
        </p>

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

        <div className="mb-3">
          <label className={labelCls}>Importe total del servicio (€)</label>
          <input type="number" min="0" step="0.01" className={inputCls} value={total} onChange={(e) => setTotal(e.target.value)} placeholder="0,00" />
        </div>

        {mode === "single" ? (
          <div>
            <label className={labelCls}>Pagador</label>
            <SelectorCliente value={singlePayer} onChange={setSinglePayer} opcionesFijas={opcionesPagador} className={inputCls} />
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {rows.map((r, i) => (
                <div key={i} className="flex items-end gap-2">
                  <div className="flex-1 min-w-0">
                    {i === 0 && <label className={labelCls}>Pagador</label>}
                    <SelectorCliente value={r.clientId} onChange={(v) => setRow(i, "clientId", v)} opcionesFijas={opcionesPagador} className={inputCls} />
                  </div>
                  <div className="w-28">
                    {i === 0 && <label className={labelCls}>Importe (€)</label>}
                    <input type="number" min="0" step="0.01" className={inputCls} value={r.amount} onChange={(e) => setRow(i, "amount", e.target.value)} placeholder="0,00" />
                  </div>
                  <button onClick={() => removeRow(i)} disabled={rows.length <= 1} className="mb-1 text-neutral-400 hover:text-rose-600 disabled:opacity-30 px-1" title="Quitar pagador">✕</button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-2">
              <button onClick={addRow} className="text-[11px] font-medium text-[var(--color-primary,#1B3A2D)] hover:underline">+ Añadir pagador</button>
              <span className={`text-[11px] ${cuadra ? "text-emerald-600 font-medium" : "text-neutral-500"}`}>
                {totalNum > 0
                  ? cuadra
                    ? "✓ Cuadra con el total"
                    : `Repartido ${eur(repartido)} de ${eur(totalNum)} · ${restante >= 0 ? "faltan" : "sobran"} ${eur(Math.abs(restante))}`
                  : `Repartido ${eur(repartido)}`}
              </span>
            </div>
          </>
        )}

        {error && <p className="text-[11px] text-rose-600 mt-2">{error}</p>}

        <div className="flex items-center gap-2 mt-4">
          {mode === "single" ? (
            <button onClick={submitSingle} disabled={busy} className="text-sm font-medium px-3 py-1.5 rounded-md bg-[var(--color-primary,#1B3A2D)] text-white disabled:opacity-40">
              {busy ? "Creando…" : "Crear factura"}
            </button>
          ) : (
            <button onClick={submitSplit} disabled={busy || !cuadra} className="text-sm font-medium px-3 py-1.5 rounded-md bg-[var(--color-primary,#1B3A2D)] text-white disabled:opacity-40">
              {busy ? "Creando…" : "Crear borradores"}
            </button>
          )}
          <button onClick={onClose} className="text-sm text-neutral-500">Cancelar</button>
        </div>
        <p className="text-[10px] text-neutral-400 mt-2">
          {mode === "single"
            ? "Se crea un borrador editable por el total. Emítelo y registra los cobros parciales en Facturación."
            : "Se crean borradores editables (uno por pagador). Ajusta y emite cada uno en Facturación."}
        </p>
      </div>
    </>
  );
}
