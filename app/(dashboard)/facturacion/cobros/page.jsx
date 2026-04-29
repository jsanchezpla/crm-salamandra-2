"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import StatusBadge from "../_components/StatusBadge.jsx";
import { fmtMoney, fmtDate } from "../_components/Kpi.jsx";
import { useSortState, SortableTh } from "../_components/tableSort.jsx";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

const METHOD_LABELS = {
  card: "Tarjeta",
  transfer: "Transferencia",
  cash: "Efectivo",
  direct_debit: "Domiciliación",
};

export default function CobrosPage() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [me, setMe] = useState(null);
  const isAdmin = me?.role === "admin" || me?.role === "superadmin";

  const [unpaidInvoices, setUnpaidInvoices] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ invoiceId: "", amount: "", method: "transfer", paidAt: new Date().toISOString().slice(0, 10), notes: "" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filterMethod, setFilterMethod] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const { sortKey, sortDir, toggle: toggleSort } = useSortState("paidAt", "desc");

  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).then((j) => j.ok && setMe(j.data)).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const params = new URLSearchParams({ limit: 100, sortBy: sortKey, sortDir });
      if (filterMethod) params.set("method", filterMethod);
      if (filterStatus) params.set("status", filterStatus);
      const res = await fetch(`/api/billing/payments?${params}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error");
      setPayments(json.data?.payments ?? []);
    } catch (e) {
      setErrorMsg(e.message);
    } finally { setLoading(false); }
  }, [sortKey, sortDir, filterMethod, filterStatus]);

  useEffect(() => { load(); }, [load]);

  // Cargar facturas pendientes para el selector
  useEffect(() => {
    if (!showForm) return;
    Promise.all([
      fetch("/api/billing/invoices?status=issued&limit=100", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/billing/invoices?status=sent&limit=100", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/billing/invoices?status=partially_paid&limit=100", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/billing/invoices?status=overdue&limit=100", { cache: "no-store" }).then((r) => r.json()),
    ]).then((results) => {
      const merged = [];
      for (const r of results) merged.push(...(r.data?.invoices ?? []));
      // Ordenar por fecha desc
      merged.sort((a, b) => (b.issueDate || "").localeCompare(a.issueDate || ""));
      setUnpaidInvoices(merged);
    }).catch(() => {});
  }, [showForm]);

  // method y status se filtran en backend; aquí solo búsqueda libre por texto
  const filtered = useMemo(() => {
    if (!search) return payments;
    return payments.filter((p) => {
      const hay = [
        p.invoice?.number,
        METHOD_LABELS[p.method] ?? p.method,
        p.notes,
        p.amount?.toString(),
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(search);
    });
  }, [payments, search]);

  const totalCollected = useMemo(
    () => filtered.filter((p) => p.status === "completed").reduce((s, p) => s + Number(p.amount || 0), 0),
    [filtered]
  );

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      if (!form.invoiceId) throw new Error("Selecciona una factura");
      const res = await fetch("/api/billing/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId: form.invoiceId,
          amount: Number(form.amount),
          method: form.method,
          paidAt: form.paidAt,
          notes: form.notes || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error");
      setForm({ invoiceId: "", amount: "", method: "transfer", paidAt: new Date().toISOString().slice(0, 10), notes: "" });
      setShowForm(false);
      load();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function selectInvoice(invId) {
    const inv = unpaidInvoices.find((i) => i.id === invId);
    if (!inv) return;
    const remaining = Math.max(0, Number(inv.total) - Number(inv.paidAmount || 0));
    setForm((f) => ({ ...f, invoiceId: invId, amount: remaining.toFixed(2) }));
  }

  return (
    <div className="p-4 lg:p-8 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
        <div>
          <div className="eyebrow">Finanzas · Tesorería</div>
          <h1 className="font-display text-2xl text-[var(--ink-900)] mt-1">Cobros</h1>
          <p className="text-xs text-neutral-400 mt-1">
            Total cobrado: <span className="font-semibold text-emerald-700 tabular">{fmtMoney(totalCollected)}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Link href="/facturacion" className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">← Volver</Link>
          {isAdmin && (
            <button
              onClick={() => setShowForm(true)}
              className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white"
              style={{ background: "var(--color-primary, #1B3A2D)" }}
            >+ Registrar cobro</button>
          )}
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Buscar por nº factura, método, notas..."
          className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition w-full sm:w-72"
        />
        <select value={filterMethod} onChange={(e) => setFilterMethod(e.target.value)}
          className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400">
          <option value="">Todos los métodos</option>
          {Object.entries(METHOD_LABELS).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400">
          <option value="">Todos los estados</option>
          <option value="completed">Completado</option>
          <option value="pending">Pendiente</option>
          <option value="failed">Fallido</option>
          <option value="refunded">Reembolsado</option>
        </select>
        {(searchInput || filterMethod || filterStatus) && (
          <button onClick={() => { setSearchInput(""); setFilterMethod(""); setFilterStatus(""); }}
            className="text-xs text-neutral-400 hover:text-neutral-600 px-2 py-1.5 transition-colors">Limpiar</button>
        )}
      </div>

      {errorMsg && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{errorMsg}</div>
      )}

      <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="border-b border-neutral-100">
                <SortableTh k="invoice.number" label="Factura" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh k="method" label="Método" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh k="paidAt" label="Fecha" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh k="status" label="Estado" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh k="amount" label="Importe" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {loading && filtered.length === 0 && (
                <tr><td colSpan={5} className="text-center py-12 text-xs text-neutral-400">Cargando...</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={5} className="text-center py-12 text-xs text-neutral-400">Sin cobros{(search || filterMethod || filterStatus) ? " que coincidan con los filtros" : " registrados"}</td></tr>
              )}
              {filtered.map((p) => (
                <tr key={p.id} className="border-b border-neutral-50 hover:bg-neutral-50/70 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-neutral-500">{p.invoice?.number ?? "—"}</td>
                  <td className="px-4 py-3 text-neutral-600 text-xs">{METHOD_LABELS[p.method] ?? p.method}</td>
                  <td className="px-4 py-3 text-neutral-500 text-xs">{fmtDate(p.paidAt)}</td>
                  <td className="px-4 py-3"><StatusBadge status={p.status} kind="payment" /></td>
                  <td className="px-4 py-3 text-right font-semibold text-neutral-900 tabular">{fmtMoney(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* DRAWER */}
      {showForm && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setShowForm(false)} />
          <aside className="fixed top-14 lg:top-0 right-0 bottom-0 w-full sm:w-[480px] bg-white z-50 shadow-pop overflow-y-auto ink-scroll slide-right">
            <div className="px-6 pt-6 pb-4 border-b border-neutral-100 flex items-start justify-between gap-3">
              <div>
                <div className="eyebrow">Registrar</div>
                <h2 className="font-display text-xl text-neutral-900 mt-1">Nuevo cobro</h2>
              </div>
              <button onClick={() => setShowForm(false)} className="text-neutral-300 hover:text-neutral-700 transition-colors p-1">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleCreate} className="px-6 py-5 space-y-3">
              <FormRow label="Factura *">
                <select required value={form.invoiceId} onChange={(e) => selectInvoice(e.target.value)} className={inputCls}>
                  <option value="">Selecciona factura pendiente...</option>
                  {unpaidInvoices.map((i) => {
                    const remaining = Math.max(0, Number(i.total) - Number(i.paidAmount || 0));
                    return (
                      <option key={i.id} value={i.id}>
                        {i.number} · {i.client?.name ?? "?"} · pendiente {fmtMoney(remaining)}
                      </option>
                    );
                  })}
                </select>
              </FormRow>
              <FormRow label="Importe (€) *">
                <input required type="number" min="0.01" step="0.01" value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className={inputCls} />
              </FormRow>
              <FormRow label="Método de pago">
                <select value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))} className={inputCls}>
                  {Object.entries(METHOD_LABELS).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
                </select>
              </FormRow>
              <FormRow label="Fecha *">
                <input required type="date" value={form.paidAt} onChange={(e) => setForm((f) => ({ ...f, paidAt: e.target.value }))} className={inputCls} />
              </FormRow>
              <FormRow label="Notas">
                <textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className={inputCls + " resize-y"} />
              </FormRow>

              {formError && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{formError}</div>
              )}

              <div className="flex gap-2 justify-end pt-3 border-t border-neutral-100">
                <button type="button" onClick={() => setShowForm(false)}
                  className="px-4 py-2 text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">Cancelar</button>
                <button type="submit" disabled={saving}
                  className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-50 transition"
                  style={{ background: "var(--color-primary, #1B3A2D)" }}>{saving ? "Guardando..." : "Registrar"}</button>
              </div>
            </form>
          </aside>
        </>
      )}
    </div>
  );
}

function FormRow({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">{label}</label>
      {children}
    </div>
  );
}
