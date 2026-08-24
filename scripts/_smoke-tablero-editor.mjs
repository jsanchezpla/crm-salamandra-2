// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-tablero-editor.mjs — que escribir en el Registro desde la pantalla no
 * se lleve nada por delante (24/08/2026).
 *
 * ── QUÉ SE ESTÁ PROTEGIENDO ───────────────────────────────────────────────
 * `lib/tablero/editor.js` reescribe el documento del Registro y lo publica. Ese
 * documento son 133 tareas escritas a mano durante un mes, con su manual, sus
 * separadores y sus sellos, y es la única lista que existe de lo que hay que
 * hacer. Un fallo aquí no da un error en pantalla: publica una versión
 * *parecida*, el freno del 70 % la deja pasar porque el número de tareas cuadra,
 * y lo que se pierde se descubre semanas después.
 *
 * Por eso casi todas las pruebas de aquí no miran lo que cambia, sino LO QUE NO
 * DEBERÍA HABER CAMBIADO: `sinTocarNadaMas()` compara el documento entero menos
 * el bloque de la tarea. Es la comprobación que caza que se haya comido una
 * línea en blanco, el manual, o el `---` de separación.
 *
 * Y todas terminan pasando por `comprobar()`, que es la puerta real: si lo que
 * sale de aquí no pasa esa puerta, no se publica y el tablero se queda mudo.
 */

