// @prueba ligera
/**
 * _smoke-correo-herramientas.mjs — las herramientas del sprint de /correo del
 * 26/08/2026: composición del correo (firma + adjuntos), listas guardadas y
 * plantillas. Prueba lo que DEVUELVEN las funciones de lib/correo/, no cómo
 * están escritas (node:test + node:assert/strict, cero dependencias).
 *
 * Lo que fija:
 *   · El cuerpo que teclea una persona viaja ESCAPADO en la versión HTML.
 *   · La firma se sanea: fuera scripts, manejadores on* y javascript: — y lo
 *     que es presentación (negritas, enlaces) se queda.
 *   · La versión de texto y la HTML dicen lo mismo (la firma va en las dos).
 *   · Un adjunto que no es imagen/PDF, pesa de más o llega roto tumba la
 *     validación ENTERA con un motivo, no a medias.
 *   · Una lista/plantilla inválida se rechaza con su motivo, y una válida se
 *     normaliza (correos en minúsculas, sin duplicados).
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  bytesDeBase64,
  componerContenido,
  escapeHtml,
  htmlATexto,
  limpiarNombreFichero,
  normalizarFirmaEntrada,
  sanitizarHtmlFirma,
  textoAHtml,
  validarAdjuntos,
  MAX_ADJUNTOS,
} from "../lib/correo/composicion.js";
import { normalizarListaDestinatarios, normalizarNombreLista } from "../lib/correo/listas.js";
import { normalizarPlantilla } from "../lib/correo/plantillas.js";

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// ── Escapado y texto↔HTML ───────────────────────────────────────────────────

test("escapeHtml neutraliza las cinco de siempre", () => {
  assert.equal(escapeHtml(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
});

test("textoAHtml escapa y respeta los saltos de línea", () => {
  assert.equal(textoAHtml("hola\n<mundo>"), "hola<br />&lt;mundo&gt;");
  assert.equal(textoAHtml("a\r\nb"), "a<br />b");
});

test("htmlATexto quita etiquetas y devuelve las entidades básicas", () => {
  assert.equal(htmlATexto("<p>Ana &amp; Luis</p>tel&nbsp;600"), "Ana & Luis\ntel 600");
});

// ── Saneado de la firma ─────────────────────────────────────────────────────

test("sanitizarHtmlFirma quita script con su contenido y deja el marcado", () => {
  const limpio = sanitizarHtmlFirma(`<b>María</b><script>alert(1)</script><a href="https://x.es">web</a>`);
  assert.equal(limpio.includes("script"), false);
  assert.equal(limpio.includes("alert"), false);
  assert.equal(limpio.includes("<b>María</b>"), true);
  assert.equal(limpio.includes(`href="https://x.es"`), true);
});

test("sanitizarHtmlFirma quita manejadores on* y URLs javascript:", () => {
  const limpio = sanitizarHtmlFirma(`<img src="x.png" onerror="alert(1)"><a href="javascript:alert(1)">a</a>`);
  assert.equal(/onerror/i.test(limpio), false);
  assert.equal(/javascript:/i.test(limpio), false);
});

test("sanitizarHtmlFirma quita iframes y forms también sin cierre", () => {
  const limpio = sanitizarHtmlFirma(`hola<iframe src="https://x"></iframe><meta http-equiv="refresh">`);
  assert.equal(/iframe|meta/i.test(limpio), false);
  assert.equal(limpio.includes("hola"), true);
});

// ── Firma: normalización de entrada ─────────────────────────────────────────

test("una firma tecleada en texto plano conserva sus líneas", () => {
  const f = normalizarFirmaEntrada({ html: "María García\nPsicóloga" });
  assert.equal(f.html, "María García<br />Psicóloga");
  assert.equal(f.texto, "María García\nPsicóloga");
});

test("una firma HTML se sanea y su texto derivado dice lo mismo", () => {
  const f = normalizarFirmaEntrada({ html: `<b>María</b><script>x()</script>` });
  assert.equal(f.html.includes("script"), false);
  assert.equal(f.texto, "María");
});

test("texto con un tag suelto: se quita el tag y los saltos de línea sobreviven", () => {
  const f = normalizarFirmaEntrada({ html: "María García\nPsicóloga <script>x()</script>" });
  assert.equal(f.html, "María García<br />Psicóloga");
  assert.equal(f.texto, "María García\nPsicóloga");
});

test("la imagen de la firma exige tipo de imagen y tope de peso", () => {
  assert.ok(normalizarFirmaEntrada({ imagen: { tipo: "application/pdf", base64: PNG_1PX } }).error);
  assert.ok(normalizarFirmaEntrada({ imagen: { tipo: "image/png", base64: "no-es-base64!!!" } }).error);
  const gorda = "A".repeat(2 * 1024 * 1024); // ~1,5 MB decodificados
  assert.ok(normalizarFirmaEntrada({ imagen: { tipo: "image/png", base64: gorda } }).error);
  const ok = normalizarFirmaEntrada({ imagen: { nombre: "logo.png", tipo: "image/png", base64: PNG_1PX } });
  assert.equal(ok.error, undefined);
  assert.equal(ok.imagen.nombre, "logo.png");
});

test("firma vacía = sin firma, no un error", () => {
  const f = normalizarFirmaEntrada({ html: "", imagen: null });
  assert.equal(f.error, undefined);
  assert.equal(f.html, null);
  assert.equal(f.imagen, null);
});

// ── Adjuntos ────────────────────────────────────────────────────────────────

test("bytesDeBase64 calcula el peso real", () => {
  assert.equal(bytesDeBase64("QUJD"), 3); // "ABC"
  assert.equal(bytesDeBase64("QUI="), 2);
  assert.equal(bytesDeBase64(""), 0);
});

test("limpiarNombreFichero quita rutas y caracteres raros", () => {
  assert.equal(limpiarNombreFichero("C:\\Users\\x\\factura.pdf"), "factura.pdf");
  assert.equal(limpiarNombreFichero("../../etc/passwd.png"), "passwd.png");
  assert.equal(limpiarNombreFichero(""), "adjunto");
});

test("validarAdjuntos acepta imagen y PDF y les pone su content_type", () => {
  const r = validarAdjuntos([
    { nombre: "foto.png", base64: PNG_1PX },
    { nombre: "Menú de otoño.PDF", base64: "QUJD" },
  ]);
  assert.equal(r.error, undefined);
  assert.equal(r.adjuntos.length, 2);
  assert.equal(r.adjuntos[0].content_type, "image/png");
  assert.equal(r.adjuntos[1].content_type, "application/pdf");
  assert.equal(r.adjuntos[1].filename, "Menú de otoño.PDF");
});

test("validarAdjuntos rechaza extensiones que no son imagen/PDF", () => {
  assert.ok(validarAdjuntos([{ nombre: "virus.exe", base64: "QUJD" }]).error);
  assert.ok(validarAdjuntos([{ nombre: "sin-extension", base64: "QUJD" }]).error);
});

test("validarAdjuntos rechaza base64 roto y demasiados ficheros", () => {
  assert.ok(validarAdjuntos([{ nombre: "a.png", base64: "@@@" }]).error);
  const muchos = Array.from({ length: MAX_ADJUNTOS + 1 }, (_, i) => ({ nombre: `a${i}.png`, base64: "QUJD" }));
  assert.ok(validarAdjuntos(muchos).error);
});

test("validarAdjuntos sin nada devuelve lista vacía, no error", () => {
  assert.deepEqual(validarAdjuntos(undefined), { adjuntos: [] });
});

// ── Composición del envío ───────────────────────────────────────────────────

test("sin firma, el correo sigue siendo solo texto", () => {
  const c = componerContenido({ cuerpo: "hola" });
  assert.equal(c.text, "hola");
  assert.equal(c.html, null);
  assert.deepEqual(c.adjuntosFirma, []);
});

test("con firma, el cuerpo va ESCAPADO en el HTML y la firma en las dos versiones", () => {
  const c = componerContenido({
    cuerpo: `Hola <familia> & co`,
    firma: { html: "<b>María</b>", texto: "María" },
  });
  assert.equal(c.html.includes("Hola &lt;familia&gt; &amp; co"), true);
  assert.equal(c.html.includes("<b>María</b>"), true);
  assert.equal(c.text, "Hola <familia> & co\n\n--\nMaría");
});

test("la imagen de la firma va como adjunto cid:, no como data:", () => {
  const c = componerContenido({
    cuerpo: "hola",
    firma: { html: null, texto: null, imagen: { nombre: "logo.png", tipo: "image/png", base64: PNG_1PX } },
  });
  assert.equal(c.html.includes(`src="cid:firma"`), true);
  assert.equal(c.html.includes("data:"), false);
  assert.equal(c.adjuntosFirma.length, 1);
  assert.equal(c.adjuntosFirma[0].content_id, "firma");
  assert.equal(c.adjuntosFirma[0].content_type, "image/png");
});

test("una firma guardada con maldad se vuelve a sanear al componer", () => {
  const c = componerContenido({ cuerpo: "hola", firma: { html: `<script>x()</script><i>ok</i>`, texto: "ok" } });
  assert.equal(c.html.includes("script"), false);
  assert.equal(c.html.includes("<i>ok</i>"), true);
});

// ── Listas guardadas ────────────────────────────────────────────────────────

test("el nombre de una lista se exige y se acota", () => {
  assert.ok(normalizarNombreLista("").error);
  assert.ok(normalizarNombreLista("x".repeat(81)).error);
  assert.equal(normalizarNombreLista("  Familias de logopedia  ").nombre, "Familias de logopedia");
});

test("los destinatarios de una lista se normalizan: minúsculas, sin duplicados, malos aparte", () => {
  const r = normalizarListaDestinatarios([
    { email: "Ana@Sitio.com", nombre: "Ana", fuente: "contratantes" },
    { email: "ana@sitio.com" },
    "esto-no-es-un-correo",
    { email: "otro@sitio.com", detalle: "Madre · Lucía" },
  ]);
  assert.equal(r.error, undefined);
  assert.equal(r.destinatarios.length, 2);
  assert.equal(r.destinatarios[0].email, "ana@sitio.com");
  assert.deepEqual(r.descartados, ["esto-no-es-un-correo"]);
});

test("una lista sin un solo correo válido se rechaza", () => {
  assert.ok(normalizarListaDestinatarios(["nada", "tampoco"]).error);
  assert.ok(normalizarListaDestinatarios("no-es-lista").error);
});

// ── Plantillas ──────────────────────────────────────────────────────────────

test("una plantilla exige nombre y algo de contenido", () => {
  assert.ok(normalizarPlantilla({ nombre: "", asunto: "x" }).error);
  assert.ok(normalizarPlantilla({ nombre: "Bienvenida", asunto: "", cuerpo: "" }).error);
  const p = normalizarPlantilla({ nombre: " Bienvenida ", asunto: "Hola", cuerpo: "" });
  assert.equal(p.error, undefined);
  assert.equal(p.nombre, "Bienvenida");
  assert.equal(p.asunto, "Hola");
  assert.equal(p.cuerpo, null);
});

test("una plantilla respeta los MISMOS topes que el envío", () => {
  assert.ok(normalizarPlantilla({ nombre: "x", asunto: "a".repeat(201) }).error);
  assert.ok(normalizarPlantilla({ nombre: "x", cuerpo: "a".repeat(20001) }).error);
});
