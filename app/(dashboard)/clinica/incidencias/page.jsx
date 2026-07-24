"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Select from "@/components/ui/Select.jsx";
import PreviewBanner from "../_components/PreviewBanner.jsx";
import IncidenciaModal from "../_components/IncidenciaModal.jsx";
import { INCIDENCIA_CATEGORIES } from "@/lib/clinica/incidencias.js";

const STATUS_TABS = [
  { key: "", label: "Todas" },
  { key: "pending", label: "Pendientes" },
  { key: "in_progress", label: "En proceso" },
  { key: "resolved", label: "Resueltas" },
];
const STATUS_PILL = {
  amber: "bg-amber-50 text-amber-700",
  blue: "bg-blue-50 text-blue-700",
  green: "bg-emerald-50 text-emerald-700",
  gray: "bg-neutral-100 text-neutral-500",
};
const PRIORITY_DOT = { high: "bg-red-500", medium: "bg-amber-400", low: "bg-neutral-300" };
const fmt = (d) => (d ? new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }) : "—");

export default function IncidenciasPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statusTab, setStatusTab] = useState("");
  const [category, setCategory] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [modal, setModal] = useState(null); // { mode, incidencia }
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j.ok) setIsAdmin(["admin", "superadmin"].includes(j.data?.role)); })
      .catch(() => {});
  }, []);

  const load = () => {
    setLoading(true); setErrorMsg(null);
    const params = new URLSearchParams();
    if (statusTab) params.set("status", statusTab);
    if (category) params.set("category", category);
    fetch(`/api/clinica/incidencias?${params}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j.ok) setData(j.data); else setErrorMsg(j.error); })
      .catch((e) => setErrorMsg(e.message))
      .finally(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [statusTab, category]);

  const rows = data?.incidencias ?? [];
  const counts = data?.counts ?? { pending: 0, in_progress: 0, resolved: 0 };
  const totalCount = counts.pending + counts.in_progress + counts.resolved;
  const tabCount = (k) => (k === "" ? totalCount : counts[k] ?? 0);

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-5">
      <Link href="/clinica" className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-[var(--color-primary,#1B3A2D)] transition-colors w-fit">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        Volver a Clínica
      </Link>

      <PreviewBanner />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="eyebrow">Clínica · Incidencias</div>
          <h1 className="font-display text-2xl lg:text-4xl text-[var(--ink-900)] tracking-tight mt-1">Incidencias</h1>
          <p className="text-xs text-neutral-400 mt-1">Registro y seguimiento de incidencias del equipo.</p>
        </div>
        <button
          onClick={() => setModal({ mode: "create", incidencia: null })}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-4 py-2 rounded-lg text-white hover:opacity-90 transition-opacity self-start lg:self-auto"
          style={{ background: "var(--color-primary, #1B3A2D)" }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
          Nueva incidencia
        </button>
      </div>

      {errorMsg && <div className="px-4 py-3 rounded-lg bg-rose-50 border border-rose-100 text-xs text-rose-700">{errorMsg}</div>}

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_TABS.map((t) => (
            <button key={t.key} onClick={() => setStatusTab(t.key)}
              className={`text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors ${statusTab === t.key ? "text-white" : "bg-white border border-neutral-200 text-neutral-600 hover:border-neutral-300"}`}
              style={statusTab === t.key ? { background: "var(--color-primary, #1B3A2D)" } : undefined}>
              {t.label} <span className="opacity-70">· {tabCount(t.key)}</span>
            </button>
          ))}
        </div>
        <div className="sm:ml-auto">
          <Select value={category} onChange={setCategory}
            options={[{ value: "", label: "Todas las categorías" }, ...INCIDENCIA_CATEGORIES.map((c) => ({ value: c.key, label: c.label }))]}
            className="text-xs border border-neutral-200 rounded-lg px-3 py-2 bg-white hover:border-neutral-300 cursor-pointer" />
        </div>
      </div>

      {/* Lista */}
      <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
        {loading ? (
          <p className="px-4 py-10 text-center text-neutral-400 text-sm">Cargando…</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-neutral-400 text-sm">No hay incidencias{statusTab || category ? " con estos filtros" : ""}.</p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {rows.map((r) => (
              <li key={r.id}>
                <button onClick={() => setModal({ mode: "view", incidencia: r })} className="w-full text-left px-4 lg:px-5 py-3 hover:bg-neutral-50/60 transition-colors flex items-center gap-3">
                  <span className={`shrink-0 w-2 h-2 rounded-full ${PRIORITY_DOT[r.priority] ?? "bg-neutral-300"}`} title={`Prioridad ${r.priorityLabel}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-[var(--ink-900)] font-medium truncate">{r.title}</span>
                      <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-500">{r.categoryLabel}{r.subcategory ? ` · ${r.subcategory}` : ""}</span>
                    </div>
                    <div className="text-[11px] text-neutral-400 mt-0.5 truncate">
                      {fmt(r.date)}
                      {r.patient ? ` · ${r.patient.name}` : ""}
                      {r.assignedTo ? ` · ${r.assignedTo.name}` : " · sin asignar"}
                    </div>
                  </div>
                  <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full ${STATUS_PILL[r.statusLevel] ?? STATUS_PILL.gray}`}>{r.statusLabel}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {modal && (
        <IncidenciaModal
          mode={modal.mode}
          incidencia={modal.incidencia}
          therapists={data?.therapists ?? []}
          patients={data?.patients ?? []}
          isAdmin={isAdmin}
          onClose={() => setModal(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
