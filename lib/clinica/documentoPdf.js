import { lineaDeSede } from "../tenant/datosCentro.js";

/**
 * lib/clinica/documentoPdf.js — las piezas de dibujo del DOCUMENTO CLÍNICO
 * formal: portada a sangre, índice, apartado numerado, bloque de firma, hoja
 * de cierre y pie con número de página.
 *
 * (Fichero nuevo en /lib, regla #2. No añade ningún diseño: es el que ya tenía
 * `reportPdf.js` desde el 28/08/2026, sacado a un sitio desde el que lo puedan
 * usar DOS generadores.)
 *
 * ── POR QUÉ SE SACA DE `reportPdf.js` (03/09/2026, Rodrigo) ────────────────
 * «Quiero que los registros de sesión de todo tipo —el de talleres, el de la
 * entrevista inicial y los normales— tengan la portada tipo los informes
 * grandes, pero solo de una sesión, y el diseño de dentro también.»
 *
 * Hasta hoy el registro de sesión salía como una hoja de trabajo sin portada,
 * y estaba escrito en `sessionPdf.js` que era a propósito. Esa decisión se ha
 * dado la vuelta: el registro que recibe una familia —y más el de una
 * entrevista inicial, que es el primer documento que ve del centro— tiene que
 * parecer del mismo centro que el informe, y no una versión pobre.
 *
 * La alternativa era copiar las funciones de `reportPdf.js` en `sessionPdf.js`.
 * Con dos copias, el día que Aumenta pida mover el logo dos milímetros lo
 * pedirá para «los PDF» y alguien lo hará en una: el informe y el registro
 * dejarían de parecer del mismo centro, que es justo lo que se está pidiendo
 * ahora. Con una copia, no hay forma de que pase.
 *
 * ── LO QUE HAY QUE SABER PARA USAR ESTAS PIEZAS ────────────────────────────
 * 1. TODO ES OPCIONAL. Cada bloque comprueba si tiene datos y, si no, no se
 *    pinta: sin logo va el nombre del centro, sin CIF no hay línea de CIF, sin
 *    colegiación la firma es solo el nombre. Un documento SIEMPRE se genera.
 * 2. El dibujo es SÍNCRONO. Los buffers de las imágenes (logo, isotipo) se
 *    cargan ANTES de abrir el documento: un `await` dentro del render no se
 *    espera (patrón de `lib/nutricion/menuPdf.js`).
 * 3. `pieYNumeros` recorre las páginas ya escritas con `bufferPages`: el
 *    PDFDocument tiene que abrirse con `bufferPages: true`. Salta la primera
 *    página (la portada no lleva pie ni número).
 * 4. Los colores vienen de `paletaDeInforme` (`marcaInforme.js`), nunca
 *    escritos aquí: este dibujo es del módulo base y lo usan todos los centros.
 * 5. El margen izquierdo es más ancho que el derecho A PROPÓSITO: el número
 *    grande de cada apartado se pinta en él.
 */

/** Los márgenes del cuerpo del documento (la portada los ignora). */
export const MARGEN_DOCUMENTO = Object.freeze({ top: 70, bottom: 84, left: 86, right: 62 });

export const texto = (v) => (v == null ? "" : String(v).trim());

export function fmtFecha(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
}

/**
 * La edad EN UNA FECHA, no la de hoy: el documento se puede abrir dos años
 * después y tiene que seguir diciendo la edad que tenía entonces.
 */
export function edadEnLaFecha(nacimiento, fechaDelDocumento) {
  if (!nacimiento) return "";
  const nac = new Date(nacimiento);
  const ref = fechaDelDocumento ? new Date(fechaDelDocumento) : new Date();
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
 * Cuál de los dos avisos legales le toca a ESTE documento.
 *
 * Un centro que atiende a niños y a adultos tiene dos textos distintos y no son
 * intercambiables: el de menores habla de la autorización del tutor y dice que
 * el informe queda en poder de los padres. Imprimírselo a un adulto es decirle
 * que su informe lo guardan sus padres.
 *
 * Se mira la edad EN LA FECHA DEL DOCUMENTO, igual que la portada: un informe
 * de hace tres años, reimpreso hoy, tiene que seguir llevando el aviso que le
 * correspondía entonces. Sin fecha de nacimiento o sin texto de adultos se usa
 * el de siempre, que es lo que ya hacía antes de existir esta elección.
 */
export function avisoDeProteccion(centro, { nacimiento, fechaInforme } = {}) {
  const general = centro?.proteccionDatos || "";
  const adultos = centro?.proteccionDatosAdultos || "";
  if (!adultos || !nacimiento) return general;
  const nac = new Date(nacimiento);
  const ref = fechaInforme ? new Date(fechaInforme) : new Date();
  if (Number.isNaN(nac.getTime()) || Number.isNaN(ref.getTime())) return general;
  let anios = ref.getFullYear() - nac.getFullYear();
  const m = ref.getMonth() - nac.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < nac.getDate())) anios -= 1;
  return anios >= 18 ? adultos : general;
}

