"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import PeriodPicker, { computeRange } from "../../_components/PeriodPicker.jsx";
import { fmtMoney } from "../../_components/Kpi.jsx";

export default function PorSocioPage() {
  const sp = useSearchParams();
  const period = sp.get("period") || "year";
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
      const res = await fetch(`/api/billing/analytics/partners?from=${from}&to=${to}`, { cache: "no-store" });
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

  const range = (v) => `${fmtMoney(v.min)} – ${fmtMoney(v.max)}`;

  function Row({ r, combined }) {
    return (
      <div className={`grid grid-cols-[1.2fr_repeat(5,1fr)] gap-2 px-4 py-3 items-center text-[13px] ${combined ? "bg-[var(--color-primary,#1B3A2D)] text-white rounded-lg" : "border-t border-neutral-100"}`}>
        <span className={`font-medium ${combined ? "font-display" : "text-neutral-800"}`}>
          {combined ? "Conjunto" : r.partnerName}
          {!combined && <span className="text-[11px] text-neutral-400 ml-1.5">{r.invoiceCount} fact.</span>}
        </span>
        <span className="text-right tabular-nums">{fmtMoney(r.billedBase)}</span>
        <span className={`text-right tabular-nums ${combined ? "text-white/70" : "text-neutral-500"}`}>{fmtMoney(r.irpfRetained)}</span>
        <span className="text-right tabular-nums">{fmtMoney(r.costBase)}</span>
        <span className={`text-right tabular-nums text-[12px] ${combined ? "text-emerald-200" : "text-emerald-700"}`}>{range(r.irpfSaved)}</span>
        <span className={`text-right tabular-nums font-semibold ${combined ? "" : "text-neutral-900"}`}>{fmtMoney(r.net)}</span>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="eyebrow">Finanzas · Informes</div>
          <h1 className="font-display text-2xl lg:text-4xl text-[var(--ink-900)] tracking-tight mt-1">Por socio</h1>
          <p className="text-xs text-neutral-400 mt-1">
            Lo que ha ganado cada socio y el conjunto. {from} → {to}
          </p>
        </div>
        <PeriodPicker />
      </div>

      {errorMsg && <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{errorMsg}</div>}

      {loading && !data ? (
        <div className="h-40 bg-neutral-100 rounded-xl animate-pulse" />
      ) : data ? (
        <>
          <div className="bg-white border border-neutral-200 rounded-xl p-2">
            <div className="grid grid-cols-[1.2fr_repeat(5,1fr)] gap-2 px-4 py-2 text-[10px] uppercase tracking-wide text-neutral-500 font-semibold">
              <span>Socio</span>
              <span className="text-right">Facturado</span>
              <span className="text-right">IRPF retenido</span>
              <span className="text-right">Gastos</span>
              <span className="text-right">IRPF que ahorra</span>
              <span className="text-right">Neto</span>
            </div>
            {data.partners.length === 0 ? (
              <div className="px-4 py-8 text-sm text-neutral-400 text-center">Sin datos en el periodo.</div>
            ) : (
              data.partners.map((r) => <Row key={r.partnerId || "none"} r={r} />)
            )}
            <div className="mt-2">
              <Row r={data.combined} combined />
            </div>
          </div>

          <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 text-xs text-emerald-800 leading-relaxed">
            <b>Sobre el IRPF que se ahorra:</b> un gasto deducible reduce tu base de IRPF, pero el ahorro real
            no es fijo: depende de tu tipo marginal, que va del <b>{data.marginal.min}%</b> al <b>{data.marginal.max}%</b>.
            Por cada 100 € de gasto deducible te ahorras entre {data.marginal.min} € y {data.marginal.max} € de IRPF
            según tu tramo. Por eso se muestra como rango.
            <br />
            <span className="text-emerald-700/80">
              El <b>IRPF retenido</b> es distinto: es el 15% que el cliente retiene de tus facturas y adelanta a
              Hacienda por ti (pago a cuenta de tu IRPF anual).
            </span>
          </div>
        </>
      ) : null}
    </div>
  );
}
