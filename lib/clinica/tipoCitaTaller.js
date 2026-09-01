/**
 * lib/clinica/tipoCitaTaller.js — un grupo de taller ES un tipo de cita
 * (01/09/2026, Aumenta por Rodrigo).
 *
 * (Fichero nuevo en /lib, regla #2: lo necesitan CUATRO sitios que no se
 * hablan —el alta de un grupo, su edición, su retirada y el backfill que puso
 * al día los que ya existían—, y todos tienen que producir exactamente el mismo
 * tipo de cita. Copiado en los cuatro, el primero que alguien toque deja
 * grupos con tipos distintos y la agenda deja de casar con la pestaña.)
 *
 * ── EL ENCARGO ──────────────────────────────────────────────────────────────
 * «Hay que preparar los talleres de tal forma que en las citas se pueda
 * seleccionar los talleres que hay ahora mismo en Aumenta. No como bloqueos
 * sino como un tipo más de cita. **Solo que estos tipos de cita se crean desde
 * la pestaña de talleres.**»
 *
 * O sea: en el desplegable de «tipo de cita» tiene que salir «Habilidades
 * sociales · Grupo 1» al lado de «Sesión», y elegirlo tiene que bastar. Pero
 * ese tipo no se da de alta en el catálogo de tipos de cita: nace, se renombra
 * y se retira **con su grupo**, desde Talleres.
 *
 * ── POR QUÉ UN EventType DE VERDAD Y NO UN TIPO FALSO ───────────────────────
 * Porque `bookings.event_type_id` es NOT NULL y de él cuelga media agenda: el
 * color de la caja, el filtro por tipo, el informe de ocupación, la duración
 * que se copia al crear la cita. Inventarse un tipo «virtual» que solo entiende
 * la pantalla de talleres obligaría a poner un `if` en cada uno de esos sitios
 * —y a acordarse de todos—. Con un tipo real, el taller entra por la puerta que
 * ya existe y no hay que enseñarle nada a nadie.
 *
 * ── SIEMPRE OCULTO ──────────────────────────────────────────────────────────
 * `isHidden: true` y sin precio. A un taller se entra apuntándose en su grupo,
 * no reservando hora desde la web, y un tipo visible aparecería en el widget
 * público para que cualquiera pidiera plaza. `isHidden` es justo la marca que
 * ya usa `lib/citas/tiposVisibles.js` para eso, así que no hace falta nada
 * nuevo: el listado público lo filtra y `/book` vuelve a comprobarlo.
 *
 * ── QUÉ PASA CUANDO SE RETIRA UN GRUPO ──────────────────────────────────────
 * Su tipo de cita se desactiva, NO se borra: las citas que ya se dieron siguen
 * apuntando a él y borrarlo dejaría el histórico sin nombre. Es la misma regla
 * que la de retirar un taller.
 */

import { slugify } from "../citas/validation.js";

/** 42P01 = la tabla no existe en este schema (tenant sin módulo Citas). */
const tablaAusente = (err) => err?.parent?.code === "42P01" || err?.original?.code === "42P01";

const MAX_NOMBRE = 255;

/**
 * Cómo se lee el grupo en el desplegable de tipos de cita y en la caja de la
 * agenda: «Habilidades sociales · Grupo 1».
 *
 * Lleva el nombre de la ACTIVIDAD delante a propósito: en la lista de tipos de
 * cita, un «Grupo 1» suelto no dice de qué, y en Aumenta va a haber varios
 * grupos de varias actividades.
 */
export function rotuloDeGrupo(taller, grupo) {
  const actividad = String(taller?.name ?? "").trim();
  const suyo = String(grupo?.name ?? "").trim();
  if (!actividad) return suyo || "Taller";
  if (!suyo) return actividad;
  return `${actividad} · ${suyo}`.slice(0, MAX_NOMBRE);
}

/**
 * El slug base del tipo de cita de un grupo. Lleva el prefijo `taller-` para
 * que no choque con un tipo de cita normal que se llame igual — pasa: un centro
 * puede tener el tipo «Habilidades sociales» de las sesiones individuales.
 */
