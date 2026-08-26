/**
 * sembrar-fechas-de-alta.js — reconstruye CUÁNDO SE APUNTÓ cada tarea del
 * Registro y lo guarda en `master.tablero_estado.apuntada_en`.
 *
 * POR QUÉ HACE FALTA (26/08/2026, Jorge: «que se apunte la fecha de cuando se
 * añadió la tarea y que se pueda ordenar por fecha»)
 * A partir de hoy la fecha se pone sola: `sellarAltas` (lib/tablero/documentos.js)
 * se la pone a lo que entre, publique quien publique. Pero las ~150 tareas que
 * ya estaban escritas no tienen ninguna, y sin ellas el orden por fecha nace
 * mintiendo: o salen todas el mismo día, o salen todas sin fecha.
 *
 * De dónde sale la verdad: `master.tablero_documentos` es APPEND-ONLY y guarda
 * las últimas 50 versiones de cada documento. O sea que la respuesta ya está
 * escrita — hay que recorrer las versiones de la más vieja a la más nueva y ver
 * en cuál aparece cada tarea por primera vez.
 *
 * LO QUE NO ES TRIVIAL: LOS RENOMBRADOS
 * Una tarea se identifica por su título normalizado, así que reescribir el
 * título parece una tarea que se va y otra que llega. Y pasó en bloque: el
 * 25/08 se reescribieron ONCE títulos de golpe para que se leyeran en cristiano
 * (v30 del backlog: +11 y −11). Sin emparejarlos, DIEZ de las veinte tareas
 * vivas dirían que se apuntaron el 25/08, que es el día que se les cambió el
 * nombre. Se emparejan por tres cosas, en este orden:
 *
 *   1. la FICHA `<!--id:…-->`, si las dos la llevan — es lo único de verdad
 *      estable, pero solo la tienen las tareas tocadas desde el tablero;
 *   2. el CUERPO idéntico — un renombrado no toca el cuerpo, y esto solo casó
 *      9 de los 11 porque a dos también se les retocó el texto;
 *   3. el TÍTULO parecido (la mitad de las palabras largas en común), que es lo
 *      que recoge esos dos.
 *
 * Todo lo que empareja se IMPRIME, para poder mirarlo antes de escribir nada.
 *
 * LO QUE ESTE SCRIPT NO PUEDE SABER
 * El Registro vivió en `docs/backlog.md` (git) del 08/08 al 19/08/2026, y las
 * versiones de la tabla empiezan ahí. Una tarea que ya estaba escrita el día de
 * la mudanza sale como «apuntada el 19/08», que es cuando se mudó y no cuando se
 * escribió. Son dos del backlog de hoy, y las dos llevan su fecha de verdad
 * puesta a mano abajo (`DEL_TIEMPO_DE_GIT`), sacada del commit que las apuntó.
 *
 * Y un tope que evita el absurdo en Resuelto: una tarea no puede haberse
 * apuntado DESPUÉS del día en que se cerró. Las secciones de `resuelto` son
 * fechas, así que ahí hay un techo escrito; cuando la reconstrucción da algo
 * posterior (las cien y pico que ya estaban cerradas el día de la mudanza),
 * manda el techo.
 *
 * Uso local:  node --env-file=.env.local scripts/sembrar-fechas-de-alta.js [--confirm]
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/sembrar-fechas-de-alta.js [--confirm]
 *
 * Sin `--confirm` no escribe NADA: enseña lo que haría. Con `--rehacer` además
 * pisa las fechas que ya estén puestas (para cuando se haya publicado algo antes
 * de sembrar y `sellarAltas` las haya fechado hoy por no saber más).
 *
 * Es idempotente y se puede repetir.
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { trocear } from "../lib/tablero/parser.js";
import { claveDeTarea } from "../lib/tablero/estado.js";

const CONFIRMA = process.argv.includes("--confirm");
const REHACER = process.argv.includes("--rehacer");

/**
 * Las que ya estaban escritas antes de que el Registro se mudara a la base, con
 * la fecha del commit que las apuntó en `docs/backlog.md`. No se pueden sacar de
 * la tabla: ese historial es de git y se quedó allí.
 *
 * La clave es la que tenían EN LA v1, no la de hoy: a la primera le cambiaron el
 * título el 25/08 y la reconstrucción ya sabe seguirle el rastro hasta aquí.
 */
