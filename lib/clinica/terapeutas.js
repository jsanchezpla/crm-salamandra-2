/**
 * lib/clinica/terapeutas.js — quién lleva a cada paciente, y cuántos.
 *
 * (Fichero nuevo en `lib/`, regla #2: hasta hoy «el terapeuta del paciente» era
 * una columna que leían ocho sitios sueltos y no había ningún lugar donde
 * estuviera escrita la regla. Ahora que son varios, tenerla en uno solo es lo
 * único que impide que el listado, la ficha y el alta acaben diciendo cosas
 * distintas.)
 *
 * Lo pidió Lau (Aumenta, 14/08/2026): «en los pacientes que tienen dos terapias,
 * cómo meter a los 2 terapeutas». En producción ya hay 15 pacientes con citas
 * repartidas entre dos o tres profesionales.
 *
 * ── EL MODELO, EN TRES FRASES ───────────────────────────────────────────────
 *
 * 1. `patient_therapists` es la lista COMPLETA (el de referencia incluido).
 * 2. `patients.main_therapist_id` dice cuál de ellos es el de referencia.
 * 3. Si un paciente NO tiene filas en la tabla, manda la columna sola.
 *
 * La tercera es la que permite desplegar esto SIN tocar un solo dato: los 560
 * pacientes de Aumenta que hoy tienen terapeuta siguen enseñándolo, y su fila en
 * la tabla aparece la primera vez que alguien edite la ficha. No hay un estado
 * intermedio raro porque «lista vacía» y «columna vacía» significan lo mismo:
 * nadie.
 *
 * ── POR QUÉ NO HAY ASOCIACIÓN DE SEQUELIZE ─────────────────────────────────
 *
 * El repo ya tiene este patrón en `lib/clinica/incidencias.js`
 * (`sincronizarResponsables`), y allí sí hay `belongsToMany` y se usa
 * `setAssignees()`. Aquí NO, por dos motivos concretos:
 *
 * · `set()` borra y vuelve a crear TODAS las filas en cada guardado. Nuestra
 *   fila lleva datos propios —`specialty` y `assignedAt`—, así que guardar la
 *   ficha sin tocar terapeutas los borraría en silencio. Por eso el escritor de
 *   aquí abajo hace un DIFF: quita a los que se van, mete a los que llegan y no
 *   toca a los que siguen.
 * · Un include hacia una tabla con muchos a muchos en el listado paginado hace
 *   que `findAndCountAll` cuente filas del JOIN en vez de pacientes. La página 2
 *   saldría corta y nadie lo miraría. Se lee con una consulta agregada aparte,
 *   como ya se hace con las sesiones en `app/api/pacientes/route.js`.
 *
 * ── Y LO QUE ESTO NO ES ────────────────────────────────────────────────────
 *
 * **No es un permiso.** Que alguien no esté en la lista de un paciente no le
 * impide ver su ficha: `/api/pacientes` no tiene reglas de visibilidad, y esto
 * no las añade. Si algún día se quiere que las tenga, se escribe donde van esas
 * —con su prueba— y no aquí; el precedente entero, con el fallo que costó, está
 * en `lib/citas/visibilidad.js`.
 */

import { Op } from "sequelize";
import { SPECIALTY_KEYS } from "./specialties.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tope de terapeutas por paciente. No es una regla de negocio: es un freno para
 * que un cuerpo con diez mil ids no monte diez mil filas. El máximo real medido
 * en Aumenta es 3.
 */
export const MAX_TERAPEUTAS = 10;

/**
 * Lo que llega del formulario → lista limpia, sin repetidos y EN ORDEN.
 *
 * Acepta las dos formas: `therapists: [{ id, specialty }]` (la que manda la
 * ficha) y `therapistIds: [uuid]` (la corta). Devuelve `null` —que NO es lo
 * mismo que `[]`— cuando el cuerpo no habla de terapeutas: `[]` quiere decir
 * «quítalos todos» y `null` quiere decir «no me has preguntado».
 *
 * ⚠️ `mainTherapistId` NO entra aquí, y es a propósito. Traducirlo a una lista
 * de uno haría que cualquier cliente antiguo de la API —incluida la pantalla de
 * alta, que hoy manda ese campo— borrara al resto de terapeutas del paciente sin
 * pedirlo. Para eso está `referenciaDe`.
 */
