"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import HelpTooltip from "../../../../components/ui/HelpTooltip.jsx";
import StatusBadge, { INVOICE_STATUS_LABELS } from "../_components/StatusBadge.jsx";
import { fmtMoney, fmtDate } from "../_components/Kpi.jsx";
import { useSortState, SortableTh } from "../_components/tableSort.jsx";
import Select from "@/components/ui/Select.jsx";
import SelectorCliente from "@/components/clients/SelectorCliente.jsx";

import { nifDeCliente } from "../../../../lib/billing/nifCliente.js";
import { anchoPantalla } from "@/components/layout/anchoPantalla.js";
const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

const EMPTY_LINE = { description: "", quantity: 1, unitPrice: 0, discountPct: 0, vatRate: 21, productId: "", kind: "" };

function addDaysIso(isoDate, days) {
  if (!isoDate || !Number.isFinite(days) || days <= 0) return "";
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function emptyForm(defaultVat = 21, termsDays = 30, defaultIrpf = 0) {
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
  // La ficha del pagador, tal y como la resuelve SelectorCliente: se usa para
  // avisar de que le faltan razón social o NIF antes de emitir.
  const [clienteElegido, setClienteElegido] = useState(null);
  // Alta rápida de cliente sin salir del editor.
  const [showNewClient, setShowNewClient] = useState(false);
  const [newClient, setNewClient] = useState({ name: "", taxId: "" });
  const [savingClient, setSavingClient] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [series, setSeries] = useState([]);
  const [settings, setSettings] = useState(null);
  const [outboundCatalog, setOutboundCatalog] = useState([]);
  const [me, setMe] = useState(null);
  /*
   * Facturar lo hace quien tiene el MÓDULO de Facturación, no solo quien manda
   * (14/08/2026, Rodrigo — la regla, en lib/auth/permisos.js). En Aumenta son
   * Olga y Rosa: rol `user`, y son las que llevan la contabilidad. Esto era
   * `me.role === "admin"` y las dejaba mirando la pantalla entera sin poder
   * pulsar un botón — ni siquiera apuntar un cobro.
   *
   * `Boolean(me)` y no `true`: mientras /api/auth/me va y viene no hay que
   * enseñar botones que a lo mejor luego se quitan.
   */
  const puedeFacturar = Boolean(me);

  // Drawer / detalle
  const [openInvoice, setOpenInvoice] = useState(null); // factura abierta
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => emptyForm(21, 30));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [rectifyOpen, setRectifyOpen] = useState(false); // modal de rectificación

  // Debounce búsqueda
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Carga inicial
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).then((j) => j.ok && setMe(j.data)).catch(() => {});
    // Las fichas ya no se bajan aquí: las pide SelectorCliente según se escribe.
    fetch("/api/team?status=all&limit=200", { cache: "no-store" }).then((r) => r.json()).then((j) => setEmployees(j.data?.members ?? [])).catch(() => {});
    fetch("/api/billing/series", { cache: "no-store" }).then((r) => r.json()).then((j) => setSeries(j.data ?? [])).catch(() => {});
    fetch("/api/billing/settings", { cache: "no-store" }).then((r) => r.json()).then((j) => setSettings(j.data)).catch(() => {});
    // Catálogo del almacén para vincular líneas de factura al inventario.
    // Si el tenant no tiene el módulo activo, el endpoint responde 403 y dejamos vacío.
    fetch("/api/inventory/products?limit=500", { cache: "no-store" })
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
  async function createClient() {
    const name = newClient.name.trim();
    if (!name) return;
    setSavingClient(true);
    setFormError(null);
    try {
      const r = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, taxId: newClient.taxId.trim() || null, type: "company" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo crear el cliente");
      const c = j.data;
      setClienteElegido(c);
      setForm((f) => ({ ...f, clientId: c.id }));
      setNewClient({ name: "", taxId: "" });
      setShowNewClient(false);
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSavingClient(false);
    }
  }
  function openCreate() {
    setOpenInvoice(null);
    setForm(emptyForm(
      settings?.defaultVatRate ?? 21,
      Number(settings?.defaultPaymentTermsDays ?? 30),
      Number(settings?.defaultIrpfRate ?? 0)
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
      irpfRate: openInvoice.irpfRate ?? settings?.defaultIrpfRate ?? 0,
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
        productId: l.productId ?? "",
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
          productId: l.productId || null,
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
    // Rectificar abre un modal con edición de importe (no es un POST directo).
    if (action === "rectify") { setRectifyOpen(true); return; }
    if (action === "delete" && !confirm("¿Eliminar este borrador?")) return;
    if (action === "cancel" && !confirm("¿Cancelar la factura? Solo permitido sin cobros.")) return;
    if (action === "send") {
      const destino = openInvoice.client?.email;
      const aviso = destino
        ? `Se enviará la factura por email a ${destino}, con el PDF adjunto. ¿Continuar?`
        : "El cliente no tiene email en su ficha: la factura se marcará como enviada, pero NO se mandará nada. ¿Continuar?";
      if (!confirm(aviso)) return;
    }
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
        setOpenInvoice(j.data);
        if (action === "send") {
          alert(
            j.data?.emailEnviado
              ? "Factura enviada por email con el PDF adjunto."
              : `Factura marcada como enviada, pero el correo NO salió: ${j.data?.emailError || "motivo desconocido"}.`
          );
        }
      }
      await load();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  // Abre una factura por id (re-fetch con includes: rectifies/rectifiedBy).
  async function openDetailById(id) {
    try {
      const res = await fetch(`/api/billing/invoices/${id}`, { cache: "no-store" });
      const j = await res.json();
      if (j.ok) { setShowCreate(false); setEditing(false); setOpenInvoice(j.data); }
    } catch {
      /* noop */
    }
  }

  // Envía la rectificativa. Lanza en error para que el modal lo muestre.
  async function submitRectify({ correctBase, reason, notes }) {
    if (!openInvoice) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/billing/invoices/${openInvoice.id}/rectify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ correctBase, reason, notes }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Error");
      setRectifyOpen(false);
      await load();
      await openDetailById(j.data.id); // muestra la rectificativa recién creada
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={anchoPantalla("listado")}>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
        <div>
          <div className="eyebrow">Finanzas · Documentos</div>
          <h1 className="font-display text-2xl text-[var(--ink-900)] mt-1 flex items-center gap-2">
            Facturas
            <HelpTooltip title="Facturas" placement="bottom">
              Emitir una factura no es cobrarla: <strong className="text-white">Emitida</strong> y{" "}
              <strong className="text-white">Enviada</strong> solo dicen que el documento existe y
              que salió. El dinero se apunta en Cobros y vuelve aquí, en la columna Cobrado.
              {" "}
              <strong className="text-white">Vencida</strong> no la marca nadie: aparece sola en
              cuanto pasa la fecha de vencimiento y sigue quedando dinero por cobrar.
            </HelpTooltip>
          </h1>
          <p className="text-xs text-neutral-400 mt-1">{total} {total === 1 ? "factura" : "facturas"}</p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Link href="/facturacion" className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">← Volver</Link>
          {puedeFacturar && (
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
        <Select
          value={filterStatus}
          onChange={(v) => { setFilterStatus(v); setPage(1); }}
          options={[
            { value: "", label: "Todos los estados" },
            ...Object.entries(INVOICE_STATUS_LABELS).map(([k, val]) => ({ value: k, label: val.label })),
          ]}
          className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition"
        />
        {(filterStatus || searchInput) && (
          <button onClick={() => { setSearchInput(""); setFilterStatus(""); setPage(1); }}
            className="text-xs text-neutral-400 hover:text-neutral-600 px-2 py-1.5 transition-colors">Limpiar</button>
        )}
      </div>

      {errorMsg && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{errorMsg}</div>
      )}

      {/* MÓVIL: tarjetas. Lo que importa de una factura en el móvil es cliente,
          total y si está cobrada; el resto se ve al abrirla. */}
      <div className="lg:hidden space-y-2">
        {loading && invoices.length === 0 && (
          <div className="bg-white border border-neutral-100 rounded-xl py-10 text-center text-xs text-neutral-400">Cargando...</div>
        )}
        {!loading && invoices.length === 0 && (
          <div className="bg-white border border-neutral-100 rounded-xl py-10 text-center text-xs text-neutral-400">Sin facturas</div>
        )}
        {invoices.map((inv) => (
          <button
            key={inv.id}
            onClick={() => openDetail(inv)}
            className="w-full text-left bg-white border border-neutral-100 rounded-xl p-3 active:bg-neutral-50 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium text-neutral-800 truncate">{inv.client?.name ?? "—"}</div>
                <div className="text-[11px] text-neutral-400 font-mono">
                  {inv.status === "draft" ? <span className="italic">borrador</span> : inv.number} · {fmtDate(inv.issueDate)}
                </div>
              </div>
              <StatusBadge status={inv.status} />
            </div>
            <div className="flex items-baseline justify-between gap-2 mt-2">
              <span className="text-lg font-semibold text-neutral-900 tabular">{fmtMoney(inv.total)}</span>
              {Number(inv.paidAmount) > 0 && (
                <span className="text-[11px] text-emerald-700 tabular">Cobrado {fmtMoney(inv.paidAmount)}</span>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* ESCRITORIO: tabla completa */}
      <div className="hidden lg:block bg-white border border-neutral-100 rounded-xl overflow-hidden">
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
                <DetailView invoice={openInvoice} puedeFacturar={puedeFacturar} onAction={performAction} onEdit={startEdit} onOpenLinked={openDetailById} saving={saving} />
              )}

              {/* MODO EDICIÓN o CREAR */}
              {editing && (
                <form onSubmit={handleSubmit} className="space-y-4">
                  {(() => {
                    // La ficha elegida la da SelectorCliente, que es quien la
                    // tiene: buscarla en una lista descargada era el fallo —
                    // una que no estuviera entre las 200 no avisaba de nada.
                    const sel = clienteElegido;
                    if (!sel || String(sel.id) !== String(form.clientId)) return null;
                    const missing = [];
                    if (!sel.fiscalName) missing.push("razón social");
                    if (!nifDeCliente(sel)) missing.push("NIF/CIF");
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
                    <FormRow label="Cliente (pagador) *">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <SelectorCliente
                            value={form.clientId}
                            onChange={(v) => setForm((f) => ({ ...f, clientId: v }))}
                            onFicha={setClienteElegido}
                            etiqueta={(c) => `${c.fiscalName || c.name}${!nifDeCliente(c) ? "  ⚠" : ""}`}
                            opcionesFijas={[{ value: "", label: "Selecciona..." }]}
                            className={inputCls}
                          />
                        </div>
                        <button type="button" onClick={() => setShowNewClient((v) => !v)} className="shrink-0 text-xs font-semibold text-[var(--color-primary,#1B3A2D)] hover:underline whitespace-nowrap">
                          + Nuevo
                        </button>
                      </div>
                      {showNewClient && (
                        <div className="mt-2 p-2.5 bg-neutral-50 border border-neutral-200 rounded-lg space-y-2">
                          <input placeholder="Nombre / razón social *" value={newClient.name} onChange={(e) => setNewClient((n) => ({ ...n, name: e.target.value }))} className={inputCls} />
                          <input placeholder="NIF / CIF (opcional)" value={newClient.taxId} onChange={(e) => setNewClient((n) => ({ ...n, taxId: e.target.value }))} className={inputCls} />
                          <div className="flex gap-2">
                            <button type="button" onClick={createClient} disabled={savingClient || !newClient.name.trim()} className="text-xs font-medium px-3 py-1.5 rounded-md bg-[var(--color-primary,#1B3A2D)] text-white disabled:opacity-40">
                              {savingClient ? "Creando…" : "Crear y seleccionar"}
                            </button>
                            <button type="button" onClick={() => setShowNewClient(false)} className="text-xs text-neutral-500">Cancelar</button>
                          </div>
                        </div>
                      )}
                    </FormRow>
                    {openInvoice?.patient && (
                      <FormRow label="Paciente">
                        <div className="text-sm text-neutral-700 px-1 py-1.5">
                          {openInvoice.patient.firstName} {openInvoice.patient.lastName}
                          <span className="block text-[10px] text-neutral-400">La factura es de este paciente; el pagador es el cliente de arriba (editable).</span>
                        </div>
                      </FormRow>
                    )}
                    <FormRow label="Empleado">
                      <Select
                        value={form.employeeId}
                        onChange={(v) => setForm((f) => ({ ...f, employeeId: v }))}
                        options={[
                          { value: "", label: "Sin asignar" },
                          ...employees.map((m) => ({ value: m.id, label: m.displayName })),
                        ]}
                        className={inputCls}
                      />
                    </FormRow>
                    <FormRow label="Socio (quién factura)">
                      <Select
                        value={form.partnerId}
                        onChange={(v) => setForm((f) => ({ ...f, partnerId: v }))}
                        options={[
                          { value: "", label: "Sin asignar" },
                          ...(settings?.partners ?? []).map((p) => ({ value: p.id, label: p.name })),
                        ]}
                        className={inputCls}
                      />
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
                      <Select
                        value={form.series}
                        onChange={(v) => setForm((f) => ({ ...f, series: v }))}
                        options={series.filter((s) => s.kind !== "rectificative").map((s) => ({ value: s.code, label: `${s.code} — ${s.name}` }))}
                        className={inputCls}
                      />
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
                                <Select
                                  value={l.kind === "shipping" ? "" : (l.productId || "")}
                                  disabled={l.kind === "shipping"}
                                  onChange={(v) => {
                                    const productId = v;
                                    const product = outboundCatalog.find((p) => p.id === productId);
                                    setForm((f) => {
                                      const lines = [...f.lines];
                                      const next = { ...lines[idx], productId: productId };
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
                                  options={[
                                    { value: "", label: "— Línea sin producto del inventario —" },
                                    ...outboundCatalog.map((p) => ({ value: p.id, label: p.name })),
                                  ]}
                                  className={inputCls + " text-xs flex-1"}
                                />
                                <label className="flex items-center gap-1 text-[11px] text-neutral-500 shrink-0 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={l.kind === "shipping"}
                                    onChange={(e) => {
                                      const checked = e.target.checked;
                                      setForm((f) => {
                                        const lines = [...f.lines];
                                        lines[idx] = checked
                                          ? { ...lines[idx], kind: "shipping", productId: "" }
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
                                <Select
                                  value={l.vatRate}
                                  onChange={(v) => setLine(idx, "vatRate", v)}
                                  options={(settings?.availableVatRates ?? [21, 10, 4, 0]).map((rate) => ({ value: rate, label: Number(rate) === 0 ? "Exento (0%)" : `${rate}%` }))}
                                  className={inputCls}
                                />
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

      {/* MODAL RECTIFICATIVA */}
      {rectifyOpen && openInvoice && (
        <RectifyModal
          invoice={openInvoice}
          saving={saving}
          onClose={() => setRectifyOpen(false)}
          onSubmit={submitRectify}
        />
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

function DetailView({ invoice, puedeFacturar, onAction, onEdit, onOpenLinked, saving }) {
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
        <DetailRow label="Cliente (pagador)" value={invoice.client?.fiscalName || invoice.client?.name} />
        {invoice.patient && (
          <DetailRow label="Paciente" value={`${invoice.patient.firstName} ${invoice.patient.lastName}`} />
        )}
        <DetailRow label="Empleado" value={invoice.employee?.displayName} />
        <DetailRow label="Socio" value={invoice.partnerId ? invoice.partnerId.charAt(0).toUpperCase() + invoice.partnerId.slice(1) : "—"} />
        <DetailRow label="Fecha emisión" value={fmtDate(invoice.issueDate)} />
        <DetailRow label="Vencimiento" value={fmtDate(invoice.dueDate)} />
        <DetailRow label="Serie" value={invoice.series} />
        <DetailRow label="Cobrado" value={`${fmtMoney(totalPaid)} / ${fmtMoney(invoice.total)}`} />
      </div>

      {invoice.rectifies && (
        <button type="button" onClick={() => onOpenLinked?.(invoice.rectifies.id)}
          className="w-full text-left px-3 py-2 rounded-lg bg-purple-50 border border-purple-100 text-xs text-purple-700 hover:bg-purple-100 transition">
          Rectificativa de <span className="font-mono underline">{invoice.rectifies.number}</span> →
        </button>
      )}
      {invoice.rectifiedBy && (
        <button type="button" onClick={() => onOpenLinked?.(invoice.rectifiedBy.id)}
          className="w-full text-left px-3 py-2 rounded-lg bg-purple-50 border border-purple-100 text-xs text-purple-700 hover:bg-purple-100 transition">
          Rectificada por <span className="font-mono underline">{invoice.rectifiedBy.number}</span> →
        </button>
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
        {Number(invoice.irpfAmount) !== 0 && (
          <div className="flex justify-between text-xs text-amber-300/80">
            <span>IRPF −{Number(invoice.irpfRate)}%</span>
            {/* Se resta del total: total = base + IVA − IRPF. En una rectificativa
                el irpfAmount es negativo, así que −(negativo) suma y el desglose cuadra. */}
            <span className="tabular">{fmtMoney(-Number(invoice.irpfAmount))}</span>
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

      {invoice.status !== "draft" && (
        <div className="pt-1">
          <a
            href={`/api/billing/invoices/${invoice.id}/pdf`}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide border border-neutral-300 text-neutral-700 hover:bg-neutral-50 transition"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Descargar PDF
          </a>
        </div>
      )}

      {/* Acciones */}
      {puedeFacturar && (() => {
        const fiscalMissing = [];
        if (!invoice.client?.fiscalName) fiscalMissing.push("razón social");
        // El mismo criterio que el candado del servidor: con dos columnas
        // en juego, si la pantalla mira una y el servidor la otra, el botón
        // sale deshabilitado en facturas que el servidor sí dejaría emitir.
        if (!nifDeCliente(invoice.client)) fiscalMissing.push("NIF/CIF");
        const cantIssue = invoice.status === "draft" && fiscalMissing.length > 0;
        return (
        <div className="space-y-3 pt-4 border-t border-neutral-100">
          <h3 className="eyebrow flex items-center gap-1.5">
            Acciones
            <HelpTooltip title="Emitir no tiene vuelta atrás" placement="top">
              Mientras es <strong className="text-white">borrador</strong> no tiene número y se
              puede cambiar o borrar. Al emitirla se le pone el número de la serie y ya no se toca:
              lo que esté mal se arregla con una rectificativa. Ojo con la fecha, tampoco puede ser
              anterior a la de la última factura emitida de esa serie.
            </HelpTooltip>
          </h3>
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
              title="Enviar la factura al cliente por email, con el PDF adjunto"
              aria-label="Enviar factura al cliente por email"
              className="px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide text-blue-700 border border-blue-200 hover:bg-blue-50 disabled:opacity-40">Enviar</button>
          )}
          {["issued", "sent", "paid", "partially_paid", "overdue"].includes(invoice.status) && !invoice.rectifiedByInvoiceId && !invoice.rectifiesInvoiceId && (
            <button onClick={() => onAction("rectify")} disabled={saving}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide text-purple-700 border border-purple-200 hover:bg-purple-50 disabled:opacity-40">Rectificar</button>
          )}
          {(invoice.status === "issued" || invoice.status === "sent") && Number(invoice.paidAmount || 0) === 0 && (
            <button onClick={() => onAction("cancel")} disabled={saving}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-40">Cancelar</button>
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

// ── Rectificativa con edición ──────────────────────────────────────────────
const CORRECTION_REASONS = [
  { value: "", label: "Sin especificar" },
  { value: "error_importe", label: "Error en el importe" },
  { value: "error_iva", label: "Error en el IVA" },
  { value: "error_datos", label: "Error en los datos" },
  { value: "descuento", label: "Descuento / rappel posterior" },
  { value: "devolucion", label: "Devolución de producto/servicio" },
  { value: "otros", label: "Otros" },
];

function r2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Espejo cliente del cálculo de rectify/route.js: factor k = correctBase /
 * baseOriginal; cada línea aporta base_línea × (k − 1) conservando su tipo de
 * IVA; el IRPF se recalcula proporcional. Solo para previsualización en vivo.
 */
function computeRectify(invoice, correctBaseInput) {
  const baseOriginal = r2(invoice.taxBase ?? 0);
  const raw = String(correctBaseInput).trim();
  if (raw === "") return { state: "empty", baseOriginal };
  const correctBase = Number(raw);
  if (!Number.isFinite(correctBase) || correctBase < 0) return { state: "invalid", baseOriginal };
  if (baseOriginal === 0) return { state: "no-base", baseOriginal };
  if (r2(correctBase) === baseOriginal) return { state: "no-change", baseOriginal };

  const factor = correctBase / baseOriginal;
  const isAnnul = r2(correctBase) === 0;
  const byRate = new Map();
  let deltaBase = 0;
  let deltaVat = 0;
  for (const l of invoice.lines ?? []) {
    const lb = Number(l.lineBase ?? 0);
    const db = r2(lb * (factor - 1));
    const rate = Number(l.vatRate ?? 0);
    const dv = r2(db * (rate / 100));
    deltaBase = r2(deltaBase + db);
    deltaVat = r2(deltaVat + dv);
    const acc = byRate.get(String(rate)) ?? { base: 0, vat: 0 };
    acc.base = r2(acc.base + db);
    acc.vat = r2(acc.vat + dv);
    byRate.set(String(rate), acc);
  }
  const irpfRate = Number(invoice.irpfRate ?? 0);
  const deltaIrpf = r2(deltaBase * (irpfRate / 100));
  const deltaTotal = r2(deltaBase + deltaVat - deltaIrpf);
  return {
    state: "ok",
    baseOriginal,
    correctBase: r2(correctBase),
    factor,
    isAnnul,
    irpfRate,
    deltaBase,
    deltaVat,
    deltaIrpf,
    deltaTotal,
    byRate: [...byRate.entries()].sort((a, b) => Number(b[0]) - Number(a[0])),
    resultingBase: r2(baseOriginal + deltaBase),
    resultingTotal: r2(Number(invoice.total ?? 0) + deltaTotal),
  };
}

function RectifyModal({ invoice, onClose, onSubmit, saving }) {
  const [correctBase, setCorrectBase] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState(null);

  const p = useMemo(() => computeRectify(invoice, correctBase), [invoice, correctBase]);
  const sign = (n) => (n > 0 ? "+" : n < 0 ? "" : "") + fmtMoney(n);

  async function submit() {
    setError(null);
    if (p.state === "empty" || p.state === "invalid") return setError("Introduce una base correcta válida.");
    if (p.state === "no-change") return setError("El importe correcto coincide con la base actual.");
    if (p.state === "no-base") return setError("La factura original no tiene base imponible.");
    try {
      await onSubmit({ correctBase: p.correctBase, reason: reason || null, notes: notes || null });
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[60]" onClick={saving ? undefined : onClose} />
      <div className="fixed inset-0 z-[60] flex items-start sm:items-center justify-center p-4 overflow-y-auto pointer-events-none">
        <div className="pointer-events-auto w-full max-w-md bg-white rounded-2xl shadow-pop my-8">
          <div className="px-6 pt-5 pb-4 border-b border-neutral-100 flex items-center justify-between">
            <div>
              <div className="eyebrow">Rectificar factura</div>
              <h3 className="font-display text-lg text-neutral-900 mt-0.5">{invoice.number}</h3>
            </div>
            <button onClick={onClose} disabled={saving} className="text-neutral-300 hover:text-neutral-700 p-1 disabled:opacity-40">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          <div className="px-6 py-5 space-y-4">
            <div className="rounded-lg bg-neutral-50 border border-neutral-100 p-3 text-xs space-y-1">
              <div className="flex justify-between text-neutral-500"><span>Base actual</span><span className="tabular text-neutral-800 font-medium">{fmtMoney(p.baseOriginal)}</span></div>
              <div className="flex justify-between text-neutral-500"><span>Total actual</span><span className="tabular text-neutral-800 font-medium">{fmtMoney(invoice.total)}</span></div>
              {Number(invoice.irpfRate) > 0 && (
                <div className="flex justify-between text-neutral-400"><span>IRPF</span><span className="tabular">{Number(invoice.irpfRate)}%</span></div>
              )}
            </div>

            <div>
              <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-1 block">Base imponible correcta (sin IVA)</label>
              <input type="number" step="0.01" min="0" value={correctBase} autoFocus
                placeholder={`Actual: ${r2(invoice.taxBase ?? 0)}`}
                onChange={(e) => setCorrectBase(e.target.value)} className={inputCls} />
              <p className="text-[11px] text-neutral-400 mt-1">Escribe <b>0</b> para anular la factura por completo.</p>
            </div>

            {p.state === "ok" && (
              <div className={`rounded-lg p-3 space-y-1 text-xs border ${p.isAnnul ? "bg-red-50 border-red-100" : "bg-purple-50 border-purple-100"}`}>
                <div className="flex justify-between font-semibold text-neutral-700">
                  <span>{p.isAnnul ? "Anulación total" : "Rectificativa (diferencia)"}</span>
                  <span className="tabular">{sign(p.deltaBase)} base</span>
                </div>
                {p.byRate.map(([rate, agg]) => (
                  <div key={rate} className="flex justify-between text-neutral-500"><span>IVA {rate}%</span><span className="tabular">{sign(agg.vat)}</span></div>
                ))}
                {p.deltaIrpf !== 0 && (
                  <div className="flex justify-between text-amber-700"><span>IRPF {p.irpfRate}%</span><span className="tabular">{sign(-p.deltaIrpf)}</span></div>
                )}
                <div className="flex justify-between font-bold text-neutral-900 pt-1 border-t border-black/5 mt-1"><span>Total rectificativa</span><span className="tabular">{sign(p.deltaTotal)}</span></div>
                {!p.isAnnul && (
                  <div className="flex justify-between text-emerald-700 pt-1"><span>Neto tras rectificar (base)</span><span className="tabular">{fmtMoney(p.resultingBase)}</span></div>
                )}
              </div>
            )}
            {p.state === "no-change" && <div className="text-xs text-amber-600">El importe correcto coincide con la base actual: no hay nada que rectificar.</div>}
            {p.state === "invalid" && <div className="text-xs text-red-500">Introduce un número válido.</div>}

            <div>
              <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-1 block">Motivo</label>
              <Select value={reason} onChange={setReason} options={CORRECTION_REASONS} className={inputCls} />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-1 block">Notas (opcional)</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} placeholder="Detalle interno de la rectificación..." />
            </div>

            {error && <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-100 text-xs text-red-600">{error}</div>}

            {p.state === "ok" && p.isAnnul && (
              <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-100 text-[11px] text-red-700">
                La factura original quedará marcada como <b>rectificada</b> (anulada por completo).
              </div>
            )}
          </div>

          <div className="px-6 py-4 border-t border-neutral-100 flex justify-end gap-2">
            <button onClick={onClose} disabled={saving}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide text-neutral-500 border border-neutral-200 hover:bg-neutral-50 disabled:opacity-40">Cancelar</button>
            <button onClick={submit} disabled={saving || p.state !== "ok"}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-40"
              style={{ background: p.state === "ok" && p.isAnnul ? "#dc2626" : "var(--color-primary, #1B3A2D)" }}>
              {saving ? "Generando..." : p.state === "ok" && p.isAnnul ? "Anular factura" : "Generar rectificativa"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
