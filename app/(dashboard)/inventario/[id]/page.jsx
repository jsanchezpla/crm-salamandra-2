"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { fmt, fmtDate } from "../../../../lib/utils/format.js";
import { computeMargin, hasOutput } from "../../../../lib/inventory/compute.js";

const STATUS_OPTIONS = [
  { key: "stock", label: "En stock", dot: "bg-emerald-400", bg: "bg-emerald-100 text-emerald-700" },
  { key: "partial", label: "Parcial", dot: "bg-amber-400", bg: "bg-amber-100 text-amber-700" },
  { key: "sold", label: "Vendido", dot: "bg-gray-400", bg: "bg-gray-100 text-gray-600" },
];

function StatusPill({ status }) {
  const s = STATUS_OPTIONS.find((o) => o.key === status) ?? STATUS_OPTIONS[0];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium ${s.bg}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function daysBetween(a, b) {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
}

export default function InventoryDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetch(`/api/inventory/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setProduct(data.data);
        else setNotFound(true);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleDelete() {
    if (!confirm("¿Eliminar este producto? Esta acción no se puede deshacer.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/inventory/${id}`, { method: "DELETE" });
      if (res.ok) router.push("/inventario");
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-[var(--color-accent)]">
        <div className="w-6 h-6 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound || !product) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-[var(--color-accent)] gap-4">
        <p className="text-[var(--ink-500)]">Producto no encontrado</p>
        <Link href="/inventario" className="text-[var(--color-primary)] hover:underline text-sm">
          ← Volver al inventario
        </Link>
      </div>
    );
  }

  const kg = parseFloat(product.kg || 0);
  const outputKg = parseFloat(product.outputKg || 0);
  const purchasePrice = parseFloat(product.purchasePrice || 0);
  const salePrice = parseFloat(product.salePrice || 0);

  const cost = kg * purchasePrice;
  const revenue = outputKg * salePrice;
  const outputCost = outputKg * purchasePrice;
  const margin = computeMargin(product);
  const marginPct = revenue > 0 && margin !== null ? (margin / revenue) * 100 : null;
  const soldPct = kg > 0 ? (outputKg / kg) * 100 : 0;
  const remainingKg = Math.max(0, kg - outputKg);
  const showOutput = hasOutput(product);

  const daysInStock = product.exitDate
    ? daysBetween(product.entryDate, product.exitDate)
    : daysBetween(product.entryDate, new Date());

  const clientName = product.client?.customFields?.company || product.client?.name || null;

  return (
    <div className="min-h-full bg-[var(--color-accent)]">
      {/* Header */}
      <div className="px-4 lg:px-10 pt-5 lg:pt-12 pb-6 lg:pb-8 border-b border-[var(--ink-200)]">
        <Link
          href="/inventario"
          className="inline-flex items-center gap-2 text-[var(--ink-400)] hover:text-[var(--ink-700)] transition-colors text-[12px] uppercase tracking-[0.16em] font-semibold mb-3 lg:mb-5"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Volver al inventario
        </Link>

        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3 mb-2 lg:mb-3 flex-wrap">
              <div className="eyebrow">Operaciones · Inventario · Ficha</div>
              <StatusPill status={product.status} />
            </div>
            <h1 className="font-display text-[28px] lg:text-[44px] leading-[1.05] text-[var(--ink-900)] tracking-tight mb-2 break-words">
              {product.productName}
              {product.outputName && product.outputName !== product.productName && (
                <span className="font-display-italic text-[var(--ink-400)]"> — {product.outputName}</span>
              )}
            </h1>
            <div className="flex items-center gap-4 text-[13px] text-[var(--ink-500)] flex-wrap">
              {product.lot && (
                <span className="font-mono">
                  <span className="text-[var(--ink-400)]">Lote </span>
                  <span className="text-[var(--ink-700)]">{product.lot}</span>
                </span>
              )}
              {product.supplier && (
                <span>
                  <span className="text-[var(--ink-400)]">Proveedor </span>
                  <span className="text-[var(--ink-700)]">{product.supplier}</span>
                </span>
              )}
              {clientName && (
                <span>
                  <span className="text-[var(--ink-400)]">Cliente </span>
                  <span className="text-[var(--ink-700)]">{clientName}</span>
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href={`/inventario?edit=${product.id}`}
              className="flex items-center gap-2 bg-[var(--color-primary)] hover:opacity-90 text-white text-[13px] font-medium px-4 py-2 rounded-[var(--radius-control)] transition-opacity"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
              </svg>
              Editar
            </Link>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-2 bg-white border border-red-200 hover:border-red-300 text-red-600 text-[13px] font-medium px-4 py-2 rounded-[var(--radius-control)] transition-colors disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
              Eliminar
            </button>
          </div>
        </div>
      </div>

      {/* KPI grid */}
      <div className="px-4 lg:px-10 pt-8 max-w-6xl">
        <div className="eyebrow mb-4">Resumen económico</div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[var(--ink-200)] border border-[var(--ink-200)] rounded-[var(--radius-card)] overflow-hidden mb-10 shadow-[var(--shadow-card)]">
          <Kpi label="Coste de compra" value={fmt(cost)} unit="€" tone="text-[var(--ink-700)]" sub={kg > 0 ? `${fmt(kg, 1)} kg × ${fmt(purchasePrice)} €/kg` : null} />
          <Kpi label="Ingresos" value={revenue > 0 ? fmt(revenue) : "—"} unit={revenue > 0 ? "€" : null} tone="text-blue-700" sub={revenue > 0 ? `${fmt(outputKg, 1)} kg × ${fmt(salePrice)} €/kg` : "Sin venta"} />
          <Kpi
            label="Margen"
            value={margin !== null ? fmt(margin) : "—"}
            unit={margin !== null ? "€" : null}
            tone={margin === null ? "text-[var(--ink-700)]" : margin >= 0 ? "text-emerald-700" : "text-red-700"}
            sub={marginPct !== null ? `${fmt(marginPct, 1)}% sobre ingresos` : null}
          />
          <Kpi
            label="Stock vendido"
            value={fmt(soldPct, 1)}
            unit="%"
            tone={soldPct >= 100 ? "text-emerald-700" : soldPct > 0 ? "text-amber-700" : "text-[var(--ink-500)]"}
            sub={kg > 0 ? `${fmt(remainingKg, 1)} kg restantes` : null}
          />
        </div>
      </div>

      {/* Detalle */}
      <div className="px-4 lg:px-10 pb-16 max-w-6xl">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-[var(--ink-200)] border border-[var(--ink-200)] rounded-[var(--radius-card)] overflow-hidden mb-10">
          {/* Materia prima */}
          <div className="bg-white p-7">
            <div className="eyebrow mb-5">Materia prima · Entrada</div>
            <dl className="space-y-3.5">
              <Row label="Producto" value={product.productName} />
              <Row label="Proveedor" value={product.supplier} />
              <Row label="Fecha de entrada" value={fmtDate(product.entryDate)} mono />
              <Row label="Lote" value={product.lot} mono />
              <Row label="Embalaje" value={product.packaging} />
              <Row label="Unidades" value={product.units != null ? String(product.units) : null} mono />
              <Row label="Kg comprados" value={kg > 0 ? `${fmt(kg, 1)} kg` : null} mono />
              <Row label="Precio compra" value={purchasePrice > 0 ? `${fmt(purchasePrice)} €/kg` : null} mono />
              <Row label="Coste total" value={cost > 0 ? `${fmt(cost)} €` : null} mono accent />
            </dl>
          </div>

          {/* Producto formulado */}
          <div className="bg-white p-7">
            <div className="eyebrow mb-5">Producto formulado · Salida</div>
            {showOutput ? (
              <dl className="space-y-3.5">
                <Row label="Producto formulado" value={product.outputName || product.productName} />
                <Row label="Cliente" value={clientName} />
                <Row label="Fecha de salida" value={fmtDate(product.exitDate)} mono />
                <Row label="Kg vendidos" value={outputKg > 0 ? `${fmt(outputKg, 1)} kg` : null} mono />
                <Row label="Precio venta" value={salePrice > 0 ? `${fmt(salePrice)} €/kg` : null} mono />
                <Row label="Ingresos" value={revenue > 0 ? `${fmt(revenue)} €` : null} mono />
                <Row label="Coste de lo vendido" value={outputCost > 0 ? `${fmt(outputCost)} €` : null} mono />
                <Row
                  label="Margen total"
                  value={margin !== null ? `${fmt(margin)} €` : null}
                  mono
                  accent
                  tone={margin === null ? null : margin >= 0 ? "text-emerald-700" : "text-red-700"}
                />
              </dl>
            ) : (
              <div className="text-[13px] text-[var(--ink-400)] italic">
                Sin datos de salida. Este producto sigue en stock.
              </div>
            )}
          </div>
        </div>

        {/* Métricas adicionales */}
        <div className="bg-white border border-[var(--ink-200)] rounded-[var(--radius-card)] p-7 mb-8 shadow-[var(--shadow-card)]">
          <div className="eyebrow mb-5">Indicadores</div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            <MiniMetric
              label="Días en inventario"
              value={daysInStock != null ? String(daysInStock) : "—"}
              hint={product.exitDate ? "desde entrada hasta salida" : "desde entrada hasta hoy"}
            />
            <MiniMetric
              label="Stock restante"
              value={`${fmt(remainingKg, 1)} kg`}
              hint={kg > 0 ? `de ${fmt(kg, 1)} kg comprados` : null}
            />
            {marginPct !== null && (
              <MiniMetric
                label="Margen %"
                value={`${fmt(marginPct, 1)}%`}
                hint="sobre ingresos"
                tone={marginPct >= 0 ? "text-emerald-700" : "text-red-700"}
              />
            )}
            {salePrice > 0 && purchasePrice > 0 && (
              <MiniMetric
                label="Mark-up"
                value={`${fmt(((salePrice - purchasePrice) / purchasePrice) * 100, 1)}%`}
                hint="sobre €/kg compra"
              />
            )}
          </div>

          {/* Barra de progreso de venta */}
          {kg > 0 && (
            <div className="mt-7 pt-6 border-t border-[var(--ink-150)]">
              <div className="flex items-center justify-between text-[12px] mb-2">
                <span className="text-[var(--ink-500)] uppercase tracking-wider font-semibold">Progreso de venta</span>
                <span className="font-mono tabular text-[var(--ink-700)]">{fmt(outputKg, 1)} / {fmt(kg, 1)} kg</span>
              </div>
              <div className="h-2 bg-[var(--ink-100)] rounded-full overflow-hidden">
                <div
                  className="h-full transition-all"
                  style={{
                    width: `${Math.min(100, soldPct)}%`,
                    backgroundColor: soldPct >= 100 ? "rgb(4 120 87)" : "var(--color-primary)",
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Notas */}
        {product.notes && (
          <div className="bg-white border border-[var(--ink-200)] rounded-[var(--radius-card)] p-7 shadow-[var(--shadow-card)]">
            <div className="eyebrow mb-4">Notas</div>
            <p className="text-[14px] text-[var(--ink-700)] leading-relaxed whitespace-pre-wrap">
              {product.notes}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, unit, tone, sub }) {
  return (
    <div className="bg-white px-5 py-5">
      <div className="text-[10px] text-[var(--ink-400)] uppercase tracking-[0.14em] font-semibold mb-2">
        {label}
      </div>
      <div className={`font-display tabular text-[32px] leading-none ${tone}`}>
        {value}
        {unit && <span className="text-[15px] text-[var(--ink-400)] ml-1.5 font-sans">{unit}</span>}
      </div>
      {sub && <div className="text-[11px] text-[var(--ink-400)] mt-2 tabular">{sub}</div>}
    </div>
  );
}

function Row({ label, value, mono, accent, tone }) {
  if (value === null || value === undefined || value === "" || value === "—") {
    return (
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-[12px] text-[var(--ink-400)] shrink-0">{label}</dt>
        <dd className="text-[13px] text-[var(--ink-300)]">—</dd>
      </div>
    );
  }
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-[12px] text-[var(--ink-400)] shrink-0">{label}</dt>
      <dd
        className={`${mono ? "font-mono tabular" : ""} ${
          tone ?? (accent ? "text-[var(--ink-900)] font-semibold" : "text-[var(--ink-700)]")
        } text-[13px] text-right break-words`}
      >
        {value}
      </dd>
    </div>
  );
}

function MiniMetric({ label, value, hint, tone }) {
  return (
    <div>
      <div className="text-[10px] text-[var(--ink-400)] uppercase tracking-[0.14em] font-semibold mb-1.5">
        {label}
      </div>
      <div className={`font-display tabular text-[24px] leading-none ${tone ?? "text-[var(--ink-900)]"}`}>
        {value}
      </div>
      {hint && <div className="text-[11px] text-[var(--ink-400)] mt-1.5">{hint}</div>}
    </div>
  );
}
