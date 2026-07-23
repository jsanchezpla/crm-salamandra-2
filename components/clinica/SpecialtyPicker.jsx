"use client";

/**
 * SpecialtyPicker — multi-selector de especialidades clínicas (chips).
 * Compartido por la ficha de paciente, el módulo Pacientes y el módulo Equipo.
 * `value` es un array de claves; `onChange(nextArray)`.
 */

import { SPECIALTIES } from "../../lib/clinica/specialties.js";

export default function SpecialtyPicker({ value = [], onChange, label = "Especialidad(es)" }) {
  const toggle = (key) =>
    onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);

  return (
    <div>
      {label && <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>}
      <div className="flex flex-wrap gap-1.5">
        {SPECIALTIES.map((sp) => {
          const on = value.includes(sp.key);
          return (
            <button
              type="button"
              key={sp.key}
              onClick={() => toggle(sp.key)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                on
                  ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
                  : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
              }`}
            >
              {sp.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
