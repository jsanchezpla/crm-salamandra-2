"use client";

// «Mi agenda» de la portada (26/08/2026, Rodrigo). Dos pestañas cuando se puede
// ver toda la agenda —Mías y Centro—; solo «mías» para quien no puede (la regla
// vive en lib/citas/visibilidad.js y la aplica el SERVIDOR: aquí llega ya
// filtrado, este componente no decide permisos). La lista tiene su propio
// scroll cuando hay más citas de las que caben: la página no se mueve.

import { useState } from "react";

const CHIP = {
  pending: { texto: "Sin confirmar", clase: "bg-amber-100 text-amber-800" },
  confirmed: { texto: "Confirmada", clase: "bg-[var(--color-primary)]/10 text-[var(--color-primary)]" },
  completed: { texto: "Hecha", clase: "bg-[var(--ink-100)] text-[var(--ink-500)]" },
};

function hora(iso) {
  return new Date(iso).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Madrid",
  });
}

function Fila({ cita, conProfesional }) {
  const chip = CHIP[cita.status] || null;
  const hecha = cita.status === "completed";
  const detalle = [cita.tipo, conProfesional ? cita.profesional || "Sin asignar" : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex items-center gap-2.5 py-1.5 border-t border-[var(--ink-100)] first:border-t-0 text-[13px]">
      <span className={`font-mono text-[11px] w-10 shrink-0 ${hecha ? "text-[var(--ink-300)]" : "text-[var(--ink-400)]"}`}>
        {hora(cita.scheduledAt)}
      </span>
      <span className={`flex-1 min-w-0 truncate ${hecha ? "text-[var(--ink-400)]" : "text-[var(--ink-900)]"}`}>
        {cita.clientName || "Sin nombre"}
      </span>
      {detalle && <span className="hidden sm:block shrink-0 max-w-[40%] truncate text-[10px] text-[var(--ink-400)]">{detalle}</span>}
      {chip && (
        <span className={`shrink-0 text-[9px] font-semibold rounded-full px-2 py-0.5 ${chip.clase}`}>{chip.texto}</span>
      )}
    </div>
  );
}

export default function MiAgenda({ agenda }) {
  const conPestanas = Boolean(agenda?.mias && agenda?.centro);
  const [pestana, setPestana] = useState(() =>
    conPestanas && agenda.mias.count === 0 ? "centro" : agenda?.mias ? "mias" : "centro"
  );
  if (!agenda || (!agenda.mias && !agenda.centro)) return null;

  const activa = pestana === "mias" && agenda.mias ? agenda.mias : agenda.centro || agenda.mias;
  const enCentro = activa === agenda.centro && agenda.conEquipo;

  const ahora = Date.now();
  const proxima = activa.citas.find((c) => new Date(c.scheduledAt).getTime() >= ahora);
  const sub = proxima
    ? `La próxima a las ${hora(proxima.scheduledAt)}`
    : activa.count > 0
      ? "No quedan citas hoy"
      : "Sin citas hoy";

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-white border border-[var(--ink-200)] rounded-[var(--radius-card)] p-4 lg:p-5">
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="text-[13px] font-semibold text-[var(--ink-900)]">
          {agenda.conEquipo ? "Mi agenda" : "Agenda de hoy"}
        </div>
        {conPestanas ? (
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setPestana("mias")}
              className={`text-[10px] font-semibold rounded-full px-2.5 py-1 border transition-colors ${
                pestana === "mias"
                  ? "bg-[var(--color-primary)] border-[var(--color-primary)] text-white"
                  : "border-[var(--ink-200)] text-[var(--ink-500)] hover:border-[var(--ink-300)]"
              }`}
            >
              Mías · {agenda.mias.count}
            </button>
            <button
              type="button"
              onClick={() => setPestana("centro")}
              className={`text-[10px] font-semibold rounded-full px-2.5 py-1 border transition-colors ${
                pestana === "centro"
                  ? "bg-[var(--color-primary)] border-[var(--color-primary)] text-white"
                  : "border-[var(--ink-200)] text-[var(--ink-500)] hover:border-[var(--ink-300)]"
              }`}
            >
              Centro · {agenda.centro.count}
            </button>
          </div>
        ) : (
          <a href="/citas" className="text-[11px] text-[var(--ink-400)] hover:text-[var(--color-primary)] transition-colors">
            Abrir agenda →
          </a>
        )}
      </div>
      <div className="text-[11px] text-[var(--ink-400)] mb-2">{sub}</div>

      {activa.citas.length > 0 ? (
        <div className="flex-1 min-h-0 overflow-y-auto max-h-[320px] lg:max-h-none pr-1">
          {activa.citas.map((c) => (
            <Fila key={c.id} cita={c} conProfesional={enCentro} />
          ))}
        </div>
      ) : (
        <div className="text-[13px] text-[var(--ink-400)] mt-1">Sin citas para hoy</div>
      )}
    </div>
  );
}
