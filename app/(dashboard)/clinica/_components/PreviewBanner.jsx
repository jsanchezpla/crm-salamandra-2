"use client";

import { useState } from "react";

export default function PreviewBanner() {
  const [closed, setClosed] = useState(false);
  if (closed) return null;
  return (
    <div className="bg-sky-50 border border-sky-100 rounded-xl px-4 py-3 flex items-start gap-3">
      <div className="shrink-0 w-7 h-7 rounded-md bg-sky-100 text-sky-700 flex items-center justify-center">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] uppercase tracking-wider text-sky-700 font-semibold mb-0.5">Vista previa visual</div>
        <p className="text-xs text-sky-900 leading-relaxed">
          Esta es la maqueta del módulo Clínica con datos ficticios. La funcionalidad de dictado por voz, generación con IA y cálculo automático de incentivos se implementará en fases posteriores.
        </p>
      </div>
      <button
        onClick={() => setClosed(true)}
        className="shrink-0 text-sky-400 hover:text-sky-700 transition-colors p-1 -m-1"
        aria-label="Cerrar aviso"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
