// @prueba ligera
/**
 * _smoke-cuota-contrato.mjs — la subida del contrato mira la cuota del CENTRO
 * (08/09/2026, AV-0079 de Aumenta).
 *
 * Isabel: «al subir el contrato estándar escaneado me pone que la cuota de
 * almacenamiento está superada y no deja subirlo». Aumenta tiene 10 GB dados y
 * usaba 6,2 GB —3,9 libres—, pero ESA subida se medía contra el gigabyte de
 * fábrica. Cuando la cuota pasó a ser por cliente (26/08/2026) se cambiaron los
 * diez sitios que suben ficheros y se quedó justo el del contrato.
 *
 * Lo que fija esta prueba es que NO vuelva a quedarse ninguno atrás: que
 * `quotaBytesDe` mande sobre la constante, y que en `contratoServicios.js` no
 * reaparezca la comparación contra la constante pelada.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TENANT_QUOTA_BYTES, quotaBytesDe } from "../lib/documents/documentStorage.js";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const fuente = (rel) => readFileSync(join(RAIZ, rel), "utf8");

/** Un contexto de tenant de mentira, con o sin cuota propia. */
const ctxCon = (bytes) => ({ getLogicOverride: (m, k) => (m === "documents" && k === "quotaBytes" ? bytes : undefined) });

test("la cuota del centro manda sobre la de fábrica", () => {
  assert.equal(quotaBytesDe(ctxCon(10 * 1024 ** 3)), 10 * 1024 ** 3);
  assert.notEqual(quotaBytesDe(ctxCon(10 * 1024 ** 3)), TENANT_QUOTA_BYTES);
});

test("sin cuota propia se cae a la de fábrica, no a cero", () => {
  // Caer a 0 dejaría al cliente sin poder subir NADA, que es peor que el fallo
  // que se está arreglando.
  assert.equal(quotaBytesDe({}), TENANT_QUOTA_BYTES);
  assert.equal(quotaBytesDe(null), TENANT_QUOTA_BYTES);
  assert.equal(quotaBytesDe(ctxCon(0)), TENANT_QUOTA_BYTES);
  assert.equal(quotaBytesDe(ctxCon(-5)), TENANT_QUOTA_BYTES);
  assert.equal(quotaBytesDe(ctxCon("mucho")), TENANT_QUOTA_BYTES);
});

test("el caso real de Aumenta: 6,2 GB usados con 10 GB dados NO se corta", () => {
  const usado = 6328.2 * 1024 ** 2;
  const contrato = 2 * 1024 ** 2;
  const suya = quotaBytesDe(ctxCon(10 * 1024 ** 3));
  assert.ok(usado + contrato <= suya, "con su cuota cabe");
  assert.ok(usado + contrato > TENANT_QUOTA_BYTES, "con la de fábrica no cabía: ese era el fallo");
});

test("`contratoServicios.js` ya no compara contra la constante pelada", () => {
  /*
   * Es una regex sobre el código a propósito: lo que se rompió no fue una
   * función, fue OLVIDAR un sitio. Lo que hay que vigilar es el texto.
   */
  const src = fuente("lib/documents/contratoServicios.js");
  assert.ok(
    !/>\s*TENANT_QUOTA_BYTES/.test(src),
    "la cuota del contrato no puede medirse contra la constante de fábrica",
  );
  assert.match(src, /quotaBytesDe\(ctx\)/);
  /*
   * Y que la comparación use la VARIABLE, no la constante (08/09/2026): la
   * regla de arriba caza la comparación directa, pero no cazaría a alguien que
   * dejara `quotaBytesDe(ctx)` puesto y aun así midiera contra la constante en
   * otra línea. Lo que tiene que compararse es el techo ya resuelto.
   */
  assert.match(src, /usage \+ realSize > cuota/);
});

test("ningún otro sitio que sube ficheros compara contra la constante", () => {
  // El día que alguien añada la undécima subida, esto lo caza.
  const sitios = [
    "app/api/clients/[id]/attachments/route.js",
    "app/api/clients/[id]/contract/route.js",
    "app/api/documents/route.js",
    "app/api/pacientes/[id]/documents/route.js",
    "app/api/team/me/documents/route.js",
    "app/api/clinica/incidencias/[id]/documents/route.js",
    "app/api/clinica/sessions/[id]/prep-files/route.js",
    "app/api/citas/bloqueos/[id]/documents/route.js",
    "app/api/billing/costs/adjunto/route.js",
  ];
  for (const rel of sitios) {
    assert.ok(!/>\s*TENANT_QUOTA_BYTES/.test(fuente(rel)), `${rel} mide contra la constante`);
  }
});

test("las dos rutas que suben el contrato le pasan el contexto", () => {
  for (const rel of ["app/api/documents/contrato-servicios/route.js", "app/api/pacientes/contract-template/route.js"]) {
    const src = fuente(rel);
    assert.match(src, /guardarContrato\(\{[\s\S]{0,400}?\bctx,/, `${rel} no le pasa ctx`);
  }
});
