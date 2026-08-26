/**
 * _smoke-team-lista-profesionales.mjs — la lista de profesionales llega a quien
 * la necesita, y llega recortada (26/08/2026).
 *
 *   node scripts/_smoke-team-lista-profesionales.mjs
 *
 * @prueba ligera
 *
 * Ejecuta `serializeProfesional` de verdad (es pura, sin base de datos) y además
 * lee el CÓDIGO de /api/team para comprobar por dónde gatea cada verbo.
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * Las quince terapeutas de Aumenta no llevan `team` en su `moduleAccess` —no
 * tienen por qué entrar en la pantalla de Equipo, donde están los sueldos—, y
 * GET /api/team gateaba con `hasModule("team")`, que cruza el módulo del TENANT
 * con el acceso del USUARIO. Resultado: 403 en la petición de la LISTA.
 *
 * Una docena de pantallas se come ese 403 en silencio. El filtro de terapeutas
 * de /pacientes tiene un plan B que se inventa la lista con los pacientes que
 * tenga cargados: los 50 de la página, de 1.174. Salía media plantilla y CAMBIABA
 * al pasar de página. Y como ese mismo desplegable es el que asigna terapeuta al
 * dar de alta un paciente, el agujero no solo escondía: ensuciaba el dato.
 *
 * Es el primo hermano de lo que cuenta lib/citas/visibilidad.js. Allí preguntar
 * por el usuario DESTAPABA la agenda; aquí esconde la plantilla hasta romper la
 * pantalla. La misma regla arregla los dos:
 *
 *   «¿tiene el CENTRO equipo?»          → tenantHasModule
 *   «¿puede esta persona abrir Equipo?» → hasModule
 *
 * ── LO QUE ESTA PRUEBA DEFIENDE ────────────────────────────────────────────
 *
 * Que abrir la puerta no se lleve por delante lo que estaba bien cerrado: la
 * lista recortada NO puede traer correos, teléfonos, notas, tarifas ni
 * retribución. La lista de campos prohibidos vive en el mismo fichero que el
 * serializer, así que quien añada un campo de dinero mañana se topa con ella.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import {
  serializeProfesional,
  serializeTeamMember,
  CAMPOS_FUERA_DE_LA_LISTA,
} from "../lib/team/serializeTeamMember.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel) => {
  const abs = path.join(RAIZ, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
};

/** Una ficha de equipo con TODO relleno, incluido lo que no puede salir. */
const FICHA = {
  id: "11111111-1111-1111-1111-111111111111",
  userId: "22222222-2222-2222-2222-222222222222",
  displayName: "Araceli",
  position: "Psicóloga",
  department: "Infantil",
  status: "active",
  email: "araceli@ejemplo.es",
  phone: "600000000",
  notes: "Reduce jornada los viernes",
  avatarUrl: null,
  avatarColor: "#FF1F96",
  blockColor: "#CCCCCC",
  specialties: ["psicologia"],
  hiredAt: "2020-01-01",
  hourlyRate: 45,
  currency: "EUR",
  hourlyCost: 22.5,
  annualGross: 30000,
  paymentPeriods: 14,
  monthlySalary: 2142.86,
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
};

// ── El recorte ─────────────────────────────────────────────────────────────

test("la lista recortada no lleva NADA personal ni de dinero", () => {
  const salida = serializeProfesional(FICHA);
  const filtrados = CAMPOS_FUERA_DE_LA_LISTA.filter((c) => c in salida);
  assert.deepEqual(
    filtrados,
    [],
    `se han colado en la lista de desplegables: ${filtrados.join(", ")}`
  );
});

test("la lista recortada lleva lo que un desplegable necesita", () => {
  const salida = serializeProfesional(FICHA);
  for (const campo of ["id", "userId", "displayName", "role", "status", "avatarColor", "specialties"]) {
    assert.ok(campo in salida, `falta ${campo}: alguna pantalla dejará de pintar a la persona`);
  }
  assert.equal(salida.displayName, "Araceli");
  assert.equal(salida.role, "Psicóloga", "`position` se sigue renombrando a `role`, como en el serializer completo");
  assert.equal(salida.userId, FICHA.userId, "sin userId una pantalla no sabe cuál de la lista es quien mira");
});

test("ninguna clave del recorte se ha inventado: todas existen en el serializer completo", () => {
  // Si el recorte devolviera una clave con otro nombre, media docena de
  // pantallas pintarían undefined solo para quien no tenga el módulo.
  const recorte = serializeProfesional(FICHA);
  const completo = serializeTeamMember(FICHA, { isAdmin: true });
  const huerfanas = Object.keys(recorte).filter((k) => !(k in completo));
  assert.deepEqual(huerfanas, [], `el recorte inventa claves que el completo no tiene: ${huerfanas.join(", ")}`);
});

