/**
 * lib/utils/errorInterno.js — qué se escribe y qué se enseña cuando una ruta
 * revienta (09/09/2026, AV-0101).
 *
 * ── DE QUÉ AVISO NACE ───────────────────────────────────────────────────────
 * Olga (Aumenta, 09/09/2026): «No funciona el apartado de cobros, aparece como
 * error interno». **No se pudo contestar.** El `serverError` de
 * `apiResponse.js` no escribía en ninguna parte: ni en el log del contenedor,
 * ni en un fichero, ni en la respuesta. Lo usan las ~285 rutas del CRM, así que
 * durante meses cualquier fallo de servidor fue igual de invisible: la pantalla
 * decía «Error interno del servidor» y no quedaba una sola línea que buscar.
 *
 * (Fichero propio en /lib, regla #2: aquí vive la parte que se puede probar.
 * `apiResponse.js` importa `next/server`, que no se resuelve desde una prueba
 * suelta de Node, y sin poder probarlo esto se vuelve a romper el día que
 * alguien «simplifique» el mensaje.)
 *
 * ── LAS DOS MITADES, Y LAS DOS HACEN FALTA ──────────────────────────────────
 *   · Lo que se escribe en el log del servidor, con la referencia por delante
 *     para poder buscarla: `docker logs crm-salamandra-app-1 | grep K2P9XA3F`.
 *   · Lo que ve la persona, con esa MISMA referencia dentro, para que la copie
 *     en el aviso. Es lo que convierte un «no funciona» en algo investigable.
 *
 * ── LO QUE NO SE ESCRIBE, A PROPÓSITO ───────────────────────────────────────
 * La consulta SQL de un error de Sequelize NO se registra: lleva los VALORES
 * dentro —un correo, un DNI, el nombre de un menor— y el log del servidor lo
 * lee cualquiera que entre. Del error de base se guarda el código de
 * PostgreSQL, la tabla, la columna y la restricción: dice qué pasó sin decir a
 * quién.
 *
 * ⚠️ El log del contenedor MUERE en cada despliegue (`docker compose up
 * --build` lo recrea). Para investigar algo de hace horas hay que bajarlo antes
 * de desplegar. Fue exactamente lo que pasó con AV-0101.
 *
 * Puro: sin `next/server`, sin base y sin nada del CRM.
 * Prueba en `scripts/_smoke-error-500.mjs`.
 */

/**
 * Una referencia corta y legible en voz alta. No es única en el mundo: solo
 * tiene que bastar para encontrar la línea en el log del día.
 */
export function referenciaDeError(ahora = Date.now(), azar = Math.random()) {
  const cuando = Number(ahora).toString(36).slice(-5);
  const cola = Number(azar).toString(36).slice(2, 5).padEnd(3, "0");
  return `${cuando}${cola}`.toUpperCase();
}

/** El detalle de un error de base de datos: dónde duele, nunca con qué valores. */
function dondeDuele(err) {
  const dato = err?.parent ?? err?.original ?? null;
  if (!dato) return "";
  const partes = [
    `pg=${dato.code ?? "?"}`,
    dato.table ? `tabla=${dato.table}` : null,
    dato.column ? `columna=${dato.column}` : null,
    dato.constraint ? `restriccion=${dato.constraint}` : null,
  ].filter(Boolean);
  return ` · ${partes.join(" ")}`;
}

/** La línea que va al log del servidor. */
export function lineaDeLog(err, ref) {
  const nombre = err?.name ?? (err ? typeof err : "Error");
  const mensaje = err?.message ?? (typeof err === "string" ? err : "sin mensaje");
  const traza = err?.stack ? `\n${err.stack}` : "";
  return `[500 ${ref}] ${nombre}: ${mensaje}${dondeDuele(err)}${traza}`;
}

/**
 * El mensaje que ve la persona. En producción no se le enseña lo de dentro
 * —una traza o un nombre de tabla no le sirven y sí le preocupan—, pero la
 * referencia sale siempre: es lo único que hace falta para investigarlo.
 */
export function mensajeDeError(err, ref, { produccion = process.env.NODE_ENV === "production" } = {}) {
  const dentro = err?.message || (typeof err === "string" ? err : "") || "Error desconocido";
  return produccion ? `Error interno del servidor (ref. ${ref})` : `${dentro} (ref. ${ref})`;
}
