import fs from "node:fs";
import path from "node:path";

/**
 * Poppins para los PDF generados con pdfkit.
 *
 * pdfkit solo trae las 14 fuentes base de PostScript (Helvetica, Times,
 * Courier). Para que los documentos que salen del CRM usen la MISMA tipografía
 * que la interfaz hay que embeber los ficheros: se guardan en esta carpeta
 * (`lib/pdf/fonts/`) porque el Dockerfile de producción copia `lib/` entera.
 *
 * Los cuatro pesos se leen de disco UNA vez por proceso y se reutilizan: cada
 * PDF los registra en su propio PDFDocument (pdfkit no comparte fuentes entre
 * documentos), pero no vuelve a tocar el disco.
 *
 * Si por lo que sea los ficheros no están (build incompleto, imagen antigua),
 * `registerPoppins` devuelve los nombres de Helvetica en vez de reventar: un
 * PDF con la fuente equivocada es un problema estético, uno que no se genera
 * es un paciente sin su menú.
 *
 * Poppins es de Indian Type Foundry, con licencia SIL Open Font License 1.1
 * (copia íntegra en `OFL.txt`), que permite embeberla en documentos.
 */

const FONT_DIR = path.join(process.cwd(), "lib", "pdf", "fonts");

const FILES = {
  regular: "Poppins-Regular.ttf",
  medium: "Poppins-Medium.ttf",
  bold: "Poppins-SemiBold.ttf", // SemiBold, no Bold: el Bold de Poppins pesa
  italic: "Poppins-Italic.ttf", // demasiado en cuerpos pequeños de documento
};

const HELVETICA = {
  regular: "Helvetica",
  medium: "Helvetica",
  bold: "Helvetica-Bold",
  italic: "Helvetica-Oblique",
};

// undefined = aún no se ha intentado leer; null = no están disponibles.
let buffers;

function loadBuffers() {
  if (buffers !== undefined) return buffers;
  try {
    const loaded = {};
    for (const [key, file] of Object.entries(FILES)) {
      loaded[key] = fs.readFileSync(path.join(FONT_DIR, file));
    }
    buffers = loaded;
  } catch {
    buffers = null;
  }
  return buffers;
}

/**
 * Registra Poppins en el documento y devuelve el mapa de nombres a usar en
 * `doc.font(...)`: { regular, medium, bold, italic }.
 */
export function registerPoppins(doc) {
  const loaded = loadBuffers();
  if (!loaded) return { ...HELVETICA, embedded: false };

  const names = { embedded: true };
  for (const [key, buffer] of Object.entries(loaded)) {
    const name = `Poppins-${key}`;
    try {
      doc.registerFont(name, buffer);
      names[key] = name;
    } catch {
      names[key] = HELVETICA[key]; // un peso corrupto no tumba los otros tres
    }
  }
  return names;
}