test("los valores del recorte son los MISMOS que los del completo", () => {
  const recorte = serializeProfesional(FICHA);
  const completo = serializeTeamMember(FICHA, { isAdmin: true });
  for (const k of Object.keys(recorte)) {
    assert.deepEqual(recorte[k], completo[k], `${k} no vale lo mismo en las dos listas`);
  }
});

test("la lista de campos prohibidos cubre TODO lo que el completo añade de más", () => {
  // La red de seguridad de verdad: si mañana alguien mete `iban` en el
  // serializer completo y se olvida del recorte, esta prueba lo caza.
  const recorte = serializeProfesional(FICHA);
  const completo = serializeTeamMember(FICHA, { isAdmin: true });
  const deMas = Object.keys(completo).filter((k) => !(k in recorte));
  const sinDeclarar = deMas.filter(
    (k) => !CAMPOS_FUERA_DE_LA_LISTA.includes(k) && !["createdAt", "updatedAt", "specialtyLabels"].includes(k)
  );
  assert.deepEqual(
    sinDeclarar,
    [],
    `${sinDeclarar.join(", ")}: campos que el completo devuelve y el recorte no, sin pasar por ` +
      "CAMPOS_FUERA_DE_LA_LISTA. Decláralos ahí (y mira si de verdad tienen que quedarse fuera)"
  );
});

test("una ficha vacía no revienta", () => {
  assert.equal(serializeProfesional(null), null);
});

// ── Las dos puertas del endpoint ───────────────────────────────────────────

const REL_LISTA = "app/api/team/route.js";
const REL_FICHA = "app/api/team/[id]/route.js";
const lista = leer(REL_LISTA);
const ficha = leer(REL_FICHA);

test("los dos endpoints de equipo siguen donde estaban", () => {
  assert.ok(lista !== null, `no existe ${REL_LISTA}`);
  assert.ok(ficha !== null, `no existe ${REL_FICHA}`);
});

test("LEER la lista pregunta por el CENTRO", () => {
  // `tenantHasModule` lleva H mayúscula: `hasModule("team")` en minúscula no es
  // subcadena suya, así que contar el literal no da falsos positivos.
  const gate = lista.match(/if \(!tenantHasModule\("team"\)\) return forbidden/);
  assert.ok(
    gate,
    "GET /api/team ha vuelto a gatear con hasModule: eso devuelve 403 a quien no tenga el módulo " +
      "en SUS accesos, y una docena de desplegables de profesionales se quedan a medias en silencio"
  );
});

test("ESCRIBIR sigue pidiendo el módulo del usuario y rol de dirección", () => {
  for (const verbo of ["POST", "PATCH", "DELETE"]) {
    const i = lista.indexOf(`export const ${verbo} = withTenant`);
    if (i < 0) continue; // PATCH y DELETE viven en [id]
    const cuerpo = lista.slice(i, i + 1200);
    assert.ok(
      cuerpo.includes('hasModule("team")') && !cuerpo.includes('tenantHasModule("team")'),
      `${verbo} /api/team ya no gatea por el acceso del usuario: crear plantilla no es cosa de cualquiera`
    );
    assert.ok(cuerpo.includes("ADMIN_ROLES.has(userRole)"), `${verbo} /api/team ha perdido el freno de rol`);
  }
});

test("la FICHA de una persona sigue cerrada a quien no tiene el módulo", () => {
  const i = ficha.indexOf("export const GET = withTenant");
  assert.ok(i >= 0, "GET /api/team/[id] ha cambiado de forma: revisa esta prueba");
  const cuerpo = ficha.slice(i, i + 800);
  assert.ok(
    cuerpo.includes('if (!hasModule("team")) return forbidden'),
    "la ficha individual devuelve correo, teléfono, notas y —si eres dirección— el sueldo: " +
      "esa puerta se abre con el módulo en los accesos, no con tenerlo el centro"
  );
});

test("la lista recortada se decide en un solo sitio y se usa donde toca", () => {
  assert.ok(
    lista.includes('const listaReducida = !hasModule("team")'),
    "la decisión del recorte se ha movido o copiado: tiene que salir de una sola línea"
  );
  assert.ok(
    lista.includes("listaReducida ? serializeProfesional(m) : serializeTeamMember(m, { isAdmin })"),
    "el recorte ya no se aplica al pintar los miembros"
  );
  assert.ok(
    lista.includes("viewerIsAdmin: isAdmin && !listaReducida"),
    "con la lista recortada nadie puede figurar como admin: la pantalla de Equipo se abriría a medias"
  );
});

test("buscar por texto no destapa correos a quien no puede verlos", () => {
  assert.ok(
    /listaReducida \? porNombre :/.test(lista),
    "el buscador de /api/team vuelve a mirar el correo para todos: con la lista recortada se " +
      "podría adivinar un correo letra a letra aunque no salga en la respuesta"
  );
});
