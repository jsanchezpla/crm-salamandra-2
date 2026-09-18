// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-familia-en-la-ficha.mjs — qué de la familia ve una terapeuta desde la
 * ficha del paciente (18/09/2026, AV-181 de Aumenta).
 *
 *   node scripts/_smoke-familia-en-la-ficha.mjs
 *
 * Lo que fija: `lib/clients/familiaEnLaFicha.js` construye el bloque «La
 * familia» CAMPO A CAMPO desde `customFields`, así que nada del dinero puede
 * colarse por ahí aunque venga en la fila —y viene: el include del endpoint
 * trae `taxId` para no duplicar al titular—. Si alguien amplía la función
 * copiando la ficha entera, esto se pone rojo.
 *
 * Y la segunda regla, la del enlace: el bloque viaja siempre (lo gatea el
 * CENTRO), pero abrir la ficha del cliente depende del USUARIO. Las 13
 * terapeutas de Aumenta no tienen `clients` en su `moduleAccess`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { datosDeLaFamilia, domicilioEnUnaLinea } from "../lib/clients/familiaEnLaFicha.js";
import { serializePatient } from "../lib/clinica/serialize.js";

const FAMILIA = {
  id: "c1",
  name: "Ana Ruiz",
  taxId: "12345678Z",
  fiscalName: "Ana Ruiz Pérez",
  fiscalTaxId: "12345678Z",
  fiscalAddress: "C/ Facturación 1",
  guardians: [],
  notes: "Debe dos meses; hablar con dirección",
  customFields: {
    domicilio: "C/ Mallorca 210, 3º 2ª",
    postalCode: "28013",
    city: "Madrid",
    motivo: "Dificultades de atención en el colegio",
    parentescoTitular: "madre",
  },
};

describe("datosDeLaFamilia", () => {
  it("devuelve los datos de trabajo y NADA más", () => {
    assert.deepEqual(datosDeLaFamilia(FAMILIA), {
      domicilio: "C/ Mallorca 210, 3º 2ª",
      codigoPostal: "28013",
      localidad: "Madrid",
      motivo: "Dificultades de atención en el colegio",
      hayAlgo: true,
    });
  });

  it("no deja salir el NIF, la razón social ni las notas", () => {
    const salida = JSON.stringify(datosDeLaFamilia(FAMILIA));
    for (const fuga of ["12345678Z", "Ana Ruiz Pérez", "Debe dos meses", "taxId", "notes"]) {
      assert.ok(!salida.includes(fuga), `se ha colado «${fuga}» en el bloque de la familia`);
    }
  });

  /*
   * La caída a la dirección fiscal (medido en producción el 18/09/2026): de las
   * 1.107 familias con paciente de Aumenta, solo 8 tienen `domicilio` a mano y
   * 988 lo tienen en `fiscalAddress`, que es como entró de Organízate. Sin esta
   * caída la tarjeta salía vacía justo en la reina que la pidió.
   */
  it("sin domicilio a mano, cae a la dirección fiscal: es dónde vive, no dinero", () => {
    const solofiscal = { fiscalAddress: "C/ Real 4", fiscalCity: "Getafe", fiscalTaxId: "99999999R", customFields: {} };
    const d = datosDeLaFamilia(solofiscal);
    assert.equal(d.domicilio, "C/ Real 4");
    assert.equal(d.localidad, "Getafe");
    assert.ok(!JSON.stringify(d).includes("99999999R"));
  });

  it("lo escrito a mano manda siempre sobre la dirección fiscal", () => {
    assert.equal(datosDeLaFamilia(FAMILIA).domicilio, "C/ Mallorca 210, 3º 2ª");
    assert.equal(datosDeLaFamilia(FAMILIA).localidad, "Madrid");
  });

  it("una familia sin nada dice que no hay nada (y no revienta sin cliente)", () => {
    assert.equal(datosDeLaFamilia({ customFields: {} }).hayAlgo, false);
    assert.equal(datosDeLaFamilia(null).hayAlgo, false);
    assert.equal(datosDeLaFamilia({ customFields: { domicilio: "   " } }).hayAlgo, false);
  });
});

describe("domicilioEnUnaLinea", () => {
  it("pega el sitio detrás del domicilio", () => {
    assert.equal(domicilioEnUnaLinea(datosDeLaFamilia(FAMILIA)), "C/ Mallorca 210, 3º 2ª · 28013 Madrid");
  });

  it("sin domicilio no inventa una dirección con el código postal suelto", () => {
    assert.equal(domicilioEnUnaLinea({ domicilio: null, codigoPostal: "28013", localidad: "Madrid" }), null);
  });

  it("con domicilio y sin sitio, el domicilio tal cual", () => {
    assert.equal(domicilioEnUnaLinea({ domicilio: "C/ Mallorca 210" }), "C/ Mallorca 210");
  });
});

describe("serializePatient: el bloque de la familia", () => {
  const paciente = { id: "p1", firstName: "Lucía", lastName: "Ruiz", status: "active", client: FAMILIA };

  it("viaja con la ficha y no trae el dinero de la familia", () => {
    const s = serializePatient(paciente, {});
    assert.equal(s.client.familia.domicilio, "C/ Mallorca 210, 3º 2ª");
    assert.ok(!JSON.stringify(s.client).includes("12345678Z"));
  });

  it("el enlace a la ficha del cliente depende del USUARIO, y por defecto no", () => {
    assert.equal(serializePatient(paciente, {}).client.puedeAbrirse, false);
    assert.equal(serializePatient(paciente, { puedeAbrirLaFicha: false }).client.puedeAbrirse, false);
    assert.equal(serializePatient(paciente, { puedeAbrirLaFicha: true }).client.puedeAbrirse, true);
  });
});
