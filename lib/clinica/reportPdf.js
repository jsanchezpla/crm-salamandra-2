import PDFDocument from "pdfkit";
import { registerPoppins } from "../pdf/fonts.js";
import { imagenLocal } from "../pdf/imagenLocal.js";
import { REPORT_TYPE_LABEL, nombreDelInforme } from "./serialize.js";
import { referralSpecialtyLabelOf } from "./derivaciones.js";
import { esInformeBeca, denominacionesBeca } from "./beca.js";
import { specialtyLabels } from "./specialties.js";
import { paletaDeInforme } from "./marcaInforme.js";
import { datosDelCentro } from "../tenant/datosCentro.js";
import { apartadosDelInforme, llevaIndice } from "./apartadosInforme.js";
import { apartadosPara, valoresDeSesion } from "./plantillas.js";
import { bloqueDeFirma } from "./firmaProfesional.js";
import {
  MARGEN_DOCUMENTO,
  texto,
  fmtFecha,
  edadEnLaFecha,
  avisoDeProteccion,
  util,
  filete,
  asegurarHueco,
  portada,
  indice,
  apartadoNumerado,
  bloqueFirma,
  cierreDelDocumento,
  pieYNumeros,
} from "./documentoPdf.js";

/**
 * PDF del informe clínico — el documento que recibe la familia.
 *
 * ── QUÉ CAMBIÓ EL 28/08/2026 Y POR QUÉ ─────────────────────────────────────
 * Hasta hoy esto era una hoja sencilla, y estaba escrito en su cabecera que se
 * hizo así a propósito: «lo abre una familia en el móvil, no se archiva en un
 * expediente en papel». Esa decisión se ha dado la vuelta, y con motivo.
 *
 * Aumenta —la reina del módulo clínico— enseñó los informes que mandan de
 * verdad: documentos formales, con membrete, nº de colegiada, las sedes con su
 * nº de Registro Sanitario y pie de protección de datos, que la familia
 * presenta en el colegio o adjunta a la beca del Ministerio. El PDF del CRM no
 * lo había generado nadie en un mes de uso real: en producción había CERO
 * informes clínicos en un schema con 22.045 sesiones y 1.174 pacientes. La
 * conclusión no fue que el diseño estuviera feo, sino que no servía para
 * aquello para lo que lo iban a usar.
 *
 * Rodrigo y Jorge dieron por bueno este formato: portada a sangre, índice en la
 * página 2, apartados numerados, número de página solo con el número y en la
 * esquina derecha, sin cintillo en las páginas de texto, y el isotipo del
 * centro cerrando la última hoja.
 *
 * ── DÓNDE ESTÁ EL DIBUJO (03/09/2026) ──────────────────────────────────────
 * Las piezas —portada, índice, apartado numerado, firma, cierre, pie— viven en
 * `documentoPdf.js` desde que el registro de sesión (`sessionPdf.js`) lleva la
 * misma portada y el mismo cuerpo. Aquí queda lo que es DEL INFORME: cómo se
 * nombra, el periodo de las sesiones base, el índice con su párrafo, la
 * especialidad de destino de una derivación y el anexo literal.
 *
 * ── LO QUE NO SE PUEDE OLVIDAR AL TOCAR ESTO ───────────────────────────────
 * 1. TODO ES OPCIONAL. En producción, hoy, no hay logo, ni CIF, ni sedes, ni
 *    nº de colegiada: son campos recién creados y nadie los ha rellenado. Cada
 *    bloque comprueba si tiene algo y, si no, no se pinta — nada de «CIF:
 *    undefined» ni de rayas con nada debajo. Un informe SIEMPRE se genera.
 * 2. El dibujo es SÍNCRONO. Los buffers de las imágenes se cargan ANTES de
 *    abrir el documento (patrón de `lib/nutricion/menuPdf.js`): un `await`
 *    dentro del render no se espera.
 * 3. El índice y el cuerpo salen de la MISMA lista (`apartadosInforme.js`). Si
 *    se numeran por separado, se desincronizan en cuanto un apartado se quede
 *    vacío.
 * 4. Los colores salen de la marca del cliente (`marcaInforme.js`), no escritos
 *    aquí: este generador es del módulo base y lo usan las cuatro demos.
 * 5. La BECA no lleva índice y solo imprime sus tres apartados: la convocatoria
 *    pide lo que pide (`lib/clinica/beca.js`).
 */

// Se re-exportan desde aquí porque nacieron aquí y hay pruebas y rutas que las
// importan de este fichero; la definición vive en `documentoPdf.js`.
export { edadEnLaFecha, avisoDeProteccion };

