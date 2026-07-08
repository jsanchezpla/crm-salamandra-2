"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

const STATUS = {
  draft: { label: "Borrador", cls: "bg-neutral-100 text-neutral-600" },
  sent: { label: "Enviado", cls: "bg-sky-100 text-sky-700" },
  viewed: { label: "Visto", cls: "bg-violet-100 text-violet-700" },
  accepted: { label: "Aceptado", cls: "bg-emerald-100 text-emerald-700" },
  rejected: { label: "Rechazado", cls: "bg-red-100 text-red-600" },
  expired: { label: "Caducado", cls: "bg-amber-100 text-amber-700" },
  converted: { label: "Facturado", cls: "bg-teal-100 text-teal-700" },
};

const inputCls =
  "w-full rounded-md px-2.5 py-1.5 text-sm text-neutral-800 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400";

function fmtMoney(v) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(v || 0));
}
function fmtDateTime(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function PresupuestoDetallePage() {
  const params = useParams();
  const id = params?.id;

  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [converted, setConverted] = useState(null);

  const [lines, setLines] = useState([]);
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/billing/quotes/${id}`, { cache: "no-store" });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Error cargando");
      const o = j.data;
      setQuote(o);
      setLines(Array.isArray(o.lines) ? o.lines : []);
      setValidUntil(o.validUntil ?? "");
      setNotes(o.notes ?? "");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const readOnly = quote?.status === "converted";

  const subtotal = lines.reduce((a, l) => {
    const base = Number(l.quantity || 0) * Number(l.unitPrice || 0) * (1 - Number(l.discountPct || 0) / 100);
    return a + base;
  }, 0);
  const vat = lines.reduce((a, l) => {
    const base = Number(l.quantity || 0) * Number(l.unitPrice || 0) * (1 - Number(l.discountPct || 0) / 100);
    return a + base * (Number(l.vatRate || 0) / 100);
  }, 0);
  const total = subtotal + vat;

  function updateLine(idx, patch) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, { description: "", quantity: 1, unitPrice: 0, discountPct: 0, vatRate: 21 }]);
  }
  function removeLine(idx) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/billing/quotes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: lines.map((l) => ({
            description: l.description,
            quantity: Number(l.quantity || 0),
            unitPrice: Number(l.unitPrice || 0),
            discountPct: Number(l.discountPct || 0),
            vatRate: Number(l.vatRate || 0),
          })),
          validUntil: validUntil || null,
          notes: notes?.trim() || null,
        }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Error guardando");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function action(path, patchBody) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/billing/quotes/${id}${path}`, {
        method: patchBody ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        ...(patchBody ? { body: JSON.stringify(patchBody) } : {}),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Error");
      if (path === "/convert") {
        setConverted(j.data?.invoice ?? null);
      }
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="p-10 text-sm text-neutral-400">Cargando…</div>;
  if (!quote) return <div className="p-10 text-sm text-red-500">{error || "Presupuesto no encontrado"}</div>;

  const st = STATUS[quote.status] ?? STATUS.draft;

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto space-y-5">
      <div>
        <Link href="/facturacion/presupuestos" className="inline-flex items-center gap-1 text-[12px] text-neutral-500 hover:text-neutral-800 mb-2">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          Presupuestos
        </Link>
        <div className="eyebrow">Operativa · Presupuesto · {quote.client?.name || "—"}</div>
        <h1 className="font-display text-2xl lg:text-3xl text-[var(--ink-900)] tracking-tight mt-1 flex items-center gap-3">
          {quote.number}
          <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${st.cls}`}>{st.label}</span>
        </h1>
      </div>

      {error && <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{error}</div>}

      {(converted || quote.convertedInvoiceId) && (
        <div className="px-4 py-3 bg-teal-50 border border-teal-200 rounded-lg text-sm text-teal-800">
          Convertido en factura borrador{converted?.number ? ` (${converted.number})` : ""}.{" "}
          <Link href="/facturacion/facturas" className="underline font-medium">Ver en Facturas →</Link>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-5">
        {/* Columna izquierda: líneas + totales */}
        <div className="space-y-4">
          <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between">
              <h2 className="font-semibold text-neutral-800 text-sm">Líneas</h2>
              {!readOnly && <button onClick={addLine} className="text-xs px-2.5 py-1 rounded-md border border-neutral-200 text-neutral-700 hover:bg-neutral-50">+ Añadir línea</button>}
            </div>
            {lines.length === 0 ? (
              <div className="px-4 py-8 text-sm text-neutral-400 text-center">Sin líneas todavía.</div>
            ) : (
              <div className="divide-y divide-neutral-100">
                <div className="hidden sm:grid grid-cols-[1fr_60px_84px_56px_60px_84px_28px] gap-2 px-4 py-2 bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-500 font-semibold">
                  <span>Descripción</span><span className="text-right">Cant.</span><span className="text-right">Precio</span><span className="text-right">Dto%</span><span className="text-right">IVA%</span><span className="text-right">Total</span><span />
                </div>
                {lines.map((l, idx) => {
                  const base = Number(l.quantity || 0) * Number(l.unitPrice || 0) * (1 - Number(l.discountPct || 0) / 100);
                  const lineTotal = base * (1 + Number(l.vatRate || 0) / 100);
                  return (
                    <div key={idx} className="grid grid-cols-[1fr_60px_84px_56px_60px_84px_28px] gap-2 px-4 py-2 items-center">
                      <input value={l.description || ""} onChange={(e) => updateLine(idx, { description: e.target.value })} disabled={readOnly} placeholder="Concepto" className={inputCls} />
                      <input type="number" min="0" step="0.01" value={l.quantity} onChange={(e) => updateLine(idx, { quantity: e.target.value })} disabled={readOnly} className={`${inputCls} text-right`} />
                      <input type="number" min="0" step="0.01" value={l.unitPrice} onChange={(e) => updateLine(idx, { unitPrice: e.target.value })} disabled={readOnly} className={`${inputCls} text-right`} />
                      <input type="number" min="0" max="100" step="1" value={l.discountPct ?? 0} onChange={(e) => updateLine(idx, { discountPct: e.target.value })} disabled={readOnly} className={`${inputCls} text-right`} />
                      <input type="number" min="0" step="1" value={l.vatRate ?? 21} onChange={(e) => updateLine(idx, { vatRate: e.target.value })} disabled={readOnly} className={`${inputCls} text-right`} />
                      <span className="text-right tabular-nums text-sm text-neutral-800">{fmtMoney(lineTotal)}</span>
                      {!readOnly ? (
                        <button onClick={() => removeLine(idx)} className="text-neutral-400 hover:text-red-500" aria-label="Eliminar">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      ) : <span />}
                    </div>
                  );
                })}
              </div>
            )}
            <div className="px-4 py-3 border-t border-neutral-200 bg-neutral-50 space-y-1 text-sm">
              <div className="flex justify-between text-neutral-500"><span>Base imponible</span><span className="tabular-nums text-neutral-800">{fmtMoney(subtotal)}</span></div>
              <div className="flex justify-between text-neutral-500"><span>IVA</span><span className="tabular-nums text-neutral-800">{fmtMoney(vat)}</span></div>
              <div className="flex justify-between font-display text-base text-neutral-900 pt-1 border-t border-neutral-200"><span>Total</span><span className="tabular-nums">{fmtMoney(total)}</span></div>
            </div>
          </div>

          <div className="bg-white border border-neutral-200 rounded-xl p-4">
            <label className="block text-[11px] font-medium text-neutral-500 mb-1">Notas</label>
            <textarea rows={2} value={notes || ""} onChange={(e) => setNotes(e.target.value)} disabled={readOnly} placeholder="Condiciones, observaciones…" className={`${inputCls} resize-none`} />
          </div>
        </div>

        {/* Columna derecha: validez + ciclo de vida + acciones */}
        <div className="space-y-4">
          <div className="bg-white border border-neutral-200 rounded-xl p-4">
            <label className="block text-[11px] font-medium text-neutral-500 mb-1">Válido hasta</label>
            <input type="date" value={validUntil || ""} onChange={(e) => setValidUntil(e.target.value)} disabled={readOnly} className={inputCls} />
          </div>

          <div className="bg-white border border-neutral-200 rounded-xl p-4">
            <div className="text-[10.5px] uppercase tracking-wide text-neutral-500 font-semibold mb-3">Ciclo de vida</div>
            <ul className="space-y-2.5 text-[13px]">
              {[
                { t: "Creado", d: quote.createdAt, on: true },
                { t: "Enviado", d: quote.sentAt, on: !!quote.sentAt },
                { t: "Visto por el cliente", d: quote.viewedAt, on: !!quote.viewedAt },
                { t: "Aceptado", d: quote.acceptedAt, on: !!quote.acceptedAt },
                { t: "Convertido en factura", d: quote.convertedAt, on: !!quote.convertedAt },
              ].map((s) => (
                <li key={s.t} className="flex items-start gap-2.5">
                  <span className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${s.on ? "bg-emerald-500" : "bg-neutral-200"}`} />
                  <div>
                    <div className={s.on ? "text-neutral-800 font-medium" : "text-neutral-400"}>{s.t}</div>
                    <div className="text-[11px] text-neutral-400">{s.on ? fmtDateTime(s.d) : "—"}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {!readOnly && (
            <div className="bg-white border border-neutral-200 rounded-xl p-4 space-y-2">
              <button onClick={save} disabled={saving} className="w-full px-3 py-2 text-xs font-medium rounded-md border border-neutral-200 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">
                {saving ? "Guardando…" : "Guardar cambios"}
              </button>
              {!quote.sentAt && (
                <button onClick={() => action("", { status: "sent" })} disabled={busy} className="w-full px-3 py-2 text-xs font-medium rounded-md border border-sky-200 text-sky-700 bg-sky-50 hover:bg-sky-100 disabled:opacity-50">
                  Marcar como enviado
                </button>
              )}
              {quote.status !== "accepted" && (
                <button onClick={() => action("/accept")} disabled={busy} className="w-full px-3 py-2 text-xs font-medium rounded-md border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50">
                  Marcar como aceptado
                </button>
              )}
              {quote.status === "accepted" && (
                <button onClick={() => action("/convert")} disabled={busy} className="w-full px-3 py-2 text-xs font-medium rounded-md bg-[var(--color-primary,#1B3A2D)] text-white hover:opacity-90 disabled:opacity-50">
                  {busy ? "Convirtiendo…" : "Convertir en factura"}
                </button>
              )}
              {quote.status !== "rejected" && (
                <button onClick={() => action("", { status: "rejected" })} disabled={busy} className="w-full px-3 py-2 text-xs font-medium rounded-md border border-red-200 text-red-600 bg-white hover:bg-red-50 disabled:opacity-50">
                  Marcar como rechazado
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
