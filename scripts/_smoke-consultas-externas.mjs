// @prueba ligera — de sequelize solo importa `Op`, que es un símbolo; no abre ninguna conexión.
/**
 * _smoke-consultas-externas.mjs — quién ve a los pacientes de acuerdos con
 * empresas (07/08/2026, Rodrigo). Lógica pura, sin base de datos:
 *
 *   node scripts/_smoke-consultas-externas.mjs
 *
 * Vigila las dos formas de equivocarse, y no son simétricas:
 *   · enseñar de MÁS — un paciente de una empresa visible para todo el equipo,
 *     que es justo lo que se quería evitar;
 *   · enseñar de MENOS — hacer desaparecer del CRM a los 1.083 pacientes
 *     normales de un centro, o a un externo de quien SÍ lo está tratando.
 */

import { Op } from "sequelize";
import {
  filtroDeVisibilidad,
  puedeVerFicha,
  llevaCuentaEnLaWeb,
  categoriasDe,
  normalizarCategoria,
  veTodasLasExternas,
} from "../lib/clients/consultaExterna.js";

let fallos = 0;
function check(etiqueta, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  process.stdout.write(`${ok ? "✓" : "✗"} ${etiqueta}\n`);
  if (!ok) process.stdout.write(`    esperado ${JSON.stringify(esperado)}, salió ${JSON.stringify(real)}\n`);
}

const MIA = "tm-1";
const OTRA = "tm-2";

process.stdout.write("\n▶ El listado: admin no filtra, el equipo sí\n");
check("admin → sin filtro", filtroDeVisibilidad("admin", MIA), null);
check("superadmin → sin filtro", filtroDeVisibilidad("superadmin", null), null);
check("un user SÍ lleva filtro", filtroDeVisibilidad("user", MIA) !== null, true);
check("un user sin ficha de equipo también", filtroDeVisibilidad("user", null) !== null, true);

process.stdout.write("\n▶ La ficha, de una en una\n");
const normal = { esConsultaExterna: false, assignedTeamMemberId: null };
const externaMia = { esConsultaExterna: true, assignedTeamMemberId: MIA };
const externaDeOtra = { esConsultaExterna: true, assignedTeamMemberId: OTRA };
const externaSinDuenio = { esConsultaExterna: true, assignedTeamMemberId: null };

check("paciente normal: lo ve cualquiera", puedeVerFicha(normal, "user", MIA), true);
check("paciente normal sin ficha de equipo: también", puedeVerFicha(normal, "user", null), true);
check("externa MÍA: la veo", puedeVerFicha(externaMia, "user", MIA), true);
check("externa DE OTRA: no", puedeVerFicha(externaDeOtra, "user", MIA), false);
check("externa de otra, pero soy admin: sí", puedeVerFicha(externaDeOtra, "admin", null), true);
check("externa sin asignar: solo admin", puedeVerFicha(externaSinDuenio, "user", MIA), false);
check("externa sin asignar, admin: sí", puedeVerFicha(externaSinDuenio, "admin", null), true);

process.stdout.write("\n▶ Fichas viejas (columna a NULL) NO desaparecen\n");
check("sin el campo: se ve", puedeVerFicha({ assignedTeamMemberId: null }, "user", MIA), true);
check("con el campo a null: se ve", puedeVerFicha({ esConsultaExterna: null }, "user", null), true);
/*
 * ⚠️ Las ramas de Sequelize cuelgan de `Op.or`, que es un SÍMBOLO: no se pueden
 * mirar con JSON.stringify —las deja fuera en silencio— y la comprobación
 * pasaría a ser «el filtro no está vacío», que no dice nada. Se leen por el
 * símbolo. Es lo que hace que esta prueba valga para algo.
 */
const ramas = (role, tm) => filtroDeVisibilidad(role, tm)?.[Op.or] ?? [];
check("un user sin equipo: dos ramas, false y null",
  ramas("user", null).map((r) => r.esConsultaExterna), [false, null]);
check("un user con equipo: y además las suyas",
  ramas("user", MIA).map((r) => r.esConsultaExterna), [false, null, true]);
check("la tercera rama exige que sea SUYA",
  ramas("user", MIA)[2].assignedTeamMemberId, MIA);
check("nadie más se cuela por esa rama",
  ramas("user", MIA).filter((r) => r.esConsultaExterna === true && !r.assignedTeamMemberId).length, 0);

process.stdout.write("\n▶ Cuenta en la web\n");
check("paciente normal: sí", llevaCuentaEnLaWeb(normal), true);
check("consulta externa: NO", llevaCuentaEnLaWeb(externaMia), false);
check("ficha vieja sin el campo: sí", llevaCuentaEnLaWeb({}), true);

process.stdout.write("\n▶ Las categorías del desplegable\n");
const t = (lista) => ({ settings: { clientes: { categoriasExternas: lista } } });
check("sin configurar → vacío", categoriasDe({}), []);
check("no es un array → vacío", categoriasDe(t("Empresa A")), []);
check("limpia espacios", categoriasDe(t([" Empresa A ", "Empresa B"])), ["Empresa A", "Empresa B"]);
check("quita repetidas sin mirar mayúsculas", categoriasDe(t(["Empresa A", "empresa a", "Otra"])), ["Empresa A", "Otra"]);
check("descarta vacías y nulos", categoriasDe(t(["", null, "  ", "Buena"])), ["Buena"]);

process.stdout.write("\n▶ La categoría de la ficha\n");
check("texto normal", normalizarCategoria("  Empresa A "), "Empresa A");
check("vacía → null", normalizarCategoria("   "), null);
check("nada → null", normalizarCategoria(null), null);
check("se acepta aunque no esté en la lista", normalizarCategoria("Empresa que ya no está"), "Empresa que ya no está");
check("se recorta a 80", normalizarCategoria("x".repeat(200)).length, 80);

process.stdout.write("\n▶ Quién manda\n");
check("admin", veTodasLasExternas("admin"), true);
check("superadmin", veTodasLasExternas("superadmin"), true);
check("user", veTodasLasExternas("user"), false);
check("rol raro", veTodasLasExternas("recepcion"), false);

process.stdout.write(fallos === 0 ? "\n✓ TODO CORRECTO\n\n" : `\n✗ ${fallos} FALLO(S)\n\n`);
process.exit(fallos === 0 ? 0 : 1);
