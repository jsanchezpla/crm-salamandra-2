"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import PeriodPicker, { computeRange } from "../../_components/PeriodPicker.jsx";
import { fmtMoney, fmtPct } from "../../_components/Kpi.jsx";
import { useSortState, SortableTh } from "../../_components/tableSort.jsx";
import ExportButtons from "@/components/billing/ExportButtons.jsx";
import HelpTooltip from "@/components/ui/HelpTooltip.jsx";

export default function AnaliticaEmpleadosPage() {
  const sp = useSearchParams();
  const period = sp.get("period") || "year";
  let from = sp.get("from"), to = sp.get("to");
  if (!from || !to) { const r = computeRange(period); from = r.from; to = r.to; }

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [me, setMe] = useState(null);
  const isAdmin = me?.role === "admin" || me?.role === "superadmin";
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const { sortKey, sortDir, toggle: toggleSort } = useSortState("margin", "desc");

  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).then((j) => j.ok && setMe(j.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!from || !to) return;
    setLoading(true); setErrorMsg(null);
    const params = new URLSearchParams({ from, to, sortBy: sortKey, sortDir });
    fetch(`/api/billing/analytics/employees?${params}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!j.ok) throw new Error(j.error); setRows(j.data?.employees ?? []); })
      .catch((e) => setErrorMsg(e.message))
      .finally(() => setLoading(false));
  }, [from, to, sortKey, sortDir]);

  // Sort viaja al backend; búsqueda libre en cliente sobre el array ordenado.
  const filtered = useMemo(() => {
    if (!search) return rows;
    return rows.filter((r) => {
      const hay = [r.employeeName, r.position].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(search);
    });
  }, [rows, search]);

  const totals = filtered.reduce((acc, r) => ({
    billed: acc.billed + r.billedBase,
    salary: acc.salary + r.salaryCost,
    margin: acc.margin + r.margin,
  }), { billed: 0, salary: 0, margin: 0 });

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="eyebrow">Finanzas · Analítica</div>
          <h1 className="font-display text-2xl lg:text-3xl text-[var(--ink-900)] mt-1 flex items-center gap-2">
            Por empleado
            <HelpTooltip title="Por empleado" placement="bottom">
              Lo que ha facturado cada persona del equipo en estas fechas y lo que ha costado su
              nómina.
              {" "}
              <strong className="text-white">Solo salen las personas con facturas a su nombre</strong>:
              quien no tenga ninguna en el periodo no aparece, aunque haya trabajado. El reparto sale
              de a quién está asignada cada factura, no de quién hizo el trabajo; una factura sin
              nadie asignado no cuenta para nadie.
            </HelpTooltip>
          </h1>
          <p className="text-xs text-neutral-400 mt-1">{from} → {to} · {rows.length} empleados</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/facturacion" className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">← Volver</Link>
          <ExportButtons xlsxUrl={`/api/billing/exports/by-employee?from=${from}&to=${to}`} />
        </div>
      </div>

      <PeriodPicker />

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Buscar por empleado o rol..."
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
                <SortableTh k="employeeName" label="Empleado" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh k="billedBase" label="Facturado (base)" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                <SortableTh k="invoiceCount" label="Facturas" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                <SortableTh k="averageTicket" label="Ticket medio" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                <SortableTh k="salaryCost" label="Coste salarial" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                {isAdmin && (
                  <SortableTh
                    k="projectedSalaryCost"
                    label="Salario proyect."
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onClick={toggleSort}
                    align="right"
                    after={
                      <HelpTooltip title="Salario proyectado" placement="bottom">
                        Su sueldo mensual de la ficha de equipo multiplicado por los meses del
                        periodo. Es una estimación, no un gasto real:
                        {" "}
                        <strong className="text-white">no entra en el margen</strong>, que siempre
                        usa el coste salarial de la columna anterior. Si las dos cifras no se
                        parecen, es que faltan nóminas por apuntar en Gastos.
                      </HelpTooltip>
                    }
                  />
                )}
                <SortableTh k="margin" label="Margen" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                <SortableTh k="cancelledCount" label="Cancelaciones" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {loading && filtered.length === 0 && (
                <tr><td colSpan={isAdmin ? 8 : 7} className="text-center py-12 text-xs text-neutral-400">Cargando...</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={isAdmin ? 8 : 7} className="text-center py-12 text-xs text-neutral-400">{search ? "Sin resultados" : "Sin datos"}</td></tr>
              )}
              {filtered.map((r) => (
                <tr key={r.employeeId} className="border-b border-neutral-50 hover:bg-neutral-50/70 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-neutral-800">{r.employeeName}</div>
                    {r.position && <div className="text-[10px] text-neutral-400">{r.position}</div>}
                  </td>
                  <td className="px-4 py-3 text-right tabular text-neutral-900 font-semibold">{fmtMoney(r.billedBase)}</td>
                  <td className="px-4 py-3 text-right text-neutral-600">{r.invoiceCount}</td>
                  <td className="px-4 py-3 text-right tabular text-neutral-600">{fmtMoney(r.averageTicket)}</td>
                  <td className="px-4 py-3 text-right tabular text-neutral-500">{fmtMoney(r.salaryCost)}</td>
                  {isAdmin && <td className="px-4 py-3 text-right tabular text-neutral-400 text-xs">{r.projectedSalaryCost != null ? fmtMoney(r.projectedSalaryCost) : "—"}</td>}
                  <td className={`px-4 py-3 text-right tabular font-semibold ${r.margin >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                    {fmtMoney(r.margin)}
                    <div className="text-[10px] font-normal text-neutral-400">{fmtPct(r.marginPct)}</div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.cancelledCount > 0 ? <span className="text-amber-600 text-xs">{r.cancelledCount} ({fmtPct(r.cancellationRate)})</span> : <span className="text-neutral-300 text-xs">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            {filtered.length > 1 && (
              <tfoot>
                <tr className="border-t border-neutral-200 bg-neutral-50">
                  <td className="px-4 py-3 font-display">Total</td>
                  <td className="px-4 py-3 text-right tabular font-bold">{fmtMoney(totals.billed)}</td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3 text-right tabular font-semibold">{fmtMoney(totals.salary)}</td>
                  {isAdmin && <td></td>}
                  <td className="px-4 py-3 text-right tabular font-bold text-emerald-700">{fmtMoney(totals.margin)}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