export function terapeutasDe(body) {
  let crudos = null;
  if (Array.isArray(body?.therapists)) crudos = body.therapists;
  else if (Array.isArray(body?.therapistIds)) crudos = body.therapistIds;
  if (crudos === null) return null;

  const salida = [];
  const vistos = new Set();
  for (const bruto of crudos.slice(0, MAX_TERAPEUTAS * 4)) {
    const objeto = bruto && typeof bruto === "object" ? bruto : { id: bruto };
    const id = typeof objeto.id === "string" ? objeto.id.trim()
      : typeof objeto.teamMemberId === "string" ? objeto.teamMemberId.trim()
        : "";
    if (!UUID_RE.test(id) || vistos.has(id)) continue;
    vistos.add(id);
    // `specialty` ausente ≠ `specialty: null`. Ausente = «no me has dicho nada,
    // conserva lo que hubiera»; null explícito = «bórrala». Lo distingue el
    // escritor, y por eso aquí viaja `undefined` cuando no venía.
    const tieneEspecialidad = "specialty" in objeto;
    const especialidad = SPECIALTY_KEYS.includes(objeto.specialty) ? objeto.specialty : null;
    salida.push({ id, specialty: tieneEspecialidad ? especialidad : undefined });
    if (salida.length >= MAX_TERAPEUTAS) break;
  }
  return salida;
}

/**
 * El `mainTherapistId` de toda la vida, para los clientes de la API que solo
 * saben mandar uno.
 *
 * Devuelve `undefined` si no venía. Significa **«que esta persona sea la de
 * referencia»**, nunca «que sea la única»: se la sube al puesto 0 y se la añade
 * si faltaba, pero no se echa a nadie. Un `null` explícito solo vacía la lista
 * si no había más que esa persona; con dos terapeutas apuntados, borrar el de
 * referencia a ciegas sería tirar trabajo de otro.
 */
export function referenciaDe(body) {
  if (!body || !("mainTherapistId" in body)) return undefined;
  const bruto = body.mainTherapistId;
  if (bruto == null || bruto === "") return null;
  const id = String(bruto).trim();
  return UUID_RE.test(id) ? id : undefined;
}

/**
 * ¿Existe ya la tabla en el schema de este tenant?
 *
 * Hace falta porque el despliegue y la migración no son el mismo momento: entre
 * que sube la imagen nueva y alguien corre `migrate-patients-terapeutas.js`, todo
 * guardado de ficha daría 500 si diéramos la tabla por hecha. Y hay tenants con
 * el módulo activo y el schema a medias, que es el incidente del 21/07/2026 que
 * ya documenta `lib/clients/urgentes.js`.
 *
 * Se pregunta por la TABLA y no por el módulo, por lo mismo.
 *
 * ⚠️ **El nombre va CUALIFICADO con el schema, y no es un adorno.** El
 * `searchPath` que se le pasa a Sequelize (`lib/db/sequalize.js`) NO llega a las
 * consultas crudas: los modelos sí escriben `"crm_x"."tabla"` porque llevan el
 * schema dentro, pero un `sequelize.query()` sale con el `search_path` de la
 * conexión, que apunta a `public`. Preguntando sin cualificar, `to_regclass`
 * devolvía null SIEMPRE, la tabla parecía no existir en ningún tenant y todo se
 * caía al espejo en silencio: la lista no se guardaba, el filtro no encontraba
 * nada y `mainTherapistId` suelto sí borraba a los demás. Se vio probando el
 * ciclo entero en el navegador, no en las pruebas —los modelos de mentira
 * contestaban lo que se esperaba— el 25/08/2026.
 *
 * El sí se cachea para siempre; el no, solo un minuto, para que en cuanto la
 * migración pase la aplicación se entere sola sin reiniciar nada.
 */
const CACHE_TABLA = new WeakMap();
const NO_CADUCA_EN = 60_000;

export async function hayTablaTerapeutas(sequelize, ahora = Date.now()) {
  const guardado = CACHE_TABLA.get(sequelize);
  if (guardado?.hay === true) return true;
  if (guardado && ahora - guardado.cuando < NO_CADUCA_EN) return false;
  try {
    const esquema = sequelize?.options?.schema;
    const nombre = esquema ? `"${esquema}"."patient_therapists"` : "patient_therapists";
    const [filas] = await sequelize.query(`SELECT to_regclass('${nombre}') AS t`);
    const hay = Boolean(filas?.[0]?.t);
    CACHE_TABLA.set(sequelize, { hay, cuando: ahora });
    return hay;
  } catch {
    // Si ni siquiera se puede preguntar, se trata como que no está: la ficha
    // sigue funcionando con la columna de siempre.
    CACHE_TABLA.set(sequelize, { hay: false, cuando: ahora });
    return false;
  }
}

