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
import { ESTADOS, ESTADOS_ANTIGUOS, estadoActual, estadoTrasMensaje, referencia } from "./buzon.js";

/**
 * Las claves de la base que cuentan como un estado de hoy: él mismo y los
 * nombres viejos que se leen como él (`en_curso` → enviado, `esperando` →
 * nuevo), hasta que `scripts/migrate-buzon-estados.js` los reescriba.
 */
function clavesQueCuentanComo(estado) {
  return [estado, ...Object.keys(ESTADOS_ANTIGUOS).filter((k) => ESTADOS_ANTIGUOS[k] === estado)];
}

/** Lo que hay que correr en el VPS si las tablas no están. */
export const COMANDO_MIGRACION =
  "docker exec crm-salamandra-app-1 node scripts/migrate-buzon.js";

/**
 * ¿El error es «la base todavía no está al día»?
 *
 * Dos códigos de Postgres, y el segundo se añadió el 13/08/2026 después de ver
 * lo que pasaba sin él:
 *
 *   · `42P01` — la tabla no existe. Es el caso del primer despliegue.
 *   · `42703` — LA COLUMNA no existe. Es el caso de CUALQUIER despliegue
 *     posterior que añada una, y es peor que el otro. Sequelize hace SELECT de
 *     todos los atributos del modelo, así que en cuanto `cliente_escribio_at`
 *     entró en `BuzonAviso.model.js`, TODAS las consultas del buzón la piden —
 *     también `listarDelTenant`, que es la pantalla `/ayuda` que ve cualquier
 *     usuario de cualquier cliente. Como `deploy.sh` no ejecuta migraciones,
 *     entre subir el código y acordarse de correr `migrate-buzon.js` a mano hay
 *     una ventana de minutos o días en la que eso serían 500 en la cara de todo
 *     el mundo, en la pantalla que existe precisamente para avisar de que algo
 *     falla.
 *
 * Con los dos, esa ventana degrada igual que el primer día: leer devuelve vacío
 * con `soloLectura`, y escribir da un 503 que lleva dentro el comando exacto.
 *
 * El precio es que un error de programador —una columna mal escrita en una
 * consulta nueva— se disfrazaría de «falta migrar» en vez de reventar. Se acepta
 * a sabiendas: el mensaje que sale dice qué correr, así que se descubre a la
 * primera en cuanto alguien lo corre y sigue fallando.
 */
function faltaLaTabla(err) {
  const código = err?.parent?.code ?? err?.original?.code;
  return código === "42P01" || código === "42703";
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
      // El alta ya ES el cliente escribiéndonos: sin esto, un aviso recién
      // creado no encendería la campana del panel hasta que mandara un segundo
      // mensaje, que es justo al revés de lo que hace falta.
      clienteEscribioAt: new Date(),
    });
  });
}

/**
 * Los de TODO EL EQUIPO de un cliente (02/09/2026, AV-0015 de Aumenta: «si no
 * te vamos a mandar la misma duda varias personas»). Hasta ese día cada
 * usuario veía solo los suyos, con el argumento de que un aviso puede ser una
 * queja sobre el propio centro; pesó más el trabajo duplicado. El aislamiento
 * lo pone ahora el tenant.
 *
 * Se filtra por `tenant_id` y, por si alguna fila vieja no lo trajera, también
 * por `tenant_slug`: un aviso sin ninguno de los dos no es de nadie.
 */
function whereDelTenant({ tenantId, tenantSlug }) {
  const alguno = [];
  if (tenantId) alguno.push({ tenantId });
  if (tenantSlug) alguno.push({ tenantSlug });
  return alguno.length ? { [Op.or]: alguno } : { id: null };
}

