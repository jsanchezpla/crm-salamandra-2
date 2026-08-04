"use client";

/**
 * NutricionAsignadosModule — listado de planes asignados a pacientes
 * (vista admin). Sprint nutri-laura Recetario C3.
 *
 *   - Tabla en lg+ (paciente · plan · plantilla origen · asignado · acciones).
 *   - Cards apiladas en <lg.
 *   - Buscador por paciente + filtro por plantilla origen.
 *   - Click en fila / botón Editar abre el PlanEditorModal sobre el plan
 *     asignado (independiente de la plantilla origen).
 *
 * En C3 NO se puede asignar desde aquí; el botón "Nueva asignación" vive
 * en la ficha del paciente (C4). Mostramos un mensaje guía si no hay
 * asignaciones.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import PlanEditorModal from "./PlanEditorModal.jsx";
import AssignPlanModal from "./AssignPlanModal.jsx";
import Select from "@/components/ui/Select.jsx";

function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("es-ES", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch { return "—"; }
}

export default function NutricionAsignadosModule() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [templateFilter, setTemplateFilter] = useState("");
  const [templates, setTemplates] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [sendingId, setSendingId] = useState(null);
  const [unassigningId, setUnassigningId] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  // Cargar plantillas para el filtro
  useEffect(() => {
    fetch("/api/nutricion/plans?type=template&limit=100")
      .then((r) => r.json())
      .then((j) => { if (j.ok) setTemplates(j.items || []); });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("type", "assigned");
      params.set("withSummary", "true");
      params.set("limit", "200");
      // q se aplica al name del plan (no al cliente) en el backend. Para
      // filtrar por paciente, hacemos un post-filter en JS.
      const r = await fetch(`/api/nutricion/plans?${params}`);
      const j = await r.json();
      if (j.ok) {
        setItems(j.items || []);
        setTotal(j.total ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Envía el menú (PDF adjunto) al email del paciente. El backend valida que
  // el plan sea asignado y que el paciente tenga email; aquí solo confirmamos
  // y mostramos el resultado.
  const sendMenu = useCallback(async (plan) => {
    if (!confirm(`¿Enviar el menú por email a ${plan.clientName || "el paciente"}?`)) return;
    setSendingId(plan.id);
    try {
      const r = await fetch(`/api/nutricion/plans/${plan.id}/send-email`, { method: "POST" });
      const j = await r.json();
      if (r.ok && j.ok && j.data?.dryRun) {
        // Solo ocurre en desarrollo (en prod el backend devuelve error si no hay
        // RESEND_API_KEY). No es un envío real → no lo pintamos como éxito.
        setToast({ kind: "err", text: "Simulado (sin RESEND_API_KEY): el email NO se ha enviado de verdad." });
      } else if (r.ok && j.ok) {
        setToast({ kind: "ok", text: `Menú enviado a ${j.data?.sentTo || "el paciente"}` });
      } else {
        setToast({ kind: "err", text: j.error || "No se pudo enviar el menú" });
      }
    } catch {
      setToast({ kind: "err", text: "No se pudo enviar el menú" });
    } finally {
      setSendingId(null);
    }
  }, []);

  // Desasignar: archiva el menú del paciente (soft). No se borra — sigue
  // consultable en el histórico de su ficha — pero deja de estar vigente y el
  // paciente queda libre para recibir otro menú.
  const unassign = useCallback(async (plan) => {
    const who = plan.clientName || "el paciente";
    if (!confirm(
      `¿Quitar el menú "${plan.name}" de ${who}?\n\n` +
      `El menú deja de estar activo, pero queda guardado en el histórico del paciente.`
    )) return;
    setUnassigningId(plan.id);
    try {
      const r = await fetch(`/api/nutricion/plans/${plan.id}`, { method: "DELETE" });
      if (r.status === 204 || r.ok) {
        setToast({ kind: "ok", text: `Menú retirado de ${who}` });
        load();
      } else {
        const j = await r.json().catch(() => ({}));
        setToast({ kind: "err", text: j.error || "No se pudo quitar el menú" });
      }
    } catch {
      setToast({ kind: "err", text: "No se pudo quitar el menú" });
    } finally {
      setUnassigningId(null);
    }
  }, [load]);

  const filtered = useMemo(() => {
    let out = items;
    if (templateFilter) out = out.filter((p) => p.templateId === templateFilter);
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      out = out.filter((p) =>
        (p.clientName || "").toLowerCase().includes(q) ||
        (p.name || "").toLowerCase().includes(q)
      );
    }
    return out;
  }, [items, templateFilter, debouncedSearch]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--color-accent,#F7F1EB)]/30">
      {/* Header */}
      <div className="px-4 sm:px-6 lg:px-10 pt-6 lg:pt-8 pb-4 lg:pb-5 shrink-0 border-b border-gray-100 bg-white">
        <div className="flex items-start lg:items-end justify-between gap-4 flex-wrap mb-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-gray-400 mb-1">
              Nutrición · Recetario
            </div>
            {/* «Pautas», no «Pacientes» (04/08/2026, Rodrigo): el menú de
                Clientes ya se llama «Pacientes» en una consulta de nutrición, y
                lo que se lista aquí son las pautas asignadas, no la gente. */}
            <h1 className="text-2xl lg:text-3xl font-semibold text-gray-900 leading-tight">
              Pautas
            </h1>
            <p className="text-xs text-gray-500 mt-1">
              {total} {total === 1 ? "pauta asignada" : "pautas asignadas"} a pacientes.
            </p>
          </div>
          <button
            onClick={() => setAssignOpen(true)}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--color-primary)] text-white hover:opacity-90 transition flex items-center gap-1"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="w-3.5 h-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Nueva asignación
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 max-w-md">
            <svg
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
              className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            >
              <circle cx="11" cy="11" r="7" />
              <path strokeLinecap="round" d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por paciente o nombre del plan…"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
            />
          </div>
          <Select
            value={templateFilter}
            onChange={(v) => setTemplateFilter(v)}
            options={[
              { value: "", label: "Todas las plantillas origen" },
              ...templates.map((t) => ({ value: t.id, label: t.name })),
            ]}
            className="px-3 py-2 text-sm rounded-md border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
          />
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-3 sm:px-4 lg:px-10 py-4 lg:py-6">
        <div className="max-w-7xl mx-auto">
          {loading ? (
            <div className="py-16 text-center text-sm text-gray-400">Cargando asignaciones…</div>
          ) : filtered.length === 0 ? (
            <EmptyState hasAny={items.length > 0} />
          ) : (
            <>
              {/* Cards en móvil (<lg) */}
              <div className="lg:hidden space-y-2.5">
                {filtered.map((p) => (
                  <AssignedCard
                    key={p.id}
                    plan={p}
                    onEdit={() => setEditingId(p.id)}
                    onSend={() => sendMenu(p)}
                    sending={sendingId === p.id}
                    onUnassign={() => unassign(p)}
                    unassigning={unassigningId === p.id}
                  />
                ))}
              </div>

              {/* Tabla en desktop (≥lg) */}
              <div className="hidden lg:block bg-white border border-gray-200 rounded-xl shadow-sm overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left text-[11px] uppercase tracking-wider text-gray-500">
                      <th className="px-4 py-2.5 font-semibold">Paciente</th>
                      <th className="px-4 py-2.5 font-semibold">Plan</th>
                      <th className="px-4 py-2.5 font-semibold">Menú origen</th>
                      <th className="px-4 py-2.5 font-semibold">Asignado</th>
                      <th className="px-4 py-2.5 font-semibold text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtered.map((p) => (
                      <tr
                        key={p.id}
                        className="hover:bg-gray-50/60 cursor-pointer"
                        onClick={() => setEditingId(p.id)}
                      >
                        <td className="px-4 py-2.5 font-medium text-gray-900">
                          {p.clientName || <span className="text-gray-400 italic">Sin nombre</span>}
                        </td>
                        <td className="px-4 py-2.5 text-gray-700">{p.name}</td>
                        <td className="px-4 py-2.5 text-gray-500 text-xs">
                          {p.templateName || <span className="italic">Plantilla eliminada</span>}
                        </td>
                        <td className="px-4 py-2.5 text-gray-500 text-xs">{fmtDate(p.assignedAt)}</td>
                        <td className="px-4 py-2.5 text-right">
                          <div
                            className="flex items-center justify-end gap-3"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <a
                              href={`/api/nutricion/plans/${p.id}/pdf`}
                              className="text-xs text-gray-600 hover:text-[var(--color-primary)] hover:underline"
                            >
                              PDF
                            </a>
                            <button
                              onClick={() => sendMenu(p)}
                              disabled={sendingId === p.id}
                              className="text-xs text-gray-600 hover:text-[var(--color-primary)] hover:underline disabled:opacity-50"
                            >
                              {sendingId === p.id ? "Enviando…" : "Enviar"}
                            </button>
                            <button
                              onClick={() => setEditingId(p.id)}
                              className="text-xs text-[var(--color-primary)] hover:underline"
                            >
                              Editar
                            </button>
                            <button
                              onClick={() => unassign(p)}
                              disabled={unassigningId === p.id}
                              title="Quitar este menú del paciente (queda en su histórico)"
                              className="text-xs text-gray-400 hover:text-red-600 hover:underline disabled:opacity-50"
                            >
                              {unassigningId === p.id ? "Quitando…" : "Quitar"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {editingId && (
        <PlanEditorModal
          planId={editingId}
          onClose={() => { setEditingId(null); load(); }}
          onSaved={() => { /* el reload lo hace onClose */ }}
        />
      )}

      {assignOpen && (
        <AssignPlanModal
          onClose={() => setAssignOpen(false)}
          onAssigned={(newPlan) => {
            setAssignOpen(false);
            setToast({ kind: "ok", text: "Plan asignado correctamente" });
            // Abrir el editor del plan recién asignado para que Laura ajuste
            // gramos / opciones específicas para el paciente.
            if (newPlan?.id) setEditingId(newPlan.id);
            load();
          }}
        />
      )}

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-md shadow-lg text-sm font-medium ${
            toast.kind === "ok" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

function AssignedCard({ plan, onEdit, onSend, sending, onUnassign, unassigning }) {
  return (
    <article
      onClick={onEdit}
      className="bg-white border border-gray-200 rounded-xl shadow-sm p-3.5 cursor-pointer hover:border-[var(--color-primary)]/40 transition"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 truncate">
            {plan.clientName || "Sin paciente"}
          </h3>
          <p className="text-xs text-gray-700 mt-0.5 truncate">{plan.name}</p>
          <p className="text-[11px] text-gray-500 mt-1">
            Plantilla: {plan.templateName || <em>Eliminada</em>}
          </p>
        </div>
        <span className="text-[11px] text-gray-400 shrink-0">{fmtDate(plan.assignedAt)}</span>
      </div>
      <div
        className="flex items-center gap-4 mt-2.5 pt-2.5 border-t border-gray-100"
        onClick={(e) => e.stopPropagation()}
      >
        <a
          href={`/api/nutricion/plans/${plan.id}/pdf`}
          className="text-xs text-gray-600 hover:text-[var(--color-primary)] hover:underline"
        >
          PDF
        </a>
        <button
          onClick={onSend}
          disabled={sending}
          className="text-xs text-gray-600 hover:text-[var(--color-primary)] hover:underline disabled:opacity-50"
        >
          {sending ? "Enviando…" : "Enviar por email"}
        </button>
        <button
          onClick={onUnassign}
          disabled={unassigning}
          className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-50"
        >
          {unassigning ? "Quitando…" : "Quitar"}
        </button>
        <button onClick={onEdit} className="ml-auto text-xs font-medium text-[var(--color-primary)]">
          Editar
        </button>
      </div>
    </article>
  );
}

function EmptyState({ hasAny }) {
  return (
    <div className="py-16 text-center bg-white border border-gray-200 rounded-xl max-w-xl mx-auto">
      {hasAny ? (
        <>
          <div className="text-base text-gray-700 font-medium">Sin coincidencias</div>
          <p className="text-xs text-gray-400 mt-1">Ajusta el buscador o el filtro.</p>
        </>
      ) : (
        <>
          <div className="text-base text-gray-700 font-medium">Aún no hay pacientes con menú asignado</div>
          <p className="text-xs text-gray-400 mt-1 max-w-md mx-auto">
            Ve a la ficha del paciente y selecciona una plantilla para asignar.
            La asignación crea una copia independiente que podrás editar sin
            modificar la plantilla origen.
          </p>
        </>
      )}
    </div>
  );
}
