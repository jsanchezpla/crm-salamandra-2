/**
 * add-dni-formulario-nutri-laura.js — el DNI, en el formulario de primer contacto.
 *
 * POR QUÉ EXISTE
 * Las preguntas de un formulario son DATOS (`forms.fields`, JSONB), no código:
 * por eso esto es un script y no una migración de estructura. Añade el campo a
 * los formularios que ya están publicados sin tocar las respuestas recibidas.
 *
 * DECISIONES QUE LLEVA DENTRO
 *
 * · **Es el DNI del TUTOR.** En esta consulta el paciente puede ser un menor, y
 *   quien firma el contrato —y por tanto quien tiene que estar identificado— es
 *   el adulto responsable. La etiqueta lo dice en la propia pregunta para que
 *   nadie ponga el del niño.
 *
 * · **NO es obligatorio.** El formulario es la puerta de entrada: quien lo
 *   rellena todavía no es paciente, solo alguien contando lo que le pasa. Pedir
 *   un documento antes de eso frena a gente que sí habría venido. El DNI hace
 *   falta al FIRMAR, y ahí ya se pide lo que falte (`datosFicha.js`). Quien lo
 *   traiga desde aquí se ahorra ese paso; quien no, no se queda fuera.
 *
 * · **Va el segundo, detrás del nombre.** Es un dato de identificación y ahí es
 *   donde se espera; enterrado al final se rellena menos.
 *
 * Idempotente: si el campo ya está, no hace nada. Solo lectura con `--dry`.
 *
 * Uso:  node --env-file=.env.local scripts/add-dni-formulario-nutri-laura.js [--dry] [slug]
 * Prod: docker exec -it crm-salamandra-app-1 node scripts/add-dni-formulario-nutri-laura.js
 */

import { getTenantDb } from "../lib/db/tenantDb.js";

const DRY = process.argv.includes("--dry");
const SLUG = process.argv.find((a) => !a.startsWith("--") && !a.includes("node") && !a.includes(".js")) || "nutri_laura";

const CAMPO = Object.freeze({
  key: "dni",
  label: "DNI de quien firma",
  type: "dni",
  required: false,
  order: 2,
  placeholder: "12345678Z",
  help: "Si la consulta es para un menor, el DNI de su padre, madre o tutor. Puedes dejarlo en blanco y darlo más adelante.",
  mapTo: "taxId",
});

async function main() {
  process.stdout.write(`\n═══ DNI en el formulario de primer contacto (${SLUG})${DRY ? " · SIMULACRO" : ""} ═══\n`);

  const { models } = getTenantDb(SLUG);
  const forms = await models.Form.findAll({ order: [["createdAt", "ASC"]] });
  if (!forms.length) {
    process.stdout.write("  No hay formularios en este cliente. Nada que hacer.\n");
    return;
  }

  let tocados = 0;
  for (const form of forms) {
    const campos = Array.isArray(form.fields) ? form.fields : [];

    if (campos.some((c) => c?.key === CAMPO.key || c?.mapTo === "taxId")) {
      process.stdout.write(`  · "${form.slug}" — ya lo tiene, se deja como está.\n`);
      continue;
    }

    // Un formulario SIN preguntas no es un formulario público a medio hacer: es
    // otro flujo, que recoge sus datos por su cuenta y solo usa esta tabla para
    // dejar constancia de la solicitud. Meterle una pregunta suelta lo
    // convertiría en un formulario de un solo campo —el DNI y nada más—, que es
    // peor que no tocarlo. En producción hay uno así, con 49 solicitudes
    // detrás.
    if (!campos.length) {
      process.stdout.write(`  · "${form.slug}" — sin preguntas propias, no es de este tipo: se deja.\n`);
      continue;
    }

    // El nuevo entra en el hueco 2; todo lo que venía detrás baja un puesto.
    // Se reescribe el `order` de TODOS para no dejar dos campos empatados: dos
    // números iguales ordenan de forma imprevisible y el formulario saldría
    // distinto en cada carga.
    const nuevos = [
      ...campos.filter((c) => Number(c.order) < CAMPO.order),
      { ...CAMPO },
      ...campos.filter((c) => Number(c.order) >= CAMPO.order),
    ].map((c, i) => ({ ...c, order: i + 1 }));

    process.stdout.write(`  · "${form.slug}" — ${campos.length} campos → ${nuevos.length}\n`);
    for (const c of nuevos) {
      process.stdout.write(`      ${String(c.order).padStart(2)}. ${c.key}${c.key === CAMPO.key ? "   ← nuevo" : ""}\n`);
    }

    if (!DRY) {
      // `changed()` explícito: Sequelize no detecta la mutación de un JSONB si
      // no se le avisa, y el UPDATE saldría vacío sin decir nada.
      form.set("fields", nuevos);
      form.changed("fields", true);
      await form.save();
    }
    tocados++;
  }

  process.stdout.write(
    DRY
      ? `\n═══ SIMULACRO: se habrían tocado ${tocados} formulario(s). Nada escrito. ═══\n`
      : `\n═══ Listo: ${tocados} formulario(s) actualizados. ═══\n`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    process.stderr.write(`\n✗ ${err.stack || err.message}\n`);
    process.exit(1);
  });
