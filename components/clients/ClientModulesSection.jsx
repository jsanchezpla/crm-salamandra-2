"use client";

/**
 * ClientModulesSection — sección "Módulos asignados" de la ficha de cliente.
 *
 * Muestra un checkbox por cada módulo asignable que el tenant tiene activo
 * (Nutrición / Clínica), con estado leído de /api/clients/[id]/module-assignments.
 * Al marcar/desmarcar hace PATCH inmediato (optimista + revert en error).
 *
 * Autocontenido: se incluye tal cual en la ficha default y en el override de
 * nutri-laura sin duplicar lógica. Si el tenant no tiene ningún módulo
 * asignable, no renderiza nada.
 */

import { useCallback, useEffect, useState } from "react";
import HelpTooltip from "../ui/HelpTooltip.jsx";

const MODULE_META = {
  nutricion: { label: "Paciente Nutrición", desc: "Pertenece al módulo de Nutrición." },
  // No es un módulo, es una MARCA sobre el cliente (ver `lib/clients/moduleAssignments.js`).
  // Se pinta aquí porque para quien usa la ficha es una casilla igual que las otras.
  profesional_salud: {
    label: "Es profesional de la salud",
    desc: "Nutricionista o profesional que viene a supervisión, no a consulta. Le abre los tipos de cita reservados a profesionales.",
  },
  // Ya NO crea la ficha de paciente: los pacientes se dan de alta explícitamente
  // en la sección «Pacientes» de la ficha (un cliente puede tener varios).
  clinica: { label: "Paciente Clínica", desc: "Marca que pertenece a Clínica. Los pacientes se crean en «Pacientes»." },
};

export default function ClientModulesSection({ clientId }) {
  const [available, setAvailable] = useState([]);
  const [enabledMap, setEnabledMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/clients/${clientId}/module-assignments`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (!d.ok) throw new Error(d.error || "Error cargando módulos");
        setAvailable(d.data.available || []);
        const m = {};
        (d.data.assignments || []).forEach((a) => {
          m[a.moduleKey] = a.enabled;
        });
        setEnabledMap(m);
        setError(null);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [clientId]);

  useEffect(() => load(), [load]);

  async function toggle(moduleKey) {
    if (savingKey) return; // evita solapes
    const next = !enabledMap[moduleKey];
    setSavingKey(moduleKey);
    setError(null);
    setEnabledMap((m) => ({ ...m, [moduleKey]: next })); // optimista
    try {
      const r = await fetch(`/api/clients/${clientId}/module-assignments`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignments: [{ module_key: moduleKey, enabled: next }] }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "No se pudo guardar");
      const m = {};
      (d.data.assignments || []).forEach((a) => {
        m[a.moduleKey] = a.enabled;
      });
      setEnabledMap(m);
    } catch (e) {
      setEnabledMap((m) => ({ ...m, [moduleKey]: !next })); // revert
      setError(e.message);
    } finally {
      setSavingKey(null);
    }
  }

  if (loading || available.length === 0) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden mt-6">
      <div className="px-5 py-4 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-700 inline-flex items-center gap-1.5">
          Módulos asignados
          <HelpTooltip title="Módulos asignados" placement="bottom">
            En qué servicios del centro está esta persona. No da ni quita permisos: sirve para
            saber a quién buscar cuando trabajas dentro de un servicio — marcar «Nutrición» la hace
            aparecer en los listados de Nutrición.
            {" "}
            <strong className="text-white">Se guarda al momento</strong>, sin botón de guardar.
          </HelpTooltip>
        </span>
      </div>
      <div className="p-5 space-y-3">
        {available.map((k) => {
          const meta = MODULE_META[k] || { label: k, desc: "" };
          const on = !!enabledMap[k];
          return (
            <label key={k} className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={on}
                disabled={savingKey === k}
                onChange={() => toggle(k)}
                className="mt-0.5 w-4 h-4 rounded border-gray-300 accent-[var(--color-primary)] cursor-pointer disabled:opacity-40"
              />
              <div>
                <div className="text-sm font-medium text-gray-800">{meta.label}</div>
                <div className="text-xs text-gray-500">{meta.desc}</div>
              </div>
            </label>
          );
        })}
        {error && <div className="text-xs text-rose-600 pt-1">{error}</div>}
      </div>
    </div>
  );
}
