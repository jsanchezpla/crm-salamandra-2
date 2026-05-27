"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

const STATUSES = [
  { key: "draft", label: "Borrador" },
  { key: "confirmed", label: "Confirmado" },
  { key: "preparing", label: "En preparación" },
  { key: "shipped", label: "Enviado" },
  { key: "completed", label: "Completado" },
  { key: "cancelled", label: "Cancelado" },
];

const STATUS_STYLE = {
  draft: { dot: "bg-gray-400", bg: "bg-gray-100 text-gray-700" },
  confirmed: { dot: "bg-blue-400", bg: "bg-blue-100 text-blue-700" },
  preparing: { dot: "bg-amber-400", bg: "bg-amber-100 text-amber-700" },
  shipped: { dot: "bg-violet-400", bg: "bg-violet-100 text-violet-700" },
  completed: { dot: "bg-emerald-500", bg: "bg-emerald-100 text-emerald-700" },
  cancelled: { dot: "bg-red-400", bg: "bg-red-100 text-red-600" },
};

function fmtMoney(v) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(v || 0));
}

const inputCls =
  "w-full rounded-md px-2.5 py-1.5 text-sm text-neutral-800 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder:text-neutral-300";

export default function PedidoDetallePage() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id;

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [completing, setCompleting] = useState(false);
  const [settings, setSettings] = useState(null);
  const [products, setProducts] = useState([]);

  const [lines, setLines] = useState([]);
  const [transportAmount, setTransportAmount] = useState(0);
  const [scheduledDate, setScheduledDate] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("draft");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${id}`, { cache: "no-store" });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Error cargando");
      const o = j.data;
      setOrder(o);
      setLines(o.lines ?? []);
      setTransportAmount(Number(o.transportAmount ?? 0));
      setScheduledDate(o.scheduledDate ?? "");
      setNotes(o.notes ?? "");
      setStatus(o.status);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
    fetch("/api/orders/settings").then((r) => r.json()).then((j) => {
      if (j.ok) {
        setSettings(j.data);
        if (transportAmount === 0) setTransportAmount(Number(j.data.transportPrice || 0));
      }
    });
    fetch("/api/inventory/outbound").then((r) => r.json()).then((j) => {
      if (j.ok) setProducts(j.data ?? []);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const subtotal = lines.reduce((acc, l) => acc + Number(l.quantity || 0) * Number(l.unitPrice || 0), 0);
  const total = subtotal + Number(transportAmount || 0);
  const completed = order?.status === "completed";
  const cancelled = order?.status === "cancelled";
  const readOnly = completed || cancelled;

  function addLine() {
    setLines((prev) => [
      ...prev,
      {
        id: `tmp-${Date.now()}`,
        outboundProductId: null,
        productName: "",
        quantity: 1,
        unitPrice: 0,
        notes: null,
      },
    ]);
  }

  function updateLine(idx, patch) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function removeLine(idx) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function pickProduct(idx, productId) {
    const p = products.find((x) => x.id === productId);
    if (!p) {
      updateLine(idx, { outboundProductId: null });
      return;
    }
    updateLine(idx, {
      outboundProductId: p.id,
      productName: p.name,
      unitPrice: p.defaultSalePrice != null ? Number(p.defaultSalePrice) : 0,
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        status,
        transportAmount: Number(transportAmount || 0),
        scheduledDate: scheduledDate || null,
        notes: notes?.trim() || null,
        lines: lines.map((l) => ({
          outboundProductId: l.outboundProductId,
          productName: l.productName,
          quantity: Number(l.quantity || 0),
          unitPrice: Number(l.unitPrice || 0),
          notes: l.notes,
        })),
      };
      const res = await fetch(`/api/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Error guardando");
      const o = j.data;
      setOrder(o);
      setLines(o.lines ?? []);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function complete() {
    if (!window.confirm("Al completar el pedido se generará una factura en borrador. ¿Continuar?")) return;
    setCompleting(true);
    setError(null);
    try {
      // Guardar cambios pendientes primero
      await save();
      const res = await fetch(`/api/orders/${id}/complete`, { method: "POST" });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Error completando");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setCompleting(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm("¿Eliminar este pedido? No se puede deshacer.")) return;
    const res = await fetch(`/api/orders/${id}`, { method: "DELETE" });
    if (res.ok || res.status === 204) {
      router.push("/pedidos");
    } else {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "Error eliminando");
    }
  }

  if (loading) {
    return <div className="p-10 text-sm text-neutral-400">Cargando…</div>;
  }
  if (!order) {
    return <div className="p-10 text-sm text-red-500">{error || "Pedido no encontrado"}</div>;
  }

  const st = STATUS_STYLE[order.status] ?? STATUS_STYLE.draft;
  const statusLabel = STATUSES.find((s) => s.key === order.status)?.label ?? order.status;

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--color-accent)]">
      <div className="px-4 lg:px-10 pt-8 pb-5 shrink-0 border-b border-[var(--ink-200)] flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href="/pedidos"
            className="inline-flex items-center gap-1 text-[12px] text-neutral-500 hover:text-neutral-800 mb-2 transition"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Pedidos
          </Link>
          <div className="eyebrow mb-1.5 lg:mb-2">Pedido · {order.client?.name || "—"}</div>
          <h1 className="font-display text-[22px] lg:text-[30px] leading-[1.05] text-[var(--ink-900)] tracking-tight flex items-center gap-3">
            #{order.id.slice(0, 8)}
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${st.bg}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
              {statusLabel}
            </span>
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {order.invoice && (
            <Link
              href={`/facturacion/facturas`}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition"
            >
              Factura: {order.invoice.number}
            </Link>
          )}
          {!readOnly && (
            <button
              onClick={save}
              disabled={saving}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-neutral-200 text-neutral-700 hover:bg-neutral-50 transition disabled:opacity-50"
            >
              {saving ? "Guardando…" : "Guardar"}
            </button>
          )}
          {!readOnly && order.lines?.length > 0 && (
            <button
              onClick={complete}
              disabled={completing}
              className="px-3 py-1.5 bg-[#0F0F0F] text-white text-xs font-medium rounded-md hover:bg-[#222] transition disabled:opacity-50"
            >
              {completing ? "Completando…" : "Completar y facturar"}
            </button>
          )}
          {!completed && (
            <button
              onClick={handleDelete}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-red-200 text-red-600 bg-white hover:bg-red-50 transition"
            >
              Eliminar
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mx-4 lg:mx-10 mt-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto px-4 lg:px-10 py-6 space-y-6 max-w-5xl w-full mx-auto">
        {/* Cabecera */}
        <div className="bg-white border border-neutral-200 rounded-xl p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-[11px] font-medium text-neutral-500 mb-1">Estado</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              disabled={readOnly}
              className={inputCls}
            >
              {STATUSES.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-neutral-500 mb-1">Fecha programada</label>
            <input
              type="date"
              value={scheduledDate || ""}
              onChange={(e) => setScheduledDate(e.target.value)}
              disabled={readOnly}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-neutral-500 mb-1">Cliente</label>
            <div className="text-sm text-neutral-800 truncate py-1.5">
              {order.client?.name || "—"}
              {order.client?.customFields?.company && (
                <span className="text-[11px] text-neutral-400 ml-1.5">({order.client.customFields.company})</span>
              )}
            </div>
          </div>
        </div>

        {/* Líneas */}
        <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-neutral-100 flex items-center justify-between">
            <h2 className="font-semibold text-neutral-800 text-sm">Líneas del pedido</h2>
            {!readOnly && (
              <button
                onClick={addLine}
                className="text-xs px-2.5 py-1 rounded-md border border-neutral-200 text-neutral-700 hover:bg-neutral-50"
              >
                + Añadir línea
              </button>
            )}
          </div>
          {lines.length === 0 ? (
            <div className="px-5 py-8 text-sm text-neutral-400 text-center">
              Aún no hay líneas. Añade al menos una para poder completar y facturar.
            </div>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-neutral-50 border-b border-neutral-200">
                  <th className="text-left font-medium text-neutral-500 px-4 py-2">Producto</th>
                  <th className="text-right font-medium text-neutral-500 px-4 py-2 w-24">Cantidad</th>
                  <th className="text-right font-medium text-neutral-500 px-4 py-2 w-28">Precio unitario</th>
                  <th className="text-right font-medium text-neutral-500 px-4 py-2 w-28">Subtotal</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => {
                  const lineTotal = Number(l.quantity || 0) * Number(l.unitPrice || 0);
                  return (
                    <tr key={l.id || idx} className="border-b border-neutral-100 last:border-0 align-middle">
                      <td className="px-4 py-2">
                        <select
                          value={l.outboundProductId || ""}
                          onChange={(e) => pickProduct(idx, e.target.value)}
                          disabled={readOnly}
                          className={`${inputCls} mb-1`}
                        >
                          <option value="">— Texto libre (sin catálogo) —</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={l.productName || ""}
                          onChange={(e) => updateLine(idx, { productName: e.target.value })}
                          disabled={readOnly}
                          placeholder="Descripción del producto"
                          className={inputCls}
                        />
                      </td>
                      <td className="px-4 py-2 text-right">
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          value={l.quantity}
                          onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                          disabled={readOnly}
                          className={`${inputCls} text-right`}
                        />
                      </td>
                      <td className="px-4 py-2 text-right">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={l.unitPrice}
                          onChange={(e) => updateLine(idx, { unitPrice: e.target.value })}
                          disabled={readOnly}
                          className={`${inputCls} text-right`}
                        />
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium text-neutral-800">
                        {fmtMoney(lineTotal)}
                      </td>
                      <td className="px-2 py-2">
                        {!readOnly && (
                          <button
                            onClick={() => removeLine(idx)}
                            className="text-neutral-400 hover:text-red-500 p-1"
                            aria-label="Eliminar línea"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Totales y transporte */}
        <div className="bg-white border border-neutral-200 rounded-xl p-5">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-[11px] font-medium text-neutral-500 mb-1">Transporte</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={transportAmount}
                onChange={(e) => setTransportAmount(e.target.value)}
                disabled={readOnly}
                className={inputCls}
              />
              {settings && (
                <p className="text-[11px] text-neutral-400 mt-1">
                  Precio por defecto en{" "}
                  <Link href="/pedidos/configuracion" className="underline">configuración</Link>: {fmtMoney(settings.transportPrice)}
                </p>
              )}
            </div>
            <div className="text-right space-y-1 min-w-[180px]">
              <div className="text-sm text-neutral-500">
                Subtotal: <span className="tabular-nums text-neutral-800">{fmtMoney(subtotal)}</span>
              </div>
              <div className="text-sm text-neutral-500">
                Transporte: <span className="tabular-nums text-neutral-800">{fmtMoney(transportAmount)}</span>
              </div>
              <div className="text-base font-semibold text-neutral-900 pt-1 border-t border-neutral-100">
                Total: <span className="tabular-nums">{fmtMoney(total)}</span>
              </div>
              <p className="text-[10px] text-neutral-400 mt-1">(IVA se aplica al emitir la factura)</p>
            </div>
          </div>
        </div>

        {/* Notas */}
        <div className="bg-white border border-neutral-200 rounded-xl p-5">
          <label className="block text-[11px] font-medium text-neutral-500 mb-1">Notas internas</label>
          <textarea
            rows={3}
            value={notes || ""}
            onChange={(e) => setNotes(e.target.value)}
            disabled={readOnly}
            placeholder="Observaciones, comentarios para la preparación, etc."
            className={`${inputCls} resize-none min-h-[80px]`}
          />
        </div>

        {/* Estado completado: enlace a factura */}
        {completed && order.invoice && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-emerald-800">
            Pedido completado. Factura borrador creada:{" "}
            <strong>{order.invoice.number}</strong> por{" "}
            <strong>{fmtMoney(order.invoice.total)}</strong>.{" "}
            <Link href="/facturacion/facturas" className="underline">Ver en Facturación →</Link>
          </div>
        )}
      </div>
    </div>
  );
}