export function slugBaseDeGrupo(taller, grupo) {
  const base = slugify(`taller ${rotuloDeGrupo(taller, grupo)}`);
  /*
   * `base === "taller"` significa que del nombre no se salvó ni una letra
   * —«···», o un nombre entero en signos—. No es teórico: `slugify` quita todo
   * lo que no sea `[a-z0-9-]`. Devolverlo tal cual dejaría a TODOS esos grupos
   * peleando por el mismo slug, así que se les pega su id.
   */
  if (!base || base === "taller") {
    return `taller-${String(grupo?.id ?? "grupo").replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() || "grupo"}`;
  }
  return base;
}

/**
 * Un slug libre a partir del base. `slug` es UNIQUE en `event_types`, y dos
 * grupos pueden acabar con el mismo nombre normalizado («Grupo 1» de dos
 * talleres que se llaman casi igual): en vez de fallar, se numera.
 *
 * @param excluirId  el tipo que estamos editando (su propio slug no choca).
 */
export async function slugLibre(EventType, base, excluirId = null) {
  const { Op } = await import("sequelize");
  for (let i = 0; i < 50; i += 1) {
    const candidato = i === 0 ? base : `${base}-${i + 1}`;
    const where = { slug: candidato };
    if (excluirId) where.id = { [Op.ne]: excluirId };
    const choca = await EventType.findOne({ where, attributes: ["id"] });
    if (!choca) return candidato;
  }
  // 50 grupos con el mismo nombre normalizado no pasa; si pasara, un slug con
  // el id dentro sigue siendo válido y único.
  return `${base}-${String(Date.now()).slice(-6)}`;
}

/**
 * Crea (o pone al día) el tipo de cita de un grupo y devuelve la fila.
 *
 * Es idempotente y se puede llamar en cada guardado: si el grupo ya tiene su
 * tipo, se le refrescan nombre, duración, color y estado; si no, se crea.
 *
 * Devuelve `null` —sin reventar— cuando el centro no tiene el módulo Citas o su
 * schema aún no tiene `event_types`: un centro solo con Clínica sigue pudiendo
 * organizar sus talleres, solo que sin agenda donde apuntarlos.
 */
export async function asegurarTipoDeCitaDeGrupo({ tenantModels, taller, grupo }) {
  const { EventType } = tenantModels;
  if (!EventType || !grupo?.id) return null;

  const name = rotuloDeGrupo(taller, grupo);
  const activo = grupo.active !== false && taller?.active !== false;

  try {
    const existente = await EventType.findOne({ where: { tallerGrupoId: grupo.id } });

    if (existente) {
      await existente.update({
        name,
        duration: grupo.duration || existente.duration,
        color: grupo.color ?? existente.color,
        // Retirar el grupo apaga su tipo de cita; reactivarlo lo vuelve a
        // encender. El slug NO se toca: es la identidad y puede estar escrito
        // en un enlace.
        active: activo,
        isHidden: true,
      });
      return existente;
    }

    return await EventType.create({
      name,
      slug: await slugLibre(EventType, slugBaseDeGrupo(taller, grupo)),
      description: `Taller de grupo. Se gestiona desde Clínica → Talleres.`,
      duration: grupo.duration || 90,
      color: grupo.color ?? null,
      // Un taller se da en la sala del centro. Nada de online por defecto: si
      // alguno se da por videollamada, se cambia en el tipo de cita.
      modalities: ["presencial"],
      // Sin antelación mínima ni tope: la cita del taller la apunta el centro,
      // no la pide una familia, y a menudo se apunta el mismo día.
      minNoticeHours: 0,
      maxAdvanceDays: 365,
      isHidden: true,
      active: activo,
      tallerGrupoId: grupo.id,
    });
  } catch (err) {
    if (tablaAusente(err)) return null;
    throw err;
  }
}

/**
 * El tipo de cita de un grupo, si lo tiene. Sin crearlo: lo usan las pantallas
 * que solo quieren enseñarlo.
 */
export async function tipoDeCitaDeGrupo({ tenantModels, grupoId }) {
  const { EventType } = tenantModels;
  if (!EventType || !grupoId) return null;
  try {
    return await EventType.findOne({ where: { tallerGrupoId: grupoId } });
  } catch (err) {
    if (tablaAusente(err)) return null;
    throw err;
  }
}
