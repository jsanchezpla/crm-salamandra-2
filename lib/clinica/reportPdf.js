import PDFDocument from "pdfkit";
import { registerPoppins } from "../pdf/fonts.js";
import { imagenLocal } from "../pdf/imagenLocal.js";
import { REPORT_TYPE_LABEL } from "./serialize.js";
import { referralSpecialtyLabelOf } from "./derivaciones.js";
import { esInformeBeca, denominacionesBeca } from "./beca.js";
import { specialtyLabels } from "./specialties.js";
import { paletaDeInforme } from "./marcaInforme.js";
import { datosDelCentro, lineaDeSede } from "../tenant/datosCentro.js";
import { apartadosDelInforme, llevaIndice } from "./apartadosInforme.js";
import { bloqueDeFirma } from "./firmaProfesional.js";

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

const MARGEN = { top: 70, bottom: 84, left: 86, right: 62 };

/**
 * Cómo se NOMBRA el documento en su portada.
 *
 * No vale `REPORT_TYPE_LABEL`, que es la etiqueta de la lista de informes y
 * está escrita para caber en un chip: en la pantalla «Evolutivo» se entiende
 * perfectamente porque está en una columna que se llama «Tipo», pero solo, en
 * letra de 30 puntos y en la portada de un documento que la familia lleva al
 * colegio, «Evolutivo» no es el nombre de nada.
 *
 * Un tipo que no esté aquí cae a «Informe», que siempre es cierto.
 */
const TITULO_DE_PORTADA = {
  evolution: "Informe de evolución",
  admission: "Informe de entrevista inicial",
  discharge: "Informe de alta",
  referral: "Informe de derivación",
  beca: "Informe para beca",
};

const texto = (v) => (v == null ? "" : String(v).trim());

function fmtFecha(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
}

/**
 * La edad EN LA FECHA DEL INFORME, no la de hoy: el documento se puede abrir
 * dos años después y tiene que seguir diciendo la edad que tenía entonces.
 */
export function edadEnLaFecha(nacimiento, fechaInforme) {
  if (!nacimiento) return "";
  const nac = new Date(nacimiento);
  const ref = fechaInforme ? new Date(fechaInforme) : new Date();
  if (Number.isNaN(nac.getTime()) || Number.isNaN(ref.getTime()) || ref < nac) return "";
  let meses = (ref.getFullYear() - nac.getFullYear()) * 12 + (ref.getMonth() - nac.getMonth());
  if (ref.getDate() < nac.getDate()) meses -= 1;
  if (meses < 0) return "";
  const anios = Math.floor(meses / 12);
  const resto = meses % 12;
  if (anios === 0) return `${resto} ${resto === 1 ? "mes" : "meses"}`;
  const a = `${anios} ${anios === 1 ? "año" : "años"}`;
  return resto ? `${a} y ${resto} ${resto === 1 ? "mes" : "meses"}` : a;
}

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

// ── Utillería de dibujo ─────────────────────────────────────────────────────

const util = (doc) => doc.page.width - doc.page.margins.left - doc.page.margins.right;

function filete(doc, y, color, grosor = 0.75, desde = null, hasta = null) {
  const x1 = desde ?? doc.page.margins.left;
  const x2 = hasta ?? doc.page.width - doc.page.margins.right;
  doc.save().moveTo(x1, y).lineTo(x2, y).lineWidth(grosor).strokeColor(color).stroke().restore();
}

/** Versalitas espaciadas de titular. */
function espaciado(doc, t, x, y, opciones = {}) {
  doc.text(t, x, y, { characterSpacing: 1.2, ...opciones });
}

/** ¿Cabe un bloque de `alto` en lo que queda de página? Si no, salta. */
function asegurarHueco(doc, alto) {
  if (doc.y + alto > doc.page.height - doc.page.margins.bottom - 40) doc.addPage();
}

// ── Portada ─────────────────────────────────────────────────────────────────

/**
 * Ocupa la primera página ENTERA (28/08/2026, Jorge: «que la portada ocupe la
 * primera página entera y que no haya el padding por los cuatro lados»). El
 * fondo y las manchas de color llegan al borde del papel; el TEXTO conserva su
 * margen, porque ninguna impresora imprime hasta el filo y un título pegado al
 * corte no se lee.
 */
