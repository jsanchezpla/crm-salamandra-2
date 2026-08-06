"use client";

/**
 * Módulo «Coordinaciones» (sprint Aumenta 2026-07, punto 7).
 *
 * Listado GENERAL de todas las coordinaciones del centro, con filtros por tipo
 * y ámbito. Hasta ahora las coordinaciones solo se veían paciente a paciente y
 * no se podían crear desde ninguna parte: el endpoint existía sin puerta.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import HelpTooltip from "../../../../components/ui/HelpTooltip.jsx";
import NuevaCoordinacionModal from "../../../../components/clinica/NuevaCoordinacionModal.jsx";

const TIPOS = [
  { key: "", label: "Todos" },
  { key: "family", label: "Familia" },
  { key: "school", label: "Colegio" },
  { key: "psychiatrist", label: "Psiquiatría" },
  { key: "neuropediatrician", label: "Neuropediatría" },
  { key: "other_therapist", label: "Otro terapeuta" },
  { key: "orientator", label: "Orientación" },
  { key: "other", label: "Otro" },
];

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

export default function CoordinacionesPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tipo, setTipo] = useState("");
  const [scope, setScope] = useState("");
  const [creando, setCreando] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (tipo) qs.set("type", tipo);
    if (scope) qs.set("scope", scope);
    fetch(`/api/clinica/coordinations?${qs}`, { cache: "no-store" })
      .then(async (r) => ({ r, j: await r.json().catch(() => ({})) }))
      .then(({ r, j }) => {
        if (r.status === 403) throw new Error("Este cliente no tiene el módulo Clínica activo");
        if (!j.ok) throw new Error(j.error || "No se pudieron cargar las coordinaciones");
        setRows(j.data.coordinations ?? []);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [tipo, scope]);

  useEffect(() => load(), [load]);

  return (
    <div className="p-4 lg:p-8 max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="eyebrow">Clínica</div>
          <h1 className="font-display text-2xl text-[var(--ink-900)] mt-1">Coordinaciones</h1>
          <p className="text-xs text-neutral-500 mt-1">
            Reuniones y contactos con colegios, sanitarios y familias. Lo hablado, lo acordado y lo que queda pendiente.
          </p>
        </div>
        <button
          onClick={() => setCreando(true)}
          className="text-xs font-medium px-4 py-2 rounded-lg text-white hover:opacity-90"
          style={{ background: "var(--color-primary, #1B3A2D)" }}
        >
          + Nueva coordinación
        </button>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value)}
          className="rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs"
        >
          {TIPOS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          className="rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs"
        >
          <option value="">Internas y externas</option>
          <option value="external">Solo externas</option>
          <option value="internal">Solo internas</option>
        </select>
        {!loading && (
          <span className="text-[11px] text-neutral-400">
            {rows.length} registradas
            <HelpTooltip title="Cuántas hay" className="ml-1">
              Cuenta las que se ven ahora, con los filtros puestos, y esta lista trae como mucho{" "}
              <strong className="text-white">las 300 más recientes</strong>: las más antiguas pueden
              faltar. El recuadro «Coordinaciones» de Área clínica cuenta todas las del centro, por
              eso a veces da un número mayor. Para buscar una antigua de un paciente, su ficha las
              tiene.
            </HelpTooltip>
          </span>
        )}
      </div>

      {error && <div className="px-4 py-3 rounded-lg bg-rose-50 border border-rose-100 text-xs text-rose-700">{error}</div>}

      {loading ? (
        <div className="text-sm text-neutral-400">Cargando…</div>
      ) : rows.length === 0 ? (
        <div className="bg-white border border-dashed border-neutral-200 rounded-xl p-10 text-center">
          <p className="text-sm text-neutral-600">Sin coordinaciones todavía.</p>
          <p className="text-[11px] text-neutral-400 mt-1">
            Cada llamada con un colegio o un pediatra que se registra aquí es una que no se pierde.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((c) => (
            <div key={c.id} className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="text-[10px] uppercase tracking-wider text-violet-700 bg-violet-50 px-2 py-0.5 rounded-full">{c.typeLabel}</span>
                {c.scopeLabel && (
                  <span className="text-[10px] uppercase tracking-wider text-neutral-500 bg-neutral-100 px-2 py-0.5 rounded-full">{c.scopeLabel}</span>
                )}
                <span className="text-[10px] text-neutral-400 tabular">{fmtDate(c.date)}</span>
                {c.relatedPatientId && (
                  <Link href={`/pacientes/${c.relatedPatientId}`} className="text-[11px] text-[var(--color-primary,#1B3A2D)] hover:underline">
                    {c.patientName || "Ver paciente"}
                  </Link>
                )}
                {/* La firma NO va aquí arriba: va al pie del acta, que es donde
                    se firma. Ver el bloque «Firmado por» al final de la tarjeta. */}
              </div>
              {c.externalEntity && <div className="text-[11px] text-neutral-600 mb-1">Con: {c.externalEntity}</div>}
              {/* Quién estuvo, separando el centro de la gente de fuera. Las
                  actas antiguas guardan los asistentes como texto suelto y no
                  dicen de qué lado está cada uno: esas caen a la línea de
                  siempre en vez de repartirse a ojo. */}
              {(c.participantsInternal?.length > 0 || c.participantsExternal?.length > 0) ? (
                <div className="text-[11px] text-neutral-500 mb-1 space-y-0.5">
                  {c.participantsInternal?.length > 0 && (
                    <div>Del centro: {c.participantsInternal.map((p) => [p.name, p.role].filter(Boolean).join(" · ")).join(", ")}</div>
                  )}
                  {c.participantsExternal?.length > 0 && (
                    <div>De fuera: {c.participantsExternal.map((p) => [p.name, p.role].filter(Boolean).join(" · ")).join(", ")}</div>
                  )}
                </div>
              ) : (
                <div className="text-[11px] text-neutral-500 mb-1">Participantes: {c.participants || "—"}</div>
              )}
              <p className="text-xs text-neutral-700 leading-relaxed">{c.topics || "—"}</p>
              {c.agreements?.length > 0 && (
                <div className="mt-2">
                  <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-0.5">Acuerdos</div>
                  <ul className="list-disc list-outside ml-4 text-xs text-neutral-700 space-y-0.5">
                    {c.agreements.map((a, i) => <li key={i}>{a}</li>)}
                  </ul>
                </div>
              )}
              {c.nextActions?.length > 0 && (
                <div className="mt-2">
                  <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-0.5">Próximos pasos</div>
                  <ul className="list-disc list-outside ml-4 text-xs text-neutral-700 space-y-0.5">
                    {c.nextActions.map((a, i) => <li key={i}>{a}</li>)}
                  </ul>
                </div>
              )}
              {/* La firma, al pie y en todas: un acta la escribe alguien y eso
                  no se pierde aunque esa persona ya no trabaje en el centro
                  (Rodrigo, 02/08/2026). `createdByLabel` resuelve el orden en el
                  servidor — ficha de equipo primero, nombre suelto si no la hay. */}
              {c.createdByLabel && (
                <div className="mt-3 pt-2 border-t border-neutral-100 text-[10px] text-neutral-400">
                  Firmado por {c.createdByLabel}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {creando && <NuevaCoordinacionModal onClose={() => setCreando(false)} onCreada={load} />}
    </div>
  );
}
