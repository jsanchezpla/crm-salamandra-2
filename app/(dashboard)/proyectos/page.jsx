"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import StatusBadge, { STATUS_OPTIONS } from "../../../components/projects/StatusBadge.jsx";
import PriorityBadge, { PRIORITY_OPTIONS } from "../../../components/projects/PriorityBadge.jsx";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-ES");
}
function fmtMoney(n, currency = "EUR") {
  if (n == null) return "—";
  return `${Number(n).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}
function initials(name) {
  if (!name) return "??";
  return name.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");
}

const EMPTY_FORM = {
  name: "",
  description: "",
  clientId: "",
  status: "draft",
  priority: "medium",
  startDate: "",
  dueDate: "",
  budgetAmount: "",
  budgetCurrency: "EUR",
};

export default function ProyectosPage() {
  const [me, setMe] = useState(null);
  const [projects, setProjects] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterClient, setFilterClient] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const isAdmin = me?.role === "admin" || me?.role === "superadmin";

  // ── Cargar /me ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((j) => { if (!cancelled && j?.ok) setMe(j.data ?? j.user ?? null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // ── Debounce de búsqueda ───────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // ── Cargar clientes (para el selector y filtro) ────────────────────────
  useEffect(() => {
    fetch("/api/clients?limit=200")
      .then((r) => r.json())
      .then((j) => setClients(j?.data?.clients ?? j?.data ?? []))
      .catch(() => {});
  }, []);

  // ── Listar proyectos ───────────────────────────────────────────────────
  const loadProjects = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (filterStatus) params.set("status", filterStatus);
      if (filterClient) params.set("clientId", filterClient);
      if (includeArchived) params.set("includeArchived", "true");
      params.set("limit", "100");

      const r = await fetch(`/api/projects?${params.toString()}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Error cargando proyectos");
      setProjects(j?.data?.projects ?? []);
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setLoading(false);
    }
  }, [search, filterStatus, filterClient, includeArchived]);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  // ── Crear proyecto ─────────────────────────────────────────────────────
  const submitCreate = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setErrorMsg("El nombre es obligatorio");
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        clientId: form.clientId || undefined,
        status: form.status,
        priority: form.priority,
        startDate: form.startDate || undefined,
        dueDate: form.dueDate || undefined,
        budgetAmount: form.budgetAmount ? Number(form.budgetAmount) : undefined,
        budgetCurrency: form.budgetCurrency,
      };
      const r = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Error creando proyecto");
      setForm(EMPTY_FORM);
      setShowCreate(false);
      loadProjects();
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 lg:p-8 max-w-[1400px] mx-auto">
      <header className="flex flex-col lg:flex-row lg:items-end gap-4 mb-6">
        <div className="flex-1">
          <h1 className="font-[Fraunces] text-3xl lg:text-4xl text-neutral-800">Proyectos</h1>
          <p className="text-sm text-neutral-500 mt-1">
            {projects.length} proyecto{projects.length !== 1 ? "s" : ""}
            {filterStatus || filterClient || search ? " (filtrados)" : ""}
          </p>
        </div>
        <button
          onClick={() => { setShowCreate(true); setForm(EMPTY_FORM); }}
          className="px-4 py-2 rounded-lg bg-neutral-800 text-white text-sm font-medium hover:bg-neutral-700 transition"
        >
          + Nuevo proyecto
        </button>
      </header>

      {/* Filtros */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <input
          className={inputCls}
          placeholder="Buscar por nombre o código..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <select
          className={inputCls}
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="">Todos los estados</option>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          className={inputCls}
          value={filterClient}
          onChange={(e) => setFilterClient(e.target.value)}
        >
          <option value="">Todos los clientes</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-neutral-600 px-2">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Mostrar archivados
        </label>
      </div>

      {errorMsg && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-rose-50 border border-rose-100 text-sm text-rose-700">
          {errorMsg}
        </div>
      )}

      {/* Tabla */}
      <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 border-b border-neutral-200">
              <tr className="text-left text-neutral-600">
                <th className="px-4 py-3 font-medium">Código</th>
                <th className="px-4 py-3 font-medium">Nombre</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium">Prioridad</th>
                <th className="px-4 py-3 font-medium">Lead(s)</th>
                <th className="px-4 py-3 font-medium">Fecha límite</th>
                {isAdmin && <th className="px-4 py-3 font-medium text-right">Presupuesto</th>}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-neutral-400">Cargando...</td></tr>
              )}
              {!loading && projects.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-neutral-400">Sin proyectos.</td></tr>
              )}
              {!loading && projects.map((p) => (
                <tr key={p.id} className="border-b border-neutral-100 hover:bg-neutral-50 transition">
                  <td className="px-4 py-3 font-mono text-xs text-neutral-500">{p.code ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Link href={`/proyectos/${p.id}`} className="font-medium text-neutral-800 hover:text-neutral-600">
                      {p.name}
                    </Link>
                    {p.archivedAt && (
                      <span className="ml-2 text-[11px] text-neutral-400">archivado</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-neutral-600">{p.client?.name ?? "—"}</td>
                  <td className="px-4 py-3"><StatusBadge value={p.status} /></td>
                  <td className="px-4 py-3"><PriorityBadge value={p.priority} /></td>
                  <td className="px-4 py-3">
                    <div className="flex -space-x-2">
                      {(p.members ?? []).slice(0, 3).map((m) => (
                        <div
                          key={m.id}
                          className="w-7 h-7 rounded-full bg-neutral-200 border-2 border-white flex items-center justify-center text-[11px] font-medium text-neutral-600"
                          title={m.teamMember?.displayName}
                        >
                          {initials(m.teamMember?.displayName)}
                        </div>
                      ))}
                      {(p.members?.length ?? 0) === 0 && (
                        <span className="text-neutral-400 text-xs">—</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-neutral-600">{fmtDate(p.dueDate)}</td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-right text-neutral-700">
                      {fmtMoney(p.budgetAmount, p.budgetCurrency)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drawer "Nuevo proyecto" */}
      {showCreate && (
        <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setShowCreate(false)}>
          <aside
            className="absolute right-0 top-14 lg:top-0 bottom-0 w-full sm:w-[480px] bg-white shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="px-5 py-4 border-b border-neutral-200 flex items-center justify-between">
              <h2 className="font-[Fraunces] text-xl text-neutral-800">Nuevo proyecto</h2>
              <button onClick={() => setShowCreate(false)} className="text-neutral-400 hover:text-neutral-600 text-xl">×</button>
            </header>
            <form onSubmit={submitCreate} className="flex-1 overflow-y-auto p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Nombre *</label>
                <input
                  className={inputCls}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  maxLength={200}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Descripción</label>
                <textarea
                  className={inputCls}
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Cliente</label>
                <select
                  className={inputCls}
                  value={form.clientId}
                  onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                >
                  <option value="">— Sin cliente (proyecto interno) —</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-neutral-600 mb-1">Estado</label>
                  <select
                    className={inputCls}
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                  >
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-600 mb-1">Prioridad</label>
                  <select
                    className={inputCls}
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: e.target.value })}
                  >
                    {PRIORITY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-neutral-600 mb-1">Inicio</label>
                  <input
                    type="date"
                    className={inputCls}
                    value={form.startDate}
                    onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-600 mb-1">Fecha límite</label>
                  <input
                    type="date"
                    className={inputCls}
                    value={form.dueDate}
                    onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                  />
                </div>
              </div>
              {isAdmin && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-neutral-600 mb-1">Presupuesto</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className={inputCls}
                      value={form.budgetAmount}
                      onChange={(e) => setForm({ ...form, budgetAmount: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-600 mb-1">Moneda</label>
                    <input
                      className={inputCls}
                      maxLength={3}
                      value={form.budgetCurrency}
                      onChange={(e) => setForm({ ...form, budgetCurrency: e.target.value.toUpperCase() })}
                    />
                  </div>
                </div>
              )}
              <div className="pt-2 flex gap-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 px-4 py-2 rounded-lg bg-neutral-800 text-white text-sm font-medium hover:bg-neutral-700 disabled:opacity-50 transition"
                >
                  {submitting ? "Creando..." : "Crear proyecto"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 rounded-lg border border-neutral-200 text-sm text-neutral-600 hover:bg-neutral-50"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </aside>
        </div>
      )}
    </div>
  );
}
