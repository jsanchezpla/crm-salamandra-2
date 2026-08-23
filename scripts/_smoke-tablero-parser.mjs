// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-tablero-parser.mjs — cómo se trocea el Registro y qué se niega a
 * publicar (19/08/2026).
 *
 *   node scripts/_smoke-tablero-parser.mjs
 *   node --test-name-pattern="comprobar" scripts/_smoke-tablero-parser.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * El 19/08/2026 el texto del Registro (`backlog` y `resuelto`) dejó de viajar
 * dentro de la imagen de Docker y pasó a `master.tablero_documentos`, para que
 * apuntar una tarea no cueste un commit y un despliegue. Lo que se perdió con
 * ello es el diff de git: un `###` mal puesto ya no lo ve nadie antes de que el
 * tablero salga vacío o parta una tarea en dos. Lo sustituye `comprobar`, que
 * corre ANTES de cada escritura con el MISMO troceador que pinta la pantalla.
 *
 * Esta prueba fija las dos cosas: lo que el troceador DEVUELVE (secciones,
 * tareas, el cliente detrás del «·», el manual descartado, CRLF) y lo que
 * `comprobar` y `prepararPublicacion` dejan pasar o no. Si un día se afloja
 * una regla, aquí se ve cuál.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  trocear,
  trocearTodo,
  comprobar,
  destinatarios,
  diferenciaDeTitulos,
  contarTareas,
  SLUGS,
  SECCIONES_BACKLOG,
  DOCUMENTOS,
} from "../lib/tablero/parser.js";
import { prepararPublicacion, normalizar, MAX_BYTES } from "../lib/tablero/documentos.js";

/* ── Textos de ejemplo ────────────────────────────────────────────────────── */

const TAREA_COMPLETA = (titulo, cola = "`aumenta`") => `### ${titulo} · ${cola}

**Lo que pasa.** Algo.

*Se comprueba*: así.
*Dónde*: \`lib/x.js\`.
*Comprobado en producción*: 19/08/2026 — visto.
`;

const BACKLOG_BIEN = `# Backlog

## Cómo se usa esto

Texto del manual.

### Cada tarea lleva su sello

Esto NO es una tarea.

---

## P0 — hoy

${TAREA_COMPLETA("El buscador no encuentra por apellido")}
## P1 — esta semana

${TAREA_COMPLETA("Los correos salen en UTC", "`nutri_laura`, todos")}
${TAREA_COMPLETA("Una de producto", "producto")}
## Pendiente de una decisión suya

${TAREA_COMPLETA("Qué pasa con el dinero de una cita cancelada", "todos, producto")}
`;

const RESUELTO_BIEN = `# Resuelto

## Cómo se usa esto

Manual.

## 19/08/2026

### Arreglado hoy · \`aumenta\`

Cuerpo.

## 17/08/2026

### Arreglado antes · \`demo\`

Cuerpo.
`;

/* ── trocear ─────────────────────────────────────────────────────────────── */

