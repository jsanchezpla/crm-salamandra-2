// @prueba ligera — importa `Op` y se fabrica un sequelize de mentira; no abre ninguna conexión.
/**
 * _smoke-puerta-profesional.mjs — el profesional no hace el formulario del
 * paciente (12/08/2026, Rodrigo).
 *
 * Sin base de datos ni servidor: los modelos son de mentira.
 *   node scripts/_smoke-puerta-profesional.mjs
 *
 * «Una persona registrada como profesional no tiene que hacer el formulario, con
 * haber hecho su formulario profesional le vale. Un paciente que entra por el
 * formulario comercial sí que tiene que hacerlo sí o sí.»
 *
 * Lo que se fija:
 *   · quien viene marcado pasa SIN solicitud en la bandeja;
 *   · y pasa incluso con la bandeja rota, porque su formulario es otro;
 *   · el paciente de siempre sigue chocándose con la puerta;
 *   · no poder LEER la marca deja a la persona en la puerta normal, nunca fuera
 *     de ella (un fallo de lectura no puede abrir);
 *   · y `admitido()` dice lo mismo para los dos estados que dejan pasar, que es
 *     lo que impide que el portal diga que sí y /book responda 403.
 */

import { Op } from "sequelize";
import { estadoDeAdmision, admitido } from "../lib/citas/puertaFormulario.js";

let fallos = 0;
function check(etiqueta, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  process.stdout.write(`${ok ? "✓" : "✗"} ${etiqueta}\n`);
  if (!ok) process.stdout.write(`    esperado ${JSON.stringify(esperado)}, salió ${JSON.stringify(real)}\n`);
}

const CORREO = "colega@nutricion.es";

/**
 * Modelos de mentira. `ficha` es la que devuelve la búsqueda por correo,
 * `marcado` si esa ficha lleva la marca de profesional, y `bandeja` lo que
 * responde el buscador de solicitudes (o "rota" para que reviente).
 */
function modelos({ ficha = null, marcado = false, marcaRota = false, bandeja = [] } = {}) {
  return {
    Client: {
      sequelize: { literal: (x) => x, escape: (s) => `'${s}'` },
      async findOne({ where }) {
        const buscado = where?.email?.[Op.iLike];
        if (buscado && ficha && ficha.email?.toLowerCase() === String(buscado).toLowerCase()) return ficha;
        return null; // el camino del tutor no hace falta para esto
      },
      async findByPk() {
        return ficha;
      },
    },
    ClientModuleAssignment: {
      async findOne({ where }) {
        if (marcaRota) throw new Error("relation does not exist");
        if (where?.moduleKey !== "profesional_salud") return null;
        return marcado ? { id: "asignacion-1" } : null;
      },
    },
    FormSubmission: {
      async findAll() {
        if (bandeja === "rota") throw new Error("bandeja caída");
        return bandeja;
      },
    },
  };
}

const FICHA = { id: "cli-1", email: CORREO };

process.stdout.write("\n▶ El profesional\n");
check(
  "marcado y sin nada en la bandeja: pasa",
  await estadoDeAdmision(modelos({ ficha: FICHA, marcado: true, bandeja: [] }), CORREO),
  "profesional"
);
check(
  "marcado y con la bandeja rota: pasa igual",
  await estadoDeAdmision(modelos({ ficha: FICHA, marcado: true, bandeja: "rota" }), CORREO),
  "profesional"
);

process.stdout.write("\n▶ El paciente, como estaba\n");
check(
  "sin ficha y sin solicitud: se le pide el formulario",
  await estadoDeAdmision(modelos({ bandeja: [] }), CORREO),
  "sin_enviar"
);
check(
  "con ficha pero sin marcar y sin solicitud: se le pide igual",
  await estadoDeAdmision(modelos({ ficha: FICHA, marcado: false, bandeja: [] }), CORREO),
  "sin_enviar"
);
check(
  "aceptado y con ficha: pasa como toda la vida",
  await estadoDeAdmision(
    modelos({
      ficha: FICHA,
      marcado: false,
      bandeja: [{ status: "accepted", clientId: "cli-1", acceptedAt: "2026-08-01", rejectedAt: null }],
    }),
    CORREO
  ),
  "aceptada"
);
check(
  "sin marcar y con la bandeja rota: sigue cerrando",
  await estadoDeAdmision(modelos({ ficha: FICHA, bandeja: "rota" }), CORREO),
  "sin_bandeja"
);

process.stdout.write("\n▶ Si no se puede leer la marca, se cierra\n");
check(
  "la tabla de marcas revienta: cae en la puerta normal, no la abre",
  await estadoDeAdmision(modelos({ ficha: FICHA, marcaRota: true, bandeja: [] }), CORREO),
  "sin_enviar"
);

process.stdout.write("\n▶ Los dos lados preguntan lo mismo\n");
check("admitido('profesional')", admitido("profesional"), true);
check("admitido('aceptada')", admitido("aceptada"), true);
check("admitido('pendiente')", admitido("pendiente"), false);
check("admitido('sin_bandeja')", admitido("sin_bandeja"), false);
check("admitido('descartada_final')", admitido("descartada_final"), false);

process.stdout.write(fallos ? `\n✗ ${fallos} fallo(s)\n\n` : "\n✓ Todo correcto\n\n");
process.exit(fallos ? 1 : 0);
