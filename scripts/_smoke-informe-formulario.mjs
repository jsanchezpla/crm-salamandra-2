/**
 * _smoke-informe-formulario.mjs — el modal de «Nuevo informe» no puede leer un
 * campo que su formulario vacío no tenga (26/08/2026).
 *
 *   node scripts/_smoke-informe-formulario.mjs
 *
 * @prueba ligera
 *
 * Lee el CÓDIGO de la ficha del paciente. Sin base de datos, sin servidor.
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * El 31/07/2026 el formulario del informe evolutivo pasó de dos campos a cuatro
 * (se añadió elegir en qué sesiones se basa). El estado inicial se actualizó; los
 * dos sitios que lo REINICIAN —el botón «Nuevo informe» de la cabecera y el
 * «después de crear»— se quedaron con la copia vieja de dos campos.
 *
 * Al abrir el modal, React leía `reportForm.sourceSessionIds.length` sobre un
 * `undefined` y reventaba EN MITAD DEL PINTADO. Como no hay ningún `error.jsx` en
 * la aplicación, el golpe sube hasta la raíz y Next tapa la página entera con su
 * cartel de fábrica: «This page couldn't load». No es que fallara el modal: se
 * perdía la ficha que estabas mirando.
 *
 * Estuvo así 26 días, desplegado. En ese tiempo Aumenta creó CERO informes
 * clínicos con 22.045 sesiones registradas: nadie consiguió abrir el modal nunca.
 *
 * ── QUÉ COMPRUEBA, Y POR QUÉ ASÍ ───────────────────────────────────────────
 *
 * Lo que importa no es que haya una constante: es la INVARIANTE. Todo campo que
 * la pantalla LEE de `reportForm` tiene que existir en el formulario vacío. La
 * prueba saca los dos conjuntos del propio código y los compara, así que atrapa
 * también el caso de mañana —alguien añade un quinto campo y lo lee sin ponerlo
 * en la constante— y no solo el de ayer.
 *
 * Se lee el texto porque es un componente de cliente con JSX: importarlo desde
 * Node pediría un compilador. Es tosco, pero atrapa exactamente esta clase de
 * fallo y cuesta 20 ms.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REL = "app/(dashboard)/pacientes/[id]/page.jsx";
const ABS = path.join(RAIZ, REL);

const fuente = fs.existsSync(ABS) ? fs.readFileSync(ABS, "utf8") : null;

test("la ficha del paciente sigue donde estaba", () => {
  assert.ok(fuente !== null, `no existe ${REL}: si se movió, hay que actualizar esta prueba`);
});

/** Las claves del formulario vacío, sacadas del propio código. */
function camposDelVacio(texto) {
  const m = texto.match(/const informeVacio = \(\) => \(\{([\s\S]*?)\}\);/);
  assert.ok(m, "no encuentro `const informeVacio = () => ({ … });`: el formulario vacío se ha vuelto a repartir por el fichero");
  return new Set([...m[1].matchAll(/([A-Za-z_$][\w$]*)\s*:/g)].map((x) => x[1]));
}

/** Los campos que la pantalla LEE de reportForm. */
function camposLeidos(texto) {
  return new Set([...texto.matchAll(/reportForm\.([A-Za-z_$][\w$]*)/g)].map((x) => x[1]));
}

test("todo campo que se lee existe en el formulario vacío", () => {
  const vacio = camposDelVacio(fuente);
  const leidos = camposLeidos(fuente);
  assert.ok(leidos.size > 0, "no se lee ni un campo de reportForm: ¿se ha renombrado el estado?");
  const huerfanos = [...leidos].filter((c) => !vacio.has(c));
  assert.deepEqual(
    huerfanos,
    [],
    `la pantalla lee ${huerfanos.join(", ")} y el formulario vacío no lo trae: al abrir el modal ` +
      "se cae la ficha entera con «This page couldn't load»"
  );
});

test("los cuatro campos de julio siguen ahí", () => {
  const vacio = camposDelVacio(fuente);
  for (const campo of ["reportType", "dueDate", "sourceSessionIds", "referralSpecialty"]) {
    assert.ok(vacio.has(campo), `falta ${campo} en el formulario vacío`);
  }
});

test("nadie reinicia el formulario con un objeto a mano", () => {
  // Un reinicio es `setReportForm({ … })` con literal; lo legítimo es
  // `setReportForm(informeVacio())` o un updater `(f) => ({ ...f, … })`.
  const literales = [...fuente.matchAll(/setReportForm\(\s*\{/g)].length;
  assert.equal(
    literales,
    0,
    "hay un setReportForm({…}) con objeto a mano: es exactamente lo que rompió la ficha 26 días. " +
      "Reiniciar es informeVacio(); cambiar un campo es setReportForm((f) => ({ ...f, campo: v }))"
  );
});

test("el estado inicial sale de la misma función", () => {
  assert.ok(
    fuente.includes("useState(informeVacio())"),
    "el estado inicial ya no usa informeVacio(): vuelve a haber dos verdades sobre qué campos tiene el formulario"
  );
});

test("informeVacio devuelve una copia nueva cada vez", () => {
  // sourceSessionIds es un array que el modal muta. Un objeto suelto compartido
  // arrastraría la selección de sesiones de un informe al siguiente.
  assert.ok(
    /const informeVacio = \(\) =>/.test(fuente),
    "informeVacio ha dejado de ser una función: comparte el array sourceSessionIds entre informes"
  );
});
