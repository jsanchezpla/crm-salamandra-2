/**
 * repartir-taller-hhss-por-cuota.js — partir un taller en sus grupos REALES a
 * partir de las listas de Organízate (01/09/2026, Rodrigo: «créalos tú
 * basándote en las cuotas de Organízate. Hay cuotas de HHSS 1h, 1h30… y así»).
 *
 * ── DE QUÉ SITUACIÓN SALE ───────────────────────────────────────────────────
 * `migrate-talleres-grupos.js` dejó a los 45 inscritos de «Habilidades
 * sociales» en un «Grupo 1» único, porque repartirlos no es cosa de una
 * migración. Y las listas que había en el CRM no servían para partirlo:
 *
 *   · las **45 inscripciones** las creó el volcado del 02/08/2026 deduciendo
 *     quién PASÓ por HHSS de 4.287 citas del histórico;
 *   · las **32 cuotas activas** de HHSS dicen quién lo PAGA, pero 6 son «de
 *     familia» (sin decir cuál de los hermanos) y solo 17 personas están en
 *     las dos listas.
 *
 * La lista buena está en Organízate: sus «grupos de cursos» SON las cuotas
 * —«CUOTA H.H.S.S.» (27 miembros) y «CUOTA HHSS 1H 30» (6)— y cada una lleva
 * dentro sus pacientes con nombre y apellidos. Eso es lo que come este script.
 *
 * ── POR QUÉ LAS LISTAS VIENEN POR PARÁMETRO Y NO AQUÍ DENTRO ────────────────
 * Porque son nombres de menores y este fichero va a un repositorio. El JSON se
 * queda fuera, y así el script sirve para cualquier taller y cualquier cliente
 * sin llevar datos personales dentro.
 *
 * Formato del JSON:
 *   { "grupos": [ { "nombre": "1 hora", "duracion": 60,
 *                   "concepto": "Cuota HHSS", "miembros": ["NOMBRE APELLIDOS", …] } ] }
 *
 * ── LO QUE HACE ─────────────────────────────────────────────────────────────
 *   1. Crea un grupo por entrada del JSON, con su duración y su concepto de
 *      cobro del catálogo (el que ya existe en el CRM; no crea conceptos).
 *   2. Casa cada nombre con un paciente por nombre normalizado (sin tildes, sin
 *      mayúsculas, sin guiones), y lo apunta a su grupo — o lo MUEVE si ya
 *      estaba en el grupo cajón.
 *   3. Enlaza la inscripción con la cuota de HHSS que esa familia YA paga.
 *      **No crea ninguna cuota**: existen, y duplicarlas sería cobrar dos veces.
 *      (Por eso no pasa por `asegurarCuotaDeTaller`, que es para el alta normal.)
 *   4. Renombra el grupo viejo a «Por revisar» y deja ahí, sin tocar, a los que
 *      no aparecen en ninguna lista.
 *
 * Lo que NO hace y es deliberado: **no da de baja a nadie**. Un nombre que no
 * casa se dice y se queda como está; borrar por no saber leer un nombre es el
 * peor error posible aquí.
 *
 * EN SECO por defecto. `--confirm` para escribir.
 *
 * Uso VPS:
 *   docker exec -i crm-salamandra-app-1 node scripts/repartir-taller-hhss-por-cuota.js \
 *     --listas /tmp/listas.json [--taller "Habilidades sociales"] [--slug aumenta] [--confirm]
 */

import { Sequelize } from "sequelize";
import { readFileSync } from "node:fs";

/** Cómo se llama el grupo donde se quedan los que nadie reclama. */
const CAJON = "Por revisar";

function log(m) { process.stdout.write(`  ${m}\n`); }

/**
 * El nombre de una persona, listo para comparar: sin tildes, sin mayúsculas,
 * sin guiones ni puntos, y con los espacios colapsados.
 *
 * Los guiones se convierten en espacio y NO se borran: «GARCÍA-CAMPERO» y
 * «Garcia Campero» son la misma persona escrita en dos sitios distintos, y en
 * Aumenta hay apellidos compuestos de los dos modos.
 */
