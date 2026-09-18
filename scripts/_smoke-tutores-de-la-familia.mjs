// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-tutores-de-la-familia.mjs — el TITULAR dentro de la lista de tutores,
 * y lo que la ficha del paciente puede escribir de ellos (18/09/2026, ficha
 * «Datos tutor» de Aumenta).
 *
 *   node scripts/_smoke-tutores-de-la-familia.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * «Que se le pueda añadir más de un progenitor» y «que desde pacientes en la
 * ficha de pacientes se le pueda añadir el tutor/tutores». Lo primero ya se
 * podía —843 familias de Aumenta tienen dos o más—, pero el TITULAR de la
 * ficha no salía en ninguna lista: por diseño (28/07) era el primer progenitor
 * y no se duplicaba dentro de `guardians`. Resultado en producción: 104
 * familias con pacientes cuya ficha decía «sin padres ni tutores apuntados»
 * teniendo el teléfono de la madre delante, y 814 con el titular DUPLICADO
 * dentro de `guardians` porque la importación no conocía la regla.
 *
 * Aquí se fija lo que resuelve esas dos mitades sin migrar la columna:
 *   · `tutoresDeLaFamilia` mete al titular y NO lo pinta dos veces;
 *   · `fusionarTutoresDeFicha` deja escribir a las terapeutas los cuatro
 *     campos que ven, conservando el DNI y quién firma, que no ven.
 *
 * Lo segundo es lo que impide que corregir un teléfono borre los 1.621 DNI de
 * tutores que hay en producción.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  tutoresDeLaFamilia,
  fusionarTutoresDeFicha,
  normalizeGuardians,
  MAX_TUTORES,
} from "../lib/clients/guardians.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("tutoresDeLaFamilia: el titular entra en la lista", () => {
  it("una familia SIN guardians ya no sale vacía: sale el titular (las 104 de Aumenta)", () => {
    const lista = tutoresDeLaFamilia({
      name: "Ana Ruiz Pérez",
      phone: "600 111 222",
      email: "ana@email.com",
      guardians: [],
    });
    assert.equal(lista.length, 1);
    assert.deepEqual(lista[0], {
      id: null,
      name: "Ana Ruiz Pérez",
      // Nadie dijo qué es del paciente: no se le inventa «Tutor/a legal».
      relationship: null,
      relationshipLabel: null,
      phone: "600 111 222",
      email: "ana@email.com",
      titular: true,
    });
  });

  it("si alguien SÍ dijo el parentesco del titular, se usa", () => {
    const [t] = tutoresDeLaFamilia({
      name: "Ana Ruiz",
      guardians: [],
      customFields: { parentescoTitular: "madre" },
    });
    assert.equal(t.relationship, "madre");
    assert.equal(t.relationshipLabel, "Madre");
  });

  it("un parentescoTitular que no es de la lista no se cuela", () => {
    const [t] = tutoresDeLaFamilia({
      name: "Ana Ruiz",
      guardians: [],
      customFields: { parentescoTitular: "abuela" },
    });
    assert.equal(t.relationship, null);
  });

  it("si el titular YA está dentro de guardians no se pinta dos veces (las 814)", () => {
    const lista = tutoresDeLaFamilia({
      name: "Ana Ruiz Pérez",
      taxId: "12345678Z",
      phone: "600 111 222",
      guardians: [
        { id: "a1", name: "Ana Ruiz Pérez", relationship: "madre", dni: "12345678Z", phone: "600 111 222" },
        { id: "b2", name: "Javier Pérez", relationship: "padre", phone: "600 333 444" },
      ],
    });
    assert.equal(lista.length, 2);
    // Y abre la lista, con el parentesco y el id que ya tenía.
    assert.equal(lista[0].id, "a1");
    assert.equal(lista[0].titular, true);
    assert.equal(lista[0].relationship, "madre");
    assert.equal(lista[1].titular, false);
  });

  it("reconoce al titular aunque el nombre venga con otras tildes o mayúsculas", () => {
    const lista = tutoresDeLaFamilia({
      name: "ANA RUIZ PEREZ",
      guardians: [{ id: "a1", name: "Ana Ruíz  Pérez", relationship: "madre" }],
    });
    assert.equal(lista.length, 1);
    assert.equal(lista[0].titular, true);
  });

  /*
   * El DNI CONFIRMA, pero no VETA (18/09/2026).
   *
   * La primera versión decía lo contrario: dos DNI puestos y distintos eran dos
   * personas aunque se llamaran igual. Al comprobarlo contra las 1.107 familias
   * de Aumenta ya desplegado, esa regla acertaba 0 de 18: en las 18 familias
   * donde pasaba, el titular y el tutor son la MISMA persona con un DNI mal
   * copiado, y la ficha del paciente enseñaba al padre DOS VECES.
   *
   * Dos padres de una misma familia con nombre y apellidos idénticos no
   * existen; un DNI mal tecleado, 18 veces.
   */
  it("mismo nombre y DNI distinto es la MISMA persona", () => {
    const lista = tutoresDeLaFamilia({
      name: "Ana Ruiz",
      taxId: "11111111A",
      guardians: [{ id: "a1", name: "Ana Ruiz", dni: "22222222B", relationship: "madre" }],
    });
    assert.equal(lista.length, 1, "el padre no puede salir dos veces en su propia ficha");
    assert.equal(lista[0].id, "a1", "se queda la entrada real, con su id y su parentesco");
    assert.equal(lista[0].titular, true);
    assert.equal(lista[0].relationship, "madre");
  });

  it("nombres distintos siguen siendo dos personas aunque no haya DNI", () => {
    const lista = tutoresDeLaFamilia({
      name: "Ana Ruiz",
      guardians: [{ id: "a1", name: "Javier Pérez", relationship: "padre" }],
    });
    assert.equal(lista.length, 2);
    assert.equal(lista[0].titular, true);
    assert.equal(lista[0].id, null);
  });

  it("el DNI del titular entra para deduplicar y NO sale", () => {
    const lista = tutoresDeLaFamilia({
      name: "Ana Ruiz",
      taxId: "12345678Z",
      guardians: [{ id: "a1", name: "Otro", dni: "99999999X", relationship: "padre" }],
    });
    for (const t of lista) {
      assert.equal("dni" in t, false);
      assert.equal("signer" in t, false);
    }
  });

  it("una ficha sin nombre no inventa un titular", () => {
    const lista = tutoresDeLaFamilia({ name: "  ", guardians: [{ id: "a1", name: "Javier", relationship: "padre" }] });
    assert.equal(lista.length, 1);
    assert.equal(lista[0].titular, false);
  });

  it("aguanta lo que no es un cliente", () => {
    assert.deepEqual(tutoresDeLaFamilia(null), []);
    assert.deepEqual(tutoresDeLaFamilia({}), []);
    assert.deepEqual(tutoresDeLaFamilia({ guardians: "no es una lista" }), []);
  });
});

