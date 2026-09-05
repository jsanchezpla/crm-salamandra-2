// @prueba ligera — función pura de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-tutores-ficha-paciente.mjs — lo que la ficha del PACIENTE ve de los
 * padres y tutores de su familia (02/09/2026, AV-0023 y AV-0024 de Aumenta).
 *
 *   node scripts/_smoke-tutores-ficha-paciente.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * «En el CRM solo aparece un cliente por paciente y desaparecen el resto de
 * datos» (Aumenta, 02/09/2026). Los tutores estaban —1.846 en producción—,
 * pero solo en la ficha de la familia, a la que las terapeutas no entran. La
 * ficha del paciente pasa a enseñarlos a todo el equipo, y por eso lo que
 * viaja va RECORTADO: esta prueba fija qué sale (nombre, parentesco, teléfono,
 * correo) y, sobre todo, qué NO sale (DNI, quién firma). Si alguien añade un
 * campo a `guardians` mañana, no se cuela aquí sin decidirlo.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tutoresParaFicha, GUARDIAN_RELATIONSHIP_LABEL } from "../lib/clients/guardians.js";

describe("tutoresParaFicha", () => {
  it("devuelve nombre, parentesco, teléfono y correo, y NADA más", () => {
    const [t] = tutoresParaFicha([
      { id: "a1", name: "  Marta Pérez ", relationship: "madre", dni: "12345678A", phone: "600 000 000", email: "marta@x.es", signer: true },
    ]);
    assert.deepEqual(t, {
      id: "a1",
      name: "Marta Pérez",
      relationship: "madre",
      relationshipLabel: "Madre",
      phone: "600 000 000",
      email: "marta@x.es",
    });
    assert.equal("dni" in t, false);
    assert.equal("signer" in t, false);
  });

  it("resuelve la etiqueta del parentesco con la misma tabla que la ficha de la familia", () => {
    const lista = tutoresParaFicha([
      { name: "A", relationship: "padre" },
      { name: "B", relationship: "tutor" },
      { name: "C", relationship: "otro" },
      { name: "D", relationship: "abuela" }, // desconocido → tutor, como al normalizar
    ]);
    assert.deepEqual(
      lista.map((t) => [t.relationship, t.relationshipLabel]),
      [
        ["padre", GUARDIAN_RELATIONSHIP_LABEL.padre],
        ["tutor", GUARDIAN_RELATIONSHIP_LABEL.tutor],
        ["otro", GUARDIAN_RELATIONSHIP_LABEL.otro],
        ["tutor", GUARDIAN_RELATIONSHIP_LABEL.tutor],
      ]
    );
  });

  it("sin teléfono ni correo salen a null, no a cadena vacía", () => {
    const [t] = tutoresParaFicha([{ name: "Solo nombre", relationship: "madre", phone: "", email: "   " }]);
    assert.equal(t.phone, null);
    assert.equal(t.email, null);
  });

  it("descarta lo que no es un tutor: sin nombre, basura, o una lista que no es lista", () => {
    assert.deepEqual(tutoresParaFicha([{ name: "", phone: "600" }, null, "texto", 7]), []);
    assert.deepEqual(tutoresParaFicha(null), []);
    assert.deepEqual(tutoresParaFicha("no"), []);
    assert.deepEqual(tutoresParaFicha({ name: "objeto suelto" }), []);
  });

  it("conserva el orden y los dos progenitores de una familia con padres separados", () => {
    const lista = tutoresParaFicha([
      { id: "m", name: "Madre", relationship: "madre", phone: "611" },
      { id: "p", name: "Padre", relationship: "padre", phone: "622" },
    ]);
    assert.deepEqual(
      lista.map((t) => t.id),
      ["m", "p"]
    );
  });
});

/*
 * Y QUE LLEGUE A QUIEN LO PIDIÓ (05/09/2026, vuelta de AV-0023).
 *
 * El bloque se entregó el 02/09 y Isabel volvió el 04: «yo no visualizo el
 * apartado que mencionas de padres y tutores». Tenía razón. El include del
 * pagador gateaba con `hasModule("clients")`, que es del USUARIO, y en Aumenta
 * 14 de los 19 usuarios —las terapeutas— no tienen `clients` en su
 * `moduleAccess`: sin include no viaja `client`, y la ficha esconde el bloque.
 * Estaba cerrado con llave justo para quien lo había pedido, y dirección
 * (comodín) lo veía, así que parecía entregado.
 *
 * Se fija por texto, que es lo que es: qué variante de `hasModule` gatea el
 * include. Si alguien la devuelve a la del usuario, esto lo dice.
 */
describe("el include del pagador mira al CENTRO, no al usuario", () => {
  const RUTA = readFileSync(new URL("../app/api/pacientes/[id]/route.js", import.meta.url), "utf8");

  it("`payerInclude` gatea con `tenantHasModule`", () => {
    assert.match(RUTA, /function payerInclude\(\{ Client, ClientContactMethod \}, tenantHasModule\)/);
    assert.match(RUTA, /if \(!tenantHasModule\("clients"\) \|\| !Client\) return \[\]/);
  });

  it("ninguna carga de la ficha usa el `hasModule` del usuario para el pagador", () => {
    assert.ok(!/loadPatient\(ctx\.tenantModels, id, ctx\.hasModule\)/.test(RUTA),
      "una terapeuta sin el módulo Clientes volvería a quedarse sin padres y tutores");
    assert.match(RUTA, /loadPatient\(ctx\.tenantModels, id, ctx\.tenantHasModule\)/);
  });

  it("entrar en la ficha sigue exigiendo Clínica o Pacientes", () => {
    assert.match(RUTA, /return ctx\.hasModule\("clinica"\) \|\| ctx\.hasModule\("pacientes"\)/,
      "el gate de la pantalla sí es del usuario: esto no abre la ficha a nadie nuevo");
  });
});
