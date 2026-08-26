/**
 * _smoke-team-contrasena-elegida.mjs — quien da o restablece un acceso puede
 * escribir la contraseña, y eso no afloja nada (26/08/2026).
 *
 *   node scripts/_smoke-team-contrasena-elegida.mjs
 *
 * @prueba ligera
 *
 * Ejecuta `revisarContrasena` de verdad (es pura) y lee el CÓDIGO de los dos
 * endpoints de acceso. Sin base de datos, sin servidor.
 *
 * ── DE DÓNDE VIENE ─────────────────────────────────────────────────────────
 *
 * Lau, de Aumenta: restablecer una contraseña desde Equipo daba siempre una
 * aleatoria de 12 caracteres. Sobre el papel es lo más seguro; en un centro de
 * 16 personas donde la dirección las restablece por teléfono, `k3Jq_8vTz2Lm` se
 * dicta mal, se copia peor y acaba en un papel encima del monitor. Es la misma
 * conclusión que ya está escrita en lib/auth/contrasena.js: lo que hace fuerte a
 * una contraseña es el LARGO.
 *
 * ── LO QUE ESTA PRUEBA DEFIENDE ────────────────────────────────────────────
 *
 * Abrir esta puerta toca lo más delicado que tiene el CRM, así que lo que se
 * vigila no es que funcione —eso se ve— sino que no se caiga ninguna de las
 * cuatro cosas que la sujetan:
 *
 *   1. Las reglas son LAS MISMAS que las de «cambiar mi contraseña». Una copia
 *      a mano se separaría de la otra sin que nadie se enterase.
 *   2. Se comprueba contra el usuario de QUIEN RECIBE la contraseña, no contra
 *      el de quien la escribe: la que se adivina es la del que la va a usar.
 *   3. Una contraseña ELEGIDA no vuelve por la red ni entra en la auditoría.
 *   4. Las guardas de siempre siguen enteras: solo dirección, nunca cuentas de
 *      administrador, nunca uno mismo, nunca en la demo, y bcrypt 12.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { revisarContrasena, MINIMO } from "../lib/auth/contrasena.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel) => {
  const abs = path.join(RAIZ, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
};

const REL_RESET = "app/api/team/[id]/access/password/route.js";
const REL_ALTA = "app/api/team/[id]/access/route.js";
const REL_UI = "components/team/AccessSection.jsx";
const reset = leer(REL_RESET);
const alta = leer(REL_ALTA);
const ui = leer(REL_UI);

test("los tres ficheros siguen donde estaban", () => {
  for (const [rel, txt] of [[REL_RESET, reset], [REL_ALTA, alta], [REL_UI, ui]]) {
    assert.ok(txt !== null, `no existe ${rel}: si se movió, hay que actualizar esta prueba`);
  }
});

// ── 1. Las mismas reglas que «cambiar mi contraseña» ───────────────────────

test("los dos endpoints validan con la regla compartida, no con una copia", () => {
  for (const [rel, txt] of [[REL_RESET, reset], [REL_ALTA, alta]]) {
    assert.ok(
      /import \{ revisarContrasena \} from ".*auth\/contrasena\.js"/.test(txt),
      `${rel} no importa revisarContrasena: si valida a mano, sus reglas se separarán de las de /api/auth/password`
    );
    assert.ok(
      txt.includes("revisarContrasena(escrita, null, {"),
      `${rel} ya no llama a revisarContrasena sobre lo que se escribió`
    );
  }
});

test("se comprueba contra el usuario de QUIEN RECIBE la contraseña", () => {
  // En el reset, el del miembro gestionado; en el alta, el que se está creando.
  assert.ok(
    reset.includes("email: managed.user.email"),
    "el reset comprueba contra otro correo: la contraseña adivinable es la del que la va a usar"
  );
  assert.ok(
    alta.includes("email: username"),
    "el alta comprueba contra otro correo que no es el del usuario que crea"
  );
  for (const [rel, txt] of [[REL_RESET, reset], [REL_ALTA, alta]]) {
    assert.ok(txt.includes("slug: ctx.slug"), `${rel} no pasa el slug: dejaría pasar el nombre del centro`);
  }
});

// ── 2. Una elegida no vuelve, ni por la red ni en la auditoría ─────────────

test("la contraseña elegida NO se devuelve", () => {
  assert.ok(
    reset.includes("password: elegida ? null : password"),
    "el reset devuelve la contraseña elegida: quien la escribió ya la tiene, devolverla solo la pasea otra vez"
  );
  assert.ok(
    alta.includes("password: elegida ? null : password"),
    "el alta devuelve la contraseña elegida"
  );
});

test("la auditoría guarda si fue elegida, nunca la contraseña", () => {
  for (const [rel, txt] of [[REL_RESET, reset], [REL_ALTA, alta]]) {
    const i = txt.indexOf("after: {");
    assert.ok(i > 0, `${rel}: no encuentro el resumen de auditoría`);
    const resumen = txt.slice(i, txt.indexOf("}", i) + 1);
    assert.ok(resumen.includes("elegida"), `${rel}: la auditoría no dice si se escribió a mano o se generó`);
    assert.ok(
      !/\bpassword\b/.test(resumen) && !/\bescrita\b/.test(resumen) && !/passwordHash/.test(resumen),
      `${rel}: la contraseña se ha colado en el resumen de auditoría (${resumen})`
    );
  }
});

// ── 3. Las guardas de siempre ──────────────────────────────────────────────

test("sigue siendo cosa de dirección, y nunca en la demo", () => {
  for (const [rel, txt] of [[REL_RESET, reset], [REL_ALTA, alta]]) {
    assert.ok(txt.includes("ADMIN_ROLES.has(ctx.user?.role)"), `${rel}: se ha caído el freno de rol`);
    assert.ok(txt.includes("isDemoTenant(ctx)"), `${rel}: la demo pública da sesión de admin a cualquiera`);
    assert.ok(txt.includes('hasModule("team")'), `${rel}: se ha caído el gate del módulo`);
    assert.ok(txt.includes("loadManagedUser"), `${rel}: sin loadManagedUser se puede tocar una cuenta de admin, o la propia`);
    assert.ok(txt.includes("bcrypt.hash(password, 12)"), `${rel}: bcrypt tiene que seguir en 12 rondas`);
  }
});

test("restablecer sigue tumbando las sesiones vivas", () => {
  assert.ok(
    /tokenVersion: \(user\.tokenVersion \?\? 0\) \+ 1/.test(reset),
    "sin subir tokenVersion, quien tuviera sesión abierta seguiría dentro con la contraseña vieja"
  );
});

test("un cuerpo vacío sigue generando una, como toda la vida", () => {
  assert.ok(
    reset.includes("await request.json().catch(() => ({}))"),
    "el reset revienta si le llega el cuerpo vacío del botón de siempre"
  );
  for (const [rel, txt] of [[REL_RESET, reset], [REL_ALTA, alta]]) {
    assert.ok(txt.includes("elegida ? escrita : generatePassword()"), `${rel}: sin escribir nada ya no se genera`);
  }
});

// ── 4. Lo que la pantalla promete tiene que ser lo que el servidor exige ───

test("la pantalla no se inventa la contraseña que enseña", () => {
  assert.ok(
    ui.includes("password: j.data.password ?? nuevaPass"),
    "la pantalla espera que el servidor le devuelva la elegida, y no lo hace: saldría vacía"
  );
  assert.ok(
    ui.includes('body: JSON.stringify({ password: nuevaPass })'),
    "el reset de la pantalla ya no manda lo que se escribió"
  );
});

test("la pantalla dice el mismo mínimo que exige el servidor", () => {
  assert.ok(
    ui.includes(`al menos ${MINIMO} caracteres`),
    `la ayuda de la pantalla no dice «al menos ${MINIMO} caracteres»: si el número se separa, el servidor rechaza lo que la pantalla acaba de prometer`
  );
});

// ── 5. La regla en sí, sobre el caso de Aumenta ────────────────────────────

test("rechaza lo que se adivina de una cuenta de Aumenta", () => {
  const contexto = { email: "elena_aumenta", slug: "aumenta" };
  for (const mala of ["aumenta2026", "Aumenta-2026", "elena_aumenta", "1234567890", "qwertyuiop", "aaaaaaaaaa"]) {
    assert.ok(revisarContrasena(mala, null, contexto), `deja pasar «${mala}»`);
  }
});

test("acepta una frase corta que una persona pueda recordar", () => {
  const contexto = { email: "elena_aumenta", slug: "aumenta" };
  for (const buena of ["el gato gris", "martes de lluvia", "tres cafes solos"]) {
    assert.equal(revisarContrasena(buena, null, contexto), null, `rechaza «${buena}»`);
  }
});

test("nueve caracteres no valen, diez sí", () => {
  const contexto = { email: "elena_aumenta", slug: "aumenta" };
  assert.ok(revisarContrasena("abcdefghi".slice(0, MINIMO - 1), null, contexto));
  assert.equal(revisarContrasena("perro verde", null, contexto), null);
});