function portada(doc, F, { centro, marca, cabecera, logo }) {
  const { width: W, height: H } = doc.page;

  doc.save().rect(0, 0, W, H).fill(marca.tinteSuave).restore();
  // Manchas cortadas por el borde: es lo que la lee como página entera y no
  // como una tarjeta flotando. Los centros caen FUERA del papel a propósito.
  doc.save();
  doc.circle(W + 40, 40, 215).fill(marca.tinte);
  doc.circle(-40, H + 30, 235).fill(marca.calido);
  doc.circle(W - 60, H - 40, 90).fill(marca.tinte);
  doc.restore();

  const m = 76; // margen del TEXTO, no del fondo
  const ancho = W - m * 2;

  // El logo, o el nombre del centro en su hueco. Nunca las dos cosas, y nunca
  // ninguna: la portada no puede empezar en blanco.
  let logoPintado = false;
  if (logo) {
    try {
      const anchoLogo = 190;
      doc.image(logo, (W - anchoLogo) / 2, 96, { width: anchoLogo });
      logoPintado = true;
    } catch {
      // PNG con cabecera buena y cuerpo corrupto: se sigue sin logo.
      logoPintado = false;
    }
  }
  // Sin logo Y sin nombre no se pinta nada en ese hueco: es preferible una
  // portada que empieza por el título del documento a una que empieza por una
  // línea en blanco donde debería ir quién lo firma.
  if (!logoPintado && centro.nombre) {
    doc.font(F.bold).fontSize(19).fillColor(marca.oscuro);
    doc.text(centro.nombre, m, 132, { width: ancho, align: "center" });
  }

  if (centro.especialidades?.length) {
    doc.font(F.regular).fontSize(6.8).fillColor(marca.suave);
    espaciado(doc, centro.especialidades.join("  ·  ").toUpperCase(), m, 186, { width: ancho, align: "center" });
  }

  filete(doc, 224, marca.tinte, 1, W / 2 - 40, W / 2 + 40);

  doc.font(F.bold).fontSize(30).fillColor(marca.oscuro);
  doc.text(cabecera.tipo, m, 282, { width: ancho, align: "center" });

  if (cabecera.servicio) {
    doc.font(F.regular).fontSize(14.5).fillColor(marca.principal);
    doc.text(cabecera.servicio, m, doc.y + 8, { width: ancho, align: "center" });
  }

  /*
   * La pastilla dice el PERIODO de las sesiones en las que se basa el informe.
   * En la maqueta ponía «Curso 2025 – 2026», que se inventó para el ejemplo: el
   * CRM no tiene ningún concepto de curso escolar, y derivarlo de la fecha
   * sería adivinar (un informe de nutrición no va por cursos). El periodo sí es
   * un dato real, y es el mismo que ya salía en la ficha del informe viejo.
   */
  if (cabecera.periodo) {
    doc.font(F.medium).fontSize(9);
    const anchoPastilla = Math.min(ancho, doc.widthOfString(cabecera.periodo) + 32);
    const yPastilla = doc.y + 16;
    doc.save().roundedRect((W - anchoPastilla) / 2, yPastilla, anchoPastilla, 23, 11.5).fill(marca.blanco).restore();
    doc.fillColor(marca.principal).text(cabecera.periodo, (W - anchoPastilla) / 2, yPastilla + 7, {
      width: anchoPastilla,
      align: "center",
    });
  }

  doc.font(F.medium).fontSize(8).fillColor(marca.principalMedio);
  espaciado(doc, "PACIENTE", m, 494, { width: ancho, align: "center" });
  doc.font(F.bold).fontSize(22).fillColor(marca.tinta);
  doc.text(cabecera.paciente, m, 510, { width: ancho, align: "center" });
  if (cabecera.edadYNacimiento) {
    doc.font(F.regular).fontSize(9.5).fillColor(marca.suave);
    doc.text(cabecera.edadYNacimiento, m, doc.y + 6, { width: ancho, align: "center" });
  }

  filete(doc, 648, marca.tinte, 1, m + 60, W - m - 60);

  if (cabecera.firma.nombre) {
    doc.font(F.medium).fontSize(8).fillColor(marca.principalMedio);
    espaciado(doc, "PROFESIONAL RESPONSABLE", m, 670, { width: ancho, align: "center" });
    doc.font(F.bold).fontSize(12).fillColor(marca.oscuro);
    doc.text(cabecera.firma.nombre, m, doc.y + 3, { width: ancho, align: "center" });
    if (cabecera.firma.acreditacion) {
      doc.font(F.regular).fontSize(9).fillColor(marca.suave);
      doc.text(cabecera.firma.acreditacion, m, doc.y + 2, { width: ancho, align: "center" });
    }
  }

  const pie = [centro.nombre, cabecera.ciudad, cabecera.fechaTexto].filter(Boolean).join(" · ");
  if (pie) {
    doc.font(F.regular).fontSize(9).fillColor(marca.suave);
    doc.text(pie, m, doc.y + 10, { width: ancho, align: "center" });
  }
}

