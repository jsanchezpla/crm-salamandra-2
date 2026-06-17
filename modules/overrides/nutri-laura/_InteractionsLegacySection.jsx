"use client";

/**
 * ARCHIVADO sprint nutri_laura C3 — la tabla `interactions` no existe en
 * crm_nutri_laura (ni local ni producción). Si en el futuro se decide
 * crearla para este tenant, restaurar el import y el render en
 * ClientDetailModule.jsx (tab Información).
 *
 * El componente espera la lista preserialized del backend en
 * `client.interactions` (alias del include en GET /api/clients/[id]).
 * Tras el fix C3 ese endpoint sigue intentando incluirla y devuelve [] si
 * la tabla no existe — restaurar este render no introduce regresiones,
 * solo requiere asegurarse de que `client.interactions` esté presente.
 *
 * No se importa desde ningún sitio en nutri_laura ahora mismo. Está
 * preservado para reutilizar si se necesita.
 */

import { useState } from "react";

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function InteractionsLegacySection({ interactions }) {
  const [open, setOpen] = useState(false);
  if (!interactions || interactions.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm px-5 py-4 text-xs text-gray-400">
        Sin historial de interacciones legacy.
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
        <div>
          <div className="text-sm font-semibold text-gray-700">Historial de interacciones</div>
          <div className="text-[11px] text-gray-400 mt-0.5">
            {interactions.length} registro{interactions.length === 1 ? "" : "s"} (legacy)
          </div>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-[11px] font-semibold text-gray-500 hover:text-gray-800"
        >
          {open ? "Ocultar" : "Mostrar"}
        </button>
      </div>
      {open && (
        <ul className="divide-y divide-gray-50">
          {interactions.map((i) => (
            <li key={i.id} className="px-5 py-3">
              <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
                <span className="font-medium text-gray-600">{i.type}</span>
                <span>{fmtDate(i.date)}</span>
                {i.createdBy && <span>· {i.createdBy}</span>}
              </div>
              <div className="text-sm text-gray-700 whitespace-pre-wrap">{i.content}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
