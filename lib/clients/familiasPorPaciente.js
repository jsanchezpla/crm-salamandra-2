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

/**
 * La consulta con NOMBRES: [{ clientId, nombre }], un par por paciente que
 * casa (con duplicados de familia si casan dos hermanos). La usan los
 * SELECTORES (/api/clients y /api/billing/fichas) para poder decir por qué
 * sale cada ficha — «paciente: X» —; la etiqueta vive en `buscarFichas.js`,
 * que es el fichero que el navegador carga.
 */
export async function pacientesQueCasan({ q, Patient, hasModule, limite = 200 }) {
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
      attributes: ["clientId", "firstName", "lastName"],
      // Tope alto y propio, como en Citas: con 1.174 pacientes una palabra
      // corta puede traer muchos, y aquí solo se necesitan las familias.
      limit: limite,
      raw: true,
    });
    return encontrados
      .filter((p) => p && p.clientId != null)
      .map((p) => ({
        clientId: p.clientId,
        nombre: [p.firstName, p.lastName].filter(Boolean).join(" ").trim(),
      }));
  } catch (err) {
    const code = err?.parent?.code || err?.original?.code;
    if (code === "42P01") return []; // tenant sin tabla de pacientes: como estaba
    throw err;
  }
}

export async function idsDeFamiliaPorPaciente({ q, Patient, hasModule }) {
  const pares = await pacientesQueCasan({ q, Patient, hasModule });
  return [...new Set(pares.map((p) => p.clientId))];
}