/**
 * Cómo se NOMBRA el documento en su portada: `nombreDelInforme`, en
 * `serialize.js`. Nació aquí y se mudó allí el 04/09/2026 (con el informe de
 * asesoramiento) porque las dos cabeceras de la pantalla necesitaban la misma
 * lista y no pueden importar este fichero: arrastraría pdfkit al navegador.
 * El porqué de que no valga `REPORT_TYPE_LABEL`, en su comentario.
 */

/**
 * Periodo y fechas de las sesiones en las que se basa el informe (26/08/2026,
 * Rodrigo: «el único contenido de las sesiones que debería salir es la fecha»).
 * El cuerpo del informe es la redacción de la profesional; de las sesiones, el
 * documento dice CUÁNDO fueron. Lo literal solo viaja si se pide el anexo.
 */
export function fechasDeSesiones(sesiones) {
  const fechas = (Array.isArray(sesiones) ? sesiones : [])
    .map((s) => s?.sessionDate)
    .filter(Boolean)
    .map((d) => new Date(d))
    .filter((d) => !Number.isNaN(d.getTime()))
    .sort((a, b) => a - b);
  if (!fechas.length) return null;
  const n = fechas.length;
  const listaFechas = fechas.map((d) => fmtFecha(d));
  const periodo = n === 1 ? listaFechas[0] : `del ${listaFechas[0]} al ${listaFechas[n - 1]}`;
  return {
    periodo,
    basadoEn: `${n} ${n === 1 ? "sesión" : "sesiones"} · ${listaFechas.join(" · ")}`,
  };
}

