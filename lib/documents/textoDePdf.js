/**
 * lib/documents/textoDePdf.js — el texto de un PDF, sin IA y sin servicios de
 * fuera (15/09/2026, AV-0103: el Plan lee el motivo de consulta de los informes).
 *
 * Fichero nuevo en /lib porque es la primera vez que el CRM LEE un PDF (hasta
 * hoy solo los generaba con pdfkit) y no debe quedar enterrado en una ruta.
 * Usa `unpdf`, que trae pdf.js empaquetado para servidor: JavaScript puro, sin
 * binarios que compilar en el contenedor alpine.
 *
 * No hace OCR: un informe ESCANEADO no tiene texto y devuelve "sin texto". Un
 * PDF con contraseña (los «_protected» de Aumenta) devuelve "cifrado". Ninguno
 * de los dos lanza: quien llama cuenta cuántos no se pudieron leer y lo dice.
 */

/** @returns {Promise<{ texto: string|null, problema: null|"cifrado"|"sin texto"|"ilegible" }>} */
export async function textoDePdf(buffer) {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    // verbosity 0: pdf.js avisa por consola de cada fuente rara, y los informes
    // de Word traen muchas.
    const pdf = await getDocumentProxy(new Uint8Array(buffer), { verbosity: 0 });
    try {
      const { text } = await extractText(pdf, { mergePages: true });
      const texto = typeof text === "string" ? text : "";
      return texto.trim().length < 20 ? { texto: null, problema: "sin texto" } : { texto, problema: null };
    } finally {
      await pdf.destroy?.().catch?.(() => {});
    }
  } catch (err) {
    if (err?.name === "PasswordException") return { texto: null, problema: "cifrado" };
    return { texto: null, problema: "ilegible" };
  }
}
