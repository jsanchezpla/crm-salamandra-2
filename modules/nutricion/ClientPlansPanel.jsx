"use client";

/**
 * ClientPlansPanel — pestaña "Pautas" de la ficha, para CUALQUIER cliente con
 * el módulo `nutricion`.
 *
 * Sprint nutri-laura Recetario C4. Hasta el 13/08/2026 vivía en
 * `modules/overrides/nutri-laura/` y solo lo montaba la ficha de Laura, así que
 * el resto de centros con Nutrición —la demo, sin ir más lejos— tenían las
 * cuatro pantallas de /nutricion y ningún sitio desde donde asignar un menú a
 * una persona concreta. No era una decisión: es que nació con ella y nadie lo
 * bajó al default.
 *
 * Quien decide si esta pestaña existe es el SERVIDOR
 * (`app/(dashboard)/clientes/[id]/page.jsx` mira el módulo y pasa
 * `conNutricion`), porque este componente siempre pinta algo —cargando, vacío o
 * el error— y nunca se declararía vacío por su cuenta.
 *
 * Vocabulario (04/08/2026, Rodrigo): el modelo reutilizable es un MENÚ y la
 * copia que recibe esta paciente es su PAUTA. Por debajo las dos son `plans`
 * con `type` template/assigned — el modelo no se ha tocado.
 *
 * Vista:
 *   - Pauta ACTIVA (archived_at IS NULL): card destacada con el menú origen,
 *     fecha de asignación, count de comidas, botones [Editar pauta] y
 *     [Re-aplicar menú origen].
 *   - Histórico (archived_at IS NOT NULL): colapsable bajo la activa. Cada
 *     fila → [Ver] que abre el mismo PlanEditorModal (editable, ya que la
 *     pauta archivada puede consultarse y, si Laura lo decide, retomarla
 *     manualmente).
 *
 * Estados:
 *   - Sin pauta activa NI histórico → empty state que apunta a /asignados.
 *   - Sólo histórico, sin activa → mensaje "Sin pauta activa" + histórico
 *     expandido por defecto.
 *
 * No incluye botón "Asignar nuevo menú" por decisión Jorge: la asignación
 * SOLO se inicia desde /nutricion/asignados.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import PlanEditorModal from "./PlanEditorModal.jsx";

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("es-ES", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch { return "—"; }
}

export default function ClientPlansPanel({ clientId }) {
  const [items, setItems] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [reapplying, setReapplying] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    if (!clientId) return;
    setError(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/plans`);
      const j = await r.json();
      if (!j?.ok) {
        setError(j?.error || `HTTP ${r.status}`);
        setItems([]);
        return;
      }
      setItems(j.items || []);
    } catch (e) {
      setError(e.message || "Error de red");
      setItems([]);
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  const active = (items || []).find((p) => p.status === "active") || null;
  const archived = (items || []).filter((p) => p.status === "archived");

  // Si solo hay histórico (sin activo), por defecto lo mostramos expandido.
  useEffect(() => {
    if (items && !active && archived.length > 0) setShowHistory(true);
  }, [items, active, archived.length]);

  async function handleReapply(plan) {
    if (!plan) return;
    if (!window.confirm(
      "Esto archivará la pauta actual y creará una nueva desde el menú origen. ¿Continuar?"
    )) return;
    setReapplying(true);
    try {
      const r = await fetch(`/api/nutricion/plans/${plan.id}/reapply-template`, {
        method: "POST",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        setToast({ kind: "err", text: j.error || "No se pudo re-aplicar el menú" });
        return;
      }
      setToast({ kind: "ok", text: "Menú re-aplicado" });
      await load();
      // Abrir la nueva pauta para confirmar / ajustar
      if (j.data?.id) setEditingId(j.data.id);
    } finally {
      setReapplying(false);
    }
  }

  // ── Estados de carga ──────────────────────────────────────────────────────
  if (items === null) {
    return (
      <div className="py-10 text-center text-sm text-gray-400">Cargando pauta…</div>
    );
  }
  if (error) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-red-600">No se pudo cargar la pauta: {error}</p>
        <button
          onClick={load}
          className="mt-3 text-xs px-3 py-1.5 rounded border border-gray-200 hover:bg-gray-50"
        >
          Reintentar
        </button>
      </div>
    );
  }

  // ── Empty total ───────────────────────────────────────────────────────────
  if (!active && archived.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="space-y-4">
      {/* Plan activo */}
      {active ? (
        <ActivePlanCard
          plan={active}
          onEdit={() => setEditingId(active.id)}
          onReapply={() => handleReapply(active)}
          reapplying={reapplying}
        />
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-500">
          Este paciente no tiene pauta activa. Histórico abajo.
        </div>
      )}

      {/* Histórico */}
      {archived.length > 0 && (
        <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-gray-50 transition"
          >
            <span className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
              Histórico
              <span className="ml-1.5 text-gray-400 normal-case">
                ({archived.length} {archived.length === 1 ? "pauta archivada" : "pautas archivadas"})
              </span>
            </span>
            <svg
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}
              className={`w-4 h-4 text-gray-400 transition-transform ${showHistory ? "rotate-180" : ""}`}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
            </svg>
          </button>
          {showHistory && (
            <ul className="divide-y divide-gray-100 border-t border-gray-100">
              {archived.map((p) => (
                <HistoryItem key={p.id} plan={p} onView={() => setEditingId(p.id)} />
              ))}
            </ul>
          )}
        </section>
      )}

      {editingId && (
        <PlanEditorModal
          planId={editingId}
          onClose={() => { setEditingId(null); load(); }}
          onSaved={() => { /* el reload lo hace onClose */ }}
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

// ────────────────────────────────────────────────────────────────────────────

function ActivePlanCard({ plan, onEdit, onReapply, reapplying }) {
  const templateDisabled = !plan.templateId || plan.templateArchived;
  return (
    <article className="bg-[var(--color-primary)]/[0.05] border border-[var(--color-primary)]/25 rounded-xl p-4 lg:p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-primary)] mb-1">
            Pauta activa
          </div>
          <h3 className="text-base lg:text-lg font-semibold text-gray-900 leading-tight">
            {plan.name}
          </h3>
          <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600">
            <Row label="Menú origen">
              {plan.templateId && plan.templateName ? (
                plan.templateArchived ? (
                  <span className="text-gray-500 italic">{plan.templateName} (archivado)</span>
                ) : (
                  <Link
                    href={`/nutricion/plantillas`}
                    className="text-[var(--color-primary)] hover:underline"
                  >
                    {plan.templateName}
                  </Link>
                )
              ) : (
                <span className="text-gray-400">—</span>
              )}
            </Row>
            <Row label="Asignado el">{fmtDate(plan.assignedAt)}</Row>
            <Row label="Última edición">{fmtDate(plan.updatedAt)}</Row>
            <Row label="Comidas">
              {plan.mealCount} {plan.mealCount === 1 ? "comida" : "comidas"}
            </Row>
          </dl>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 flex-wrap">
        <button
          onClick={onReapply}
          disabled={reapplying || templateDisabled}
          className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-200 text-gray-700 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition"
          title={templateDisabled
            ? "Menú origen archivado o sin referencia — no se puede re-aplicar"
            : "Archiva la pauta actual y copia el menú origen"}
        >
          {reapplying ? "Re-aplicando…" : "Re-aplicar menú origen"}
        </button>
        <button
          onClick={onEdit}
          className="px-4 py-1.5 text-xs font-medium rounded-md bg-[var(--color-primary)] text-white hover:opacity-90 transition"
        >
          Editar pauta
        </button>
      </div>
    </article>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-baseline gap-2 min-w-0">
      <dt className="text-gray-400 shrink-0">{label}:</dt>
      <dd className="text-gray-800 truncate">{children}</dd>
    </div>
  );
}

function HistoryItem({ plan, onView }) {
  return (
    <li className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-gray-50/60 transition">
      <div className="min-w-0">
        <div className="font-medium text-sm text-gray-800 truncate">{plan.name}</div>
        <div className="text-[11px] text-gray-500 mt-0.5">
          Asignada {fmtDate(plan.assignedAt)} · Archivada {fmtDate(plan.archivedAt)}
          {plan.templateName && (
            <> · Menú: <span className="text-gray-600">{plan.templateName}</span></>
          )}
        </div>
      </div>
      <button
        onClick={onView}
        className="shrink-0 px-2.5 py-1 text-[11px] font-medium rounded border border-gray-200 text-gray-600 hover:bg-white transition"
      >
        Ver
      </button>
    </li>
  );
}

function EmptyState() {
  return (
    <div className="max-w-md mx-auto py-12 text-center">
      <div className="text-base text-gray-700 font-medium">Sin pauta asignada</div>
      <p className="text-xs text-gray-500 mt-1 leading-relaxed">
        Asigna un menú desde{" "}
        {/* El camino del menú se dice tal cual está escrito en el sidebar; si
            no, manda a buscar una entrada que no existe (04/08/2026: este
            submenú pasó de llamarse «Pacientes» a «Pautas»). */}
        <Link href="/nutricion/asignados" className="text-[var(--color-primary)] hover:underline">
          Nutrición &gt; Pautas &gt; + Nueva asignación
        </Link>
        .
      </p>
    </div>
  );
}
