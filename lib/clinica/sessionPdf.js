import PDFDocument from "pdfkit";
import { registerPoppins } from "../pdf/fonts.js";
import { imagenLocal } from "../pdf/imagenLocal.js";
import { paletaDeInforme } from "./marcaInforme.js";
import { datosDelCentro } from "../tenant/datosCentro.js";
import { apartadosPara, valoresDeSesion, CLAVE_PLANTILLA, PLANTILLA_ENTREVISTA } from "./plantillas.js";
import { parrafosDe, sinNumeroDelante } from "./apartadosInforme.js";
import { specialtyLabels } from "./specialties.js";
import { bloqueDeFirma } from "./firmaProfesional.js";
import {
  MARGEN_DOCUMENTO,
  texto,
  fmtFecha,
  edadEnLaFecha,
  avisoDeProteccion,
  portada,
  apartadoNumerado,
  bloqueFirma,
  cierreDelDocumento,
  pieYNumeros,
} from "./documentoPdf.js";

/**
 * PDF del REGISTRO DE SESIÓN (29/08/2026, Rodrigo: «necesito que se puedan
 * generar PDF también de los Registros de Sesiones»).
 *
 * ── CON PORTADA, COMO EL INFORME (03/09/2026, Rodrigo) ─────────────────────
 * «Quiero que los registros de sesión de todo tipo —el de talleres, el de la
 * entrevista inicial y los normales— tengan la portada tipo los informes
 * grandes, pero solo de una sesión, y el diseño de dentro también.»
 *
 * La primera versión de este fichero (29/08) era una hoja de trabajo sin
 * portada, y decía en su cabecera que ponerle portada «sería un chiste». Se
 * ha dado la vuelta: el registro que recibe una familia por su área privada
 * —y más el de una entrevista inicial, que es el primer documento que ve del
 * centro— tiene que parecer del mismo centro que el informe.
 *
 * Así que ahora se compone con las MISMAS piezas que `reportPdf.js`
 * (`documentoPdf.js`): portada a sangre, apartados numerados con el número al
 * margen, bloque de firma, hoja de protección de datos e isotipo al cierre,
 * pie con número de página. Lo que sigue siendo distinto, porque es de UNA
 * sesión y no de un periodo:
 *
 *   · La pastilla de la portada dice el DÍA Y LA HORA de la sesión, no un
 *     periodo; y la edad de la portada es la que tenía ese día.
 *   · NO lleva índice. Un registro son dos o tres hojas; un índice de una
 *     página para decir lo que se ve pasando la hoja sobra, y con 15 apartados
 *     (la entrevista) sigue siendo un documento que se lee del tirón.
 *   · Se NOMBRA por lo que es (`tituloDeRegistro`): «Entrevista inicial» si se
 *     escribió con esa plantilla, «Sesión de taller» —con el nombre del
 *     taller debajo— si sale de un taller, y «Registro de sesión» el resto.
 *   · La devolución de la familia es el último apartado numerado: es la parte
 *     3 del registro, no un apartado de plantilla, pero en el papel es un
 *     apartado más.
 *
 * ── QUÉ NO SALE, Y NO ES UN OLVIDO ─────────────────────────────────────────
 * Ni la preparación (`prepText`) ni sus adjuntos ni las notas internas ni la
 * transcripción del audio. Son material del equipo: la regla del módulo es que
 * no salen del CRM, y un PDF es justo la forma de que salgan. Se imprimen los
 * apartados del registro —los de su plantilla y los sueltos que le añadieran— y
 * la devolución de la familia. Fijado en `_smoke-plantillas-clinica.mjs` y en
 * `_smoke-registro-pdf.mjs`.
 */

function fmtHora(d) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Cómo se NOMBRA el registro en su portada y en su fichero.
 *
 * Devuelve `{ tipo, subtitulo }`. `tipo` es el titular de 30 puntos; el
 * subtítulo va debajo en el color de la marca y solo si hay algo que decir:
 * el nombre del taller, o el servicio del paciente si se le pasa.
 *
 *   · Escrito con la plantilla de la entrevista (`contentSections.plantilla`
 *     === `entrevista_inicial`) → «Entrevista inicial». Es la clave de
 *     `PLANTILLA_ENTREVISTA`, y también la que usa un centro que guarda la
 *     suya con ese nombre (`plantillas.js`), así que vale para las dos.
 *   · Con `tallerSesionId` → «Sesión de taller», y el nombre del taller como
 *     subtítulo (si el llamador lo cargó).
 *   · El resto → «Registro de sesión».
 */
