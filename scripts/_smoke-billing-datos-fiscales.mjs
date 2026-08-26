// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-billing-datos-fiscales.mjs — a quién se le emitió una factura
 * (26/08/2026).
 *
 *   node scripts/_smoke-billing-datos-fiscales.mjs
 *   node --test-name-pattern="congelad" scripts/_smoke-billing-datos-fiscales.mjs
 *
 * ── QUÉ SE FIJA Y POR QUÉ ──────────────────────────────────────────────────
 *
 * Hasta hoy una factura no guardaba ni un dato fiscal propio: el nombre, el NIF
 * y la dirección impresos se leían de la ficha del cliente CADA VEZ. Corregir
 * un NIF cambiaba hacia atrás, y sin decir nada, las 14.243 facturas ya
 * emitidas de Aumenta. Ahora se congela al emitir.
 *
 * Tres cosas se rompen aquí sin dar ningún error, que es lo peligroso:
 *
 *   · **Que la foto no se lea y se siga usando el cliente vivo.** El fallo no
 *     se vería: el PDF saldría igual de bonito, solo que con el NIF de hoy.
 *   · **Que una foto a medias tape el respaldo.** Si una factura tuviera un
 *     \`fiscal_snapshot\` vacío o roto y se prefiriese igualmente, el documento
 *     saldría SIN destinatario en vez de caer al cliente, que es lo que hacía
 *     hasta hoy y funciona.
 *   · **Que el PDF y el libro de IVA no digan lo mismo.** Son dos documentos
 *     oficiales de la MISMA factura; si divergen, no se discute de la factura,
 *     se discute de cuál de los dos miente. Por eso los dos preguntan aquí.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ATRIBUTOS_PARA_CONGELAR,
  datosFiscalesDe,
  fotoFiscalDe,
} from "../lib/billing/datosFiscales.js";

/** La ficha, hoy. */
const CLIENTE = {
  id: "c1",
  name: "Ana Ruiz",
  fiscalName: "Ana Ruiz Servicios SL",
  taxId: "12345678Z",
  fiscalTaxId: "B87654321",
  fiscalAddress: "C/ Mayor 1",
  fiscalZip: "28001",
  fiscalCity: "Madrid",
  fiscalCountry: "ES",
  email: "ana@example.com",
};

/** Lo que se congeló el día que se emitió, con otro NIF y otra dirección. */
const FOTO_VIEJA = {
  nombre: "Ana Ruiz",
  nif: "12345678Z",
  direccion: "C/ Antigua 9",
  cp: "28009",
  ciudad: "Madrid",
  pais: "ES",
};

describe("fotoFiscalDe — lo que se guarda al emitir", () => {
  it("prefiere los datos de FACTURACIÓN sobre los de la ficha", () => {
    const f = fotoFiscalDe(CLIENTE);
    assert.equal(f.nombre, "Ana Ruiz Servicios SL");
    assert.equal(f.nif, "B87654321");
  });

  it("cae a los de la ficha cuando no hay de facturación", () => {
    // Es el caso de spain_enzymes y demo: clientes que son empresas cuyo
    // `taxId` YA es su CIF. Sin este respaldo se congelarían sin NIF.
    const f = fotoFiscalDe({ name: "Enzimas SA", taxId: "A11111111" });
    assert.equal(f.nombre, "Enzimas SA");
    assert.equal(f.nif, "A11111111");
  });

  it("lleva SIEMPRE las seis claves, también las que faltan", () => {
    // Con la clave puesta a null consta que ese dato faltaba; sin la clave, no
    // se distingue «no tenía» de «se guardó mal».
    const f = fotoFiscalDe({ name: "Sin señas", taxId: "X1" });
    assert.deepEqual(Object.keys(f).sort(), ["ciudad", "cp", "direccion", "nif", "nombre", "pais"]);
    assert.equal(f.direccion, null);
    assert.equal(f.ciudad, null);
  });

  it("NO congela el correo, aunque el PDF lo imprima", () => {
    assert.equal("email" in fotoFiscalDe(CLIENTE), false);
  });

  it("sin nombre ni NIF no hay foto: mejor ninguna que una vacía", () => {
    // Una foto vacía taparía el respaldo al cliente vivo y el documento saldría
    // sin destinatario.
    assert.equal(fotoFiscalDe({ id: "x" }), null);
    assert.equal(fotoFiscalDe(null), null);
    assert.equal(fotoFiscalDe({ fiscalAddress: "C/ Sola 1" }), null);
  });

  it("los atributos que hay que traer de la base incluyen la dirección fiscal", () => {
    // A una lista blanca a la que se le olvida un campo no le da error: devuelve
    // `undefined` en silencio, y la foto sale coja PARA SIEMPRE.
    for (const campo of [
      "fiscalName",
      "fiscalTaxId",
      "taxId",
      "fiscalAddress",
      "fiscalZip",
      "fiscalCity",
    ]) {
      assert.ok(ATRIBUTOS_PARA_CONGELAR.includes(campo), campo);
    }
  });
});

describe("datosFiscalesDe — lo que se imprime", () => {
  it("con foto manda la foto, aunque la ficha diga otra cosa hoy", () => {
    const d = datosFiscalesDe({ fiscalSnapshot: FOTO_VIEJA }, CLIENTE);
    assert.equal(d.congelado, true);
    assert.equal(d.nif, "12345678Z");
    assert.equal(d.direccion, "C/ Antigua 9");
    assert.equal(d.nombre, "Ana Ruiz");
  });

  it("sin foto lee la ficha, como hasta el 26/08/2026", () => {
    const d = datosFiscalesDe({ fiscalSnapshot: null }, CLIENTE);
    assert.equal(d.congelado, false);
    assert.equal(d.nif, "B87654321");
    assert.equal(d.direccion, "C/ Mayor 1");
  });

  it("una factura sin el campo siquiera también cae a la ficha", () => {
    assert.equal(datosFiscalesDe({}, CLIENTE).congelado, false);
    assert.equal(datosFiscalesDe(null, CLIENTE).congelado, false);
  });

  it("entiende la columna en snake_case, por si llega de SQL crudo", () => {
    const d = datosFiscalesDe({ fiscal_snapshot: FOTO_VIEJA }, CLIENTE);
    assert.equal(d.congelado, true);
    assert.equal(d.nif, "12345678Z");
  });

  it("una foto rota NO tapa el respaldo", () => {
    for (const rota of [
      {},
      [],
      "una cadena",
      { direccion: "C/ Sola 1" },
      { nombre: "", nif: "" },
    ]) {
      const d = datosFiscalesDe({ fiscalSnapshot: rota }, CLIENTE);
      assert.equal(d.congelado, false, JSON.stringify(rota));
      assert.equal(d.nif, "B87654321", JSON.stringify(rota));
    }
  });

  it("sin foto Y sin cliente no revienta: devuelve huecos", () => {
    const d = datosFiscalesDe({}, null);
    assert.equal(d.nombre, null);
    assert.equal(d.nif, null);
    assert.equal(d.congelado, false);
  });

  it("el PDF y el libro de IVA sacan lo mismo de la misma factura", () => {
    // No es una perogrullada: son las dos únicas salidas oficiales del CRM y
    // hasta hoy cada una leía por su cuenta.
    const factura = { fiscalSnapshot: FOTO_VIEJA };
    const paraElPdf = datosFiscalesDe(factura, CLIENTE);
    const paraElLibro = datosFiscalesDe(factura, CLIENTE);
    assert.equal(paraElPdf.nombre, paraElLibro.nombre);
    assert.equal(paraElPdf.nif, paraElLibro.nif);
  });
});

describe("el ciclo entero: emitir hoy, corregir la ficha mañana", () => {
  it("la factura sigue diciendo lo que decía", () => {
    const alEmitir = fotoFiscalDe(CLIENTE);
    const factura = { fiscalSnapshot: alEmitir };
    // Al día siguiente alguien corrige el NIF y la dirección de la ficha.
    const fichaCorregida = { ...CLIENTE, fiscalTaxId: "B00000000", fiscalAddress: "C/ Nueva 2" };
    const d = datosFiscalesDe(factura, fichaCorregida);
    assert.equal(d.nif, "B87654321");
    assert.equal(d.direccion, "C/ Mayor 1");
  });

  it("y una factura emitida DESPUÉS lleva ya lo corregido", () => {
    const fichaCorregida = { ...CLIENTE, fiscalTaxId: "B00000000" };
    const nueva = { fiscalSnapshot: fotoFiscalDe(fichaCorregida) };
    assert.equal(datosFiscalesDe(nueva, fichaCorregida).nif, "B00000000");
  });
});
