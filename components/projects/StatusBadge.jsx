"use client";

const STATUS_LABELS = {
  draft: "Borrador",
  active: "Activo",
  paused: "En pausa",
  completed: "Completado",
  cancelled: "Cancelado",
};
const STATUS_CLASSES = {
  draft: "bg-neutral-100 text-neutral-600 border-neutral-200",
  active: "bg-emerald-50 text-emerald-700 border-emerald-100",
  paused: "bg-amber-50 text-amber-700 border-amber-100",
  completed: "bg-blue-50 text-blue-700 border-blue-100",
  cancelled: "bg-rose-50 text-rose-700 border-rose-100",
};

export default function StatusBadge({ value }) {
  const cls = STATUS_CLASSES[value] ?? STATUS_CLASSES.draft;
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border ${cls}`}>
      {STATUS_LABELS[value] ?? value}
    </span>
  );
}

export const STATUS_OPTIONS = [
  { value: "draft", label: "Borrador" },
  { value: "active", label: "Activo" },
  { value: "paused", label: "En pausa" },
  { value: "completed", label: "Completado" },
  { value: "cancelled", label: "Cancelado" },
];