export function tituloDeRegistro(session, { tallerNombre = null, servicio = "" } = {}) {
  const s = session?.toJSON ? session.toJSON() : session;
  const cs = s?.contentSections && typeof s.contentSections === "object" ? s.contentSections : {};
  if (texto(cs[CLAVE_PLANTILLA]) === PLANTILLA_ENTREVISTA.key) {
    return { tipo: "Entrevista inicial", subtitulo: texto(servicio) };
  }
  if (s?.tallerSesionId) {
    const nombre = texto(tallerNombre);
    return { tipo: "Sesión de taller", subtitulo: nombre ? `Taller · ${nombre}` : texto(servicio) };
  }
  return { tipo: "Registro de sesión", subtitulo: texto(servicio) };
}

/** Nombre de fichero legible: «Registro de sesión - Nombre - 2026-08-29.pdf». */
export function sessionPdfFilename(session, patientName) {
  const fecha = session?.sessionDate ? new Date(session.sessionDate) : null;
  const dia = fecha && !Number.isNaN(fecha.getTime()) ? fecha.toISOString().slice(0, 10) : "";
  const limpio = (v) => texto(v).replace(/[\\/:*?"<>|]/g, "").trim();
  return `${[tituloDeRegistro(session).tipo, limpio(patientName), dia].filter(Boolean).join(" - ")}.pdf`;
}

/**
 * Los apartados que este registro va a imprimir, numerados del 1 en adelante:
 * los de su plantilla (o la del centro, o los de fábrica — `apartadosPara`
 * decide) que tengan algo escrito, y al final la devolución de la familia.
 *
 * Gemela de `apartadosDelInforme`: un apartado vacío no se imprime y NO GASTA
 * número, así el número grande del margen va seguido; y el título sale sin el
 * número que traiga delante (`sinNumeroDelante`), que lo pone el documento.
 *
 * Devuelve `[{ n, key, label, lista, parrafos }]`.
 */
export function apartadosDelRegistro(session, tenant = null) {
  const s = session?.toJSON ? session.toJSON() : session;
  if (!s) return [];
  const bolsa = valoresDeSesion(s);
  const salen = [];
  for (const a of apartadosPara(s.contentSections, tenant, "registro")) {
    const parrafos = parrafosDe(bolsa[a.key], a.tipo === "lista");
    if (!parrafos.length) continue;
    // Sin el número que traiga el título: lo pone el documento (y la
    // entrevista inicial los trae todos, «1. Datos de identificación»…).
    salen.push({ n: salen.length + 1, key: a.key, label: sinNumeroDelante(a.label), lista: a.tipo === "lista", parrafos });
  }
  // La devolución de la familia es la parte 3 del registro, no un apartado de
  // plantilla: va siempre al final y con su rótulo de siempre.
  const devolucion = parrafosDe(s.parentFeedback, false);
  if (devolucion.length) {
    salen.push({ n: salen.length + 1, key: "parentFeedback", label: "Devolución de la familia", lista: false, parrafos: devolucion });
  }
  return salen;
}

/**
 * Devuelve el Buffer del PDF de un registro de sesión.
 *
 * @param session       fila de ClinicSession (o su JSON)
 * @param patientName   nombre del paciente, ya compuesto
 * @param patientBirthDate  para la edad de la portada, la del día de la sesión (opcional)
 * @param patientSpecialties  claves de especialidad del paciente: «Servicio de Logopedia» bajo el título (opcional)
 * @param therapistName quien dio la sesión, si consta (en el histórico
 *   importado de Aumenta hay 4.045 sesiones sin firmar: el bloque se cae solo)
 * @param therapistPosition / therapistQualification / therapistCollegiate  lo
 *   que acredita a quien firma; sin ellos la firma es solo el nombre
 * @param tenantName    respaldo del nombre del centro
 * @param brand         `settings.brand`: de ahí sale la paleta, el logo y el isotipo
 * @param tenant        el tenant entero: de ahí salen `settings.centro` y las
 *   plantillas del centro, a las que se cae cuando el registro no trae su
 *   propia foto de apartados — que es todo lo escrito antes del 29/08/2026
 * @param tallerNombre  el nombre del taller si el registro sale de uno (opcional)
 */
export async function buildSessionPdfBuffer({
  session,
  patientName,
  patientBirthDate = null,
  patientSpecialties = [],
  therapistName,
  therapistPosition = null,
  therapistQualification = null,
  therapistCollegiate = null,
  tenantName,
  brand,
  tenant = null,
  tallerNombre = null,
}) {
  const s = session?.toJSON ? session.toJSON() : session;
  if (!s) return Promise.reject(new Error("Sin sesión que imprimir"));

  const marca = paletaDeInforme(brand);
  const centro = datosDelCentro(tenant, { nombrePorDefecto: tenantName });
  const apartados = apartadosDelRegistro(s, tenant);

  // ⚠️ Las imágenes ANTES de abrir el documento: el render es síncrono. Solo
  // desde `public/`, nunca de la red (`lib/pdf/imagenLocal.js`).
  const logo = imagenLocal(brand?.logoUrl);
  const isotipo = imagenLocal(brand?.isotipoUrl);

  const servicios = specialtyLabels(patientSpecialties);
  const servicio = servicios.length ? `Servicio de ${servicios.join(" · ")}` : "";
  const { tipo, subtitulo } = tituloDeRegistro(s, { tallerNombre, servicio });

  const firma = bloqueDeFirma({
    nombre: therapistName,
    titulacion: therapistQualification,
    puesto: therapistPosition,
    colegiado: therapistCollegiate,
  });

  const fechaTexto = fmtFecha(s.sessionDate);
  const hora = s.sessionDate ? fmtHora(s.sessionDate) : "";
  // La pastilla de la portada: el día y la hora de ESTA sesión.
  const cuando = fechaTexto ? (hora ? `${fechaTexto} · ${hora}` : fechaTexto) : "";
  const edad = edadEnLaFecha(patientBirthDate, s.sessionDate);
  const nacimiento = patientBirthDate ? fmtFecha(patientBirthDate) : "";
  const ciudad = centro.sedes[0]?.ciudad || "";

  const cabecera = {
    tipo,
    servicio: subtitulo,
    periodo: cuando,
    paciente: texto(patientName) || "—",
    edadYNacimiento: [edad, nacimiento].filter(Boolean).join("  ·  "),
    firma,
    fechaTexto,
    ciudad,
  };
  const ciudadFecha = fechaTexto ? (ciudad ? `En ${ciudad}, a ${fechaTexto}` : fechaTexto) : "";

  // La línea de datos bajo el titular del cuerpo: cuándo fue, cuánto duró y
  // quién la dio. Es lo que antes era la ficha de datos de la hoja simple.
  const datos = [
    cuando ? `Sesión del ${cuando}` : "",
    s.duration ? `${s.duration} minutos` : "",
    firma.nombre ? `Profesional: ${firma.nombre}` : "",
  ]
    .filter(Boolean)
    .join("  ·  ");

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margins: MARGEN_DOCUMENTO, bufferPages: true, autoFirstPage: true });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const F = registerPoppins(doc);

      portada(doc, F, { centro, marca, cabecera, logo });
      doc.addPage(); // el cuerpo, sin índice de por medio

      doc.font(F.bold).fontSize(17).fillColor(marca.oscuro).text(tipo);
      const contexto = [texto(patientName), subtitulo, fechaTexto].filter(Boolean).join(" · ");
      if (contexto) {
        doc.font(F.regular).fontSize(10.5).fillColor(marca.principalMedio).text(contexto);
      }
      doc.moveDown(1.2);
      if (datos) {
        doc.font(F.regular).fontSize(8.4).fillColor(marca.suave).text(datos);
        doc.moveDown(0.9);
      }

      for (const ap of apartados) apartadoNumerado(doc, F, ap, marca);

      if (!apartados.length) {
        doc.font(F.italic).fontSize(11).fillColor(marca.suave)
          .text("Este registro todavía no tiene contenido escrito.");
      }

      bloqueFirma(doc, F, { firma, ciudadFecha, marca });

      cierreDelDocumento(doc, F, {
        marca,
        isotipo,
        aviso: avisoDeProteccion(centro, { nacimiento: patientBirthDate, fechaInforme: s.sessionDate }),
      });

      pieYNumeros(doc, F, { centro, marca });
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
