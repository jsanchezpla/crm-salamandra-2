/**
 * lib/calendario-global/proyectos.js — los proyectos de todos los clientes en
 * el calendario global: la lista, el tablero de uno y lo poco que se puede
 * cambiar desde fuera (12/09/2026, Rodrigo).
 *
 * (Fichero nuevo en /lib, regla #2: lo llaman los cuatro endpoints de
 * /api/calendario-global/proyectos y el arrastre del calendario global. Es la
 * misma carpeta y el mismo reparto que `eventos.js`.)
 *
 * ── VER Y MOVER, EDITAR EN EL CRM ───────────────────────────────────────────
 * Lo que decidió Rodrigo: desde el global se VE cada proyecto (avance, tareas
 * vencidas, próximo hito, tablero) y se MUEVE (una tarjeta de columna, la
 * fecha límite de una tarjeta, la fecha de un hito pendiente). Todo lo demás
 * —título, asignados, fases, hitos nuevos— se edita en el CRM del cliente,
 * saltando con `salto.js`. Por eso aquí no hay más escrituras que esas tres.
 *
 * ── MISMO CAMINO QUE EL TENANT ──────────────────────────────────────────────
 * Mover una tarjeta pasa por `lib/projects/moverTarjeta.js`, lo mismo que el
 * Kanban del cliente, y el avance sale de `lib/projects/faseProgreso.js` con el
 * mismo cálculo que la ficha del proyecto: si el global y el CRM dieran cifras
 * distintas, alguien acabaría preguntando cuál miente. Se escribe con el
 * contexto del TENANT DEL CLIENTE (`getTenantContextPorSlug`) y se audita en
 * SU actividad, con `desde: "calendario_global"` para que se sepa que no fue
 * nadie de su equipo.
 *
 * ── QUÉ NO SE TOCA ──────────────────────────────────────────────────────────
 * Un proyecto archivado o cancelado no se mueve ni cambia de fecha: está fuera
 * del tablero del cliente y del calendario (`projectEvents.js`), y tocarlo
 * desde fuera lo cambiaría sin que nadie lo viera. Un hito completado o no
 * cumplido tampoco cambia de fecha: el estado se quedaría mintiendo.
 *
 * Importa `errorTypes.js`, nunca `errors.js`: nada de aquí puede arrastrar
 * `next/server` (ver lib/utils/errorTypes.js).
 */

import { getTenantContextPorSlug } from "../tenant/tenantResolver.js";
import { auditar } from "../utils/auditoria.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../utils/errorTypes.js";
import { filtrarPorTexto } from "../utils/busquedaDb.js";
import { serializeTask } from "../projects/serializeTask.js";
import { moverTarjeta } from "../projects/moverTarjeta.js";
import { hoyMadrid, resumenDeFase, resumenSinFase, avanceGlobal } from "../projects/faseProgreso.js";
import { calendarioDe, calendariosDe, fichaPublica } from "./acceso.js";
// `fechaValida` vivía aquí; desde el 12/09/2026 está en `fechas.js`, porque
// `eventos.js` y el GET de eventos la necesitaban igual (ver su cabecera).
import { fechaValida } from "./fechas.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9_]+$/;

const ESTADOS_ACTIVOS = ["draft", "active", "paused"];
const ESTADOS_TODOS = [...ESTADOS_ACTIVOS, "completed", "cancelled"];

const DESDE = "calendario_global";

/**
 * Por qué un proyecto NO se puede mover ni cambiar de fecha desde el global, o
 * null si se puede. PURA (12/09/2026): la regla de «qué no se toca» de la
 * cabecera vive SOLO aquí. La usan `proyectoTocable`, que rechaza la escritura
 * con este mismo texto, y `leerTablero`, que devuelve `editable` para que la
 * pantalla no ofrezca arrastrar en un proyecto cancelado lo que luego el
 * servidor rechazaría siempre (hallazgo 10 de la revisión). Si mañana la regla
 * cambia, la pantalla y el servidor cambian a la vez.
 */
export function porQueNoSeToca(proyecto) {
  if (!proyecto) return "Proyecto no encontrado";
  if (proyecto.archivedAt) return "Ese proyecto está archivado";
  if (proyecto.status === "cancelled") return "Ese proyecto está cancelado";
  return null;
}

