/**
 * _smoke-tipos-profesionales.mjs — la supervisión es solo para colegas
 * (12/08/2026, Rodrigo).
 *
 * Lógica pura, sin base de datos ni servidor:
 *   node scripts/_smoke-tipos-profesionales.mjs
 *
 * «Supervisión profesional» estaba en la agenda pública de nutri_laura a 60 € y
 * podía reservarla cualquiera. Es una sesión entre profesionales, no una
 * consulta: solo entra quien viene marcado del formulario de profesionales.
 *
 * Lo que se fija:
 *   · un tipo de la lista no lo ve ni lo reserva quien no está marcado;
 *   · quien SÍ está marcado lo ve y lo reserva;
 *   · un BONO no abre esa puerta —sería una trasera al mismo sitio—;
 *   · sin lista configurada no cambia nada para nadie (el resto de clientes);
 *   · y el filtro del listado y el corte de /book dicen SIEMPRE lo mismo, que
 *     es lo que impide que esconder el botón se confunda con impedir.
 */

import {
  filtrarTiposPara,
  puedeReservar,
  slugsSoloProfesionales,
  esSoloParaProfesionales,
} from "../lib/citas/tiposVisibles.js";

let fallos = 0;
function check(etiqueta, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  process.stdout.write(`${ok ? "✓" : "✗"} ${etiqueta}\n`);
  if (!ok) process.stdout.write(`    esperado ${JSON.stringify(esperado)}, salió ${JSON.stringify(real)}\n`);
}

const TENANT = { settings: { citas: { tiposSoloProfesionales: ["supervision-profesional"] } } };
const SIN_LISTA = { settings: { citas: {} } };

const VALORACION  = { id: "t1", slug: "valoracion-inicial", isHidden: false };
const SUPERVISION = { id: "t2", slug: "supervision-profesional", isHidden: false };
const BONO        = { id: "t3", slug: "acompanamiento-mensual", isHidden: true };
const TODOS = [VALORACION, SUPERVISION, BONO];

const nombres = (r) => r.map((t) => t.slug);

process.stdout.write("\n▶ Quién ve la supervisión en el listado\n");
check(
  "sin marcar, no la ve",
  nombres(filtrarTiposPara(TODOS, new Set(), { esProfesional: false, tenant: TENANT })),
  ["valoracion-inicial"]
);
check(
  "marcado como profesional, sí",
  nombres(filtrarTiposPara(TODOS, new Set(), { esProfesional: true, tenant: TENANT })),
  ["valoracion-inicial", "supervision-profesional"]
);
check(
  "y el bono oculto sigue funcionando igual que siempre",
  nombres(filtrarTiposPara(TODOS, new Set(["t3"]), { esProfesional: false, tenant: TENANT })),
  ["valoracion-inicial", "acompanamiento-mensual"]
);

process.stdout.write("\n▶ Y quién la puede reservar de verdad (/book)\n");
check(
  "sin marcar → cortado",
  puedeReservar(SUPERVISION, { tenant: TENANT, esProfesional: false }).ok,
  false
);
check(
  "marcado → pasa",
  puedeReservar(SUPERVISION, { tenant: TENANT, esProfesional: true }).ok,
  true
);
check(
  "un BONO no abre la supervisión (nada de puertas traseras)",
  puedeReservar(SUPERVISION, { tenant: TENANT, esProfesional: false, tieneBono: true }).ok,
  false
);
check(
  "y el motivo no delata que el tipo exista",
  puedeReservar(SUPERVISION, { tenant: TENANT, esProfesional: false }).motivo,
  puedeReservar({ id: "x", slug: "no-existe", isHidden: true }, { tenant: TENANT }).motivo
);

process.stdout.write("\n▶ El listado y /book no se contradicen\n");
for (const pro of [false, true]) {
  const visibles = new Set(nombres(filtrarTiposPara(TODOS, new Set(), { esProfesional: pro, tenant: TENANT })));
  const reservables = new Set(
    TODOS.filter((t) => puedeReservar(t, { tenant: TENANT, esProfesional: pro }).ok).map((t) => t.slug)
  );
  check(
    `profesional=${pro}: lo que se ve es lo que se puede reservar`,
    [...visibles].sort(),
    [...reservables].sort()
  );
}

process.stdout.write("\n▶ Sin lista configurada, nada cambia para el resto de clientes\n");
check(
  "los ve todos igual que antes",
  nombres(filtrarTiposPara(TODOS, new Set(), { esProfesional: false, tenant: SIN_LISTA })),
  ["valoracion-inicial", "supervision-profesional"]
);
check("y reserva la supervisión sin estar marcado", puedeReservar(SUPERVISION, { tenant: SIN_LISTA }).ok, true);
check("sin tenant tampoco revienta", puedeReservar(SUPERVISION, {}).ok, true);

process.stdout.write("\n▶ Cómo se lee la lista\n");
check("vacía si no es un array", slugsSoloProfesionales({ settings: { citas: { tiposSoloProfesionales: "x" } } }).size, 0);
// Se normalizan los DOS lados: el slug del tipo y lo que haya escrito alguien a
// mano en Configuración, que es donde aparecen los espacios de sobra.
check("se normaliza (espacios y mayúsculas)", esSoloParaProfesionales(
  { slug: "Supervision-Profesional" },
  { settings: { citas: { tiposSoloProfesionales: ["  supervision-profesional  "] } } }
), true);
check("pero un slug distinto NO cuela", esSoloParaProfesionales(
  { slug: "supervision" },
  TENANT
), false);
check("y con el slug tal cual, entra", esSoloParaProfesionales({ slug: " SUPERVISION-PROFESIONAL " }, TENANT), true);
check("un tipo sin slug nunca es de profesionales", esSoloParaProfesionales({ id: "z" }, TENANT), false);

process.stdout.write(
  fallos === 0 ? "\n✓ Todo correcto\n\n" : `\n✗ ${fallos} comprobacion(es) fallidas\n\n`
);
process.exit(fallos === 0 ? 0 : 1);
