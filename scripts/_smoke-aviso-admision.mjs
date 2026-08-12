/**
 * _smoke-aviso-admision.mjs — el 403 de una admitida sin ficha se cuenta
 * (12/08/2026).
 *
 * Lógica pura, sin base de datos ni servidor:
 *   node scripts/_smoke-aviso-admision.mjs
 *
 * Lo que se fija:
 *   · solo avisa con `sin_ficha` — el resto de estados son la puerta haciendo
 *     su trabajo y llenarían la campana de tráfico normal;
 *   · el aviso lleva nombre y correo, que es lo que hace falta para arreglarlo;
 *   · pide dedupe contra la SOLICITUD, no contra el intento: esto se dispara
 *     desde una agenda pública y anónima, y sin eso cinco reintentos serían
 *     cinco avisos;
 *   · si no hay solicitud que señalar, no se inventa un aviso;
 *   · y `avisarAdmisionRota` no revienta a quien está devolviendo un 403.
 */

import { avisoQueToca, avisarAdmisionRota, TIPO_AVISO } from "../lib/citas/avisoAdmisionRota.js";

let fallos = 0;
function check(etiqueta, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  process.stdout.write(`${ok ? "✓" : "✗"} ${etiqueta}\n`);
  if (!ok) process.stdout.write(`    esperado ${JSON.stringify(esperado)}, salió ${JSON.stringify(real)}\n`);
}

const SOLICITUD = {
  id: "sub-1",
  name: "Familia Ejemplo",
  email: "familia@ejemplo.com",
  acceptedAt: "2026-08-01",
};

function modelos({ solicitud = SOLICITUD, reventar = false } = {}) {
  return {
    FormSubmission: {
      findOne: async () => {
        if (reventar) throw new Error("bandeja caída");
        return solicitud;
      },
    },
  };
}

const toca = (estado, opts) => avisoQueToca({ tenantModels: modelos(opts), estado, email: "familia@ejemplo.com" });

process.stdout.write("\n▶ Solo avisa cuando hay una contradicción\n");
for (const estado of ["aceptada", "pendiente", "descartada", "sin_enviar", "sin_bandeja"]) {
  check(`"${estado}" no genera aviso`, await toca(estado), null);
}

process.stdout.write("\n▶ Con sin_ficha sí, y con lo que hace falta para arreglarlo\n");
{
  const aviso = await toca("sin_ficha");
  check("hay aviso", aviso !== null, true);
  check("del tipo de la campana", aviso?.type, TIPO_AVISO);
  check("con el nombre", aviso?.body?.includes("Familia Ejemplo"), true);
  check("y con el correo", aviso?.body?.includes("familia@ejemplo.com"), true);
  check("dice dónde arreglarlo", /Leads Comerciales/.test(aviso?.body ?? ""), true);
}

process.stdout.write("\n▶ Reintentar no puede multiplicar el aviso\n");
{
  const a = await toca("sin_ficha");
  const b = await toca("sin_ficha");
  check("pide dedupe", a?.dedupe, true);
  check("contra la solicitud, no contra el intento", a?.entityId, "sub-1");
  check("y la entidad es la misma en cada intento", a?.entityId === b?.entityId, true);
  check("con su entityType", a?.entityType, "FormSubmission");
}

process.stdout.write("\n▶ Sin nada que señalar, no se inventa un aviso\n");
check("sin solicitud → null", await toca("sin_ficha", { solicitud: null }), null);
check("sin modelos → null", await avisoQueToca({ tenantModels: null, estado: "sin_ficha", email: "x@y.z" }), null);
check("sin correo → null", await avisoQueToca({ tenantModels: modelos(), estado: "sin_ficha", email: null }), null);

process.stdout.write("\n▶ Y no revienta a quien está devolviendo un 403\n");
{
  let tiroso = false;
  try {
    // Con la bandeja caída y sin master detrás: las dos vías de fallo a la vez.
    avisarAdmisionRota({
      tenantId: "t-1",
      tenantModels: modelos({ reventar: true }),
      estado: "sin_ficha",
      email: "familia@ejemplo.com",
    });
    // El aviso va suelto a propósito; se le da un respiro al microtask.
    await new Promise((r) => setTimeout(r, 30));
  } catch {
    tiroso = true;
  }
  check("no lanza", tiroso, false);

  let tirosoEstado = false;
  try {
    avisarAdmisionRota({ tenantId: "t-1", tenantModels: null, estado: "aceptada", email: null });
  } catch {
    tirosoEstado = true;
  }
  check("y con un estado que no toca, ni lo intenta", tirosoEstado, false);
}

process.stdout.write(
  fallos === 0 ? "\n✓ Todo correcto\n\n" : `\n✗ ${fallos} comprobacion(es) fallidas\n\n`
);
process.exit(fallos === 0 ? 0 : 1);
