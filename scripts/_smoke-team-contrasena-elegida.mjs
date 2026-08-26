/**
 * _smoke-team-contrasena-elegida.mjs — la contraseña de un acceso la escribe
 * SIEMPRE quien lo da, y eso no afloja nada (26/08/2026).
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
 * Lau, de Aumenta: dar de alta un acceso o restablecer una contraseña desde
 * Equipo daba siempre una aleatoria de 12 caracteres. Sobre el papel es lo más
 * seguro; en un centro de 16 personas donde la dirección las reparte por
 * teléfono, `k3Jq_8vTz2Lm` se dicta mal, se copia peor y acaba en un papel
 * encima del monitor. Es la misma conclusión que ya estaba escrita en
 * lib/auth/contrasena.js: lo que hace fuerte a una contraseña es el LARGO.
 *
 * Primero se dejó OPCIONAL —vacío = te genero una— y duró unas horas: Jorge lo
 * cerró el mismo día. Una opción que casi nadie va a querer sigue costando una
 * decisión cada vez, y la que se elige por inercia era justo la aleatoria que
 * nadie puede recordar. **Ahora es obligatoria y no hay generador.**
 *
 * ── LO QUE ESTA PRUEBA DEFIENDE ────────────────────────────────────────────
 *
 * Dejar que una persona escriba la contraseña de otra toca lo más delicado que
 * tiene el CRM, así que lo que se vigila no es que funcione —eso se ve— sino
 * que no se caiga ninguna de las cinco cosas que la sujetan:
 *
 *   1. No vuelve el generador por la puerta de atrás: sin contraseña se
 *      RECHAZA, nunca se inventa una.
 *   2. Las reglas son LAS MISMAS que las de «cambiar mi contraseña». Una copia
 *      a mano se separaría de la otra sin que nadie se enterase.
 *   3. Se comprueba contra el usuario de QUIEN RECIBE la contraseña, no contra
 *      el de quien la escribe: la que se adivina es la del que la va a usar.
 *   4. La contraseña no vuelve por la red ni entra en la auditoría.
 *   5. Las guardas de siempre siguen enteras: solo dirección, nunca cuentas de
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
const LOS_DOS = [[REL_RESET, reset], [REL_ALTA, alta]];

test("los tres ficheros siguen donde estaban", () => {
  for (const [rel, txt] of [...LOS_DOS, [REL_UI, ui]]) {
    assert.ok(txt !== null, `no existe ${rel}: si se movió, hay que actualizar esta prueba`);
  }
});

// ── 1. No hay generador, y no puede volver por descuido ────────────────────

test("ninguno de los dos endpoints genera una contraseña", () => {
  for (const [rel, txt] of LOS_DOS) {
    assert.ok(
      !txt.includes("generatePassword"),
      `${rel} vuelve a generar contraseñas: la decisión de hoy es que las escriba siempre una persona`
    );
  }
});

test("sin contraseña se RECHAZA, no se inventa una", () => {
  for (const [rel, txt] of LOS_DOS) {
    // El valor por defecto es la cadena vacía y va derecho a revisarContrasena,
    // que devuelve «Escribe la contraseña nueva.».
    assert.ok(
      /const password = typeof body\??\.password === "string" \? body\??\.password : "";/.test(txt),
      `${rel}: la contraseña ya no sale del cuerpo con "" por defecto, así que no se sabe qué pasa si falta`
    );
    assert.ok(
      /const mal = revisarContrasena\(password, null, \{/.test(txt),
      `${rel}: la validación ya no es incondicional; si vuelve un \`if\`, un cuerpo vacío se colaría`
    );
    assert.ok(/if \(mal\) return error\(mal/.test(txt), `${rel}: ya no se corta cuando la contraseña está mal`);
  }
  assert.equal(revisarContrasena(""), "Escribe la contraseña nueva.");
});

// ── 2. Las mismas reglas que «cambiar mi contraseña» ───────────────────────

test("los dos validan con la regla compartida, no con una copia", () => {
  for (const [rel, txt] of LOS_DOS) {
    assert.ok(
      /import \{ revisarContrasena \} from ".*auth\/contrasena\.js"/.test(txt),
      `${rel} no importa revisarContrasena: si valida a mano, sus reglas se separarán de las de /api/auth/password`
    );
  }
});

// ── 3. Contra el usuario de quien la recibe ────────────────────────────────

test("se comprueba contra el usuario de QUIEN RECIBE la contraseña", () => {
  assert.ok(
    reset.includes("email: managed.user.email"),
    "el reset comprueba contra otro correo: la contraseña adivinable es la del que la va a usar"
  );
  assert.ok(alta.includes("email: username"), "el alta comprueba contra un correo que no es el del usuario que crea");
  for (const [rel, txt] of LOS_DOS) {
    assert.ok(txt.includes("slug: ctx.slug"), `${rel} no pasa el slug: dejaría pasar el nombre del centro`);
  }
});

// ── 4. Ni por la red ni en la auditoría ────────────────────────────────────

test("la respuesta NO lleva la contraseña", () => {
  assert.ok(
    /return ok\(\{ username: user\.email \}\);/.test(reset),
    "el reset ha vuelto a devolver algo más que el usuario: la contraseña no tiene por qué viajar de vuelta"
  );
  assert.ok(
    /return created\(\{ username, modules \}\);/.test(alta),
    "el alta ha vuelto a devolver la contraseña"
  );
});

test("la auditoría no guarda la contraseña", () => {
  for (const [rel, txt] of LOS_DOS) {
    const i = txt.indexOf("after: {");
    assert.ok(i > 0, `${rel}: no encuentro el resumen de auditoría`);
    const resumen = txt.slice(i, txt.indexOf("}", i) + 1);
    assert.ok(
      !/\bpassword\b/.test(resumen) && !/passwordHash/.test(resumen),
      `${rel}: la contraseña se ha colado en el resumen de auditoría (${resumen})`
    );
  }
});

// ── 5. Las guardas de siempre ──────────────────────────────────────────────

test("sigue siendo cosa de dirección, y nunca en la demo", () => {
  for (const [rel, txt] of LOS_DOS) {
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

test("el alta valida ANTES de crear el usuario", () => {
  // Si se validara después, un rechazo dejaría un login a medias en master.
  const iValida = alta.indexOf("const mal = revisarContrasena");
  const iCrea = alta.indexOf("await User.create(");
  assert.ok(iValida > 0 && iCrea > 0, "no encuentro la validación o el alta del usuario");
  assert.ok(iValida < iCrea, "la contraseña se valida DESPUÉS de crear el usuario: un rechazo dejaría un login huérfano");
});

// ── 6. La pantalla promete lo mismo que el servidor exige ─────────────────

test("la pantalla no deja mandar el formulario sin contraseña", () => {
  assert.ok(
    ui.includes("disabled={busy || !nuevaPass}"),
    "el botón de restablecer se puede pulsar sin escribir contraseña: el servidor lo rechazaría con un error feo"
  );
  assert.ok(
    ui.includes("disabled={busy || !username.trim() || !nuevaPass}"),
    "el botón de crear usuario se puede pulsar sin contraseña"
  );
});

/**
 * El fichero SIN comentarios.
 *
 * Hace falta porque la cabecera de `AccessSection.jsx` cuenta la historia —«se
 * probó dejarlo opcional y duró unas horas»— y una búsqueda a pelo por
 * «opcional» la caza a ella en vez de a un texto de pantalla. Es el mismo
 * tropiezo del 25/08 con la prueba del buscador de citas: una regex sobre el
 * código fuente no distingue de quién es la palabra que está viendo.
 */
