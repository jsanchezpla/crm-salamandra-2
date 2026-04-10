"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

const STATUS_LABELS = {
  draft: { label: "Borrador", cls: "bg-neutral-100 text-neutral-500" },
  sent: { label: "Enviada", cls: "bg-blue-50 text-blue-600" },
  partial: { label: "Pago parcial", cls: "bg-amber-50 text-amber-600" },
  paid: { label: "Cobrada", cls: "bg-emerald-50 text-emerald-600" },
  cancelled: { label: "Cancelada", cls: "bg-red-50 text-red-500" },
};

function fmt(n) {
  return Number(n || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function StatusBadge({ status }) {
  const s = STATUS_LABELS[status] ?? { label: status, cls: "bg-neutral-100 text-neutral-500" };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${s.cls}`}>{s.label}</span>
  );
}

export default function FacturasPage() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Filters
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page, limit });
      if (status) params.set("status", status);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(`/api/billing/invoices?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error");
      setInvoices(json.data?.invoices ?? []);
      setTotal(json.data?.total ?? 0);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [status, from, to, page]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Facturas</h1>
          <p className="text-sm text-neutral-400 mt-0.5">{total} registros</p>
        </div>
        <Link
          href="/facturacion"
          className="text-sm text-neutral-500 hover:text-neutral-700 transition-colors"
        >
          ← Volver
        </Link>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="border border-neutral-200 rounded-lg px-3 py-1.5 text-sm text-neutral-700 focus:outline-none focus:border-neutral-400 bg-white"
        >
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <input
          type="date"
          value={from}
          onChange={(e) => { setFrom(e.target.value); setPage(1); }}
          placeholder="Desde"
          className="border border-neutral-200 rounded-lg px-3 py-1.5 text-sm text-neutral-700 focus:outline-none focus:border-neutral-400"
        />
        <input
          type="date"
          value={to}
          onChange={(e) => { setTo(e.target.value); setPage(1); }}
          placeholder="Hasta"
          className="border border-neutral-200 rounded-lg px-3 py-1.5 text-sm text-neutral-700 focus:outline-none focus:border-neutral-400"
        />
        {(status || from || to) && (
          <button
            onClick={() => { setStatus(""); setFrom(""); setTo(""); setPage(1); }}
            className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors px-2 py-1.5"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600">{error}</div>
      )}

      {/* Tabla */}
      <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-100">
              <th className="text-left px-4 py-3 text-xs font-medium text-neutral-400 uppercase tracking-wide">Número</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-neutral-400 uppercase tracking-wide">Cliente</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-neutral-400 uppercase tracking-wide">Terapeuta</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-neutral-400 uppercase tracking-wide">Fecha</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-neutral-400 uppercase tracking-wide">Estado</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-neutral-400 uppercase tracking-wide">Total</th>
            </tr>
          </thead>
          <tbody>
            {loading && invoices.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-12 text-sm text-neutral-400">Cargando...</td>
              </tr>
            )}
            {!loading && invoices.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-12 text-sm text-neutral-400">Sin resultados</td>
              </tr>
            )}
            {invoices.map((inv) => (
              <tr key={inv.id} className="border-b border-neutral-50 hover:bg-neutral-50/50 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-neutral-600">{inv.number ?? "—"}</td>
                <td className="px-4 py-3 text-neutral-700">{inv.client?.name ?? inv.clientId ?? "—"}</td>
                <td className="px-4 py-3 text-neutral-500 text-xs">{inv.therapist?.displayName ?? "—"}</td>
                <td className="px-4 py-3 text-neutral-500 text-xs">{inv.issueDate?.slice(0, 10) ?? "—"}</td>
                <td className="px-4 py-3"><StatusBadge status={inv.status} /></td>
                <td className="px-4 py-3 text-right font-semibold text-neutral-800">{fmt(inv.total)} €</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Paginación */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-neutral-100">
            <span className="text-xs text-neutral-400">Página {page} de {totalPages}</span>
            <div className="flex gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-xs border border-neutral-200 rounded-md hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Anterior
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 text-xs border border-neutral-200 rounded-md hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
