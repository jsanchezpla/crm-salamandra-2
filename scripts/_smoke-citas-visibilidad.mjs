/**
 * _smoke-citas-visibilidad.mjs — el filtro de la agenda no se apaga solo
 * (19/08/2026).
 *
 *   node scripts/_smoke-citas-visibilidad.mjs
 *
 * @prueba ligera
 *
 * Lee el CÓDIGO de los tres endpoints de citas y de la portada. Sin base de
 * datos, sin servidor, sin .env.
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * Rocío es `user` en nutri_laura y su moduleAccess es ["citas","clients",
 * "nutricion"] — sin "team", que es por lo que no ve el menú de Equipo. En su
 * pantalla de Citas veía las 10 citas del centro con el nombre del paciente,
 * incluida la supervisión que Laura se había agendado a sí misma, y podía
 * moverlas y cancelarlas.
 *
 * La causa no era el filtro: era el `if` que lo envolvía. `hasModule(key)` cruza
 * el módulo del TENANT con el `moduleAccess` DEL USUARIO, así que para ella
 * `hasModule("team")` era false y el bloque entero —filtro incluido— se saltaba.
 * QUITARLE PERMISOS ERA LO QUE LE DABA LOS DATOS.
 *
 * Por eso esta prueba no comprueba el filtro (eso ya lo hace
 * `_smoke-portada-agenda.mjs` con modelos de mentira): comprueba LA PREGUNTA.
 * Que en estos ficheros nadie vuelva a escribir `hasModule("team")`, que la
 * decisión siga saliendo de `veTodaLaAgenda`, y que cuando no se sabe quién
 * mira se cierre (`?? NADIE`) en vez de abrirse.
 *
 * ── POR QUÉ SE LEE EL TEXTO Y NO SE EJECUTA ────────────────────────────────
 * Son route handlers de Next: ejecutarlos pide `withTenant`, cabeceras, modelos
 * y una petición. Leer el texto es tosco pero atrapa exactamente la clase de
 * fallo que hubo —una palabra cambiada— y cuesta 40 ms. Para que no pase en
 * falso si alguien reordena el fichero, cada aserción exige que su ANCLA
 * exista: si no aparece, la prueba falla pidiendo que se revise.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { veTodaLaAgenda, agendaCompartida, soloLoSuyo, esSuya, NADIE_DEL_EQUIPO } from "../lib/citas/visibilidad.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let fallos = 0;
function check(etiqueta, ok, detalle = "") {
  if (!ok) fallos++;
  process.stdout.write((ok ? "OK  " : "MAL ") + etiqueta + "\n");
  if (!ok && detalle) process.stdout.write("      " + detalle + "\n");
}
/** El trozo de texto que sigue a un ancla: para preguntar «esto esta DENTRO de esa funcion». */
function ventana(texto, ancla, largo) {
  const i = texto.indexOf(ancla);
  return i < 0 ? "" : texto.slice(i, i + largo);
}
function h(t) {
  process.stdout.write("\n> " + t + "\n");
}

// La cola de citas sin profesional no gatea por team (no filtra por persona:
// decide si ALGUIEN puede repartirlas), asi que va en su propia lista.
const COLA = "app/api/citas/sin-profesional/route.js";

const FICHEROS = [
  "app/api/citas/bookings/route.js",
  "app/api/citas/bookings/calendar/route.js",
  "app/api/citas/bookings/[id]/route.js",
  "lib/home/summary.js",
];

