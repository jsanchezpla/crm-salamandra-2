import { Op, fn, col } from "sequelize";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, created, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { logCitasAudit } from "../../../../lib/citas/audit.js";
import { buildMadridDate } from "../../../../lib/citas/slots.js";
import { colorDeBloqueo } from "../../../../lib/citas/coloresBloqueo.js";
import { categoriaDe, categoriasDe, claveValida } from "../../../../lib/citas/categoriasBloqueo.js";
// `lib/citas/visibilidad.js` ya no se usa aquí: desde el 14/08/2026 los bloqueos
// los ve todo el equipo y no siguen la regla de las citas (ver cabecera del GET).
import { resolveCurrentTeamMemberId } from "../../../../lib/team/currentTeamMember.js";
import { idsDeAdministracion } from "../../../../lib/team/departamentos.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * /api/citas/bloqueos — «Vacaciones» (06/08/2026, Rodrigo).
 *
 *   GET    ?from=ISO&to=ISO    listar (las suyas y las del centro; ver abajo)
 *   POST   { teamMemberId, startAt, endAt, label, notes }   crear
 *   DELETE ?id=UUID            quitarlo
 *
 * Rodrigo lo pidió como «un tipo de cita especial sin paciente, con fecha y
 * hora de inicio y fin, asignado a un miembro del equipo». Por dentro NO es una
 * cita —el porqué está en `models/tenant/TeamBlock.model.js`— pero en la
 * pantalla se crea igual: se elige a quién, desde cuándo y hasta cuándo.
 *
 * `teamMemberId` a null = no está NADIE, o sea un cierre del centro con hora.
 *
 * ── QUIÉN PUEDE QUÉ (10/08/2026, tras el aviso de nutri_laura) ──────────────
 * Ponerlo lo puede CUALQUIERA del equipo desde el 07/08 —quien se va de
 * vacaciones tiene que poder apuntarlo—, pero hasta hoy podía apuntarlo A
 * NOMBRE DE CUALQUIERA, incluido «todo el centro». En la consulta de Laura eso
 * pasó SEIS veces: Rocío apuntaba sus ausencias, se quedaba el desplegable en
 * «Todo el centro» y cerraba también la agenda de Laura. Nadie se enteraba,
 * porque el resultado —un hueco que no se ofrece— es exactamente el mismo.
 *
 *   · quien NO es admin solo puede poner y quitar LAS SUYAS. El `teamMemberId`
 *     se resuelve AQUÍ a partir de la sesión; lo que mande el navegador da
 *     igual. Cerrar el centro entero sigue siendo cosa de dirección.
 *   · admin puede todo, incluido el cierre de centro.
 *
 * ── QUIÉN VE QUÉ: TODOS, LAS DE TODOS (14/08/2026, Rodrigo) ─────────────────
 * Aquí no se recorta nada. Poner un bloqueo sigue siendo cosa de cada cual
 * (arriba), pero VERLOS es de todo el equipo.
 *
 * Antes esto seguía la regla de las citas (`lib/citas/visibilidad.js`): sin
 * agenda compartida, cada cual veía las suyas y las del centro. Sonaba bien y
 * duró cuatro días, porque choca con para qué sirve un bloqueo. Una cita es de
 * quien la pasa; un bloqueo es justo lo contrario, es la señal de que ESA
 * persona no está — y a quien le sirve saberlo es a los demás, que son los que
 * tienen que cubrirla o decidir a quién le dan la hora.
 *
 * En nutri_laura acabó en lo absurdo: las ocho ausencias eran de Rocío, así que
 * Laura —que es dirección y la única otra profesional— abría el calendario y no
 * veía ninguna, mientras esta misma pantalla se las listaba todas.
 *
 * Y no es la misma decisión de privacidad: la agenda compartida existe porque
 * el listado de citas enseña nombre, email y teléfono del PACIENTE. Un bloqueo
 * no tiene paciente. Lo que se enseña es que una compañera está de vacaciones el
 * martes, que es información del centro y no de nadie.
 *
 * ⚠️ Esto es SOLO lo que se ve. El cálculo de huecos (`lib/citas/ausencias.js`)
 * lee la tabla por su cuenta y sin filtrar, así que esto no abre ni cierra
 * ningún hueco: lo que la paciente puede reservar no cambia.
 *
 * Crear un bloqueo NO cancela las citas que ya hubiera dentro: eso lo decide el
 * centro (avisar, reubicar, cobrar o no), igual que con los festivos. La
 * respuesta dice cuántas hay para que la pantalla pueda avisar.
 */

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const HORA_RE = /^(\d{1,2}):(\d{2})$/;

