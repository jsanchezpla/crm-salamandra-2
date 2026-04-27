"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

const STATUS_OPTIONS = [
  { key: "stock", label: "En stock", dot: "bg-emerald-400", bg: "bg-emerald-100 text-emerald-700" },
  { key: "partial", label: "Parcial", dot: "bg-amber-400", bg: "bg-amber-100 text-amber-700" },
  { key: "sold", label: "Vendido", dot: "bg-gray-400", bg: "bg-gray-100 text-gray-600" },
];

const STATUS_STYLE = {
  stock: { dot: "bg-emerald-400", bg: "bg-emerald-100 text-emerald-700" },
  partial: { dot: "bg-amber-400", bg: "bg-amber-100 text-amber-700" },
  sold: { dot: "bg-gray-400", bg: "bg-gray-100 text-gray-600" },
};

function fmt(n, decimals = 2) {
  if (n === null || n === undefined || n === "") return "—";
  return parseFloat(n).toLocaleString("es-ES", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtDate(d) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

function computeMargin(product) {
  const outputKg = parseFloat(product.outputKg || 0);
  if (outputKg <= 0) return null;
  const sale = parseFloat(product.salePrice || 0);
  const buy = parseFloat(product.purchasePrice || 0);
  return (sale - buy) * outputKg;
}

const EMPTY_FORM = {
  productName: "", supplier: "", entryDate: "", units: "", kg: "", packaging: "", lot: "", purchasePrice: "",
  outputName: "", clientId: "", exitDate: "", outputKg: "", salePrice: "", notes: "",
};

export default function InventarioPage() {
  const [products, setProducts] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterClientId, setFilterClientId] = useState("");
  const [page, setPage] = useState(1);
  const [stats, setStats] = useState(null);
  const [clients, setClients] = useState([]);
  const [exporting, setExporting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [salida, setSalida] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchProducts = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ page, limit: "50" });
    if (search.trim()) params.set("search", search.trim());
    if (filterStatus) params.set("status", filterStatus);
    if (filterClientId) params.set("clientId", filterClientId);
    fetch(`/api/inventory?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setProducts(data.data.products);
          setTotal(data.data.total);
        }
      })
      .finally(() => setLoading(false));
  }, [search, filterStatus, filterClientId, page]);

  useEffect(() => {
    const t = setTimeout(fetchProducts, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [fetchProducts]);

  useEffect(() => {
    fetch("/api/inventory/stats")
      .then((r) => r.json())
      .then((data) => { if (data.ok) setStats(data.data); });
  }, [products]);

  useEffect(() => {
    fetch("/api/clients?limit=200")
      .then((r) => r.json())
      .then((data) => { if (data.ok) setClients(data.data.clients || []); });
  }, []);

  function openCreate() {
    setEditingProduct(null);
    setForm(EMPTY_FORM);
    setSalida(false);
    setModalOpen(true);
  }

  function openEdit(product) {
    setEditingProduct(product);
    setForm({
      productName: product.productName || "",
      supplier: product.supplier || "",
      entryDate: product.entryDate || "",
      units: product.units ?? "",
      kg: product.kg ?? "",
      packaging: product.packaging || "",
      lot: product.lot || "",
      purchasePrice: product.purchasePrice ?? "",
      outputName: product.outputName || "",
      clientId: product.clientId || "",
      exitDate: product.exitDate || "",
      outputKg: product.outputKg ?? "",
      salePrice: product.salePrice ?? "",
      notes: product.notes || "",
    });
    setSalida(!!(product.outputKg || product.exitDate || product.clientId || product.outputName));
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.productName.trim()) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        units: form.units !== "" ? parseInt(form.units) : null,
        kg: form.kg !== "" ? parseFloat(form.kg) : null,
        purchasePrice: form.purchasePrice !== "" ? parseFloat(form.purchasePrice) : null,
        outputKg: form.outputKg !== "" ? parseFloat(form.outputKg) : null,
        salePrice: form.salePrice !== "" ? parseFloat(form.salePrice) : null,
        clientId: form.clientId || null,
      };

      const url = editingProduct ? `/api/inventory/${editingProduct.id}` : "/api/inventory";
      const method = editingProduct ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.ok) {
        fetchProducts();
        setModalOpen(false);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm("¿Eliminar este producto?")) return;
    await fetch(`/api/inventory/${id}`, { method: "DELETE" });
    setProducts((prev) => prev.filter((p) => p.id !== id));
    setTotal((prev) => prev - 1);
  }

  async function handleExport() {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set("status", filterStatus);
      if (filterClientId) params.set("clientId", filterClientId);
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/inventory/export?${params}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `inventario_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  const totalPages = Math.ceil(total / 50);

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="px-4 lg:px-8 pt-6 lg:pt-8 pb-0">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-gray-900 text-xl font-semibold">Inventario</h1>
            <p className="text-gray-500 text-sm mt-0.5">{total} producto{total !== 1 ? "s" : ""} en total</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/inventario/stats"
              className="flex items-center gap-2 bg-white border border-gray-200 hover:border-gray-300 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors shadow-sm"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
              </svg>
              <span className="hidden sm:inline">Estadísticas</span>
            </Link>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center gap-2 bg-white border border-gray-200 hover:border-gray-300 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors shadow-sm disabled:opacity-50"
            >
              {exporting ? (
                <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M12 3v13.5m0 0l-4.5-4.5M12 16.5l4.5-4.5" />
                </svg>
              )}
              <span className="hidden sm:inline">Exportar</span>
            </button>
            <button
              onClick={openCreate}
              className="flex items-center gap-2 bg-[var(--color-primary)] hover:opacity-90 text-white text-sm font-medium px-4 py-2 rounded-lg transition-opacity shadow-sm"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Nuevo producto
            </button>
          </div>
        </div>

        {/* KPI cards */}
        {stats && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            {[
              { label: "Stock disponible", value: `${fmt(stats.totalKgStock, 1)} kg`, sub: null, color: "text-emerald-600" },
              { label: "Total vendido", value: `${fmt(stats.totalKgSold, 1)} kg`, sub: null, color: "text-blue-600" },
              { label: "Ingresos totales", value: `${fmt(stats.totalRevenue)} €`, sub: null, color: "text-gray-900" },
              {
                label: "Margen total",
                value: `${fmt(stats.totalMargin)} €`,
                sub: `${fmt(stats.marginPercent, 1)}%`,
                color: stats.totalMargin >= 0 ? "text-emerald-600" : "text-red-600",
              },
            ].map((kpi) => (
              <div key={kpi.label} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                <div className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold mb-1">{kpi.label}</div>
                <div className={`text-xl font-semibold ${kpi.color}`}>{kpi.value}</div>
                {kpi.sub && <div className="text-xs text-gray-400 mt-0.5">{kpi.sub}</div>}
              </div>
            ))}
          </div>
        )}

        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="relative flex-1 min-w-[200px]">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder="Buscar por producto, proveedor, lote…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="w-full bg-white border border-gray-200 rounded-lg pl-8 pr-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-[var(--color-primary)] transition-colors shadow-sm"
            />
          </div>
          <select
            value={filterStatus}
            onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
            className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-[var(--color-primary)] shadow-sm"
          >
            <option value="">Todos los estados</option>
            {STATUS_OPTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          {clients.length > 0 && (
            <select
              value={filterClientId}
              onChange={(e) => { setFilterClientId(e.target.value); setPage(1); }}
              className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-[var(--color-primary)] shadow-sm"
            >
              <option value="">Todos los clientes</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.customFields?.company || c.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Tabla */}
      <div className="flex-1 overflow-auto px-4 lg:px-8 pb-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-20 text-gray-400 text-sm">
            No hay productos{filterStatus ? " con este estado" : ""}
          </div>
        ) : (
          <>
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Proveedor</th>
                      <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider hidden md:table-cell">F.Entrada</th>
                      <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Producto</th>
                      <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider hidden lg:table-cell">Lote</th>
                      <th className="text-right px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Kg E.</th>
                      <th className="text-right px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider hidden xl:table-cell">€/kg C.</th>
                      <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider hidden lg:table-cell">Cliente</th>
                      <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider hidden xl:table-cell">F.Salida</th>
                      <th className="text-right px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider hidden md:table-cell">Kg S.</th>
                      <th className="text-right px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider hidden xl:table-cell">€/kg V.</th>
                      <th className="text-right px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider hidden lg:table-cell">Margen €</th>
                      <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Estado</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p, i) => {
                      const st = STATUS_STYLE[p.status] ?? STATUS_STYLE.stock;
                      const margin = computeMargin(p);
                      const clientName = p.client?.customFields?.company || p.client?.name || "—";
                      return (
                        <tr
                          key={p.id}
                          className={`border-b border-gray-50 transition-colors ${i % 2 === 0 ? "hover:bg-gray-50" : "bg-gray-50/50 hover:bg-gray-100/50"}`}
                        >
                          <td className="px-4 py-3">
                            <span className="text-gray-700 truncate max-w-[120px] block">{p.supplier || "—"}</span>
                          </td>
                          <td className="px-4 py-3 hidden md:table-cell text-gray-500 text-xs">{fmtDate(p.entryDate)}</td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900 truncate max-w-[160px]">{p.productName}</div>
                            {p.outputName && p.outputName !== p.productName && (
                              <div className="text-xs text-gray-400 truncate max-w-[160px]">→ {p.outputName}</div>
                            )}
                          </td>
                          <td className="px-4 py-3 hidden lg:table-cell text-gray-500 text-xs">{p.lot || "—"}</td>
                          <td className="px-4 py-3 text-right text-gray-700">{fmt(p.kg, 1)}</td>
                          <td className="px-4 py-3 text-right text-gray-500 hidden xl:table-cell">{fmt(p.purchasePrice)}</td>
                          <td className="px-4 py-3 hidden lg:table-cell">
                            <span className="text-gray-600 truncate max-w-[120px] block">{clientName}</span>
                          </td>
                          <td className="px-4 py-3 hidden xl:table-cell text-gray-500 text-xs">{fmtDate(p.exitDate)}</td>
                          <td className="px-4 py-3 text-right text-gray-700 hidden md:table-cell">{p.outputKg ? fmt(p.outputKg, 1) : "—"}</td>
                          <td className="px-4 py-3 text-right text-gray-500 hidden xl:table-cell">{fmt(p.salePrice)}</td>
                          <td className="px-4 py-3 text-right hidden lg:table-cell">
                            {margin !== null ? (
                              <span className={margin >= 0 ? "text-emerald-600" : "text-red-600"}>{fmt(margin)}</span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${st.bg}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                              {STATUS_OPTIONS.find((s) => s.key === p.status)?.label ?? p.status}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => openEdit(p)}
                                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                                title="Editar"
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                                </svg>
                              </button>
                              <button
                                onClick={() => handleDelete(p.id)}
                                className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                title="Eliminar"
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                </svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Paginación */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <span className="text-sm text-gray-500">
                  Página {page} de {totalPages} · {total} productos
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:border-gray-300 transition-colors"
                  >
                    Anterior
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:border-gray-300 transition-colors"
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Modal crear/editar */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">
                {editingProduct ? "Editar producto" : "Nuevo producto"}
              </h2>
              <button
                onClick={() => setModalOpen(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Sección entrada */}
              <div>
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Entrada</div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-500 mb-1">Nombre del producto *</label>
                    <input
                      type="text"
                      value={form.productName}
                      onChange={(e) => setForm((f) => ({ ...f, productName: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Proveedor</label>
                    <input
                      type="text"
                      value={form.supplier}
                      onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Fecha entrada</label>
                    <input
                      type="date"
                      value={form.entryDate}
                      onChange={(e) => setForm((f) => ({ ...f, entryDate: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Kg</label>
                    <input
                      type="number"
                      step="0.001"
                      value={form.kg}
                      onChange={(e) => setForm((f) => ({ ...f, kg: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Unidades</label>
                    <input
                      type="number"
                      value={form.units}
                      onChange={(e) => setForm((f) => ({ ...f, units: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Lote</label>
                    <input
                      type="text"
                      value={form.lot}
                      onChange={(e) => setForm((f) => ({ ...f, lot: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Embalaje</label>
                    <input
                      type="text"
                      value={form.packaging}
                      onChange={(e) => setForm((f) => ({ ...f, packaging: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Precio compra €/kg</label>
                    <input
                      type="number"
                      step="0.01"
                      value={form.purchasePrice}
                      onChange={(e) => setForm((f) => ({ ...f, purchasePrice: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]"
                    />
                  </div>
                </div>
              </div>

              {/* Sección salida (collapsible) */}
              <div className="border border-gray-100 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setSalida((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
                >
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Datos de venta / salida</span>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    className={`w-4 h-4 text-gray-400 transition-transform ${salida ? "rotate-180" : ""}`}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                </button>

                {salida && (
                  <div className="p-4 grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-gray-500 mb-1">Nombre producto salida</label>
                      <input
                        type="text"
                        placeholder="Dejar vacío si es el mismo"
                        value={form.outputName}
                        onChange={(e) => setForm((f) => ({ ...f, outputName: e.target.value }))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-gray-500 mb-1">Cliente</label>
                      <select
                        value={form.clientId}
                        onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]"
                      >
                        <option value="">Sin cliente</option>
                        {clients.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.customFields?.company || c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Fecha salida</label>
                      <input
                        type="date"
                        value={form.exitDate}
                        onChange={(e) => setForm((f) => ({ ...f, exitDate: e.target.value }))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Kg salida</label>
                      <input
                        type="number"
                        step="0.001"
                        value={form.outputKg}
                        onChange={(e) => setForm((f) => ({ ...f, outputKg: e.target.value }))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-gray-500 mb-1">Precio venta €/kg</label>
                      <input
                        type="number"
                        step="0.01"
                        value={form.salePrice}
                        onChange={(e) => setForm((f) => ({ ...f, salePrice: e.target.value }))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Notas */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Notas</label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)] resize-none"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex gap-2">
              <button
                onClick={handleSave}
                disabled={!form.productName.trim() || saving}
                className="flex-1 bg-[var(--color-primary)] hover:opacity-90 text-white text-sm font-medium py-2 rounded-lg transition-opacity disabled:opacity-40"
              >
                {saving ? "Guardando…" : editingProduct ? "Guardar cambios" : "Crear producto"}
              </button>
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