const sinComentarios = (txt) =>
  txt
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");

test("la pantalla ya no ofrece generar una", () => {
  const visible = sinComentarios(ui);
  for (const frase of ["Generar una", "déjalo vacío", "Déjalo vacío", "opcional"]) {
    assert.ok(!visible.includes(frase), `la pantalla sigue ofreciendo generar («${frase}»)`);
  }
});

test("la pantalla enseña la que se ha tecleado, no la que devuelve el servidor", () => {
  assert.ok(
    !ui.includes("j.data.password"),
    "la pantalla espera una contraseña del servidor, y el servidor ya no la manda: saldría vacía"
  );
  assert.ok(ui.includes("password: nuevaPass"), "la pantalla ya no enseña lo que se tecleó");
});

test("la pantalla dice el mismo mínimo que exige el servidor", () => {
  assert.ok(
    ui.includes(`Al menos ${MINIMO} caracteres`),
    `la ayuda no dice «Al menos ${MINIMO} caracteres»: si el número se separa, el servidor rechaza lo que la pantalla prometió`
  );
});

// ── 7. La regla en sí, sobre el caso de Aumenta ────────────────────────────

test("rechaza lo que se adivina de una cuenta de Aumenta", () => {
  const contexto = { email: "elena_aumenta", slug: "aumenta" };
  for (const mala of ["", "aumenta2026", "Aumenta-2026", "elena_aumenta", "1234567890", "qwertyuiop", "aaaaaaaaaa"]) {
    assert.ok(revisarContrasena(mala, null, contexto), `deja pasar «${mala}»`);
  }
});

test("acepta una frase corta que una persona pueda recordar", () => {
  const contexto = { email: "elena_aumenta", slug: "aumenta" };
  for (const buena of ["el gato gris", "martes de lluvia", "tres cafes solos"]) {
    assert.equal(revisarContrasena(buena, null, contexto), null, `rechaza «${buena}»`);
  }
});