const DEL_TIEMPO_DE_GIT = new Map([
  // «El correo de entrada de Soporte necesita tres cosas que no están en el
  // código» — commit 3914e29, 12/08/2026 (venía de «Lo que un cliente escriba
  // por correo a Soporte no llega a ningún sitio», del mismo día).
  ["el-correo-de-entrada-de-soporte-necesita-tres-cosas-que-no-estan-en-el-codigo", "2026-08-12"],
  // «El formulario de profesionales funciona pero ningún enlace publicado lleva
  // a él» — commit 297073f, 12/08/2026 («once tareas nuevas de Jorge»).
  ["el-formulario-de-profesionales-funciona-pero-ningun-enlace-publicado-lleva-a-el", "2026-08-12"],
  // «¿Qué es «ganado» en el embudo de Aumenta?» — commit ac6f8b2, 17/08/2026.
  // Nació al cerrar la del embudo, como la pregunta que quedaba abierta; hoy se
  // llama «Falta decidir qué cuenta como "ganado"…».
  ["que-es-ganado-en-el-embudo-de-aumenta", "2026-08-17"],
]);

/** Mediodía UTC del día que diga el texto: cae dentro del día en Madrid. */
function delDia(texto) {
  const [a, m, d] = texto.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d, 12, 0, 0));
}

/** `## 06–07/08/2026` o `## 19/08/2026`; cuenta el último día. */
const ES_FECHA = /^(?:\d{2}[–-])?(\d{2})\/(\d{2})\/(\d{4})$/;
function fechaDeSeccion(titulo) {
  const m = (titulo ?? "").trim().match(ES_FECHA);
  return m ? new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12, 0, 0)) : null;
}