/** Solo para las pruebas: olvida lo que se sabía de esta conexión. */
export function olvidarTabla(sequelize) {
  CACHE_TABLA.delete(sequelize);
}

/**
 * Las filas de varios pacientes de una vez: DOS consultas planas para toda la
 * página, pase la que pase de pacientes.
 *
 * Devuelve un objeto por id de paciente, con el nombre de cada persona ya
 * puesto: sin él, cada pantalla tendría que cruzarlo por su cuenta contra la
 * lista del equipo, y la que se olvidara pintaría un UUID.
 *
 * Si la tabla no está todavía, devuelve `{}` y quien llame cae al espejo, que es
 * lo correcto.
 */
export async function listaDe(models, sequelize, patientIds) {
  const salida = {};
  if (!patientIds?.length) return salida;
  if (!(await hayTablaTerapeutas(sequelize))) return salida;

  const filas = await models.PatientTherapist.findAll({
    where: { patientId: { [Op.in]: patientIds } },
    attributes: ["patientId", "teamMemberId", "specialty", "assignedAt"],
    order: [["assignedAt", "ASC"], ["teamMemberId", "ASC"]],
    raw: true,
  });
  if (!filas.length) return salida;

  const gente = await models.TeamMember.findAll({
    where: { id: { [Op.in]: [...new Set(filas.map((f) => f.teamMemberId))] } },
    attributes: ["id", "displayName", "position", "avatarColor"],
    raw: true,
  });
  const porId = new Map(gente.map((g) => [g.id, g]));

  for (const f of filas) {
    const g = porId.get(f.teamMemberId);
    (salida[f.patientId] ||= []).push({
      ...f,
      displayName: g?.displayName ?? null,
      position: g?.position ?? null,
      avatarColor: g?.avatarColor ?? null,
    });
  }
  return salida;
}

/**
 * La lista que se ENSEÑA de un paciente, con la caída al espejo.
 *
 * Si tiene filas, esas, con el de referencia el primero. Si no tiene ninguna
 * pero la columna apunta a alguien, esa persona sola. Si no, nadie.
 *
 * El orden importa: la ficha pinta el primero como el de referencia, y el
 * autorrelleno del profesional al crear una cita coge ese mismo.
 */
export function terapeutasEfectivos(paciente, filas) {
  const j = paciente?.toJSON ? paciente.toJSON() : paciente;
  const referencia = j?.mainTherapistId ?? null;
  if (!filas?.length) {
    if (!referencia) return [];
    // El nombre sale del include `mainTherapist` si viene; si no, queda a null y
    // la pantalla lo cruza con su lista de equipo. Nunca se pinta un UUID.
    const m = j?.mainTherapist ?? null;
    return [{
      teamMemberId: referencia,
      specialty: null,
      assignedAt: null,
      displayName: m?.displayName ?? null,
      position: m?.position ?? null,
      avatarColor: m?.avatarColor ?? null,
    }];
  }
  const primero = filas.filter((f) => f.teamMemberId === referencia);
  const resto = filas.filter((f) => f.teamMemberId !== referencia);
  return [...primero, ...resto];
}

/**
 * Deja la lista de un paciente igual a `entradas` y pone al día el espejo.
 *
 * ── LO QUE HACE, Y POR QUÉ ASÍ ──────────────────────────────────────────────
 *
 * · **Diff, no arrasar.** Se borran solo los que sobran y se insertan solo los
 *   que faltan. A los que siguen no se les toca `assignedAt` (o «desde cuándo la
 *   lleva» sería siempre la hora del último guardado) ni se les pisa la
 *   `specialty` cuando el cuerpo no la trae.
 * · **Se descarta quien no exista** como ficha de equipo, igual que hace
 *   `sincronizarResponsables`: un id de otro tenant o de un formulario viejo no
 *   puede crear una fila colgando de nadie.
 * · **El espejo es el primero de la lista**, y `null` si la lista queda vacía.
 *   Ese es el invariante entero, y se escribe DENTRO de la misma transacción.
 *
 * @returns {{antes: string[], despues: string[], cambio: boolean}}
 */
