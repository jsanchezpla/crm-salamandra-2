"use client";

import { useState } from "react";
import Select from "../../../components/ui/Select.jsx";
import { inputCls } from "./ui.jsx";
import {
  estadoDelTope,
  importeDelTope,
  importeEnMoneda,
  TRAMO_DE_AVISO,
  topeParaGuardar,
} from "../../../lib/ai/topeDeGasto.js";

/**
 * El tope mensual de gasto de IA del centro (14/09/2026), debajo del consumo
 * en la tarjeta «Con qué IA se redacta» de Configuración → Conexiones.
 *
 * Nace del 10/09/2026: Aumenta se quedó sin saldo a media tarde y nada avisó
 * antes. Aquí dirección pone un importe al mes; al 80 % se avisa a los
 * administradores por la campana y al 100 % quien no es administrador deja de
 * poder usar la IA hasta el día 1 (`vetoAi`, `lib/ai/frenoDeGasto.js`).
 *
 * Solo importa reglas PURAS (`lib/ai/topeDeGasto.js`): la validación y el
 * «¿ya te has pasado?» son las mismas que aplica el servidor, sin copiarlas.
 * Guardar va por el PATCH de siempre (`onGuardar` → `patchTenant`), que ya
 * exige rol, lleva el guard de la demo, audita y manda el recibo.
 *
 * `tope` es el `estadoDelTope` que devuelve `GET /api/tenant/ia/consumo` (o
 * `null` sin tope) y `gastadoUsd` el total del mes. No hay modal: la
 * confirmación va en línea, así que no aplica la regla 13.
 */

const MONEDAS = [
  { value: "EUR", label: "€" },
  { value: "USD", label: "$" },
];

/** Qué pasa al 100 %, con cuántas personas se quedarían sin IA (solo el número). */
function textoDelFreno(n) {
  const resto = "(ni la búsqueda de empresas en Google) hasta el día 1; los administradores sí.";
  if (n === 0) return "Al 100 % no se frenaría a nadie: en este centro todas las cuentas son de administración.";
  if (n === 1) return `Al 100 %, la persona sin rol de administración no podrá usar la IA ${resto}`;
  if (Number.isInteger(n) && n > 1) {
    return `Al 100 %, las ${n.toLocaleString("es-ES")} personas sin rol de administración no podrán usar la IA ${resto}`;
  }
  return `Al 100 %, quien no tenga rol de administración no podrá usar la IA ${resto}`;
}

