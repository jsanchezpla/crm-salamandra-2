"use client";

/**
 * Módulo «Coordinaciones» (sprint Aumenta 2026-07, punto 7).
 *
 * Listado GENERAL de todas las coordinaciones del centro, con filtros por tipo
 * y ámbito. Hasta ahora las coordinaciones solo se veían paciente a paciente y
 * no se podían crear desde ninguna parte: el endpoint existía sin puerta.
 */

import { useCallback, useEffect, useState } from "react";
import HelpTooltip from "../../../../components/ui/HelpTooltip.jsx";
import NuevaCoordinacionModal from "../../../../components/clinica/NuevaCoordinacionModal.jsx";
import ActaCoordinacion from "../../../../components/clinica/ActaCoordinacion.jsx";
import { useQuienSoy } from "../../../../components/clinica/quienSoy.js";
import { puedeEditarCoordinacion, esDireccion } from "../../../../lib/clinica/alcanceCoordinaciones.js";
import { anchoPantalla } from "@/components/layout/anchoPantalla.js";

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

export default function CoordinacionesPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tipo, setTipo] = useState("");
  const [scope, setScope] = useState("");
  const [creando, setCreando] = useState(false);
  // El acta que se está corrigiendo (18/09/2026, AV-0102). `null` = ninguna.
  const [corrigiendo, setCorrigiendo] = useState(null);
  const { yo, rol } = useQuienSoy();

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
    <div className={`${anchoPantalla("listado")} space-y-5`}>
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
            <ActaCoordinacion
              key={c.id}
              acta={c}
              mostrarPaciente
              onEditar={
                puedeEditarCoordinacion({ esAdmin: esDireccion(rol), row: { createdById: c.createdById }, teamMemberId: yo })
                  ? setCorrigiendo
                  : null
              }
            />
          ))}
        </div>
      )}

      {creando && <NuevaCoordinacionModal onClose={() => setCreando(false)} onCreada={load} />}
      {corrigiendo && (
        <NuevaCoordinacionModal
          coordinacion={corrigiendo}
          patientName={corrigiendo.patientName}
          onClose={() => setCorrigiendo(null)}
          onCreada={load}
        />
      )}
    </div>
  );
}