describe("fusionarTutoresDeFicha: escribir sin ver el DNI ni quién firma", () => {
  const ACTUALES = [
    { id: "a1", name: "Ana Ruiz", relationship: "madre", dni: "12345678Z", phone: "600", email: "ana@x.es", signer: true },
    { id: "b2", name: "Javier Pérez", relationship: "padre", dni: "87654321X", phone: "611", email: null, signer: false },
  ];

  it("corregir un teléfono NO borra el DNI ni cambia quién firma", () => {
    const { guardians, error } = fusionarTutoresDeFicha(ACTUALES, [
      { id: "a1", name: "Ana Ruiz", relationship: "madre", phone: "699 999 999", email: "ana@x.es" },
      { id: "b2", name: "Javier Pérez", relationship: "padre", phone: "611", email: null },
    ]);
    assert.equal(error, undefined);
    assert.equal(guardians[0].phone, "699 999 999");
    assert.equal(guardians[0].dni, "12345678Z", "el DNI se conserva: la pantalla ni lo enseña");
    assert.equal(guardians[0].signer, true);
    assert.equal(guardians[1].dni, "87654321X");
    assert.equal(guardians[1].signer, false);
  });

  it("un tutor nuevo nace con id, sin DNI y SIN firmar", () => {
    const { guardians } = fusionarTutoresDeFicha(ACTUALES, [
      ...ACTUALES.map((g) => ({ id: g.id, name: g.name, relationship: g.relationship, phone: g.phone, email: g.email })),
      { name: "Abuela Carmen", relationship: "otro", phone: "622", email: "carmen@x.es" },
    ]);
    assert.equal(guardians.length, 3);
    assert.match(guardians[2].id, UUID_RE);
    assert.equal(guardians[2].dni, null);
    assert.equal(guardians[2].signer, false, "dar de alta a alguien no puede cambiar quién firma el contrato");
  });

  it("un DNI o un `signer` que intenten colarse por el cuerpo se ignoran", () => {
    const { guardians } = fusionarTutoresDeFicha(ACTUALES, [
      { id: "a1", name: "Ana Ruiz", relationship: "madre", phone: "600", email: "ana@x.es", dni: "00000000T", signer: false },
      { id: "b2", name: "Javier Pérez", relationship: "padre", phone: "611", email: null, signer: true },
    ]);
    assert.equal(guardians[0].dni, "12345678Z");
    assert.equal(guardians[0].signer, true);
    assert.equal(guardians[1].signer, false);
  });

  it("a un FIRMANTE no se le quita desde la ficha del paciente", () => {
    const { error, guardians } = fusionarTutoresDeFicha(ACTUALES, [
      { id: "b2", name: "Javier Pérez", relationship: "padre", phone: "611", email: null },
    ]);
    assert.equal(guardians, undefined);
    assert.match(error, /Ana Ruiz/);
    assert.match(error, /Clientes/);
  });

  it("a quien NO firma sí se le puede quitar", () => {
    const { guardians, error } = fusionarTutoresDeFicha(ACTUALES, [
      { id: "a1", name: "Ana Ruiz", relationship: "madre", phone: "600", email: "ana@x.es" },
    ]);
    assert.equal(error, undefined);
    assert.equal(guardians.length, 1);
  });

  it("dos tutores con el mismo correo no pueden abrir la misma llave", () => {
    const { error } = fusionarTutoresDeFicha([], [
      { name: "Ana", relationship: "madre", email: "mismo@x.es" },
      { name: "Javier", relationship: "padre", email: "MISMO@x.es" },
    ]);
    assert.match(error, /mismo correo/);
  });

  it("una fila entera en blanco se descarta; una con datos y sin nombre avisa", () => {
    const { guardians } = fusionarTutoresDeFicha([], [
      { name: "", phone: "", email: "" },
      { name: "Ana", relationship: "madre" },
    ]);
    assert.equal(guardians.length, 1);

    const { error } = fusionarTutoresDeFicha([], [{ name: "", phone: "600 000 000" }]);
    assert.match(error, /le falta el nombre/);
  });

  it("un correo con mala pinta se para aquí, que es donde da acceso al portal", () => {
    const { error } = fusionarTutoresDeFicha([], [{ name: "Ana", relationship: "madre", email: "ana(arroba)x" }]);
    assert.match(error, /formato válido/);
  });

  it("respeta el tope y rechaza lo que no es una lista", () => {
    const muchos = Array.from({ length: MAX_TUTORES + 1 }, (_, i) => ({ name: `T${i}`, relationship: "tutor" }));
    assert.match(fusionarTutoresDeFicha([], muchos).error, /máximo/);
    assert.ok(fusionarTutoresDeFicha([], null).error);
  });

  it("el parentesco se acota a la lista cerrada, como al normalizar", () => {
    const { guardians } = fusionarTutoresDeFicha([], [{ name: "Ana", relationship: "abuela" }]);
    assert.equal(guardians[0].relationship, "tutor");
  });
});