/** ¿Se puede mover y cambiar de fecha desde el global? (`porQueNoSeToca`) */
export function proyectoEditable(proyecto) {
  return porQueNoSeToca(proyecto) === null;
}

/** La ficha de un cliente para la pantalla (`fichaPublica`) con su `fallo`. */
function fichaDe(entrada) {
  return { ...fichaPublica(entrada), fallo: false };
}

/**
 * La entrada del cliente si la cuenta lo ve Y tiene Proyectos; si no, 403.
 * Es la autorización de todo lo de este fichero.
 */
async function entradaConProyectos(usuarioId, slug) {
  const entrada = usuarioId && SLUG.test(String(slug ?? "")) ? await calendarioDe(usuarioId, slug) : null;
  if (!entrada) throw new ForbiddenError("No tienes acceso a ese cliente");
  if (!entrada.proyectos) throw new ForbiddenError("Ese cliente no tiene el módulo Proyectos activo");
  return entrada;
}

/** El proyecto de una tarjeta o un hito, si todavía se puede tocar. */
async function proyectoTocable(Project, projectId) {
  const proyecto = await Project.findByPk(projectId, { attributes: ["id", "status", "archivedAt"] });
  if (!proyecto) throw new NotFoundError("Proyecto no encontrado");
  const motivo = porQueNoSeToca(proyecto);
  if (motivo) throw new ValidationError(motivo);
  return proyecto;
}

/**
 * Avance, recuento de tareas y próximo hito de VARIOS proyectos de un tenant,
 * con tres consultas en total (`projectId IN (...)`) y el resto en memoria.
 * Nada de una consulta por proyecto: con todos los clientes a la vez serían
 * cientos.
 *
 * El avance es el de `app/(dashboard)/proyectos/[id]/page.jsx` (el bloque de
 * `phaseProgress`): fases + «sin fase», tareas y entregables juntos. Aquí se
 * devuelve `null` cuando no hay nada que contar, que es lo que da
 * `avanceGlobal`; la ficha del CRM lo pinta como 0.
 *
 * Devuelve Map(projectId → { avance, tareas, proximoHito, sinColumna, fases, hitos }).
 */
async function resumenesDeProyectos(tenantModels, projectIds, hoy) {
  const { Task, BoardColumn, Milestone, Phase } = tenantModels;
  const out = new Map();
  if (!projectIds.length) return out;

  const [tareas, hitos, fases] = await Promise.all([
    Task.findAll({
      where: { projectId: projectIds },
      attributes: ["id", "projectId", "phaseId", "boardColumnId", "dueDate", "estimatedHours"],
      include: [{ model: BoardColumn, as: "boardColumn", attributes: ["id", "isDoneColumn"], required: false }],
    }),
    Milestone.findAll({
      where: { projectId: projectIds },
      attributes: ["id", "projectId", "phaseId", "name", "dueDate", "status"],
      order: [["dueDate", "ASC"]],
    }),
    Phase.findAll({
      where: { projectId: projectIds },
      attributes: ["id", "projectId", "name", "color", "order", "startDate", "endDate", "completedAt"],
      order: [["order", "ASC"]],
    }),
  ]);

  const grupo = (id) => {
    if (!out.has(id)) out.set(id, { tareas: [], hitos: [], fases: [] });
    return out.get(id);
  };
  for (const id of projectIds) grupo(id);
  for (const t of tareas) grupo(t.projectId).tareas.push(t.get({ plain: true }));
  for (const m of hitos) grupo(m.projectId).hitos.push(m.get({ plain: true }));
  for (const f of fases) grupo(f.projectId).fases.push(f.get({ plain: true }));

  for (const [id, g] of out) {
    const resumenes = g.fases.map((f) => resumenDeFase(f, { tareas: g.tareas, entregables: g.hitos, hoy }));
    const avance = avanceGlobal([...resumenes, resumenSinFase({ tareas: g.tareas, entregables: g.hitos, hoy })]).porcentaje;

    const hecha = (t) => !!t.boardColumn?.isDoneColumn;
    const vencida = (t) => !hecha(t) && typeof t.dueDate === "string" && t.dueDate.slice(0, 10) < hoy;
    // Los hitos ya vienen por fecha: el primero pendiente de hoy en adelante.
    const siguiente = g.hitos.find((m) => m.status === "pending" && typeof m.dueDate === "string" && m.dueDate >= hoy);

    out.set(id, {
      avance,
      tareas: {
        total: g.tareas.length,
        hechas: g.tareas.filter(hecha).length,
        vencidas: g.tareas.filter(vencida).length,
      },
      proximoHito: siguiente ? { name: siguiente.name, dueDate: siguiente.dueDate } : null,
      sinColumna: g.tareas.filter((t) => !t.boardColumnId).length,
      fases: g.fases,
      hitos: g.hitos,
    });
  }
  return out;
}