/**
 * "2026-08-17" + "07:00" → el instante en que en MADRID son las 7 de la mañana.
 *
 * `respaldo` es un ISO completo, para no romper a quien llame al endpoint a la
 * vieja usanza (o a una pestaña abierta desde antes de este arreglo). Ahí sí se
 * respeta la zona que traiga la cadena, porque un ISO con zona no es ambiguo.
 */
function instanteDeMadrid(fecha, hora, respaldo) {
  if (FECHA_RE.test(String(fecha ?? "")) && HORA_RE.test(String(hora ?? ""))) {
    const [y, m, d] = String(fecha).split("-").map(Number);
    const [hh, mm] = HORA_RE.exec(String(hora)).slice(1).map(Number);
    if (hh > 23 || mm > 59) return null;
    return buildMadridDate(y, m, d, hh, mm);
  }
  if (respaldo) {
    const t = new Date(respaldo);
    return Number.isNaN(t.getTime()) ? null : t;
  }
  return null;
}

function gate(ctx) {
  if (!ctx.hasModule("citas")) return forbidden("Módulo citas no activo");
  return null;
}

/**
 * Quién hace la petición: si manda (admin) y qué ficha de equipo tiene.
 *
 * El rol se lee de `x-user-role`, que `withTenant` reescribe con el rol REAL de
 * la base antes de llamar aquí (arreglo del 28/07): degradar a alguien surte
 * efecto al instante, no cuando le caduque el JWT.
 */
async function quienSoy(request, ctx) {
  const esAdmin = ADMIN_ROLES.has(request.headers.get("x-user-role"));
  const teamMemberId = await resolveCurrentTeamMemberId(request, ctx.tenantModels);
  // Viaja al navegador para que la tabla sepa a cuáles ponerle los botones de
  // editar y quitar. La API manda igual: esto es solo no enseñar una puerta
  // cerrada. `agendaCompartida` estaba aquí para el filtro del calendario y se
  // ha ido con él (14/08/2026).
  return { esAdmin, teamMemberId };
}

/**
 * Nombre de quien APUNTÓ cada ausencia, no de quién es.
 *
 * `createdById` es el id del usuario (schema master) y el nombre vive en la
 * ficha de equipo, así que se cruza por `TeamMember.userId`. Se hace con UNA
 * consulta para toda la lista en vez de un include: no hay asociación declarada
 * entre las dos cosas y no merece la pena crearla para un rótulo.
 *
 * Quien no tenga ficha de equipo —un admin que no da consulta— sale sin nombre,
 * y la pantalla simplemente no lo enseña.
 */
async function nombresDeQuienApunto(filas, tenantModels) {
  const ids = [...new Set(filas.map((f) => f.createdById).filter(Boolean))];
  if (!ids.length || !tenantModels?.TeamMember) return new Map();
  try {
    const fichas = await tenantModels.TeamMember.findAll({
      where: { userId: { [Op.in]: ids } },
      attributes: ["userId", "displayName"],
    });
    return new Map(fichas.map((t) => [t.userId, t.displayName]));
  } catch {
    return new Map(); // un rótulo no puede tumbar el listado
  }
}

/**
 * El id de taller que se guarda en un bloqueo: el que venga si el centro lo
 * tiene dado de alta, o `null`. Vaciarlo es como se le quita el taller a un
 * bloqueo que lo tenía.
 */
async function tallerValido(valor, tenantModels) {
  const id = typeof valor === "string" ? valor.trim() : "";
  if (!id || !UUID_RE.test(id)) return null;
  const { Taller } = tenantModels ?? {};
  if (!Taller) return null;
  try {
    const t = await Taller.findByPk(id, { attributes: ["id"] });
    return t ? id : null;
  } catch {
    return null;
  }
}