/** Nombre de fichero legible: es lo que verá la familia en su portal. */
export function reportPdfFilename(report, patientName) {
  const tipo = REPORT_TYPE_LABEL[report.reportType] ?? "Informe";
  const quien = texto(patientName).replace(/[\\/:*?"<>|]/g, "").trim();
  const fecha = report.reportDate ? String(report.reportDate).slice(0, 10) : "";
  return [tipo, quien, fecha].filter(Boolean).join(" - ") + ".pdf";
}

/**
 * Anexo con los registros de sesión LITERALES (26/08/2026, Rodrigo). Opcional
 * —lo enciende la casilla del cajón, `contentSections.anexarRegistros`— y en
 * página aparte, para que quede claro que el informe es la redacción de la
 * profesional y esto es el material en bruto. NO lleva la preparación
 * (`prepText`): es material interno del equipo, y este PDF lo recibe la familia.
 *
 * Desde el 29/08/2026 cada sesión se imprime con SUS apartados —los de la
 * plantilla de registro con la que se escribió— y no con una lista fija: si el
 * centro añadió «Clima de la sesión» a sus registros, aquí sale «Clima de la
 * sesión». Lo interno sigue fuera y no por esta lista, sino porque
 * `sesionesDelInforme.js` ni lo carga: una plantilla no puede sacar del cajón un
 * dato que nadie ha leído de la base de datos.
 */
function anexoRegistros(doc, F, sesiones, marca, tenant) {
  doc.addPage();
  doc.font(F.bold).fontSize(16).fillColor(marca.oscuro).text("Anexo · Registros de sesión");
  doc.moveDown(0.3);
  doc
    .font(F.regular)
    .fontSize(9)
    .fillColor(marca.suave)
    .text("Registros literales de las sesiones en las que se basa el informe, tal y como se escribieron.");
  doc.moveDown(1);

  const comoLista = (v) => (Array.isArray(v) ? v.map(texto).filter(Boolean) : texto(v) ? [texto(v)] : []);

  sesiones.forEach((s, i) => {
    if (i > 0) {
      doc.moveDown(0.6);
      filete(doc, doc.y, marca.filete, 0.5);
      doc.moveDown(0.8);
    }
    doc.font(F.bold).fontSize(12).fillColor(marca.oscuro).text(`Sesión del ${fmtFecha(s.sessionDate)}`);
    doc.moveDown(0.4);

    const bloque = (label, contenido, esLista) => {
      const c = esLista ? comoLista(contenido) : texto(contenido) ? [texto(contenido)] : [];
      if (!c.length) return;
      doc.font(F.medium).fontSize(9).fillColor(marca.suave).text(label.toUpperCase());
      doc.font(F.regular).fontSize(10.5).fillColor(marca.tinta);
      if (esLista) c.forEach((p) => doc.text(`•  ${p}`, { lineGap: 1.5, indent: 4 }));
      else doc.text(c.join("\n\n"), { lineGap: 1.5 });
      doc.moveDown(0.45);
    };

    const valores = valoresDeSesion(s);
    for (const ap of apartadosPara(s.contentSections, tenant, "registro")) {
      bloque(ap.label, valores[ap.key], ap.tipo === "lista");
    }
    // La devolución de la familia es la parte 3 del registro, no un apartado de
    // plantilla: va siempre al final y con su rótulo de siempre.
    bloque("Devolución de la familia", s.parentFeedback, false);
  });
}

// ── El generador ────────────────────────────────────────────────────────────

/**
 * El párrafo bajo el índice. Es el que llevan los informes que Aumenta manda
 * hoy, palabra por palabra: explica de dónde sale el informe y que hay una
 * versión más extensa a petición. Va aquí y no en `settings` porque no es un
 * dato del centro: es lo que significa un informe clínico.
 */
const AVISO_INDICE =
  "El presente informe se ha realizado en base a una evaluación del caso, cuya metodología " +
  "se ha basado en la entrevista clínica semiestructurada, la observación comportamental y/o " +
  "la aplicación de pruebas psicométricas que conforman una versión más extensa del informe " +
  "clínico y que pueden ser consultadas tras la petición expresa de las mismas.";

/**
 * Devuelve el Buffer del PDF.
 *
 * @param report            fila de ClinicalReport (o su JSON)
 * @param patientName       nombre del paciente, ya compuesto
 * @param patientBirthDate  para la edad de la portada (opcional)
 * @param therapistName     quien firma (opcional)
 * @param therapistPosition su puesto en el centro (opcional)
 * @param therapistQualification  su titulación (opcional)
 * @param therapistCollegiate     su nº de colegiada (opcional)
 * @param tenantName        nombre del cliente, respaldo del nombre del centro
 * @param brand             `settings.brand`: de ahí sale TODA la paleta y las
 *                          rutas del logo y del isotipo
 * @param tenant            el tenant entero: de ahí salen `settings.centro` y
 *                          el catálogo de especialidades de derivación
 * @param patientSpecialties  claves de especialidad del paciente
 * @param sourceSessions    las sesiones en las que se basa el informe
 */
export async function buildReportPdfBuffer({
  report,
  patientName,
  patientBirthDate = null,
  therapistName,
  therapistPosition = null,
  therapistQualification = null,
  therapistCollegiate = null,
  tenantName,
  brand,
  tenant = null,
  patientSpecialties = [],
  sourceSessions = [],
}) {
  const cs = report.contentSections && typeof report.contentSections === "object" ? report.contentSections : {};
  const beca = esInformeBeca(report.reportType);
  const tipoLabel = nombreDelInforme(report.reportType);

  const marca = paletaDeInforme(brand);
  const centro = datosDelCentro(tenant, { nombrePorDefecto: tenantName });
  // Con el tenant: si este informe no trae su propia foto de apartados, se usa
  // la plantilla del CENTRO y no los siete de fábrica (29/08/2026).
  const apartados = apartadosDelInforme(report, tenant);
  const conIndice = llevaIndice(report, apartados);

  // El anexo con los registros literales es OPT-IN (la casilla del cajón), y el
  // informe de beca nunca lo lleva: la convocatoria pide lo que pide.
  const fechas = beca ? null : fechasDeSesiones(sourceSessions);
  const anexar = !beca && cs.anexarRegistros === true && Array.isArray(sourceSessions) && sourceSessions.length > 0;

  /*
   * ⚠️ LAS IMÁGENES, ANTES DE ABRIR EL DOCUMENTO. El render de abajo es
   * síncrono dentro de un `new Promise`: un `await` ahí dentro no se espera y
   * el PDF sale sin la imagen (o a medias). Mismo patrón que
   * `lib/nutricion/menuPdf.js`. `imagenLocal` solo lee de `public/` y NUNCA
   * sale a la red — el porqué está en su cabecera.
   */
  const logo = imagenLocal(brand?.logoUrl);
  const isotipo = imagenLocal(brand?.isotipoUrl);

  /*
   * Qué servicio encabeza la portada. En la beca, la denominación OFICIAL de la
   * convocatoria («Reeducación del lenguaje»), nunca el nombre que usa el
   * centro; en los demás, la especialidad del paciente. Si no hay ninguna, no
   * se pinta la línea — y en producción 480 de los 1.174 pacientes de Aumenta
   * no tienen especialidad puesta.
   */
  const servicios = beca ? denominacionesBeca(patientSpecialties) : specialtyLabels(patientSpecialties);
  /*
   * En la beca, cada denominación oficial va en SU LÍNEA. Juntas con un punto
   * medio se parten solas a mitad de palabra («Reeducación pedagógica y /
   * habilidades sociales»), porque son largas de por sí y en la portada van en
   * cuerpo 14,5. Son los nombres que la convocatoria exige leer enteros.
   */
  const servicio = servicios.length
    ? beca
      ? servicios.join("\n")
      : `Servicio de ${servicios.join(" · ")}`
    : "";

  const firma = bloqueDeFirma({
    nombre: therapistName,
    titulacion: therapistQualification,
    puesto: therapistPosition,
    colegiado: therapistCollegiate,
  });

  const edad = edadEnLaFecha(patientBirthDate, report.reportDate);
  const nacimiento = patientBirthDate ? fmtFecha(patientBirthDate) : "";
  const fechaTexto = fmtFecha(report.reportDate);

  // La ciudad de la sede principal: encabeza la fecha de la firma y cierra la
  // portada. Sin sedes puestas, sencillamente no sale.
  const ciudad = centro.sedes[0]?.ciudad || "";

  const cabecera = {
    tipo: tipoLabel,
    servicio,
    periodo: fechas ? fechas.periodo : "",
    paciente: texto(patientName) || "—",
    edadYNacimiento: [edad, nacimiento].filter(Boolean).join("  ·  "),
    firma,
    fechaTexto,
    ciudad,
  };

  // «En Fuenlabrada, a 30 de junio de 2026». Sin ciudad, solo la fecha.
  const ciudadFecha = fechaTexto ? (ciudad ? `En ${ciudad}, a ${fechaTexto}` : fechaTexto) : "";

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margins: MARGEN_DOCUMENTO, bufferPages: true, autoFirstPage: true });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const F = registerPoppins(doc);

      portada(doc, F, { centro, marca, cabecera, logo });

      if (conIndice) doc.addPage(); // página 2: reservada, se escribe al final
      doc.addPage(); // aquí empieza el cuerpo

      doc.font(F.bold).fontSize(17).fillColor(marca.oscuro).text(tipoLabel);
      // Aquí el servicio va en UNA línea aunque en la portada vaya en varias:
      // esto es un renglón de contexto, no un titular.
      const contexto = [texto(patientName), servicio.replace(/\n/g, " · "), fechaTexto].filter(Boolean).join(" · ");
      if (contexto) {
        doc.font(F.regular).fontSize(10.5).fillColor(marca.principalMedio).text(contexto);
      }
      doc.moveDown(1.2);

      // El «Basado en» —las fechas de las sesiones, una a una— va aquí: en la
      // portada solo cabe el periodo.
      if (fechas) {
        doc.font(F.regular).fontSize(8.4).fillColor(marca.suave);
        doc.text(`Basado en ${fechas.basadoEn}`, { width: util(doc) });
        doc.moveDown(0.9);
      }
      if (cs.referralSpecialty) {
        doc.font(F.medium).fontSize(9).fillColor(marca.principal);
        doc.text(`Especialidad de destino: ${referralSpecialtyLabelOf(tenant, cs.referralSpecialty)}`);
        doc.moveDown(0.9);
      }

      /*
       * Se anota en qué página arranca cada apartado MIENTRAS se dibuja, y el
       * índice se escribe al final sobre la página 2. Es la única forma de que
       * los números del índice sean los de verdad.
       */
      const entradas = [];
      for (const ap of apartados) {
        const antes = doc.bufferedPageRange().count;
        asegurarHueco(doc, 100);
        const despues = doc.bufferedPageRange().count;
        entradas.push({ n: ap.n, label: ap.label, pagina: Math.max(antes, despues) });
        apartadoNumerado(doc, F, ap, marca);
      }

      if (!apartados.length) {
        doc
          .font(F.italic)
          .fontSize(11)
          .fillColor(marca.suave)
          .text("Este informe todavía no tiene contenido redactado.");
      }

      bloqueFirma(doc, F, { firma, ciudadFecha, marca });

      // Los registros literales, solo si se pidieron y en página aparte.
      if (anexar) anexoRegistros(doc, F, sourceSessions, marca, tenant);

      cierreDelDocumento(doc, F, {
        marca,
        isotipo,
        aviso: avisoDeProteccion(centro, { nacimiento: patientBirthDate, fechaInforme: report.reportDate }),
      });

      if (conIndice) indice(doc, F, { entradas, marca, aviso: AVISO_INDICE });
      pieYNumeros(doc, F, { centro, marca });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