/**
 * El orden de las tarjetas dentro de una columna, tal como las ve el global:
 * `order` y, a igualdad (hay repetidos), la más antigua primero. El mismo en el
 * tablero (`leerTablero`) y al compactar (`compactarColumna`): si no, la
 * posición que manda la pantalla no sería la misma lista que ordena el servidor.
 */
const ORDEN_EN_COLUMNA = [
  ["order", "ASC"],
  ["createdAt", "ASC"],
  ["id", "ASC"],
];

/**
 * Deja las posiciones de una columna como se ven: 0, 1, 2… sin huecos ni
 * repetidos (12/09/2026, al integrar el tablero del global).
 *
 * POR QUÉ: la pantalla manda `targetOrder` como la POSICIÓN visible en la
 * columna (el contrato lo pide así), pero `moverTarjeta.js` —el mismo que usa
 * el Kanban del cliente, que no se toca— lo trata como el valor de `order` y
 * valida contra el número de tarjetas. Con huecos (una tarjeta borrada, o
 * cambiada de columna desde la ficha, que no reordena) las dos cosas no
 * coinciden: bajar una tarjeta al final la dejaba una por encima, y soltarla
 * al final de otra columna, antes de la última. Compactando primero, posición
 * y `order` son lo mismo y `moverTarjeta` hace exactamente lo que se ve.
 *
 * No cambia el orden visible (se recorre en `ORDEN_EN_COLUMNA`), no toca
 * `updatedAt` (`silent`) y solo escribe las filas cuyo número cambia. Filtra
 * por `projectId`: una columna de otro proyecto no encuentra nada que tocar.
 */
async function compactarColumna(Task, { projectId, boardColumnId, transaction }) {
  if (!boardColumnId) return;
  const tarjetas = await Task.findAll({
    where: { projectId, boardColumnId },
    attributes: ["id", "order"],
    order: ORDEN_EN_COLUMNA,
    transaction,
  });
  for (let i = 0; i < tarjetas.length; i++) {
    if (tarjetas[i].order === i) continue;
    await Task.update({ order: i }, { where: { id: tarjetas[i].id }, transaction, silent: true });
  }
}

