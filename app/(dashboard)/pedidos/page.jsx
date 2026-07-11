"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Select from "@/components/ui/Select.jsx";

const STATUSES = [
  { key: "draft", label: "Borrador" },
  { key: "confirmed", label: "Confirmado" },
  { key: "preparing", label: "En preparación" },
  { key: "shipped", label: "Enviado" },
  { key: "completed", label: "Completado" },
  { key: "cancelled", label: "Cancelado" },
];

const STATUS_STYLE = {
  draft: { dot: "bg-gray-400", bg: "bg-gray-100 text-gray-600" },
  confirmed: { dot: "bg-blue-400", bg: "bg-blue-100 text-blue-700" },
  preparing: { dot: "bg-amber-400", bg: "bg-amber-100 text-amber-700" },
  shipped: { dot: "bg-violet-400", bg: "bg-violet-100 text-violet-700" },
  completed: { dot: "bg-emerald-500", bg: "bg-emerald-100 text-emerald-700" },
  cancelled: { dot: "bg-red-400", bg: "bg-red-100 text-red-600" },
};

function fmtMoney(v) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(v || 0));
}
function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

export default function PedidosPage() {
  const router = useRouter();
  const [orders, setOrders] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeStatus, setActiveStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [clients, setClients] = useState([]);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "100" });
    if (activeStatus !== "all") params.set("status", activeStatus);
    if (search.trim()) params.set("search", search.trim());
    fetch(`/api/orders?${params}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          setOrders(j.data.orders ?? []);
          setTotal(j.data.total ?? 0);
        }
      })
      .finally(() => setLoading(false));
  }, [activeStatus, search]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  // Cargar clientes para el selector de "Nuevo pedido"
  useEffect(() => {
    fetch("/api/clients?limit=200")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setClients(j.data.clients ?? []);
      });
  }, []);

  const statusCounts = orders.reduce((acc, o) => {
    acc[o.status] = (acc[o.status] || 0) + 1;
    return acc;
  }, {});

  async function createOrder(clientId) {
    setCreating(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, lines: [] }),
      });
      const j = await res.json();
      if (j.ok) {
        router.push(`/pedidos/${j.data.id}`);
      } else {
        alert(j.error || "Error creando pedido");
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--color-accent)]">
      <div className="px-4 lg:px-10 pt-8 pb-5 shrink-0 border-b border-[var(--ink-200)] flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-1.5 lg:mb-2">Operaciones · Pedidos</div>
          <h1 className="font-display text-[24px] lg:text-[34px] leading-[1.05] text-[var(--ink-900)] tracking-tight">
            Pedidos <span className="font-display-italic text-[var(--ink-400)]">— {total} en total</span>
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href="/pedidos/configuracion"
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-neutral-200 text-neutral-700 hover:bg-neutral-50 transition"
          >
            Configuración
          </Link>
          <NuevoPedido clients={clients} onCreate={createOrder} creating={creating} />
        </div>
      </div>

      {/* Tabs de estados */}
      <div className="px-4 lg:px-10 py-3 shrink-0 border-b border-neutral-100 flex items-center gap-1 overflow-x-auto bg-white">
        <button
          onClick={() => setActiveStatus("all")}
          className={`text-xs px-2.5 py-1 rounded-md whitespace-nowrap ${
            activeStatus === "all"
              ? "bg-neutral-900 text-white"
              : "text-neutral-500 hover:text-neutral-700"
          }`}
        >
          Todos
        </button>
        {STATUSES.map((s) => (
          <button
            key={s.key}
            onClick={() => setActiveStatus(s.key)}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md whitespace-nowrap ${
              activeStatus === s.key
                ? "bg-neutral-900 text-white"
                : "text-neutral-500 hover:text-neutral-700"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${STATUS_STYLE[s.key].dot}`} />
            {s.label}
            <span className="text-[10px] text-neutral-400">{statusCounts[s.key] ?? 0}</span>
          </button>
        ))}
      </div>

      {/* Buscador */}
      <div className="px-4 lg:px-10 py-3 shrink-0 border-b border-neutral-100">
        <input
          type="text"
          placeholder="Buscar por nombre de cliente…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-md border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-[var(--color-primary)] placeholder:text-gray-300"
        />
      </div>

      {/* Tabla */}
      <div className="flex-1 overflow-auto px-4 lg:px-10 py-6">
        {loading ? (
          <div className="text-sm text-neutral-400">Cargando…</div>
        ) : orders.length === 0 ? (
          <div className="text-sm text-neutral-400">
            No hay pedidos en este filtro. Crea uno con &quot;Nuevo pedido&quot;.
          </div>
        ) : (
          <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-neutral-50 border-b border-neutral-200">
                  <th className="text-left font-medium text-neutral-500 px-4 py-2.5">Cliente</th>
                  <th className="text-left font-medium text-neutral-500 px-4 py-2.5 hidden md:table-cell">Líneas</th>
                  <th className="text-right font-medium text-neutral-500 px-4 py-2.5">Total</th>
                  <th className="text-left font-medium text-neutral-500 px-4 py-2.5">Estado</th>
                  <th className="text-left font-medium text-neutral-500 px-4 py-2.5 hidden sm:table-cell">Creado</th>
                  <th className="text-left font-medium text-neutral-500 px-4 py-2.5 hidden lg:table-cell">Programado</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const st = STATUS_STYLE[o.status] ?? STATUS_STYLE.draft;
                  const statusLabel = STATUSES.find((s) => s.key === o.status)?.label ?? o.status;
                  const lineCount = o.lines?.length ?? 0;
                  return (
                    <tr
                      key={o.id}
                      onClick={() => router.push(`/pedidos/${o.id}`)}
                      className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50 cursor-pointer"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-neutral-800">{o.client?.name || "—"}</div>
                        <div className="text-[11px] text-neutral-400">
                          {o.client?.customFields?.company || ""}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-neutral-600 hidden md:table-cell">
                        {lineCount} {lineCount === 1 ? "línea" : "líneas"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-neutral-800">
                        {fmtMoney(o.total)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${st.bg}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                          {statusLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-neutral-500 hidden sm:table-cell">{fmtDate(o.createdAt)}</td>
                      <td className="px-4 py-3 text-neutral-500 hidden lg:table-cell">{fmtDate(o.scheduledDate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function NuevoPedido({ clients, onCreate, creating }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0F0F0F] text-white text-xs font-medium rounded-md hover:bg-[#222] transition-colors"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        Nuevo pedido
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 bg-white border border-neutral-200 rounded-lg shadow-lg z-20 w-72 p-3">
            <label className="block text-[11px] font-medium text-neutral-500 mb-1.5">
              Cliente
            </label>
            <Select
              value={selected}
              onChange={(v) => setSelected(v)}
              options={[
                { value: "", label: "— Selecciona un cliente —" },
                ...clients.map((c) => ({
                  value: c.id,
                  label: `${c.name}${c.customFields?.company ? ` (${c.customFields.company})` : ""}`,
                })),
              ]}
              className="w-full border border-neutral-200 rounded-md px-2 py-1.5 text-sm mb-2 focus:outline-none focus:border-[var(--color-primary)]"
            />
            <button
              onClick={() => selected && onCreate(selected)}
              disabled={!selected || creating}
              className="w-full bg-[var(--color-primary)] text-white text-xs font-medium py-1.5 rounded-md hover:opacity-90 disabled:opacity-40"
            >
              {creating ? "Creando…" : "Crear pedido"}
            </button>
            {clients.length === 0 && (
              <p className="text-[11px] text-neutral-400 mt-2">
                No hay clientes. Crea uno desde la pestaña Clientes primero.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
