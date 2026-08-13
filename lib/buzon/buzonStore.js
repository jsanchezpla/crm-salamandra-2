/**
 * lib/buzon/buzonStore.js — el ÚNICO sitio que toca las tablas del buzón.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten los cuatro endpoints del
 * cliente y los cuatro del back-office. Si cada uno consultara por su cuenta, el
 * degradado de abajo estaría escrito ocho veces y el filtro de «solo los míos»
 * dependería de que nadie se lo dejara.)
 *
 * ── EL DEGRADADO, QUE ES LA RAZÓN DE QUE ESTO EXISTA ────────────────────────
 * `deploy.sh` NO ejecuta migraciones: se despliega el código y las tablas se
 * crean después, a mano, con un `docker exec`. O sea que existe una ventana
 * —minutos o días, según quién se acuerde— en la que el código nuevo corre
 * contra una base sin `master.buzon_avisos`.
 *
 * Durante esa ventana, LEER no puede reventar: la pantalla `/ayuda` cuelga del
 * pie del sidebar y la ve todo el mundo, tenga los módulos que tenga. Así que
 * una lectura devuelve vacío con `soloLectura: true` y la pantalla lo dice.
 * ESCRIBIR sí falla, pero con un 503 que lleva dentro el comando exacto, no con
 * un 500 mudo: quien lo vea tiene que poder arreglarlo sin preguntar.
 */

import { Op } from "sequelize";

import { getMasterModels } from "../db/masterDb.js";
import { estadoTrasMensaje } from "./buzon.js";

/** Lo que hay que correr en el VPS si las tablas no están. */
export const COMANDO_MIGRACION =
  "docker exec crm-salamandra-app-1 node scripts/migrate-buzon.js";

/** ¿El error es «esa tabla todavía no existe»? (Postgres 42P01) */
function faltaLaTabla(err) {
  const código = err?.parent?.code ?? err?.original?.code;
  return código === "42P01";
}

/** Se lanza en las escrituras. Los endpoints la convierten en un 503 con el comando. */
export class BuzonSinTabla extends Error {
  constructor() {
    super(`Falta crear las tablas del buzón. Corre en el VPS: ${COMANDO_MIGRACION}`);
    this.name = "BuzonSinTabla";
  }
}

export function esSinTabla(err) {
  return err instanceof BuzonSinTabla;
}

/** Envuelve una escritura para que un 42P01 salga como `BuzonSinTabla`. */
async function escribiendo(fn) {
  try {
    return await fn();
  } catch (err) {
    if (faltaLaTabla(err)) throw new BuzonSinTabla();
    throw err;
  }
}

