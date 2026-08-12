"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * El «salir» del back-office (12/08/2026).
 *
 * ── QUÉ ARREGLA ─────────────────────────────────────────────────────────────
 * Era un enlace normal a `/api/auth/logout`, o sea un GET. Ese endpoint solo
 * entiende POST —en la imagen desplegada la ruta registraba un único método—,
 * así que el navegador se llevaba un 405 y **la sesión seguía abierta**. El CRM
 * de los clientes sí cerraba bien porque su menú lo llama con `fetch`.
 *
 * No es cosmético por dónde pasa: el back-office es la pantalla que crea
 * clientes, les cambia los módulos y suspende cuentas, y es la que se queda
 * abierta en un portátil al terminar el día.
 *
 * ── POR QUÉ NO SE ARREGLÓ AÑADIENDO UN GET ──────────────────────────────────
 * Habría sido una línea, y es la salida mala: un cierre de sesión por GET lo
 * dispara cualquier página ajena con una etiqueta de imagen apuntando a esa
 * URL. Molesto más que peligroso —lo peor que consigue es echarte—, pero no hay
 * motivo para abrir esa puerta cuando el patrón bueno ya estaba escrito dos
 * carpetas más allá, en el sidebar del CRM.
 *
 * Va a `/login` con `replace` y no con `push`: después de cerrar sesión, el
 * botón de atrás no debe devolverte a una pantalla del panel.
 */
export default function SalirBoton({ className, style }) {
  const router = useRouter();
  const [saliendo, setSaliendo] = useState(false);

  async function salir() {
    if (saliendo) return;
    setSaliendo(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Aunque falle la llamada se va al login igual: quedarse en el panel
      // dando por hecho que la sesión sigue viva es peor que un cierre a medias,
      // y desde el login se ve enseguida si no se cerró.
    }
    router.replace("/login");
    router.refresh();
  }

  return (
    <button type="button" onClick={salir} disabled={saliendo} className={className} style={style}>
      {saliendo ? "saliendo…" : "salir"}
    </button>
  );
}
