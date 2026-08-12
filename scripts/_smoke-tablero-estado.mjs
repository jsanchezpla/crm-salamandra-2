/**
 * _smoke-tablero-estado.mjs — el tick y el reparto del Registro (12/08/2026).
 *
 * Lógica pura, sin base de datos ni servidor:
 *   node scripts/_smoke-tablero-estado.mjs
 *
 * Se prueba aquí y no por la pantalla porque el Registro es del back-office:
 * hace falta ser admin de `salamandra_solutions`, que en local no existe. Lo que
 * decide algo —en qué pestaña cae cada tarea— es esto, y cabe en un fichero.
 *
 * Lo que se fija:
 *   · sin nada guardado, el tablero sale exactamente como los ficheros;
 *   · marcar una de `backlog.md` la saca de Pendiente y la pinta en Resuelto,
 *     en su propio bloque y diciendo de qué sección venía;
 *   · quitarle el tick a una de `resuelto.md` hace el camino contrario;
 *   · asignar NO mueve nada (son dos cosas distintas);
 *   · una sección que se queda sin tareas no se pinta vacía;
 *   · un fichero que no se pudo leer sigue siendo `null` y no una lista vacía,
 *     que es lo que deja a la pantalla poder decir «no se ha podido leer»;
 *   · y la clave sobrevive a acentos, signos y mayúsculas, que es de lo que
 *     depende que un tick siga pegado a su tarea.
 */

import {
  claveDeTarea,
  repartirPorEstado,
  SECCION_MARCADAS,
  SECCION_REABIERTAS,
} from "../lib/tablero/estado.js";

let fallos = 0;
function check(etiqueta, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  process.stdout.write(`${ok ? "✓" : "✗"} ${etiqueta}\n`);
  if (!ok) process.stdout.write(`    esperado ${JSON.stringify(esperado)}, salió ${JSON.stringify(real)}\n`);
}

const tarea = (titulo) => ({ titulo, quien: null, quienes: [], cuerpo: "" });

const PENDIENTE = [
  { titulo: "P0 — hoy", tareas: [tarea("El acceso SSH admite contraseña")] },
  { titulo: "P1 — esta semana", tareas: [tarea("No se puede cerrar sesión"), tarea("Pedirle otra tarjeta")] },
];
const RESUELTO = [{ titulo: "12/08/2026", tareas: [tarea("Los trece de Aumenta ven lo que tienen que ver")] }];

/** Lo que devuelve la tabla: un Map de clave → fila. */
const guardado = (pares) => new Map(pares.map(([t, fila]) => [claveDeTarea(t), fila]));

const titulos = (secciones) => (secciones ?? []).map((s) => [s.titulo, s.tareas.map((t) => t.titulo)]);

process.stdout.write("\n▶ Sin nada guardado, manda el fichero\n");
{
  const r = repartirPorEstado(PENDIENTE, RESUELTO, new Map());
  check("pendiente, igual que el fichero", titulos(r.pendiente), [
    ["P0 — hoy", ["El acceso SSH admite contraseña"]],
    ["P1 — esta semana", ["No se puede cerrar sesión", "Pedirle otra tarjeta"]],
  ]);
  check("resuelto, igual que el fichero", titulos(r.resuelto), [
    ["12/08/2026", ["Los trece de Aumenta ven lo que tienen que ver"]],
  ]);
  check("cada tarea sale sin dueño y sin tick", [
    r.pendiente[0].tareas[0].asignadoA,
    r.pendiente[0].tareas[0].marcada,
    r.pendiente[0].tareas[0].fuente,
  ], [null, null, "backlog"]);
}

process.stdout.write("\n▶ El tick mueve de pestaña\n");
{
  const r = repartirPorEstado(
    PENDIENTE,
    RESUELTO,
    guardado([["Pedirle otra tarjeta", { asignadoA: "jorge", resuelta: true, tocadaPor: "rodrigo@x" }]])
  );
  check("sale de Pendiente", titulos(r.pendiente), [
    ["P0 — hoy", ["El acceso SSH admite contraseña"]],
    ["P1 — esta semana", ["No se puede cerrar sesión"]],
  ]);
  check("entra en Resuelto, en su bloque y arriba", titulos(r.resuelto), [
    [SECCION_MARCADAS, ["Pedirle otra tarjeta"]],
    ["12/08/2026", ["Los trece de Aumenta ven lo que tienen que ver"]],
  ]);
  check("y se acuerda de dónde venía", r.resuelto[0].tareas[0].deSeccion, "P1 — esta semana");
  check("con su dueño puesto", r.resuelto[0].tareas[0].asignadoA, "jorge");
}

process.stdout.write("\n▶ Quitar el tick hace el camino contrario\n");
{
  const r = repartirPorEstado(
    PENDIENTE,
    RESUELTO,
    guardado([["Los trece de Aumenta ven lo que tienen que ver", { asignadoA: null, resuelta: false }]])
  );
  check("vuelve a Pendiente, en su bloque", titulos(r.pendiente)[0], [
    SECCION_REABIERTAS,
    ["Los trece de Aumenta ven lo que tienen que ver"],
  ]);
  check("y Resuelto se queda sin secciones vacías", titulos(r.resuelto), []);
}

process.stdout.write("\n▶ Asignar no mueve nada\n");
{
  const r = repartirPorEstado(
    PENDIENTE,
    RESUELTO,
    guardado([["No se puede cerrar sesión", { asignadoA: "rodrigo", resuelta: null }]])
  );
  check("sigue en su sitio", titulos(r.pendiente)[1], [
    "P1 — esta semana",
    ["No se puede cerrar sesión", "Pedirle otra tarjeta"],
  ]);
  check("con dueño", r.pendiente[1].tareas[0].asignadoA, "rodrigo");
  check("y sin tick", r.pendiente[1].tareas[0].marcada, null);
}

process.stdout.write("\n▶ Un fichero que no se pudo leer sigue siendo null\n");
{
  const r = repartirPorEstado(null, RESUELTO, new Map());
  check("pendiente null, no lista vacía", r.pendiente, null);
  check("y el otro se pinta igual", titulos(r.resuelto).length, 1);
}

process.stdout.write("\n▶ La clave aguanta cómo se escriben los títulos\n");
check(
  "acentos, signos y mayúsculas",
  claveDeTarea("¿Se apaga la puerta GLOBAL del formulario?"),
  "se-apaga-la-puerta-global-del-formulario"
);
check(
  "la misma tarea escrita igual da la misma clave",
  claveDeTarea("El Registro deja de ser de solo lectura") === claveDeTarea("El Registro deja de ser de solo lectura"),
  true
);
check(
  "dos tareas distintas, dos claves",
  claveDeTarea("Una cosa") === claveDeTarea("Otra cosa"),
  false
);
check("un título vacío no revienta", claveDeTarea(null), "");

process.stdout.write(fallos ? `\n✗ ${fallos} fallo(s)\n\n` : "\n✓ Todo correcto\n\n");
process.exit(fallos ? 1 : 0);