/**
 * Los talleres ACTIVOS del centro: `Map id → { id, name }` (01/09/2026).
 *
 * Sirve para dos cosas a la vez: poner el nombre a los bloqueos que son un
 * taller y llenar el desplegable de «¿este bloqueo es un taller?». Se hace con
 * UNA consulta para toda la lista, y no con un include, porque `team_blocks` no
 * tiene asociación declarada con `talleres` a propósito: la FK es suave para
 * que dar de baja un taller no borre horas de la agenda.
 *
 * Un centro sin el módulo Clínica no tiene la tabla: devuelve `null` y todo lo
 * demás sigue igual (los bloqueos son de Citas, los talleres son de Clínica).
 */
async function talleresDelCentro(tenantModels) {
  const { Taller } = tenantModels ?? {};
  if (!Taller) return null;
  try {
    const filas = await Taller.findAll({
      where: { active: true },
      attributes: ["id", "name"],
      order: [["name", "ASC"]],
      raw: true,
    });
    return new Map(filas.map((t) => [t.id, { id: t.id, name: t.name }]));
  } catch {
    return null; // un desplegable no puede tumbar la agenda
  }
}

/**
 * El EQUIPO del centro para el desplegable de «¿quién tiene que leer esto?»
 * (01/09/2026): `{ equipo: [{ id, displayName }], administracion: [id] }` de la
 * gente en activo.
 *
 * Viaja con el listado por lo mismo que las categorías y los talleres: quien
 * abre un bloqueo puede colgarle un documento y elegir a sus lectores, y sacar
 * la lista de aquí ahorra otra llamada en cada carga del calendario. Un centro
 * sin `team_members` devuelve `[]` y el modal simplemente no enseña el
 * desplegable.
 */
async function equipoDelCentro(tenantModels) {
  const { TeamMember } = tenantModels ?? {};
  if (!TeamMember) return { equipo: [], administracion: [] };
  try {
    const filas = await TeamMember.findAll({
      where: { status: { [Op.in]: ["active", "on_leave"] } },
      // `department` se lee pero NO se manda: solo sirve para calcular aquí
      // quién es administración (`lib/team/departamentos.js`).
      attributes: ["id", "displayName", "department"],
      order: [["displayName", "ASC"]],
      raw: true,
    });
    return {
      equipo: filas.map((f) => ({ id: f.id, displayName: f.displayName })),
      administracion: idsDeAdministracion(filas),
    };
  } catch {
    return { equipo: [], administracion: [] }; // un desplegable no puede tumbar la agenda
  }
}

/**
 * Cuántos documentos cuelga cada bloqueo: `Map id → n` (01/09/2026).
 *
 * Es lo que le pone el clip a un bloqueo en el calendario, para que se vea que
 * hay algo dentro SIN abrirlo. Una sola consulta agrupada para toda la lista;
 * si falla, todos salen a cero y la agenda se pinta igual.
 */
async function documentosPorBloqueo(tenantModels, ids) {
  const { Document } = tenantModels ?? {};
  if (!Document || !ids.length) return new Map();
  try {
    const filas = await Document.findAll({
      attributes: ["teamBlockId", [fn("COUNT", col("id")), "n"]],
      where: { teamBlockId: { [Op.in]: ids } },
      group: ["teamBlockId"],
      raw: true,
    });
    return new Map(filas.map((f) => [f.teamBlockId, Number(f.n || 0)]));
  } catch {
    return new Map();
  }
}

/**
 * `colorGeneral` es el del centro. El color viaja YA RESUELTO (categoría →
 * persona → centro → negro de siempre) para que la agenda solo tenga que
 * pintarlo: la regla de quién gana vive en un sitio, no repartida por cada
 * pantalla.
 *
 * `categoryLabel` viaja al lado de la clave por la misma razón: la agenda
 * escribe el rótulo sin tener que cruzar nada. Una categoría BORRADA se
 * comporta como si el bloqueo no tuviera: sin rótulo y con el color de siempre
 * (ver `lib/citas/categoriasBloqueo.js`).
 */
