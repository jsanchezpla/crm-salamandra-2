"use client";

/**
 * ProgenitoresDelAlta — el OTRO progenitor o tutor, desde el mostrador
 * (08/08/2026, petición del Centro Aumenta).
 *
 * El centro pidió que en el alta figuren «nombre y apellidos, DNI y teléfono de
 * ambos progenitores». Del primero ya se piden los cuatro datos arriba: es el
 * titular de la ficha. Lo que faltaba era decir QUÉ es del paciente —lo resuelve
 * el desplegable «Parentesco con el paciente»— y poder apuntar al segundo, que
 * hasta hoy había que añadir después, entrando en la ficha, en otra pantalla.
 *
 * Sale UN bloque pintado de entrada, no un botón: si hay que pulsar para que
 * aparezca, en la práctica no se rellena — que es exactamente lo que ha pasado
 * hasta ahora con la sección de tutores de la ficha.
 *
 * ⚠️ Ninguno de estos campos es obligatorio. Una familia monoparental, o una
 * llamada en la que solo dejan un teléfono, tienen que poder darse de alta sin
 * inventarse un segundo progenitor.
 *
 * ⚠️ Nadie nace marcado como firmante del contrato: eso cambiaría quién tiene
 * que firmar en el área privada y no es una decisión de mostrador. Se marca
 * desde la ficha, en «Padres y tutores», que es donde se ve el efecto.
 */

import { CAMPOS_PROGENITOR, MAX_PROGENITORES, PARENTESCOS_TITULAR } from "../../lib/clients/formularioAlta.js";

export const PROGENITOR_VACIO = { name: "", relationship: "padre", dni: "", phone: "", email: "" };

/** Las mismas relaciones que el titular, menos «no es progenitor»: aquí sí lo es. */
const RELACIONES = PARENTESCOS_TITULAR.filter((r) => r.valor !== "");

const inputCls =
  "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)] placeholder:text-gray-300";

export default function ProgenitoresDelAlta({ progenitores, onChange, parentescoTitular }) {
  const actualizar = (i, campos) =>
    onChange(progenitores.map((g, idx) => (idx === i ? { ...g, ...campos } : g)));

  const añadir = () => onChange([...progenitores, { ...PROGENITOR_VACIO }]);
  const quitar = (i) => onChange(progenitores.filter((_, idx) => idx !== i));

  // Si arriba han dicho que el titular es la madre, lo probable es que este sea
  // el padre, y al revés. Es una sugerencia editable, no una deducción oculta.
  const sugerida = parentescoTitular === "madre" ? "padre" : parentescoTitular === "padre" ? "madre" : "tutor";

  return (
    <div className="pt-2 border-t border-gray-100 space-y-3">
      <div>
        <div className="text-xs font-medium text-gray-700">El otro progenitor o tutor</div>
        <p className="text-[11px] text-gray-400">
          {parentescoTitular
            ? "Del primero ya tenemos los datos arriba: es quien abre la ficha."
            : "Opcional. Si no hay un segundo, déjalo en blanco."}
        </p>
      </div>

      {progenitores.map((g, i) => (
        <div key={i} className="rounded-xl border border-gray-100 bg-gray-50/60 p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-medium text-gray-500">
              {progenitores.length === 1 ? "Progenitor o tutor" : `Progenitor o tutor ${i + 1}`}
            </span>
            <button
              type="button"
              onClick={() => quitar(i)}
              className="text-[11px] text-gray-400 hover:text-red-600"
            >
              Quitar
            </button>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Parentesco</label>
            <select
              value={g.relationship || sugerida}
              onChange={(e) => actualizar(i, { relationship: e.target.value })}
              className={inputCls}
            >
              {RELACIONES.map((r) => (
                <option key={r.valor} value={r.valor}>{r.label}</option>
              ))}
            </select>
          </div>

          {CAMPOS_PROGENITOR.map(({ label, key, type, placeholder, ayuda }) => (
            <div key={key}>
              <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
              <input
                type={type}
                value={g[key] || ""}
                placeholder={placeholder}
                onChange={(e) => actualizar(i, { [key]: e.target.value })}
                className={inputCls}
              />
              {ayuda && <p className="text-[11px] text-amber-700 mt-1">{ayuda}</p>}
            </div>
          ))}
        </div>
      ))}

      {progenitores.length === 0 && (
        <button
          type="button"
          onClick={añadir}
          className="w-full text-xs py-2 rounded-lg border border-dashed border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700"
        >
          + Añadir progenitor o tutor
        </button>
      )}

      {progenitores.length > 0 && progenitores.length < MAX_PROGENITORES && (
        <button
          type="button"
          onClick={añadir}
          className="w-full text-xs py-2 rounded-lg border border-dashed border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700"
        >
          + Añadir otro
        </button>
      )}
    </div>
  );
}
