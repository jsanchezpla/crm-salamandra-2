/**
 * _smoke-paciente-borrado.mjs — borrar a un paciente lo devuelve al paso cero
 * (06/08/2026, Rodrigo).
 *
 * Lógica pura, sin base de datos ni servidor:
 *   node scripts/_smoke-paciente-borrado.mjs
 *
 * Lo que se fija:
 *   · con solicitud aceptada Y ficha → entra;
 *   · con solicitud aceptada y SIN ficha (la borraron) → paso cero, y se le
 *     ofrece el formulario, no un «te hemos dado de baja»;
 *   · si además había mandado una solicitud nueva, manda esa: «en revisión»;
 *   · lo de siempre (pendiente, descartada, sin enviar) sigue igual.
 *
 * Existe porque este fallo es invisible: la ficha desaparece del CRM y la
 * paciente sigue entrando a su área privada como si nada.
 */

import { estadoDeAdmision, mensajeDePuerta } from "../lib/citas/puertaFormulario.js";

// Modelos de mentira: lo justo para que `estadoDeAdmision` y el buscador de
// fichas del portal funcionen sin tocar Postgres.
function modelos({ solicitudes = [], ficha = null }) {
  return {
    FormSubmission: { findAll: async () => solicitudes.map((status) => ({ status })) },
    Client: {
      findOne: async () => ficha,
      // `resolvePortalClient` hace el segundo camino (tutores) con SQL crudo.
      sequelize: { literal: (s) => s, escape: (s) => `'${s}'` },
    },
  };
}

let fallos = 0;
function check(etiqueta, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  process.stdout.write(`${ok ? "✓" : "✗"} ${etiqueta}\n`);
  if (!ok) process.stdout.write(`    esperado ${JSON.stringify(esperado)}, salió ${JSON.stringify(real)}\n`);
}

const estado = (opts) => estadoDeAdmision(modelos(opts), "paciente@ejemplo.com");
const FICHA = { id: "cli-1", name: "Paciente" };

process.stdout.write("\n▶ Con ficha, todo como antes\n");
check("aceptada + ficha → aceptada", await estado({ solicitudes: ["accepted"], ficha: FICHA }), "aceptada");
check("pendiente → pendiente", await estado({ solicitudes: ["pending"], ficha: FICHA }), "pendiente");
check("descartada → descartada", await estado({ solicitudes: ["rejected"], ficha: FICHA }), "descartada");
check("sin solicitudes → sin_enviar", await estado({ solicitudes: [], ficha: FICHA }), "sin_enviar");
check(
  "aceptada manda sobre una pendiente posterior",
  await estado({ solicitudes: ["accepted", "pending"], ficha: FICHA }),
  "aceptada"
);

process.stdout.write("\n▶ Borrada la ficha, vuelve al paso cero\n");
check("aceptada SIN ficha → sin_ficha", await estado({ solicitudes: ["accepted"], ficha: null }), "sin_ficha");
check(
  "aceptada vieja + solicitud nueva esperando → pendiente",
  await estado({ solicitudes: ["accepted", "pending"], ficha: null }),
  "pendiente"
);
check(
  "sin ficha NO cuela por tener solo una descartada",
  await estado({ solicitudes: ["rejected"], ficha: null }),
  "descartada"
);

process.stdout.write("\n▶ Lo que ve en pantalla\n");
const aviso = mensajeDePuerta("sin_ficha", { identificado: true, nombre: "tunutrilaura" });
check("se le ofrece el formulario", aviso.mostrarEnlace, true);
check("con el mensaje de primera visita", aviso.codigo, "ADMISION_REQUERIDA");
check(
  "y NO se le dice que le han dado de baja",
  /baja|borrad|elimin/i.test(`${aviso.titulo} ${aviso.texto}`),
  false
);

process.stdout.write(
  fallos === 0 ? "\n✓ Todo correcto\n\n" : `\n✗ ${fallos} comprobacion(es) fallidas\n\n`
);
process.exit(fallos === 0 ? 0 : 1);
