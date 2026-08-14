"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Select from "@/components/ui/Select.jsx";
import ExportButtons from "@/components/billing/ExportButtons.jsx";
import { fmtDate } from "../_components/Kpi.jsx";
import { useSortState, SortableTh } from "../_components/tableSort.jsx";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

const FREQ_LABELS = { weekly: "Semanal", biweekly: "Quincenal", monthly: "Mensual" };

export default function RecurrentesPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
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

  const [clients, setClients] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const { sortKey, sortDir, toggle: toggleSort } = useSortState("nextRunAt", "asc");

  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);
  const [form, setForm] = useState({ clientId: "", frequency: "monthly", nextRunAt: new Date().toISOString().slice(0, 10), description: "", taxBase: "", vatRate: 21 });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).then((j) => j.ok && setMe(j.data)).catch(() => {});
    fetch("/api/clients?limit=200", { cache: "no-store" }).then((r) => r.json()).then((j) => setClients(j.data?.clients ?? [])).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setErrorMsg(null);
    try {
      const params = new URLSearchParams({ sortBy: sortKey, sortDir });
      const res = await fetch(`/api/billing/recurring?${params}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error");
      setItems(Array.isArray(json.data) ? json.data : []);
    } catch (e) { setErrorMsg(e.message); } finally { setLoading(false); }
  }, [sortKey, sortDir]);

  useEffect(() => { load(); }, [load]);

  // Sort en backend; búsqueda libre en cliente sobre el array ya ordenado.
  const filtered = useMemo(() => {
    if (!search) return items;
    return items.filter((r) => {
      const hay = [r.client?.name, r.frequency, r.active ? "activa" : "pausada"].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(search);
    });
  }, [items, search]);

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true); setFormError(null);
    try {
      const payload = {
        clientId: form.clientId,
        frequency: form.frequency,
        nextRunAt: form.nextRunAt,
        templateConfig: {
          description: form.description,
          taxBase: Number(form.taxBase),
          vatRate: Number(form.vatRate),
        },
      };
      const res = await fetch("/api/billing/recurring", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error");
      setForm({ clientId: "", frequency: "monthly", nextRunAt: new Date().toISOString().slice(0, 10), description: "", taxBase: "", vatRate: 21 });
      setShowForm(false);
      load();
    } catch (e) { setFormError(e.message); } finally { setSaving(false); }
  }

  async function toggleActive(item) {
    try {
      const res = await fetch(`/api/billing/recurring/${item.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !item.active }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Error");
      load();
    } catch (e) { alert(e.message); }
  }

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
        <div>
          <div className="eyebrow">Finanzas · Automatización</div>
          <h1 className="font-display text-2xl text-[var(--ink-900)] mt-1">Facturación recurrente</h1>
          <p className="text-xs text-neutral-400 mt-1">{items.length} {items.length === 1 ? "recurrencia" : "recurrencias"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <Link href="/facturacion" className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">← Volver</Link>
          <ExportButtons xlsxUrl="/api/billing/exports/recurring" />
          {puedeFacturar && (
            <button onClick={() => setShowForm(true)} className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white"
              style={{ background: "var(--color-primary, #1B3A2D)" }}>+ Nueva recurrencia</button>
          )}
        </div>
      </div>

      <div className="bg-amber-50 border-2 border-amber-300 rounded-lg px-4 py-3.5 mb-4 text-xs text-amber-900 flex items-start gap-3">
        <svg className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
        <div>
          <div className="font-bold text-sm mb-1">⚠ Las facturas recurrentes NO se emiten automáticamente</div>
          <div className="text-amber-800 leading-relaxed">
            Aquí defines plantillas de recurrencia (cliente, frecuencia, próxima fecha), pero el motor de
            emisión automática <strong>aún no está implementado</strong>. La fecha de «próxima emisión» es
            <strong> orientativa</strong>: tendrás que ir a <a href="/facturacion/facturas" className="underline font-semibold">Facturas</a> y
            crear cada factura manualmente cuando llegue su fecha. Y <strong>esa fecha no avanza al
            facturar</strong>: se queda igual aunque ya la hayas emitido, y aquí no queda constancia de
            lo ya facturado — eso se ve en Facturas. La emisión vía n8n se hará en una iteración futura.
          </div>
        </div>
      </div>

      {/* Búsqueda */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Buscar por cliente, frecuencia, estado..."
          className="rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition w-full sm:w-72"
        />
        {searchInput && (
          <button onClick={() => setSearchInput("")} className="text-xs text-neutral-400 hover:text-neutral-600 px-2 py-1.5 transition-colors">Limpiar</button>
        )}
      </div>

      {errorMsg && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{errorMsg}</div>
      )}

      <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="border-b border-neutral-100">
                <SortableTh k="client.name" label="Cliente" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh k="frequency" label="Frecuencia" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh k="nextRunAt" label="Próxima emisión" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh k="active" label="Estado" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                {puedeFacturar && <th className="px-4 py-3"></th>}
              </tr>
            </thead>
            <tbody>
              {loading && filtered.length === 0 && (
                <tr><td colSpan={puedeFacturar ? 5 : 4} className="text-center py-12 text-xs text-neutral-400">Cargando...</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={puedeFacturar ? 5 : 4} className="text-center py-12 text-xs text-neutral-400">{search ? "Sin resultados" : "Sin recurrencias"}</td></tr>
              )}
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-neutral-50 hover:bg-neutral-50/70 transition-colors">
                  <td className="px-4 py-3 text-neutral-800">{r.client?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-neutral-600">{FREQ_LABELS[r.frequency] ?? r.frequency}</td>
                  <td className="px-4 py-3 text-xs text-neutral-500">{fmtDate(r.nextRunAt)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                      r.active ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-neutral-100 text-neutral-500 border-neutral-200"
                    }`}>{r.active ? "Activa" : "Pausada"}</span>
                  </td>
                  {puedeFacturar && (
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => toggleActive(r)} className="text-xs text-neutral-400 hover:text-neutral-700 transition-colors">
                        {r.active ? "Pausar" : "Activar"}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setShowForm(false)} />
          <aside className="fixed top-14 lg:top-0 right-0 bottom-0 w-full sm:w-[480px] bg-white z-50 shadow-pop overflow-y-auto ink-scroll slide-right">
            <div className="px-6 pt-6 pb-4 border-b border-neutral-100 flex items-start justify-between gap-3">
              <div>
                <div className="eyebrow">Nueva</div>
                <h2 className="font-display text-xl text-neutral-900 mt-1">Nueva recurrencia</h2>
              </div>
              <button onClick={() => setShowForm(false)} className="text-neutral-300 hover:text-neutral-700 transition-colors p-1">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleCreate} className="px-6 py-5 space-y-3">
              <FormRow label="Cliente *">
                <Select
                  value={form.clientId}
                  onChange={(v) => setForm((f) => ({ ...f, clientId: v }))}
                  options={[{ value: "", label: "Selecciona..." }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
                  className={inputCls}
                />
              </FormRow>
              <div className="grid grid-cols-2 gap-3">
                <FormRow label="Frecuencia *">
                  <Select
                    value={form.frequency}
                    onChange={(v) => setForm((f) => ({ ...f, frequency: v }))}
                    options={Object.entries(FREQ_LABELS).map(([k, v]) => ({ value: k, label: v }))}
                    className={inputCls}
                  />
                </FormRow>
                <FormRow label="Próxima emisión *">
                  <input required type="date" value={form.nextRunAt} onChange={(e) => setForm((f) => ({ ...f, nextRunAt: e.target.value }))} className={inputCls} />
                </FormRow>
              </div>
              <FormRow label="Concepto plantilla">
                <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className={inputCls} placeholder="Ej: Cuota mensual servicio X" />
              </FormRow>
              <div className="grid grid-cols-2 gap-3">
                <FormRow label="Base imponible (€)">
                  <input type="number" min="0" step="0.01" value={form.taxBase} onChange={(e) => setForm((f) => ({ ...f, taxBase: e.target.value }))} className={inputCls} />
                </FormRow>
                <FormRow label="IVA %">
                  <input type="number" min="0" max="100" step="0.01" value={form.vatRate} onChange={(e) => setForm((f) => ({ ...f, vatRate: e.target.value }))} className={inputCls} />
                </FormRow>
              </div>

              {formError && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{formError}</div>
              )}
              <div className="flex gap-2 justify-end pt-3 border-t border-neutral-100">
                <button type="button" onClick={() => setShowForm(false)}
                  className="px-4 py-2 text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">Cancelar</button>
                <button type="submit" disabled={saving}
                  className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-50 transition"
                  style={{ background: "var(--color-primary, #1B3A2D)" }}>{saving ? "Guardando..." : "Crear"}</button>
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
      <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">{label}</label>
      {children}
    </div>
  );
}
