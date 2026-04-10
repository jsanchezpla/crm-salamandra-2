"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

const TYPE_LABELS = {
  salary: "Salario",
  rent: "Alquiler",
  software: "Software",
  material: "Material",
  commission: "Comisión",
  other: "Otro",
};

const CATEGORY_LABELS = {
  fixed: "Fijo",
  variable: "Variable",
  capex: "CAPEX",
};

function fmt(n) {
  return Number(n || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const EMPTY_FORM = {
  month: "",
  type: "salary",
  category: "fixed",
  description: "",
  amount: "",
  therapistId: "",
};

export default function CostesPage() {
  const [costs, setCosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Filters
  const [filterMonth, setFilterMonth] = useState("");
  const [filterType, setFilterType] = useState("");

  // Form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  // Delete
  const [deleting, setDeleting] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterMonth) params.set("month", filterMonth);
      if (filterType) params.set("type", filterType);
      const res = await fetch(`/api/billing/costs?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error");
      setCosts(Array.isArray(json.data) ? json.data : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filterMonth, filterType]);

  useEffect(() => { load(); }, [load]);

  const totalAmount = costs.reduce((s, c) => s + Number(c.amount || 0), 0);

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch("/api/billing/costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          amount: Number(form.amount),
          therapistId: form.therapistId || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error");
      setForm(EMPTY_FORM);
      setShowForm(false);
      load();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm("¿Eliminar este coste?")) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/billing/costs/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Error");
      }
      load();
    } catch (e) {
      alert(e.message);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Costes operativos</h1>
          <p className="text-sm text-neutral-400 mt-0.5">
            Total filtrado: <span className="font-semibold text-neutral-700">{fmt(totalAmount)} €</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/facturacion" className="text-sm text-neutral-500 hover:text-neutral-700 transition-colors">
            ← Volver
          </Link>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors"
            style={{ backgroundColor: "var(--color-primary, #4F46E5)" }}
          >
            + Nuevo coste
          </button>
        </div>
      </div>

      {/* Formulario */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-white border border-neutral-200 rounded-xl p-5 mb-5 grid grid-cols-2 gap-4"
        >
          <div className="col-span-2">
            <h2 className="text-sm font-semibold text-neutral-700 mb-1">Nuevo coste</h2>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-500">Mes (YYYY-MM) *</label>
            <input
              required
              pattern="\d{4}-(0[1-9]|1[0-2])"
              value={form.month}
              onChange={(e) => setForm((f) => ({ ...f, month: e.target.value }))}
              placeholder="2026-04"
              className="border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-neutral-400"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-500">Tipo *</label>
            <select
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              className="border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-neutral-400 bg-white"
            >
              {Object.entries(TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-500">Categoría *</label>
            <select
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              className="border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-neutral-400 bg-white"
            >
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-500">Importe (€) *</label>
            <input
              required
              type="number"
              min="0.01"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              placeholder="0.00"
              className="border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-neutral-400"
            />
          </div>
          <div className="col-span-2 flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-500">Descripción *</label>
            <input
              required
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Ej: Sueldo marzo — Ana García"
              className="border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-neutral-400"
            />
          </div>
          <div className="col-span-2 flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-500">ID terapeuta (opcional)</label>
            <input
              value={form.therapistId}
              onChange={(e) => setForm((f) => ({ ...f, therapistId: e.target.value }))}
              placeholder="UUID del miembro del equipo"
              className="border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-neutral-400"
            />
          </div>
          {formError && (
            <div className="col-span-2 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{formError}</div>
          )}
          <div className="col-span-2 flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-sm text-neutral-500 hover:text-neutral-700 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: "var(--color-primary, #4F46E5)" }}
            >
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </form>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 mb-4">
        <input
          type="month"
          value={filterMonth}
          onChange={(e) => setFilterMonth(e.target.value)}
          className="border border-neutral-200 rounded-lg px-3 py-1.5 text-sm text-neutral-700 focus:outline-none focus:border-neutral-400"
        />
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="border border-neutral-200 rounded-lg px-3 py-1.5 text-sm text-neutral-700 focus:outline-none focus:border-neutral-400 bg-white"
        >
          <option value="">Todos los tipos</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        {(filterMonth || filterType) && (
          <button
            onClick={() => { setFilterMonth(""); setFilterType(""); }}
            className="text-xs text-neutral-400 hover:text-neutral-600 px-2 py-1.5"
          >
            Limpiar
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
              <th className="text-left px-4 py-3 text-xs font-medium text-neutral-400 uppercase tracking-wide">Mes</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-neutral-400 uppercase tracking-wide">Tipo</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-neutral-400 uppercase tracking-wide">Categoría</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-neutral-400 uppercase tracking-wide">Descripción</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-neutral-400 uppercase tracking-wide">Terapeuta</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-neutral-400 uppercase tracking-wide">Importe</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && costs.length === 0 && (
              <tr><td colSpan={7} className="text-center py-12 text-sm text-neutral-400">Cargando...</td></tr>
            )}
            {!loading && costs.length === 0 && (
              <tr><td colSpan={7} className="text-center py-12 text-sm text-neutral-400">Sin costes registrados</td></tr>
            )}
            {costs.map((c) => (
              <tr key={c.id} className="border-b border-neutral-50 hover:bg-neutral-50/50 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-neutral-600">{c.month}</td>
                <td className="px-4 py-3 text-xs text-neutral-600">{TYPE_LABELS[c.type] ?? c.type}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${
                    c.category === "fixed" ? "bg-neutral-100 text-neutral-600" :
                    c.category === "capex" ? "bg-blue-50 text-blue-600" :
                    "bg-amber-50 text-amber-600"
                  }`}>
                    {CATEGORY_LABELS[c.category] ?? c.category}
                  </span>
                </td>
                <td className="px-4 py-3 text-neutral-700 max-w-[200px] truncate">{c.description}</td>
                <td className="px-4 py-3 text-xs text-neutral-500">{c.therapist?.displayName ?? "—"}</td>
                <td className="px-4 py-3 text-right font-semibold text-neutral-800">{fmt(c.amount)} €</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => handleDelete(c.id)}
                    disabled={deleting === c.id}
                    className="text-neutral-400 hover:text-red-500 transition-colors disabled:opacity-40 text-xs"
                  >
                    {deleting === c.id ? "..." : "Eliminar"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
