// @vivo — Es LA semilla de Fichaje de las demos: seed-sandbox-data.js no siembra fichajes, este recorre todas las demos con el módulo (lista de master en… (leído el 19/08/2026; ver scripts/_hechos/README.md)
/**
 * seed-fichaje-demo.js — un mes de fichaje inventado para el escaparate.
 *
 * Sin esto, quien entra en la demo a ver el módulo de Fichaje se encuentra una
 * pantalla vacía, que en una demo es peor que no tener el módulo: no se puede
 * enseñar lo que hace, solo que existe.
 *
 * ── QUÉ SIEMBRA, Y POR QUÉ ESTO Y NO OTRA COSA ──────────────────────────────
 * Un mes de jornadas perfectas no enseña nada. Lo que vende este módulo es que
 * ENCUENTRA lo que está mal, así que el mes sembrado lleva a propósito los seis
 * casos que la pantalla sabe detectar:
 *
 *   · una persona que hace de más y otra que hace de menos (la columna de
 *     diferencia con el horario, que es lo que se mira al final de mes);
 *   · un día con entrada y SIN salida            → aviso rojo;
 *   · una jornada de más de doce horas           → aviso ámbar;
 *   · un día partido en dos tramos (mañana y tarde), que es la razón de que el
 *     modelo guarde tramos y no días;
 *   · una corrección a mano con su motivo, para que se vea el «el fichero decía
 *     8h, y alguien lo dejó en 7h porque…»;
 *   · alguien SIN ningún fichaje en todo el mes  → aviso rojo.
 *
 * Y crea el LOTE (`fichaje_imports`) como si viniera de un volcado real, con su
 * resumen y sus anotaciones: el histórico de volcados también se enseña.
 *
 * ── DOS MESES, Y CALCULADOS AL VUELO ────────────────────────────────────────
 * Se siembra el mes EN CURSO (hasta ayer) y el ANTERIOR completo. El primero
 * porque la pantalla abre por el mes actual y tiene que tener datos; el segundo
 * para que el selector de mes sirva para algo y se pueda enseñar un mes cerrado.
 *
 * Los meses se calculan en tiempo de ejecución, no se escriben: un seed con
 * «2026-08» dentro se queda viejo en septiembre y la demo vuelve a estar vacía
 * sin que nadie se entere. Por eso este script está en la lista de
 * `reset-demo-tenant.js`: cada reset lo refresca.
 *
 * ── IDEMPOTENTE, Y SOLO SOBRE DEMOS ─────────────────────────────────────────
 * Borra de verdad lo que sembró antes en esos dos meses y lo vuelve a escribir.
 * Puede hacerlo porque son datos falsos: es la ÚNICA parte del módulo que borra
 * fichajes en serio, y por eso se niega a correr sobre un tenant que no sea una
 * demo. En un cliente real un fichaje no se borra nunca.
 *
 * Uso local:  node --env-file=.env.local scripts/seed-fichaje-demo.js
 *             node --env-file=.env.local scripts/seed-fichaje-demo.js --tenant demo
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/seed-fichaje-demo.js
 */

import { Sequelize, Op } from "sequelize";

import { getTenantDb } from "../lib/db/tenantDb.js";
import { esSlugDemo } from "../lib/demo/isDemo.js";

function log(m) { process.stdout.write(`  ${m}\n`); }
function header(m) { process.stdout.write(`\n▶ ${m}\n`); }