describe("trocear: secciones y tareas, tal como las pinta el tablero", () => {
  it("devuelve solo las secciones con tareas y descarta el manual «Cómo se usa esto»", () => {
    const s = trocear(BACKLOG_BIEN);
    assert.deepEqual(
      s.map((x) => x.titulo),
      ["P0 — hoy", "P1 — esta semana", "Pendiente de una decisión suya"]
    );
    assert.equal(contarTareas(BACKLOG_BIEN), 4);
  });

  it("saca el cliente de detrás del ÚLTIMO «·» y lo deja fuera del título", () => {
    const [p0] = trocear(BACKLOG_BIEN);
    const t = p0.tareas[0];
    assert.equal(t.titulo, "El buscador no encuentra por apellido");
    assert.equal(t.quien, "aumenta");
    assert.deepEqual(t.quienes, ["aumenta"]);
  });

  it("una cola con dos nombres conocidos cae en los dos grupos, sin partir por comas", () => {
    const p1 = trocear(BACKLOG_BIEN)[1];
    assert.deepEqual(p1.tareas[0].quienes, ["nutri_laura", "todos"]);
    assert.deepEqual(destinatarios("nutri_laura (y todos con citas)"), ["nutri_laura", "todos"]);
  });

  it("un «·» sin nombre conocido detrás NO parte el título", () => {
    const [s] = trocear("## P0 — hoy\n\n### Una cosa · otra cosa\n\nCuerpo.\n");
    assert.equal(s.tareas[0].titulo, "Una cosa · otra cosa");
    assert.equal(s.tareas[0].quien, null);
    assert.deepEqual(s.tareas[0].quienes, []);
  });

  it("«demo» no casa dentro de «demo_clinica» ni «producto (demostración)» le cuelga la tarea a demo", () => {
    assert.deepEqual(destinatarios("demo_clinica"), ["demo_clinica"]);
    assert.deepEqual(destinatarios("producto (demostración)"), ["producto"]);
  });

  it("el cuerpo se guarda tal cual, recortado por los extremos", () => {
    const [s] = trocear(
      "## P0 — hoy\n\n### T · aumenta\n\n**Lo que pasa.** X.\n\n*Se comprueba*: Y.\n\n"
    );
    assert.equal(s.tareas[0].cuerpo, "**Lo que pasa.** X.\n\n*Se comprueba*: Y.");
  });

  it("con finales de línea CRLF sale exactamente lo mismo que con LF", () => {
    const lf = trocear(BACKLOG_BIEN);
    const crlf = trocear(BACKLOG_BIEN.replace(/\n/g, "\r\n"));
    assert.deepEqual(
      crlf.map((s) => [s.titulo, s.tareas.map((t) => [t.titulo, t.quien, t.cuerpo])]),
      lf.map((s) => [s.titulo, s.tareas.map((t) => [t.titulo, t.quien, t.cuerpo])])
    );
  });

  it("un «###» antes de la primera sección no se pinta, pero trocearTodo lo devuelve como huérfana", () => {
    const texto =
      "### Suelta · aumenta\n\nCuerpo.\n\n## P0 — hoy\n\n### Dentro · aumenta\n\nCuerpo.\n";
    assert.equal(contarTareas(texto), 1);
    const { huerfanas } = trocearTodo(texto);
    assert.deepEqual(
      huerfanas.map((t) => [t.titulo, t.linea]),
      [["Suelta", 1]]
    );
  });

  it("texto vacío o null devuelve cero secciones, no revienta", () => {
    assert.deepEqual(trocear(""), []);
    assert.deepEqual(trocear(null), []);
  });

  it("los slugs conocidos incluyen a los clientes de hoy, las demos por oficio y las bajas históricas", () => {
    for (const s of [
      "aumenta",
      "nutri_laura",
      "retorika",
      "spain_enzymes",
      "somos",
      "gm_alvar_alonso",
      "demo_clinica",
      "healim",
    ]) {
      assert.ok(SLUGS.includes(s), `falta ${s}`);
    }
  });
});

/* ── comprobar ───────────────────────────────────────────────────────────── */