export async function listarDelTenant({ tenantId, tenantSlug }) {
  try {
    const { BuzonAviso } = getMasterModels();
    if (!tenantId && !tenantSlug) return { avisos: [], soloLectura: false };
    const avisos = await BuzonAviso.findAll({
      where: whereDelTenant({ tenantId, tenantSlug }),
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

/** Uno de su equipo, comprobando que es de su cliente. Devuelve null si no. */
export async function leerDelTenant(id, { tenantId, tenantSlug }) {
  try {
    const { BuzonAviso } = getMasterModels();
    if (!tenantId && !tenantSlug) return null;
    return await BuzonAviso.findOne({
      where: { [Op.and]: [{ id }, whereDelTenant({ tenantId, tenantSlug })] },
      include: CON_HILO,
    });
  } catch (err) {
    if (!faltaLaTabla(err)) throw err;
    return null;
  }
}

/**
 * «Lo he visto». Apaga el punto del menú. Best-effort: no rompe la lectura.
 *
 * Solo lo apunta QUIEN ESCRIBIÓ el aviso: el «Nueva respuesta» es suyo, y que
 * un compañero abra el hilo antes que él no puede apagárselo.
 */
export async function marcarVistoPorCliente(aviso, usuarioId) {
  try {
    if (!aviso || !usuarioId || aviso.usuarioId !== usuarioId) return;
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
/**
 * La condición de «le hemos contestado y todavía no lo ha abierto», en SQL.
 *
 * Vive en una función y no copiada en dos consultas porque la usan el punto del
 * menú y el aviso de la portada, y si dejaran de coincidir tendríamos un punto
 * encendido sin nada que enseñar, o al revés.
 *
 * ⚠️ Y TIENE UNA GEMELA EN JAVASCRIPT: `tieneRespuestaSinVer` en
 * `lib/buzon/buzon.js`, que es la que marca cada fila de la lista del cliente
 * (el «Nueva respuesta»). Son dos idiomas de la MISMA regla y hay que cambiarlas
 * a la vez. No se puede unificar: esta tiene que ejecutarse dentro de Postgres
 * para poder contar sin traerse las filas, y aquella tiene que poder correr en
 * el navegador, donde no hay base de datos. `scripts/_smoke-buzon.mjs` fija la
 * de JavaScript caso por caso.
 */
function whereSinVer(usuarioId) {
  return {
    usuarioId,
    respondidoAt: { [Op.ne]: null },
    [Op.or]: [
      { vistoClienteAt: null },
      { vistoClienteAt: { [Op.lt]: { [Op.col]: "respondido_at" } } },
    ],
  };
}

export async function contarSinVer(usuarioId) {
  try {
    const { BuzonAviso } = getMasterModels();
    if (!usuarioId) return 0;
    return await BuzonAviso.count({ where: whereSinVer(usuarioId) });
  } catch (err) {
    if (!faltaLaTabla(err)) throw err;
    return 0;
  }
}

/**
 * Las respuestas que tiene sin ver, para poder NOMBRARLAS en la portada.
 *
 * Un «tienes 1 sin leer» obliga a ir a buscar de qué va; con el asunto delante,
 * la mitad de las veces ya sabe si le corre prisa.
 */
export async function sinVerDeUsuario(usuarioId, limite = 3) {
  try {
    const { BuzonAviso } = getMasterModels();
    if (!usuarioId) return [];
    const filas = await BuzonAviso.findAll({
      where: whereSinVer(usuarioId),
      attributes: ["id", "numero", "asunto", "respondidoAt"],
      order: [["respondidoAt", "DESC"]],
      limit: limite,
    });
    return filas.map((f) => ({
      id: f.id,
      numero: f.numero,
      asunto: f.asunto,
      respondidoAt: f.respondidoAt,
    }));
  } catch (err) {
    if (!faltaLaTabla(err)) throw err;
    return [];
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
      where.estado =
        estado === "activos" ? { [Op.ne]: "resuelto" } : { [Op.in]: clavesQueCuentanComo(estado) };
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

    const recuento = Object.fromEntries(ESTADOS.map((e) => [e.key, 0]));
    for (const fila of porEstado) {
      // Se SUMA, no se asigna: `en_curso` y `enviado` caen en la misma casilla.
      const clave = estadoActual(fila.estado);
      if (clave in recuento) recuento[clave] += Number(fila.n);
    }
    recuento.activos = recuento.nuevo + recuento.enviado;

    return { avisos, recuento, soloLectura: false };
  } catch (err) {
    if (!faltaLaTabla(err)) throw err;
    return {
      avisos: [],
      recuento: { nuevo: 0, enviado: 0, resuelto: 0, activos: 0 },
      soloLectura: true,
    };
  }
}

/**
 * Uno cualquiera, y de paso queda apuntado que lo hemos abierto.
 *
 * ⚠️ SE APUNTA CADA VEZ, no solo la primera. Aquí había un `&& !aviso.leidoAt`
 * y esa línea es la que hacía que un cliente pudiera escribir tres veces en un
 * hilo ya abierto sin encender nada en el panel: `leidoAt` se quedaba en la
 * fecha del primer día y `tienePendienteNuestro` no tenía con qué comparar.
 * Volver a ponerlo apaga la campana en silencio (13/08/2026).
 */
export async function leerParaSalamandra(id, { marcarLeido = true } = {}) {
  try {
    const { BuzonAviso } = getMasterModels();
    const aviso = await BuzonAviso.findByPk(id, { include: CON_HILO });
    if (aviso && marcarLeido) {
      await aviso.update({ leidoAt: new Date() });
    }
    return aviso;
  } catch (err) {
    if (!faltaLaTabla(err)) throw err;
    return null;
  }
}

/**
 * La condición de «nos ha escrito y no lo hemos abierto», en SQL. Gemela de
 * `tienePendienteNuestro` en `lib/buzon/buzon.js` — las dos, a la vez.
 *
 * Es el espejo exacto de `whereSinVer`: allí `respondido_at` contra
 * `visto_cliente_at`, aquí `cliente_escribio_at` contra `leido_at`.
 */
function wherePendienteNuestro() {
  return {
    clienteEscribioAt: { [Op.ne]: null },
    [Op.or]: [
      { leidoAt: null },
      { leidoAt: { [Op.lt]: { [Op.col]: "cliente_escribio_at" } } },
    ],
  };
}

/**
 * Cuántos avisos nos esperan, y cuáles.
 *
 * Consulta aparte y NO un campo más de `listarParaSalamandra`, porque quien la
 * llama es la campana de la barra superior: está en TODAS las pantallas del
 * panel y se repregunta sola cada minuto. Pedir por eso la bandeja entera —cien
 * avisos con su hilo y sus adjuntos— para acabar pintando un número sería
 * gastar mil veces lo que hace falta.
 */
export async function pendientesParaSalamandra(limite = 8) {
  try {
    const { BuzonAviso } = getMasterModels();
    const donde = wherePendienteNuestro();
    const [total, filas] = await Promise.all([
      BuzonAviso.count({ where: donde }),
      BuzonAviso.findAll({
        where: donde,
        attributes: [
          "id",
          "numero",
          "asunto",
          "tenantNombre",
          "tenantSlug",
          "bloquea",
          "leidoAt",
          "clienteEscribioAt",
        ],
        order: [
          // Lo que le impide trabajar a alguien, primero. Después, lo más
          // reciente: si hay ocho esperando, el de hace diez minutos es el que
          // todavía tiene a una persona delante de la pantalla.
          ["bloquea", "DESC"],
          ["clienteEscribioAt", "DESC"],
        ],
        limit: limite,
      }),
    ]);
    return {
      total,
      avisos: filas.map((f) => ({
        id: f.id,
        numero: f.numero,
        ref: referencia(f.numero),
        asunto: f.asunto,
        tenantNombre: f.tenantNombre ?? f.tenantSlug,
        bloquea: !!f.bloquea,
        // «Nuevo» = no lo hemos abierto nunca. Distinto de «ha vuelto a
        // escribir», que sí lo abrimos en su día.
        nuevo: !f.leidoAt,
        clienteEscribioAt: f.clienteEscribioAt,
      })),
      soloLectura: false,
    };
  } catch (err) {
    if (!faltaLaTabla(err)) throw err;
    return { total: 0, avisos: [], soloLectura: true };
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

/**
 * El aviso ya tiene su tarea en el Registro (02/09/2026): se enlaza por la
 * FICHA (`<!--id:…-->`, la misma que usan las capturas del tablero, porque el
 * título se reescribe y la ficha no) y pasa a «enviado». Lo llama solo
 * `POST /api/admin/buzon/[id]/registro`, DESPUÉS de publicar la versión: si la
 * publicación falla, el aviso no se marca.
 */
export async function marcarEnviadoAlRegistro(aviso, { ficha }) {
  return escribiendo(async () => {
    await aviso.update({
      estado: "enviado",
      registroFicha: ficha,
      registroEnviadoAt: new Date(),
      resueltoAt: null,
    });
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
    // Y si escribe él, vuelve a estar pendiente de que lo miremos AUNQUE el
    // hilo ya lo hubiéramos abierto. Es la mitad de la campana del panel: la
    // otra mitad es que `leerParaSalamandra` reescriba `leidoAt` cada vez.
    else parche.clienteEscribioAt = mensaje.createdAt;
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