// ── Utillería de dibujo ─────────────────────────────────────────────────────

export const util = (doc) => doc.page.width - doc.page.margins.left - doc.page.margins.right;

export function filete(doc, y, color, grosor = 0.75, desde = null, hasta = null) {
  const x1 = desde ?? doc.page.margins.left;
  const x2 = hasta ?? doc.page.width - doc.page.margins.right;
  doc.save().moveTo(x1, y).lineTo(x2, y).lineWidth(grosor).strokeColor(color).stroke().restore();
}

/** Versalitas espaciadas de titular. */
export function espaciado(doc, t, x, y, opciones = {}) {
  doc.text(t, x, y, { characterSpacing: 1.2, ...opciones });
}

/** ¿Cabe un bloque de `alto` en lo que queda de página? Si no, salta. */
export function asegurarHueco(doc, alto) {
  if (doc.y + alto > doc.page.height - doc.page.margins.bottom - 40) doc.addPage();
}

// ── Portada ─────────────────────────────────────────────────────────────────

/**
 * Ocupa la primera página ENTERA (28/08/2026, Jorge: «que la portada ocupe la
 * primera página entera y que no haya el padding por los cuatro lados»). El
 * fondo y las manchas de color llegan al borde del papel; el TEXTO conserva su
 * margen, porque ninguna impresora imprime hasta el filo y un título pegado al
 * corte no se lee.
 *
 * `cabecera`: `{ tipo, servicio, periodo, paciente, edadYNacimiento, firma,
 * fechaTexto, ciudad }`. Lo que venga vacío no se pinta.
 */
export function portada(doc, F, { centro, marca, cabecera, logo }) {
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
   * La pastilla dice el PERIODO al que se refiere el documento: en el informe,
   * el de las sesiones en las que se basa; en el registro, el día y la hora de
   * la sesión. En la maqueta ponía «Curso 2025 – 2026», que se inventó para el
   * ejemplo: el CRM no tiene ningún concepto de curso escolar, y derivarlo de
   * la fecha sería adivinar (un informe de nutrición no va por cursos).
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

export function indice(doc, F, { entradas, marca, aviso }) {
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

/**
 * UN APARTADO numerado: el número grande al margen, el título, el filete de
 * acento y el cuerpo (párrafos justificados o viñetas). `ap` es
 * `{ n, label, lista, parrafos }`.
 */
export function apartadoNumerado(doc, F, ap, marca) {
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
 * Firma, con hueco de verdad para firmar a mano: estos documentos se firman en
 * papel. El nombre va siempre; la acreditación (titulación y nº de colegiada)
 * solo si la hay — hoy no la tiene nadie en producción.
 */
export function bloqueFirma(doc, F, { firma, ciudadFecha, marca }) {
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
  /*
   * Los demás títulos, uno por renglón (29/08/2026, Aumenta mandó las suyas).
   * Van en cuerpo más pequeño que la primera línea: esa es la que acredita —la
   * profesión con su nº de colegiada— y estos son el respaldo. Sin ellos el
   * bloque queda EXACTAMENTE como estaba, que es como está todo el mundo hoy.
   */
  for (const t of firma.titulos ?? []) {
    doc.font(F.regular).fontSize(8).fillColor(marca.suave);
    doc.text(t, { align: "right" });
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
export function cierreDelDocumento(doc, F, { marca, isotipo, aviso }) {
  const hayTexto = Boolean(aviso);
  if (!hayTexto && !isotipo) return;

  if (hayTexto) {
    doc.addPage();
    doc.font(F.bold).fontSize(11).fillColor(marca.oscuro);
    doc.text("Protección de datos y confidencialidad");
    doc.moveDown(0.5);
    filete(doc, doc.y, marca.filete, 0.5);
    doc.moveDown(0.8);
    doc.font(F.regular).fontSize(7.6).fillColor(marca.suave);
    doc.text(aviso, { align: "justify", lineGap: 1.6 });
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
export function pieYNumeros(doc, F, { centro, marca }) {
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
