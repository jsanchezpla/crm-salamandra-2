/**
 * Una sola forma de llamar a `/api/calendario-global/*` desde la interfaz
 * (12/09/2026).
 *
 * Todos esos endpoints responden `{ ok, data }` o `{ ok: false, error }`
 * (`lib/utils/apiResponse.js`). Antes cada llamada de la pantalla repetía el
 * mismo `res.json().catch()` y su `if (!res.ok || !json.ok)`; aquí se hace una
 * vez y lo que sube es un `Error` con la frase del servidor, lista para
 * enseñarla en un aviso.
 *
 * El 401 no se trata aquí: lo recoge `SessionKeeper` (interceptor de `fetch`),
 * que intenta renovar la sesión y, si no puede, manda al login.
 */

const FRASE_POR_ESTADO = {
  400: "Los datos enviados no son válidos.",
  403: "No tienes permiso para hacer esto.",
  404: "No se ha encontrado. Puede que ya no exista.",
  409: "Alguien lo ha cambiado a la vez. Recarga y vuelve a probar.",
};

export async function pedirJson(url, { method = "GET", body, signal } = {}) {
  const conCuerpo = body !== undefined;
  let res;
  try {
    res = await fetch(url, {
      method,
      cache: "no-store",
      signal,
      headers: conCuerpo ? { "Content-Type": "application/json" } : undefined,
      body: conCuerpo ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw new Error("Sin conexión con el servidor. Vuelve a probar.");
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    const e = new Error(json?.error || FRASE_POR_ESTADO[res.status] || "No se ha podido completar. Vuelve a probar.");
    e.status = res.status;
    throw e;
  }
  return json.data;
}