/** Por fecha límite (sin fecha, al final) y luego por nombre. */
function porFechaYNombre(a, b) {
  if (a.dueDate !== b.dueDate) {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return String(a.name ?? "").localeCompare(String(b.name ?? ""), "es");
}

/**
 * Los proyectos de los clientes que ve la cuenta.
 *
 * `slugs`: null = todos; un array = solo esos (los que no ve se ignoran en
 * silencio). `estado`: "activos" (borrador, activo, en pausa) o "todos"
 * (además completados y cancelados); los archivados no salen nunca.
 * `busqueda`: por nombre o código, sin tildes (`busquedaDb.js`).
 *
 * `clientes` son los elegidos que tienen Proyectos, en el orden de
 * `calendariosDe`, cada uno con `total` (sus filas) y `fallo` si su base no
 * respondió: un cliente caído no tumba a los demás.
 */
export async function listarProyectos({ usuarioId, slugs = null, estado = "activos", busqueda = "" }) {
  if (estado !== "activos" && estado !== "todos") throw new ValidationError("Estado inválido");
  if (!usuarioId) throw new ForbiddenError();

  const { calendarios } = await calendariosDe(usuarioId);
  const elegidos = calendarios.filter((e) => e.proyectos && (!Array.isArray(slugs) || slugs.includes(e.slug)));
  const hoy = hoyMadrid();

  const clientes = elegidos.map((e) => ({ ...fichaDe(e), total: 0 }));
  const filasPorSlug = new Map();

  await Promise.all(
    elegidos.map(async (entrada, i) => {
      const cliente = clientes[i];
      try {
        const ctx = await getTenantContextPorSlug(entrada.slug);
        const { Project, Client } = ctx.tenantModels;

        const where = { archivedAt: null, status: estado === "todos" ? ESTADOS_TODOS : ESTADOS_ACTIVOS };
        await filtrarPorTexto(where, Project, busqueda || "", ["name", "code"]);

        const proyectos = await Project.findAll({
          where,
          attributes: ["id", "code", "name", "status", "priority", "startDate", "dueDate", "updatedAt"],
          include: [{ model: Client, as: "client", attributes: ["id", "name"], required: false }],
        });
        const resumenes = await resumenesDeProyectos(ctx.tenantModels, proyectos.map((p) => p.id), hoy);

        const filas = proyectos.map((p) => {
          const r = resumenes.get(p.id);
          return {
            slug: entrada.slug,
            id: p.id,
            code: p.code ?? null,
            name: p.name,
            status: p.status,
            priority: p.priority,
            clientName: p.client?.name ?? null,
            startDate: p.startDate ?? null,
            dueDate: p.dueDate ?? null,
            avance: r?.avance ?? null,
            tareas: r?.tareas ?? { total: 0, hechas: 0, vencidas: 0 },
            proximoHito: r?.proximoHito ?? null,
            updatedAt: p.updatedAt,
          };
        });
        filas.sort(porFechaYNombre);
        filasPorSlug.set(entrada.slug, filas);
        cliente.total = filas.length;
      } catch (err) {
        console.error(`[calendario-global] no se pudieron leer los proyectos de ${entrada.slug}:`, err?.message ?? err);
        cliente.fallo = true;
      }
    })
  );

  const proyectos = elegidos.flatMap((e) => filasPorSlug.get(e.slug) ?? []);
  return { clientes, proyectos };
}

/**
 * El tablero de un proyecto: la misma consulta que
 * `app/api/projects/[id]/board/route.js` (columnas por orden, tarjetas por
 * orden, asignados aplanados y pasados por `serializeTask`), más fases, hitos
 * y el avance. Un proyecto archivado da 404, como si no existiera: tampoco
 * sale en la lista.
 *
 * `proyecto.editable` (12/09/2026) dice si se puede arrastrar y cambiar
 * fechas, con la misma regla que las escrituras (`porQueNoSeToca`).
 */
export async function leerTablero({ usuarioId, slug, projectId }) {
  if (!SLUG.test(String(slug ?? ""))) throw new ValidationError("Cliente inválido");
  if (!UUID.test(String(projectId ?? ""))) throw new ValidationError("Proyecto inválido");
  // En minúsculas (12/09/2026, hallazgo 6): el UUID se acepta con /i y Postgres
  // lo encuentra igual en mayúsculas, pero los resúmenes se agrupan en un Map
  // por el `projectId` que devuelve la base, que viene en minúsculas. Pegado a
  // mano en mayúsculas, el tablero salía sin hitos, sin fases y sin avance.
  const idProyecto = String(projectId).toLowerCase();
  const entrada = await entradaConProyectos(usuarioId, slug);

  const ctx = await getTenantContextPorSlug(slug);
  const { Project, Client, BoardColumn, Task, TaskAssignee, TeamMember } = ctx.tenantModels;

  const project = await Project.findByPk(idProyecto, {
    attributes: ["id", "code", "name", "status", "priority", "startDate", "dueDate", "description", "archivedAt"],
    include: [{ model: Client, as: "client", attributes: ["id", "name"], required: false }],
  });
  if (!project || project.archivedAt) throw new NotFoundError("Proyecto no encontrado");

  // De aquí en adelante, el id que dio la base y no el que llegó en la URL: es
  // la misma clave con la que `resumenesDeProyectos` agrupa.
  const hoy = hoyMadrid();
  const [columns, resumenes] = await Promise.all([
    BoardColumn.findAll({
      where: { projectId: project.id },
      // Columnas por orden y, dentro, las tarjetas en `ORDEN_EN_COLUMNA` (el de
      // /board más un desempate: con `order` repetido Postgres no garantiza
      // nada, y la posición que se manda al mover sale de esta lista).
      order: [["order", "ASC"], ...ORDEN_EN_COLUMNA.map(([campo, dir]) => [{ model: Task, as: "tasks" }, campo, dir])],
      include: [
        {
          model: Task,
          as: "tasks",
          required: false,
          include: [
            {
              model: TaskAssignee,
              as: "assigneeLinks",
              required: false,
              include: [
                {
                  model: TeamMember,
                  as: "teamMember",
                  attributes: ["id", "displayName", "email", "avatarUrl", "avatarColor"],
                },
              ],
            },
          ],
        },
      ],
    }),
    resumenesDeProyectos(ctx.tenantModels, [project.id], hoy),
  ]);
  const r = resumenes.get(project.id);

  const columnas = columns.map((col) => {
    const json = col.toJSON();
    const tasks = (json.tasks ?? []).map((t) => {
      // Igual que /board: los asignados llegan por `assigneeLinks` y se aplanan
      // con `id` antes de serializar (serializeTask lo pasa a `teamMemberId`).
      const flat = { ...t };
      flat.assignees = (flat.assigneeLinks ?? [])
        .filter((al) => al.teamMember)
        .map((al) => ({
          id: al.teamMember.id,
          displayName: al.teamMember.displayName,
          email: al.teamMember.email,
          avatarUrl: al.teamMember.avatarUrl,
          avatarColor: al.teamMember.avatarColor,
        }));
      delete flat.assigneeLinks;
      return serializeTask(flat);
    });
    return {
      id: json.id,
      name: json.name,
      order: json.order,
      color: json.color ?? null,
      wipLimit: json.wipLimit ?? null,
      isDoneColumn: !!json.isDoneColumn,
      tasks,
    };
  });

  return {
    cliente: fichaDe(entrada),
    proyecto: {
      id: project.id,
      code: project.code ?? null,
      name: project.name,
      status: project.status,
      priority: project.priority,
      clientName: project.client?.name ?? null,
      startDate: project.startDate ?? null,
      dueDate: project.dueDate ?? null,
      description: project.description ?? null,
      avance: r?.avance ?? null,
      editable: proyectoEditable(project),
    },
    columnas,
    // Las tarjetas sin columna (se borró la suya) no salen en ningún tablero,
    // tampoco en el del CRM; se cuentan para que la pantalla lo diga.
    sinColumna: r?.sinColumna ?? 0,
    fases: (r?.fases ?? []).map((f) => ({ id: f.id, name: f.name, color: f.color ?? null })),
    hitos: (r?.hitos ?? []).map((m) => ({ id: m.id, name: m.name, dueDate: m.dueDate, status: m.status })),
  };
}

/**
 * Mueve una tarjeta de columna y/o posición desde el global. `targetOrder` es
 * la posición en la columna destino (0 = arriba), con las mismas reglas y los
 * mismos mensajes que el Kanban del cliente (`moverTarjeta.js`).
 */
export async function moverTarjetaGlobal({ usuarioId, slug, taskId, targetBoardColumnId, targetOrder, ip = null }) {
  await entradaConProyectos(usuarioId, slug);
  if (!UUID.test(String(taskId ?? ""))) throw new ValidationError("Tarea inválida");

  const ctx = await getTenantContextPorSlug(slug);
  const { Task, Project } = ctx.tenantModels;
  const task = await Task.findByPk(taskId);
  if (!task) throw new NotFoundError("Tarea no encontrada");
  await proyectoTocable(Project, task.projectId);

  // `targetOrder` es la posición visible: primero se compactan la columna de
  // origen y la de destino para que coincida con `order` (ver `compactarColumna`).
  //
  // Compactar y mover van en UNA transacción (12/09/2026, hallazgo 2 de la
  // revisión). Antes compactar hacía commit por su cuenta y después
  // `moverTarjeta` validaba: con `targetOrder: 999` se rechazaba el movimiento
  // (400), pero las dos columnas del cliente ya estaban renumeradas, sin
  // auditoría y sin que nadie lo pidiera. Ahora un rechazo deshace también la
  // compactación. El `reload` va DENTRO, para que `moverTarjeta` parta del
  // `order` compactado que solo esta transacción ve todavía.
  const { before, after } = await ctx.tenantSequelize.transaction(async (transaction) => {
    await compactarColumna(Task, { projectId: task.projectId, boardColumnId: task.boardColumnId, transaction });
    if (targetBoardColumnId !== task.boardColumnId && UUID.test(String(targetBoardColumnId ?? ""))) {
      await compactarColumna(Task, { projectId: task.projectId, boardColumnId: targetBoardColumnId, transaction });
    }
    await task.reload({ transaction });

    return moverTarjeta({
      tenantModels: ctx.tenantModels,
      tenantSequelize: ctx.tenantSequelize,
      task,
      targetBoardColumnId,
      targetOrder,
      transaction,
    });
  });

  // La auditoría, después del commit y fuera de la transacción (CLAUDE.md).
  await auditar({
    tenantId: ctx.tenant.id,
    userId: usuarioId,
    ip,
    action: "task.moved",
    entity: "Task",
    entityId: task.id,
    before,
    after: { ...after, desde: DESDE },
  });

  return { id: task.id, boardColumnId: task.boardColumnId, order: task.order };
}

/**
 * Cambia (o quita, con `null`) la fecha límite de una tarjeta desde el global:
 * el arrastre en el calendario y la ficha del tablero.
 */
export async function cambiarFechaTarjeta({ usuarioId, slug, taskId, dueDate, ip = null }) {
  await entradaConProyectos(usuarioId, slug);
  if (!UUID.test(String(taskId ?? ""))) throw new ValidationError("Tarea inválida");
  if (dueDate !== null && !fechaValida(dueDate)) throw new ValidationError("Fecha límite inválida");

  const ctx = await getTenantContextPorSlug(slug);
  const { Task, Project } = ctx.tenantModels;
  const task = await Task.findByPk(taskId);
  if (!task) throw new NotFoundError("Tarea no encontrada");
  await proyectoTocable(Project, task.projectId);

  const antes = { title: task.title, dueDate: task.dueDate ?? null };
  // Soltar la tarjeta en el mismo día no es un cambio: ni se escribe ni se
  // apunta en la actividad del cliente.
  if (antes.dueDate === dueDate) return { id: task.id, dueDate: antes.dueDate };

  await task.update({ dueDate });
  await auditar({
    tenantId: ctx.tenant.id,
    userId: usuarioId,
    ip,
    action: "task.updated",
    entity: "Task",
    entityId: task.id,
    before: antes,
    after: { title: task.title, dueDate: task.dueDate ?? null, desde: DESDE },
  });

  return { id: task.id, dueDate: task.dueDate ?? null };
}

/**
 * Cambia la fecha de un hito PENDIENTE desde el global. Un hito siempre tiene
 * fecha (la columna es NOT NULL): aquí no se quita.
 */
export async function cambiarFechaHito({ usuarioId, slug, milestoneId, dueDate, ip = null }) {
  await entradaConProyectos(usuarioId, slug);
  if (!UUID.test(String(milestoneId ?? ""))) throw new ValidationError("Hito inválido");
  if (!fechaValida(dueDate)) throw new ValidationError("Fecha del hito inválida");

  const ctx = await getTenantContextPorSlug(slug);
  const { Milestone, Project } = ctx.tenantModels;
  const hito = await Milestone.findByPk(milestoneId);
  if (!hito) throw new NotFoundError("Hito no encontrado");
  await proyectoTocable(Project, hito.projectId);
  if (hito.status !== "pending") {
    throw new ValidationError("Solo se puede cambiar la fecha de un hito pendiente");
  }

  const antes = { name: hito.name, dueDate: hito.dueDate };
  if (antes.dueDate === dueDate) return { id: hito.id, dueDate: hito.dueDate, status: hito.status };

  await hito.update({ dueDate });
  await auditar({
    tenantId: ctx.tenant.id,
    userId: usuarioId,
    ip,
    action: "project.milestone.updated",
    entity: "Milestone",
    entityId: hito.id,
    before: antes,
    after: { name: hito.name, dueDate: hito.dueDate, desde: DESDE },
  });

  return { id: hito.id, dueDate: hito.dueDate, status: hito.status };
}
