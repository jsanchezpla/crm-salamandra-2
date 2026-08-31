/**
 * familiasPorPaciente — qué fichas de cliente salen al buscar por el NOMBRE DEL
 * PACIENTE (31/08/2026).
 *
 * En un centro clínico al niño se le conoce por su nombre y la familia paga con
 * otro: buscar «Hugo» tiene que encontrar la ficha de su familia aunque no se
 * apellide igual. Citas lo resolvió primero (app/api/citas/clientes/route.js);
 * esto es la misma jugada, con nombre, para que Facturación —facturas y
 * presupuestos— no copie el bloque.
 *
 * Devuelve los ids de familia (clients.id), SIN duplicados. Vacío cuando no
 * aplica: sin texto, sin modelo Patient, sin módulo asistencial, o con la tabla
 * sin migrar (42P01) — en todos esos casos el buscador de siempre sigue solo.
 *
 * ⚠️ Quien lo use debe añadir el fragmento SOLO si la lista tiene algo: un
 * `IN ()` vacío dentro de un `Op.or` no devuelve nada y se lleva por delante la
 * búsqueda por nombre, que es la que funcionaba (aviso heredado de Citas).
 */
import { filtroPorNombre } from "../utils/busquedaDb.js";

export async function idsDeFamiliaPorPaciente({ q, Patient, hasModule }) {
  if (!q || !Patient) return [];
  if (typeof hasModule === "function" && !hasModule("pacientes") && !hasModule("clinica")) return [];
  try {
    const filtro = await filtroPorNombre(Patient.sequelize, q, [
      "Patient.first_name",
      "Patient.last_name",
    ]);
    if (!filtro) return [];
    const encontrados = await Patient.findAll({
      where: filtro,
      attributes: ["clientId"],
      // Tope alto y propio, como en Citas: con 1.174 pacientes una palabra
      // corta puede traer muchos, y aquí solo se necesitan las familias.
      limit: 200,
      raw: true,
    });
    const ids = new Set();
    for (const p of encontrados) {
      if (p && p.clientId != null) ids.add(p.clientId);
    }
    return [...ids];
  } catch (err) {
    const code = err?.parent?.code || err?.original?.code;
    if (code === "42P01") return []; // tenant sin tabla de pacientes: como estaba
    throw err;
  }
}
