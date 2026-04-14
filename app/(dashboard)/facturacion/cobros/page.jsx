"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

const METHOD_LABELS = {
  card: "Tarjeta",
  transfer: "Transferencia",
  cash: "Efectivo",
  direct_debit: "Domiciliación",
};

function fmt(n) {
  return Number(n || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

export default function CobrosPage() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ invoiceId: "", amount: "", method: "transfer", paidAt: "" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/payments?limit=50");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error");
      setPayments(json.data?.payments ?? []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const totalCollected = payments
    .filter((p) => p.status === "completed")
    .reduce((s, p) => s + Number(p.amount || 0), 0);

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch("/api/billing/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId: form.invoiceId,
          amount: Number(form.amount),
          method: form.method,
          paidAt: form.paidAt || new Date().toISOString(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error");
      setForm({ invoiceId: "", amount: "", method: "transfer", paidAt: "" });
      setShowForm(false);
      load();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-extrabold text-neutral-900">Cobros</h1>
          <p className="text-xs text-neutral-400 mt-0.5">
            Total cobrado: <span className="font-semibold text-[#3E5C57]">{fmt(totalCollected)} €</span>
          </p>
        </div>
        <div className="flex items-center gap-3 self-start sm:self-auto">
          <Link href="/facturacion" className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">
            ← Volver
          </Link>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white transition-opacity"
            style={{ background: "var(--color-primary, #152B22)" }}
          >
            + Registrar cobro
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white border border-neutral-100 rounded-xl p-5 mb-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="col-span-2">
            <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-widest mb-3">Registrar cobro</h2>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-neutral-400 uppercase tracking-widest">ID de factura *</label>
            <input required value={form.invoiceId} onChange={(e) => setForm((f) => ({ ...f, invoiceId: e.target.value }))}
              placeholder="UUID de la factura" className={inputCls} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-neutral-400 uppercase tracking-widest">Importe (€) *</label>
            <input required type="number" min="0.01" step="0.01" value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="0.00" className={inputCls} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-neutral-400 uppercase tracking-widest">Método de pago</label>
            <select value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))} className={inputCls}>
              {Object.entries(METHOD_LABELS).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-neutral-400 uppercase tracking-widest">Fecha de pago</label>
            <input type="datetime-local" value={form.paidAt} onChange={(e) => setForm((f) => ({ ...f, paidAt: e.target.value }))} className={inputCls} />
          </div>
          {formError && (
            <div className="col-span-2 text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{formError}</div>
          )}
          <div className="col-span-2 flex gap-2 justify-end">
            <button type="button" onClick={() => setShowForm(false)}
              className="px-4 py-2 text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-50 transition"
              style={{ background: "var(--color-primary, #152B22)" }}>
              {saving ? "Guardando..." : "Registrar"}
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{error}</div>
      )}

      <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[500px]">
          <thead>
            <tr className="border-b border-neutral-100">
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Factura</th>
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Método</th>
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Fecha</th>
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Estado</th>
              <th className="text-right px-4 py-3 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Importe</th>
            </tr>
          </thead>
          <tbody>
            {loading && payments.length === 0 && (
              <tr><td colSpan={5} className="text-center py-12 text-xs text-neutral-400">Cargando...</td></tr>
            )}
            {!loading && payments.length === 0 && (
              <tr><td colSpan={5} className="text-center py-12 text-xs text-neutral-400">Sin cobros registrados</td></tr>
            )}
            {payments.map((p) => (
              <tr key={p.id} className="border-b border-neutral-50 hover:bg-neutral-50/70 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-neutral-500">
                  {p.invoice?.number ?? p.invoiceId?.slice(0, 8) + "..." ?? "—"}
                </td>
                <td className="px-4 py-3 text-neutral-600 text-xs">{METHOD_LABELS[p.method] ?? p.method}</td>
                <td className="px-4 py-3 text-neutral-500 text-xs">
                  {p.paidAt ? new Date(p.paidAt).toLocaleDateString("es-ES") : "—"}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${
                    p.status === "completed" ? "bg-emerald-50 text-emerald-600" :
                    p.status === "failed" ? "bg-red-50 text-red-500" :
                    "bg-amber-50 text-amber-600"
                  }`}>
                    {p.status === "completed" ? "Completado" : p.status === "failed" ? "Fallido" : "Pendiente"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-semibold text-neutral-900">{fmt(p.amount)} €</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