/**
 * El domicilio que el tutor escribió al firmar (18/09/2026).
 *
 * `tutorDeclarado` (lib/clients/datosFicha.js) guarda seis datos de quien firma
 * el contrato en el portal: nombre, parentesco, DNI, teléfono, correo Y
 * DOMICILIO. Los cinco primeros sobrevivían a volver a guardar la lista de
 * tutores; el domicilio no, porque `normalizeGuardians` rehace cada tutor clave
 * a clave y esa no estaba. Desaparecía sin aviso y sin vuelta atrás: el contrato
 * firmado guarda su copia, pero de ahí no regresa a la ficha.
 *
 * En producción son 2 tutores de `nutri_laura`, los dos con domicilio puesto y
 * los dos en fichas que se siguen tocando (la última, el 03/09/2026).
 */
describe("el domicilio del tutor sobrevive a que alguien guarde la lista", () => {
  it("normalizeGuardians ya no lo tira: la ficha de la familia devuelve el tutor entero", () => {
    const [g] = normalizeGuardians([
      {
        id: "3f1a2b4c-5d6e-4f70-8a91-b2c3d4e5f607",
        name: "Ana Ruiz",
        relationship: "madre",
        dni: "12345678Z",
        phone: "600",
        email: "ana@x.es",
        domicilio: "C/ Mallorca 210, 3º 2ª",
        signer: true,
      },
    ]);
    assert.equal(g.domicilio, "C/ Mallorca 210, 3º 2ª");
    assert.equal(g.dni, "12345678Z", "y los otros cinco siguen donde estaban");
  });

  it("un tutor sin domicilio lo tiene a null, no a undefined ni a cadena vacía", () => {
    const [sin] = normalizeGuardians([{ name: "Javier", relationship: "padre" }]);
    const [blanco] = normalizeGuardians([{ name: "Javier", relationship: "padre", domicilio: "   " }]);
    assert.equal(sin.domicilio, null);
    assert.equal(blanco.domicilio, null);
  });

  it("fusionarTutoresDeFicha lo hereda, como el DNI: esa pantalla no lo enseña", () => {
    const actuales = [
      { id: "a1", name: "Ana Ruiz", relationship: "madre", dni: "12345678Z", phone: "600", email: "ana@x.es", domicilio: "C/ Mallorca 210", signer: true },
    ];
    const { guardians } = fusionarTutoresDeFicha(actuales, [
      { id: "a1", name: "Ana Ruiz", relationship: "madre", phone: "699 999 999", email: "ana@x.es" },
    ]);
    assert.equal(guardians[0].phone, "699 999 999");
    assert.equal(guardians[0].domicilio, "C/ Mallorca 210");
  });

  it("y no se puede colar uno por el cuerpo: solo lo cambia quien firma", () => {
    const actuales = [{ id: "a1", name: "Ana Ruiz", relationship: "madre", domicilio: "C/ Mallorca 210", signer: false }];
    const { guardians } = fusionarTutoresDeFicha(actuales, [
      { id: "a1", name: "Ana Ruiz", relationship: "madre", domicilio: "Otro sitio 1" },
    ]);
    assert.equal(guardians[0].domicilio, "C/ Mallorca 210");
  });

  it("un tutor nuevo desde la ficha del paciente nace sin domicilio, como nace sin DNI", () => {
    const { guardians } = fusionarTutoresDeFicha([], [{ name: "Abuela Carmen", relationship: "otro", phone: "622" }]);
    assert.equal(guardians[0].domicilio, null);
    assert.equal(guardians[0].dni, null);
  });
});
