import { useSyncExternalStore } from "react";

/**
 * ¿Pantalla de móvil? (≤ 640 px, el `sm` de Tailwind) — 12/09/2026.
 *
 * Lo usa el calendario global para darle a FullCalendar otra barra en el
 * móvil: con la de escritorio, a 375 px el título «7 – 13 sept 2026» se partía
 * en tres líneas y los botones se amontonaban.
 *
 * `useSyncExternalStore` y no un `useState` + efecto: sigue al `matchMedia`
 * sin un pintado de más, y en el servidor (y al hidratar) dice `false`, así
 * que el HTML del servidor y el primer pintado del cliente coinciden. Quien
 * dependa del valor al MONTARSE (el `initialView` de FullCalendar) tiene que
 * corregirlo cuando cambie.
 */
const CONSULTA = "(max-width: 640px)";

function hayMatchMedia() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

function suscribir(avisar) {
  if (!hayMatchMedia()) return () => {};
  const mq = window.matchMedia(CONSULTA);
  mq.addEventListener("change", avisar);
  return () => mq.removeEventListener("change", avisar);
}

function leer() {
  return hayMatchMedia() && window.matchMedia(CONSULTA).matches;
}

function leerEnServidor() {
  return false;
}

export function useEsMovil() {
  return useSyncExternalStore(suscribir, leer, leerEnServidor);
}
