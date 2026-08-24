"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import HelpTooltip from "../../../../components/ui/HelpTooltip.jsx";
import Link from "next/link";
import Select from "@/components/ui/Select.jsx";
import ExportButtons from "@/components/billing/ExportButtons.jsx";
import { paramsFiltrosGasto, urlConFiltros } from "@/lib/billing/filtrosGasto.js";
import { fmtMoney, fmtDate } from "../_components/Kpi.jsx";
import { useSortState, SortableTh } from "../_components/tableSort.jsx";
import { anchoPantalla } from "@/components/layout/anchoPantalla.js";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

const TYPE_LABELS = {
  salary: "Salario", rent: "Alquiler", software: "Software",
  material: "Material", commission: "Comisión",
  // 'tax' (02/08/2026): IRPF, IVA, IBI y tasas. Lo que se marque aquí es lo que
  // suma la pantalla de Impuestos; antes caía en "Otro" y no se veía.
  tax: "Impuestos", other: "Otro",
};
const CATEGORY_LABELS = { fixed: "Fijo", variable: "Variable", capex: "CAPEX", opex: "OPEX" };

function emptyForm(defaultVat = 21) {
  return {
    type: "other", category: "fixed", description: "",
    taxBase: "", vatRate: defaultVat, vatDeductible: true,
    incurredAt: new Date().toISOString().slice(0, 10),
    employeeId: "", partnerId: "", clientId: "", supplierId: "",
  };
}

// IRPF: un gasto deducible ahorra IRPF, pero el ahorro no es fijo (tipo
// marginal 19%–47%). Ver lib/billing/irpf.js.
const IRPF_MIN = 19;
const IRPF_MAX = 47;
function irpfSaving(base) {
  const b = Number(base) || 0;
  return { min: Math.round(b * IRPF_MIN) / 100, max: Math.round(b * IRPF_MAX) / 100 };
}