function serializa(f, colorGeneral, autores, categorias = [], talleres = null, documentos = null) {
  const cat = categoriaDe(f.categoryKey, categorias);
  return {
    id: f.id,
    teamMemberId: f.teamMemberId ?? null,
    teamMemberName: f.teamMember?.displayName ?? null,
    // Quién lo APUNTÓ. Lo pinta solo la tabla de Vacaciones; la agenda no lo
    // usa (Jorge, 10/08: en el calendario no tiene por qué salir).
    createdByName: autores?.get(f.createdById) ?? null,
    startAt: f.startAt,
    endAt: f.endAt,
    label: f.label,
    notes: f.notes ?? null,
    // La clave se devuelve SIEMPRE tal como está guardada, aunque su categoría
    // ya no exista: así el desplegable de la pantalla no la borra sin querer al
    // guardar otra cosa del mismo bloqueo.
    categoryKey: f.categoryKey ?? null,
    categoryLabel: cat?.label ?? null,
    // El taller que se da en este tramo (01/09/2026), si lo hay. Con nombre,
    // para que la agenda lo escriba sin cruzar nada; un taller dado de baja
    // llega sin nombre y el bloqueo se lee como uno cualquiera.
    tallerId: f.tallerId ?? null,
    tallerName: talleres?.get(f.tallerId)?.name ?? null,
    // Cuántos documentos cuelgan del tramo (01/09/2026). La agenda le pone un
    // clip al bloqueo que tiene alguno: se ve que hay algo dentro sin abrirlo.
    documentos: documentos?.get(f.id) ?? 0,
    color: colorDeBloqueo({
      categoria: cat?.color ?? null,
      persona: f.teamMember?.blockColor,
      centro: colorGeneral,
    }),
  };
}

export const GET = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;
    const { TeamBlock, TeamMember } = ctx.tenantModels;
    const yo = await quienSoy(request, ctx);
    if (!TeamBlock) return ok({ bloqueos: [], yo });

    const sp = new URL(request.url).searchParams;
    const from = sp.get("from");
    const to = sp.get("to");
    const where = {};
    if (from && to && !Number.isNaN(Date.parse(from)) && !Number.isNaN(Date.parse(to))) {
      // Los que PISAN el rango, no los que caben dentro: unas vacaciones de tres
      // semanas tienen que salir aunque el rango pedido sea de un solo día.
      where.startAt = { [Op.lt]: new Date(to) };
      where.endAt = { [Op.gt]: new Date(from) };
    }

    // Sin recorte por persona: ver la cabecera. Lo único que acota es el rango
    // de fechas que pida quien llama.
    const filas = await TeamBlock.findAll({
      where,
      include: TeamMember ? [{ model: TeamMember, as: "teamMember", attributes: ["id", "displayName", "blockColor"], required: false }] : [],
      order: [["startAt", "ASC"]],
      limit: 500,
    });
    const colorGeneral = ctx.tenant?.settings?.citas?.colorBloqueos ?? null;
    const categorias = categoriasDe(ctx.tenant);
    const autores = await nombresDeQuienApunto(filas, ctx.tenantModels);
    const talleres = await talleresDelCentro(ctx.tenantModels);
    const documentos = await documentosPorBloqueo(ctx.tenantModels, filas.map((f) => f.id));
    // Las categorías, los talleres y el equipo del centro viajan con el listado
    // (01/09/2026): quien pinta la agenda o el formulario necesita esas listas
    // para sus desplegables, y sacarlas de aquí ahorra otras tantas llamadas
    // en cada carga del calendario.
    const { equipo, administracion } = await equipoDelCentro(ctx.tenantModels);
    return ok({
      bloqueos: filas.map((f) => serializa(f, colorGeneral, autores, categorias, talleres, documentos)),
      yo,
      categorias,
      talleres: [...(talleres?.values() ?? [])],
      equipo,
      // Para el botón «Todos menos Administración» del selector de lectores.
      administracion,
    });
  } catch (err) {
    return serverError(err);
  }
});

