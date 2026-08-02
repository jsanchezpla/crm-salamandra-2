"use client";

/**
 * SignaturePad — canvas para firmar con el dedo. Devuelve el PNG por `onChange`
 * (null si está en blanco).
 *
 * Vivía dentro de ContratoGate.jsx; se saca a su propio fichero el 02/08/2026 al
 * añadir el consentimiento de imagen, que firma exactamente igual. Es el mismo
 * componente, sin cambios de comportamiento.
 */

import { useCallback, useEffect, useRef } from "react";

export default function SignaturePad({ onChange, disabled }) {
  const canvasRef = useRef(null);
  const dibujando = useRef(false);
  const huboTrazo = useRef(false);

  // El canvas se dimensiona en píxeles reales del dispositivo: si se deja al
  // tamaño CSS, en móvil la firma sale pixelada y descentrada respecto al dedo.
  const ajustar = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (!rect.width) return;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827";
  }, []);

  useEffect(() => {
    ajustar();
    window.addEventListener("resize", ajustar);
    return () => window.removeEventListener("resize", ajustar);
  }, [ajustar]);

  function posicion(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function empezar(e) {
    if (disabled) return;
    e.preventDefault();
    canvasRef.current.setPointerCapture?.(e.pointerId);
    dibujando.current = true;
    const { x, y } = posicion(e);
    const ctx = canvasRef.current.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function mover(e) {
    if (!dibujando.current) return;
    e.preventDefault();
    const { x, y } = posicion(e);
    const ctx = canvasRef.current.getContext("2d");
    ctx.lineTo(x, y);
    ctx.stroke();
    huboTrazo.current = true;
  }

  function soltar() {
    if (!dibujando.current) return;
    dibujando.current = false;
    onChange(huboTrazo.current ? canvasRef.current.toDataURL("image/png") : null);
  }

  function limpiar() {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    huboTrazo.current = false;
    onChange(null);
  }

  return (
    <div>
      <div className="relative rounded-lg border border-dashed border-[var(--widget-border)] bg-[var(--widget-card)]">
        <canvas
          ref={canvasRef}
          onPointerDown={empezar}
          onPointerMove={mover}
          onPointerUp={soltar}
          onPointerLeave={soltar}
          onPointerCancel={soltar}
          className="w-full h-40 touch-none rounded-lg"
          aria-label="Área para dibujar tu firma"
        />
        <span className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-[12px] text-[var(--widget-text-faint)]">
          Firma aquí con el dedo o el ratón
        </span>
      </div>
      <button
        type="button"
        onClick={limpiar}
        disabled={disabled}
        className="mt-2 text-[12px] text-[var(--widget-text-muted)] underline underline-offset-2 disabled:opacity-50"
      >
        Borrar y volver a firmar
      </button>
    </div>
  );
}
