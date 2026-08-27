"use client";

// modules/nutricion/planEditor/ui.jsx — piezas de maquetación y formato que
// comparten el editor de pautas y sus columnas: el armazón del modal, la
// etiqueta, el resumen de macros, el indicador de guardado y los formatos de
// gramos y fecha.

// Utilidades de formato
// ────────────────────────────────────────────────────────────────────────────

export function fmtG(v) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(1).replace(/\.0$/, "")} g`;
}

export function fmtGNumber(v) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(1).replace(/\.0$/, "");
}

export function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("es-ES", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch {
    return "—";
  }
}

// ────────────────────────────────────────────────────────────────────────────
// PlanEditorModal — exported main
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// ModalShell — envoltorio común (backdrop + caja centrada)
// ────────────────────────────────────────────────────────────────────────────

export function ModalShell({ onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-stretch lg:items-center justify-center">
      <div className="absolute inset-0 bg-black/55" />
      <section
        role="dialog"
        aria-modal="true"
        className="
          relative bg-white shadow-2xl overflow-hidden
          flex flex-col
          w-full h-full
          lg:max-w-[1400px] lg:max-h-[95vh] lg:rounded-xl
          mt-14 lg:mt-0
        "
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-1 overflow-y-auto">{children}</div>
      </section>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Sub-componentes: Label, MealAccordion, OptionPills, OptionTable, etc.
// ────────────────────────────────────────────────────────────────────────────

export function Label({ children, className = "" }) {
  return (
    <div className={`text-[10px] uppercase tracking-wider text-gray-400 mb-1.5 ${className}`}>
      {children}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Resumen de macros del plan completo
// ────────────────────────────────────────────────────────────────────────────

export function MacrosSummary({ macros }) {
  const m = macros || { protein: null, carbs: null, fat: null, fiber: null };
  const sumPCG =
    (m.protein ?? 0) + (m.carbs ?? 0) + (m.fat ?? 0);
  function pct(v) {
    if (sumPCG <= 0 || v === null || v === undefined) return null;
    return Math.round((v / sumPCG) * 100);
  }
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="text-[10px] uppercase tracking-[0.18em] text-gray-400 mb-2">Total</div>
      <div className="space-y-1.5">
        <MacroBar label="Proteínas" value={m.protein} pct={pct(m.protein)} color="emerald" />
        <MacroBar label="Carbohidratos" value={m.carbs} pct={pct(m.carbs)} color="amber" />
        <MacroBar label="Grasas" value={m.fat} pct={pct(m.fat)} color="rose" />
        <MacroBar label="Fibra" value={m.fiber} pct={null} color="violet" />
      </div>
      <p className="text-[10px] text-gray-400 mt-3 leading-tight">
        Macros calculadas a partir de la opción por defecto de cada comida.
      </p>
    </div>
  );
}

export function MacroBar({ label, value, pct, color }) {
  const colorClass = {
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
    rose: "bg-rose-500",
    violet: "bg-violet-500",
  }[color];
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-700">{label}</span>
        <span className="tabular-nums text-gray-900">
          {fmtGNumber(value)} g {pct !== null && <span className="text-gray-400 ml-1">({pct}%)</span>}
        </span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-1 mt-0.5 overflow-hidden">
        <div
          className={`${colorClass} h-full transition-all`}
          style={{ width: `${pct !== null ? Math.min(100, pct) : 0}%` }}
        />
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SaveStatusIndicator — chip discreto que informa del modelo de autosave.
// `saving=true` muestra "Guardando…" con icono giratorio; en reposo muestra
// el check. `verbose` activa la versión más explícita del footer.
// ────────────────────────────────────────────────────────────────────────────

export function SaveStatusIndicator({ saving, verbose = false }) {
  if (saving) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 px-2 py-1">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3.5 h-3.5 animate-spin">
          <path strokeLinecap="round" d="M12 3a9 9 0 1 0 9 9" />
        </svg>
        Guardando…
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-400 px-2 py-1" aria-live="polite">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3.5 h-3.5 text-emerald-500">
        <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 4.5 4.5L19 7.5" />
      </svg>
      {verbose ? "Cambios guardados automáticamente" : "Guardado"}
    </span>
  );
}
