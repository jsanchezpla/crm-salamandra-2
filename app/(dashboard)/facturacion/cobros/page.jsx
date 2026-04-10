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

export default function CobrosPage() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Nuevo cobro
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
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Cobros</h1>
          <p className="text-sm text-neutral-400 mt-0.5">
            Total cobrado: <span className="font-semibold text-emerald-600">{fmt(totalCollected)} €</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/facturacion" className="text-sm text-neutral-500 hover:text-neutral-700 transition-colors">
            ← Volver
          </Link>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors"
            style={{ backgroundColor: "var(--color-primary, #4F46E5)" }}
          >
            + Registrar cobro
          </button>
        </div>
      </div>

      {/* Formulario nuevo cobro */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-white border border-neutral-200 rounded-xl p-5 mb-5 grid grid-cols-2 gap-4"
        >
          <div className="col-span-2">
            <h2 className="text-sm font-semibold text-neutral-700 mb-3">Registrar cobro</h2>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-500">ID de factura *</label>
            <input
              required
              value={form.invoiceId}
              onChange={(e) => setForm((f) => ({ ...f, invoiceId: e.target.value }))}
              placeholder="UUID de la factura"
              className="border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-neutral-400"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-500">Importe (€) *</label>
            <input
              required
              type="number"
              min="0.01"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              placeholder="0.00"
              className="border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-neutral-400"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-500">Método de pago</label>
            <select
              value={form.method}
              onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}
              className="border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-neutral-400 bg-white"
            >
              {Object.entries(METHOD_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-500">Fecha de pago</label>
            <input
              type="datetime-local"
              value={form.paidAt}
              onChange={(e) => setForm((f) => ({ ...f, paidAt: e.target.value }))}
              className="border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-neutral-400"
            />
          </div>
          {formError && (
            <div className="col-span-2 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{formError}</div>
          )}
          <div className="col-span-2 flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-sm text-neutral-500 hover:text-neutral-700 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: "var(--color-primary, #4F46E5)" }}
            >
              {saving ? "Guardando..." : "Registrar"}
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600">{error}</div>
      )}

      {/* Tabla de cobros */}
      <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-100">
              <th className="text-left px-4 py-3 text-xs font-medium text-neutral-400 uppercase tracking-wide">Factura</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-neutral-400 uppercase tracking-wide">Método</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-neutral-400 uppercase tracking-wide">Fecha</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-neutral-400 uppercase tracking-wide">Estado</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-neutral-400 uppercase tracking-wide">Importe</th>
            </tr>
          </thead>
          <tbody>
            {loading && payments.length === 0 && (
              <tr><td colSpan={5} className="text-center py-12 text-sm text-neutral-400">Cargando...</td></tr>
            )}
            {!loading && payments.length === 0 && (
              <tr><td colSpan={5} className="text-center py-12 text-sm text-neutral-400">Sin cobros registrados</td></tr>
            )}
            {payments.map((p) => (
              <tr key={p.id} className="border-b border-neutral-50 hover:bg-neutral-50/50 transition-colors">
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
                <td className="px-4 py-3 text-right font-semibold text-neutral-800">{fmt(p.amount)} €</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