// ── Índice (se escribe al final, sobre la página 2 que se dejó reservada) ────

function indice(doc, F, { entradas, marca, aviso }) {
  doc.switchToPage(1);
  const x = doc.page.margins.left;
  const der = doc.page.width - doc.page.margins.right;
  const ancho = der - x;

  doc.font(F.bold).fontSize(20).fillColor(marca.oscuro);
  doc.text("Índice", x, 96, { width: ancho });
  doc.moveDown(0.3);
  filete(doc, doc.y, marca.acento, 1.5, x, x + 60);

  let y = doc.y + 26;
  doc.font(F.regular).fontSize(10.5);
  for (const e of entradas) {
    const etiqueta = `${e.n}.  ${e.label}`;
    const numero = String(e.pagina);
    doc.fillColor(marca.tinta).font(F.medium);
    doc.text(etiqueta, x, y, { width: ancho - 40, lineBreak: false });
    const anchoEtiqueta = doc.widthOfString(etiqueta);
    doc.font(F.regular).fillColor(marca.suave);
    const anchoNumero = doc.widthOfString(numero);
    // Puntos guía entre el rótulo y el número, como en un índice de memoria.
    const desde = x + anchoEtiqueta + 6;
    const hasta = der - anchoNumero - 6;
    if (hasta > desde) {
      doc.save().dash(1, { space: 3 });
      doc.moveTo(desde, y + 8).lineTo(hasta, y + 8).lineWidth(0.6).strokeColor(marca.filete).stroke();
      doc.undash().restore();
    }
    doc.fillColor(marca.oscuro).font(F.medium);
    doc.text(numero, der - anchoNumero, y, { lineBreak: false });
    y += 26;
  }

  if (aviso) {
    doc.font(F.italic).fontSize(8.2).fillColor(marca.suave);
    doc.text(aviso, x, y + 24, { width: ancho, align: "justify", lineGap: 1.4 });
  }
}

// ── Cuerpo ──────────────────────────────────────────────────────────────────

function apartado(doc, F, ap, marca) {
  asegurarHueco(doc, 100);
  const x = doc.page.margins.left;
  const y = doc.y;

  // El número grande, al margen izquierdo. Por eso ese margen es más ancho que
  // el derecho: le deja sitio.
  doc.save();
  doc.font(F.bold).fontSize(26).fillColor(marca.tinteFuerte);
  doc.text(String(ap.n), x - 44, y - 6, { width: 36, align: "right" });
  doc.restore();

  doc.font(F.bold).fontSize(13).fillColor(marca.oscuro);
  doc.text(ap.label, x, y, { width: util(doc) });
  doc.moveDown(0.28);
  filete(doc, doc.y, marca.acento, 1.2, x, x + 42);
  doc.moveDown(0.7);
  doc.x = x;

  if (ap.lista) {
    for (const t of ap.parrafos) {
      const yv = doc.y;
      // La viñeta se pinta aparte y el texto en una caja más estrecha, para que
      // la segunda línea sangre bajo la primera y no bajo la raya.
      doc.font(F.regular).fontSize(10.2).fillColor(marca.principal);
      doc.text("—", x, yv, { width: 12, lineBreak: false });
      doc.fillColor(marca.tinta);
      doc.text(t, x + 16, yv, { width: util(doc) - 16, align: "justify", lineGap: 2.2 });
      doc.moveDown(0.3);
      doc.x = x;
    }
  } else {
    doc.font(F.regular).fontSize(10.2).fillColor(marca.tinta);
    doc.text(ap.parrafos.join("\n\n"), x, doc.y, {
      width: util(doc),
      align: "justify",
      lineGap: 2.6,
      paragraphGap: 8,
    });
  }
  doc.moveDown(1.1);
  doc.x = x;
}

