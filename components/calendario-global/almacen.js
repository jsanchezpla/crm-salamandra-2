/**
 * Preferencias del calendario global guardadas en el navegador (12/09/2026).
 *
 * Qué clientes están ocultos, si se ven las tareas de proyectos y el «color
 * por». No van a la base de datos a propósito: `master.users` no tiene sitio
 * para preferencias y abrir una tabla para tres interruptores de una pantalla
 * interna de Salamandra no compensa. Si se pierde (otro navegador, modo
 * privado) la pantalla vuelve a lo de fábrica, que es verlo todo.
 *
 * ── POR QUÉ `useSyncExternalStore` Y NO `useState` + `useEffect` ─────────────
 * La página se pinta primero en el servidor, donde no hay `localStorage`: leer
 * en el `useState` inicial rompe la hidratación, y leer en un efecto obliga a
 * pintar dos veces y a que la pantalla pida los eventos con la preferencia de
 * fábrica antes de ver la buena. Con un almacén externo React usa `null` al
 * hidratar y el valor real en el mismo arranque, y de regalo las dos pestañas
 * del navegador (Calendario en una, Proyectos en otra) se enteran al momento
 * del cambio de la otra por el evento `storage`.
 *
 * Todo acceso va en try/catch: en modo privado de algunos navegadores
 * `localStorage` existe pero lanza al tocarlo.
 */
import { useCallback, useSyncExternalStore } from "react";

// Aviso dentro de la MISMA pestaña: `storage` solo salta en las demás.
const EVENTO = "calendario-global:almacen";

export function leer(clave) {
  if (!clave) return null;
  try {
    return window.localStorage.getItem(clave);
  } catch {
    return null;
  }
}

export function guardar(clave, valor) {
  if (!clave) return;
  try {
    if (valor == null) window.localStorage.removeItem(clave);
    else window.localStorage.setItem(clave, String(valor));
  } catch {
    // Sin almacén se sigue funcionando: la preferencia dura lo que la página.
  }
  try {
    window.dispatchEvent(new CustomEvent(EVENTO, { detail: clave }));
  } catch {
    // Navegador sin CustomEvent: solo se pierde el aviso entre componentes.
  }
}

function suscribir(avisar) {
  window.addEventListener("storage", avisar);
  window.addEventListener(EVENTO, avisar);
  return () => {
    window.removeEventListener("storage", avisar);
    window.removeEventListener(EVENTO, avisar);
  };
}

const enServidor = () => null;

/** El texto guardado en `clave` (o `null`), vivo: se repinta si cambia. */
export function useValorGuardado(clave) {
  return useSyncExternalStore(suscribir, () => leer(clave), enServidor);
}

/**
 * Una preferencia de texto con lista cerrada de valores.
 * `const [colorPor, setColorPor] = usePreferencia("…:colorPor", "cliente", ["cliente", "prioridad"])`
 */
export function usePreferencia(clave, porDefecto, permitidos = null) {
  const crudo = useValorGuardado(clave);
  const valor = crudo != null && (!permitidos || permitidos.includes(crudo)) ? crudo : porDefecto;
  const fijar = useCallback((nuevo) => guardar(clave, nuevo), [clave]);
  return [valor, fijar];
}
