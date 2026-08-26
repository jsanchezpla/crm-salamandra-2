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
import { revisarContrasena, requisitosDe, cumpleTodo, MINIMO } from "../lib/auth/contrasena.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel) => {
  const abs = path.join(RAIZ, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
};

const REL_RESET = "app/api/team/[id]/access/password/route.js";
const REL_ALTA = "app/api/team/[id]/access/route.js";
const REL_UI = "components/team/AccessSection.jsx";
/**
 * ⚠️ LA SEGUNDA PANTALLA, LA QUE SE OLVIDÓ.
 *
 * `POST /api/team/[id]/access` lo llaman DOS sitios: la sección «Acceso al CRM»
 * de la ficha y —esta— el alta de empleado con la casilla «crear acceso». El
 * 26/08/2026 se hizo obligatoria la contraseña y solo se actualizó la primera:
 * la segunda siguió mandando `{ username, modules }` y el alta con acceso
 * empezó a devolver 422 en producción. Lo encontró una investigación del
 * borrado, no una prueba, que es justo lo que esta constante viene a arreglar.
 */
const REL_DRAWER = "app/(dashboard)/equipo/page.jsx";
const reset = leer(REL_RESET);
const alta = leer(REL_ALTA);
const ui = leer(REL_UI);
const drawer = leer(REL_DRAWER);
const LOS_DOS = [[REL_RESET, reset], [REL_ALTA, alta]];
/** Las DOS pantallas que piden una contraseña para un acceso. */
const LAS_PANTALLAS = [[REL_UI, ui], [REL_DRAWER, drawer]];

test("los cuatro ficheros siguen donde estaban", () => {
  for (const [rel, txt] of [...LOS_DOS, ...LAS_PANTALLAS]) {
    assert.ok(txt !== null, `no existe ${rel}: si se movió, hay que actualizar esta prueba`);
  }
});