describe("comprobar: lo que NO se publica (errores)", () => {
  it("un backlog bien formado pasa sin errores ni avisos", () => {
    const r = comprobar(BACKLOG_BIEN, "backlog");
    assert.deepEqual(r.errores, []);
    assert.deepEqual(r.avisos, []);
    assert.equal(r.tareas, 4);
    assert.equal(r.secciones, 3);
  });

  it("un resuelto bien formado pasa", () => {
    const r = comprobar(RESUELTO_BIEN, "resuelto");
    assert.deepEqual(r.errores, []);
    assert.equal(r.tareas, 2);
  });

  it("documento desconocido", () => {
    const r = comprobar(BACKLOG_BIEN, "pendientes");
    assert.equal(r.errores.length, 1);
    assert.match(r.errores[0], /desconocido/);
    assert.deepEqual(DOCUMENTOS, ["backlog", "resuelto"]);
  });

  it("texto vacío", () => {
    assert.match(comprobar("   \n", "backlog").errores[0], /vacío/);
  });

  it("sin ninguna tarea (solo el manual)", () => {
    const r = comprobar("## Cómo se usa esto\n\n### Apartado\n\nx\n", "backlog");
    assert.ok(r.errores.some((e) => /ninguna tarea/.test(e)));
  });

  it("una tarea antes de la primera sección, con su línea", () => {
    const r = comprobar(
      "### Suelta · aumenta\n\nx\n\n## P0 — hoy\n\n" + TAREA_COMPLETA("Dentro"),
      "backlog"
    );
    assert.ok(r.errores.some((e) => /antes de la primera sección/.test(e) && /línea 1/.test(e)));
  });

  it("en backlog, una sección que no es de las fijas", () => {
    const r = comprobar("## P5 — algún día\n\n" + TAREA_COMPLETA("T"), "backlog");
    assert.ok(r.errores.some((e) => /«P5 — algún día»/.test(e) && /no es de las fijas/.test(e)));
    assert.deepEqual(SECCIONES_BACKLOG, [
      "P0 — hoy",
      "P1 — esta semana",
      "P2 — cuando se pueda",
      "P3 — deuda",
      "Pendiente de una decisión suya",
    ]);
  });

  it("en resuelto, una sección que no es fecha", () => {
    const r = comprobar("## Agosto\n\n### T · aumenta\n\nx\n", "resuelto");
    assert.ok(r.errores.some((e) => /no es una fecha/.test(e)));
  });

  it("en resuelto, la misma fecha dos veces", () => {
    const r = comprobar(
      "## 19/08/2026\n\n### A · demo\n\nx\n\n## 19/08/2026\n\n### B · demo\n\nx\n",
      "resuelto"
    );
    assert.ok(r.errores.some((e) => /dos veces/.test(e)));
  });

  it("en resuelto, una fecha más reciente DEBAJO de una más vieja", () => {
    const r = comprobar(
      "## 17/08/2026\n\n### A · demo\n\nx\n\n## 19/08/2026\n\n### B · demo\n\nx\n",
      "resuelto"
    );
    assert.ok(r.errores.some((e) => /lo más reciente va arriba/.test(e)));
  });

  it("en resuelto, un rango de días «06–07/08/2026» vale y ordena por el último día", () => {
    const r = comprobar(
      "## 08/08/2026\n\n### A · demo\n\nx\n\n## 06–07/08/2026\n\n### B · demo\n\nx\n",
      "resuelto"
    );
    assert.deepEqual(r.errores, []);
    const mal = comprobar(
      "## 06–07/08/2026\n\n### B · demo\n\nx\n\n## 08/08/2026\n\n### A · demo\n\nx\n",
      "resuelto"
    );
    assert.ok(mal.errores.some((e) => /lo más reciente va arriba/.test(e)));
  });

  it("en resuelto, un cambio de mes o de año sigue ordenado bien (no compara como texto DD/MM)", () => {
    const r = comprobar(
      "## 01/09/2026\n\n### A · demo\n\nx\n\n## 31/08/2026\n\n### B · demo\n\nx\n\n## 31/12/2025\n\n### C · demo\n\nx\n",
      "resuelto"
    );
    assert.deepEqual(r.errores, []);
  });

  it("dos tareas con el mismo título en la misma sección", () => {
    const r = comprobar(
      "## P0 — hoy\n\n" + TAREA_COMPLETA("Igual") + TAREA_COMPLETA("Igual"),
      "backlog"
    );
    assert.ok(r.errores.some((e) => /mismo título/.test(e) && /«Igual»/.test(e)));
  });

  it("el mismo título en DOS secciones distintas no es error", () => {
    const r = comprobar(
      "## P0 — hoy\n\n" +
        TAREA_COMPLETA("Igual") +
        "## P1 — esta semana\n\n" +
        TAREA_COMPLETA("Igual"),
      "backlog"
    );
    assert.deepEqual(r.errores, []);
  });
});