export const POST = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;
    /*
     * Lo bloquea CUALQUIERA del equipo (07/08/2026, Rodrigo). Nació en admin
     * pensando que era cosa de dirección; en una consulta de dos personas eso
     * significa que quien se va de vacaciones tiene que pedirle a otra que lo
     * apunte, y entonces no se apunta.
     *
     * Pero SOLO LAS SUYAS si no es admin (10/08/2026): ver la cabecera. Cada
     * bloqueo queda además en la auditoría con su autor — que es la respuesta
     * cuando alguien pregunte por qué su agenda apareció cerrada un martes.
     */
    const { TeamBlock, TeamMember, Booking } = ctx.tenantModels;
    if (!TeamBlock) return error("Los bloqueos no están disponibles en este cliente", 503);
    const yo = await quienSoy(request, ctx);

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    /*
     * ⚠️ LA HORA VIENE PARTIDA (fecha + hora), NO COMO UN INSTANTE. Corrige el
     * fallo del 07/08/2026 que reportó Rodrigo: metía «de 7 a 9» y salía «de 9
     * a 11».
     *
     * La pantalla mandaba "2026-08-17T07:00:00", sin zona. `new Date()` de una
     * cadena así la interpreta en la hora LOCAL DE QUIEN LA LEE, y el
     * contenedor de producción va en UTC: las 7 se guardaban como las 7 UTC, o
     * sea las 9 de Madrid. En local no se veía porque mi reloj ya es de Madrid
     * — el fallo solo aparecía en el servidor.
     *
     * Con `buildMadridDate` la hora que se teclea es la hora de Madrid siempre,
     * la lea quien la lea y esté el servidor donde esté; y resuelve solo el
     * cambio de hora (+02:00 en verano, +01:00 en invierno).
     */
    const startAt = instanteDeMadrid(body.startDate, body.startTime, body.startAt);
    const endAt = instanteDeMadrid(body.endDate, body.endTime, body.endAt);
    if (!startAt) return error("La fecha u hora de inicio no es válida", 422);
    if (!endAt) return error("La fecha u hora de fin no es válida", 422);
    if (endAt <= startAt) return error("La fecha de fin tiene que ser posterior a la de inicio", 422);

    /*
     * De quién es la ausencia.
     *
     * Si NO es admin, no se mira el cuerpo de la petición: es SIEMPRE suya. Da
     * igual lo que mande el navegador —una pestaña vieja, un desplegable que no
     * se tocó, alguien curioseando con las herramientas del navegador—; el
     * servidor no acepta que un no-admin cierre la agenda de otra persona ni la
     * del centro entero.
     */
    let teamMemberId = null;
    // Su color se lee de la misma consulta que ya validaba a la persona, para
    // que la respuesta lleve el color definitivo y la agenda no parpadee.
    let colorPersona = null;

    if (!yo.esAdmin) {
      if (!yo.teamMemberId) {
        return forbidden(
          "Tu usuario no está enlazado con una ficha de equipo, así que no se sabe de quién sería la ausencia. Pídeselo a un administrador."
        );
      }
      teamMemberId = yo.teamMemberId;
      if (TeamMember) {
        const tm = await TeamMember.findByPk(teamMemberId, { attributes: ["id", "blockColor"] });
        colorPersona = tm?.blockColor ?? null;
      }
    } else {
      const tmId = typeof body.teamMemberId === "string" && body.teamMemberId.trim() ? body.teamMemberId.trim() : null;
      if (tmId) {
        if (!UUID_RE.test(tmId)) return error("teamMemberId inválido", 422);
        if (TeamMember) {
          const tm = await TeamMember.findByPk(tmId, { attributes: ["id", "blockColor"] });
          if (!tm) return error("Esa persona no está en el equipo", 422);
          colorPersona = tm.blockColor ?? null;
        }
        teamMemberId = tmId;
      }
    }

    const label = (body.label ? String(body.label).trim() : "").slice(0, 120) || "Vacaciones";
    const notes = body.notes ? String(body.notes).trim() : null;

    /*
     * La categoría (01/09/2026). Se acepta SOLO si el centro la tiene dada de
     * alta: la lista la decide dirección desde Configuración, y una clave
     * inventada desde el navegador se guardaría como una categoría fantasma
     * que no se puede ni pintar ni contar. Lo que no cuela, se guarda a null —
     * no se rechaza la petición: un desplegable desincronizado no puede
     * impedir apuntar unas vacaciones.
     */
    const categorias = categoriasDe(ctx.tenant);
    const categoryKey = claveValida(body.categoryKey, categorias);

    /*
     * ¿Este tramo es un TALLER? (01/09/2026). Se comprueba contra los talleres
     * dados de alta, por lo mismo que la categoría: un id inventado se guardaría
     * como un taller fantasma del que luego no se puede registrar nada.
     */
    const tallerId = await tallerValido(body.tallerId, ctx.tenantModels);

    const fila = await TeamBlock.create({
      teamMemberId,
      startAt,
      endAt,
      label,
      notes,
      categoryKey,
      tallerId,
      createdById: request.headers.get("x-user-id") || null,
    });

    // Citas que ya estaban dentro del tramo: NO se tocan, pero se cuentan para
    // que la pantalla pueda avisar de que hay que reubicarlas.
    let citasDentro = 0;
    if (Booking) {
      const donde = {
        scheduledAt: { [Op.gte]: startAt, [Op.lt]: endAt },
        status: { [Op.notIn]: ["cancelled", "no_show"] },
      };
      // Si el bloqueo es de una persona, solo cuentan SUS citas.
      if (teamMemberId) donde.teamMemberId = teamMemberId;
      citasDentro = await Booking.count({ where: donde });
    }

    await logCitasAudit({
      tenantId: ctx.tenant.id,
      userId: request.headers.get("x-user-id"),
      action: "citas.bloqueo_created",
      entity: "TeamBlock",
      entityId: fila.id,
      after: { teamMemberId, startAt, endAt, label, categoryKey },
      ip: request.headers.get("x-forwarded-for") ?? null,
    });

    const colorGeneral = ctx.tenant?.settings?.citas?.colorBloqueos ?? null;
    return created({
      // El `serializa` de aquí no lleva la persona incluida (la fila recién
      // creada no trae el `include`), así que el color se recalcula abajo con
      // el `blockColor` que ya se leyó al validar de quién es.
      ...serializa(fila, colorGeneral, null, categorias, await talleresDelCentro(ctx.tenantModels)),
      color: colorDeBloqueo({
        categoria: categoriaDe(categoryKey, categorias)?.color ?? null,
        persona: colorPersona,
        centro: colorGeneral,
      }),
      citasDentro,
    });
  } catch (err) {
    return serverError(err);
  }
});