export async function sincronizarTerapeutas({ models, sequelize, paciente, entradas, transaction = null }) {
  const { PatientTherapist, TeamMember } = models;
  const patientId = paciente.id;

  if (!(await hayTablaTerapeutas(sequelize))) {
    // Sin tabla, se hace lo que se hacía antes: guardar al de referencia y ya.
    const espejo = entradas?.[0]?.id ?? null;
    const antes = paciente.mainTherapistId ?? null;
    if (antes !== espejo) await paciente.update({ mainTherapistId: espejo }, { transaction });
    return { antes: antes ? [antes] : [], despues: espejo ? [espejo] : [], cambio: antes !== espejo };
  }

  const actuales = await PatientTherapist.findAll({
    where: { patientId },
    attributes: ["id", "teamMemberId", "specialty"],
    transaction,
    raw: true,
  });
  const porId = new Map(actuales.map((f) => [f.teamMemberId, f]));

  // Solo los que existen de verdad, respetando el orden en que llegaron.
  const pedidos = entradas ?? [];
  const vivos = pedidos.length
    ? new Set(
      (await TeamMember.findAll({
        where: { id: { [Op.in]: pedidos.map((e) => e.id) } },
        attributes: ["id"],
        transaction,
        raw: true,
      })).map((t) => t.id)
    )
    : new Set();
  const finales = pedidos.filter((e) => vivos.has(e.id));

  const quedan = new Set(finales.map((e) => e.id));
  const sobran = actuales.filter((f) => !quedan.has(f.teamMemberId));
  if (sobran.length) {
    await PatientTherapist.destroy({ where: { id: { [Op.in]: sobran.map((f) => f.id) } }, transaction });
  }

  for (const entrada of finales) {
    const yaEsta = porId.get(entrada.id);
    if (!yaEsta) {
      await PatientTherapist.create(
        { patientId, teamMemberId: entrada.id, specialty: entrada.specialty ?? null },
        { transaction }
      );
      continue;
    }
    // Ausente = conserva lo que hubiera. Solo un valor explícito la cambia.
    if (entrada.specialty !== undefined && entrada.specialty !== yaEsta.specialty) {
      await PatientTherapist.update({ specialty: entrada.specialty }, { where: { id: yaEsta.id }, transaction });
    }
  }

  const espejo = finales[0]?.id ?? null;
  if ((paciente.mainTherapistId ?? null) !== espejo) {
    await paciente.update({ mainTherapistId: espejo }, { transaction });
  }

  const antes = actuales.map((f) => f.teamMemberId);
  const despues = finales.map((e) => e.id);
  return {
    antes,
    despues,
    cambio: antes.length !== despues.length || antes.some((id) => !quedan.has(id)),
  };
}

/**
 * Aplica un `mainTherapistId` suelto sobre la lista que ya hay, SIN echar a
 * nadie: sube a esa persona al puesto 0, y la añade si faltaba.
 *
 * Es la traducción del campo viejo, y la razón de que exista está medida: la
 * pantalla de alta manda hoy `mainTherapistId`, así que tratarlo como «la lista
 * entera» habría borrado al segundo terapeuta de un paciente cada vez que
 * alguien guardara desde una pantalla sin actualizar.
 */
export function conReferencia(lista, referencia) {
  if (referencia === undefined) return lista;
  if (referencia === null) {
    // Solo vacía si no había nadie más: quitar al de referencia teniendo otros
    // apuntados sería tirar el trabajo de otra persona sin haberlo pedido.
    return lista.length <= 1 ? [] : lista;
  }
  const resto = lista.filter((e) => e.id !== referencia);
  const previa = lista.find((e) => e.id === referencia);
  return [{ id: referencia, specialty: previa?.specialty }, ...resto].slice(0, MAX_TERAPEUTAS);
}

/**
 * Los pacientes que lleva una persona, para el filtro del listado.
 *
 * Devuelve `null` si la tabla no está: quien llame se queda con el filtro de
 * siempre contra la columna, que es exactamente lo que hacía ayer.
 */
export async function pacientesDe(models, sequelize, teamMemberId) {
  if (!(await hayTablaTerapeutas(sequelize))) return null;
  const filas = await models.PatientTherapist.findAll({
    where: { teamMemberId },
    attributes: ["patientId"],
    raw: true,
  });
  return filas.map((f) => f.patientId);
}