// ─── Azar REPETIBLE ─────────────────────────────────────────────────────────
// Un generador con semilla, y no Math.random, para que dos ejecuciones den el
// mismo mes. Si cada reset de la demo cambiara los minutos, una captura de
// pantalla de ayer no cuadraría con lo que se ve hoy, y en una demo eso se nota.
function azar(semilla) {
  let s = semilla >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const hhmm = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** 'YYYY-MM' del mes actual y del anterior, calculados hoy. */
function mesesObjetivo(hoy = new Date()) {
  const y = hoy.getUTCFullYear();
  const m = hoy.getUTCMonth(); // 0-11
  const actual = `${y}-${String(m + 1).padStart(2, "0")}`;
  const antD = new Date(Date.UTC(y, m - 1, 1));
  const anterior = `${antD.getUTCFullYear()}-${String(antD.getUTCMonth() + 1).padStart(2, "0")}`;
  return { actual, anterior, diaDeHoy: hoy.getUTCDate() };
}

function diasLaborables(periodo, hastaDia = 31) {
  const [y, m] = periodo.split("-").map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dias = [];
  for (let d = 1; d <= Math.min(ultimo, hastaDia); d++) {
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (wd === 0 || wd === 6) continue; // fin de semana
    dias.push(`${periodo}-${String(d).padStart(2, "0")}`);
  }
  return dias;
}

/**
 * Horario base de cada persona. El índice manda, así que el reparto de casos
 * raros es siempre el mismo aunque cambien los nombres de la demo.
 */
const HORARIOS = [
  { entrada: 9 * 60, salida: 17 * 60 + 30, sesgo: +14 },  // 0: se queda de más casi a diario
  { entrada: 8 * 60 + 30, salida: 17 * 60, sesgo: -11 },  // 1: se va antes casi a diario
  { entrada: 10 * 60, salida: 18 * 60 + 30, sesgo: +2 },
  { entrada: 9 * 60 + 30, salida: 14 * 60, sesgo: 0 },    // 3: media jornada
  { entrada: 9 * 60, salida: 18 * 60, sesgo: +3 },
];

/**
 * Dónde caen los casos raros, en FRACCIÓN del mes y no en un índice fijo.
 *
 * El mes en curso se siembra solo hasta ayer, así que puede tener ocho días
 * cuando el anterior tiene veintidós. Con índices fijos («el día 9») los casos
 * interesantes se caían fuera justo del mes que la pantalla abre por defecto, y
 * la demo quedaba sin un solo aviso que enseñar — que es precisamente lo que
 * este seed viene a evitar.
 */
const CUANDO = {
  sinSalidaSinCorregir: 0.25,
  sinSalidaCorregido: 0.6,
  jornadaLarga: 0.45,
  diaPartido: 0.75,
};
const posicion = (dias, fraccion) => Math.min(dias.length - 1, Math.max(0, Math.floor(dias.length * fraccion)));

async function sembrarPeriodo({ models, periodo, personas, hastaDia, rnd }) {
  const { Fichaje, FichajeImport } = models;
  const dias = diasLaborables(periodo, hastaDia);
  if (dias.length === 0) return { creadas: 0, lote: null };

  // Quien trabaja: todos menos el último, que se queda SIN fichajes a propósito
  // para que salga el aviso de «sin ningún fichaje este mes».
  const trabajan = personas.slice(0, Math.max(1, personas.length - 1));

  const filas = [];
  const anotaciones = [];

  const dSinSalida = posicion(dias, CUANDO.sinSalidaSinCorregir);
  const dCorregido = posicion(dias, CUANDO.sinSalidaCorregido);
  const dLarga = posicion(dias, CUANDO.jornadaLarga);
  const dPartido = posicion(dias, CUANDO.diaPartido);

  trabajan.forEach((p, i) => {
    const h = HORARIOS[i % HORARIOS.length];
    dias.forEach((fecha, d) => {
      const previstos = h.salida - h.entrada;

      // Caso especial 1 — día PARTIDO en dos tramos (mañana y tarde).
      if (i === 2 && d === dPartido) {
        filas.push({
          teamMemberId: p.id, fecha,
          entradaAt: hhmm(9 * 60), salidaAt: hhmm(13 * 60 + 15),
          entradaPrevistaAt: hhmm(9 * 60), salidaPrevistaAt: hhmm(13 * 60 + 15),
          minutos: 255, minutosPrevistos: 255, minutosOriginal: 255,
          tipo: "trabajo", origen: "import", hojaExcel: "Semana 2", filaExcel: 20 + d,
        });
        filas.push({
          teamMemberId: p.id, fecha,
          entradaAt: hhmm(16 * 60), salidaAt: hhmm(20 * 60),
          entradaPrevistaAt: hhmm(16 * 60), salidaPrevistaAt: hhmm(20 * 60),
          minutos: 240, minutosPrevistos: 240, minutosOriginal: 240,
          tipo: "trabajo", origen: "import", hojaExcel: "Semana 2", filaExcel: 21 + d,
        });
        return;
      }

      const desvioE = Math.round((rnd() - 0.5) * 24);
      const desvioS = Math.round((rnd() - 0.5) * 24) + h.sesgo;
      let entrada = h.entrada + desvioE;
      let salida = h.salida + desvioS;

      // Casos especiales 2 y 3 — entrada SIN salida, DOS veces y a propósito:
      // una se queda como está (para que se vea el aviso rojo «entrada sin
      // salida») y a la otra se le pasa una corrección más abajo (para que se
      // vea el «el fichero decía X y alguien lo dejó en Y, porque…»). Con una
      // sola no se podían enseñar las dos cosas: corregirla apagaba el aviso.
      if (i === 0 && (d === dSinSalida || d === dCorregido)) {
        filas.push({
          teamMemberId: p.id, fecha,
          entradaAt: hhmm(entrada), salidaAt: null,
          entradaPrevistaAt: hhmm(h.entrada), salidaPrevistaAt: hhmm(h.salida),
          minutos: previstos, minutosPrevistos: previstos, minutosOriginal: previstos,
          tipo: "trabajo", origen: "import", hojaExcel: `Semana ${Math.floor(d / 5) + 1}`, filaExcel: 10 + d,
        });
        return;
      }

      // Caso especial 4 — jornada larguísima (una guardia, o un fichaje mal
      // hecho: eso es justo lo que el aviso pide que alguien mire).
      if (i === 1 && d === dLarga) {
        entrada = 8 * 60;
        salida = 21 * 60 + 30;
      }

      filas.push({
        teamMemberId: p.id, fecha,
        entradaAt: hhmm(entrada), salidaAt: hhmm(salida),
        entradaPrevistaAt: hhmm(h.entrada), salidaPrevistaAt: hhmm(h.salida),
        minutos: salida - entrada,
        minutosPrevistos: previstos,
        minutosOriginal: salida - entrada,
        tipo: "trabajo",
        origen: "import",
        hojaExcel: `Semana ${Math.floor(d / 5) + 1}`,
        filaExcel: 10 + d,
      });
    });
  });

  // Anotaciones como las que la gente escribe en su Excel.
  if (dias[2] && trabajan[1]) anotaciones.push({ nombreExcel: trabajan[1].displayName, fecha: dias[2], texto: "MÉDICO", hoja: "Semana 1", fila: 12 });
  if (dias[8] && trabajan[0]) anotaciones.push({ nombreExcel: trabajan[0].displayName, fecha: dias[8], texto: "FORMACIÓN EXTERNA", hoja: "Semana 2", fila: 18 });

  const lote = await FichajeImport.create({
    periodo,
    fileName: `fichaje-${periodo}.xlsx`,
    fileHash: null,
    parser: "generico",
    rowsTotal: filas.length,
    rowsOk: filas.length,
    rowsError: 0,
    status: "applied",
    appliedAt: new Date(),
    resumen: {
      porPersona: trabajan.map((p) => ({
        teamMemberId: p.id,
        minutos: filas.filter((f) => f.teamMemberId === p.id).reduce((a, f) => a + f.minutos, 0),
      })),
      anotaciones,
      avisos: [],
    },
  });

  await Fichaje.bulkCreate(filas.map((f) => ({ ...f, importId: lote.id })));

  // La corrección a mano, con su motivo. Se hace DESPUÉS del volcado, que es
  // como pasa en la vida real. Solo sobre el SEGUNDO día sin salida: el primero
  // se queda sin tocar para que siga saliendo su aviso.
  if (dias[dCorregido]) {
    const aCorregir = await Fichaje.findOne({
      where: { importId: lote.id, salidaAt: null, fecha: dias[dCorregido] },
    });
    if (aCorregir) {
      await aCorregir.update({
        minutos: Math.max(60, aCorregir.minutos - 75),
        salidaAt: hhmm(16 * 60 + 30),
        origen: "corregido",
        nota: "El reloj no registró la salida. Confirmado con ella: salió a las 16:30.",
        corregidoAt: new Date(),
      });
    }
  }

  return { creadas: filas.length, lote: lote.id, anotaciones: anotaciones.length };
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" Seed: fichaje de escaparate (demo)\n");
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  const argv = process.argv.slice(2);
  const i = argv.indexOf("--tenant");
  const soloSlug = i >= 0 ? argv[i + 1] : null;

  // A quién: demos CON el módulo. La lista sale de master en runtime (regla
  // #12) y se filtra por `esSlugDemo`, que es el mismo criterio que usa el
  // resto del CRM para saber qué es una demo.
  const master = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  const [filas] = await master.query(`
    SELECT DISTINCT t.slug
      FROM master.tenants t
      JOIN master.tenant_modules tm ON tm.tenant_id = t.id
     WHERE t.status = 'active' AND tm.enabled = TRUE AND tm.module_key = 'fichaje'
     ORDER BY t.slug
  `);
  await master.close();

  let slugs = filas.map((f) => f.slug).filter((s) => esSlugDemo(s));
  if (soloSlug) {
    if (!esSlugDemo(soloSlug)) {
      process.stderr.write(`\n✗ "${soloSlug}" no es una demo. Este script BORRA fichajes: no toca clientes reales.\n\n`);
      process.exit(1);
    }
    slugs = slugs.filter((s) => s === soloSlug);
  }

  if (slugs.length === 0) {
    log("· Ninguna demo con el módulo `fichaje` activo. Nada que sembrar.\n");
    process.exit(0);
  }

  const { actual, anterior, diaDeHoy } = mesesObjetivo();
  log(`Meses: ${anterior} (completo) y ${actual} (hasta el día ${diaDeHoy - 1 || 1})`);

  for (const slug of slugs) {
    header(`${slug}`);
    const { models, sequelize } = getTenantDb(slug);
    const { TeamMember, Fichaje, FichajeImport } = models;
    try {
      const personas = await TeamMember.findAll({
        where: { status: "active" },
        attributes: ["id", "displayName"],
        order: [["displayName", "ASC"]],
      });
      if (personas.length < 2) {
        log("✗ Menos de dos personas en el equipo: siembra antes el equipo de la demo. Se salta.");
        continue;
      }

      // Limpieza de lo sembrado antes EN ESOS DOS MESES. Borrado de verdad, que
      // aquí sí se puede: son datos falsos.
      for (const periodo of [anterior, actual]) {
        const [y, m] = periodo.split("-").map(Number);
        const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
        await Fichaje.destroy({
          where: { fecha: { [Op.between]: [`${periodo}-01`, `${periodo}-${ultimo}`] } },
          force: true,
        });
        await FichajeImport.destroy({ where: { periodo }, force: true });
      }

      const rnd = azar(20260813);
      const r1 = await sembrarPeriodo({ models, periodo: anterior, personas, hastaDia: 31, rnd });
      const r2 = await sembrarPeriodo({ models, periodo: actual, personas, hastaDia: Math.max(1, diaDeHoy - 1), rnd });

      log(`✓ ${anterior}: ${r1.creadas} jornadas · ${r2.creadas} en ${actual}`);
      log(`✓ ${personas.length - 1} personas con fichajes, 1 sin ninguno (para el aviso)`);
      log("✓ incluye: día sin salida corregido a mano, jornada de 13 h, día partido en dos tramos");
    } catch (err) {
      log(`✗ ${slug}: ${err.message}`);
    } finally {
      await sequelize.close().catch(() => {});
    }
  }

  process.stdout.write("\n✓ Seed completado\n\n");
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
