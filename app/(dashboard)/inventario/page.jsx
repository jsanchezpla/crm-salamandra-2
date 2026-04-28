"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { fmt, fmtDate } from "../../../lib/utils/format.js";
import { computeMargin, hasOutput } from "../../../lib/inventory/compute.js";

function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

const STATUS_OPTIONS = [
  { key: "stock", label: "En stock", dot: "bg-emerald-400", bg: "bg-emerald-100 text-emerald-700" },
  { key: "partial", label: "Parcial", dot: "bg-amber-400", bg: "bg-amber-100 text-amber-700" },
  { key: "sold", label: "Vendido", dot: "bg-gray-400", bg: "bg-gray-100 text-gray-600" },
];

const STATUS_BY_KEY = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.key, s]));

const TABS = [
  { key: "raw", label: "Materia prima" },
  { key: "formulated", label: "Producto formulado" },
];

const EMPTY_FORM = {
  productName: "", supplier: "", entryDate: "", units: "", kg: "", packaging: "", lot: "", purchasePrice: "",
  outputName: "", clientId: "", exitDate: "", outputKg: "", salePrice: "", notes: "",
};

export default function InventarioPage() {
  const [products, setProducts] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("raw");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
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

  const [detailId, setDetailId] = useState(null);

  const fetchProducts = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ page, limit: "50" });
    if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
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
  }, [debouncedSearch, filterStatus, filterClientId, page]);

  const fetchStats = useCallback(() => {
    fetch("/api/inventory/stats")
      .then((r) => r.json())
      .then((data) => { if (data.ok) setStats(data.data); });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  useEffect(() => {
    fetchStats();
    fetch("/api/clients?limit=200")
      .then((r) => r.json())
      .then((data) => { if (data.ok) setClients(data.data.clients || []); });
  }, [fetchStats]);

  const detailProduct = useMemo(
    () => (detailId ? products.find((p) => p.id === detailId) ?? null : null),
    [detailId, products]
  );

  useEffect(() => {
    if (!detailId && !modalOpen) return;
    function onKey(e) {
      if (e.key !== "Escape") return;
      if (modalOpen) setModalOpen(false);
      else if (detailId) setDetailId(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailId, modalOpen]);

  const visibleProducts = useMemo(() => {
    if (tab === "formulated") return products.filter(hasOutput);
    return products;
  }, [products, tab]);

  function openCreate() {
    setEditingProduct(null);
    setForm(EMPTY_FORM);
    setSalida(tab === "formulated");
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
    setSalida(hasOutput(product));
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
        fetchStats();
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
    if (detailId === id) setDetailId(null);
    fetchStats();
  }

  async function handleExport() {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set("status", filterStatus);
      if (filterClientId) params.set("clientId", filterClientId);
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
      const res = await fetch(`/api/inventory/export?${params}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `inventario_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } finally {
      setExporting(false);
    }
  }

  const totalPages = Math.ceil(total / 50);
  const visibleCount = visibleProducts.length;

  return (
    <div className="flex flex-col h-full bg-[var(--color-accent)]">
      {/* Header */}
      <div className="px-4 lg:px-10 pt-5 lg:pt-12 pb-0">
        <div className="flex items-end justify-between mb-5 lg:mb-7 gap-4 flex-wrap">
          <div>
            <div className="eyebrow mb-1.5 lg:mb-2">Operaciones · Inventario</div>
            <h1 className="font-display text-[26px] lg:text-[40px] leading-[1.05] text-[var(--ink-900)] tracking-tight">
              Inventario <span className="font-display-italic text-[var(--ink-400)]">— {total} {total === 1 ? "producto" : "productos"}</span>
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/inventario/stats"
              className="flex items-center gap-2 bg-white border border-[var(--ink-200)] hover:border-[var(--ink-300)] text-[var(--ink-700)] text-[13px] font-medium px-4 py-2 rounded-[var(--radius-control)] transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
              </svg>
              <span className="hidden sm:inline">Estadísticas</span>
            </Link>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center gap-2 bg-white border border-[var(--ink-200)] hover:border-[var(--ink-300)] text-[var(--ink-700)] text-[13px] font-medium px-4 py-2 rounded-[var(--radius-control)] transition-colors disabled:opacity-50"
            >
              {exporting ? (
                <div className="w-4 h-4 border-2 border-[var(--ink-400)] border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M12 3v13.5m0 0l-4.5-4.5M12 16.5l4.5-4.5" />
                </svg>
              )}
              <span className="hidden sm:inline">Exportar</span>
            </button>
            <button
              onClick={openCreate}
              className="flex items-center gap-2 bg-[var(--color-primary)] hover:opacity-90 text-white text-[13px] font-medium px-4 py-2 rounded-[var(--radius-control)] transition-opacity"
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
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-px bg-[var(--ink-200)] border border-[var(--ink-200)] rounded-[var(--radius-card)] overflow-hidden mb-7 shadow-[var(--shadow-card)]">
            {[
              { label: "Stock disponible", value: fmt(stats.totalKgStock, 1), unit: "kg", tone: "text-emerald-700" },
              { label: "Total comprado", value: fmt(stats.totalKgPurchased, 1), unit: "kg", tone: "text-[var(--ink-700)]" },
              { label: "Total vendido", value: fmt(stats.totalKgSold, 1), unit: "kg", tone: "text-blue-700" },
              { label: "Ingresos", value: fmt(stats.totalRevenue), unit: "€", tone: "text-[var(--ink-900)]" },
              {
                label: "Margen total",
                value: fmt(stats.totalMargin),
                unit: "€",
                sub: `${fmt(stats.marginPercent, 1)}%`,
                tone: stats.totalMargin >= 0 ? "text-emerald-700" : "text-red-700",
              },
            ].map((kpi) => (
              <div key={kpi.label} className="bg-white px-5 py-5">
                <div className="text-[10px] text-[var(--ink-400)] uppercase tracking-[0.14em] font-semibold mb-2">{kpi.label}</div>
                <div className={`font-display tabular text-[28px] leading-none ${kpi.tone}`}>
                  {kpi.value}
                  {kpi.unit && <span className="text-[14px] text-[var(--ink-400)] ml-1.5 font-sans">{kpi.unit}</span>}
                </div>
                {kpi.sub && <div className="text-[11px] text-[var(--ink-400)] mt-1.5 tabular">{kpi.sub}</div>}
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-[var(--ink-200)] mb-4">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`relative px-4 py-2.5 text-[14px] font-medium transition-colors ${
                tab === t.key
                  ? "text-[var(--color-primary)]"
                  : "text-[var(--ink-500)] hover:text-[var(--ink-800)]"
              }`}
            >
              {t.label}
              {tab === t.key && (
                <span className="absolute -bottom-px left-0 right-0 h-[2px] bg-[var(--color-primary)] rounded-full" />
              )}
            </button>
          ))}
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="relative flex-1 min-w-[200px]">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder={tab === "raw" ? "Buscar por producto, proveedor, lote…" : "Buscar por producto formulado, cliente…"}
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
          {tab === "formulated" && clients.length > 0 && (
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
        ) : visibleCount === 0 ? (
          <div className="text-center py-20 text-gray-400 text-sm">
            {tab === "formulated"
              ? "No hay productos formulados todavía"
              : `No hay materia prima${filterStatus ? " con este estado" : ""}`}
          </div>
        ) : (
          <>
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                {tab === "raw" ? (
                  <RawMaterialTable
                    products={visibleProducts}
                    onRowClick={(p) => setDetailId(p.id)}
                  />
                ) : (
                  <FormulatedTable
                    products={visibleProducts}
                    onRowClick={(p) => setDetailId(p.id)}
                  />
                )}
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

      {detailProduct && (
        <ProductDetailDrawer
          product={detailProduct}
          onClose={() => setDetailId(null)}
          onEdit={() => { openEdit(detailProduct); setDetailId(null); }}
          onDelete={() => handleDelete(detailProduct.id)}
        />
      )}

      {modalOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center sm:p-4 fade-in"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-xl max-h-[92vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-100 shrink-0">
              <h2 className="font-semibold text-gray-900">
                {editingProduct ? "Editar producto" : "Nuevo producto"}
              </h2>
              <button
                onClick={() => setModalOpen(false)}
                className="w-10 h-10 shrink-0 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
                aria-label="Cerrar"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Sección entrada */}
              <div>
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Materia prima · Entrada</div>
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
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Producto formulado · Salida</span>
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
                      <label className="block text-xs font-medium text-gray-500 mb-1">Nombre producto formulado</label>
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

function RawMaterialTable({ products, onRowClick }) {
  return (
    <table className="w-full text-sm whitespace-nowrap">
      <thead>
        <tr className="border-b border-gray-100 bg-gray-50">
          <Th>Proveedor</Th>
          <Th hidden="md">F.Entrada</Th>
          <Th>Producto</Th>
          <Th hidden="lg">Lote</Th>
          <Th hidden="lg">Embalaje</Th>
          <Th align="right" hidden="md">Unidades</Th>
          <Th align="right">Kg</Th>
          <Th align="right" hidden="xl">€/kg compra</Th>
          <Th align="right" hidden="xl">Coste total</Th>
          <Th>Estado</Th>
        </tr>
      </thead>
      <tbody>
        {products.map((p, i) => {
          const cost = parseFloat(p.kg || 0) * parseFloat(p.purchasePrice || 0);
          return (
            <tr
              key={p.id}
              onClick={() => onRowClick(p)}
              className={`border-b border-gray-50 cursor-pointer transition-colors ${i % 2 === 0 ? "hover:bg-gray-50" : "bg-gray-50/50 hover:bg-gray-100/50"}`}
            >
              <td className="px-4 py-3">
                <span className="text-gray-700 truncate max-w-[140px] block">{p.supplier || "—"}</span>
              </td>
              <td className="px-4 py-3 hidden md:table-cell text-gray-500 text-xs">{fmtDate(p.entryDate)}</td>
              <td className="px-4 py-3">
                <div className="font-medium text-gray-900 truncate max-w-[180px]">{p.productName}</div>
              </td>
              <td className="px-4 py-3 hidden lg:table-cell text-gray-500 text-xs">{p.lot || "—"}</td>
              <td className="px-4 py-3 hidden lg:table-cell text-gray-500 text-xs">{p.packaging || "—"}</td>
              <td className="px-4 py-3 text-right text-gray-600 hidden md:table-cell">{p.units ?? "—"}</td>
              <td className="px-4 py-3 text-right text-gray-700">{fmt(p.kg, 1)}</td>
              <td className="px-4 py-3 text-right text-gray-500 hidden xl:table-cell">{fmt(p.purchasePrice)}</td>
              <td className="px-4 py-3 text-right text-gray-700 hidden xl:table-cell">
                {cost > 0 ? `${fmt(cost)} €` : "—"}
              </td>
              <td className="px-4 py-3">
                <StatusPill status={p.status} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function FormulatedTable({ products, onRowClick }) {
  return (
    <table className="w-full text-sm whitespace-nowrap">
      <thead>
        <tr className="border-b border-gray-100 bg-gray-50">
          <Th>Producto formulado</Th>
          <Th hidden="md">Origen (materia prima)</Th>
          <Th hidden="lg">Cliente</Th>
          <Th hidden="md">F.Salida</Th>
          <Th align="right">Kg salida</Th>
          <Th align="right" hidden="xl">€/kg venta</Th>
          <Th align="right" hidden="lg">Ingresos</Th>
          <Th align="right" hidden="lg">Margen €</Th>
          <Th>Estado</Th>
        </tr>
      </thead>
      <tbody>
        {products.map((p, i) => {
          const margin = computeMargin(p);
          const revenue = parseFloat(p.outputKg || 0) * parseFloat(p.salePrice || 0);
          const clientName = p.client?.customFields?.company || p.client?.name || "—";
          const outName = p.outputName || p.productName;
          return (
            <tr
              key={p.id}
              onClick={() => onRowClick(p)}
              className={`border-b border-gray-50 cursor-pointer transition-colors ${i % 2 === 0 ? "hover:bg-gray-50" : "bg-gray-50/50 hover:bg-gray-100/50"}`}
            >
              <td className="px-4 py-3">
                <div className="font-medium text-gray-900 truncate max-w-[180px]">{outName}</div>
              </td>
              <td className="px-4 py-3 hidden md:table-cell text-gray-500 text-xs truncate max-w-[160px]">
                {p.productName}
              </td>
              <td className="px-4 py-3 hidden lg:table-cell">
                <span className="text-gray-600 truncate max-w-[140px] block">{clientName}</span>
              </td>
              <td className="px-4 py-3 hidden md:table-cell text-gray-500 text-xs">{fmtDate(p.exitDate)}</td>
              <td className="px-4 py-3 text-right text-gray-700">{fmt(p.outputKg, 1)}</td>
              <td className="px-4 py-3 text-right text-gray-500 hidden xl:table-cell">{fmt(p.salePrice)}</td>
              <td className="px-4 py-3 text-right text-gray-700 hidden lg:table-cell">
                {revenue > 0 ? `${fmt(revenue)} €` : "—"}
              </td>
              <td className="px-4 py-3 text-right hidden lg:table-cell">
                {margin !== null ? (
                  <span className={margin >= 0 ? "text-emerald-600" : "text-red-600"}>{fmt(margin)} €</span>
                ) : (
                  <span className="text-gray-300">—</span>
                )}
              </td>
              <td className="px-4 py-3">
                <StatusPill status={p.status} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function StatusPill({ status }) {
  const s = STATUS_BY_KEY[status] ?? STATUS_BY_KEY.stock;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${s.bg}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function Th({ children, align = "left", hidden }) {
  const hide = hidden === "md" ? "hidden md:table-cell"
    : hidden === "lg" ? "hidden lg:table-cell"
    : hidden === "xl" ? "hidden xl:table-cell"
    : "";
  const alignCls = align === "right" ? "text-right" : "text-left";
  return (
    <th className={`${alignCls} px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider ${hide}`}>
      {children}
    </th>
  );
}

function ProductDetailDrawer({ product, onClose, onEdit, onDelete }) {
  const mounted = useMounted();
  const margin = computeMargin(product);
  const cost = parseFloat(product.kg || 0) * parseFloat(product.purchasePrice || 0);
  const revenue = parseFloat(product.outputKg || 0) * parseFloat(product.salePrice || 0);
  const outputCost = parseFloat(product.outputKg || 0) * parseFloat(product.purchasePrice || 0);
  const clientName = product.client?.customFields?.company || product.client?.name || null;
  const showOutput = hasOutput(product);
  const remainingKg = Math.max(0, parseFloat(product.kg || 0) - parseFloat(product.outputKg || 0));

  if (!mounted) return null;

  return createPortal(
    <>
      <div
        className="fixed inset-0 bg-black/50 z-[70] fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="fixed top-0 right-0 bottom-0 w-full sm:max-w-md bg-white shadow-2xl flex flex-col z-[80] overflow-hidden slide-right"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        {/* Barra "Atrás" — solo móvil */}
        <button
          onClick={onClose}
          className="sm:hidden flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-gray-50 text-gray-700 hover:bg-gray-100 transition-colors shrink-0 w-full text-left"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          <span className="text-sm font-medium">Volver al inventario</span>
        </button>

        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-100 flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <div className="mb-1">
              <StatusPill status={product.status} />
            </div>
            <h2 className="font-semibold text-gray-900 text-base truncate">{product.productName}</h2>
            {product.outputName && product.outputName !== product.productName && (
              <p className="text-xs text-gray-500 mt-0.5 truncate">→ {product.outputName}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="hidden sm:flex w-10 h-10 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
            aria-label="Cerrar ficha"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Resumen económico */}
          <div className="grid grid-cols-3 gap-2">
            <MiniKpi label="Coste" value={cost > 0 ? `${fmt(cost)} €` : "—"} color="text-gray-700" />
            <MiniKpi label="Ingresos" value={revenue > 0 ? `${fmt(revenue)} €` : "—"} color="text-blue-600" />
            <MiniKpi
              label="Margen"
              value={margin !== null ? `${fmt(margin)} €` : "—"}
              color={margin === null ? "text-gray-700" : margin >= 0 ? "text-emerald-600" : "text-red-600"}
            />
          </div>

          {/* Materia prima */}
          <Section title="Materia prima · Entrada">
            <Field label="Producto" value={product.productName} />
            <Field label="Proveedor" value={product.supplier} />
            <Field label="Fecha entrada" value={fmtDate(product.entryDate)} />
            <Field label="Lote" value={product.lot} />
            <Field label="Embalaje" value={product.packaging} />
            <Field label="Unidades" value={product.units != null ? product.units : null} />
            <Field label="Kg entrada" value={product.kg ? `${fmt(product.kg, 1)} kg` : null} />
            <Field label="€/kg compra" value={product.purchasePrice ? `${fmt(product.purchasePrice)} €` : null} />
            <Field label="Coste total" value={cost > 0 ? `${fmt(cost)} €` : null} />
          </Section>

          {/* Producto formulado */}
          {showOutput ? (
            <Section title="Producto formulado · Salida">
              <Field label="Producto formulado" value={product.outputName || product.productName} />
              <Field label="Cliente" value={clientName} />
              <Field label="Fecha salida" value={fmtDate(product.exitDate)} />
              <Field label="Kg salida" value={product.outputKg ? `${fmt(product.outputKg, 1)} kg` : null} />
              <Field label="€/kg venta" value={product.salePrice ? `${fmt(product.salePrice)} €` : null} />
              <Field label="Ingresos" value={revenue > 0 ? `${fmt(revenue)} €` : null} />
              <Field label="Coste de lo vendido" value={outputCost > 0 ? `${fmt(outputCost)} €` : null} />
              {product.status === "partial" && (
                <Field label="Stock restante" value={`${fmt(remainingKg, 1)} kg`} />
              )}
            </Section>
          ) : (
            <Section title="Producto formulado · Salida">
              <p className="text-xs text-gray-400 italic">Sin datos de salida — todavía en stock</p>
            </Section>
          )}

          {/* Notas */}
          {product.notes && (
            <Section title="Notas">
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{product.notes}</p>
            </Section>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center gap-2">
          <Link
            href={`/inventario/${product.id}`}
            className="flex-1 flex items-center justify-center gap-1.5 bg-[var(--color-primary)] hover:opacity-90 text-white text-sm font-medium py-2 rounded-lg transition-opacity"
          >
            Ver ficha completa →
          </Link>
          <button
            onClick={onEdit}
            className="px-4 py-2 flex items-center gap-1.5 border border-gray-200 hover:border-gray-300 text-gray-700 text-sm font-medium rounded-lg transition-colors"
            aria-label="Editar"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
            </svg>
          </button>
          <button
            onClick={onDelete}
            className="px-3 py-2 text-red-500 hover:text-red-700 border border-red-100 hover:border-red-200 rounded-lg transition-colors"
            aria-label="Eliminar"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
          </button>
        </div>
      </aside>
    </>,
    document.body
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">{title}</div>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function Field({ label, value }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className="text-gray-900 text-right break-words">{value}</span>
    </div>
  );
}

function MiniKpi({ label, value, color }) {
  return (
    <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
      <div className="text-[9px] text-gray-400 uppercase tracking-wider font-semibold mb-1">{label}</div>
      <div className={`text-sm font-semibold ${color}`}>{value}</div>
    </div>
  );
}
