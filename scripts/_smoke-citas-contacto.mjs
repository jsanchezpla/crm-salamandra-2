// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-citas-contacto.mjs — qué contacto necesita una cita (28/08/2026).
 *
 *   node scripts/_smoke-citas-contacto.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * El alta manual exigía correo Y teléfono siempre, y de los 1.050 pacientes
 * activos de Aumenta **164 no se podían citar**: su familia no tiene ninguno de
 * los dos en ningún sitio del CRM. Ese dato no existe y ningún código lo
 * inventa.
 *
 * Se relaja, avisando. Y la regla se recoge en UN fichero porque estaba escrita
 * cuatro veces —pantalla, POST, PATCH y reserva pública— y ya divergían: la
 * pantalla era más dura que el servidor, y por eso la excepción de la consulta
 * externa que el servidor tenía era inalcanzable.
 *
 * ── QUÉ VIGILA ─────────────────────────────────────────────────────────────
 *
 * Lo que DEVUELVE la función, no cómo está escrita. Sobre todo dos cosas que se
 * rompen sin que nadie se entere:
 *
 *   · que `seVaAPerder` no se quede vacío cuando falta algo — un aviso sin
 *     contenido es peor que ningún aviso, porque parece que no se pierde nada;
 *   · que una cadena de espacios cuente como vacía, que es lo que de verdad
 *     llega desde un formulario.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { repasarContactoDeCita, avisoDeContacto } from "../lib/citas/contactoCita.js";

const COMPLETO = { clientEmail: "familia@example.com", clientPhone: "+34 600 000 000" };

describe("repasar el contacto de una cita", () => {
  test("con los dos datos, no falta nada", () => {
    const r = repasarContactoDeCita(COMPLETO);
    assert.equal(r.completo, true);
    assert.deepEqual(r.falta, []);
    assert.deepEqual(r.seVaAPerder, []);
  });

  test("sin correo: lo dice, y dice qué se pierde", () => {
    const r = repasarContactoDeCita({ ...COMPLETO, clientEmail: "" });
    assert.equal(r.completo, false);
    assert.deepEqual(r.falta, ["correo"]);
    assert.ok(r.seVaAPerder.length > 0, "un aviso sin contenido no avisa de nada");
    assert.ok(r.seVaAPerder.some((p) => /recordatorio/i.test(p)));
    assert.ok(r.seVaAPerder.some((p) => /cancelar/i.test(p)));
  });

  test("sin teléfono: lo dice, y no se inventa las pérdidas del correo", () => {
    const r = repasarContactoDeCita({ ...COMPLETO, clientPhone: null });
    assert.deepEqual(r.falta, ["telefono"]);
    assert.ok(!r.seVaAPerder.some((p) => /recordatorio/i.test(p)), "eso se pierde por el correo, no por el teléfono");
  });

  test("sin ninguno de los dos: se acumulan (el caso de los 164)", () => {
    const r = repasarContactoDeCita({ clientEmail: "", clientPhone: "" });
    assert.deepEqual(r.falta, ["correo", "telefono"]);
    assert.ok(r.seVaAPerder.length >= 2);
  });

  test("una cadena de espacios NO cuenta como dato", () => {
    // Es lo que llega de un formulario cuando alguien pulsa la barra espaciadora
    // para «rellenar» un campo obligatorio.
    const r = repasarContactoDeCita({ clientEmail: "   ", clientPhone: "\t " });
    assert.deepEqual(r.falta, ["correo", "telefono"]);
  });

  test("no revienta con basura ni con nada", () => {
    for (const entrada of [undefined, null, {}, { clientEmail: undefined }]) {
      const r = repasarContactoDeCita(entrada);
      assert.equal(r.completo, false);
      assert.equal(Array.isArray(r.falta), true);
    }
  });
});

describe("el aviso que se le enseña a quien apunta la cita", () => {
  test("si no falta nada, no hay aviso", () => {
    assert.equal(avisoDeContacto(repasarContactoDeCita(COMPLETO)), null);
    assert.equal(avisoDeContacto(null), null);
  });

  test("nombra lo que falta y enumera lo que se pierde", () => {
    const aviso = avisoDeContacto(repasarContactoDeCita({ clientEmail: "", clientPhone: "" }));
    assert.match(aviso.titulo, /correo/);
    assert.match(aviso.titulo, /teléfono/);
    // Cada pérdida, en su línea: si se juntaran en un párrafo nadie las lee.
    assert.ok(aviso.texto.split("\n").filter((l) => l.startsWith("·")).length >= 2);
    assert.match(aviso.texto, /avisarle tú/i, "tiene que quedar claro de quién es el marrón");
    assert.ok(aviso.confirmar, "sin texto de botón, el modal no se puede confirmar");
  });

  test("con un solo hueco no habla en plural de los dos", () => {
    const aviso = avisoDeContacto(repasarContactoDeCita({ ...COMPLETO, clientEmail: "" }));
    assert.match(aviso.titulo, /correo/);
    assert.ok(!/teléfono/.test(aviso.titulo), "solo falta el correo");
  });
});