const texto = {};
for (const rel of FICHEROS) {
  const abs = path.join(RAIZ, rel);
  texto[rel] = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

h("Los ficheros que gatean la agenda siguen donde estaban");
for (const rel of FICHEROS) {
  check(rel, texto[rel] !== null, "no existe: si se movio, hay que actualizar esta prueba");
}
if (fallos) {
  process.stdout.write("\nX " + fallos + " fallo(s): no se puede seguir sin los ficheros\n\n");
  process.exit(1);
}

h("Nadie pregunta por el modulo team cruzandolo con el usuario");
for (const rel of FICHEROS) {
  // `tenantHasModule` lleva H MAYÚSCULA, así que `hasModule("team")` en minúscula
  // no es subcadena suya: contar el literal basta y no da falsos positivos.
  const sueltos = texto[rel].split('hasModule("team")').length - 1;
  const buenos = texto[rel].split('tenantHasModule("team")').length - 1;
  check(
    rel + " no pregunta con hasModule",
    sueltos === 0,
    'aparece hasModule("team") ' +
      sueltos +
      " vez/veces: eso apaga el filtro entero para quien no tenga team en su moduleAccess"
  );
  check(rel + " lo pregunta con tenantHasModule", buenos >= 1, "ya no gatea por team: revisa esta prueba");
}

h("La decision sigue saliendo de un solo sitio");
for (const rel of FICHEROS) {
  check(rel + " llama a veTodaLaAgenda", texto[rel].includes("veTodaLaAgenda("), "la regla se ha vuelto a copiar a mano");
  check(
    rel + " importa desde lib/citas/visibilidad.js",
    /from ".*citas\/visibilidad\.js"/.test(texto[rel]),
    "importa la regla de otro sitio"
  );
}

h("Los dos listados usan la regla compartida, sin copiarsela");
const CIERRAN = ["app/api/citas/bookings/route.js", "app/api/citas/bookings/calendar/route.js"];
for (const rel of CIERRAN) {
  check(
    rel + " filtra con soloLoSuyo(myId)",
    texto[rel].includes("where.teamMemberId = soloLoSuyo(myId)"),
    "si vuelve a construir el filtro a mano, se desviara de la regla compartida"
  );
  check(
    rel + " no guarda su propia copia del centinela",
    !/const NADIE = "0{8}-/.test(texto[rel]),
    "el uuid centinela vive en lib/citas/visibilidad.js y en ningun otro sitio"
  );
}

h("Tocar una cita ajena tambien esta cerrado");
const DETALLE = texto["app/api/citas/bookings/[id]/route.js"];
check(
  "noPuedeTocarla existe y la usan PATCH y DELETE",
  (DETALLE.split("noPuedeTocarla(request, ctx, row)").length - 1) >= 3,
  "editar/mover/cancelar tiene que pasar por la misma puerta que leer"
);
check(
  "noPuedeTocarla gatea con tenantHasModule",
  /noPuedeTocarla[\s\S]{0,400}?tenantHasModule\("team"\)/.test(DETALLE),
  "con hasModule, quien no tenga team en su moduleAccess puede mover las citas de otra"
);
check(
  "y decide con esSuya, la misma regla que el listado",
  ventana(DETALLE, "async function noPuedeTocarla", 700).includes("esSuya(row, myId)"),
  "si compara a mano, el detalle y el listado se desviaran: se vera la cita y al abrirla dira que no existe"
);
check(
  "el detalle (GET) decide con la misma funcion",
  (DETALLE.split("esSuya(row, myId)").length - 1) >= 2,
  "leer una cita y tocarla tienen que decidir igual"
);

h("La cola de citas sin profesional tiene puerta");
{
  const t = fs.readFileSync(path.join(RAIZ, COLA), "utf8");
  check(COLA + " existe y llama a veTodaLaAgenda", t.includes("veTodaLaAgenda("), "sin puerta, cualquiera lista y reparte las citas sin asignar");
  check("la puerta se aplica en GET y en POST", (t.split("noPuedeRepartir(request, tenant)").length - 1) >= 3, "listar y asignar tienen que estar cerrados los dos");
}

h("La regla de «lo suyo» (funcion pura)");
/** Lee las ramas del fragmento por sus simbolos: asi esta prueba no importa sequelize. */
function ramas(f) {
  const out = [];
  for (const s of Object.getOwnPropertySymbols(f)) {
    if (String(s) !== "Symbol(or)") continue;
    for (const r of f[s]) for (const s2 of Object.getOwnPropertySymbols(r)) out.push(r[s2] === null ? "sin-asignar" : String(r[s2]));
  }
  return out;
}
const mismo = (a, b) => JSON.stringify(a) === JSON.stringify(b);
check("soloLoSuyo: su ficha Y las que no son de nadie", mismo(ramas(soloLoSuyo("tm-1")), ["tm-1", "sin-asignar"]));
check("soloLoSuyo sin ficha: el centinela, nunca una ajena", mismo(ramas(soloLoSuyo(null)), [NADIE_DEL_EQUIPO, "sin-asignar"]));
check("el centinela es un uuid de ceros", /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(NADIE_DEL_EQUIPO));
check("esSuya: la suya, si", esSuya({ teamMemberId: "tm-1" }, "tm-1") === true);
check("esSuya: la de OTRA, no", esSuya({ teamMemberId: "tm-2" }, "tm-1") === false);
check("esSuya: la que no es de nadie, si", esSuya({ teamMemberId: null }, "tm-1") === true);
check("esSuya: sin asignar y sin ficha, tambien si", esSuya({ teamMemberId: null }, null) === true);
check("esSuya: ajena y sin ficha, NO", esSuya({ teamMemberId: "tm-2" }, null) === false);
check("esSuya: ajena y con ficha vacia, NO", esSuya({ teamMemberId: "tm-2" }, "") === false);
check("esSuya y soloLoSuyo cuentan lo mismo de una sin asignar", esSuya({ teamMemberId: null }, "tm-1") === ramas(soloLoSuyo("tm-1")).includes("sin-asignar"));

h("La regla en si (funcion pura)");
const tenant = (compartida) => ({ settings: { citas: { agendaCompartida: compartida } } });
check("admin ve toda la agenda", veTodaLaAgenda({ tenant: tenant(false), role: "admin" }) === true);
check("superadmin tambien", veTodaLaAgenda({ tenant: tenant(false), role: "superadmin" }) === true);
check("user NO, por defecto", veTodaLaAgenda({ tenant: tenant(false), role: "user" }) === false);
check("user SI, con agenda compartida", veTodaLaAgenda({ tenant: tenant(true), role: "user" }) === true);
check("sin tenant, cierra", veTodaLaAgenda({ tenant: null, role: "user" }) === false);
check("rol raro, cierra", veTodaLaAgenda({ tenant: tenant(false), role: "recepcion" }) === false);
check("agendaCompartida exige true de verdad", agendaCompartida({ settings: { citas: { agendaCompartida: "si" } } }) === false);

h("La PANTALLA pregunta lo mismo que el servidor (26/08/2026)");
/*
 * El filtro por profesional del calendario iba por ROL, no por «ve mas de una
 * agenda». En Aumenta —el unico cliente con agendaCompartida— eso dejaba a las
 * quince terapeutas viendo las citas de dieciocho personas mezcladas y sin nada
 * con que separarlas, bajo una pildora que ademas ponia «solo tus citas».
 *
 * La pantalla no puede resolverlo sola: la agenda compartida es del tenant. Se
 * lo dice /api/auth/me con la MISMA funcion que filtra el servidor.
 */
{
  const ME = "app/api/auth/me/route.js";
  const CITAS = "modules/default/CitasModule.jsx";
  const me = fs.readFileSync(path.join(RAIZ, ME), "utf8");
  const citas = fs.readFileSync(path.join(RAIZ, CITAS), "utf8");

  check(
    ME + " contesta veTodaLaAgenda con la regla compartida",
    /veTodaLaAgenda: veTodaLaAgenda\(\{ tenant, role: user\.role \}\)/.test(me) &&
      /from ".*citas\/visibilidad\.js"/.test(me),
    "si lo calcula a mano, la pantalla y el servidor acabaran diciendo cosas distintas"
  );
  check(
    ME + " NO devuelve el settings del tenant",
    !/settings:\s/.test(me.slice(me.indexOf("data: {"))),
    "settings lleva las credenciales de integraciones del cliente: entra para calcular, no para salir"
  );
  check(
    CITAS + " ensena el filtro a quien ve toda la agenda",
    citas.includes("{veTodaLaAgenda && teamMembers.length > 1 && ("),
    "el filtro ha vuelto a ser solo de direccion: con agenda compartida eso es media plantilla sin herramienta"
  );
  check(
    CITAS + " solo pone «solo tus citas» cuando lo es",
    citas.includes("{!veTodaLaAgenda && miFichaDeEquipo && ("),
    "la pildora vuelve a ir por rol: mentia encima de la agenda de todo el centro"
  );
  check(
    CITAS + " lo lee de /api/auth/me y no se lo inventa",
    citas.includes("setVeTodaLaAgenda(j?.data?.veTodaLaAgenda === true)"),
    "sin leerlo del servidor, la pantalla vuelve a decidirlo por rol"
  );
}

process.stdout.write(fallos ? "\nX " + fallos + " fallo(s)\n\n" : "\nTodo correcto\n\n");
process.exit(fallos ? 1 : 0);
