/**
 * buscarPorPaciente — encontrar a la FAMILIA escribiendo el nombre del NIÑO
 * (31/08/2026, Rodrigo: «en todos los buscadores donde busque a un cliente
 * también tengo que poder buscar un paciente»).
 *
 * En Aumenta el cliente es la familia pagadora y quien está delante es el
 * paciente: Rosa conoce a «Hugo», no a «Familia Castro Díaz». Buscar solo por
 * el nombre de la ficha obligaba a saberse el apellido del pagador.
 *
 * La consulta, compartida por `/api/clients` (el buscador general) y
 * `/api/billing/fichas` (el de facturación). Solo SERVIDOR: importa Sequelize.
 * La etiqueta del desplegable («paciente: X») vive en `buscarFichas.js`, que
 * es el fichero que el navegador sí puede cargar.
 */
import { filtroPorNombre } from "../utils/busquedaDb.js";

/**
 * Pacientes cuyo nombre casa con el texto. Devuelve [{ clientId, nombre }],
 * solo de pacientes CON familia (un paciente suelto no se puede cobrar).
 * Sin módulo de pacientes (Patient null) o sin texto → lista vacía.
 */
export async function pacientesQueCasan(Patient, texto, limite = 40) {
  if (!Patient || !texto) return [];
  const filtro = await filtroPorNombre(Patient.sequelize, texto, [
    "Patient.first_name", "Patient.last_name",
  ]);
  if (!filtro) return [];
  const filas = await Patient.findAll({
    where: filtro,
    attributes: ["id", "clientId", "firstName", "lastName"],
    limit: limite,
  });
  return filas
    .filter((p) => p.clientId)
    .map((p) => ({
      clientId: p.clientId,
      nombre: [p.firstName, p.lastName].filter(Boolean).join(" ").trim(),
    }));
}
