// @prueba ligera
/**
 * _smoke-correo-cuenta.mjs — el correo de una cuenta, y que sirva para entrar.
 *
 * Prueba lo que DEVUELVEN las funciones de `lib/auth/correoCuenta.js`, no cómo
 * están escritas. Y encima unas cuantas guardas sobre el código fuente para lo
 * que de verdad es texto: que las tres puertas de alta siguen exigiendo el
 * correo y que el login sigue apuntando los fallos bajo los dos nombres.
 *
 * (26/08/2026.)
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  esCorreo,
  normalizarCorreo,
  revisarCorreoCuenta,
  correoDeCuenta,
  identificadoresDe,
  elegirCuenta,
  MAX_LARGO,
} from "../lib/auth/correoCuenta.js";
import { whereDelLogin } from "../lib/auth/correoCuentaDb.js";

const leer = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// ───────────────────────────────────────────────────────────────────────────
// La forma de un correo
// ───────────────────────────────────────────────────────────────────────────

test("esCorreo acepta un correo normal y rechaza un nombre de usuario", () => {
  assert.equal(esCorreo("laura@aumenta.es"), true);
  assert.equal(esCorreo("laura_aumenta"), false, "los logins de Aumenta NO son correos");
  assert.equal(esCorreo("admin_somos"), false);
});

test("esCorreo rechaza lo que parece un correo y no lo es", () => {
  for (const malo of ["", "  ", "@dominio.com", "algo@", "algo@dominio", "a b@c.com", "algo@dominio.c"]) {
    assert.equal(esCorreo(malo), false, `debería rechazar «${malo}»`);
  }
});

test("esCorreo no se cae con lo que no es texto", () => {
  for (const raro of [null, undefined, 42, {}, [], true]) {
    assert.equal(esCorreo(raro), false);
  }
});

test("normalizarCorreo quita espacios y baja a minúsculas", () => {
  assert.equal(normalizarCorreo("  Laura@Aumenta.ES "), "laura@aumenta.es");
  assert.equal(normalizarCorreo(null), "");
});

test("un correo guardado en mayúsculas seguiría entrando", () => {
  // Si esto se rompiera, quien se diera de alta con mayúsculas no podría entrar
  // nunca: el login normaliza lo tecleado y compararía contra otra cosa.
  assert.equal(normalizarCorreo("Laura@Aumenta.es"), normalizarCorreo("laura@aumenta.es"));
});

// ───────────────────────────────────────────────────────────────────────────
// La exigencia
// ───────────────────────────────────────────────────────────────────────────

test("revisarCorreoCuenta exige que haya uno", () => {
  const fallo = revisarCorreoCuenta("");
  assert.ok(fallo, "vacío tiene que dar error");
  assert.match(fallo, /correo/i);
});

test("revisarCorreoCuenta explica por qué, no solo que no", () => {
  assert.match(revisarCorreoCuenta("laura_aumenta"), /forma de correo/i);
  assert.match(revisarCorreoCuenta("a".repeat(MAX_LARGO) + "@x.com"), /largo/i);
});

test("revisarCorreoCuenta deja pasar uno bueno", () => {
  assert.equal(revisarCorreoCuenta("laura@aumenta.es"), null);
  assert.equal(revisarCorreoCuenta("  LAURA@aumenta.es  "), null, "se normaliza antes de juzgar");
});

// ───────────────────────────────────────────────────────────────────────────
// A dónde se le escribe
// ───────────────────────────────────────────────────────────────────────────

test("correoDeCuenta prefiere el correo asignado", () => {
  assert.equal(
    correoDeCuenta({ email: "laura_aumenta", emailContacto: "laura@aumenta.es" }),
    "laura@aumenta.es"
  );
});

test("correoDeCuenta cae al identificador cuando ES un correo", () => {
  // Es lo que hace que las 12 cuentas que ya entran con correo funcionen sin
  // tocarles una sola fila.
  assert.equal(correoDeCuenta({ email: "admin@aumenta.es", emailContacto: null }), "admin@aumenta.es");
});

test("correoDeCuenta devuelve null cuando no hay a dónde escribir", () => {
  assert.equal(correoDeCuenta({ email: "laura_aumenta", emailContacto: null }), null);
  assert.equal(correoDeCuenta({ email: "laura_aumenta", emailContacto: "" }), null);
  assert.equal(correoDeCuenta(null), null);
});

test("un emailContacto con basura no se cuela como buzón", () => {
  assert.equal(correoDeCuenta({ email: "laura_aumenta", emailContacto: "no-es-un-correo" }), null);
});

// ───────────────────────────────────────────────────────────────────────────
// Los dos identificadores
// ───────────────────────────────────────────────────────────────────────────

test("identificadoresDe da los dos, sin repetir", () => {
  assert.deepEqual(
    identificadoresDe({ email: "laura_aumenta", emailContacto: "laura@aumenta.es" }),
    ["laura_aumenta", "laura@aumenta.es"]
  );
  assert.deepEqual(
    identificadoresDe({ email: "admin@aumenta.es", emailContacto: "admin@aumenta.es" }),
    ["admin@aumenta.es"],
    "el mismo texto en las dos columnas es UN identificador, no dos"
  );
});

test("whereDelLogin solo mira las dos columnas si lo tecleado lleva arroba", () => {
  const porUsuario = whereDelLogin("laura_aumenta");
  assert.deepEqual(porUsuario, { email: "laura_aumenta" });
  assert.equal(
    Object.getOwnPropertySymbols(porUsuario).length,
    0,
    "un nombre de usuario no puede estar en emailContacto: buscarlo ahí sobra"
  );

  const porCorreo = whereDelLogin("laura@aumenta.es");
  assert.equal(Object.getOwnPropertySymbols(porCorreo).length, 1, "debería salir un Op.or");
});

test("whereDelLogin normaliza lo tecleado", () => {
  assert.deepEqual(whereDelLogin("  LAURA_AUMENTA "), { email: "laura_aumenta" });
});

// ───────────────────────────────────────────────────────────────────────────
// Quién gana cuando dos cuentas responden al mismo texto
// ───────────────────────────────────────────────────────────────────────────

test("elegirCuenta devuelve la única cuando solo hay una", () => {
  const uno = { id: "a", email: "laura@aumenta.es" };
  assert.equal(elegirCuenta([uno], "laura@aumenta.es"), uno);
  assert.equal(elegirCuenta([], "x"), null);
  assert.equal(elegirCuenta(null, "x"), null);
});

test("MANDA el identificador: un emailContacto ajeno no puede robar un login", () => {
  // El caso que no puede pasar nunca: alguien mete como su correo el LOGIN de
  // otra persona. Aunque el índice único lo impida, aquí se fija la regla.
  const duena = { id: "duena", email: "admin@aumenta.es", emailContacto: null };
  const intrusa = { id: "intrusa", email: "otra_aumenta", emailContacto: "admin@aumenta.es" };
  assert.equal(elegirCuenta([intrusa, duena], "admin@aumenta.es").id, "duena");
  assert.equal(elegirCuenta([duena, intrusa], "admin@aumenta.es").id, "duena");
});

test("elegirCuenta ignora los huecos", () => {
  const uno = { id: "a", email: "laura@aumenta.es" };
  assert.equal(elegirCuenta([null, uno, undefined], "laura@aumenta.es"), uno);
});

// ───────────────────────────────────────────────────────────────────────────
// Que la regla no se pueda rodear: guardas sobre el código
// ───────────────────────────────────────────────────────────────────────────

test("el modelo exige un correo al CREAR, y solo al crear", () => {
  const src = leer("models/master/User.model.js");
  assert.match(src, /addHook\("beforeCreate"/, "sin el hook, cualquier script futuro crea cuentas mudas");
  assert.match(src, /correoDeCuenta\(user\)/);
  assert.doesNotMatch(
    src,
    /addHook\("beforeSave"/,
    "un beforeSave tumbaría a las 14 cuentas que hoy no tienen correo en cuanto entraran"
  );
});

test("la columna del correo admite nulos", () => {
  const src = leer("models/master/User.model.js");
  const bloque = src.slice(src.indexOf("emailContacto:"), src.indexOf("emailContacto:") + 400);
  assert.match(bloque, /allowNull:\s*true/, "ponerla NOT NULL dejaría fuera a quien ya no tiene correo");
  assert.match(bloque, /unique:\s*true/, "también sirve para entrar: tiene que ser único");
});

test("las tres puertas de alta piden el correo", () => {
  for (const puerta of [
    "app/api/team/[id]/access/route.js",
    "lib/provisioning/altaTenant.js",
  ]) {
    const src = leer(puerta);
    assert.match(src, /revisarCorreoCuenta/, `${puerta} tiene que validar el correo`);
    assert.match(src, /correoLibre/, `${puerta} tiene que comprobar que no lo tenga otro`);
    assert.match(src, /emailContacto:/, `${puerta} tiene que guardarlo`);
  }
  // La tercera entra con su correo como identificador, así que le basta con
  // comprobar que lo sea.
  const bo = leer("scripts/crear-usuario-backoffice.js");
  assert.match(bo, /esCorreo\(email\)/);
});

test("el alta de cliente se cae ANTES de crear nada si falta el correo", () => {
  const src = leer("lib/provisioning/altaTenant.js");
  const iCorreo = src.indexOf("revisarCorreoCuenta(correoAdmin)");
  const iTenant = src.indexOf("await Tenant.create(");
  assert.ok(iCorreo > 0 && iTenant > 0);
  assert.ok(
    iCorreo < iTenant,
    "si se valida después, un correo mal escrito deja un cliente a medias con schema y todo"
  );
});

test("el login busca por los dos identificadores", () => {
  const src = leer("app/api/auth/login/route.js");
  assert.match(src, /whereDelLogin\(email\)/);
  assert.match(src, /elegirCuenta\(candidatos, email\)/);
});

test("dos identificadores NO son el doble de intentos", () => {
  const src = leer("app/api/auth/login/route.js");
  assert.match(src, /cerrojoDeCuenta\(cerrojo\.ip, identificador\)/, "falta el cerrojo por el identificador real");
  assert.match(
    src,
    /registrarFalloLogin\(cerrojo\.ip, identificador, \{ barrido: false \}\)/,
    "un fallo tecleando el correo tiene que contar también en la cuenta"
  );
  assert.doesNotMatch(
    src,
    /registrarFalloLogin\(cerrojo\.ip, email\);[\s\S]{0,200}await auditarLogin/,
    "los tres sitios que apuntan un fallo tienen que pasar por apuntarFallo()"
  );
});

test("el cerrojo por identificador NO toca el cubo de la IP", () => {
  // Ese cubo protege a las 15 personas de Aumenta que salen por la misma línea:
  // contar dos veces el mismo fallo las dejaría fuera a todas.
  const src = leer("lib/auth/loginGuard.js");
  const i = src.indexOf("export function cerrojoDeCuenta");
  const fin = src.indexOf("export function registrarFalloLogin");
  const cuerpo = src.slice(i, fin);
  assert.doesNotMatch(cuerpo, /`ip:\$\{ip\}`/, "cerrojoDeCuenta no puede mirar el barrido por IP");
});

test("el relleno NO toca el identificador de nadie", () => {
  const src = leer("scripts/backfill-correo-cuenta.js");
  assert.match(src, /emailContacto: dela/);
  assert.doesNotMatch(
    src,
    /update\(\{[^}]*\bemail:/,
    "tocar `email` le cambiaría el login a trece personas de Aumenta a la vez"
  );
  assert.match(src, /--confirm/, "un script que escribe datos tiene que ensayar primero");
});

test("el relleno no imprime direcciones de nadie", () => {
  const src = leer("scripts/backfill-correo-cuenta.js");
  assert.doesNotMatch(src, /log\(`?[^`]*\$\{dela\}/, "las direcciones no salen por pantalla");
});

test("la frase de la auditoría del correo existe", () => {
  const src = leer("lib/actividad/etiquetas.js");
  assert.match(src, /"team\.correo_changed":/);
});

// ───────────────────────────────────────────────────────────────────────────
// Ponérselo uno mismo: la puerta que Equipo no cubre
// ───────────────────────────────────────────────────────────────────────────

test("existe una ruta para ponerse el correo uno mismo", () => {
  // Equipo rechaza a propósito las cuentas de administrador y la de uno mismo
  // (`loadManagedUser`), así que sin esta ruta el administrador ÚNICO de un
  // cliente —y hay 11— no tendría dónde ponerse el correo.
  const src = leer("app/api/auth/correo/route.js");
  assert.match(src, /export const POST/);
  assert.match(src, /export const GET/);
});

test("ponerse el correo pide la contraseña", () => {
  const src = leer("app/api/auth/correo/route.js");
  assert.match(
    src,
    /bcrypt\.compare\(actual, user\.passwordHash/,
    "sin la contraseña, una sesión abierta sin vigilar basta para apuntar la cuenta a un buzón ajeno"
  );
});

test("ponerse el correo lleva los mismos frenos que cambiar la contraseña", () => {
  const src = leer("app/api/auth/correo/route.js");
  assert.match(src, /isDemoTenant\(ctx\)/, "las cuatro demos son públicas y con sesión de admin");
  assert.match(src, /enforceRateLimit/, "cada petición es un bcrypt de coste 12");
  assert.match(src, /comprobarIntentoLogin/, "tiene que respetar el cerrojo de la cuenta");
  assert.match(src, /correoLibre\(User, correo, \{ exceptoId: user\.id \}\)/, "el correo sigue teniendo que ser único");
  assert.match(
    src,
    /registrarFalloLogin\([^)]*\{ barrido: false \}\)/,
    "sumar al cubo de la IP dejaría sin login a las 15 personas de Aumenta por unas erratas"
  );
});

test("ponerse el correo NO tumba las sesiones de los demás dispositivos", () => {
  // Al revés que el cambio de contraseña, y a propósito: aquí no ha cambiado
  // ninguna credencial.
  const src = leer("app/api/auth/correo/route.js");
  assert.doesNotMatch(src, /increment\("tokenVersion"/);
});

test("la tarjeta de Configuración está declarada como zona", () => {
  const src = leer("lib/configuracion/pestanas.js");
  assert.match(src, /correoCuenta: \{ pestana: "cuenta", requiere: null \}/,
    "sin la zona, la tarjeta no se pinta en ninguna pestaña");
});

test("la pantalla usa la MISMA regla que el servidor, no una copia", () => {
  for (const rel of ["modules/config/tarjetas/Cuenta.jsx", "components/team/AccessSection.jsx", "app/admin/clientes/page.jsx"]) {
    const src = leer(rel);
    assert.match(src, /esCorreo as pareceCorreo/, `${rel} tiene que importar la regla, no escribir su propia regex`);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Los dos avisos: que se vea quién no lo tiene
// ───────────────────────────────────────────────────────────────────────────

test("la lista de Equipo marca las cuentas sin correo y las cuenta enteras", () => {
  const src = leer("app/api/team/route.js");
  assert.match(src, /cuentaSinCorreo: cuentaSinCorreo\.has\(String\(m\.id\)\)/, "falta la marca por fila");
  assert.match(src, /cuentasSinCorreo: cuentaSinCorreo\.size/, "falta el total para el rótulo de arriba");
  assert.match(
    src,
    /where: \{ userId: \{ \[Op\.ne\]: null \} \}/,
    "el total tiene que contarse sobre TODAS las fichas con login, no sobre la página: paginar no puede cambiar cuántas faltan"
  );
});

test("la marca no viaja en la lista recortada", () => {
  // La lista para desplegables no lleva correos ni cuentas: no tiene por qué
  // decirle a una terapeuta quién del centro no tiene correo.
  const src = leer("app/api/team/route.js");
  const i = src.indexOf("const cuentaSinCorreo = new Set()");
  const trozo = src.slice(i, i + 260);
  assert.match(trozo, /if \(isAdmin && !listaReducida\)/);
});

test("el aviso de la persona no sale en la demo ni si ya tiene correo", () => {
  const src = leer("components/layout/AvisoCorreoCuenta.jsx");
  assert.match(src, /!j\.data\.enDemo && !j\.data\.correo/,
    "la cuenta de la demo la comparte todo el mundo: ahí no hay nada que arreglar");
});

test("el aviso de la persona se puede callar, pero vuelve", () => {
  const src = leer("components/layout/AvisoCorreoCuenta.jsx");
  assert.match(src, /sessionStorage/, "una barra que no se puede cerrar se deja de leer");
  assert.doesNotMatch(src, /localStorage/, "con localStorage se callaría para siempre y nadie lo arreglaría");
});

test("el aviso de la persona está montado en el layout", () => {
  const src = leer("components/layout/DashboardShell.jsx");
  assert.match(src, /<AvisoCorreoCuenta \/>/,
    "sin montarlo, el aviso solo lo vería quien entrase en Configuración — que es justo quien no lo necesita");
});
