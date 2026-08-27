"use client";

// modules/config/tarjetas/Portal.jsx — pestaña «Portal del cliente» de
// Configuración: lo que ve cada persona en su área privada.


import { useState } from "react";
import { PrimaryButton } from "./ui.jsx";
/**
 * Dirección del área privada, que vive en la WEB del cliente (el portal va
 * incrustado en un iframe de su WordPress, no en un sitio nuestro), así que el
 * CRM no puede deducirla.
 *
 * Sin ella, a quien acaba de reservar solo se le puede ofrecer el enlace de
 * cancelación con el identificador dentro, y se le pide que se lo guarde —una
 * nota que se pierde el mismo día—. Con ella se le manda a su área privada,
 * donde además ve sus citas y los avisos.
 */
export function AreaPrivadaCard({ url, readOnly, onGuardar }) {
  const [borrador, setBorrador] = useState(url ?? "");

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="text-sm font-semibold text-neutral-800">Área privada del cliente</div>
      <p className="text-xs text-neutral-400 mt-0.5 max-w-lg">
        La página de tu web donde tienes puesta el área privada. Se usa para mandar ahí a quien
        quiera consultar o cancelar sus citas, en vez de darle un enlace suelto que tenga que
        guardarse.
      </p>

      <div className="mt-1 text-[11px] font-medium">
        {(url ?? "").trim() ? (
          <span className="text-emerald-700">Puesta: al reservar se les manda ahí.</span>
        ) : (
          <span className="text-neutral-400">
            Sin poner: al reservar se les da el enlace directo de cancelación.
          </span>
        )}
      </div>

      <div className="mt-3">
        <label className="block text-[11px] text-neutral-500 mb-1">Dirección del área privada</label>
        <div className="flex gap-2 flex-wrap">
          <input
            type="url"
            inputMode="url"
            value={borrador}
            disabled={readOnly}
            onChange={(e) => setBorrador(e.target.value)}
            placeholder="https://tuweb.com/area-privada"
            className="flex-1 min-w-[220px] text-sm border border-neutral-200 rounded-lg px-3 py-2 disabled:bg-neutral-50"
          />
          {!readOnly && (
            <PrimaryButton onClick={() => onGuardar(borrador.trim())}>Guardar</PrimaryButton>
          )}
        </div>
      </div>
    </div>
  );
}

export function BloqueoImpagoCard({ activo, readOnly, onChange }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-neutral-800">Documentos del portal por mes pagado</div>
          <p className="text-xs text-neutral-400 mt-0.5 max-w-lg">
            En el área privada, la familia ve los documentos de un mes solo cuando consta el cobro
            de ese mes. Al registrar el cobro, sus documentos se abren solos. Lo que sube la propia
            familia nunca se bloquea, y siempre se puede abrir un mes a mano desde su ficha.
          </p>
        </div>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onChange(!activo)}
          className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 ${activo ? "bg-[var(--color-primary,#1B3A2D)]" : "bg-neutral-300"}`}
          aria-label={activo ? "Desactivar bloqueo por impago" : "Activar bloqueo por impago"}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${activo ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>
      <div className="mt-1 text-[11px] font-medium">
        {activo
          ? <span className="text-emerald-700">Activo: cada mes se abre al registrar su cobro.</span>
          : <span className="text-neutral-400">Apagado: la familia ve toda su documentación.</span>}
      </div>
      <p className="text-[10px] text-neutral-400 mt-2">
        Ojo: si el centro no registra los cobros con su <strong>mes</strong>, al encenderlo
        desaparece de golpe la documentación de todas las familias.
      </p>
    </div>
  );
}
