"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SelectorCliente from "../../../../components/clients/SelectorCliente.jsx";
import HelpTooltip from "../../../../components/ui/HelpTooltip.jsx";
import ExportButtons from "@/components/billing/ExportButtons.jsx";
import { anchoPantalla } from "@/components/layout/anchoPantalla.js";

const STATUS = {
  draft: { label: "Borrador", cls: "bg-neutral-100 text-neutral-600" },
  sent: { label: "Enviado", cls: "bg-sky-100 text-sky-700" },
  viewed: { label: "Visto", cls: "bg-violet-100 text-violet-700" },
  accepted: { label: "Aceptado", cls: "bg-emerald-100 text-emerald-700" },
  rejected: { label: "Rechazado", cls: "bg-red-100 text-red-600" },
  expired: { label: "Caducado", cls: "bg-amber-100 text-amber-700" },
  converted: { label: "Facturado", cls: "bg-teal-100 text-teal-700" },
};

const FILTERS = [
  { key: "", label: "Todos" },
  { key: "sent", label: "Enviados" },
  { key: "accepted", label: "Aceptados" },
  { key: "converted", label: "Facturados" },
  { key: "expired", label: "Caducados" },
];

function fmtMoney(v) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(v || 0));
}
function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
}

export default function PresupuestosPage() {
  const router = useRouter();
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [error, setError] = useState(null);

  const [showNew, setShowNew] = useState(false);
  const [newClientId, setNewClientId] = useState("");
  const [creating, setCreating] = useState(false);

  // Alta de cliente inline (drawer lateral)
  const [showClientDrawer, setShowClientDrawer] = useState(false);
  const [savingClient, setSavingClient] = useState(false);
  const [clientErr, setClientErr] = useState(null);
  const [clientForm, setClientForm] = useState({ type: "company", name: "", email: "", phone: "", taxId: "", fiscalName: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (status) params.set("status", status);
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/billing/quotes?${params}`, { cache: "no-store" });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Error cargando");
      setQuotes(j.data?.quotes ?? []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [status, q]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);


  async function createQuote() {
    if (!newClientId) return;
    setCreating(true);
    try {
      const res = await fetch("/api/billing/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: newClientId, lines: [] }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Error creando");
      router.push(`/facturacion/presupuestos/${j.data.id}`);
    } catch (err) {
      setError(err.message);
      setCreating(false);
    }
  }

  async function createClient() {
    if (!clientForm.name.trim()) { setClientErr("El nombre es obligatorio"); return; }
    setSavingClient(true);
    setClientErr(null);
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: clientForm.type,
          name: clientForm.name.trim(),
          email: clientForm.email.trim() || null,
          phone: clientForm.phone.trim() || null,
          taxId: clientForm.taxId.trim() || null,
          fiscalName: clientForm.fiscalName.trim() || null,
        }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Error creando cliente");
      const nuevo = j.data;
      setNewClientId(nuevo.id);
      setShowClientDrawer(false);
      setClientForm({ type: "company", name: "", email: "", phone: "", taxId: "", fiscalName: "" });
    } catch (err) {
      setClientErr(err.message);
    } finally {
      setSavingClient(false);
    }
  }

  const totalAceptado = quotes
    .filter((x) => x.status === "accepted")
    .reduce((a, x) => a + Number(x.total || 0), 0);

  const exportParams = new URLSearchParams();
  if (status) exportParams.set("status", status);
  if (q.trim()) exportParams.set("q", q.trim());
  const exportUrl = `/api/billing/exports/quotes${exportParams.toString() ? `?${exportParams}` : ""}`;

  return (
    <div className={`${anchoPantalla("listado")} space-y-5`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="eyebrow">Operativa · Documentos</div>
          <h1 className="font-display text-2xl lg:text-4xl text-[var(--ink-900)] tracking-tight mt-1">
            Presupuestos
          </h1>
          <p className="text-xs text-neutral-400 mt-1">Pipeline comercial: oferta → aceptación → factura.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start">
          <ExportButtons xlsxUrl={exportUrl} />
          <button
            onClick={() => setShowNew(true)}
            className="px-3.5 py-2 bg-[var(--color-primary,#1B3A2D)] text-white text-xs font-medium rounded-md hover:opacity-90 transition"
          >
            + Nuevo presupuesto
          </button>
        </div>
      </div>

      {/* Filtros + búsqueda */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex bg-neutral-100 rounded-lg p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatus(f.key)}
              className={`text-xs px-3 py-1.5 rounded-md font-medium transition ${
                status === f.key ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar nº, cliente o paciente…"
          className="flex-1 min-w-[180px] rounded-md px-3 py-2 text-sm bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400"
        />
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{error}</div>
      )}

      {/* Tabla */}
      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
        <div className="grid grid-cols-[100px_1.4fr_110px_100px_74px] gap-3 px-4 py-2.5 bg-neutral-50 border-b border-neutral-200 text-[10.5px] uppercase tracking-wide text-neutral-500 font-semibold">
          <span>Nº</span><span>Cliente</span><span>Estado</span><span className="text-right">Importe</span><span className="text-right">Validez</span>
        </div>
        {loading ? (
          <div className="px-4 py-10 text-sm text-neutral-400 text-center">Cargando…</div>
        ) : quotes.length === 0 ? (
          <div className="px-4 py-10 text-sm text-neutral-400 text-center">
            No hay presupuestos. Crea el primero con “Nuevo presupuesto”.
          </div>
        ) : (
          quotes.map((quote) => {
            const st = STATUS[quote.status] ?? STATUS.draft;
            return (
              <Link
                key={quote.id}
                href={`/facturacion/presupuestos/${quote.id}`}
                className="grid grid-cols-[100px_1.4fr_110px_100px_74px] gap-3 px-4 py-3 border-t border-neutral-100 text-[13.5px] items-center hover:bg-neutral-50 transition"
              >
                <span className="font-display text-[var(--ink-900)] font-semibold">{quote.number}</span>
                <span className="text-neutral-800 truncate">{quote.client?.name || "—"}</span>
                <span>
                  <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${st.cls}`}>{st.label}</span>
                </span>
                <span className="text-right tabular-nums font-medium text-neutral-800">{fmtMoney(quote.total)}</span>
                <span className="text-right text-neutral-400 text-[12.5px]">{fmtDate(quote.validUntil)}</span>
              </Link>
            );
          })
        )}
        {!loading && quotes.length > 0 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-neutral-200 bg-neutral-50 text-[12px] text-neutral-500">
            <span>{quotes.length} presupuestos</span>
            <span className="font-display text-[var(--ink-900)] inline-flex items-center gap-1.5">
              Aceptado sin facturar: {fmtMoney(totalAceptado)}
              <HelpTooltip title="Aceptado sin facturar" placement="top">
                Lo que ya han dicho que sí y todavía no se ha convertido en factura, con IVA.
                {" "}
                <strong className="text-white">Suma solo los presupuestos que se ven ahora en la
                lista</strong>: al cambiar de pestaña o buscar, el total cambia con ella. No es el
                total de todo el año.
              </HelpTooltip>
            </span>
          </div>
        )}
      </div>

      {/* Modal alta */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !creating && setShowNew(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-lg text-[var(--ink-900)] mb-1">Nuevo presupuesto</h2>
            <p className="text-xs text-neutral-400 mb-4">Elige el cliente. Las líneas se añaden en el detalle.</p>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[11px] font-medium text-neutral-500">Cliente</label>
              <button
                type="button"
                onClick={() => { setClientErr(null); setShowClientDrawer(true); }}
                className="text-[11px] font-medium text-[var(--color-primary,#1B3A2D)] hover:underline"
              >
                + Nuevo cliente
              </button>
            </div>
            <SelectorCliente
              value={newClientId}
              onChange={(v) => setNewClientId(v)}
            />
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowNew(false)} disabled={creating} className="px-3 py-1.5 text-xs font-medium rounded-md border border-neutral-200 text-neutral-600 hover:bg-neutral-50">
                Cancelar
              </button>
              <button
                onClick={createQuote}
                disabled={!newClientId || creating}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--color-primary,#1B3A2D)] text-white hover:opacity-90 disabled:opacity-40"
              >
                {creating ? "Creando…" : "Crear y editar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drawer lateral: nuevo cliente */}
      {showClientDrawer && (
        <>
          <div className="fixed inset-0 z-[60] bg-black/40" onClick={() => !savingClient && setShowClientDrawer(false)} />
          <div className="fixed z-[61] right-0 top-14 lg:top-0 bottom-0 w-full max-w-md bg-white shadow-2xl flex flex-col">
            <div className="px-5 py-4 border-b border-neutral-200 flex items-center justify-between shrink-0">
              <div>
                <div className="eyebrow">Presupuestos</div>
                <h2 className="font-display text-lg text-[var(--ink-900)]">Nuevo cliente</h2>
              </div>
              <button onClick={() => setShowClientDrawer(false)} className="text-neutral-400 hover:text-neutral-700 p-1" aria-label="Cerrar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-auto px-5 py-5 space-y-4">
              {clientErr && <div className="px-3 py-2 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{clientErr}</div>}
              <div>
                <label className="block text-[11px] font-medium text-neutral-500 mb-1">Tipo</label>
                <div className="inline-flex bg-neutral-100 rounded-lg p-1">
                  {[{ k: "company", l: "Empresa" }, { k: "individual", l: "Particular" }].map((t) => (
                    <button key={t.k} type="button" onClick={() => setClientForm((f) => ({ ...f, type: t.k }))}
                      className={`text-xs px-3 py-1.5 rounded-md font-medium transition ${clientForm.type === t.k ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500"}`}>
                      {t.l}
                    </button>
                  ))}
                </div>
              </div>
              {[
                { k: "name", l: "Nombre *", ph: "Nombre del cliente" },
                { k: "fiscalName", l: "Razón social", ph: "Nombre fiscal (si difiere)" },
                { k: "taxId", l: "CIF / NIF", ph: "B12345678" },
                { k: "email", l: "Email", ph: "cliente@empresa.com" },
                { k: "phone", l: "Teléfono", ph: "+34 600 000 000" },
              ].map((field) => (
                <div key={field.k}>
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">{field.l}</label>
                  <input
                    value={clientForm[field.k]}
                    onChange={(e) => setClientForm((f) => ({ ...f, [field.k]: e.target.value }))}
                    placeholder={field.ph}
                    className="w-full rounded-md px-2.5 py-2 text-sm bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400"
                  />
                </div>
              ))}
            </div>
            <div className="px-5 py-4 border-t border-neutral-200 flex justify-end gap-2 shrink-0">
              <button onClick={() => setShowClientDrawer(false)} disabled={savingClient} className="px-3 py-2 text-xs font-medium rounded-md border border-neutral-200 text-neutral-600 hover:bg-neutral-50">Cancelar</button>
              <button onClick={createClient} disabled={savingClient || !clientForm.name.trim()} className="px-3 py-2 text-xs font-medium rounded-md bg-[var(--color-primary,#1B3A2D)] text-white hover:opacity-90 disabled:opacity-40">
                {savingClient ? "Creando…" : "Crear y seleccionar"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
