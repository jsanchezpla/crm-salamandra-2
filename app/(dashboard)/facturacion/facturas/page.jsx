"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import StatusBadge, { INVOICE_STATUS_LABELS } from "../_components/StatusBadge.jsx";
import { fmtMoney, fmtDate } from "../_components/Kpi.jsx";
import { useSortState, SortableTh } from "../_components/tableSort.jsx";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

const EMPTY_LINE = { description: "", quantity: 1, unitPrice: 0, discountPct: 0, vatRate: 21, outboundProductId: "", kind: "" };

function addDaysIso(isoDate, days) {
  if (!isoDate || !Number.isFinite(days) || days <= 0) return "";
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function emptyForm(defaultVat = 21, termsDays = 30, defaultIrpf = 15) {
  const issueDate = new Date().toISOString().slice(0, 10);
  return {
    clientId: "",
    employeeId: "",
    partnerId: "",
    issueDate,
    dueDate: addDaysIso(issueDate, termsDays),
    series: "F",
    irpfRate: defaultIrpf,
    notes: "",
    lines: [{ ...EMPTY_LINE, vatRate: defaultVat }],
  };
}

function calcLine(line) {
  const q = Number(line.quantity ?? 0);
  const p = Number(line.unitPrice ?? 0);
  const d = Number(line.discountPct ?? 0);
  const v = Number(line.vatRate ?? 0);
  const base = Math.round(q * p * (1 - d / 100) * 100) / 100;
  const vat = Math.round(base * (v / 100) * 100) / 100;
  const total = Math.round((base + vat) * 100) / 100;
  return { base, vat, total };
}

export default function FacturasPage() {
  const [invoices, setInvoices] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const [filterStatus, setFilterStatus] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const limit = 20;
  const { sortKey, sortDir, toggle: toggleSort } = useSortState("issueDate", "desc");

  // Datos auxiliares
  const [clients, setClients] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [series, setSeries] = useState([]);
  const [settings, setSettings] = useState(null);
  const [outboundCatalog, setOutboundCatalog] = useState([]);
  const [me, setMe] = useState(null);
  const isAdmin = me?.role === "admin" || me?.role === "superadmin";

  // Drawer / detalle
  const [openInvoice, setOpenInvoice] = useState(null); // factura abierta
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => emptyForm(21, 30));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  // Debounce búsqueda
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Carga inicial
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).then((j) => j.ok && setMe(j.data)).catch(() => {});
    fetch("/api/clients?limit=200", { cache: "no-store" }).then((r) => r.json()).then((j) => setClients(j.data?.clients ?? [])).catch(() => {});
    fetch("/api/team?status=all&limit=200", { cache: "no-store" }).then((r) => r.json()).then((j) => setEmployees(j.data?.members ?? [])).catch(() => {});
    fetch("/api/billing/series", { cache: "no-store" }).then((r) => r.json()).then((j) => setSeries(j.data ?? [])).catch(() => {});
    fetch("/api/billing/settings", { cache: "no-store" }).then((r) => r.json()).then((j) => setSettings(j.data)).catch(() => {});
    // Catálogo de productos salientes para vincular líneas de factura al inventario.
    // Si el tenant no tiene el módulo activo, el endpoint responde 403 y dejamos vacío.
    fetch("/api/inventory/outbound?limit=500", { cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((j) => { if (j?.ok) setOutboundCatalog(j.data?.products ?? []); })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const params = new URLSearchParams({ page, limit, sortBy: sortKey, sortDir });
      if (filterStatus) params.set("status", filterStatus);
      if (search) params.set("q", search);
      const res = await fetch(`/api/billing/invoices?${params}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error");
      setInvoices(json.data?.invoices ?? []);
      setTotal(json.data?.total ?? 0);
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setLoading(false);
    }
  }, [filterStatus, search, page, sortKey, sortDir]);

  useEffect(() => { load(); }, [load]);

  function closePanel() {
    setOpenInvoice(null);
    setShowCreate(false);
    setEditing(false);
    setFormError(null);
  }
  function openCreate() {
    setOpenInvoice(null);
    setForm(emptyForm(
      settings?.defaultVatRate ?? 21,
      Number(settings?.defaultPaymentTermsDays ?? 30),
      Number(settings?.defaultIrpfRate ?? 15)
    ));
    setShowCreate(true);
    setEditing(true);
    setFormError(null);
  }
  function openDetail(inv) {
    setShowCreate(false);
    setOpenInvoice(inv);
    setEditing(false);
  }
  function startEdit() {
    if (!openInvoice) return;
    setForm({
      clientId: openInvoice.clientId ?? "",
      employeeId: openInvoice.employeeId ?? "",
      partnerId: openInvoice.partnerId ?? "",
      irpfRate: openInvoice.irpfRate ?? settings?.defaultIrpfRate ?? 15,
      issueDate: openInvoice.issueDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
      dueDate: openInvoice.dueDate?.slice(0, 10) ?? "",
      series: openInvoice.series ?? "F",
      notes: openInvoice.notes ?? "",
      lines: (openInvoice.lines ?? []).map((l) => ({
        description: l.description ?? "",
        quantity: l.quantity ?? 0,
        unitPrice: l.unitPrice ?? 0,
        discountPct: l.discountPct ?? 0,
        vatRate: l.vatRate ?? settings?.defaultVatRate ?? 21,
        outboundProductId: l.outboundProductId ?? "",
        kind: l.kind ?? "",
      })),
    });
    setEditing(true);
  }

  function setLine(idx, key, value) {
    setForm((f) => {
      const lines = [...f.lines];
      lines[idx] = { ...lines[idx], [key]: value };
      return { ...f, lines };
    });
  }
  function addLine() {
    setForm((f) => ({ ...f, lines: [...f.lines, { ...EMPTY_LINE, vatRate: settings?.defaultVatRate ?? 21 }] }));
  }
  function removeLine(idx) {
    setForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }));
  }

  const formTotals = useMemo(() => {
    const breakdown = new Map();
    let base = 0, vat = 0;
    for (const l of form.lines) {
      const c = calcLine(l);
      base += c.base; vat += c.vat;
      const key = String(Number(l.vatRate));
      const acc = breakdown.get(key) ?? { base: 0, vat: 0 };
      acc.base += c.base; acc.vat += c.vat;
      breakdown.set(key, acc);
    }
    base = Math.round(base * 100) / 100;
    vat = Math.round(vat * 100) / 100;
    const irpf = Math.round(base * (Number(form.irpfRate || 0) / 100) * 100) / 100;
    return { base, vat, irpf, total: Math.round((base + vat - irpf) * 100) / 100, breakdown: [...breakdown.entries()].sort((a,b) => Number(b[0]) - Number(a[0])) };
  }, [form.lines, form.irpfRate]);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      if (!form.clientId) throw new Error("Selecciona un cliente");
      if (!form.lines.length) throw new Error("Añade al menos una línea");

      const payload = {
        clientId: form.clientId,
        employeeId: form.employeeId || null,
        partnerId: form.partnerId || null,
        issueDate: form.issueDate,
        dueDate: form.dueDate || null,
        series: form.series,
        irpfRate: Number(form.irpfRate || 0),
        notes: form.notes || null,
        lines: form.lines.map((l) => ({
          description: l.description,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          discountPct: Number(l.discountPct),
          vatRate: Number(l.vatRate),
          outboundProductId: l.outboundProductId || null,
          kind: l.kind || null,
        })),
      };

      const url = openInvoice ? `/api/billing/invoices/${openInvoice.id}` : "/api/billing/invoices";
      const method = openInvoice ? "PATCH" : "POST";
      const res = await fetch(url, {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error");

      if (openInvoice) {
        setOpenInvoice(json.data);
        setEditing(false);
      } else {
        closePanel();
      }
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function performAction(action) {
    if (!openInvoice) return;
    if (action === "delete" && !confirm("¿Eliminar este borrador?")) return;
    if (action === "cancel" && !confirm("¿Cancelar la factura? Solo permitido sin cobros.")) return;
    if (action === "rectify" && !confirm("¿Emitir rectificativa? La factura original quedará marcada como rectificada.")) return;
    setSaving(true);
    try {
      let res;
      if (action === "delete") {
        res = await fetch(`/api/billing/invoices/${openInvoice.id}`, { method: "DELETE" });
        if (res.status !== 204) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || "Error");
        }
        closePanel();
      } else {
        res = await fetch(`/api/billing/invoices/${openInvoice.id}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || "Error");
        if (action === "rectify") {
          // La rectificativa pasa a ser la "abierta" para que el usuario la vea
          setOpenInvoice(j.data);
        } else {
          setOpenInvoice(j.data);
        }
      }
      await load();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
        <div>
          <div className="eyebrow">Finanzas · Documentos</div>
          <h1 className="font-display text-2xl text-[var(--ink-900)] mt-1">Facturas</h1>
          <p className="text-xs text-neutral-400 mt-1">{total} {total === 1 ? "factura" : "facturas"}</p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Link href="/facturacion" className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">← Volver</Link>
          {isAdmin && (
            <button
              onClick={openCreate}
              className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white"
              style={{ background: "var(--color-primary, #1B3A2D)" }}
            >+ Nueva factura</button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={searchInput}
          onChange={(e) => { setSearchInput(e.target.value); setPage(1); }}
          placeholder="Buscar por número o cliente..."
          className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition w-full sm:w-72"
        />
        <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
          className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition">
          <option value="">Todos los estados</option>
          {Object.entries(INVOICE_STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        {(filterStatus || searchInput) && (
          <button onClick={() => { setSearchInput(""); setFilterStatus(""); setPage(1); }}
            className="text-xs text-neutral-400 hover:text-neutral-600 px-2 py-1.5 transition-colors">Limpiar</button>
        )}
      </div>

      {errorMsg && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{errorMsg}</div>
      )}

      {/* Tabla */}
      <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="border-b border-neutral-100">
                <SortableTh k="number" label="Nº" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh k="client.name" label="Cliente" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh k="employee.displayName" label="Empleado" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh k="issueDate" label="Fecha" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh k="status" label="Estado" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh k="taxBase" label="Base" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                <SortableTh k="total" label="Total" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                <SortableTh k="paidAmount" label="Cobrado" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {loading && invoices.length === 0 && (
                <tr><td colSpan={8} className="text-center py-12 text-xs text-neutral-400">Cargando...</td></tr>
              )}
              {!loading && invoices.length === 0 && (
                <tr><td colSpan={8} className="text-center py-12 text-xs text-neutral-400">Sin facturas</td></tr>
              )}
              {invoices.map((inv) => (
                <tr key={inv.id} onClick={() => openDetail(inv)} className="border-b border-neutral-50 hover:bg-neutral-50/70 transition-colors cursor-pointer">
                  <td className="px-4 py-3 font-mono text-xs text-neutral-500">{inv.status === "draft" ? <span className="italic text-neutral-400">borrador</span> : inv.number}</td>
                  <td className="px-4 py-3 text-neutral-800">{inv.client?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-neutral-500 text-xs">{inv.employee?.displayName ?? "—"}</td>
                  <td className="px-4 py-3 text-neutral-500 text-xs">{fmtDate(inv.issueDate)}</td>
                  <td className="px-4 py-3"><StatusBadge status={inv.status} /></td>
                  <td className="px-4 py-3 text-right text-neutral-700 tabular">{fmtMoney(inv.taxBase)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-neutral-900 tabular">{fmtMoney(inv.total)}</td>
                  <td className="px-4 py-3 text-right text-emerald-700 tabular">{fmtMoney(inv.paidAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {total > limit && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-neutral-100">
            <span className="text-xs text-neutral-400">Página {page} de {Math.ceil(total / limit)}</span>
            <div className="flex gap-1">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 text-xs border border-neutral-200 text-neutral-500 rounded-md hover:bg-neutral-50 disabled:opacity-40">Anterior</button>
              <button onClick={() => setPage((p) => Math.min(Math.ceil(total / limit), p + 1))} disabled={page >= Math.ceil(total / limit)}
                className="px-3 py-1.5 text-xs border border-neutral-200 text-neutral-500 rounded-md hover:bg-neutral-50 disabled:opacity-40">Siguiente</button>
            </div>
          </div>
        )}
      </div>

      {/* DRAWER */}
      {(openInvoice || showCreate) && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={closePanel} />
          <aside className="fixed top-14 lg:top-0 right-0 bottom-0 w-full sm:w-[640px] bg-white z-50 shadow-pop overflow-y-auto ink-scroll slide-right">
            <div className="px-6 pt-6 pb-4 border-b border-neutral-100 flex items-start justify-between gap-3 sticky top-0 bg-white z-10">
              <div className="min-w-0">
                <div className="eyebrow">{showCreate ? "Nueva" : (openInvoice?.status === "draft" ? "Borrador" : openInvoice?.number)}</div>
                <h2 className="font-display text-xl text-neutral-900 mt-1 truncate">
                  {showCreate ? "Nueva factura" : openInvoice?.client?.name ?? "Factura"}
                </h2>
                {openInvoice && !showCreate && (
                  <div className="flex items-center gap-2 mt-2">
                    <StatusBadge status={openInvoice.status} />
                    <span className="text-xs text-neutral-400 tabular">{fmtMoney(openInvoice.total)}</span>
                  </div>
                )}
              </div>
              <button onClick={closePanel} className="text-neutral-300 hover:text-neutral-700 transition-colors p-1">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-5">
              {/* MODO DETALLE (no edición) */}
              {!editing && openInvoice && (
                <DetailView invoice={openInvoice} isAdmin={isAdmin} onAction={performAction} onEdit={startEdit} saving={saving} />
              )}

              {/* MODO EDICIÓN o CREAR */}
              {editing && (
                <form onSubmit={handleSubmit} className="space-y-4">
                  {(() => {
                    const sel = clients.find((c) => c.id === form.clientId);
                    if (!sel) return null;
                    const missing = [];
                    if (!sel.fiscalName) missing.push("razón social");
                    if (!sel.taxId) missing.push("NIF/CIF");
                    if (missing.length === 0) return null;
                    return (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 flex items-start gap-2">
                        <svg className="w-4 h-4 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                        </svg>
                        <div className="flex-1">
                          <div className="font-semibold">Datos fiscales incompletos</div>
                          <div className="text-amber-800 mt-0.5">
                            Falta {missing.join(" y ")}. Edita la ficha del cliente antes de <strong>emitir</strong> la factura
                            (puedes guardar como borrador, pero no emitir).
                          </div>
                          <a href={`/clientes/${sel.id}`} target="_blank" rel="noreferrer"
                            className="inline-block mt-1.5 text-amber-900 underline font-semibold">
                            Editar cliente →
                          </a>
                        </div>
                      </div>
                    );
                  })()}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <FormRow label="Cliente *">
                      <select required value={form.clientId} onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))} className={inputCls}>
                        <option value="">Selecciona...</option>
                        {clients.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.fiscalName || c.name}{!c.taxId ? "  ⚠" : ""}
                          </option>
                        ))}
                      </select>
                    </FormRow>
                    <FormRow label="Empleado">
                      <select value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))} className={inputCls}>
                        <option value="">Sin asignar</option>
                        {employees.map((m) => (
                          <option key={m.id} value={m.id}>{m.displayName}</option>
                        ))}
                      </select>
                    </FormRow>
                    <FormRow label="Socio (quién factura)">
                      <select value={form.partnerId} onChange={(e) => setForm((f) => ({ ...f, partnerId: e.target.value }))} className={inputCls}>
                        <option value="">Sin asignar</option>
                        {(settings?.partners ?? []).map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </FormRow>
                    <FormRow label="IRPF % (retención sobre base)">
                      <input type="number" min="0" max="47" step="0.01" value={form.irpfRate}
                        onChange={(e) => setForm((f) => ({ ...f, irpfRate: e.target.value }))} className={inputCls} />
                    </FormRow>
                    <FormRow label="Fecha emisión *">
                      <input required type="date" value={form.issueDate} onChange={(e) => setForm((f) => ({ ...f, issueDate: e.target.value }))} className={inputCls} />
                    </FormRow>
                    <FormRow label="Vencimiento">
                      <input type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} className={inputCls} />
                    </FormRow>
                    <FormRow label="Serie">
                      <select value={form.series} onChange={(e) => setForm((f) => ({ ...f, series: e.target.value }))} className={inputCls}>
                        {series.filter((s) => s.kind !== "rectificative").map((s) => (
                          <option key={s.id} value={s.code}>{s.code} — {s.name}</option>
                        ))}
                      </select>
                    </FormRow>
                  </div>

                  {/* Líneas */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="eyebrow">Líneas</h3>
                      <button type="button" onClick={addLine} className="text-xs font-semibold text-[var(--color-primary,#1B3A2D)] hover:underline">+ Añadir línea</button>
                    </div>
                    <div className="space-y-2">
                      {form.lines.map((l, idx) => {
                        const c = calcLine(l);
                        return (
                          <div key={idx} className="bg-neutral-50/70 border border-neutral-100 rounded-lg p-3 space-y-2">
                            <div className="flex items-start gap-2">
                              <input value={l.description} placeholder="Concepto" onChange={(e) => setLine(idx, "description", e.target.value)} className={inputCls} />
                              {form.lines.length > 1 && (
                                <button type="button" onClick={() => removeLine(idx)} className="shrink-0 text-neutral-300 hover:text-red-500 transition-colors px-2">
                                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              )}
                            </div>
                            {outboundCatalog.length > 0 && (
                              <div className="flex items-center gap-2">
                                <select
                                  value={l.kind === "shipping" ? "" : (l.outboundProductId || "")}
                                  disabled={l.kind === "shipping"}
                                  onChange={(e) => {
                                    const productId = e.target.value;
                                    const product = outboundCatalog.find((p) => p.id === productId);
                                    setForm((f) => {
                                      const lines = [...f.lines];
                                      const next = { ...lines[idx], outboundProductId: productId };
                                      if (product) {
                                        if (!lines[idx].description?.trim()) next.description = product.name;
                                        if (product.defaultSalePrice && (!lines[idx].unitPrice || Number(lines[idx].unitPrice) === 0)) {
                                          next.unitPrice = product.defaultSalePrice;
                                        }
                                      }
                                      lines[idx] = next;
                                      return { ...f, lines };
                                    });
                                  }}
                                  className={inputCls + " text-xs flex-1"}
                                >
                                  <option value="">— Línea sin producto del inventario —</option>
                                  {outboundCatalog.map((p) => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                  ))}
                                </select>
                                <label className="flex items-center gap-1 text-[11px] text-neutral-500 shrink-0 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={l.kind === "shipping"}
                                    onChange={(e) => {
                                      const checked = e.target.checked;
                                      setForm((f) => {
                                        const lines = [...f.lines];
                                        lines[idx] = checked
                                          ? { ...lines[idx], kind: "shipping", outboundProductId: "" }
                                          : { ...lines[idx], kind: "" };
                                        return { ...f, lines };
                                      });
                                    }}
                                  />
                                  Transporte
                                </label>
                              </div>
                            )}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                              <FormRow label="Cantidad">
                                <input type="number" min="0" step="0.01" value={l.quantity} onChange={(e) => setLine(idx, "quantity", e.target.value)} className={inputCls} />
                              </FormRow>
                              <FormRow label="Precio">
                                <input type="number" min="0" step="0.01" value={l.unitPrice} onChange={(e) => setLine(idx, "unitPrice", e.target.value)} className={inputCls} />
                              </FormRow>
                              <FormRow label="Dto %">
                                <input type="number" min="0" max="100" step="0.01" value={l.discountPct} onChange={(e) => setLine(idx, "discountPct", e.target.value)} className={inputCls} />
                              </FormRow>
                              <FormRow label="IVA %">
                                <select value={l.vatRate} onChange={(e) => setLine(idx, "vatRate", e.target.value)} className={inputCls}>
                                  {(settings?.availableVatRates ?? [21, 10, 4, 0]).map((v) => (
                                    <option key={v} value={v}>{v}%</option>
                                  ))}
                                </select>
                              </FormRow>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-xs text-neutral-500 tabular pt-1 border-t border-neutral-100">
                              <div>Base: <span className="text-neutral-800 font-medium">{fmtMoney(c.base)}</span></div>
                              <div>IVA: <span className="text-neutral-800 font-medium">{fmtMoney(c.vat)}</span></div>
                              <div className="text-right">Total: <span className="text-neutral-900 font-bold">{fmtMoney(c.total)}</span></div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Totales formulario */}
                  <div className="bg-neutral-900 text-white rounded-lg p-4 space-y-1">
                    <div className="flex justify-between text-xs text-white/60"><span>Base imponible</span><span className="tabular">{fmtMoney(formTotals.base)}</span></div>
                    {formTotals.breakdown.map(([rate, agg]) => (
                      <div key={rate} className="flex justify-between text-xs text-white/60">
                        <span>IVA {rate}%</span>
                        <span className="tabular">{fmtMoney(agg.vat)}</span>
                      </div>
                    ))}
                    {formTotals.irpf > 0 && (
                      <div className="flex justify-between text-xs text-amber-300/80">
                        <span>IRPF −{Number(form.irpfRate)}%</span>
                        <span className="tabular">− {fmtMoney(formTotals.irpf)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-display text-base pt-2 border-t border-white/10 mt-2">
                      <span>Total</span><span className="tabular">{fmtMoney(formTotals.total)}</span>
                    </div>
                  </div>

                  <FormRow label="Notas">
                    <textarea rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className={inputCls + " resize-y"} />
                  </FormRow>

                  {formError && (
                    <div className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{formError}</div>
                  )}

                  <div className="flex gap-2 justify-end pt-3 border-t border-neutral-100">
                    <button type="button" onClick={() => openInvoice ? setEditing(false) : closePanel()}
                      className="px-4 py-2 text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">Cancelar</button>
                    <button type="submit" disabled={saving}
                      className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-50 transition"
                      style={{ background: "var(--color-primary, #1B3A2D)" }}>
                      {saving ? "Guardando..." : openInvoice ? "Guardar cambios" : "Guardar borrador"}
                    </button>
                  </div>
                </form>
              )}
            </div>
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

function DetailView({ invoice, isAdmin, onAction, onEdit, saving }) {
  const totalPaid = Number(invoice.paidAmount || 0);
  const remaining = Math.max(0, Number(invoice.total) - totalPaid);
  const lineBreakdown = (invoice.lines ?? []).reduce((map, l) => {
    const k = String(Number(l.vatRate ?? 0));
    const a = map.get(k) ?? { base: 0, vat: 0 };
    a.base += Number(l.lineBase ?? 0); a.vat += Number(l.lineVat ?? 0);
    map.set(k, a);
    return map;
  }, new Map());

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <DetailRow label="Cliente" value={invoice.client?.fiscalName || invoice.client?.name} />
        <DetailRow label="Empleado" value={invoice.employee?.displayName} />
        <DetailRow label="Socio" value={invoice.partnerId ? invoice.partnerId.charAt(0).toUpperCase() + invoice.partnerId.slice(1) : "—"} />
        <DetailRow label="Fecha emisión" value={fmtDate(invoice.issueDate)} />
        <DetailRow label="Vencimiento" value={fmtDate(invoice.dueDate)} />
        <DetailRow label="Serie" value={invoice.series} />
        <DetailRow label="Cobrado" value={`${fmtMoney(totalPaid)} / ${fmtMoney(invoice.total)}`} />
      </div>

      {invoice.rectifies && (
        <div className="px-3 py-2 rounded-lg bg-purple-50 border border-purple-100 text-xs text-purple-700">
          Rectificativa de <span className="font-mono">{invoice.rectifies.number}</span>
        </div>
      )}
      {invoice.rectifiedBy && (
        <div className="px-3 py-2 rounded-lg bg-purple-50 border border-purple-100 text-xs text-purple-700">
          Rectificada por <span className="font-mono">{invoice.rectifiedBy.number}</span>
        </div>
      )}
      {invoice.customFields?.sourceQuoteNumber && (
        <div className="px-3 py-2 rounded-lg bg-teal-50 border border-teal-100 text-xs text-teal-700">
          ↖ Origen: Presupuesto <span className="font-mono">{invoice.customFields.sourceQuoteNumber}</span>
        </div>
      )}

      <div>
        <h3 className="eyebrow mb-2">Líneas</h3>
        <div className="space-y-1">
          {(invoice.lines ?? []).map((l, i) => (
            <div key={i} className="flex items-center justify-between border-b border-neutral-50 py-2">
              <div className="min-w-0">
                <div className="text-sm text-neutral-800 truncate">{l.description}</div>
                <div className="text-[10px] text-neutral-400 tabular">
                  {Number(l.quantity)} × {fmtMoney(l.unitPrice)}
                  {Number(l.discountPct ?? 0) > 0 && ` · -${Number(l.discountPct)}%`}
                  {` · IVA ${Number(l.vatRate)}%`}
                </div>
              </div>
              <div className="text-sm text-neutral-900 font-medium tabular shrink-0 ml-3">{fmtMoney(l.lineTotal)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-neutral-900 text-white rounded-lg p-4 space-y-1">
        <div className="flex justify-between text-xs text-white/60"><span>Base imponible</span><span className="tabular">{fmtMoney(invoice.taxBase)}</span></div>
        {[...lineBreakdown.entries()].sort((a, b) => Number(b[0]) - Number(a[0])).map(([rate, agg]) => (
          <div key={rate} className="flex justify-between text-xs text-white/60">
            <span>IVA {rate}%</span>
            <span className="tabular">{fmtMoney(agg.vat)}</span>
          </div>
        ))}
        {Number(invoice.irpfAmount) > 0 && (
          <div className="flex justify-between text-xs text-amber-300/80">
            <span>IRPF −{Number(invoice.irpfRate)}%</span>
            <span className="tabular">− {fmtMoney(invoice.irpfAmount)}</span>
          </div>
        )}
        <div className="flex justify-between font-display text-base pt-2 border-t border-white/10 mt-2">
          <span>Total</span><span className="tabular">{fmtMoney(invoice.total)}</span>
        </div>
        {totalPaid > 0 && totalPaid < Number(invoice.total) && (
          <div className="flex justify-between text-xs text-amber-300 pt-1">
            <span>Pendiente</span><span className="tabular">{fmtMoney(remaining)}</span>
          </div>
        )}
      </div>

      {invoice.notes && (
        <div>
          <div className="eyebrow mb-1">Notas</div>
          <p className="text-sm text-neutral-700 whitespace-pre-wrap">{invoice.notes}</p>
        </div>
      )}

      {/* Cobros asociados */}
      {invoice.payments && invoice.payments.length > 0 && (
        <div>
          <h3 className="eyebrow mb-2">Cobros</h3>
          <ul className="text-xs text-neutral-600 space-y-1">
            {invoice.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between border-b border-neutral-50 py-1.5">
                <span>{fmtDate(p.paidAt)} · {p.method} · {p.status}</span>
                <span className="tabular font-medium">{fmtMoney(p.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Acciones */}
      {isAdmin && (() => {
        const fiscalMissing = [];
        if (!invoice.client?.fiscalName) fiscalMissing.push("razón social");
        if (!invoice.client?.taxId) fiscalMissing.push("NIF/CIF");
        const cantIssue = invoice.status === "draft" && fiscalMissing.length > 0;
        return (
        <div className="space-y-3 pt-4 border-t border-neutral-100">
          {cantIssue && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
              <strong>No se puede emitir:</strong> el cliente no tiene {fiscalMissing.join(" ni ")}.{" "}
              <a href={`/clientes/${invoice.clientId}`} target="_blank" rel="noreferrer" className="underline font-semibold">Editar cliente →</a>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
          {invoice.status === "draft" && (
            <>
              <button onClick={onEdit} disabled={saving}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-40"
                style={{ background: "var(--color-primary, #1B3A2D)" }}>Editar</button>
              <button onClick={() => onAction("issue")} disabled={saving || cantIssue}
                title={cantIssue ? "Cliente sin datos fiscales completos" : ""}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide bg-emerald-600 text-white disabled:opacity-40 disabled:cursor-not-allowed">Emitir</button>
              <button onClick={() => onAction("delete")} disabled={saving}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-40">Eliminar</button>
            </>
          )}
          {invoice.status === "issued" && (
            <button onClick={() => onAction("send")} disabled={saving}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide text-blue-700 border border-blue-200 hover:bg-blue-50 disabled:opacity-40">Marcar como enviada</button>
          )}
          {(invoice.status === "issued" || invoice.status === "sent") && Number(invoice.paidAmount || 0) === 0 && (
            <button onClick={() => onAction("cancel")} disabled={saving}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-40">Cancelar</button>
          )}
          {["issued", "sent", "paid", "partially_paid", "overdue"].includes(invoice.status) && !invoice.rectifiedByInvoiceId && (
            <button onClick={() => onAction("rectify")} disabled={saving}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide text-purple-700 border border-purple-200 hover:bg-purple-50 disabled:opacity-40">Rectificar</button>
          )}
          </div>
        </div>
        );
      })()}
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div>
      <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-0.5">{label}</div>
      <div className="text-sm text-neutral-700">{value || "—"}</div>
    </div>
  );
}