export default function CostesPage() {
  const [costs, setCosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const [filterType, setFilterType] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterSupplier, setFilterSupplier] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const { sortKey, sortDir, toggle: toggleSort } = useSortState("incurredAt", "desc");

  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  const [employees, setEmployees] = useState([]);
  const [clients, setClients] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [settings, setSettings] = useState(null);
  const [me, setMe] = useState(null);
  /*
   * Facturar lo hace quien tiene el MÓDULO de Facturación, no solo quien manda
   * (14/08/2026, Rodrigo — la regla, en lib/auth/permisos.js). En Aumenta son
   * Olga y Rosa: rol `user`, y son las que llevan la contabilidad. Esto era
   * `me.role === "admin"` y las dejaba mirando la pantalla entera sin poder
   * pulsar un botón — ni siquiera apuntar un cobro.
   *
   * `Boolean(me)` y no `true`: mientras /api/auth/me va y viene no hay que
   * enseñar botones que a lo mejor luego se quitan.
   */
  const puedeFacturar = Boolean(me);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(() => emptyForm(21));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).then((j) => j.ok && setMe(j.data)).catch(() => {});
    fetch("/api/team?status=all&limit=200", { cache: "no-store" }).then((r) => r.json()).then((j) => setEmployees(j.data?.members ?? [])).catch(() => {});
    fetch("/api/clients?limit=200", { cache: "no-store" }).then((r) => r.json()).then((j) => setClients(j.data?.clients ?? [])).catch(() => {});
    // Solo los activos: la lista sirve para ELEGIR, y aquí no se dan de alta
    // proveedores (eso vive en Facturación → Proveedores).
    fetch("/api/proveedores", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j?.ok) setSuppliers(j.data?.suppliers ?? []); }).catch(() => {});
    fetch("/api/billing/settings", { cache: "no-store" }).then((r) => r.json()).then((j) => setSettings(j.data)).catch(() => {});
  }, []);

  // Los filtros que la pantalla OFRECE de verdad, juntos: de aquí salen tanto la
  // consulta de la tabla como el enlace del Excel, para que no puedan discrepar
  // (ver lib/billing/filtrosGasto.js).
  const filtros = useMemo(() => ({
    type: filterType,
    category: filterCategory,
    supplierId: filterSupplier,
    from: filterFrom,
    to: filterTo,
  }), [filterType, filterCategory, filterSupplier, filterFrom, filterTo]);

  const hayFiltros = Boolean(filterType || filterCategory || filterSupplier || filterFrom || filterTo);

  const load = useCallback(async () => {
    setLoading(true); setErrorMsg(null);
    try {
      const params = paramsFiltrosGasto(filtros, { sortBy: sortKey, sortDir });
      const res = await fetch(`/api/billing/costs?${params}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error");
      setCosts(Array.isArray(json.data) ? json.data : []);
    } catch (e) { setErrorMsg(e.message); } finally { setLoading(false); }
  }, [filtros, sortKey, sortDir]);

  useEffect(() => { load(); }, [load]);

  // El sort y los filtros principales viajan al backend.
  // La búsqueda libre se aplica en cliente sobre el array ya ordenado.
  const filtered = useMemo(() => {
    if (!search) return costs;
    return costs.filter((c) => {
      const hay = [
        c.description, c.type, c.category,
        c.employee?.displayName, c.client?.name, c.supplier?.name,
        c.taxBase?.toString(), c.total?.toString(),
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(search);
    });
  }, [costs, search]);

  const totalBase = filtered.reduce((s, c) => s + Number(c.taxBase || 0), 0);
  const totalVat = filtered.reduce((s, c) => s + Number(c.taxAmount || 0), 0);
  const totalAll = filtered.reduce((s, c) => s + Number(c.total || 0), 0);

  // Dar de baja a un proveedor conserva sus gastos a propósito, y
  // `/api/proveedores` solo devuelve los activos: al editar uno de esos gastos
  // el desplegable no encontraría su valor y saldría el placeholder, como si el
  // gasto no tuviera proveedor, mientras la columna de la tabla sí lo enseña.
  const opcionesProveedor = useMemo(() => {
    const opciones = [
      { value: "", label: "— Sin proveedor —" },
      ...suppliers.map((s) => ({ value: s.id, label: s.name })),
    ];
    const actual = costs.find((c) => c.id === editingId)?.supplier;
    if (actual && !suppliers.some((s) => s.id === actual.id)) {
      opciones.push({ value: actual.id, label: `${actual.name} (de baja)` });
    }
    return opciones;
  }, [suppliers, costs, editingId]);

  // El FILTRO se llena de la misma carga (`/api/proveedores`, solo activos) y
  // aquí los de baja NO hacen falta: a diferencia del formulario, este
  // desplegable nace vacío y solo llega a valer lo que alguien elija de esta
  // lista, así que nunca se queda con un id sin opción que enseñar. A los gastos
  // de un proveedor dado de baja se llega igual por el buscador de al lado, que
  // mira el nombre del proveedor de cada fila.
  const opcionesFiltroProveedor = useMemo(() => ([
    { value: "", label: "Todos los proveedores" },
    ...suppliers.map((s) => ({ value: s.id, label: s.name })),
  ]), [suppliers]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm(settings?.defaultVatRate ?? 21));
    setShowForm(true);
    setFormError(null);
  }
  function openEdit(c) {
    setEditingId(c.id);
    setForm({
      type: c.type, category: c.category, description: c.description ?? "",
      taxBase: Number(c.taxBase ?? 0), vatRate: Number(c.vatRate ?? 0),
      vatDeductible: !!c.vatDeductible, incurredAt: c.incurredAt?.slice(0, 10) ?? "",
      employeeId: c.employeeId ?? "", partnerId: c.partnerId ?? "", clientId: c.clientId ?? "",
      supplierId: c.supplierId ?? "",
    });
    setShowForm(true);
    setFormError(null);
  }
  function closeForm() { setShowForm(false); setEditingId(null); setFormError(null); }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setFormError(null);
    try {
      const payload = {
        type: form.type, category: form.category, description: form.description,
        taxBase: Number(form.taxBase), vatRate: Number(form.vatRate),
        vatDeductible: !!form.vatDeductible, incurredAt: form.incurredAt,
        employeeId: form.employeeId || null, partnerId: form.partnerId || null,
        clientId: form.clientId || null, supplierId: form.supplierId || null,
      };
      const url = editingId ? `/api/billing/costs/${editingId}` : "/api/billing/costs";
      const method = editingId ? "PATCH" : "POST";
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error");
      closeForm();
      load();
    } catch (e) { setFormError(e.message); } finally { setSaving(false); }
  }

  async function handleDelete(id) {
    if (!confirm("¿Eliminar este coste?")) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/billing/costs/${id}`, { method: "DELETE" });
      if (res.status !== 204) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Error");
      }
      load();
    } catch (e) { alert(e.message); } finally { setDeleting(null); }
  }

  // IVA preview
  const previewBase = Number(form.taxBase) || 0;
  const previewVat = Math.round(previewBase * Number(form.vatRate) / 100 * 100) / 100;
  const previewTotal = Math.round((previewBase + previewVat) * 100) / 100;

  // El Excel se baja con los MISMOS filtros que hay puestos en la tabla (sin la
  // búsqueda libre, que se aplica en cliente sobre lo ya cargado).
  const exportUrl = urlConFiltros("/api/billing/exports/expenses", paramsFiltrosGasto(filtros));

  return (
    <div className={anchoPantalla("listado")}>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
        <div>
          <div className="eyebrow">Finanzas · Operativa</div>
          <h1 className="font-display text-2xl text-[var(--ink-900)] mt-1">Costes</h1>
          <p className="text-xs text-neutral-400 mt-1 flex flex-wrap items-center gap-x-1.5">
            <span>
              Total filtrado: <span className="font-semibold text-neutral-700 tabular">{fmtMoney(totalBase)}</span>
              <span className="text-neutral-300"> · IVA {fmtMoney(totalVat)} · Total {fmtMoney(totalAll)}</span>
            </span>
            <HelpTooltip title="Total filtrado" placement="bottom">
              Hay dos «totales» y no son lo mismo. El de la izquierda, en negrita, es la{" "}
              <strong className="text-white">base: el gasto sin IVA</strong>. Lo que de verdad salió
              del banco es el <strong className="text-white">Total</strong> del final.
              {" "}
              Las tres cifras suman solo los gastos que estás viendo ahora: cambian con los filtros
              y con la búsqueda.
            </HelpTooltip>
          </p>
          <p className="text-[11px] text-emerald-700 mt-0.5">
            Ahorro IRPF de estos gastos ({IRPF_MIN}–{IRPF_MAX}%): {fmtMoney(irpfSaving(totalBase).min)} – {fmtMoney(irpfSaving(totalBase).max)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <Link href="/facturacion" className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">← Volver</Link>
          <ExportButtons xlsxUrl={exportUrl} />
          {puedeFacturar && (
            <button onClick={openCreate} className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white"
              style={{ background: "var(--color-primary, #1B3A2D)" }}>+ Nuevo coste</button>
          )}
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Buscar por descripción, empleado, cliente..."
          className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition w-full sm:w-72"
        />
        <Select value={filterType} onChange={(v) => setFilterType(v)} className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400" options={[{ value: "", label: "Todos los tipos" }, ...Object.entries(TYPE_LABELS).map(([k, label]) => ({ value: k, label }))]} />
        <Select value={filterCategory} onChange={(v) => setFilterCategory(v)} className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400" options={[{ value: "", label: "Todas las categorías" }, ...Object.entries(CATEGORY_LABELS).map(([k, label]) => ({ value: k, label }))]} />
        {/* Sin proveedores dados de alta el desplegable solo tendría el «Todos»: se calla. */}
        {suppliers.length > 0 && (
          <Select value={filterSupplier} onChange={(v) => setFilterSupplier(v)} className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400" options={opcionesFiltroProveedor} />
        )}
        <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400" />
        <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400" />
        {(hayFiltros || searchInput) && (
          <button onClick={() => { setFilterType(""); setFilterCategory(""); setFilterSupplier(""); setFilterFrom(""); setFilterTo(""); setSearchInput(""); }}
            className="text-xs text-neutral-400 hover:text-neutral-600 px-2 py-1.5 transition-colors">Limpiar</button>
        )}
      </div>

      {errorMsg && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{errorMsg}</div>
      )}

      {/* Tabla */}
      <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[940px]">
            <thead>
              <tr className="border-b border-neutral-100">
                <SortableTh k="incurredAt" label="Fecha" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh k="type" label="Tipo" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh k="category" label="Categoría" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh k="description" label="Descripción" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh k="employee.displayName" label="Empleado" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh k="supplier.name" label="Proveedor" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh k="taxBase" label="Base" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                <SortableTh k="taxAmount" label="IVA" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                <SortableTh k="total" label="Total" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                {puedeFacturar && <th className="px-4 py-3"></th>}
              </tr>
            </thead>
            <tbody>
              {loading && filtered.length === 0 && (
                <tr><td colSpan={puedeFacturar ? 10 : 9} className="text-center py-12 text-xs text-neutral-400">Cargando...</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={puedeFacturar ? 10 : 9} className="text-center py-12 text-xs text-neutral-400">{search || hayFiltros ? "Sin costes que coincidan con los filtros" : "Sin costes registrados"}</td></tr>
              )}
              {filtered.map((c) => (
                <tr key={c.id} className="border-b border-neutral-50 hover:bg-neutral-50/70 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-neutral-500">{fmtDate(c.incurredAt)}</td>
                  <td className="px-4 py-3 text-xs text-neutral-600">{TYPE_LABELS[c.type] ?? c.type}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-neutral-100 text-neutral-600 border border-neutral-200">
                      {CATEGORY_LABELS[c.category] ?? c.category}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-neutral-700 max-w-[260px] truncate">{c.description}</td>
                  <td className="px-4 py-3 text-xs text-neutral-500">{c.employee?.displayName ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-neutral-500 max-w-[160px] truncate">{c.supplier?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-right text-neutral-700 tabular">{fmtMoney(c.taxBase)}</td>
                  <td className="px-4 py-3 text-right text-neutral-500 tabular text-xs">
                    {fmtMoney(c.taxAmount)} <span className="text-neutral-300">({Number(c.vatRate)}%)</span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-neutral-900 tabular">{fmtMoney(c.total)}</td>
                  {puedeFacturar && (
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => openEdit(c)} className="text-neutral-400 hover:text-neutral-700 transition-colors text-xs mr-2">Editar</button>
                      <button onClick={() => handleDelete(c.id)} disabled={deleting === c.id} className="text-neutral-300 hover:text-red-500 transition-colors text-xs disabled:opacity-40">
                        {deleting === c.id ? "..." : "Eliminar"}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* DRAWER */}
      {showForm && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={closeForm} />
          <aside className="fixed top-14 lg:top-0 right-0 bottom-0 w-full sm:w-[480px] bg-white z-50 shadow-pop overflow-y-auto ink-scroll slide-right">
            <div className="px-6 pt-6 pb-4 border-b border-neutral-100 flex items-start justify-between gap-3">
              <div>
                <div className="eyebrow">{editingId ? "Editar" : "Nuevo"}</div>
                <h2 className="font-display text-xl text-neutral-900 mt-1">{editingId ? "Editar coste" : "Nuevo coste"}</h2>
              </div>
              <button onClick={closeForm} className="text-neutral-300 hover:text-neutral-700 transition-colors p-1">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <FormRow label="Tipo *">
                  <Select value={form.type} onChange={(v) => setForm((f) => ({ ...f, type: v }))} className={inputCls} options={Object.entries(TYPE_LABELS).map(([k, label]) => ({ value: k, label }))} />
                </FormRow>
                <FormRow label="Categoría *">
                  <Select value={form.category} onChange={(v) => setForm((f) => ({ ...f, category: v }))} className={inputCls} options={Object.entries(CATEGORY_LABELS).map(([k, label]) => ({ value: k, label }))} />
                </FormRow>
              </div>
              <FormRow label="Descripción *">
                <input required value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className={inputCls} placeholder="Ej: Sueldo abril — Ana García" />
              </FormRow>
              <FormRow label="Fecha *">
                <input required type="date" value={form.incurredAt} onChange={(e) => setForm((f) => ({ ...f, incurredAt: e.target.value }))} className={inputCls} />
              </FormRow>
              <div className="grid grid-cols-2 gap-3">
                <FormRow label="Base imponible (€) *">
                  <input required type="number" min="0.01" step="0.01" value={form.taxBase} onChange={(e) => setForm((f) => ({ ...f, taxBase: e.target.value }))} className={inputCls} />
                </FormRow>
                <FormRow label="IVA *">
                  <Select value={form.vatRate} onChange={(v) => setForm((f) => ({ ...f, vatRate: v }))} className={inputCls} options={(settings?.availableVatRates ?? [21, 10, 4, 0]).map((rate) => ({ value: rate, label: `${rate}%` }))} />
                </FormRow>
              </div>
              <FormRow label="">
                <label className="flex items-center gap-2 text-xs text-neutral-600">
                  <input type="checkbox" checked={form.vatDeductible} onChange={(e) => setForm((f) => ({ ...f, vatDeductible: e.target.checked }))} />
                  IVA deducible (computa para Modelo 303)
                </label>
              </FormRow>
              <div className="grid grid-cols-2 gap-3">
                <FormRow label="Empleado">
                  <Select value={form.employeeId} onChange={(v) => setForm((f) => ({ ...f, employeeId: v }))} className={inputCls} options={[{ value: "", label: "Quien lo registra" }, ...employees.map((m) => ({ value: m.id, label: m.displayName }))]} />
                </FormRow>
                <FormRow label="Cliente (opcional)">
                  <Select value={form.clientId} onChange={(v) => setForm((f) => ({ ...f, clientId: v }))} className={inputCls} options={[{ value: "", label: "—" }, ...clients.map((c) => ({ value: c.id, label: c.name }))]} />
                </FormRow>
              </div>
              <FormRow label="Proveedor (opcional)">
                <Select value={form.supplierId} onChange={(v) => setForm((f) => ({ ...f, supplierId: v }))} className={inputCls} options={opcionesProveedor} />
                {suppliers.length === 0 && (
                  <span className="text-[11px] text-neutral-400">
                    No hay proveedores dados de alta. Se crean en <Link href="/facturacion/proveedores" className="underline hover:text-neutral-600">Facturación → Proveedores</Link>.
                  </span>
                )}
              </FormRow>
              <FormRow label="Socio (quién se lo desgrava)">
                <Select value={form.partnerId} onChange={(v) => setForm((f) => ({ ...f, partnerId: v }))} className={inputCls} options={[{ value: "", label: "Sin asignar" }, ...(settings?.partners ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
              </FormRow>

              {/* Preview totales */}
              <div className="bg-neutral-50 border border-neutral-100 rounded-lg p-3 text-xs space-y-1">
                <div className="flex justify-between text-neutral-500"><span>Base imponible</span><span className="tabular">{fmtMoney(previewBase)}</span></div>
                <div className="flex justify-between text-neutral-500"><span>IVA {form.vatRate}%</span><span className="tabular">{fmtMoney(previewVat)}</span></div>
                <div className="flex justify-between font-semibold text-neutral-900 pt-1 border-t border-neutral-200"><span>Total</span><span className="tabular">{fmtMoney(previewTotal)}</span></div>
                {previewBase > 0 && (
                  <div className="flex justify-between text-emerald-700 pt-1 border-t border-neutral-100">
                    <span>Ahorro IRPF ({IRPF_MIN}–{IRPF_MAX}%)</span>
                    <span className="tabular">{fmtMoney(irpfSaving(previewBase).min)} – {fmtMoney(irpfSaving(previewBase).max)}</span>
                  </div>
                )}
              </div>

              {formError && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{formError}</div>
              )}

              <div className="flex gap-2 justify-end pt-3 border-t border-neutral-100">
                <button type="button" onClick={closeForm}
                  className="px-4 py-2 text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">Cancelar</button>
                <button type="submit" disabled={saving}
                  className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-50 transition"
                  style={{ background: "var(--color-primary, #1B3A2D)" }}>{saving ? "Guardando..." : (editingId ? "Guardar cambios" : "Crear coste")}</button>
              </div>
            </form>
          </aside>
        </>
      )}
    </div>
  );
}

function FormRow({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">{label}</label>}
      {children}
    </div>
  );
}
