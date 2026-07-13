"use client";

// Insignia de tipo de archivo por MIME (los 3 permitidos).
const META = {
  "application/pdf": { label: "PDF", cls: "bg-rose-50 text-rose-600 border-rose-100" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    label: "DOCX",
    cls: "bg-sky-50 text-sky-600 border-sky-100",
  },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    label: "XLSX",
    cls: "bg-emerald-50 text-emerald-600 border-emerald-100",
  },
};

export default function FileTypeIcon({ mimeType, className = "" }) {
  const m = META[mimeType] ?? { label: "FILE", cls: "bg-neutral-50 text-neutral-500 border-neutral-100" };
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md border text-[10px] font-bold tracking-wide w-9 h-9 shrink-0 ${m.cls} ${className}`}
    >
      {m.label}
    </span>
  );
}