describe("comprobar: lo que se publica pero se dice (avisos)", () => {
  it("en backlog, una tarea sin *Se comprueba*, sin sello o sin cliente reconocido", () => {
    const texto = "## P2 — cuando se pueda\n\n### Sin nada · nadie\n\nSolo texto.\n";
    const r = comprobar(texto, "backlog");
    assert.deepEqual(r.errores, []);
    assert.equal(r.avisos.length, 1);
    assert.match(r.avisos[0], /\*Se comprueba\*/);
    assert.match(r.avisos[0], /\*Comprobado en producción\*/);
    assert.match(r.avisos[0], /cliente reconocido/);
  });

  it("en resuelto no se avisa de esas tres líneas: las entradas viejas no las llevan", () => {
    const r = comprobar("## 10/08/2026\n\n### Vieja · demo\n\nSolo texto.\n", "resuelto");
    assert.deepEqual(r.avisos, []);
  });
});

/* ── diferenciaDeTitulos ─────────────────────────────────────────────────── */

describe("diferenciaDeTitulos: qué entra y qué sale entre dos versiones", () => {
  it("una tarea nueva entra; una cerrada sale; el resto no se nombra", () => {
    const antes = "## P0 — hoy\n\n" + TAREA_COMPLETA("A") + TAREA_COMPLETA("B");
    const despues = "## P0 — hoy\n\n" + TAREA_COMPLETA("A") + TAREA_COMPLETA("C");
    assert.deepEqual(diferenciaDeTitulos(antes, despues), { entran: ["C"], salen: ["B"] });
  });

  it("cambiar solo la cola del cliente no cuenta como entrar ni salir", () => {
    const antes = "## P0 — hoy\n\n" + TAREA_COMPLETA("A", "aumenta");
    const despues = "## P0 — hoy\n\n" + TAREA_COMPLETA("A", "aumenta, demo");
    assert.deepEqual(diferenciaDeTitulos(antes, despues), { entran: [], salen: [] });
  });

  it("sin versión anterior, todo entra", () => {
    assert.deepEqual(diferenciaDeTitulos(null, "## P0 — hoy\n\n" + TAREA_COMPLETA("A")), {
      entran: ["A"],
      salen: [],
    });
  });
});

/* ── prepararPublicacion ─────────────────────────────────────────────────── */

const actualDe = (contenido, extra = {}) => ({
  version: 12,
  contenido,
  publicadoPor: "jorge",
  nota: "la anterior",
  ...extra,
});