/**
 * PATCH /api/citas/bloqueos?id=UUID — corregir una ausencia ya guardada.
 *
 * Faltaba desde el principio (12/08/2026). Ni las fechas, ni el motivo, ni de
 * quién era una ausencia se podían cambiar: había que quitarla y escribirla otra
 * vez. Eso ya costó un script — las seis ausencias que en la consulta de Laura
 * se apuntaron como «Todo el centro» y le cerraron la agenda seis veces no se
 * pudieron arreglar desde la pantalla, hubo que escribir
 * `scripts/reasignar-ausencias-sin-persona.js` para cambiarles el dueño.
 *
 * ── LOS PERMISOS NO SE AFLOJAN ──────────────────────────────────────────────
 * Hereda los del POST y el DELETE, y uno más propio:
 *
 *   · quien no es admin solo toca LAS SUYAS (misma comprobación que el DELETE),
 *   · y **no puede cambiar de quién es**, ni siquiera de la suya. Reasignar es
 *     exactamente la operación que dejó la agenda de Laura cerrada; poder
 *     hacerlo desde aquí sería devolver por la puerta de atrás lo que el POST
 *     cerró el 10/08. Cambiar el dueño es de dirección.
 *
 * Se aplica solo lo que venga en el cuerpo: lo que no se manda, no se toca.
 */