/** El cuerpo sin espacios de más ni mayúsculas: dos tareas iguales dan lo mismo. */
const huella = (cuerpo) => (cuerpo ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** Las palabras largas del título, que son las que lo identifican. */
const palabras = (titulo) =>
  new Set(
    claveDeTarea(titulo)
      .split("-")
      .filter((p) => p.length > 3)
  );

/**
 * Cuánto se parecen dos títulos: la parte de palabras largas que comparten,
 * sobre el más corto de los dos. Sobre el más corto y no sobre la unión porque
 * un renombrado suele alargar o acortar la frase, y con la unión eso solo
 * contaría como «se parecen poco».
 */
function parecido(a, b) {
  const A = palabras(a);
  const B = palabras(b);
  if (!A.size || !B.size) return 0;
  let comunes = 0;
  for (const p of A) if (B.has(p)) comunes += 1;
  return comunes / Math.min(A.size, B.size);
}

const PARECIDO_MINIMO = 0.5;

/** Las tareas de un texto, por clave. */
function tareasDe(texto) {
  const mapa = new Map();
  for (const s of trocear(texto)) {
    for (const t of s.tareas) {
      mapa.set(claveDeTarea(t.titulo), {
        titulo: t.titulo,
        id: t.id ?? null,
        huella: huella(t.cuerpo),
        seccion: s.titulo,
      });
    }
  }
  return mapa;
}

async function main() {
  const { TableroDocumento, TableroEstado } = getMasterModels();

  // clave -> lo que se sabe de esa tarea
  const sabido = new Map();
  const emparejados = [];
  let versiones = 0;

  for (const nombre of ["backlog", "resuelto"]) {
    const filas = await TableroDocumento.findAll({
      where: { nombre },
      attributes: ["version", "contenido", "createdAt"],
      order: [["version", "ASC"]],
    });
    versiones += filas.length;
    let vivas = new Map();

    for (const fila of filas) {
      const ahora = tareasDe(fila.contenido);
      const entran = [...ahora.keys()].filter((k) => !vivas.has(k));
      const sobran = [...vivas.keys()].filter((k) => !ahora.has(k));
      // Las que se van en este mismo paso y todavía no tienen pareja.
      const pila = sobran.map((k) => ({ clave: k, ...vivas.get(k), ...sabido.get(k) }));

      for (const clave of entran) {
        const t = ahora.get(clave);
        // Ya se sabía de ella: vuelve de otro documento (se cerró) o reaparece.
        // Se conserva su fecha, porque volver no es nacer.
        if (sabido.has(clave)) continue;

        let de = null;
        if (t.id) de = pila.find((p) => p.id && p.id === t.id) ?? null;
        if (!de && t.huella) de = pila.find((p) => p.huella && p.huella === t.huella) ?? null;
        if (!de) {
          let mejor = null;
          for (const p of pila) {
            const cuanto = parecido(t.titulo, p.titulo);
            if (cuanto >= PARECIDO_MINIMO && (!mejor || cuanto > mejor.cuanto)) {
              mejor = { p, cuanto };
            }
          }
          de = mejor?.p ?? null;
        }

        if (de) {
          pila.splice(pila.indexOf(de), 1);
          sabido.set(clave, { ...sabido.get(de.clave), titulo: t.titulo });
          emparejados.push({ doc: nombre, v: fila.version, de: de.titulo, a: t.titulo });
          continue;
        }

        // Nace aquí. Si es la v1, puede que estuviera escrita de antes, en git.
        const deGit = DEL_TIEMPO_DE_GIT.get(clave);
        sabido.set(clave, {
          titulo: t.titulo,
          fecha: deGit ? delDia(deGit) : new Date(fila.createdAt),
          doc: nombre,
          version: fila.version,
          deGit: Boolean(deGit),
        });
      }

      vivas = ahora;
    }

    // El techo de Resuelto: la sección dice el día en que se cerró, y nada se
    // apuntó después de cerrarse. Se aplica sobre la foto final del documento.
    if (nombre === "resuelto") {
      for (const [clave, t] of vivas) {
        const techo = fechaDeSeccion(t.seccion);
        const reg = sabido.get(clave);
        if (techo && reg?.fecha && reg.fecha > techo) {
          reg.fecha = techo;
          reg.porElTecho = true;
        }
      }
    }
  }

  // Solo se siembran las tareas VIVAS hoy: una fila de una tarea que ya no está
  // escrita en ninguno de los dos documentos no la lee nadie.
  const vivasHoy = new Map();
  for (const nombre of ["backlog", "resuelto"]) {
    const fila = await TableroDocumento.findOne({
      where: { nombre },
      order: [["version", "DESC"]],
    });
    if (!fila) continue;
    for (const [clave, t] of tareasDe(fila.contenido)) {
      vivasHoy.set(clave, { ...t, doc: nombre });
    }
  }

  const filasDeEstado = await TableroEstado.findAll({
    attributes: ["id", "clave", "titulo", "apuntadaEn"],
  });
  const guardadas = new Map(filasDeEstado.map((f) => [f.clave, f]));

  const plan = [];
  const sinSaber = [];
  for (const [clave, t] of vivasHoy) {
    const reg = sabido.get(clave);
    if (!reg?.fecha) {
      sinSaber.push(t.titulo);
      continue;
    }
    const fila = guardadas.get(clave);
    const yaEsta = fila?.apuntadaEn ? new Date(fila.apuntadaEn) : null;
    if (yaEsta && Math.abs(yaEsta.getTime() - reg.fecha.getTime()) < 1000) continue;
    plan.push({
      clave,
      titulo: t.titulo,
      doc: t.doc,
      fecha: reg.fecha,
      reg,
      respetada: yaEsta && !REHACER ? yaEsta : null,
      pisa: yaEsta && REHACER ? yaEsta : null,
      nueva: !fila,
    });
  }

  const dia = (d) => d.toISOString().slice(0, 10);

  console.log("");
  console.log(`Recorridas ${versiones} versiones de los dos documentos.`);
  console.log(`Tareas escritas hoy: ${vivasHoy.size}. Con fila de estado: ${guardadas.size}.`);
  console.log("");

  if (emparejados.length) {
    console.log(`Renombrados que se han seguido (${emparejados.length}):`);
    for (const e of emparejados) {
      console.log(`  ${e.doc} v${e.v}  «${e.de.slice(0, 62)}»`);
      console.log(`             →  «${e.a.slice(0, 62)}»`);
    }
    console.log("");
  }

  const aEscribir = plan.filter((p) => !p.respetada);
  const respetadas = plan.filter((p) => p.respetada);

  const delBacklog = aEscribir.filter((p) => p.doc === "backlog").sort((a, b) => a.fecha - b.fecha);
  if (delBacklog.length) {
    console.log(`Pendiente — ${delBacklog.length} tarea(s):`);
    for (const p of delBacklog) {
      const marca = p.reg.deGit ? " (de git)" : "";
      console.log(`  ${dia(p.fecha)}${marca}  ${p.titulo.slice(0, 72)}`);
    }
    console.log("");
  }

  const deResuelto = aEscribir.filter((p) => p.doc === "resuelto");
  if (deResuelto.length) {
    const porDia = new Map();
    for (const p of deResuelto) porDia.set(dia(p.fecha), (porDia.get(dia(p.fecha)) ?? 0) + 1);
    const porTecho = deResuelto.filter((p) => p.reg.porElTecho).length;
    console.log(`Resuelto — ${deResuelto.length} tarea(s), por día:`);
    for (const [d, n] of [...porDia.entries()].sort()) console.log(`  ${d}  ${n}`);
    console.log(`  (a ${porTecho} las fecha el techo de su sección, no el historial)`);
    console.log("");
  }

  if (respetadas.length) {
    console.log(`Ya tenían fecha y NO se tocan (--rehacer para pisarlas): ${respetadas.length}`);
    for (const p of respetadas.slice(0, 10)) {
      console.log(`  tiene ${dia(p.respetada)}, saldría ${dia(p.fecha)}  ${p.titulo.slice(0, 58)}`);
    }
    console.log("");
  }

  if (sinSaber.length) {
    console.log(`Sin fecha que reconstruir (${sinSaber.length}), se quedan vacías:`);
    for (const t of sinSaber.slice(0, 10)) console.log(`  ${t.slice(0, 72)}`);
    console.log("");
  }

  if (!CONFIRMA) {
    console.log(`ENSAYO. Se escribirían ${aEscribir.length} fecha(s), de las cuales`);
    console.log(`${aEscribir.filter((p) => p.nueva).length} en filas de estado nuevas.`);
    console.log("Repite con --confirm para escribirlas.");
    await getMasterDb().close();
    return;
  }

  let nuevas = 0;
  let puestas = 0;
  for (const p of aEscribir) {
    const fila = guardadas.get(p.clave);
    if (fila) {
      await fila.update({ apuntadaEn: p.fecha });
      puestas += 1;
    } else {
      await TableroEstado.create({ clave: p.clave, titulo: p.titulo, apuntadaEn: p.fecha });
      nuevas += 1;
    }
  }
  console.log(`✓ ${puestas} fila(s) actualizada(s) y ${nuevas} creada(s).`);

  const [cuenta] = await getMasterDb().query(
    "SELECT count(*)::int AS n, count(apuntada_en)::int AS fechadas FROM master.tablero_estado"
  );
  console.log(`  master.tablero_estado: ${cuenta[0].n} filas, ${cuenta[0].fechadas} con fecha.`);

  await getMasterDb().close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
