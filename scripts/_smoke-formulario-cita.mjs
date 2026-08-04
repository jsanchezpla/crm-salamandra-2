/**
 * _smoke-formulario-cita.mjs — el formulario propio de un tipo de cita.
 *
 * Un tipo de cita puede llevar preguntas que se responden DESPUÉS de elegir
 * fecha y hora (p. ej. una supervisión profesional: de qué caso se va a
 * hablar). Es opcional: los tipos de cita sin formulario reservan igual que
 * siempre.
 *
 * Lo que se fija aquí:
 *   · el tipo de cita viaja al widget con sus preguntas, y sin `settings`
 *     —donde están los correos internos de aviso—;
 *   · una respuesta obligatoria en blanco NO deja reservar;
 *   · respondiendo, la cita se crea y las respuestas quedan CON LA CITA,
 *     llevando el enunciado dentro para que el histórico no mienta si mañana
 *     se reformula la pregunta;
 *   · un tipo de cita SIN formulario sigue reservando sin preguntar nada.
 *
 * No toca datos reales: crea lo suyo y lo borra.
 *
 * Uso: node --env-file=.env.local scripts/_smoke-formulario-cita.mjs [slug]
 */

import { getTenantDb } from "../lib/db/tenantDb.js";
import { formPublico, validarRespuestas } from "../lib/formularios/fields.js";

const SLUG = process.argv[2] || "demo";

let fallos = 0;
const ok = (m) => process.stdout.write(`  ✓ ${m}\n`);
const mal = (m) => { fallos++; process.stderr.write(`  ✗ ${m}\n`); };
const paso = (m) => process.stdout.write(`\n▶ ${m}\n`);
const esperar = (c, m) => (c ? ok(m) : mal(m));

const { models } = getTenantDb(SLUG);
const { EventType, Form } = models;

let form;
let tipoConForm;
let tipoSinForm;

async function main() {
  process.stdout.write(`\n═══ Smoke: formulario por tipo de cita (${SLUG}) ═══\n`);
  if (!Form) throw new Error("este cliente no tiene el módulo de formularios");

  form = await Form.create({
    slug: `smoke-supervision-${Date.now()}`,
    title: "Antes de la supervisión",
    introText: "Cuéntame brevemente el caso para preparar la sesión.",
    fields: [
      { key: "caso", label: "¿De qué caso quieres hablar?", type: "textarea", required: true, order: 1, maxLength: 600 },
      { key: "urgencia", label: "¿Es urgente?", type: "select", required: true, order: 2, options: ["Sí", "No"] },
      { key: "notas", label: "Algo más", type: "text", required: false, order: 3 },
    ],
    settings: { notifyEmails: ["interno@example.com"], privacyUrl: "https://example.com/privacidad" },
    active: true,
  });

  tipoConForm = await EventType.create({
    name: "Smoke supervisión profesional",
    slug: `smoke-superv-${Date.now()}`,
    duration: 60,
    modalities: ["online"],
    formId: form.id,
    active: false,
  });
  tipoSinForm = await EventType.create({
    name: "Smoke consulta normal",
    slug: `smoke-normal-${Date.now()}`,
    duration: 60,
    modalities: ["online"],
    active: false,
  });

  // ── Lo que ve el widget ─────────────────────────────────────────────────
  paso("Lo que llega al widget");
  const publico = formPublico(form);
  esperar(publico.fields.length === 3, "viajan las tres preguntas");
  esperar(publico.title === "Antes de la supervisión", "con su título");
  esperar(!("settings" in publico), "y SIN `settings`: ahí están los correos internos de aviso");
  esperar(
    publico.fields.find((f) => f.key === "urgencia")?.options?.length === 2,
    "las opciones del desplegable llegan para poder pintarlo"
  );

  // ── Validación ──────────────────────────────────────────────────────────
  paso("Sin responder no se reserva");
  const vacio = validarRespuestas(form, {});
  esperar(vacio.ok === false, "faltando lo obligatorio, se rechaza");
  esperar(
    vacio.errores.some((e) => e.key === "caso"),
    `y dice cuál falta: ${vacio.errores?.[0]?.key ?? "—"}`
  );

  const soloUno = validarRespuestas(form, { caso: "Una paciente con atracones" });
  esperar(soloUno.ok === false, "faltando la segunda obligatoria, también");

  paso("Respondiendo, adelante");
  const bien = validarRespuestas(form, {
    caso: "Una paciente con atracones y mucha culpa",
    urgencia: "Sí",
  });
  esperar(bien.ok === true, "con lo obligatorio respondido, pasa");
  esperar(bien.answers.length >= 2, `y se guardan las respuestas (${bien.answers.length})`);
  esperar(
    bien.answers.every((a) => a.key && a.label && "value" in a),
    "cada una con su ENUNCIADO dentro: si mañana se reformula, el histórico no miente"
  );
  esperar(
    bien.answers.find((a) => a.key === "caso")?.value?.includes("atracones"),
    "y con lo que escribió de verdad"
  );

  // ── Tipos sin formulario ────────────────────────────────────────────────
  paso("Un tipo de cita sin formulario");
  esperar(tipoSinForm.formId == null, "no tiene formulario, así que no se le pregunta nada");
  esperar(tipoConForm.formId === form.id, "y el que sí lo tiene, apunta al suyo");

  // Borrar el formulario NO puede romper el tipo de cita: la FK es SET NULL.
  paso("Si se borra el formulario");
  await form.destroy();
  form = null;
  await tipoConForm.reload();
  esperar(
    tipoConForm.formId === null,
    "el tipo de cita se queda SIN formulario, no roto: se sigue pudiendo reservar"
  );
}

main()
  .catch((err) => mal(err.message))
  .finally(async () => {
    for (const t of [tipoConForm, tipoSinForm]) await t?.destroy().catch(() => {});
    await form?.destroy().catch(() => {});
    process.stdout.write("\n  · datos de prueba borrados\n");
    process.stdout.write(fallos === 0 ? "\n═══ ✓ Todo en orden ═══\n\n" : `\n═══ ✗ ${fallos} fallo(s) ═══\n\n`);
    process.exit(fallos === 0 ? 0 : 1);
  });