import { test, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { comprobar, trocear, seccionDeHoy } from "../lib/tablero/parser.js";
import { tipoParaVerEnPantalla } from "../lib/buzon/buzon.js";
import { extensionPorContenido } from "../lib/documents/documentStorage.js";
import { claveDeTarea } from "../lib/tablero/estado.js";
import {
  ErrorDeEdicion,
  bloqueDeTarea,
  borrarTarea,
  cerrarTarea,
  crearTarea,
  editarTarea,
  fechaDeSeccion,
  localizar,
  moverTarea,
  nuevaFicha,
} from "../lib/tablero/editor.js";

/* ── Un documento de ejemplo con todo lo que estorba de verdad ────────────── */

const TAREA = (titulo, cola = "`aumenta`", ficha = null) =>
  `### ${titulo} · ${cola}\n\n` +
  (ficha ? `<!--id:${ficha}-->\n\n` : "") +
  `**Lo que pasa.** Algo pasa.\n\n` +
  `*Se comprueba*: mirándolo.\n` +
  `*Comprobado en producción*: 24/08/2026 — visto.\n`;

const BACKLOG = `# Registro

Una línea de presentación.

## Cómo se usa esto

Esto es el manual y NO se toca.

### Prioridades

Alta, Media, Baja.

---

## Alta

${TAREA("La primera arde", "`aumenta`", "aaa111")}
## Media

${TAREA("La segunda espera", "`nutri_laura`, todos")}
${TAREA("La tercera también", "producto", "ccc333")}
## Pendiente de una decisión suya

${TAREA("Esta la decidís vosotros", "todos")}`;

const RESUELTO = `# Resuelto

## Cómo se usa esto

Manual.

## 23/08/2026

### Algo de ayer · \`demo\`

Cuerpo de ayer.

## 21/08/2026

### Algo de antes · \`aumenta\`

Cuerpo viejo.
`;

/** Una sucesión de números fija, para que las fichas de las pruebas no bailen. */
const dado = (...valores) => {
  let i = 0;
  return () => valores[i++ % valores.length];
};

/**
 * El documento sin el bloque de una tarea, para poder comparar «todo lo demás».
 * Se quita por título, que es lo que sobrevive a que el bloque se mueva.
 */
function sinLaTarea(texto, titulo) {
  const lineas = texto.split("\n");
  const inicio = lineas.findIndex((l) => l.startsWith(`### ${titulo} ·`));
  if (inicio >= 0) {
    let fin = inicio + 1;
    while (fin < lineas.length && !/^#{2,3}\s/.test(lineas[fin])) fin++;
    lineas.splice(inicio, fin - inicio);
  }
  // La normalización se aplica SIEMPRE, también cuando la tarea no estaba (que
  // es el caso del documento «antes» al crear una). Si no, se comparaba un texto
  // recortado contra uno sin recortar y saltaba por un salto de línea.
  return lineas.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Que sólo haya cambiado el bloque de esa tarea, y nada más del documento. */
function sinTocarNadaMas(antes, despues, titulo) {
  assert.equal(
    sinLaTarea(despues, titulo),
    sinLaTarea(antes, titulo),
    "ha cambiado algo fuera del bloque de la tarea"
  );
}

/** Ninguna operación puede dejar el documento sin poder publicarse. */
function publicable(texto, nombre = "backlog") {
  const r = comprobar(texto, nombre);
  assert.deepEqual(r.errores, [], `el documento resultante no se podría publicar: ${r.errores}`);
  return r;
}

/* ── Localizar ───────────────────────────────────────────────────────────── */

describe("localizar: la ficha manda, el título es el respaldo", () => {
  it("encuentra por ficha aunque el título no se parezca en nada", () => {
    const d = localizar(BACKLOG, { id: "aaa111" });
    assert.equal(d.tarea.titulo, "La primera arde");
    assert.equal(seccionDeHoy(d.seccion.titulo), "Alta");
  });

  it("encuentra por título normalizado las de antes, que no llevan ficha", () => {
    const d = localizar(BACKLOG, { clave: claveDeTarea("La segunda espera") });
    assert.equal(d.tarea.id, null);
    assert.equal(seccionDeHoy(d.seccion.titulo), "Media");
  });

  it("NO encuentra los «###» del manual: ahí dentro no hay tareas", () => {
    assert.equal(localizar(BACKLOG, { clave: claveDeTarea("Prioridades") }), null);
  });

  it("una tarea que ya no está devuelve null, no revienta", () => {
    assert.equal(localizar(BACKLOG, { id: "nolaya" }), null);
  });
});

/* ── Crear ───────────────────────────────────────────────────────────────── */

describe("crearTarea: apuntar sin abrir un editor", () => {
  it("la pega al final de su sección y le da ficha, sin tocar el resto", () => {
    const { texto, id } = crearTarea(
      BACKLOG,
      {
        seccion: "Alta",
        titulo: "Lo nuevo",
        quien: "`demo`",
        cuerpo: "**Lo que pasa.** Nada todavía.",
      },
      dado(0.1)
    );
    publicable(texto);
    sinTocarNadaMas(BACKLOG, texto, "Lo nuevo");

    const alta = trocear(texto).find((s) => seccionDeHoy(s.titulo) === "Alta");
    assert.deepEqual(
      alta.tareas.map((t) => t.titulo),
      ["La primera arde", "Lo nuevo"],
      "la nueva va al final de su sección, no delante de lo que ya había"
    );
    assert.equal(alta.tareas[1].id, id);
    assert.equal(alta.tareas[1].quien, "demo");
    // La ficha NO se ve en el cuerpo: el cuerpo se pinta como texto plano.
    assert.equal(alta.tareas[1].cuerpo, "**Lo que pasa.** Nada todavía.");
  });

  it("el manual sigue intacto, con su «###» y su separador", () => {
    const { texto } = crearTarea(
      BACKLOG,
      { seccion: "Media", titulo: "Otra", quien: "interno", cuerpo: "x" },
      dado(0.5)
    );
    assert.match(texto, /## Cómo se usa esto\n\nEsto es el manual y NO se toca\./);
    assert.match(texto, /### Prioridades/);
    assert.match(texto, /\n---\n/);
  });

  /*
   * El estreno de «Sin comprobar»: la primera tarea apuntada desde el móvil
   * llega a un documento donde esa sección todavía no está escrita.
   */
  it("crea la sección que falta, y en el orden que le toca", () => {
    const { texto } = crearTarea(
      BACKLOG,
      { seccion: "Sin comprobar", titulo: "Lo del coche", quien: "interno", cuerpo: "Sin mirar." },
      dado(0.2)
    );
    publicable(texto);
    const titulos = trocear(texto).map((s) => seccionDeHoy(s.titulo));
    assert.deepEqual(titulos, ["Alta", "Media", "Pendiente de una decisión suya", "Sin comprobar"]);
  });

  it("una sección inventada no entra", () => {
    assert.throws(
      () => crearTarea(BACKLOG, { seccion: "P0 — hoy", titulo: "x", quien: "", cuerpo: "y" }),
      ErrorDeEdicion,
      "los nombres viejos se leen, pero no se escriben"
    );
  });

  it("dos tareas con el mismo título no entran: la pantalla las usaría como una", () => {
    assert.throws(
      () =>
        crearTarea(BACKLOG, {
          seccion: "Media",
          titulo: "La primera arde",
          quien: "`demo`",
          cuerpo: "x",
        }),
      /Ya hay una tarea con ese título/
    );
  });

  it("un «##» dentro del cuerpo no entra: partiría la tarea en dos", () => {
    assert.throws(
      () =>
        crearTarea(BACKLOG, {
          seccion: "Media",
          titulo: "Con cabecera",
          quien: "interno",
          cuerpo: "Primero.\n\n## Y aquí se parte\n\nSegundo.",
        }),
      /parte la tarea en dos/
    );
  });

  it("un título vacío o de dos líneas no entra", () => {
    const base = { seccion: "Media", quien: "interno", cuerpo: "x" };
    assert.throws(() => crearTarea(BACKLOG, { ...base, titulo: "   " }), /necesita un título/);
    assert.throws(() => crearTarea(BACKLOG, { ...base, titulo: "a\nb" }), /una línea/);
  });
});

/* ── Mover: eso es cambiar la prioridad ──────────────────────────────────── */

describe("moverTarea: la prioridad ES la sección, así que cambiarla es mover", () => {
  it("el bloque viaja entero —cuerpo, sello y ficha— y sale de donde estaba", () => {
    const texto = moverTarea(BACKLOG, { id: "aaa111", aSeccion: "Baja" });
    publicable(texto);

    const secciones = trocear(texto);
    const alta = secciones.find((s) => seccionDeHoy(s.titulo) === "Alta");
    const baja = secciones.find((s) => seccionDeHoy(s.titulo) === "Baja");
    assert.equal(alta, undefined, "«Alta» se queda sin tareas y deja de pintarse");

    const movida = baja.tareas[0];
    assert.equal(movida.titulo, "La primera arde");
    assert.equal(movida.id, "aaa111", "la ficha se ha perdido por el camino");
    assert.equal(movida.quien, "aumenta");
    assert.match(movida.cuerpo, /\*Comprobado en producción\*/);
  });

  it("mover no reescribe la tarea: el bloque es el mismo texto", () => {
    const texto = moverTarea(BACKLOG, { clave: claveDeTarea("La segunda espera"), aSeccion: "Alta" });
    publicable(texto);
    sinTocarNadaMas(BACKLOG, texto, "La segunda espera");
    // Sigue sin ficha: mover no es tocar la tarea, es tocar dónde está.
    assert.equal(localizar(texto, { clave: claveDeTarea("La segunda espera") }).tarea.id, null);
  });

  it("mover a una sala de espera vale igual", () => {
    const texto = moverTarea(BACKLOG, { id: "ccc333", aSeccion: "Sin comprobar" });
    publicable(texto);
    const sin = trocear(texto).find((s) => s.titulo === "Sin comprobar");
    assert.equal(sin.tareas[0].titulo, "La tercera también");
  });

  it("mover una tarea a donde ya está se dice, no se hace", () => {
    assert.throws(() => moverTarea(BACKLOG, { id: "aaa111", aSeccion: "Alta" }), /ya está/);
  });

  it("mover una que ya no existe explica que hay que recargar", () => {
    assert.throws(() => moverTarea(BACKLOG, { id: "zzz999", aSeccion: "Alta" }), /Recarga/);
  });
});

/* ── Editar ──────────────────────────────────────────────────────────────── */

describe("editarTarea: reescribir en su sitio", () => {
  it("cambia lo que se manda y deja igual lo que no", () => {
    const { texto } = editarTarea(BACKLOG, { id: "aaa111", titulo: "La primera ya no arde" });
    publicable(texto);
    const t = localizar(texto, { id: "aaa111" }).tarea;
    assert.equal(t.titulo, "La primera ya no arde");
    assert.equal(t.quien, "aumenta", "no se ha mandado el cliente, no debería cambiar");
    assert.match(t.cuerpo, /\*\*Lo que pasa\.\*\* Algo pasa\./);
    assert.equal(seccionDeHoy(localizar(texto, { id: "aaa111" }).seccion.titulo), "Alta");
  });

  /*
   * Aquí está la razón de ser de la ficha: reescribir el título rompía el
   * casado con `tablero_estado`, y con un adjunto de por medio eso deja un
   * fichero que ya no alcanza nadie.
   */
  it("cambiar el título NO pierde la ficha: es justo lo que la ficha viene a arreglar", () => {
    const { texto, id } = editarTarea(BACKLOG, { id: "aaa111", titulo: "Otro título del todo" });
    assert.equal(id, "aaa111");
    assert.equal(localizar(texto, { id: "aaa111" }).tarea.titulo, "Otro título del todo");
  });

  it("una tarea vieja sin ficha gana una al tocarla", () => {
    const antes = localizar(BACKLOG, { clave: claveDeTarea("La segunda espera") });
    assert.equal(antes.tarea.id, null);
    const { texto, id } = editarTarea(
      BACKLOG,
      { clave: claveDeTarea("La segunda espera"), cuerpo: "**Lo que pasa.** Otra cosa." },
      dado(0.3)
    );
    publicable(texto);
    assert.match(id, /^[a-z0-9]{6}$/);
    assert.equal(localizar(texto, { id }).tarea.titulo, "La segunda espera");
  });

  it("no se puede renombrar una tarea al título de otra", () => {
    assert.throws(
      () => editarTarea(BACKLOG, { id: "aaa111", titulo: "La tercera también" }),
      /otra tarea con ese título/
    );
  });
});

/* ── Borrar ──────────────────────────────────────────────────────────────── */

describe("borrarTarea: para lo que nunca debió apuntarse", () => {
  it("la quita y no toca nada más", () => {
    const { texto, tarea } = borrarTarea(BACKLOG, { id: "ccc333" });
    publicable(texto);
    sinTocarNadaMas(BACKLOG, texto, "La tercera también");
    assert.equal(tarea.titulo, "La tercera también");
    assert.equal(localizar(texto, { id: "ccc333" }), null);
  });

  it("no deja un agujero de líneas en blanco donde estaba", () => {
    const { texto } = borrarTarea(BACKLOG, { id: "ccc333" });
    assert.doesNotMatch(texto, /\n{3,}/, "han quedado huecos de más al cortar el bloque");
  });
});

/* ── Cerrar ──────────────────────────────────────────────────────────────── */

describe("cerrarTarea: del backlog a Resuelto, con lo que la arregló", () => {
  const HOY = new Date(2026, 7, 24); // 24/08/2026

  it("sale de uno y entra en el otro, bajo la fecha de hoy y arriba del todo", () => {
    const r = cerrarTarea(BACKLOG, RESUELTO, {
      id: "aaa111",
      comoSeArreglo: "Lo arregló el commit 6ffb4f5.",
      fecha: HOY,
    });
    publicable(r.backlog, "backlog");
    publicable(r.resuelto, "resuelto");

    assert.equal(localizar(r.backlog, { id: "aaa111" }), null, "sigue en el backlog");

    const secciones = trocear(r.resuelto);
    assert.deepEqual(
      secciones.map((s) => s.titulo),
      ["24/08/2026", "23/08/2026", "21/08/2026"],
      "lo más reciente va arriba, o `comprobar` lo rechaza"
    );
    const cerrada = secciones[0].tareas[0];
    assert.equal(cerrada.titulo, "La primera arde");
    assert.equal(cerrada.id, "aaa111", "la ficha viaja: sus capturas siguen siendo suyas");
  });

  it("guarda cómo se arregló SIN borrar lo que se apuntó en su día", () => {
    const r = cerrarTarea(BACKLOG, RESUELTO, {
      id: "aaa111",
      comoSeArreglo: "Un `mx-auto` en el contenedor.",
      fecha: HOY,
    });
    const cerrada = trocear(r.resuelto)[0].tareas[0];
    assert.match(cerrada.cuerpo, /\*\*Lo que pasa\.\*\* Algo pasa\./);
    assert.match(cerrada.cuerpo, /\*Comprobado en producción\*/);
    assert.match(cerrada.cuerpo, /\*\*Cómo se arregló\.\*\* Un `mx-auto` en el contenedor\./);
  });

  it("si ya hay sección de hoy, entra dentro y no se crea otra", () => {
    const conHoy = RESUELTO.replace("## 23/08/2026", "## 24/08/2026");
    const r = cerrarTarea(BACKLOG, conHoy, {
      id: "aaa111",
      comoSeArreglo: "Ya estaba.",
      fecha: HOY,
    });
    publicable(r.resuelto, "resuelto");
    const secciones = trocear(r.resuelto);
    assert.equal(secciones.filter((s) => s.titulo === "24/08/2026").length, 1);
    assert.deepEqual(
      secciones[0].tareas.map((t) => t.titulo),
      ["Algo de ayer", "La primera arde"]
    );
  });

  it("cerrar sin decir qué lo arregló no se deja", () => {
    assert.throws(
      () => cerrarTarea(BACKLOG, RESUELTO, { id: "aaa111", comoSeArreglo: "  ", fecha: HOY }),
      /qué la arregló/
    );
  });

  it("la fecha se escribe como la escribe una persona, con ceros delante", () => {
    assert.equal(fechaDeSeccion(new Date(2026, 0, 5)), "05/01/2026");
    assert.equal(fechaDeSeccion(new Date(2026, 11, 31)), "31/12/2026");
  });
});

/* ── Fichas ──────────────────────────────────────────────────────────────── */

describe("nuevaFicha", () => {
  /*
   * Un documento cuya única ficha es la que sale con el dado a cero («aaaaaa»),
   * que es lo que hace comprobables las dos pruebas de abajo. Las fichas del
   * BACKLOG de ejemplo llevan un «1», que no está en el alfabeto, así que nunca
   * saldrían por azar y no servirían para probar una colisión.
   */
  const CON_AAAAAA = "## Alta\n\n### T · `demo`\n\n<!--id:aaaaaa-->\n\nx\n";

  it("descarta la que ya está en el documento y saca la siguiente", () => {
    // Seis ceros → «aaaaaa», que está cogida. Seis 0,04 → «bbbbbb», que no.
    const d = dado(0, 0, 0, 0, 0, 0, 0.04, 0.04, 0.04, 0.04, 0.04, 0.04);
    assert.equal(nuevaFicha(CON_AAAAAA, d), "bbbbbb");
  });

  it("no usa letras que se confundan al leerlas en voz alta", () => {
    for (let i = 0; i < 100; i++) {
      assert.doesNotMatch(nuevaFicha(""), /[lo01]/);
      assert.match(nuevaFicha(BACKLOG), /^[a-z0-9]{6}$/);
    }
  });

  it("se planta si el dado está roto, en vez de girar para siempre", () => {
    assert.throws(() => nuevaFicha(CON_AAAAAA, () => 0), /100 intentos/);
  });
});

/* ── Las capturas: una sola lista blanca, no dos ─────────────────────────── */

/*
 * ── POR QUÉ ESTA PRUEBA EXISTE ────────────────────────────────────────────
 * Porque el fallo ya se cometió. La pantalla llevaba su propia lista de tipos
 * que «se pueden ver» y ahí estaba `avif`, que la lista blanca del servidor NO
 * acepta. Resultado: un `.avif` se subía, la pantalla pintaba un `<img>`
 * apuntando a él, y el servidor lo mandaba como descarga — imagen rota y ni un
 * error que lo explicara.
 *
 * El arreglo fue que el tipo lo diga el servidor (`verComo`). Esto vigila lo
 * único que la pantalla sigue decidiendo por su cuenta: qué deja ELEGIR en el
 * selector de ficheros. Si alguien añade un formato ahí y no a la lista blanca,
 * vuelve el mismo fallo.
 */
describe("lo que se puede subir y lo que se puede enseñar dicen lo mismo", () => {
  const EDITOR = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "components", "admin", "TableroEditor.jsx"),
    "utf8"
  );

  /** Los tipos del `accept=` del selector de ficheros de las capturas. */
  const aceptados = () => {
    const m = EDITOR.match(/accept="([^"]+)"/);
    assert.ok(m, "ha desaparecido el `accept` del selector de capturas");
    return m[1].split(",").map((s) => s.trim()).filter(Boolean);
  };

  // La extensión típica de cada tipo que se ofrece, para poder preguntarle a la
  // lista blanca por ella (que trabaja con extensiones, no con tipos MIME).
  const EXTENSION = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "application/pdf": "pdf",
  };

  it("todo lo que se deja elegir, el servidor sabe enseñarlo", () => {
    for (const tipo of aceptados()) {
      const ext = EXTENSION[tipo];
      assert.ok(
        ext,
        `«${tipo}» se puede elegir en la pantalla y esta prueba no sabe qué extensión es. Añádelo a EXTENSION y comprueba que la lista blanca lo acepta.`
      );
      assert.equal(
        tipoParaVerEnPantalla(`tablero/abc123/x.${ext}`),
        tipo,
        `«${tipo}» se puede elegir pero la lista blanca del servidor no lo enseña: saldría una miniatura rota.`
      );
    }
  });

  /*
   * ── EL FALLO DEL .jfif (24/08/2026) ───────────────────────────────────────
   * La primera captura que se colgó de verdad salió pintada como «fichero» en
   * vez de como imagen. Era un JPEG normal —`mime: image/jpeg`, 347 KB— que
   * Chrome en Windows había guardado como `.jfif`. Como la extensión salía del
   * NOMBRE, se guardó `.jfif`, y `jfif` no estaba en la lista blanca.
   *
   * Dos cosas lo arreglan y las dos se prueban aquí: la lista conoce ahora los
   * nombres del JPEG, y la extensión sale de los BYTES y no del nombre. La
   * segunda es la que cierra la clase: cubre también el fichero sin extensión y
   * el que alguien renombró.
   */
  it("un JPEG se reconoce por los bytes, se llame .jfif, .jpe o como sea", () => {
    const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert.equal(extensionPorContenido(JPEG), "jpg");
    // Y los tres nombres del JPEG se enseñan en pantalla, para que las capturas
    // ya guardadas con el nombre viejo no se queden sin verse.
    for (const ext of ["jpg", "jpeg", "jfif", "jpe"]) {
      assert.equal(tipoParaVerEnPantalla(`tablero/abc123/x.${ext}`), "image/jpeg", `falla .${ext}`);
    }
  });

  it("los otros cuatro tipos también salen de los bytes", () => {
    const casos = [
      ["png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])],
      ["gif", Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0])],
      ["webp", Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")])],
      ["pdf", Buffer.from("%PDF-1.7 xxxxxxx")],
    ];
    for (const [ext, bytes] of casos) {
      assert.equal(extensionPorContenido(bytes), ext);
      assert.ok(tipoParaVerEnPantalla(`x.${ext}`), `.${ext} tendría que poder verse`);
    }
  });

  it("lo que no se reconoce NO se inventa: se queda con el nombre que traía", () => {
    // Un ZIP no es ninguno de los cinco. Devolver `null` es lo que hace que el
    // que llama caiga a la extensión del nombre en vez de guardar un `.jpg` que
    // no lo es — y servir un ZIP como imagen sería peor que no verlo.
    assert.equal(extensionPorContenido(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0])), null);
    assert.equal(extensionPorContenido(Buffer.from("hola")), null, "un fichero corto no puede afirmar nada");
    assert.equal(extensionPorContenido(null), null);
  });

  it("el SVG no se puede elegir: lleva scripts dentro y se ejecutarían en nuestro origen", () => {
    assert.equal(aceptados().includes("image/svg+xml"), false);
    assert.equal(tipoParaVerEnPantalla("tablero/abc123/x.svg"), null);
  });

  it("la pantalla no vuelve a tener su propia lista de extensiones", () => {
    // El fallo original era exactamente esto: un regex de extensiones a mano.
    assert.doesNotMatch(
      EDITOR,
      /\/\\\.\(png/,
      "ha vuelto una lista de extensiones escrita a mano en la pantalla; el tipo lo dice `verComo`"
    );
    assert.match(EDITOR, /verComo/, "la pantalla ya no usa lo que dice el servidor");
  });
});

/* ── El bloque, escrito ──────────────────────────────────────────────────── */

test("bloqueDeTarea escribe el «·» solo cuando hay cliente detrás", () => {
  assert.match(bloqueDeTarea({ titulo: "T", quien: "`demo`", cuerpo: "x" }), /^### T · `demo`\n/);
  assert.match(bloqueDeTarea({ titulo: "T", quien: "", cuerpo: "x" }), /^### T\n/);
});
