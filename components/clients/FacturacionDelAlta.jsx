"use client";

/**
 * FacturacionDelAlta — a nombre de quién se emite la factura (08/08/2026,
 * petición del Centro Aumenta: «en caso de necesitar factura, a nombre de qué
 * progenitor se realiza, indicar posibilidad de CIF/NIF»).
 *
 * Va PLEGADO y al final: la mayoría de las altas no necesita factura en ese
 * momento, y un bloque de tres campos abierto por defecto se lee como si
 * hiciera falta rellenarlo.
 *
 * ── POR QUÉ SE COPIA EL DATO Y NO SE GUARDA A QUIÉN SE ELIGIÓ ──────────────
 * La tentación es guardar «se factura al progenitor 2» y resolverlo al emitir.
 * No se puede: el día que alguien corrija el DNI de ese progenitor, las
 * facturas YA EMITIDAS cambiarían de datos retroactivamente, y una factura
 * emitida no se toca — lo que esté mal se arregla con una rectificativa. Así
 * que elegir un progenitor COPIA su nombre y su documento a los datos fiscales
 * de la ficha, donde quedan visibles y editables.
 *
 * La copia va en UNA sola dirección: esto nunca escribe en la lista de tutores.
 * Elegir a quién se factura no puede cambiar quién tiene que firmar el
 * contrato de la familia.
 */

import { useState } from "react";

const inputCls =
  "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)] placeholder:text-gray-300";

export default function FacturacionDelAlta({ valores, onChange, titular, progenitores }) {
  const [abierto, setAbierto] = useState(false);

  const candidatos = [
    { id: "titular", etiqueta: titular.name ? `${titular.name} (titular de la ficha)` : "El titular de la ficha", name: titular.name, doc: titular.taxId },
    ...(progenitores ?? [])
      .filter((g) => (g.name || "").trim())
      .map((g, i) => ({ id: `prog-${i}`, etiqueta: `${g.name} (progenitor)`, name: g.name, doc: g.dni })),
  ];

  const usar = (c) => onChange({ fiscalName: c.name || "", fiscalTaxId: c.doc || "" });

  const relleno = (valores.fiscalName || "").trim() || (valores.fiscalTaxId || "").trim();

  return (
    <div className="pt-2 border-t border-gray-100">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="w-full flex items-center justify-between text-left"
      >
        <span>
          <span className="block text-xs font-medium text-gray-700">
            Facturación {relleno && <span className="text-[var(--color-primary)]">· rellena</span>}
          </span>
          <span className="block text-[11px] text-gray-400">
            Opcional. Solo si van a pedir factura y no va a nombre del titular.
          </span>
        </span>
        <span className="text-xs text-gray-400 shrink-0 ml-3">{abierto ? "Ocultar" : "Abrir"}</span>
      </button>

      {abierto && (
        <div className="mt-3 space-y-3">
          {candidatos.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              <span className="text-[11px] text-gray-500 w-full">Copiar los datos de:</span>
              {candidatos.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => usar(c)}
                  disabled={!c.name}
                  className="text-[11px] px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:border-gray-400 disabled:opacity-40"
                >
                  {c.etiqueta}
                </button>
              ))}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Nombre o razón social de la factura
            </label>
            <input
              type="text"
              value={valores.fiscalName || ""}
              placeholder="Javier Pérez Ruiz · o Empresa S.L."
              onChange={(e) => onChange({ ...valores, fiscalName: e.target.value })}
              className={inputCls}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">NIF / CIF de la factura</label>
            <input
              type="text"
              value={valores.fiscalTaxId || ""}
              placeholder="12345678Z · o B12345678"
              onChange={(e) => onChange({ ...valores, fiscalTaxId: e.target.value })}
              className={inputCls}
            />
            <p className="text-[11px] text-gray-400 mt-1">
              Vale el DNI de un progenitor o el CIF de una empresa. Es el que sale impreso en la
              factura; el DNI de arriba sigue siendo el del titular de la ficha.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
