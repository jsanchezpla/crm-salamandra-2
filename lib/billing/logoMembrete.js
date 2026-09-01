/**
 * logoMembrete — traer el logo del membrete para pintarlo en un PDF
 * (31/08/2026).
 *
 * pdfkit necesita los BYTES de la imagen; la configuración guarda una URL.
 * Este es el único sitio que hace esa red, con las tres vallas de rigor, y
 * cualquier fallo devuelve null: el documento sale SIN logo antes que no salir
 * (la misma regla que el membrete de los informes clínicos: todo es opcional).
 *
 *   - https solo (una URL http o un data: raro no viaja);
 *   - 3 segundos de tope: la descarga de una factura no espera a un CDN caído;
 *   - 2 MB de tope y solo PNG/JPEG, que es lo que pdfkit sabe dibujar.
 */
const TOPE_BYTES = 2 * 1024 * 1024;

export async function cargarLogo(url) {
  if (!url || typeof url !== "string" || !/^https:\/\//i.test(url.trim())) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch(url.trim(), { signal: ctrl.signal, redirect: "follow" });
    clearTimeout(timer);
    if (!r.ok) return null;
    const tipo = (r.headers.get("content-type") || "").toLowerCase();
    if (!/image\/(png|jpe?g)/.test(tipo)) return null;
    const bytes = Buffer.from(await r.arrayBuffer());
    if (!bytes.length || bytes.length > TOPE_BYTES) return null;
    return bytes;
  } catch {
    return null;
  }
}
