/**
 * backfill-categorias-bloqueo.js — ponerle CATEGORÍA a los bloqueos que ya
 * estaban (01/09/2026, Aumenta por Rodrigo).
 *
 * ── EL ENCARGO ──────────────────────────────────────────────────────────────
 * «Analiza todos los bloqueos de cada persona y etiquétalos según su categoría
 * correctamente. Ahora mismo existen las categorías, pero los bloqueos que se
 * trajeron de Organízate no pertenecen a ninguna aunque ponga en el título T.I.»
 *
 * Y era literal: el día que se escribió esto, de los 10.468 bloqueos de Aumenta
 * había TRES con categoría. Las categorías existen desde esa misma mañana, así
 * que solo las llevan los bloqueos creados después; los demás traen la clase
 * escrita dentro del `label` porque así los exportó Organízate.
 *
 * Quién decide qué es cada etiqueta: `categoriaPorEtiqueta` en
 * `lib/citas/categoriasBloqueo.js`, con sus reglas y su porqué. Aquí solo se
 * recorre, se agrupa y se escribe.
 *
 * ── LO QUE HACE, EN ORDEN ───────────────────────────────────────────────────
 *  1. Da de alta las categorías de fábrica que le FALTEN al centro, sin tocar
 *     una sola de las que ya tiene (ni su clave, ni su título, ni su color):
 *     puede haberlas renombrado o repintado, y eso es suyo.
 *  2. Clasifica los bloqueos que están SIN categoría. Los que ya tienen una no
 *     se miran: alguien la eligió a mano y gana siempre.
 *  3. Enseña el reparto por categoría y por persona, y escribe solo con
 *     `--confirm`.
 *
 * ── EN SECO POR DEFECTO ─────────────────────────────────────────────────────
 * Sin `--confirm` no escribe nada: imprime exactamente lo que haría. Son 10.000
 * filas de la agenda de quince personas y el reparto se mira antes.
 *
 * ── CÓMO SE DESHACE ─────────────────────────────────────────────────────────
 * Se guarda la lista de ids tocados en un fichero del temporal ANTES de tocar
 * nada (`--deshacer <fichero>` los vuelve a poner a NULL). Sin esa lista no
 * habría vuelta atrás fina: después de pasar esto, un bloqueo etiquetado por el
 * script y otro etiquetado a mano son indistinguibles en la base.
 *
 * Como todo backfill, mira el `status` del tenant (regla 12): en un cliente
 * apagado no se escribe.
 *
 * ⚠️ La caché de tenant dura ~60 s y vive en el proceso de Next: las categorías
 * nuevas salen en la pantalla al minuto siguiente, no al instante. Las
 * categorías de los bloqueos se leen de la tabla y se ven al recargar.
 *
 * Uso local:  node --env-file=.env.local scripts/backfill-categorias-bloqueo.js <slug> [--confirm]
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/backfill-categorias-bloqueo.js <slug> --confirm
 * Deshacer:   docker exec crm-salamandra-app-1 node scripts/backfill-categorias-bloqueo.js <slug> --deshacer /tmp/backfill-bloqueos-aumenta.json
 */

import { writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Sequelize } from "sequelize";
import {
  CATEGORIAS_CLINICA_BASE,
  categoriaPorEtiqueta,
  normalizarCategorias,
} from "../lib/citas/categoriasBloqueo.js";

const SIN = "(sin categoría clara)";
const LOTE = 500;

function out(msg) {
  process.stdout.write(`${msg}\n`);
}

