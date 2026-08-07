/**
 * lib/clients/consultaExterna.js — «Consultas externas» (07/08/2026, Rodrigo).
 *
 * (Fichero nuevo en /lib, regla #2: la regla de quién ve a estos pacientes la
 * necesitan el listado, la ficha, el buscador y la agenda. Copiada en cuatro
 * sitios, el día que cambie se quedará vieja en tres — y el que se quede viejo
 * es el que enseña de más.)
 *
 * ── QUÉ ES UNA CONSULTA EXTERNA ─────────────────────────────────────────────
 * Un paciente que Laura atiende por un acuerdo con una empresa, no por su
 * consulta. Quiere guardar su historia clínica y sus documentos en el mismo
 * sitio que el resto —para no llevar dos archivos— pero ESE paciente no es de
 * la consulta:
 *
 *   · NO se le crea cuenta en la web (ni portal, ni documentos compartidos);
 *   · solo recibe los avisos automáticos si se le ha puesto teléfono o correo;
 *   · lleva la EMPRESA a la que pertenece, para poder agruparlos.
 *
 * ── QUIÉN LOS VE (decisión de Rodrigo, 07/08/2026) ──────────────────────────
 * Admin, y la profesional que lo tenga asignado. Nadie más.
 *
 * Se eligió esta y no «ocultos para todo el mundo menos admin» por una razón
 * concreta: si mañana una nutricionista atiende a uno de estos, tiene que poder
 * abrir su ficha. Ocultárselo a quien lo está tratando no protege nada y
 * convierte el CRM en un sitio donde falta gente sin explicación.
 */

import { Op } from "sequelize";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/** ¿Manda este rol sobre todas las consultas externas? */
export function veTodasLasExternas(role) {
  return ADMIN_ROLES.has(role);
}

/**
 * El trozo de `where` que deja fuera las consultas externas ajenas.
 *
 * Devuelve `null` cuando no hay nada que filtrar (admin), para que quien llama
 * no tenga que mezclar un objeto vacío en su consulta.
 *
 * @param role         rol de quien mira
 * @param teamMemberId su TeamMember, o null si no tiene ficha de equipo
 */
export function filtroDeVisibilidad(role, teamMemberId) {
  if (veTodasLasExternas(role)) return null;

  /*
   * `esConsultaExterna` es `false` en todo lo que ya existe y en todo lo que se
   * crea sin marcar, pero se comprueba también `IS NULL`: un schema recién
   * migrado tiene la columna a NULL hasta que alguien guarde la ficha, y con
   * solo `= false` esos pacientes desaparecerían para el equipo de golpe.
   */
  const noEsExterna = {
    [Op.or]: [{ esConsultaExterna: false }, { esConsultaExterna: null }],
  };

  if (!teamMemberId) return noEsExterna;

  return {
    [Op.or]: [
      { esConsultaExterna: false },
      { esConsultaExterna: null },
      { esConsultaExterna: true, assignedTeamMemberId: teamMemberId },
    ],
  };
}

/**
 * ¿Puede esta persona abrir ESTA ficha? La comprobación de una en una, para el
 * detalle: el filtro del listado no vale ahí porque se pide por id.
 *
 * Se responde con un booleano y quien llama decide si devuelve 404 o 403. En
 * las rutas se devuelve 404: decir «existe pero no es para ti» ya es contar
 * algo de un paciente que no le corresponde.
 */
export function puedeVerFicha(client, role, teamMemberId) {
  if (!client?.esConsultaExterna) return true;
  if (veTodasLasExternas(role)) return true;
  return Boolean(teamMemberId) && String(client.assignedTeamMemberId ?? "") === String(teamMemberId);
}

/**
 * ¿Se le crea cuenta en la web a este paciente?
 *
 * Una consulta externa NO tiene portal: ni cuenta, ni documentos compartidos,
 * ni contratos que firmar. Es la razón de ser de la marca — Laura guarda su
 * historia aquí, pero el paciente es de la empresa, no de la consulta.
 */
export function llevaCuentaEnLaWeb(client) {
  return !client?.esConsultaExterna;
}

/**
 * Las categorías que tiene configuradas este cliente (las empresas con las que
 * hay acuerdo). Viven en los ajustes del tenant, editables desde Configuración.
 *
 * Siempre devuelve un array de textos limpios y sin repetidos: es lo que pinta
 * el desplegable, y un `null` ahí dentro rompe la pantalla.
 */
export function categoriasDe(tenant) {
  const brutas = tenant?.settings?.clientes?.categoriasExternas;
  if (!Array.isArray(brutas)) return [];
  const vistas = new Set();
  const out = [];
  for (const c of brutas) {
    const t = String(c ?? "").trim().slice(0, 80);
    if (!t) continue;
    const clave = t.toLocaleLowerCase("es");
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    out.push(t);
  }
  return out;
}

/**
 * Normaliza la categoría que llega del formulario.
 *
 * Se acepta CUALQUIER texto, no solo los de la lista: si alguien quita una
 * empresa de Configuración, los pacientes que ya la tenían no deben perder el
 * dato ni bloquear el guardado de su ficha. La lista es una ayuda para teclear,
 * no una jaula.
 */
export function normalizarCategoria(valor) {
  const t = String(valor ?? "").trim().slice(0, 80);
  return t || null;
}