const CON_HILO = [
  { association: "mensajes" },
  { association: "adjuntos" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Lado del cliente
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Da de alta un aviso.
 *
 * Los datos de quién escribe se guardan como FOTO: el nombre del cliente y el
 * correo de la persona quedan escritos aquí, no se resuelven al leer. Es lo que
 * hace que el aviso siga siendo legible cuando ese cliente ya no exista.
 */
export async function crearAviso({ tenant, usuario, limpio }) {
  return escribiendo(async () => {
    const { BuzonAviso } = getMasterModels();
    return BuzonAviso.create({
      tenantId: tenant?.id ?? null,
      tenantSlug: tenant.slug,
      tenantNombre: tenant?.name ?? null,
      usuarioId: usuario?.id ?? null,
      usuarioEmail: usuario?.email ?? null,
      usuarioNombre: usuario?.nombre ?? null,
      usuarioRol: usuario?.rol ?? null,
      ...limpio,
      ultimoMensajeAt: new Date(),
    });
  });
}

/**
 * Los avisos de UNA persona.
 *
 * El filtro es por `usuarioId`, no por tenant, y es deliberado: un aviso puede
 * ser una queja sobre el propio centro («llevo tres semanas pidiendo que me den
 * de alta»). En master no hay schema que aísle nada, así que el aislamiento lo
 * pone esta condición. Cambiarla por `tenantSlug` abriría lo que escribe cada
 * uno a todos sus compañeros.
 */
export async function listarDeUsuario(usuarioId) {
  try {
    const { BuzonAviso } = getMasterModels();
    if (!usuarioId) return { avisos: [], soloLectura: false };
    const avisos = await BuzonAviso.findAll({
      where: { usuarioId },
      include: CON_HILO,
      order: [["createdAt", "DESC"]],
      limit: 100,
    });
    return { avisos, soloLectura: false };
  } catch (err) {
    if (!faltaLaTabla(err)) throw err;
    return { avisos: [], soloLectura: true };
  }
}

/** Uno suyo, comprobando que es suyo. Devuelve null si no lo es. */
export async function leerDeUsuario(id, { usuarioId }) {
  try {
    const { BuzonAviso } = getMasterModels();
    if (!usuarioId) return null;
    return await BuzonAviso.findOne({ where: { id, usuarioId }, include: CON_HILO });
  } catch (err) {
    if (!faltaLaTabla(err)) throw err;
    return null;
  }
}

/** «Lo he visto». Apaga el punto del menú. Best-effort: no rompe la lectura. */
export async function marcarVistoPorCliente(aviso) {
  try {
    if (!aviso) return;
    await aviso.update({ vistoClienteAt: new Date() });
  } catch {
    /* que no se pueda apuntar la visita no es motivo para no enseñar el aviso */
  }
}

/**
 * Cuántas respuestas nuestras tiene sin ver. Es lo que enciende el punto en el
 * pie del sidebar, y sustituye a la campana: se lee de master, desde el propio
 * host del cliente y con su sesión, sin cruzar a ningún otro schema.
 */
export async function contarSinVer(usuarioId) {
  try {
    const { BuzonAviso } = getMasterModels();
    if (!usuarioId) return 0;
    return await BuzonAviso.count({
      where: {
        usuarioId,
        respondidoAt: { [Op.ne]: null },
        [Op.or]: [
          { vistoClienteAt: null },
          { vistoClienteAt: { [Op.lt]: { [Op.col]: "respondido_at" } } },
        ],
      },
    });
  } catch (err) {
    if (!faltaLaTabla(err)) throw err;
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lado nuestro
// ─────────────────────────────────────────────────────────────────────────────

/** La bandeja del back-office, con el recuento por estado. */
export async function listarParaSalamandra({ estado, tenantSlug, asignadoA, q, limit = 100 } = {}) {
  try {
    const { BuzonAviso } = getMasterModels();

    const where = {};
    if (estado && estado !== "todos") {
      // «Activos» = todo lo que no está resuelto. Es la pestaña por defecto.
      where.estado = estado === "activos" ? { [Op.ne]: "resuelto" } : estado;
    }
    if (tenantSlug) where.tenantSlug = tenantSlug;
    if (asignadoA) where.asignadoA = asignadoA === "nadie" ? null : asignadoA;
    if (q) {
      const como = { [Op.iLike]: `%${String(q).trim()}%` };
      where[Op.or] = [{ asunto: como }, { cuerpo: como }, { tenantNombre: como }];
    }

    const [avisos, porEstado] = await Promise.all([
      BuzonAviso.findAll({
        where,
        include: CON_HILO,
        order: [
          ["ultimoMensajeAt", "DESC"],
          ["createdAt", "DESC"],
        ],
        limit: Math.min(Number(limit) || 100, 300),
      }),
      // El recuento NO lleva los filtros de pantalla: son las pestañas, y una
      // pestaña que cuenta solo lo que ya estás mirando no dice nada.
      BuzonAviso.findAll({
        attributes: [
          "estado",
          [BuzonAviso.sequelize.fn("count", BuzonAviso.sequelize.col("id")), "n"],
        ],
        group: ["estado"],
        raw: true,
      }),
    ]);

    const recuento = { nuevo: 0, en_curso: 0, esperando: 0, resuelto: 0 };
    for (const fila of porEstado) {
      if (fila.estado in recuento) recuento[fila.estado] = Number(fila.n);
    }
    recuento.activos = recuento.nuevo + recuento.en_curso + recuento.esperando;

    return { avisos, recuento, soloLectura: false };
  } catch (err) {
    if (!faltaLaTabla(err)) throw err;
    return {
      avisos: [],
      recuento: { nuevo: 0, en_curso: 0, esperando: 0, resuelto: 0, activos: 0 },
      soloLectura: true,
    };
  }
}

/** Uno cualquiera, y de paso queda apuntado que lo hemos abierto. */
export async function leerParaSalamandra(id, { marcarLeido = true } = {}) {
  try {
    const { BuzonAviso } = getMasterModels();
    const aviso = await BuzonAviso.findByPk(id, { include: CON_HILO });
    if (aviso && marcarLeido && !aviso.leidoAt) {
      await aviso.update({ leidoAt: new Date() });
    }
    return aviso;
  } catch (err) {
    if (!faltaLaTabla(err)) throw err;
    return null;
  }
}

/** Estado, prioridad y reparto. Solo nosotros. */
export async function cambiar(aviso, cambios) {
  return escribiendo(async () => {
    const parche = { ...cambios };
    if (cambios.estado === "resuelto" && !aviso.resueltoAt) parche.resueltoAt = new Date();
    // Reabrir de verdad: si vuelve a estar en marcha, la fecha de cierre estorba.
    if (cambios.estado && cambios.estado !== "resuelto") parche.resueltoAt = null;
    await aviso.update(parche);
    return aviso;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Comunes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Añade una línea al hilo y mueve el aviso a donde toque.
 *
 * El estado NO se pasa por parámetro: lo decide `estadoTrasMensaje` a partir de
 * quién escribe. Así no hay forma de contestar y dejarlo, por descuido, como si
 * siguiera esperándonos a nosotros.
 */
export async function anadirMensaje(aviso, { autorTipo, autorNombre, autorEmail, cuerpo, interno = false }) {
  return escribiendo(async () => {
    const { BuzonMensaje } = getMasterModels();
    const mensaje = await BuzonMensaje.create({
      avisoId: aviso.id,
      autorTipo,
      autorNombre: autorNombre ?? null,
      autorEmail: autorEmail ?? null,
      cuerpo,
      interno,
    });

    // Una nota interna no cambia el estado ni cuenta como respuesta: es para
    // nosotros y el cliente no se entera de que existe.
    if (interno) return mensaje;

    const parche = {
      estado: estadoTrasMensaje(aviso.estado, autorTipo),
      ultimoMensajeAt: mensaje.createdAt,
    };
    if (autorTipo === "salamandra") parche.respondidoAt = mensaje.createdAt;
    if (parche.estado !== "resuelto") parche.resueltoAt = null;
    await aviso.update(parche);

    return mensaje;
  });
}

/** La ficha de un adjunto CON su aviso, que es lo que permite comprobar de quién es. */
export async function adjuntoConSuAviso(adjuntoId) {
  try {
    const { BuzonAdjunto } = getMasterModels();
    return await BuzonAdjunto.findByPk(adjuntoId, { include: [{ association: "aviso" }] });
  } catch (err) {
    if (!faltaLaTabla(err)) throw err;
    return null;
  }
}

export async function crearAdjunto(datos) {
  return escribiendo(async () => {
    const { BuzonAdjunto } = getMasterModels();
    return BuzonAdjunto.create(datos);
  });
}

export async function borrarAdjunto(id) {
  return escribiendo(async () => {
    const { BuzonAdjunto } = getMasterModels();
    return BuzonAdjunto.destroy({ where: { id } });
  });
}
