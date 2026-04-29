"use client";

import { useEffect, useState } from "react";

function fmtMoney(n) {
  if (n == null) return "—";
  return `${Number(n).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/**
 * Resumen de facturación del empleado para mostrar en su detalle.
 * Por defecto carga el último trimestre. Si el módulo billing no está
 * activo, no renderiza nada.
 */
export default function EmployeeBillingSection({ employeeId, isAdmin }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [period, setPeriod] = useState("quarter"); // quarter | year

  useEffect(() => {
    if (!employeeId) return;
    setLoading(true);
    const today = new Date();
    let from;
    if (period === "year") {
      from = new Date(today.getFullYear(), 0, 1);
    } else {
      const q = Math.floor(today.getMonth() / 3);
      from = new Date(today.getFullYear(), q * 3, 1);
    }
    const to = today;
    const isoFrom = from.toISOString().slice(0, 10);
    const isoTo = to.toISOString().slice(0, 10);

    fetch(`/api/team/${employeeId}/billing-summary?from=${isoFrom}&to=${isoTo}`, { cache: "no-store" })
      .then((r) => {
        if (r.status === 403) { setHidden(true); return null; }
        return r.json();
      })
      .then((j) => { if (j?.ok) setData(j.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [employeeId, period]);

  if (hidden) return null;

  return (
    <div className="border-t border-neutral-100 pt-4 mt-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Facturación</h3>
        <div className="flex items-center gap-1">
          <button onClick={() => setPeriod("quarter")} className={`text-[10px] px-2 py-0.5 rounded ${period === "quarter" ? "bg-neutral-900 text-white" : "text-neutral-400 hover:text-neutral-700"}`}>Trimestre</button>
          <button onClick={() => setPeriod("year")} className={`text-[10px] px-2 py-0.5 rounded ${period === "year" ? "bg-neutral-900 text-white" : "text-neutral-400 hover:text-neutral-700"}`}>Año</button>
        </div>
      </div>

      {loading && !data && <div className="text-xs text-neutral-400">Cargando...</div>}

      {data && (
        <div className="space-y-2">
          <Row label="Facturado" value={fmtMoney(data.billedBase)} sub={`${data.invoiceCount} facturas`} />
          <Row label="Coste salarial registrado" value={fmtMoney(data.costTotal)} />
          {isAdmin && data.employee?.monthlySalary != null && (
            <Row label="Salario mensual" value={fmtMoney(data.employee.monthlySalary)} sub="Solo informativo" />
          )}
          {isAdmin && data.projectedSalaryCost != null && (
            <Row label="Salario proyectado periodo" value={fmtMoney(data.projectedSalaryCost)} />
          )}
          <Row label="Ticket medio" value={fmtMoney(data.averageTicket)} />
        </div>
      )}
    </div>
  );
}

function Row({ label, value, sub }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-neutral-50 last:border-0">
      <div>
        <div className="text-xs text-neutral-700">{label}</div>
        {sub && <div className="text-[10px] text-neutral-400">{sub}</div>}
      </div>
      <div className="text-sm text-neutral-900 tabular font-medium">{value}</div>
    </div>
  );
}
