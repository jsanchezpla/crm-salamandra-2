"use client";

// modules/config/tarjetas/ui.jsx — las piezas de maquetación que comparten
// todas las tarjetas de Configuración: la pestaña, la tarjeta con su aviso de
// módulo, la sección, el campo y el botón. Nada de aquí habla con la API.


import { avisoDeTarjeta, etiquetaDeModulo } from "../../../lib/configuracion/pestanas.js";
export const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

// ── Helpers de estilo (mismos que la config de facturación) ──────────────────
/** Una zona del menú de arriba. Mismo gesto que las pestañas de la ficha. */
export function BotonZona({ activa, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={activa ? "page" : undefined}
      className={`px-3 py-2.5 text-sm border-b-2 -mb-px transition-colors ${
        activa
          ? "border-[var(--color-primary,#1B3A2D)] text-[var(--ink-900)] font-medium"
          : "border-transparent text-neutral-400 hover:text-neutral-700"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Envuelve una tarjeta y, si su módulo no está contratado, la atenúa y lo dice.
 *
 * **No la desactiva**, y eso es deliberado: la Configuración es universal
 * (regla #14) y un cliente tiene que poder dejar puesta su clave de Stripe hoy
 * y contratar Citas el mes que viene. Por eso vuelve a opacidad entera al pasar
 * por encima o al escribir dentro — atenuada es «esto todavía no hace nada»,
 * no «esto no se toca».
 *
 * `callado` la atenúa sin repetir el texto: se usa cuando la zona entera ya lo
 * ha dicho una vez arriba.
 *
 * Si `children` no pinta nada (un `isAdmin && …` que vale `false`), no se
 * envuelve nada: sería un aviso flotando solo, sin la tarjeta a la que se
 * refiere.
 */
export function Tarjeta({ clave, tieneModulo, callado = false, children }) {
  if (!children) return null;
  const aviso = avisoDeTarjeta(clave, tieneModulo);
  // De qué módulo es, en TODAS las zonas. No depende de lo contratado: es qué
  // ES la tarjeta, no si le sirve. Las universales no llevan rótulo — con esto
  // en todas partes, no llevarlo ya significa «vale para todo el CRM».
  const etiqueta = etiquetaDeModulo(clave);
  if (!aviso && !etiqueta) return children;
  return (
    <div className={aviso ? "opacity-60 hover:opacity-100 focus-within:opacity-100 transition-opacity" : undefined}>
      {etiqueta && (
        <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-1.5">
          {etiqueta}
        </p>
      )}
      {aviso && !callado && <p className="text-[11px] text-neutral-500 mb-1.5">{aviso}</p>}
      {children}
    </div>
  );
}

export function Section({ title, right, children }) {
  return (
    <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="eyebrow">{title}</h2>
        {right}
      </div>
      {children}
    </div>
  );
}

export function Field({ label, children, full }) {
  return (
    <div className={`flex flex-col gap-1 ${full ? "sm:col-span-2" : ""}`}>
      <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">{label}</label>
      {children}
    </div>
  );
}

export function PrimaryButton({ onClick, children }) {
  return (
    <button onClick={onClick} className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white"
      style={{ background: "var(--color-primary, #1B3A2D)" }}>
      {children}
    </button>
  );
}