export default function TopeIA({ tope, gastadoUsd = 0, personasSinAdmin = null, readOnly = false, onGuardar }) {
  const hayTope = !!tope && tope.nivel !== "sin_tope";
  const [editando, setEditando] = useState(false);
  const [importe, setImporte] = useState("");
  const [moneda, setMoneda] = useState("EUR");
  const [problema, setProblema] = useState(null);
  const [pendiente, setPendiente] = useState(null); // el tope que espera confirmación
  const [guardando, setGuardando] = useState(false);

  const bloqueado = readOnly || guardando || !onGuardar;
  const formulario = !hayTope || editando;

  function abrir() {
    setImporte(String(tope.importe).replace(".", ","));
    setMoneda(tope.moneda === "USD" ? "USD" : "EUR");
    setProblema(null);
    setPendiente(null);
    setEditando(true);
  }

  function cancelar() {
    setEditando(false);
    setProblema(null);
    setPendiente(null);
  }

  async function guardar(valor) {
    if (bloqueado) return;
    setGuardando(true);
    try {
      const hecho = await onGuardar(valor);
      if (hecho) {
        setEditando(false);
        setPendiente(null);
        setProblema(null);
        setImporte("");
      }
    } finally {
      setGuardando(false);
    }
  }

  function alPulsarGuardar() {
    if (bloqueado) return;
    const { valor, problema: p } = topeParaGuardar({ importe, moneda });
    if (p || !valor) {
      setProblema(p || "Escribe el importe del tope.");
      return;
    }
    setProblema(null);
    // El mismo cálculo que frena en el servidor: si ya se ha pasado, que lo confirme.
    if (estadoDelTope({ gastadoUsd, tope: valor }).nivel === "alcanzado") {
      setPendiente(valor);
      return;
    }
    guardar(valor);
  }

  const nivel = tope?.nivel;
  const colorBarra = nivel === "alcanzado" ? "bg-rose-600" : nivel === "aviso" ? "bg-amber-500" : "bg-neutral-400";

  return (
    <div className="mt-3 pt-3 border-t border-neutral-200">
      <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Tope mensual</div>

      {hayTope && (
        <div className="mt-1">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div className="text-sm text-neutral-800">
              {importeEnMoneda(tope.gastadoUsd, tope.moneda)} de {importeDelTope(tope)}{" "}
              <span className="text-neutral-500">· {tope.porcentaje.toLocaleString("es-ES")} %</span>
            </div>
            {!editando && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={abrir}
                  disabled={bloqueado}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-neutral-600 border border-neutral-200 bg-white hover:bg-neutral-50 disabled:opacity-40"
                >
                  Cambiar
                </button>
                <button
                  type="button"
                  onClick={() => guardar(null)}
                  disabled={bloqueado}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-neutral-500 border border-neutral-200 bg-white hover:bg-neutral-50 disabled:opacity-40"
                >
                  Quitar tope
                </button>
              </div>
            )}
          </div>
          <div
            className="mt-2 h-2 rounded-full bg-neutral-200 overflow-hidden"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, tope.porcentaje)}
            aria-label="Gasto de IA del mes frente al tope"
          >
            <div className={`h-full rounded-full ${colorBarra}`} style={{ width: `${Math.min(100, tope.porcentaje)}%` }} />
          </div>
          {nivel === "alcanzado" && (
            <p className="mt-2 text-xs text-rose-700">El equipo no puede usar la IA hasta el día 1; tú sí.</p>
          )}
          {nivel === "aviso" && (
            <p className="mt-2 text-xs text-amber-700">Pasado el {TRAMO_DE_AVISO} %: al llegar al 100 % se frena al equipo.</p>
          )}
        </div>
      )}

      {!hayTope && <p className="mt-1 text-sm text-neutral-700">Sin tope: la IA no se frena nunca.</p>}

      {formulario && (
        <div className="mt-2">
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={importe}
              disabled={bloqueado}
              onChange={(e) => {
                setImporte(e.target.value);
                setProblema(null);
                setPendiente(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  alPulsarGuardar();
                }
              }}
              placeholder="Importe al mes (p. ej. 60)"
              aria-label="Importe del tope mensual"
              className={inputCls + " sm:w-56 disabled:bg-neutral-50 disabled:cursor-not-allowed"}
            />
            <Select
              disabled={bloqueado}
              value={moneda}
              onChange={(v) => {
                setMoneda(v);
                setPendiente(null);
              }}
              options={MONEDAS}
              aria-label="Moneda del tope"
              className={inputCls + " sm:w-20 shrink-0"}
            />
            <button
              type="button"
              onClick={alPulsarGuardar}
              disabled={bloqueado || !importe.trim() || !!pendiente}
              className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-40"
              style={{ background: "var(--color-primary, #1B3A2D)" }}
            >
              {guardando ? "..." : "Guardar tope"}
            </button>
            {editando && (
              <button
                type="button"
                onClick={cancelar}
                disabled={guardando}
                className="px-3 py-2 rounded-lg text-xs font-semibold text-neutral-500 border border-neutral-200 hover:bg-neutral-50 disabled:opacity-40"
              >
                Cancelar
              </button>
            )}
          </div>

          {problema && <p className="mt-2 text-xs text-rose-700">{problema}</p>}

          {pendiente && (
            <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              <p>
                Ya van {importeEnMoneda(gastadoUsd, pendiente.moneda)}: con {importeDelTope(pendiente)} el equipo se quedaría sin IA
                en cuanto guardes.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => guardar(pendiente)}
                  disabled={bloqueado}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-40"
                  style={{ background: "var(--color-primary, #1B3A2D)" }}
                >
                  Confirmar
                </button>
                <button
                  type="button"
                  onClick={() => setPendiente(null)}
                  disabled={guardando}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-neutral-600 border border-amber-200 bg-white hover:bg-neutral-50 disabled:opacity-40"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <p className="mt-2 text-[11px] text-neutral-400 leading-relaxed">
        Al {TRAMO_DE_AVISO} % avisamos a los administradores por la campana. {textoDelFreno(personasSinAdmin)} Suma Claude,
        ChatGPT y Whisper. Es una estimación: para un corte exacto, pon también un límite en la consola del proveedor.
      </p>
    </div>
  );
}
