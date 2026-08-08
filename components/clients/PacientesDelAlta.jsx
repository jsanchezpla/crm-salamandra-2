"use client";

/**
 * PacientesDelAlta — dar de alta a los pacientes en el mismo mostrador que a la
 * familia (01/08/2026).
 *
 * Recepción tenía que crear el cliente, buscarlo, entrar en su ficha y crear
 * ahí a cada hijo. Con una familia esperando de pie delante. Aquí se hace de
 * una vez, y el servidor los crea en la MISMA transacción: o entran la familia
 * y sus pacientes, o no entra nada.
 *
 * Solo se monta si el cliente tiene el módulo `pacientes`. Donde el paciente ES
 * el cliente (una adulta que viene a consulta), basta marcar la casilla: eso
 * copia su nombre a los campos, que quedan a la vista y editables. Nada de
 * adivinar por detrás cómo se parte un nombre en nombre y apellidos.
 */

import {
  CAMPOS_PACIENTE,
  PARENTESCOS,
  PARENTESCO_ES_EL_CLIENTE,
  edadDesde,
  partirNombre,
} from "../../lib/clients/formularioAlta.js";

export const PACIENTE_VACIO = {
  firstName: "", lastName: "", birthDate: "", educationCenter: "", educationLevel: "",
  relationship: "", referralReason: "",
};
const VACIO = PACIENTE_VACIO;

const inputCls =
  "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)] placeholder:text-gray-300";

export default function PacientesDelAlta({ pacientes, onChange, nombreCliente }) {
  const actualizar = (i, campos) =>
    onChange(pacientes.map((p, idx) => (idx === i ? { ...p, ...campos } : p)));

  const añadir = () => onChange([...pacientes, { ...VACIO }]);
  const quitar = (i) => onChange(pacientes.filter((_, idx) => idx !== i));

  const marcarEsElCliente = (i, marcado) => {
    if (!marcado) {
      actualizar(i, { relationship: "" });
      return;
    }
    actualizar(i, { ...partirNombre(nombreCliente), relationship: PARENTESCO_ES_EL_CLIENTE });
  };

  return (
    <div className="pt-2 border-t border-gray-100 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-gray-700">Pacientes</div>
          <p className="text-[11px] text-gray-400">
            Quién viene a consulta. Puede ser un hijo, varios, o la propia persona que abre la ficha.
          </p>
        </div>
        {pacientes.length === 0 && (
          <button type="button" onClick={añadir}
            className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:border-gray-400">
            Añadir paciente
          </button>
        )}
      </div>

      {pacientes.map((p, i) => {
        const esElCliente = p.relationship === PARENTESCO_ES_EL_CLIENTE;
        const edad = edadDesde(p.birthDate);
        return (
          <div key={i} className="rounded-xl border border-gray-100 bg-gray-50/60 p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-medium text-gray-500">Paciente {i + 1}</span>
              <button type="button" onClick={() => quitar(i)}
                className="text-[11px] text-gray-400 hover:text-red-600">
                Quitar
              </button>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={esElCliente}
                onChange={(e) => marcarEsElCliente(i, e.target.checked)}
                className="rounded border-gray-300 accent-[var(--color-primary)]" />
              <span className="text-xs text-gray-600">El paciente es el propio cliente</span>
            </label>

            {CAMPOS_PACIENTE.map(({ label, key, type, placeholder }) => (
              <div key={key}>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  {label}
                  {key === "birthDate" && edad != null && (
                    <span className="ml-1.5 text-gray-400 font-normal">· {edad} año{edad === 1 ? "" : "s"}</span>
                  )}
                </label>
                <input type={type} value={p[key] || ""} placeholder={placeholder}
                  onChange={(e) => actualizar(i, { [key]: e.target.value })}
                  className={inputCls} />
              </div>
            ))}

            {!esElCliente && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Parentesco</label>
                <select value={p.relationship || ""} onChange={(e) => actualizar(i, { relationship: e.target.value })}
                  className={inputCls}>
                  <option value="">Sin especificar</option>
                  {PARENTESCOS.filter((r) => r !== PARENTESCO_ES_EL_CLIENTE).map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        );
      })}

      {pacientes.length > 0 && (
        <button type="button" onClick={añadir}
          className="w-full text-xs py-2 rounded-lg border border-dashed border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700">
          + Añadir otro paciente
        </button>
      )}
    </div>
  );
}