export const PATCH = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;

    const { TeamBlock, TeamMember, Booking } = ctx.tenantModels;
    if (!TeamBlock) return error("Los bloqueos no están disponibles en este cliente", 503);

    const id = String(new URL(request.url).searchParams.get("id") ?? "").trim();
    if (!UUID_RE.test(id)) return error("id inválido", 422);

    const fila = await TeamBlock.findByPk(id);
    if (!fila) return error("Esa ausencia ya no existe", 404);

    const yo = await quienSoy(request, ctx);
    if (!yo.esAdmin && (!fila.teamMemberId || fila.teamMemberId !== yo.teamMemberId)) {
      return forbidden(
        fila.teamMemberId
          ? "Solo puedes cambiar tus propias ausencias."
          : "Los cierres de todo el centro los cambia un administrador."
      );
    }

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const cambios = {};

    /*
     * Las horas, con la MISMA regla que el POST: se construyen en hora de
     * Madrid, no con `new Date()` de una cadena sin zona — que en el contenedor,
     * que va en UTC, desplazaba dos horas y solo se veía en producción.
     *
     * Se valida contra el valor que va a QUEDAR, no contra el que llega: mover
     * solo el inicio tiene que seguir cayendo antes del fin que ya estaba.
     */
    if (body.startDate || body.startTime || body.startAt) {
      const startAt = instanteDeMadrid(body.startDate, body.startTime, body.startAt);
      if (!startAt) return error("La fecha u hora de inicio no es válida", 422);
      cambios.startAt = startAt;
    }
    if (body.endDate || body.endTime || body.endAt) {
      const endAt = instanteDeMadrid(body.endDate, body.endTime, body.endAt);
      if (!endAt) return error("La fecha u hora de fin no es válida", 422);
      cambios.endAt = endAt;
    }
    const inicioFinal = cambios.startAt ?? fila.startAt;
    const finFinal = cambios.endAt ?? fila.endAt;
    if (new Date(finFinal) <= new Date(inicioFinal)) {
      return error("La fecha de fin tiene que ser posterior a la de inicio", 422);
    }

    if (body.label !== undefined) {
      cambios.label = (body.label ? String(body.label).trim() : "").slice(0, 120) || "Vacaciones";
    }
    if (body.notes !== undefined) {
      cambios.notes = body.notes ? String(body.notes).trim() : null;
    }

    /*
     * La categoría (01/09/2026). La cambia CUALQUIERA que pueda tocar el
     * bloqueo —no es como el dueño, que solo lo mueve dirección—: decir que
     * una hora bloqueada era gestión documental y no una reunión es corregir
     * una etiqueta, no reasignar la agenda de nadie.
     *
     * Mandar `null` (o una cadena vacía) la quita; lo que no venga, no se toca.
     */
    const categorias = categoriasDe(ctx.tenant);
    if (body.categoryKey !== undefined) {
      cambios.categoryKey = claveValida(body.categoryKey, categorias);
    }

    // Y qué taller se da en el tramo, con la misma regla (01/09/2026).
    if (body.tallerId !== undefined) {
      cambios.tallerId = await tallerValido(body.tallerId, ctx.tenantModels);
    }

    // De quién es: SOLO dirección, y solo si lo manda.
    let colorPersona = null;
    if (body.teamMemberId !== undefined) {
      if (!yo.esAdmin) {
        return forbidden(
          "Cambiar de quién es una ausencia es cosa de dirección. Pídelo a un administrador."
        );
      }
      const tmId = typeof body.teamMemberId === "string" && body.teamMemberId.trim()
        ? body.teamMemberId.trim()
        : null;
      if (tmId) {
        if (!UUID_RE.test(tmId)) return error("teamMemberId inválido", 422);
        if (TeamMember) {
          const tm = await TeamMember.findByPk(tmId, { attributes: ["id", "blockColor"] });
          if (!tm) return error("Esa persona no está en el equipo", 422);
          colorPersona = tm.blockColor ?? null;
        }
      }
      cambios.teamMemberId = tmId;
    }

    if (!Object.keys(cambios).length) return error("No hay nada que cambiar", 422);

    // Resumen de lo de antes, no la fila entera: la auditoría vive en master,
    // que es la base compartida por todos los clientes.
    const antes = {
      teamMemberId: fila.teamMemberId,
      startAt: fila.startAt,
      endAt: fila.endAt,
      label: fila.label,
      categoryKey: fila.categoryKey,
    };
    await fila.update(cambios);

    // Si el dueño no cambió, su color hay que ir a buscarlo igual para que la
    // agenda no pinte el bloqueo del color equivocado al refrescar.
    if (colorPersona === null && fila.teamMemberId && TeamMember) {
      const tm = await TeamMember.findByPk(fila.teamMemberId, { attributes: ["blockColor"] });
      colorPersona = tm?.blockColor ?? null;
    }

    // Citas que quedan dentro del tramo nuevo: como en el POST, no se tocan —
    // avisar, reubicar o cobrar lo decide el centro— pero se cuentan para que la
    // pantalla pueda decirlo. Mover una ausencia es justo cuando pasa.
    let citasDentro = 0;
    if (Booking) {
      const donde = {
        scheduledAt: { [Op.gte]: fila.startAt, [Op.lt]: fila.endAt },
        status: { [Op.notIn]: ["cancelled", "no_show"] },
      };
      if (fila.teamMemberId) donde.teamMemberId = fila.teamMemberId;
      citasDentro = await Booking.count({ where: donde });
    }

    await logCitasAudit({
      tenantId: ctx.tenant.id,
      userId: request.headers.get("x-user-id"),
      action: "citas.bloqueo_updated",
      entity: "TeamBlock",
      entityId: fila.id,
      before: antes,
      after: {
        teamMemberId: fila.teamMemberId,
        startAt: fila.startAt,
        endAt: fila.endAt,
        label: fila.label,
        categoryKey: fila.categoryKey,
      },
      ip: request.headers.get("x-forwarded-for") ?? null,
    });

    const colorGeneral = ctx.tenant?.settings?.citas?.colorBloqueos ?? null;
    return ok({
      ...serializa(fila, colorGeneral, null, categorias, await talleresDelCentro(ctx.tenantModels)),
      color: colorDeBloqueo({
        categoria: categoriaDe(fila.categoryKey, categorias)?.color ?? null,
        persona: colorPersona,
        centro: colorGeneral,
      }),
      citasDentro,
    });
  } catch (err) {
    return serverError(err);
  }
});

