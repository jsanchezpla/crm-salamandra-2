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

const MODULE_META = {
  nutricion: { label: "Paciente Nutrición", desc: "Pertenece al módulo de Nutrición." },
  clinica: { label: "Paciente Clínica", desc: "Crea/enlaza su ficha de paciente en Clínica." },
};

export default function ClientModulesSection({ clientId }) {
  const [available, setAvailable] = useState([]);
  const [enabledMap, setEnabledMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(null);
  const [note, setNote] = useState(null);
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
    setNote(null);
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
      const kept = (d.data.clinic || []).find((c) => c.action === "kept_has_data");
      if (kept) setNote("El paciente clínico tiene datos (sesiones/informes) y se conserva en Clínica.");
    } catch (e) {
      setEnabledMap((m) => ({ ...m, [moduleKey]: !next })); // revert
      setError(e.message);
    } finally {
      setSavingKey(null);
    }
  }

  if (loading || available.length === 0) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden mt-6 max-w-5xl">
      <div className="px-5 py-4 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-700">Módulos asignados</span>
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
        {note && <div className="text-xs text-amber-600 pt-1">{note}</div>}
        {error && <div className="text-xs text-rose-600 pt-1">{error}</div>}
      </div>
    </div>
  );
}