/** Las categorías del centro MÁS las de fábrica que le falten, sin pisar nada. */
function completarCategorias(guardadas) {
  const previas = Array.isArray(guardadas) ? guardadas : [];
  const yaEstan = new Set(previas.map((c) => c?.key).filter(Boolean));
  const faltan = CATEGORIAS_CLINICA_BASE.filter((c) => !yaEstan.has(c.key));
  // `normalizarCategorias` con `previas` conserva la clave de las que ya había
  // aunque el centro les haya cambiado el título: es la regla de la casa.
  return { lista: normalizarCategorias([...previas, ...faltan], { previas }), faltan };
}

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes("--confirm");
  const iDeshacer = args.indexOf("--deshacer");
  const ficheroDeshacer = iDeshacer >= 0 ? args[iDeshacer + 1] : null;
  const slug = args.find((a) => !a.startsWith("--") && a !== ficheroDeshacer);

  if (!slug) {
    process.stderr.write(
      "\nUso: node scripts/backfill-categorias-bloqueo.js <slug> [--confirm]\n" +
        "     node scripts/backfill-categorias-bloqueo.js <slug> --deshacer <fichero.json>\n\n"
    );
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  const [filas] = await s.query(`SELECT id, slug, name, status, settings FROM master.tenants WHERE slug = :slug`, {
    replacements: { slug },
  });
  if (!filas.length) {
    process.stderr.write(`✗ No existe el cliente «${slug}».\n`);
    await s.close();
    process.exit(1);
  }
  const t = filas[0];
  if (t.status !== "active") {
    process.stderr.write(`✗ «${slug}» está en estado «${t.status}»: en un cliente que no está activo no se escribe.\n`);
    await s.close();
    process.exit(1);
  }
  const schema = `crm_${slug}`;

  // ── Deshacer ────────────────────────────────────────────────────────────
  if (ficheroDeshacer) {
    const ids = JSON.parse(readFileSync(ficheroDeshacer, "utf8"));
    if (!Array.isArray(ids) || !ids.length) {
      process.stderr.write("✗ Ese fichero no tiene una lista de ids.\n");
      await s.close();
      process.exit(1);
    }
    out(`\nDeshaciendo: ${ids.length} bloqueos vuelven a quedarse sin categoría.`);
    if (!confirm) {
      out("\n(EN SECO: nada escrito. Repite con --confirm.)\n");
      await s.close();
      return;
    }
    let n = 0;
    for (let i = 0; i < ids.length; i += LOTE) {
      const trozo = ids.slice(i, i + LOTE);
      const [, meta] = await s.query(
        `UPDATE "${schema}"."team_blocks" SET category_key = NULL WHERE id IN (:ids)`,
        { replacements: { ids: trozo } }
      );
      n += meta?.rowCount ?? trozo.length;
    }
    out(`\n✓ ${n} bloqueos sin categoría otra vez.\n`);
    await s.close();
    return;
  }

  out(`\n${t.name} (${slug})`);

  // ── 1. Las categorías que le faltan al centro ───────────────────────────
  const { lista: categorias, faltan } = completarCategorias(t.settings?.citas?.categoriasBloqueo);
  if (faltan.length) {
    out(`\n· Se darían de alta ${faltan.length} categorías que le faltan:`);
    for (const c of faltan) out(`    ${c.color}  ${c.label}  [${c.key}]`);
  } else {
    out("\n· Ya tiene todas las categorías de fábrica. No se toca ninguna.");
  }

  // ── 2. Los bloqueos sin categoría ──────────────────────────────────────
  const [bloqueos] = await s.query(
    `SELECT b.id, b.label, coalesce(tm.display_name, '(centro entero)') AS persona
       FROM "${schema}"."team_blocks" b
       LEFT JOIN "${schema}"."team_members" tm ON tm.id = b.team_member_id
      WHERE b.category_key IS NULL`
  );
  const [[ya]] = await s.query(
    `SELECT count(*)::int n FROM "${schema}"."team_blocks" WHERE category_key IS NOT NULL`
  );

  out(`\n· ${bloqueos.length} bloqueos sin categoría (y ${ya.n} que ya la tienen y no se tocan).`);

  const porClave = new Map(); // clave → [id]
  const porPersona = new Map(); // persona → { clave → n }
  for (const b of bloqueos) {
    const clave = categoriaPorEtiqueta(b.label, categorias) ?? SIN;
    if (!porClave.has(clave)) porClave.set(clave, []);
    porClave.get(clave).push(b.id);
    if (!porPersona.has(b.persona)) porPersona.set(b.persona, new Map());
    const suyo = porPersona.get(b.persona);
    suyo.set(clave, (suyo.get(clave) ?? 0) + 1);
  }

  const rotulo = (clave) => categorias.find((c) => c.key === clave)?.label ?? clave;
  const orden = [...porClave.entries()].sort((a, b) => b[1].length - a[1].length);

  out("\n  ── Por categoría ────────────────────────────────────────────");
  for (const [clave, ids] of orden) {
    out(`  ${String(ids.length).padStart(6)}  ${rotulo(clave)}`);
  }

  out("\n  ── Por persona ──────────────────────────────────────────────");
  const personas = [...porPersona.entries()].sort(
    (a, b) => suma(b[1]) - suma(a[1])
  );
  for (const [persona, cuenta] of personas) {
    const detalle = [...cuenta.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([clave, n]) => `${rotulo(clave)} ${n}`)
      .join(" · ");
    out(`  ${String(suma(cuenta)).padStart(6)}  ${persona}`);
    out(`          ${detalle}`);
  }

  const sinClasificar = porClave.get(SIN) ?? [];
  if (sinClasificar.length) {
    out(
      `\n⚠️  ${sinClasificar.length} bloqueos se quedan SIN categoría: su etiqueta no cae en\n` +
        "    ninguna regla. Se quedan como están hoy — adivinar mal es peor que no adivinar.\n" +
        "    Sus etiquetas, para decidir si merecen una regla nueva:"
    );
    const muestras = new Map();
    for (const b of bloqueos) {
      if ((categoriaPorEtiqueta(b.label, categorias) ?? SIN) !== SIN) continue;
      muestras.set(b.label, (muestras.get(b.label) ?? 0) + 1);
    }
    for (const [label, n] of [...muestras.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
      out(`      ${String(n).padStart(5)}  ${JSON.stringify(label)}`);
    }
  }

  const aEscribir = orden.filter(([clave]) => clave !== SIN);
  const cuantos = aEscribir.reduce((n, [, ids]) => n + ids.length, 0);

  if (!confirm) {
    out(`\n(EN SECO: nada escrito. Se etiquetarían ${cuantos} bloqueos. Repite con --confirm.)\n`);
    await s.close();
    return;
  }

  // ── 3. Escribir ────────────────────────────────────────────────────────
  // Todo en una transacción: o quedan etiquetados los 10.000 o ninguno. Una
  // agenda a medio clasificar es peor que una sin clasificar — nadie sabría
  // qué parte se miró.
  //
  // ⚠️ La lista para DESHACER se escribe ANTES de tocar la base, y a propósito.
  // La primera vez que se lanzó esto iba después del `commit`: el contenedor
  // corre como `nextjs` y `/app` no es suyo, así que el `writeFileSync` reventó
  // con EACCES con la transacción YA CONFIRMADA — 10.465 bloqueos etiquetados y
  // ninguna manera fina de volver atrás (se reconstruyó a mano, por los tres que
  // tenían `updated_at > created_at`). Si no se puede guardar el seguro, no se
  // hace la operación.
  const tocados = aEscribir.flatMap(([, ids]) => ids);
  const fichero = join(tmpdir(), `backfill-bloqueos-${slug}.json`);
  writeFileSync(fichero, JSON.stringify(tocados));
  out(`\n· Lista para deshacer guardada en ${fichero} (${tocados.length} ids).`);

  const tx = await s.transaction();
  try {
    if (faltan.length) {
      await s.query(
        `UPDATE master.tenants
            SET settings = jsonb_set(
                  jsonb_set(coalesce(settings, '{}'::jsonb), '{citas}', coalesce(settings->'citas', '{}'::jsonb), true),
                  '{citas,categoriasBloqueo}', :categorias::jsonb, true)
          WHERE id = :id`,
        { replacements: { categorias: JSON.stringify(categorias), id: t.id }, transaction: tx }
      );
    }
    for (const [clave, ids] of aEscribir) {
      for (let i = 0; i < ids.length; i += LOTE) {
        const trozo = ids.slice(i, i + LOTE);
        await s.query(
          `UPDATE "${schema}"."team_blocks" SET category_key = :clave WHERE id IN (:ids) AND category_key IS NULL`,
          { replacements: { clave, ids: trozo }, transaction: tx }
        );
      }
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }

  out(`\n✓ ${tocados.length} bloqueos etiquetados en «${slug}».`);
  if (faltan.length) out(`✓ ${faltan.length} categorías nuevas dadas de alta (tardan ~1 min en salir en pantalla).`);
  out(`· Para deshacerlo: --deshacer ${fichero} --confirm  (${tocados.length} ids guardados ahí)\n`);
  await s.close();
}

function suma(mapa) {
  let n = 0;
  for (const v of mapa.values()) n += v;
  return n;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