export const DELETE = withTenant(async (request, _rc, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;
    // Quitarlo, igual que ponerlo: si uno lo puede cerrar, tiene que poder
    // abrirlo — y con el mismo alcance. Queda auditado quién lo quita.

    const { TeamBlock } = ctx.tenantModels;
    if (!TeamBlock) return error("Los bloqueos no están disponibles en este cliente", 503);

    const id = String(new URL(request.url).searchParams.get("id") ?? "").trim();
    if (!UUID_RE.test(id)) return error("id inválido", 422);

    const fila = await TeamBlock.findByPk(id);
    if (!fila) return ok({ removed: false }); // idempotente

    /*
     * Simétrico al POST: un no-admin solo abre lo que él podría haber cerrado.
     * Sin esto, cerrar la agenda de otra persona seguiría estando a un clic —
     * solo que al revés: bastaría con borrarle sus vacaciones y dejarla
     * ofreciendo huecos el día que no está.
     */
    const yo = await quienSoy(request, ctx);
    if (!yo.esAdmin && (!fila.teamMemberId || fila.teamMemberId !== yo.teamMemberId)) {
      return forbidden(
        fila.teamMemberId
          ? "Solo puedes quitar tus propias ausencias."
          : "Los cierres de todo el centro los quita un administrador."
      );
    }

    const antes = { teamMemberId: fila.teamMemberId, startAt: fila.startAt, endAt: fila.endAt, label: fila.label };
    await fila.destroy();

    await logCitasAudit({
      tenantId: ctx.tenant.id,
      userId: request.headers.get("x-user-id"),
      action: "citas.bloqueo_deleted",
      entity: "TeamBlock",
      entityId: id,
      before: antes,
      ip: request.headers.get("x-forwarded-for") ?? null,
    });

    return ok({ removed: true });
  } catch (err) {
    return serverError(err);
  }
});