/**
 * Firma, con hueco de verdad para firmar a mano: estos informes se firman en
 * papel. El nombre va siempre; la acreditación (titulación y nº de colegiada)
 * solo si la hay — hoy no la tiene nadie en producción.
 */
function bloqueFirma(doc, F, { firma, ciudadFecha, marca }) {
  if (!firma.nombre) return;
  asegurarHueco(doc, 150);
  doc.moveDown(1.6);
  if (ciudadFecha) {
    doc.font(F.italic).fontSize(9.5).fillColor(marca.suave);
    doc.text(ciudadFecha, { align: "right" });
  }
  doc.moveDown(3.4);

  const der = doc.page.width - doc.page.margins.right;
  const anchoRaya = 210;
  filete(doc, doc.y, marca.tinta, 0.75, der - anchoRaya, der);
  doc.moveDown(0.45);

  doc.font(F.bold).fontSize(10.5).fillColor(marca.oscuro);
  doc.text(`Fdo.: ${firma.nombre}`, { align: "right" });
  if (firma.acreditacion) {
    doc.font(F.regular).fontSize(9).fillColor(marca.suave);
    doc.text(firma.acreditacion, { align: "right" });
  }
}

/**
 * El cierre del documento: la hoja de protección de datos, si el centro la
 * tiene escrita, y el isotipo como sello final.
 *
 * ⚠️ EL ISOTIPO NO ABRE PÁGINA POR SÍ SOLO (28/08/2026). La primera versión sí,
 * y se vio en el primer informe generado con la marca real de Aumenta: como
 * todavía no tienen escrito el aviso legal, el documento acababa en una hoja
 * vacía con un dibujo pequeño abajo. Parece un fallo de impresión, no un sello.
 *
 * Así que la página nueva la abre el TEXTO. Sin texto, el isotipo cierra la
 * última página que ya hubiera; y si en esa página el contenido llega hasta
 * abajo, no se pinta: mejor sin sello que un sello encima de un párrafo.
 */
function cierreDelDocumento(doc, F, { centro, marca, isotipo }) {
  const hayTexto = Boolean(centro.proteccionDatos);
  if (!hayTexto && !isotipo) return;

  if (hayTexto) {
    doc.addPage();
    doc.font(F.bold).fontSize(11).fillColor(marca.oscuro);
    doc.text("Protección de datos y confidencialidad");
    doc.moveDown(0.5);
    filete(doc, doc.y, marca.filete, 0.5);
    doc.moveDown(0.8);
    doc.font(F.regular).fontSize(7.6).fillColor(marca.suave);
    doc.text(centro.proteccionDatos, { align: "justify", lineGap: 1.6 });
  }

  if (!isotipo) return;
  const { width: W, height: H } = doc.page;
  const anchoIso = 58;
  // Anclado al PIE y no a `doc.y`: así queda a la misma altura salga el texto
  // legal largo o corto, que es lo que hace que parezca puesto a propósito y no
  // arrastrado por el párrafo de encima.
  const y = H - doc.page.margins.bottom - anchoIso - 26;
  if (!hayTexto && doc.y > y - 12) return;
  try {
    doc.image(isotipo, (W - anchoIso) / 2, y, { width: anchoIso });
  } catch {
    /* isotipo corrupto: el documento acaba igual, solo que sin sello */
  }
}

/**
 * Pie con los datos del centro y el número de página, en todas las páginas
 * menos la portada. Se pinta al final, con `bufferPages`, que es la única
 * forma de recorrer las páginas ya escritas.
 *
 * Rodrigo, 28/08/2026: fuera el cintillo de arriba (citaba los ocho servicios y
 * «es un poco extraño»), y el número de página «solo con el número, no con 3/6
 * … y más en la esquina derecha, donde suele ir».
 */
