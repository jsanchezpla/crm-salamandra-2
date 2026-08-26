/**
 * _smoke-team-borrar.mjs — borrar la ficha de alguien no puede saltarse las
 * tres puertas, y la lista de sitios donde mirar no puede escribirse a mano
 * (26/08/2026).
 *
 *   node scripts/_smoke-team-borrar.mjs
 *
 * @prueba ligera
 *
 * Prueba la REGLA de `lib/team/rastro.js` llamándola (lo que devuelve, no cómo
 * está escrita) y vigila con regex lo que de verdad es texto: que el endpoint
 * conserve sus guardas y que la pantalla no ofrezca el botón antes de tiempo.
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * Equipo solo tenía baja lógica, y Jorge pidió (26/08/2026) poder borrar de
 * verdad «pero antes tengas que poner al empleado como inactivo». El peligro
 * es evidente: 37 columnas de 34 tablas apuntan a `team_members` y detrás hay
 * historia clínica y facturas. Y hasta esa misma mañana,
 * `clinical_reports.therapist_id` era ON DELETE CASCADE en 8 de los 9 clientes
 * con Clínica, así que un borrado se habría llevado los informes por delante
 * (lo arregló `migrate-fks-equipo-alineadas.js`).
 *
 * Por eso lo que se vigila aquí no es «que el botón funcione», sino que siga
 * siendo DIFÍCIL borrar: tres puertas, medidas en el servidor.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import {
  puedeBorrarseLaFicha,
  enCristiano,
  COLUMNAS_SIN_FK,
  NOMBRES,
} from "../lib/team/rastro.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel) => {
  const abs = path.join(RAIZ, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
};

const REL_RUTA = "app/api/team/[id]/borrar/route.js";
const REL_PAGINA = "app/(dashboard)/equipo/page.jsx";
const REL_MODAL = "components/team/BorrarFichaModal.jsx";
const ruta = leer(REL_RUTA);
const pagina = leer(REL_PAGINA);
const modal = leer(REL_MODAL);

// ── La regla, llamándola ───────────────────────────────────────────────────

test("con las tres puertas abiertas, se puede borrar", () => {
  const r = puedeBorrarseLaFicha({ status: "inactive", userId: null, total: 0 });
  assert.equal(r.puede, true);
  assert.deepEqual(r.impedimentos, []);
});

test("una ficha ACTIVA no se borra, por muy vacía que esté", () => {
  // Es la condición que puso Jorge: primero inactivo, luego borrar.
  const r = puedeBorrarseLaFicha({ status: "active", userId: null, total: 0 });
  assert.equal(r.puede, false);
  assert.ok(r.impedimentos.some((i) => i.codigo === "activa"));
});

test("«de baja» tampoco es «inactivo»", () => {
  // on_leave es una baja temporal (una baja médica): la persona vuelve.
  const r = puedeBorrarseLaFicha({ status: "on_leave", userId: null, total: 0 });
  assert.equal(r.puede, false);
  assert.ok(r.impedimentos.some((i) => i.codigo === "activa"));
});

test("con el login todavía colgando, no se borra", () => {
  const r = puedeBorrarseLaFicha({ status: "inactive", userId: "u-1", total: 0 });
  assert.equal(r.puede, false);
  assert.ok(r.impedimentos.some((i) => i.codigo === "login"));
});

test("UNA sola fila suya ya lo impide", () => {
  // No hay umbral ni «son pocas»: una sesión clínica sin autor es una sesión
  // clínica rota.
  const r = puedeBorrarseLaFicha({ status: "inactive", userId: null, total: 1 });
  assert.equal(r.puede, false);
  assert.ok(r.impedimentos.some((i) => i.codigo === "rastro"));
});

test("los impedimentos se acumulan, no se quedan en el primero", () => {
  // El modal los lista todos: si solo saliera uno, se arreglaría ese y el
  // siguiente intento volvería a fallar por otro sitio.
  const r = puedeBorrarseLaFicha({ status: "active", userId: "u-1", total: 5 });
  assert.equal(r.puede, false);
  assert.equal(r.impedimentos.length, 3);
});

test("un total que llega como texto o como nada no abre la puerta por detrás", () => {
  assert.equal(puedeBorrarseLaFicha({ status: "inactive", userId: null, total: "3" }).puede, false);
  // Sin medición no hay permiso… salvo que la medición diga 0 de verdad.
  assert.equal(puedeBorrarseLaFicha({ status: "inactive", userId: null, total: 0 }).puede, true);
});

// ── Lo que lee la persona ──────────────────────────────────────────────────

test("la concordancia de singular y plural", () => {
  assert.equal(enCristiano("bookings", 1), "1 cita");
  assert.equal(enCristiano("bookings", 12), "12 citas");
  assert.equal(enCristiano("clinical_reports", 1), "1 informe clínico");
});

test("una tabla sin bautizar sale en crudo, pero sale", () => {
  // El diccionario es SOLO para leer: si mañana aparece una tabla nueva y nadie
  // la bautiza, tiene que seguir contándose. Lo contrario —que desaparezca del
  // recuento— sería un agujero.
  assert.equal(enCristiano("tabla_que_no_existe", 3), "3 en tabla_que_no_existe");
});

// ── Las columnas sin FK ────────────────────────────────────────────────────

test("las columnas sin FK están declaradas y justificadas", () => {
  assert.ok(COLUMNAS_SIN_FK.length >= 3, "alguien ha quitado columnas de la lista");
  for (const c of COLUMNAS_SIN_FK) {
    assert.match(c.tabla, /^[a-z_][a-z0-9_]*$/, `tabla rara: ${c.tabla}`);
    assert.match(c.columna, /^[a-z_][a-z0-9_]*$/, `columna rara: ${c.columna}`);
    assert.ok(c.porque && c.porque.length > 10, `${c.tabla}.${c.columna} entró sin explicar por qué`);
  }
});

test("assets.assigned_to sigue en la lista", () => {
  // Es la que demuestra que la lista hace falta: 3 filas en producción, las 3
  // de un miembro del equipo y ninguna de un usuario, y sin FK en ningún
  // schema. Mirando solo el catálogo de FKs, borrar a alguien le habría dejado
  // material asignado a una ficha que ya no existe.
  assert.ok(
    COLUMNAS_SIN_FK.some((c) => c.tabla === "assets" && c.columna === "assigned_to"),
    "sin assets.assigned_to el rastro deja fuera el material asignado"
  );
});

test("no se cuela una columna que en realidad guarda un id de master.users", () => {
  // Medido el 26/08/2026: estas SUENAN a equipo y son de usuario. Si alguien
  // las mete aquí, el botón deja de aparecer nunca y nadie sabrá por qué.
  const DE_USUARIO = [
    ["team_blocks", "created_by_id"],
    ["documents", "owner_user_id"],
    ["document_folders", "owner_user_id"],
    ["recipes", "created_by"],
    ["tickets", "created_by"],
    ["blocked_days", "created_by_id"],
    ["calendar_tasks", "created_by"],
  ];
  for (const [tabla, columna] of DE_USUARIO) {
    assert.ok(
      !COLUMNAS_SIN_FK.some((c) => c.tabla === tabla && c.columna === columna),
      `${tabla}.${columna} guarda un id de master.users, no de team_members`
    );
  }
});

test("el diccionario bautiza las tablas más peligrosas", () => {
  for (const t of ["clinic_sessions", "clinical_reports", "invoices", "bookings", "coordinations"]) {
    assert.ok(NOMBRES[t], `${t} sin nombre en cristiano: el modal diría «${t}»`);
  }
});

// ── El endpoint ────────────────────────────────────────────────────────────

test("el endpoint existe donde dice el doc", () => {
  assert.ok(ruta !== null, `no existe ${REL_RUTA}`);
  assert.ok(modal !== null, `no existe ${REL_MODAL}`);
});

test("el endpoint gatea módulo y rol", () => {
  assert.ok(/hasModule\("team"\)/.test(ruta), "no exige el módulo team");
  assert.ok(/ADMIN_ROLES\.has\(userRole\)/.test(ruta), "no exige rol de administrador");
});

test("el DELETE vuelve a medir en el servidor", () => {
  // Lo importante de todo el fichero: que no se fíe del navegador. El modal
  // puede llevar horas abierto, y en ese rato le asignan una cita.
  const delet = ruta.slice(ruta.indexOf("export const DELETE"));
  assert.ok(delet.includes("await mirar(ctx, member)"), "el DELETE no vuelve a hacer la radiografía");
  assert.ok(/if \(!veredicto\.puede\)/.test(delet), "el DELETE no comprueba el veredicto");
});

test("el 23503 de PostgreSQL se traduce, no se enseña en crudo", () => {
  // Es la carrera: alguien le cuelga algo entre la medición y el borrado. La
  // para la FK, y quien lo lee no tiene por qué saber qué es un 23503.
  assert.ok(ruta.includes('"23503"'), "no se contempla la violación de FK");
  assert.ok(!/serverError\(err\);\s*\n\s*}\s*\n\s*await logAudit/.test(ruta), "el 23503 acabaría en un 500");
});

test("queda apuntado en la auditoría", () => {
  assert.ok(ruta.includes('action: "team.deleted"'), "borrar una ficha no deja rastro en el log");
  const etiquetas = leer("lib/actividad/etiquetas.js");
  assert.ok(
    etiquetas.includes('"team.deleted"'),
    "team.deleted sin frase en lib/actividad/etiquetas.js"
  );
});

test("la auditoría guarda un resumen, no la ficha entera", () => {
  // Los datos personales no se duplican en master (regla de auditoría).
  for (const campo of ["email", "phone", "hourlyCost", "annualGross", "monthlySalary", "notes"]) {
    assert.ok(
      !new RegExp(`resumen = \\{[^}]*${campo}`, "s").test(ruta),
      `el resumen de auditoría se lleva ${campo} a master`
    );
  }
});

// ── La pantalla ────────────────────────────────────────────────────────────

test("el botón solo aparece si la ficha ya está inactiva", () => {
  // La condición de Jorge, en la única línea que la puede romper.
  assert.ok(
    /openMember\.status === "inactive" && \(\s*[\r\n]\s*<button onClick=\{\(\) => setBorrando\(openMember\)\}/.test(pagina),
    "el botón «Borrar ficha» ya no está detrás de status === inactive"
  );
});

test("la pantalla no decide: pregunta", () => {
  // El modal no recibe un «puede/no puede» calculado en el navegador; lo pide.
  assert.ok(/fetch\(`\/api\/team\/\$\{member\.id\}\/borrar`\)/.test(modal), "el modal no pide la radiografía");
  assert.ok(
    /method: "DELETE"/.test(modal),
    "el modal no llama al DELETE"
  );
  assert.ok(
    !/puedeBorrarseLaFicha/.test(pagina) && !/puedeBorrarseLaFicha/.test(modal),
    "la pantalla calcula el veredicto por su cuenta: eso lo decide el servidor"
  );
});

test("el botón de borrar solo existe cuando el servidor dice que sí", () => {
  assert.ok(/\{info\?\.puede && \(/.test(modal), "el botón rojo no está detrás de info.puede");
});