function normalizar(s) {
  return String(s ?? "")
    .normalize("NFD")
    // Los diacríticos por `\p{Diacritic}` y no por un rango escrito a mano: son
    // caracteres combinantes invisibles, y pegados en el código cualquier editor
    // que normalice el fichero se los come y esto deja de quitar tildes EN
    // SILENCIO — casando «Ángel» con nadie.
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[-.]/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Las palabras de un nombre, para casar aunque cambie el orden. */
const palabras = (s) => new Set(normalizar(s).split(" ").filter(Boolean));

/**
 * ¿Es este paciente la persona de la lista?
 *
 * Primero por igualdad exacta del nombre normalizado, que es lo que casa en la
 * inmensa mayoría. Si no, se admite que las palabras de uno CONTENGAN a las del
 * otro —«Hugo García-Campero García-Alcañiz» vs «Hugo García Campero»—, pero
 * solo si comparten al menos tres palabras: con dos, «Carlos Becerro» casaría
 * con «Carlos Becerro Martín» y también con su hermano «Marcos Becerro Martín».
 */
function casa(nombreLista, nombrePaciente) {
  const a = normalizar(nombreLista);
  const b = normalizar(nombrePaciente);
  if (!a || !b) return false;
  if (a === b) return true;
  const pa = palabras(a);
  const pb = palabras(b);
  const comunes = [...pa].filter((x) => pb.has(x)).length;
  if (comunes < 3) return false;
  return comunes === pa.size || comunes === pb.size;
}

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes("--confirm");
  const idx = (f) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null; };
  const slug = idx("--slug") || "aumenta";
  const nombreTaller = idx("--taller") || "Habilidades sociales";
  const rutaListas = idx("--listas");
  const schema = `crm_${slug}`;

  if (!rutaListas) {
    process.stderr.write("✗ Falta --listas <fichero.json>\n");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  const listas = JSON.parse(readFileSync(rutaListas, "utf8")).grupos ?? [];
  if (!listas.length) {
    process.stderr.write("✗ El JSON no trae ningún grupo\n");
    process.exit(1);
  }

  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(` Repartir «${nombreTaller}» en sus grupos${confirm ? "" : "   (EN SECO)"}\n`);
  process.stdout.write("════════════════════════════════════════════════════\n");

  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  const q = async (sql, bind) => (await s.query(sql, bind ? { bind } : undefined))[0];
  const hoy = new Date().toISOString().slice(0, 10);

  // ── El taller ────────────────────────────────────────────────────────────
  const talleres = await q(`SELECT id, name FROM "${schema}"."talleres" WHERE name = $1`, [nombreTaller]);
  if (!talleres.length) {
    process.stderr.write(`\n✗ No hay ningún taller llamado «${nombreTaller}» en ${schema}\n\n`);
    process.exit(1);
  }
  const taller = talleres[0];
  log(`✓ Taller: ${taller.name}`);

  // ── Los pacientes del centro, para casar nombres ─────────────────────────
  const pacientes = await q(
    `SELECT id, client_id, TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) AS nombre, status
       FROM "${schema}"."patients"`
  );
  log(`✓ ${pacientes.length} pacientes en el centro`);

  // ── Las cuotas de HHSS que ya se pagan, para enlazarlas ──────────────────
  const conceptos = await q(
    `SELECT id, name FROM "${schema}"."billing_concepts" WHERE name = ANY($1)`,
    [listas.map((g) => g.concepto).filter(Boolean)]
  );
  const conceptoPorNombre = new Map(conceptos.map((c) => [c.name, c]));
  const cuotas = await q(`SELECT id, client_id, patient_id, concept_ids FROM "${schema}"."billing_cuotas" WHERE active`);

  /** La cuota de ESE concepto que paga la familia de este paciente, si la hay. */
  function cuotaDe(paciente, conceptoId) {
    if (!conceptoId) return null;
    const suya = cuotas.find(
      (c) =>
        c.client_id === paciente.client_id &&
        (!c.patient_id || c.patient_id === paciente.id) &&
        (c.concept_ids || []).includes(conceptoId)
    );
    return suya?.id ?? null;
  }

  // ── Inscripciones que ya hay ─────────────────────────────────────────────
  const inscripciones = await q(
    `SELECT id, patient_id, grupo_id, left_at FROM "${schema}"."taller_inscripciones" WHERE taller_id = $1`,
    [taller.id]
  );
  const abiertaDe = new Map(inscripciones.filter((i) => !i.left_at).map((i) => [i.patient_id, i]));

  const sinCasar = [];
  const dudosos = [];
  const reclamados = new Set();
  let movidos = 0;
  let nuevos = 0;
  let yaEstaban = 0;
  let conCuota = 0;
  let exactos = 0;
  const aproximados = [];

  for (const g of listas) {
    const concepto = conceptoPorNombre.get(g.concepto) ?? null;
    if (g.concepto && !concepto) log(`⚠ No existe el concepto «${g.concepto}»: el grupo se creará sin cobro`);

    // El grupo
    const ya = await q(`SELECT id FROM "${schema}"."taller_grupos" WHERE taller_id = $1 AND name = $2`, [taller.id, g.nombre]);
    let grupoId = ya[0]?.id ?? null;
    if (grupoId) {
      log(`· Grupo «${g.nombre}» ya existía`);
    } else {
      log(`${confirm ? "→" : "·"} Grupo «${g.nombre}» (${g.duracion} min${concepto ? `, ${concepto.name}` : ""})`);
      if (confirm) {
        const creado = await q(
          `INSERT INTO "${schema}"."taller_grupos" (taller_id, name, duration, concept_id, active)
           VALUES ($1, $2, $3, $4, TRUE) RETURNING id`,
          [taller.id, g.nombre, g.duracion, concepto?.id ?? null]
        );
        grupoId = creado[0].id;
      }
    }

    // Sus miembros
    for (const nombre of g.miembros ?? []) {
      const candidatos = pacientes.filter((p) => casa(nombre, p.nombre));
      if (candidatos.length === 0) { sinCasar.push({ nombre, grupo: g.nombre }); continue; }
      if (candidatos.length > 1) {
        // Dos pacientes con el mismo nombre: no se elige por nadie.
        dudosos.push({ nombre, grupo: g.nombre, cuantos: candidatos.length });
        continue;
      }
      const p = candidatos[0];
      // Exacto vs «una contiene a la otra»: el segundo es el que podría
      // confundir a dos hermanos, así que se cuenta aparte y se enseña.
      if (normalizar(nombre) === normalizar(p.nombre)) exactos += 1;
      else aproximados.push({ lista: nombre, ficha: p.nombre });
      reclamados.add(p.id);
      const cuotaId = cuotaDe(p, concepto?.id);
      if (cuotaId) conCuota += 1;

      const abierta = abiertaDe.get(p.id);
      if (abierta) {
        if (abierta.grupo_id === grupoId) { yaEstaban += 1; continue; }
        movidos += 1;
        if (confirm && grupoId) {
          await q(
            `UPDATE "${schema}"."taller_inscripciones" SET grupo_id = $1, cuota_id = COALESCE($2, cuota_id), updated_at = NOW() WHERE id = $3`,
            [grupoId, cuotaId, abierta.id]
          );
        }
      } else {
        nuevos += 1;
        if (confirm && grupoId) {
          await q(
            `INSERT INTO "${schema}"."taller_inscripciones" (taller_id, grupo_id, patient_id, cuota_id, joined_at, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
            [taller.id, grupoId, p.id, cuotaId, hoy]
          );
        }
      }
    }
  }

  // ── El cajón ─────────────────────────────────────────────────────────────
  const viejos = await q(
    `SELECT id FROM "${schema}"."taller_grupos" WHERE taller_id = $1 AND name = 'Grupo 1'`,
    [taller.id]
  );
  let sobran = 0;
  if (viejos.length) {
    const enElViejo = inscripciones.filter((i) => !i.left_at && i.grupo_id === viejos[0].id);
    sobran = enElViejo.filter((i) => !reclamados.has(i.patient_id)).length;
    log(`${confirm ? "→" : "·"} «Grupo 1» pasa a llamarse «${CAJON}»`);
    if (confirm) {
      await q(`UPDATE "${schema}"."taller_grupos" SET name = $1, updated_at = NOW() WHERE id = $2`, [CAJON, viejos[0].id]);
      /*
       * Y su TIPO DE CITA, que si no se queda con el nombre viejo: en la
       * agenda saldria «Grupo 1» para un grupo que ya no se llama asi. Pasó
       * la primera vez que se ejecutó esto. La regla del nombre es la misma
       * que usa la pantalla (`lib/clinica/tipoCitaTaller.js`).
       */
      await q(
        `UPDATE "${schema}"."event_types" SET name = $1, updated_at = NOW() WHERE taller_grupo_id = $2`,
        [`${taller.name} · ${CAJON}`, viejos[0].id]
      );
    }
  }

  // ── Resumen ──────────────────────────────────────────────────────────────
  process.stdout.write("\n── Reparto ─────────────────────────────────────────\n");
  for (const g of listas) log(`${g.nombre}: ${(g.miembros ?? []).length} en la lista de Organízate`);
  log(`movidos del grupo viejo: ${movidos} · apuntados nuevos: ${nuevos} · ya estaban donde tocaba: ${yaEstaban}`);
  log(`con su cuota de HHSS enlazada: ${conCuota}`);
  log(`casados por nombre EXACTO: ${exactos} · por parecido: ${aproximados.length}`);
  log(`se quedan en «${CAJON}» (no salen en ninguna lista): ${sobran}`);

  if (sinCasar.length) {
    process.stdout.write("\n── No se ha encontrado a estas personas ────────────\n");
    for (const x of sinCasar) log(`«${x.nombre}» (${x.grupo})`);
  }
  if (aproximados.length) {
    process.stdout.write("\n── Casados por PARECIDO, revísalos ────────────────\n");
    for (const x of aproximados) log(`«${x.lista}» → ficha «${x.ficha}»`);
  }
  if (dudosos.length) {
    process.stdout.write("\n── Hay VARIOS pacientes con este nombre ────────────\n");
    for (const x of dudosos) log(`«${x.nombre}» (${x.grupo}): ${x.cuantos} coincidencias — lo decide el centro`);
  }

  process.stdout.write(
    confirm ? "\n✓ Hecho\n  Falta: ponerle terapeutas a cada grupo desde la pantalla.\n\n" : "\n· Ensayo. Relanza con --confirm\n\n"
  );
  await s.close();
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n\n`);
  process.exit(1);
});
