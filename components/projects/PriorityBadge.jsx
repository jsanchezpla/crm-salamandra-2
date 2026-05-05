"use client";

const LABELS = { low: "Baja", medium: "Media", high: "Alta", urgent: "Urgente" };
const CLASSES = {
  low: "bg-neutral-100 text-neutral-600 border-neutral-200",
  medium: "bg-sky-50 text-sky-700 border-sky-100",
  high: "bg-amber-50 text-amber-700 border-amber-100",
  urgent: "bg-rose-50 text-rose-700 border-rose-100",
};

export default function PriorityBadge({ value }) {
  const cls = CLASSES[value] ?? CLASSES.medium;
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border ${cls}`}>
      {LABELS[value] ?? value}
    </span>
  );
}

export const PRIORITY_OPTIONS = [
  { value: "low", label: "Baja" },
  { value: "medium", label: "Media" },
  { value: "high", label: "Alta" },
  { value: "urgent", label: "Urgente" },
];
