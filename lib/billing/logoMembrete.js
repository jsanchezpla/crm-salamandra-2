import { esRefDeMarca, leerImagenDeMarca } from "./marcaImagen.js";

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

/*
 * ── Y LA IMAGEN SUBIDA DESDE EL ORDENADOR (07/09/2026, AV-0069) ─────────────
 *
 * Desde hoy el logo y el sello se pueden SUBIR, y entonces lo que hay en los
 * ajustes no es una URL sino una referencia nuestra (`/marca/<slug>/<uuid>.png`).
 * Esa rama va AQUÍ DENTRO y no en quien llama: hay siete llamadas a esta
 * función repartidas por seis endpoints (descarga, ZIP, envío por correo,
 * vista previa del lote, justificante y los dos de presupuestos), y ponerla
 * fuera garantizaba que alguien se olvidaría de una y el sello saldría en la
 * descarga pero no en el correo.
 *
 * Se lee del disco, sin salir a la red y sin tocar la base: quién puede tener
 * esa referencia guardada ya se comprobó al ESCRIBIRLA (`refValidaPara`).
 */
export async function cargarLogo(url) {
  if (esRefDeMarca(url)) return leerImagenDeMarca(url);
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
