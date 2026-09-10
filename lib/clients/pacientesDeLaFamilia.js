/**
 * pacientesDeLaFamilia — quién es el paciente de cada ficha de cliente
 * (10/09/2026, Rodrigo).
 *
 * En un centro clínico la ficha de cliente es la FAMILIA (quien paga) y al que
 * se atiende es al niño. Mirando la lista de Clientes no había forma de saber
 * de quién era cada ficha sin entrar en ella una por una: «Vanesa Muñoz» no
 * dice nada, «Vanesa Muñoz · Hugo Castro» sí. Buscar por el nombre del paciente
 * ya funcionaba desde el 31/08/2026 (lib/clients/familiasPorPaciente.js); esto
 * es lo mismo al revés, para VER el paciente sin tener que buscarlo.
 *
 * Va en una consulta aparte y NO como `include` del listado a propósito: el
 * listado es un `findAndCountAll` paginado y un `hasMany` dentro multiplica las
 * filas, así que el total y las páginas dejarían de cuadrar (la página 1 diría
 * «50 de 1.800» contando hermanos).
 *
 * Devuelve un Map por id de familia. Vacío —nunca revienta— cuando no aplica:
 * sin ids, sin modelo Patient, sin módulo asistencial o con la tabla sin migrar
 * (42P01, tenant con schema parcial). Ahí la columna sale en blanco y la lista
 * sigue funcionando, que es lo que importa.
 */
import { Op } from "sequelize";

export async function pacientesPorFamilia({ clientIds, Patient, hasModule }) {
  const ids = [...new Set((clientIds ?? []).filter(Boolean).map(String))];
  if (!ids.length || !Patient) return new Map();
  if (typeof hasModule === "function" && !hasModule("pacientes") && !hasModule("clinica")) {
    return new Map();
  }
  try {
    const filas = await Patient.findAll({
      where: { clientId: { [Op.in]: ids } },
      attributes: ["id", "clientId", "firstName", "lastName", "status"],
      // Por nombre de pila: en la columna se leen los hermanos seguidos
      // («Hugo, Marta») y el apellido suele ser el mismo.
      order: [["firstName", "ASC"], ["lastName", "ASC"]],
      raw: true,
    });
    const mapa = new Map();
    for (const p of filas) {
      const clave = String(p.clientId);
      const nombre = [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
      if (!nombre) continue;
      if (!mapa.has(clave)) mapa.set(clave, []);
      mapa.get(clave).push({ id: p.id, nombre, estado: p.status });
    }
    // Los que siguen viniendo, primero. En la columna solo caben dos nombres, y
    // una familia con un hermano dado de alta y otro en tratamiento enseñaría al
    // que ya no viene solo por llamarse Ana.
    for (const lista of mapa.values()) {
      lista.sort((a, b) => (a.estado === "active" ? 0 : 1) - (b.estado === "active" ? 0 : 1));
    }
    return mapa;
  } catch (err) {
    const code = err?.parent?.code || err?.original?.code;
    if (code === "42P01") return new Map(); // tenant sin tabla de pacientes
    throw err;
  }
}
