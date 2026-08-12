/**
 * _smoke-paquetes.mjs — los frenos de un paquete de módulos.
 *
 * Se ejecuta SIN base de datos y SIN servidor:
 *
 *   node scripts/_smoke-paquetes.mjs
 *
 * POR QUÉ EXISTE: hasta el 12/08/2026 los paquetes estaban escritos en
 * `lib/provisioning/catalogo.js`, y lo que impedía vender un disparate era que
 * pasaba por un diff. Al poder crearlos desde una pantalla ese freno
 * desaparece; lo que lo sustituye es `validarPaquete()`. Esto lo fija.
 */

import {
  claveDePaquete,
  nombreComparable,
  ordenarModulos,
  validarPaquete,
  loQueFalta,
  serializarPaquete,
} from "../lib/provisioning/paquetes.js";

let fallos = 0;
let pasadas = 0;

function comprobar(que, condicion, detalle = "") {
  if (condicion) {
    pasadas++;
    process.stdout.write(`  ✓ ${que}\n`);
  } else {
    fallos++;
    process.stdout.write(`  ✗ ${que}${detalle ? ` — ${detalle}` : ""}\n`);
  }
}

process.stdout.write("\n▶ La clave sale del nombre\n");
comprobar("acentos y mayúsculas fuera", claveDePaquete("Paquete Nutrición") === "paquete-nutricion");
comprobar("los símbolos se vuelven guiones", claveDePaquete("Clínica + Citas!") === "clinica-citas");
comprobar("sin guiones colgando", claveDePaquete("  ¡Hola!  ") === "hola");
comprobar("un nombre sin letras no da clave", claveDePaquete("¿¿¿???") === "");

process.stdout.write("\n▶ Dos nombres «iguales» para una persona\n");
comprobar("acentos", nombreComparable("Clínica") === nombreComparable("clinica"));
comprobar("espacios de más", nombreComparable("Paquete  Clínica") === nombreComparable("paquete clinica"));

process.stdout.write("\n▶ Los módulos se ordenan como el catálogo y sin repetir\n");
{
  const r = ordenarModulos(["team", "clients", "clients", "citas"]);
  comprobar("sin duplicados", r.length === 3, JSON.stringify(r));
  comprobar("clients va antes que team", r.indexOf("clients") < r.indexOf("team"), JSON.stringify(r));
}

process.stdout.write("\n▶ Lo que NO se puede guardar\n");
{
  const corto = validarPaquete({ nombre: "ab", modulos: ["clients"] });
  comprobar("nombre de dos letras", !corto.ok && corto.status === 422, corto.error);

  const vacio = validarPaquete({ nombre: "Paquete vacío", modulos: [] });
  comprobar("sin módulos", !vacio.ok && vacio.status === 422, vacio.error);

  const inventado = validarPaquete({ nombre: "Paquete raro", modulos: ["clients", "modulo_que_no_existe"] });
  comprobar(
    "un módulo que no existe",
    !inventado.ok && inventado.status === 422 && /modulo_que_no_existe/.test(inventado.error),
    inventado.error
  );

  // `billing` exige `clients`: es la dependencia que el alta ya impone.
  const suelto = validarPaquete({ nombre: "Solo facturación", modulos: ["billing"] });
  comprobar(
    "una dependencia que no se sostiene",
    !suelto.ok && suelto.status === 422,
    suelto.error
  );

  const repetido = validarPaquete(
    { nombre: "Paquete Clínica", modulos: ["clients"] },
    { nombresOcupados: ["paquete clinica"] }
  );
  comprobar("un nombre que ya está, aunque cambien tildes", !repetido.ok && repetido.status === 409, repetido.error);

  const claveRepetida = validarPaquete(
    { nombre: "Paquete Clínica", modulos: ["clients"] },
    { clavesOcupadas: ["paquete-clinica"] }
  );
  comprobar("una clave que ya está", !claveRepetida.ok && claveRepetida.status === 409, claveRepetida.error);
}

process.stdout.write("\n▶ Lo que SÍ se guarda\n");
{
  const bueno = validarPaquete({
    nombre: "  Paquete Clínica  ",
    descripcion: "  lo de siempre  ",
    modulos: ["clinica", "pacientes", "clients", "citas", "team", "documents", "leads", "formularios"],
  });
  comprobar("un paquete que se sostiene entra", bueno.ok, bueno.error);
  if (bueno.ok) {
    comprobar("el nombre viene sin espacios", bueno.limpio.nombre === "Paquete Clínica");
    comprobar("la clave se deduce", bueno.limpio.clave === "paquete-clinica", bueno.limpio.clave);
    comprobar("activo por defecto", bueno.limpio.activo === true);
    comprobar("los módulos quedan ordenados", bueno.limpio.modulos[0] === "clients", JSON.stringify(bueno.limpio.modulos));
  }
}

process.stdout.write("\n▶ No se completa solo: se dice qué falta\n");
{
  const faltan = loQueFalta(["billing"]);
  comprobar("a `billing` le falta `clients`", faltan.includes("clients"), JSON.stringify(faltan));
  const nada = loQueFalta(["clients"]);
  comprobar("a `clients` no le falta nada", nada.length === 0, JSON.stringify(nada));
}

process.stdout.write("\n▶ La forma que espera el alta\n");
{
  const s = serializarPaquete({ id: "x", clave: "k", nombre: "N", descripcion: null, modulos: ["clients"], orden: 3, activo: false });
  comprobar("`key` y no `clave`", s.key === "k");
  comprobar("`desc` y no `descripcion`", s.desc === "");
  comprobar("respeta activo=false", s.activo === false);
}

process.stdout.write(`\n${fallos === 0 ? "✓" : "✗"} ${pasadas} bien · ${fallos} mal\n\n`);
process.exit(fallos === 0 ? 0 : 1);
