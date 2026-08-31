"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import HelpTooltip from "../../../components/ui/HelpTooltip.jsx";
import PeriodPicker, { computeRange } from "./_components/PeriodPicker.jsx";
import { fmtMoney } from "./_components/Kpi.jsx";
import { anchoPantalla } from "@/components/layout/anchoPantalla.js";

const FUNNEL_BG = ["#5A8A70", "#3F7458", "#2C5C45", "#1B3A2D"];

function FunnelStep({ i, label, value, caption }) {
  return (
    <div
      className="flex-1 px-4 py-4 text-white relative flex flex-col justify-center min-w-0"
      style={{
        background: FUNNEL_BG[i],
        borderTopLeftRadius: i === 0 ? 12 : 0,
        borderBottomLeftRadius: i === 0 ? 12 : 0,
        borderTopRightRadius: i === 3 ? 12 : 0,
        borderBottomRightRadius: i === 3 ? 12 : 0,
      }}
    >
      <span className="text-[10px] uppercase tracking-wide font-semibold opacity-80">{label}</span>
      <div className="font-display text-lg lg:text-2xl mt-1 truncate">{value}</div>
      <div className="text-[11px] opacity-80 mt-0.5 truncate">{caption}</div>
      {i < 3 && (
        <span className="absolute -right-2 top-1/2 -translate-y-1/2 z-10 text-[#C7B9EC] text-xl font-bold hidden sm:block">›</span>
      )}
    </div>
  );
}

export default function PanelOperativo() {
  const sp = useSearchParams();
  const period = sp.get("period") || "quarter";
  let from = sp.get("from");
  let to = sp.get("to");
  if (!from || !to) {
    const r = computeRange(period);
    from = r.from; to = r.to;
  }

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const load = useCallback(async () => {
    if (!from || !to) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/billing/operations?from=${from}&to=${to}`, { cache: "no-store" });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Error");
      setData(j.data);
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const f = data?.funnel;
  const a = data?.actions;

  const actionItems = a
    ? [
        { dot: "#A9503A", label: `${a.overdue.count} factura${a.overdue.count === 1 ? "" : "s"} vencida${a.overdue.count === 1 ? "" : "s"}`, amount: a.overdue.amount, href: "/facturacion/facturas?status=overdue", cta: "Reclamar", show: a.overdue.count > 0 },
        { dot: "#94711F", label: `${a.expiring.count} presupuesto${a.expiring.count === 1 ? "" : "s"} caduca${a.expiring.count === 1 ? "" : "n"} esta semana`, amount: a.expiring.amount, href: "/facturacion/presupuestos", cta: "Revisar", show: a.expiring.count > 0 },
        { dot: "#3F6488", label: `${a.acceptedNotInvoiced.count} presupuesto${a.acceptedNotInvoiced.count === 1 ? "" : "s"} aceptado${a.acceptedNotInvoiced.count === 1 ? "" : "s"} sin facturar`, amount: a.acceptedNotInvoiced.amount, href: "/facturacion/presupuestos?status=accepted", cta: "Facturar", show: a.acceptedNotInvoiced.count > 0 },
      ].filter((x) => x.show)
    : [];

  return (
    <div className={`${anchoPantalla("portada")} space-y-5`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="eyebrow">Operativa · Ventas y documentos</div>
          <h1 className="font-display text-2xl lg:text-4xl text-[var(--ink-900)] tracking-tight mt-1 flex items-center gap-2 flex-wrap">
            <span>Panel operativo</span>
            <HelpTooltip title="Panel operativo" placement="bottom">
              Las fechas de la derecha solo mueven los dos últimos escalones del embudo,{" "}
              <strong className="text-white">Facturado y Cobrado</strong>. Presupuestos, Aceptados
              y Acción requerida son la foto de HOY: no cambian elijas el periodo que elijas. Y el
              embudo mezcla presupuestos con IVA y facturas sin IVA, así que ese escalón baja sin
              haberse perdido un euro.
            </HelpTooltip>
          </h1>
          <p className="text-xs text-neutral-400 mt-1">El día a día del ciclo comercial y de cobro.</p>
        </div>
        <PeriodPicker />
      </div>

      {errorMsg && (
        <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{errorMsg}</div>
      )}

      {/* Embudo */}
      {loading && !data ? (
        <div className="h-24 bg-neutral-100 rounded-xl animate-pulse" />
      ) : f ? (
        <div className="flex gap-0 items-stretch">
          <FunnelStep i={0} label="Presupuestos" value={fmtMoney(f.presupuestos.amount)} caption={`${f.presupuestos.count} abiertos`} />
          <FunnelStep i={1} label="Aceptados" value={fmtMoney(f.aceptados.amount)} caption={`${f.aceptados.count} · por facturar`} />
          <FunnelStep
            i={2}
            label="Facturado"
            value={fmtMoney(f.facturado.amount)}
            caption={`${f.facturado.count} factura${f.facturado.count === 1 ? "" : "s"}`}
          />
          <FunnelStep i={3} label="Cobrado" value={fmtMoney(f.cobrado.amount)} caption={`${f.cobrado.pct}%`} />
        </div>
      ) : null}

      {/* Acción requerida */}
      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between gap-3">
          <h2 className="eyebrow">Acción requerida</h2>
          <Link href="/facturacion/acciones" className="text-[11.5px] font-medium text-neutral-500 hover:text-neutral-800 transition">
            Ver todas →
          </Link>
        </div>
        {actionItems.length === 0 ? (
          <div className="px-4 py-8 text-sm text-neutral-400 text-center">
            {data ? "Nada pendiente. Todo al día 🎉" : "Cargando…"}
          </div>
        ) : (
          actionItems.map((item, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 border-t border-neutral-100 first:border-t-0">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: item.dot }} />
              <span className="text-sm text-neutral-800 flex-1">{item.label}</span>
              <span className="tabular-nums font-medium text-neutral-800 text-sm">{fmtMoney(item.amount)}</span>
              <Link href={item.href} className="text-[11.5px] font-medium text-emerald-700 border border-emerald-200 rounded-full px-3 py-1 hover:bg-emerald-50 transition">
                {item.cta}
              </Link>
            </div>
          ))
        )}
      </div>

      {/* Accesos operativa */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { href: "/facturacion/presupuestos", label: "Presupuestos", desc: "Ofertas y conversión" },
          { href: "/facturacion/facturas", label: "Facturas", desc: "Listado y alta" },
          { href: "/facturacion/cobros", label: "Cobros", desc: "Pagos recibidos" },
          { href: "/facturacion/resumen", label: "Resumen ejecutivo", desc: "Finanzas y márgenes" },
        ].map((q) => (
          <Link key={q.href} href={q.href} className="bg-white border border-neutral-100 rounded-xl p-3.5 transition-colors hover:border-[var(--color-primary,#1B3A2D)] block">
            <div className="font-display text-sm text-neutral-900">{q.label}</div>
            <div className="text-[10px] text-neutral-400 mt-0.5">{q.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
