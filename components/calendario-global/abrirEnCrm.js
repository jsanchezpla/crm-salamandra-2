/**
 * Abrir el CRM de un cliente desde el calendario global (12/09/2026).
 *
 * ── POR QUÉ SE ABRE LA PESTAÑA ANTES DE PEDIR EL PASE ───────────────────────
 * La pantalla de antes pedía el pase con `fetch` y DESPUÉS hacía
 * `window.open(url)`. Para el navegador eso ya no es un clic del usuario
 * —hay un `await` por medio— y más de uno lo trata como ventana emergente y
 * la bloquea sin decir nada: el botón «no hacía nada».
 *
 * Aquí la pestaña se abre en blanco en el MISMO clic (esta función hace el
 * `window.open` antes de su primer `await`, así que quien la llame desde un
 * `onClick` no debe esperar nada antes de llamarla), y cuando llega el pase se
 * la manda a su dirección. Si el pase falla, la pestaña se cierra y el error
 * sube a quien llamó para que lo enseñe.
 *
 * `opener = null`: la pestaña nueva es otro host (el CRM) y no tiene por qué
 * poder tocar esta.
 *
 * `destino` es el del contrato del endpoint `POST /api/calendario-global/salto`:
 *   { tipo: "calendario", taskId?, fecha? } | { tipo: "proyecto", projectId }
 *   | { tipo: "tablero", projectId }
 * El servidor lo pasa por lista blanca; aquí no se monta ninguna ruta.
 */
import { pedirJson } from "./api.js";

export async function abrirEnCrm({ slug, destino }) {
  const pestana = typeof window !== "undefined" ? window.open("about:blank", "_blank") : null;
  if (!pestana) {
    throw new Error("El navegador ha bloqueado la pestaña nueva. Permite las ventanas emergentes de esta página y vuelve a probar.");
  }
  try {
    pestana.opener = null;
  } catch {
    // Algún navegador no deja escribirlo; no impide seguir.
  }
  try {
    pestana.document.title = "Abriendo el CRM…";
    pestana.document.body.style.cssText = "font:14px system-ui,sans-serif;color:#5C6461;margin:0;padding:32px;background:#F7F7F4";
    pestana.document.body.textContent = "Abriendo el CRM…";
  } catch {
    // Solo es el texto de espera.
  }

  try {
    const pase = await pedirJson("/api/calendario-global/salto", { method: "POST", body: { slug, destino } });
    const url = new URL(String(pase?.url ?? ""));
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Dirección del CRM no válida");
    pestana.location.href = url.toString();
    return pase;
  } catch (err) {
    try {
      pestana.close();
    } catch {
      // Si no se deja cerrar, se queda en blanco; el aviso explica qué pasó.
    }
    if (err instanceof TypeError) throw new Error("No se ha podido abrir el CRM de ese cliente.");
    throw err;
  }
}
