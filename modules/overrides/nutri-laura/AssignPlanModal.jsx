"use client";

/**
 * AssignPlanModal — wizard de 2 pasos para asignar una plantilla a un paciente.
 *
 * Sprint nutri-laura Recetario C4.
 *
 * Decisiones C4 (Jorge):
 *   - Asignación SOLO desde /nutricion/asignados (no desde ficha paciente).
 *   - 2 pasos secuenciales: paciente → plantilla → confirmar.
 *   - En el paso 2 ocultamos las plantillas que YA tienen una asignación
 *     activa al paciente elegido (evitamos el 409 antes de hacer el POST).
 *   - Si por alguna race condition el POST igualmente devuelve 409, mostramos
 *     toast de error en el propio modal y volvemos al paso 2 para permitir
 *     elegir otra plantilla.
 *   - Al asignar OK, cerramos el modal y devolvemos al parent el id del plan
 *     recién creado para que abra el PlanEditorModal de C3 en modo edit.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export default function AssignPlanModal({ onClose, onAssigned }) {
  // 1 = paciente, 2 = plantilla, 3 = confirmación.
  const [step, setStep] = useState(1);
  const [client, setClient] = useState(null);
  const [template, setTemplate] = useState(null);

  // Lista de plantillas (todas, incluso ya asignadas al cliente; las
  // filtramos para ocultar las que ya tienen una asignación activa).
  const [templates, setTemplates] = useState(null);     // null = loading
  const [activeAssignmentsForClient, setActiveAssignmentsForClient] = useState(new Set());

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // ── ESC para cerrar ───────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose?.(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ── Paso 2: cargar plantillas + asignaciones activas del cliente ──────────
  // Pedimos withSummary=true para tener mealsSummary y poder mostrar el
  // resumen en el paso 3 (nº de comidas + total de opciones).
  useEffect(() => {
    if (step !== 2 || !client) return;
    let cancelled = false;

    (async () => {
      setTemplates(null);
      try {
        const r1 = await fetch("/api/nutricion/plans?type=template&withSummary=true&limit=200");
        const j1 = await r1.json();
        if (cancelled) return;
        const tpls = j1?.ok ? (j1.items || []) : [];

        // Asignaciones activas de este cliente (para filtrar)
        const r2 = await fetch(`/api/clients/${client.id}/plans`);
        const j2 = await r2.json();
        if (cancelled) return;
        const activeTplIds = new Set(
          (j2?.items || [])
            .filter((p) => p.status === "active" && p.templateId)
            .map((p) => p.templateId)
        );

        setActiveAssignmentsForClient(activeTplIds);
        setTemplates(tpls);
      } catch {
        if (!cancelled) {
          setTemplates([]);
          setActiveAssignmentsForClient(new Set());
        }
      }
    })();

    return () => { cancelled = true; };
  }, [step, client]);

  // ── Paso 3 dispara el POST real ───────────────────────────────────────────
  async function handleConfirm() {
    if (!client || !template || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch(`/api/nutricion/plans/${template.id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        const msg = r.status === 409
          ? `Ya existe una asignación activa de "${template.name}" para ${client.name}.`
          : (j.error || "No se pudo crear la asignación");
        setError(msg);
        // 409 = duplicado activo: volvemos al paso 2 para que Laura pueda
        // elegir otra plantilla (la suya quedó pre-seleccionada en estado).
        if (r.status === 409) setStep(2);
        return;
      }
      onAssigned?.(j.data);
    } catch (e) {
      setError(e.message || "Error de red");
    } finally {
      setSubmitting(false);
    }
  }

  function handleSelectTemplate(t) {
    setTemplate(t);
    setError(null);
    setStep(3);
  }

  function goBack() {
    setError(null);
    if (step === 3) setStep(2);
    else if (step === 2) setStep(1);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch lg:items-center justify-center">
      <div className="absolute inset-0 bg-black/55" onClick={onClose} />
      <section
        role="dialog"
        aria-modal="true"
        className="
          relative bg-white shadow-2xl flex flex-col overflow-hidden
          w-full h-full lg:max-w-2xl lg:max-h-[85vh] lg:rounded-xl
          mt-14 lg:mt-0
        "
      >
        <Header
          step={step}
          client={client}
          onClose={onClose}
          onBack={step > 1 ? goBack : null}
        />

        <div className="flex-1 overflow-y-auto px-5 lg:px-7 py-5">
          {step === 1 && (
            <StepClient onSelect={(c) => { setClient(c); setStep(2); }} />
          )}
          {step === 2 && (
            <StepTemplate
              client={client}
              templates={templates}
              activeAssignmentsForClient={activeAssignmentsForClient}
              selectedTemplateId={template?.id ?? null}
              onSelect={handleSelectTemplate}
              error={error}
            />
          )}
          {step === 3 && (
            <StepConfirm
              client={client}
              template={template}
              onBack={goBack}
              onConfirm={handleConfirm}
              submitting={submitting}
              error={error}
            />
          )}
        </div>
      </section>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Header con stepper
// ────────────────────────────────────────────────────────────────────────────

function Header({ step, client, onClose, onBack }) {
  const titleByStep = {
    1: "Selecciona un paciente",
    2: `Elige plantilla para ${client?.name ?? "…"}`,
    3: "Confirmar asignación",
  };
  return (
    <header className="sticky top-0 z-10 bg-white border-b border-gray-100 px-5 lg:px-7 py-3.5 flex items-center gap-3 flex-wrap">
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-[0.18em] text-gray-400 mb-0.5">
          Nutrición · Nueva asignación
        </div>
        <h2 className="text-base lg:text-lg font-semibold text-gray-900 leading-tight">
          {titleByStep[step]}
        </h2>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <Step n={1} label="Paciente" active={step === 1} done={step > 1} />
        <span className="text-gray-300 text-xs">›</span>
        <Step n={2} label="Plantilla" active={step === 2} done={step > 2} />
        <span className="text-gray-300 text-xs">›</span>
        <Step n={3} label="Confirmar" active={step === 3} done={false} />
      </div>
      {onBack && (
        <button
          onClick={onBack}
          className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50"
        >
          ← Atrás
        </button>
      )}
      <button
        onClick={onClose}
        className="text-gray-400 hover:text-gray-700 transition p-1"
        aria-label="Cerrar"
        title="Cerrar (Esc)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </header>
  );
}

function Step({ n, label, active, done }) {
  const base = "inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full border";
  if (done) {
    return (
      <span className={`${base} bg-emerald-50 text-emerald-700 border-emerald-200`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="w-3 h-3">
          <path d="m5 12 4.5 4.5L19 7.5" />
        </svg>
        {label}
      </span>
    );
  }
  if (active) {
    return (
      <span className={`${base} bg-[var(--color-primary)] text-white border-[var(--color-primary)]`}>
        {n}. {label}
      </span>
    );
  }
  return (
    <span className={`${base} bg-white text-gray-400 border-gray-200`}>{n}. {label}</span>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Paso 1 — Selector de paciente con autocomplete
// ────────────────────────────────────────────────────────────────────────────

function StepClient({ onSelect }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const debounceTimer = useRef(null);

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (query.trim().length < 1) {
      // Si no hay query, listamos los últimos 20 clientes activos por defecto
      setLoading(true);
      fetch("/api/clients?limit=20")
        .then((r) => r.json())
        .then((j) => setResults(j?.data?.clients ?? j?.clients ?? []))
        .finally(() => setLoading(false));
      return;
    }
    debounceTimer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/clients?search=${encodeURIComponent(query.trim())}&limit=20`);
        const j = await r.json();
        // El endpoint devuelve ok() => { ok: true, data: { clients, ... } }
        setResults(j?.data?.clients ?? j?.clients ?? []);
      } catch { setResults([]); }
      setLoading(false);
    }, 250);
    return () => debounceTimer.current && clearTimeout(debounceTimer.current);
  }, [query]);

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-[11px] uppercase tracking-wider text-gray-400 block mb-1.5">
          Buscar paciente
        </span>
        <div className="relative">
          <svg
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
            className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          >
            <circle cx="11" cy="11" r="7" />
            <path strokeLinecap="round" d="m20 20-3.5-3.5" />
          </svg>
          <input
            autoFocus
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nombre, email o teléfono…"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
          />
        </div>
      </label>

      <div className="border border-gray-100 rounded-md bg-white max-h-[400px] overflow-y-auto divide-y divide-gray-100">
        {loading && (
          <div className="px-3 py-3 text-xs text-gray-400 text-center">Buscando…</div>
        )}
        {!loading && results.length === 0 && (
          <div className="px-3 py-6 text-xs text-gray-400 text-center">
            {query ? `Sin coincidencias para "${query}".` : "No hay pacientes en el listado."}
          </div>
        )}
        {!loading && results.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c)}
            className="w-full text-left px-3 py-2.5 hover:bg-gray-50 transition flex items-center justify-between gap-2"
          >
            <div className="min-w-0">
              <div className="font-medium text-sm text-gray-900 truncate">{c.name}</div>
              <div className="text-[11px] text-gray-500 truncate">
                {c.email || c.phone || "—"}
              </div>
            </div>
            <span className="text-[11px] text-[var(--color-primary)]">Seleccionar →</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Paso 2 — Selector de plantilla
// ────────────────────────────────────────────────────────────────────────────

function StepTemplate({ client, templates, activeAssignmentsForClient, selectedTemplateId, onSelect, error }) {
  const visible = useMemo(() => {
    if (!templates) return [];
    return templates.filter((t) => !activeAssignmentsForClient.has(t.id));
  }, [templates, activeAssignmentsForClient]);

  if (templates === null) {
    return (
      <div className="py-10 text-center text-sm text-gray-400">Cargando plantillas…</div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        Selecciona la plantilla que servirá de base para el plan de{" "}
        <strong className="text-gray-700">{client?.name}</strong>. El plan asignado
        es una <strong>copia independiente</strong>: editarlo no modifica la plantilla.
      </p>

      {error && (
        <div className="px-3 py-2 bg-red-50 border border-red-100 rounded-md text-xs text-red-700">
          {error}
        </div>
      )}

      {templates.length === 0 && (
        <div className="py-10 text-center text-sm text-gray-400 border border-dashed border-gray-200 rounded-md">
          No hay plantillas todavía. Crea una en Nutrición &gt; Plantillas.
        </div>
      )}

      {templates.length > 0 && visible.length === 0 && (
        <div className="py-6 text-center text-sm text-gray-500 border border-dashed border-gray-200 rounded-md">
          <p>Todas las plantillas ya están asignadas activas a {client?.name}.</p>
          <p className="text-xs text-gray-400 mt-1">
            Crea una nueva plantilla o archiva la asignación existente para reasignar.
          </p>
        </div>
      )}

      <ul className="space-y-2">
        {visible.map((t) => {
          const isSelected = t.id === selectedTemplateId;
          return (
            <li key={t.id}>
              <button
                onClick={() => onSelect(t)}
                className={`w-full text-left px-3 py-2.5 rounded-md border transition flex items-start justify-between gap-3 ${
                  isSelected
                    ? "border-[var(--color-primary)] bg-[var(--color-primary)]/[0.06] ring-1 ring-[var(--color-primary)]/30"
                    : "border-gray-200 hover:border-[var(--color-primary)]/40 hover:bg-[var(--color-primary)]/[0.03]"
                }`}
              >
                <div className="min-w-0">
                  <div className="font-medium text-sm text-gray-900 truncate">{t.name}</div>
                  {t.description && (
                    <div className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">
                      {t.description}
                    </div>
                  )}
                  {typeof t.mealCount === "number" && (
                    <div className="text-[10px] text-gray-400 mt-1 uppercase tracking-wider">
                      {t.mealCount} {t.mealCount === 1 ? "comida" : "comidas"}
                      {Array.isArray(t.mealsSummary) && t.mealsSummary.length > 0 && (
                        <> · {t.mealsSummary.reduce((a, m) => a + (m.optionCount || 0), 0)} opciones</>
                      )}
                    </div>
                  )}
                </div>
                <span className="text-[11px] shrink-0 mt-0.5 flex items-center gap-1">
                  {isSelected ? (
                    <span className="inline-flex items-center gap-1 text-[var(--color-primary)] font-medium">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} className="w-3 h-3">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 4.5 4.5L19 7.5" />
                      </svg>
                      Seleccionada
                    </span>
                  ) : (
                    <span className="text-[var(--color-primary)]">Elegir →</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Paso 3 — Confirmación con resumen
// ────────────────────────────────────────────────────────────────────────────

function StepConfirm({ client, template, onBack, onConfirm, submitting, error }) {
  const totalOptions = useMemo(() => {
    if (!Array.isArray(template?.mealsSummary)) return null;
    return template.mealsSummary.reduce((acc, m) => acc + (m.optionCount || 0), 0);
  }, [template]);
  const mealCount = template?.mealCount ?? (template?.mealsSummary?.length ?? null);

  return (
    <div className="space-y-5">
      <SummaryBlock label="Paciente">
        <div className="font-medium text-sm text-gray-900">{client?.name}</div>
        {(client?.email || client?.phone) && (
          <div className="text-[12px] text-gray-500 mt-0.5">
            {client?.email || client?.phone}
          </div>
        )}
      </SummaryBlock>

      <SummaryBlock label="Plantilla">
        <div className="font-medium text-sm text-gray-900">{template?.name}</div>
        {template?.description && (
          <div className="text-[12px] text-gray-500 mt-0.5 line-clamp-3">
            {template.description}
          </div>
        )}
        {mealCount !== null && (
          <div className="text-[11px] text-gray-500 mt-1.5 uppercase tracking-wider">
            {mealCount} {mealCount === 1 ? "comida" : "comidas"}
            {totalOptions !== null && totalOptions > 0 && (
              <> · {totalOptions} {totalOptions === 1 ? "opción" : "opciones"}</>
            )}
          </div>
        )}
      </SummaryBlock>

      <p className="text-xs text-gray-500 leading-relaxed">
        Al confirmar, se creará un plan asignado a partir de esta plantilla.
        Podrás editarlo después sin afectar a la plantilla original.
      </p>

      {error && (
        <div className="px-3 py-2 bg-red-50 border border-red-100 rounded-md text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          ← Atrás
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={submitting}
          className="px-4 py-1.5 text-xs font-medium rounded-md bg-[var(--color-primary)] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition inline-flex items-center gap-1.5"
        >
          {submitting ? (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3.5 h-3.5 animate-spin">
                <path strokeLinecap="round" d="M12 3a9 9 0 1 0 9 9" />
              </svg>
              Creando…
            </>
          ) : (
            "Crear asignación"
          )}
        </button>
      </div>
    </div>
  );
}

function SummaryBlock({ label, children }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.18em] text-gray-400 mb-1.5">
        {label}
      </div>
      <div className="bg-gray-50/70 border border-gray-100 rounded-md px-3 py-2.5">
        {children}
      </div>
    </div>
  );
}
