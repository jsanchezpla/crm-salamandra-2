"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import PeriodPicker, { computeRange } from "../../_components/PeriodPicker.jsx";
import { fmtMoney, fmtPct } from "../../_components/Kpi.jsx";
import { useSortState, SortableTh } from "../../_components/tableSort.jsx";
import ExportButtons from "@/components/billing/ExportButtons.jsx";
import HelpTooltip from "@/components/ui/HelpTooltip.jsx";
import { anchoPantalla } from "@/components/layout/anchoPantalla.js";

export default function AnaliticaClientesPage() {
  const sp = useSearchParams();
  const period = sp.get("period") || "year";
  let from = sp.get("from"), to = sp.get("to");
  if (!from || !to) { const r = computeRange(period); from = r.from; to = r.to; }

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const { sortKey, sortDir, toggle: toggleSort } = useSortState("billedBase", "desc");

  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  useEffect(() => {
    if (!from || !to) return;
    setLoading(true); setErrorMsg(null);
    const params = new URLSearchParams({ from, to, sortBy: sortKey, sortDir });
    fetch(`/api/billing/analytics/clients?${params}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!j.ok) throw new Error(j.error); setRows(j.data?.clients ?? []); })
      .catch((e) => setErrorMsg(e.message))
      .finally(() => setLoading(false));
  }, [from, to, sortKey, sortDir]);

  // Sort viaja al backend; búsqueda libre se aplica en cliente sobre el array ordenado
  const filtered = useMemo(() => {
    if (!search) return rows;
    return rows.filter((r) => {
      const hay = [r.clientName, r.taxId].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(search);
    });
  }, [rows, search]);

  const totals = filtered.reduce((acc, r) => ({
    billedBase: acc.billedBase + r.billedBase,
    collectedBase: acc.collectedBase + r.collectedBase,
    pending: acc.pending + r.pendingCollection,
    margin: acc.margin + r.margin,
  }), { billedBase: 0, collectedBase: 0, pending: 0, margin: 0 });

  return (
    <div className={`${anchoPantalla("listado")} space-y-5`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="eyebrow">Finanzas · Analítica</div>
          <h1 className="font-display text-2xl lg:text-3xl text-[var(--ink-900)] mt-1 flex items-center gap-2">
            Por cliente
            <HelpTooltip title="Por cliente" placement="bottom">
              Lo que ha facturado cada cliente en las fechas de arriba.{" "}
              <strong className="text-white">Los importes van sin IVA</strong>, así que no cuadran
              con el total de sus facturas: el IVA pasa por la empresa pero no es suyo. No cuentan
              los borradores ni las anuladas, y solo aparece quien tenga alguna factura en esas
              fechas. El margen solo descuenta los gastos que se apuntaron a ese cliente al
              registrarlos, así que quien no tenga ninguno sale al 100%.
            </HelpTooltip>
          </h1>
          <p className="text-xs text-neutral-400 mt-1">{from} → {to} · {rows.length} clientes</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/facturacion" className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">← Volver</Link>
          <ExportButtons xlsxUrl={`/api/billing/exports/by-client?from=${from}&to=${to}`} />
        </div>
      </div>

      <PeriodPicker />

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Buscar por cliente o NIF/CIF..."
          className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition w-full sm:w-72"
        />
        {searchInput && (
          <button onClick={() => setSearchInput("")} className="text-xs text-neutral-400 hover:text-neutral-600 px-2 py-1.5 transition-colors">Limpiar</button>
        )}
      </div>

      {errorMsg && <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{errorMsg}</div>}

      <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr className="border-b border-neutral-100">
                <SortableTh k="clientName" label="Cliente" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh k="billedBase" label="Facturado" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                <SortableTh k="collectedBase" label="Cobrado" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                <SortableTh k="pendingCollection" label="Pendiente" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                <SortableTh k="imputedCosts" label="Costes imp." sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                <SortableTh k="margin" label="Margen" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                <SortableTh k="invoiceCount" label="Nº fact." sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {loading && filtered.length === 0 && (
                <tr><td colSpan={7} className="text-center py-12 text-xs text-neutral-400">Cargando...</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7} className="text-center py-12 text-xs text-neutral-400">{search ? "Sin resultados" : "Sin datos"}</td></tr>
              )}
              {filtered.map((r) => (
                <tr key={r.clientId} className="border-b border-neutral-50 hover:bg-neutral-50/70 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-neutral-800">{r.clientName}</div>
                    {r.taxId && <div className="text-[10px] text-neutral-400 font-mono">{r.taxId}</div>}
                  </td>
                  <td className="px-4 py-3 text-right tabular text-neutral-700">{fmtMoney(r.billedBase)}</td>
                  <td className="px-4 py-3 text-right tabular text-emerald-700">{fmtMoney(r.collectedBase)}</td>
                  <td className={`px-4 py-3 text-right tabular ${r.pendingCollection > 0 ? "text-amber-700" : "text-neutral-400"}`}>{fmtMoney(r.pendingCollection)}</td>
                  <td className="px-4 py-3 text-right tabular text-neutral-500">{fmtMoney(r.imputedCosts)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className={`tabular font-semibold ${r.margin >= 0 ? "text-emerald-700" : "text-red-600"}`}>{fmtMoney(r.margin)}</div>
                    <div className="text-[10px] text-neutral-400">{fmtPct(r.marginPct)}</div>
                  </td>
                  <td className="px-4 py-3 text-right text-neutral-600">{r.invoiceCount}</td>
                </tr>
              ))}
            </tbody>
            {filtered.length > 1 && (
              <tfoot>
                <tr className="border-t border-neutral-200 bg-neutral-50">
                  <td className="px-4 py-3 font-display">Total</td>
                  <td className="px-4 py-3 text-right tabular font-bold">{fmtMoney(totals.billedBase)}</td>
                  <td className="px-4 py-3 text-right tabular font-bold text-emerald-700">{fmtMoney(totals.collectedBase)}</td>
                  <td className="px-4 py-3 text-right tabular font-bold text-amber-700">{fmtMoney(totals.pending)}</td>
                  <td className="px-4 py-3 text-right">—</td>
                  <td className="px-4 py-3 text-right tabular font-bold text-emerald-700">{fmtMoney(totals.margin)}</td>
                  <td className="px-4 py-3"></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