function pieYNumeros(doc, F, { centro, marca }) {
  const rango = doc.bufferedPageRange();

  for (let i = rango.start; i < rango.start + rango.count; i++) {
    if (i === rango.start) continue; // la portada no lleva pie ni número
    doc.switchToPage(i);

    /*
     * Escribir por debajo del margen inferior haría que pdfkit añadiera una
     * página nueva (y otra, y otra: es un bucle infinito de páginas). Se anulan
     * los márgenes mientras se pinta el pie y se devuelven al salir.
     */
    const margenes = { ...doc.page.margins };
    doc.page.margins.top = 0;
    doc.page.margins.bottom = 0;

    // El pie se centra en la PÁGINA, no en la columna de texto: los márgenes
    // izquierdo y derecho no son iguales y centrado en la columna se ve torcido.
    const izq = 50;
    const ancho = doc.page.width - 100;
    const yPie = doc.page.height - 62;

    doc.save();
    filete(doc, yPie - 8, marca.filete, 0.5, izq, izq + ancho);

    if (centro.hayPie) {
      const identidad = [centro.razonSocial || centro.nombre, centro.cif ? `CIF: ${centro.cif}` : ""]
        .filter(Boolean)
        .join(" — ");
      doc.font(F.medium).fontSize(6.6).fillColor(marca.suave);
      doc.text(identidad, izq, yPie, { width: ancho, align: "center" });
      doc.font(F.regular).fontSize(6.2).fillColor(marca.suave);
      for (const sede of centro.sedes) {
        const linea = lineaDeSede(sede);
        if (linea) doc.text(linea, izq, doc.y, { width: ancho, align: "center" });
      }
      if (centro.telefonos.length) {
        doc.text(centro.telefonos.join("  ·  "), izq, doc.y + 1, { width: ancho, align: "center" });
      }
    } else {
      // Sin datos del centro no hay bloque, pero el número tiene que caer donde
      // caería igualmente: se coloca la pluma a mano.
      doc.y = yPie;
    }

    doc.font(F.medium).fontSize(8).fillColor(marca.suave);
    doc.text(String(i - rango.start + 1), izq, doc.y + 4, { width: ancho, align: "right" });
    doc.restore();

    doc.page.margins.top = margenes.top;
    doc.page.margins.bottom = margenes.bottom;
  }
  doc.flushPages();
}

/**
 * Anexo con los registros de sesión LITERALES (26/08/2026, Rodrigo). Opcional
 * —lo enciende la casilla del cajón, `contentSections.anexarRegistros`— y en
 * página aparte, para que quede claro que el informe es la redacción de la
 * profesional y esto es el material en bruto. NO lleva la preparación
 * (`prepText`): es material interno del equipo, y este PDF lo recibe la familia.
 */
function anexoRegistros(doc, F, sesiones, marca) {
  doc.addPage();
  doc.font(F.bold).fontSize(16).fillColor(marca.oscuro).text("Anexo · Registros de sesión");
  doc.moveDown(0.3);
  doc
    .font(F.regular)
    .fontSize(9)
    .fillColor(marca.suave)
    .text("Registros literales de las sesiones en las que se basa el informe, tal y como se escribieron.");
  doc.moveDown(1);

  const OBS = [
    ["familyComments", "Comentarios familiares"],
    ["nextSessionNotes", "Próximas sesiones"],
    ["homeworkTasks", "Tareas para casa"],
    ["incidents", "Incidencias"],
  ];
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

    bloque("Objetivos trabajados", s.objectives, true);
    bloque("Actividades realizadas", s.activities, false);
    bloque("Desempeño", s.performance, false);
    const obs = s.observations && typeof s.observations === "object" ? s.observations : {};
    for (const [k, label] of OBS) bloque(label, obs[k], false);
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
  const tipoLabel = TITULO_DE_PORTADA[report.reportType] ?? REPORT_TYPE_LABEL[report.reportType] ?? "Informe";

  const marca = paletaDeInforme(brand);
  const centro = datosDelCentro(tenant, { nombrePorDefecto: tenantName });
  const apartados = apartadosDelInforme(report);
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
      const doc = new PDFDocument({ size: "A4", margins: MARGEN, bufferPages: true, autoFirstPage: true });
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
        apartado(doc, F, ap, marca);
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
      if (anexar) anexoRegistros(doc, F, sourceSessions, marca);

      cierreDelDocumento(doc, F, { centro, marca, isotipo });

      if (conIndice) indice(doc, F, { entradas, marca, aviso: AVISO_INDICE });
      pieYNumeros(doc, F, { centro, marca });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
