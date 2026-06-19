"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Botón de ayuda (?). El cuadro se porta al <body> con createPortal y se
 * posiciona en coordenadas calculadas con JS:
 *   - z-index alto (9999) → siempre por encima de drawers, modales, etc.
 *   - Clamp al viewport → nunca se sale ni se recorta a los lados.
 *   - Flip vertical → si no cabe abajo, salta arriba.
 *   - Pequeño delay al cerrar → el cursor puede pasar al cuadro sin parpadeo.
 *   - Se cierra al hacer scroll en cualquier parte (evita coords obsoletos).
 *
 * Props:
 *  - title:      título corto (ej. "Empresas")
 *  - children:   contenido en texto sencillo
 *  - placement:  "bottom" (default) | "top" | "right" | "left"
 *                (left/right se tratan como "bottom" en cálculo; el flip arriba
 *                actúa si no cabe abajo)
 *  - label:      aria-label del botón (default: "Más información")
 *  - className:  clases extra para el wrapper inline
 */
const TOOLTIP_MAX_WIDTH = 288; // sm:w-72
const VIEWPORT_PADDING = 8;
const TRIGGER_GAP = 8;
const CLOSE_DELAY = 150;

export default function HelpTooltip({
  title,
  children,
  placement = "bottom",
  label = "Más información",
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const triggerRef = useRef(null);
  const tooltipRef = useRef(null);
  const closeTimerRef = useRef(null);
  const tooltipId = useId();

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);
  const openNow = useCallback(() => {
    cancelClose();
    setOpen(true);
  }, [cancelClose]);
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => setOpen(false), CLOSE_DELAY);
  }, [cancelClose]);
  const closeNow = useCallback(() => {
    cancelClose();
    setOpen(false);
  }, [cancelClose]);

  useLayoutEffect(() => {
    if (!open) return undefined;

    function updatePosition() {
      const trigger = triggerRef.current;
      const tooltip = tooltipRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const tooltipWidth = Math.min(
        TOOLTIP_MAX_WIDTH,
        viewportWidth - 2 * VIEWPORT_PADDING
      );
      const tooltipHeight = tooltip?.offsetHeight ?? 0;

      // Horizontal: centrar respecto al trigger y clamp al viewport
      let left = rect.left + rect.width / 2 - tooltipWidth / 2;
      left = Math.max(
        VIEWPORT_PADDING,
        Math.min(left, viewportWidth - tooltipWidth - VIEWPORT_PADDING)
      );

      // Vertical: por defecto abajo. Flip arriba si no cabe abajo.
      const spaceBelow = viewportHeight - rect.bottom;
      const fitsBelow = spaceBelow >= tooltipHeight + TRIGGER_GAP + VIEWPORT_PADDING;
      const fitsAbove = rect.top >= tooltipHeight + TRIGGER_GAP + VIEWPORT_PADDING;
      let top;
      if (placement === "top" && fitsAbove) {
        top = rect.top - TRIGGER_GAP - tooltipHeight;
      } else if (!fitsBelow && fitsAbove) {
        top = rect.top - TRIGGER_GAP - tooltipHeight;
      } else {
        top = rect.bottom + TRIGGER_GAP;
      }
      top = Math.max(
        VIEWPORT_PADDING,
        Math.min(top, viewportHeight - tooltipHeight - VIEWPORT_PADDING)
      );

      setCoords({ top, left, width: tooltipWidth });
    }

    updatePosition();
    // Re-medir al siguiente frame, cuando el tooltip ya tiene su altura final
    const rafId = requestAnimationFrame(updatePosition);

    window.addEventListener("resize", updatePosition);
    // El scroll en cualquier ancestro invalida el rect → cerrar
    window.addEventListener("scroll", closeNow, true);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", closeNow, true);
    };
  }, [open, placement, closeNow]);

  useEffect(() => {
    if (!open) return undefined;
    function onPointer(e) {
      const inTrigger = triggerRef.current?.contains(e.target);
      const inTooltip = tooltipRef.current?.contains(e.target);
      if (!inTrigger && !inTooltip) closeNow();
    }
    function onKey(e) {
      if (e.key === "Escape") closeNow();
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, closeNow]);

  const tooltipNode = open && typeof document !== "undefined" ? createPortal(
    <span
      ref={tooltipRef}
      id={tooltipId}
      role="tooltip"
      style={{
        position: "fixed",
        top: coords?.top ?? -9999,
        left: coords?.left ?? -9999,
        width: coords?.width ?? TOOLTIP_MAX_WIDTH,
        zIndex: 9999,
        visibility: coords ? "visible" : "hidden",
      }}
      className="block p-3 rounded-lg bg-neutral-900 text-white shadow-xl ring-1 ring-black/5 text-[11px] leading-relaxed cursor-default"
      onMouseEnter={openNow}
      onMouseLeave={scheduleClose}
      onClick={(e) => e.stopPropagation()}
    >
      {title && <span className="block font-bold text-white mb-1">{title}</span>}
      <span className="block text-neutral-200">{children}</span>
    </span>,
    document.body
  ) : null;

  return (
    <span className={`relative inline-flex align-middle ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (open) closeNow();
          else openNow();
        }}
        onMouseEnter={openNow}
        onMouseLeave={scheduleClose}
        onFocus={openNow}
        onBlur={scheduleClose}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold text-neutral-500 bg-neutral-100 hover:bg-neutral-200 hover:text-neutral-700 transition-colors cursor-help select-none"
      >
        ?
      </button>
      {tooltipNode}
    </span>
  );
}