test("TODO el que llame al alta de acceso manda la contraseña", () => {
  /*
   * La invariante que faltaba el 26/08/2026 y que costó un 422 en producción:
   * no basta con que la ficha esté bien, tienen que estarlo TODOS los sitios
   * que llaman al endpoint. Se busca la llamada por su ruta y se exige que el
   * cuerpo lleve `password`.
   */
  for (const [rel, txt] of LAS_PANTALLAS) {
    /*
     * Se busca cada `body: JSON.stringify(...)` y se mira HACIA ATRÁS quién lo
     * manda. Hacen falta las dos condiciones o salen falsos positivos: la misma
     * ruta `/access` la usan también el PATCH de módulos (cuerpo sin
     * contraseña, y está bien así) y el DELETE. Y el cuerpo se lee hasta el fin
     * de línea, no hasta el primer `)`, porque lleva llamadas dentro
     * (`enabledKeys()`).
     */
    const altas = [];
    for (const m of txt.matchAll(/body: JSON\.stringify\(([^\n]*)/g)) {
      const antes = txt.slice(Math.max(0, m.index - 320), m.index);
      const esAlta = /\/access`/.test(antes) && !/\/access\/password`/.test(antes) && /"POST"/.test(antes);
      if (esAlta) altas.push(m[1]);
    }
    assert.ok(altas.length > 0, `${rel}: no encuentro la llamada a POST /api/team/[id]/access`);
    for (const cuerpo of altas) {
      assert.ok(
        /password/.test(cuerpo),
        `${rel} llama al alta de acceso SIN contraseña: el servidor la exige desde el 26/08 y devuelve 422 (${cuerpo.trim()})`
      );
    }
  }
});

test("y ninguna de las dos espera que el servidor se la devuelva", () => {
  for (const [rel, txt] of LAS_PANTALLAS) {
    assert.ok(
      !/data\.password/.test(txt),
      `${rel} lee la contraseña de la respuesta, y el servidor ya no la manda: saldría vacía en el modal`
    );
  }
});

test("las dos pantallas pintan los MISMOS requisitos", () => {
  for (const [rel, txt] of LAS_PANTALLAS) {
    assert.ok(
      /<Requisitos /.test(txt),
      `${rel} no pinta los requisitos: quien la escriba no sabrá qué poner hasta fallar`
    );
    assert.ok(
      /cumpleTodo\(/.test(txt),
      `${rel} no usa cumpleTodo: podría dejar mandar algo que el servidor rechaza`
    );
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
  /*
   * Lo que importa es QUÉ campos vuelven, no la lista exacta: el 26/08/2026
   * las dos respuestas ganaron un `correo` legítimo y la comparación literal
   * las dio por rotas cuando no lo estaban. Se mira lo que de verdad no puede
   * estar ahí.
   */
  const PROHIBIDOS = /password|contrase|nuevaPass|passwordHash|\bclave\b/i;
  for (const [rel, txt, patron] of [
    ["password/route.js", reset, /return ok\(\{([^}]*)\}\);/],
    ["access/route.js", alta, /return created\(\{([^}]*)\}\);/],
  ]) {
    const m = patron.exec(txt);
    assert.ok(m, `${rel}: no encuentro qué devuelve el endpoint`);
    assert.ok(
      !PROHIBIDOS.test(m[1]),
      `${rel}: la contraseña ha vuelto a viajar de vuelta por la red (devuelve: ${m[1].trim()})`
    );
  }
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

test("la pantalla no deja mandar el formulario hasta que la contraseña vale", () => {
  // No es «hay algo escrito»: es la MISMA función que decide en el servidor,
  // así que el botón no puede encenderse con algo que va a devolver un 422.
  /*
   * Se miran las condiciones de los botones, no su texto exacto: el 26/08/2026
   * el de crear ganó un `!pareceCorreo(correo)` —el correo también es
   * obligatorio— y la comparación literal lo dio por roto. Lo que no puede
   * caerse es que los DOS sigan preguntando por la MISMA función que decide en
   * el servidor.
   */
  const condiciones = [...ui.matchAll(/disabled=\{([^}]*)\}/g)].map((m) => m[1]);
  const conRequisitos = condiciones.filter((c) => c.includes("cumpleTodo(nuevaPass)"));
  assert.equal(
    conRequisitos.length,
    2,
    `esperaba dos botones mirando los requisitos (crear y restablecer) y encuentro ${conRequisitos.length}: ` +
      "alguno se puede pulsar con una contraseña que el servidor va a rechazar"
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

test("la pantalla pinta los requisitos, no una frase suya", () => {
  /*
   * Antes aquí había un texto a mano («Al menos N caracteres…») y esta prueba
   * comprobaba que el número casara con el del servidor. Desde el 26/08/2026 la
   * pantalla pinta `requisitosDe()`, así que el texto ya no se puede desviar: si
   * mañana se añade una regla, aparece sola en las dos pantallas.
   */
  assert.ok(ui.includes("requisitosDe(valor)"), "la lista de requisitos ya no sale de la regla compartida");
  assert.ok(
    /import \{[^}]*requisitosDe[^}]*\} from "@\/lib\/auth\/contrasena\.js"/.test(ui),
    "la pantalla ya no importa la regla: habrá vuelto a escribirla a mano"
  );
});

// ── 7. La regla en sí, sobre el caso de Aumenta ────────────────────────────

test("las tres reglas de hoy, sobre una cuenta de Aumenta", () => {
  const contexto = { email: "elena_aumenta", slug: "aumenta" };
  assert.match(revisarContrasena("", null, contexto), /Escribe la contraseña/);
  assert.match(revisarContrasena("Abc123", null, contexto), new RegExp(`${MINIMO - 1} caracteres`));
  assert.match(revisarContrasena("abcdefgh1", null, contexto), /mayúscula/);
  assert.match(revisarContrasena("Abcdefghi", null, contexto), /número/);
  assert.equal(revisarContrasena("Abcdefg1", null, contexto), null);
});

test("y lo que antes se rechazaba, ahora pasa — a propósito", () => {
  /*
   * El 26/08/2026 se quitaron los cuatro filtros de «esto se adivina» (mismo
   * carácter, teclas seguidas, lista de siempre, nombre del centro o del
   * usuario). Quedan tres reglas y nada más. El porqué, y lo que eso significa
   * con logins adivinables por construcción, en lib/auth/contrasena.js.
   */
  const contexto = { email: "elena_aumenta", slug: "aumenta" };
  for (const antes of ["Aumenta2026", "Elena2026aumenta", "Abcdefg1", "Qwertyui1", "Aaaaaaa1"]) {
    assert.equal(
      revisarContrasena(antes, null, contexto),
      null,
      `«${antes}» se ha vuelto a rechazar: si eso se quiere, se habla antes — es un cambio de producto`
    );
  }
});

test("la pantalla y el servidor no pueden discrepar", () => {
  // La invariante de verdad: el botón se enciende exactamente cuando el
  // servidor aceptaría, ni antes ni después.
  for (const t of ["", "abc", "abcdefgh", "Abcdefgh", "Abcdefg1", "Ñandu2024"]) {
    assert.equal(cumpleTodo(t), revisarContrasena(t) === null, `«${t}» no cuadra`);
  }
  assert.equal(requisitosDe("").length, 3);
});