describe("prepararPublicacion: los frenos antes de escribir", () => {
  it("primera publicación: versión 1, todo entra, sin errores", () => {
    const r = prepararPublicacion({ nombre: "backlog", contenido: BACKLOG_BIEN, actual: null });
    assert.deepEqual(r.errores, []);
    assert.equal(r.versionNueva, 1);
    assert.equal(r.tareasAntes, 0);
    assert.equal(r.tareasDespues, 4);
    assert.equal(r.entran.length, 4);
    assert.equal(r.sinCambios, false);
  });

  it("normaliza a LF: un texto CRLF se guarda sin \\r y vale como «sin cambios» frente al mismo en LF", () => {
    assert.equal(normalizar("a\r\nb\rc\n"), "a\nb\nc\n");
    const r = prepararPublicacion({
      nombre: "backlog",
      contenido: BACKLOG_BIEN.replace(/\n/g, "\r\n"),
      actual: actualDe(BACKLOG_BIEN),
    });
    assert.equal(r.sinCambios, true);
    assert.equal(r.contenido.includes("\r"), false);
  });

  it("la versión siguiente es actual + 1 y una tarea nueva sale en «entran»", () => {
    const nuevo = BACKLOG_BIEN + "\n## P3 — deuda\n\n" + TAREA_COMPLETA("Nueva");
    const r = prepararPublicacion({
      nombre: "backlog",
      contenido: nuevo,
      actual: actualDe(BACKLOG_BIEN),
    });
    assert.deepEqual(r.errores, []);
    assert.equal(r.versionNueva, 13);
    assert.deepEqual(r.entran, ["Nueva"]);
    assert.deepEqual(r.salen, []);
  });

  it("los errores de formato frenan, y no se levantan con forzar", () => {
    const r = prepararPublicacion({
      nombre: "backlog",
      contenido: "## P9\n\n" + TAREA_COMPLETA("T"),
      actual: actualDe(BACKLOG_BIEN),
      forzar: true,
    });
    assert.ok(r.errores.some((e) => /no es de las fijas/.test(e)));
  });

  it("base distinta de la versión actual: error que dice las dos versiones y quién publicó en medio", () => {
    const r = prepararPublicacion({
      nombre: "backlog",
      contenido: BACKLOG_BIEN + "\n## P3 — deuda\n\n" + TAREA_COMPLETA("Nueva"),
      actual: actualDe(BACKLOG_BIEN),
      base: 11,
    });
    assert.equal(r.errores.length, 1);
    assert.match(r.errores[0], /bajaste la v11/);
    assert.match(r.errores[0], /ahora está la v12/);
    assert.match(r.errores[0], /jorge/);
    assert.match(r.errores[0], /«la anterior»/);
  });

  it("base igual a la actual: pasa; sin base (null): también", () => {
    const nuevo = BACKLOG_BIEN + "\n## P3 — deuda\n\n" + TAREA_COMPLETA("Nueva");
    assert.deepEqual(
      prepararPublicacion({
        nombre: "backlog",
        contenido: nuevo,
        actual: actualDe(BACKLOG_BIEN),
        base: 12,
      }).errores,
      []
    );
    assert.deepEqual(
      prepararPublicacion({
        nombre: "backlog",
        contenido: nuevo,
        actual: actualDe(BACKLOG_BIEN),
        base: null,
      }).errores,
      []
    );
  });

  it("con forzar, la base vieja pasa de error a aviso", () => {
    const r = prepararPublicacion({
      nombre: "backlog",
      contenido: BACKLOG_BIEN + "\n## P3 — deuda\n\n" + TAREA_COMPLETA("Nueva"),
      actual: actualDe(BACKLOG_BIEN),
      base: 11,
      forzar: true,
    });
    assert.deepEqual(r.errores, []);
    assert.ok(r.avisos.some((a) => /--forzar/.test(a) && /se pierde/.test(a)));
  });

  it("si salen más del 30 % de las tareas, frena («parece medio fichero») salvo con forzar", () => {
    const dosDeCuatro =
      "## P0 — hoy\n\n" +
      TAREA_COMPLETA("El buscador no encuentra por apellido") +
      TAREA_COMPLETA("Otra");
    const sin = prepararPublicacion({
      nombre: "backlog",
      contenido: dosDeCuatro,
      actual: actualDe(BACKLOG_BIEN),
    });
    assert.ok(sin.errores.some((e) => /medio fichero/.test(e) && /--forzar/.test(e)));
    const con = prepararPublicacion({
      nombre: "backlog",
      contenido: dosDeCuatro,
      actual: actualDe(BACKLOG_BIEN),
      forzar: true,
    });
    assert.deepEqual(con.errores, []);
    assert.ok(con.avisos.some((a) => /medio fichero/.test(a)));
  });

  it("cerrar una tarea de cuatro (queda el 75 %) NO frena: es lo normal", () => {
    const tresDeCuatro = BACKLOG_BIEN.replace(TAREA_COMPLETA("Una de producto", "producto"), "");
    const r = prepararPublicacion({
      nombre: "backlog",
      contenido: tresDeCuatro,
      actual: actualDe(BACKLOG_BIEN),
    });
    assert.deepEqual(r.errores, []);
    assert.deepEqual(r.salen, ["Una de producto"]);
  });

  it("un texto por encima del tope de bytes no entra", () => {
    const enorme = "## P0 — hoy\n\n" + TAREA_COMPLETA("T") + "x".repeat(MAX_BYTES);
    const r = prepararPublicacion({ nombre: "backlog", contenido: enorme, actual: null });
    assert.ok(r.errores.some((e) => /tope/.test(e)));
  });

  it("el mismo texto que la versión actual es «sin cambios»", () => {
    const r = prepararPublicacion({
      nombre: "backlog",
      contenido: BACKLOG_BIEN,
      actual: actualDe(BACKLOG_BIEN),
    });
    assert.equal(r.sinCambios, true);
    assert.deepEqual(r.errores, []);
  });
});
