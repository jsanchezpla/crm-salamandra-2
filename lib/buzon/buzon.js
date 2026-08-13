/**
 * lib/buzon/buzon.js — qué es un aviso válido, y qué ve cada uno.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten los cuatro endpoints del lado
 * del cliente y los cuatro del back-office. Si cada uno validara por su cuenta,
 * el día que cambie un límite habría ocho sitios donde cambiarlo y siete se
 * quedarían atrás.)
 *
 * ── SIN BASE DE DATOS, A PROPÓSITO ──────────────────────────────────────────
 * Aquí no se importa nada de `db/`. Así `scripts/_smoke-buzon.mjs` puede fijar
 * las reglas sin levantar Postgres ni el servidor, que es lo que hace que se
 * ejecuten de verdad. Mismo criterio que `lib/provisioning/paquetes.js`.
 *
 * ── LA FUNCIÓN QUE HAY QUE MIRAR DOS VECES ──────────────────────────────────
 * `serializarAviso(fila, { para })`. Un aviso tiene cosas que son NUESTRAS —la
 * prioridad, a quién está asignado, las notas internas del hilo— y el cliente no
 * puede verlas. Ese filtro vive aquí y en ningún otro sitio: si cada endpoint
 * decidiera qué recorta, tarde o temprano uno se dejaría las notas internas
 * dentro de la respuesta.
 */

/** Qué viene a contarnos. Lo elige el cliente. */
export const TIPOS = [
  { key: "error", label: "Algo no funciona" },
  { key: "duda", label: "Una duda" },
  { key: "mejora", label: "Una mejora" },
];

/**
 * Por dónde va. Lo ponemos NOSOTROS, salvo el paso automático que hace
 * `estadoTrasMensaje`.
 *
 * `esperando` significa «la pelota está en su tejado»: hemos contestado y
 * esperamos respuesta. Sin ese estado, nuestra bandeja mezcla lo que nos toca
 * mirar con lo que ya hemos contestado, y deja de servir para saber qué queda.
 */
export const ESTADOS = [
  { key: "nuevo", label: "Nuevo", nivel: "amber" },
  { key: "en_curso", label: "En curso", nivel: "blue" },
  { key: "esperando", label: "Esperando al cliente", nivel: "grey" },
  { key: "resuelto", label: "Resuelto", nivel: "green" },
];

/** Nuestra, nunca del cliente. El porqué está en `BuzonAviso.model.js`. */
export const PRIORIDADES = [
  { key: "baja", label: "Baja" },
  { key: "normal", label: "Normal" },
  { key: "alta", label: "Alta" },
];

/** La misma lista cerrada que el Registro (`/admin/tablero`). */
export const ASIGNABLES = ["jorge", "rodrigo"];

/**
 * Los topes.
 *
 * Los adjuntos son 3 × 5 MB y no 5 × 10 MB como en tickets por un motivo muy
 * concreto: nginx corta el cuerpo de la petición en 30 MB, así que 50 MB no
 * darían el JSON de `apiResponse` sino una página HTML de error de nginx, que en
 * pantalla se ve como «no ha pasado nada». Para una captura, 5 MB sobran.
 */
export const LIMITES = {
  asunto: 200,
  cuerpo: 5000,
  mensaje: 5000,
  pantalla: 500,
  adjuntos: 3,
  bytesPorAdjunto: 5 * 1024 * 1024,
};

const CLAVES_TIPO = new Set(TIPOS.map((t) => t.key));
const CLAVES_ESTADO = new Set(ESTADOS.map((e) => e.key));
const CLAVES_PRIORIDAD = new Set(PRIORIDADES.map((p) => p.key));

/** «AV-0042». Lo que el cliente nos dice por teléfono. */
export function referencia(numero) {
  if (numero == null) return "AV-????";
  return `AV-${String(numero).padStart(4, "0")}`;
}

function texto(v, tope) {
  return String(v ?? "").trim().slice(0, tope);
}

/**
 * La ruta desde la que escribió, SIN la query.
 *
 * Lo de quitar la query no es cosmético: una URL como
 * `/clientes?q=Juan+Pérez` metería el nombre de una persona en la tabla de
 * master sin que nadie lo haya escrito a mano. El camino sí se guarda —los ids
 * que lleva son UUID opacos y es lo que nos dice dónde mirar.
 */
export function limpiarPantalla(valor) {
  const bruto = String(valor ?? "").trim();
  if (!bruto) return null;
  // Solo rutas de nuestra propia app: nada de "http://otro-sitio".
  if (!bruto.startsWith("/")) return null;
  const sinQuery = bruto.split("?")[0].split("#")[0];
  return sinQuery.slice(0, LIMITES.pantalla) || null;
}

/**
 * Lo que manda el navegador como contexto. Se acepta una lista CERRADA de
 * campos: si algún día alguien mete ahí el objeto entero de la sesión, no entra.
 */
export function limpiarContexto(entrada) {
  const c = entrada && typeof entrada === "object" ? entrada : {};
  const salida = {};
  if (c.navegador) salida.navegador = texto(c.navegador, 300);
  if (c.ventana) salida.ventana = texto(c.ventana, 20);
  if (c.idioma) salida.idioma = texto(c.idioma, 20);
  return salida;
}

/**
 * ¿Se puede guardar este aviso?
 *
 * @returns {{ok: true, limpio: object} | {ok: false, error: string, status: number}}
 */
export function validarAvisoNuevo(entrada = {}) {
  const asunto = texto(entrada.asunto, LIMITES.asunto);
  const cuerpo = texto(entrada.cuerpo, LIMITES.cuerpo);

  if (asunto.length < 3) {
    return { ok: false, status: 422, error: "Ponle un asunto de al menos 3 letras." };
  }
  if (cuerpo.length < 10) {
    return {
      ok: false,
      status: 422,
      error: "Cuéntanos un poco más: qué hacías y qué esperabas que pasara.",
    };
  }

  const tipo = CLAVES_TIPO.has(entrada.tipo) ? entrada.tipo : "error";

  return {
    ok: true,
    limpio: {
      tipo,
      asunto,
      cuerpo,
      bloquea: entrada.bloquea === true || entrada.bloquea === "true",
      pantalla: limpiarPantalla(entrada.pantalla),
      contexto: limpiarContexto(entrada.contexto),
    },
  };
}

/** Una línea del hilo, la escriba quien la escriba. */
export function validarMensaje(entrada = {}) {
  const cuerpo = texto(entrada.cuerpo, LIMITES.mensaje);
  if (cuerpo.length < 1) {
    return { ok: false, status: 422, error: "El mensaje está vacío." };
  }
  return { ok: true, limpio: { cuerpo, interno: entrada.interno === true } };
}

/**
 * Lo que NOSOTROS podemos cambiar de un aviso. Devuelve solo los campos que
 * vengan, para que un PATCH parcial no pise lo que no menciona.
 */
export function validarCambio(entrada = {}) {
  const cambios = {};

  if (entrada.estado !== undefined) {
    if (!CLAVES_ESTADO.has(entrada.estado)) {
      return { ok: false, status: 422, error: `Estado desconocido: ${entrada.estado}` };
    }
    cambios.estado = entrada.estado;
  }
  if (entrada.prioridad !== undefined) {
    if (!CLAVES_PRIORIDAD.has(entrada.prioridad)) {
      return { ok: false, status: 422, error: `Prioridad desconocida: ${entrada.prioridad}` };
    }
    cambios.prioridad = entrada.prioridad;
  }
  if (entrada.asignadoA !== undefined) {
    const a = entrada.asignadoA === null ? null : String(entrada.asignadoA).toLowerCase().trim();
    if (a !== null && !ASIGNABLES.includes(a)) {
      return { ok: false, status: 422, error: `No sé quién es "${entrada.asignadoA}".` };
    }
    cambios.asignadoA = a;
  }

  if (!Object.keys(cambios).length) {
    return { ok: false, status: 422, error: "Nada que cambiar." };
  }
  return { ok: true, limpio: cambios };
}

/**
 * A qué estado pasa un aviso cuando alguien escribe en su hilo.
 *
 * La regla en una frase: la pelota cambia de tejado. Si contestamos nosotros,
 * pasa a esperar al cliente; si escribe el cliente, vuelve a ser cosa nuestra —
 * incluso si ya estaba resuelto, porque «sigue pasando» es lo más importante
 * que nos pueden decir y no puede quedarse en un hilo cerrado.
 */
export function estadoTrasMensaje(estadoActual, autorTipo) {
  if (autorTipo === "salamandra") {
    return estadoActual === "resuelto" ? "resuelto" : "esperando";
  }
  // Escribe el cliente.
  if (estadoActual === "nuevo") return "nuevo";
  return "en_curso";
}

function metaEstado(key) {
  return ESTADOS.find((e) => e.key === key) ?? ESTADOS[0];
}

export function serializarMensaje(m) {
  return {
    id: m.id,
    autorTipo: m.autorTipo,
    autorNombre: m.autorNombre ?? null,
    interno: !!m.interno,
    cuerpo: m.cuerpo,
    createdAt: m.createdAt,
  };
}

export function serializarAdjunto(a) {
  return {
    id: a.id,
    nombre: a.nombre,
    bytes: a.bytes ?? 0,
    mime: a.mime ?? null,
    mensajeId: a.mensajeId ?? null,
    subidoPor: a.subidoPor,
  };
}

/**
 * La fila, con la forma que espera cada lado.
 *
 * `para: "cliente"` recorta TRES cosas, y las tres importan:
 *   · las notas internas del hilo — son nuestras y hablan de él;
 *   · la prioridad y el asignado — decirle a alguien que su problema es de
 *     prioridad «baja» no ayuda a nadie;
 *   · el correo y el rol de quien lo escribió, que solo nos hacen falta a
 *     nosotros para poder contestarle.
 */
export function serializarAviso(fila, { para = "salamandra" } = {}) {
  const esCliente = para === "cliente";
  const mensajes = (fila.mensajes ?? [])
    .filter((m) => (esCliente ? !m.interno : true))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map(serializarMensaje);

  const visibles = new Set(mensajes.map((m) => m.id));
  const adjuntos = (fila.adjuntos ?? [])
    // Un adjunto de una nota interna se va con ella.
    .filter((a) => (esCliente ? !a.mensajeId || visibles.has(a.mensajeId) : true))
    .map(serializarAdjunto);

  const base = {
    id: fila.id,
    numero: fila.numero ?? null,
    ref: referencia(fila.numero),
    tipo: fila.tipo,
    asunto: fila.asunto,
    cuerpo: fila.cuerpo,
    bloquea: !!fila.bloquea,
    estado: fila.estado,
    estadoLabel: metaEstado(fila.estado).label,
    estadoNivel: metaEstado(fila.estado).nivel,
    createdAt: fila.createdAt,
    ultimoMensajeAt: fila.ultimoMensajeAt ?? null,
    mensajes,
    adjuntos,
  };

  if (esCliente) return base;

  return {
    ...base,
    prioridad: fila.prioridad,
    asignadoA: fila.asignadoA ?? null,
    tenantSlug: fila.tenantSlug,
    tenantNombre: fila.tenantNombre ?? fila.tenantSlug,
    tenantId: fila.tenantId ?? null,
    usuarioEmail: fila.usuarioEmail ?? null,
    usuarioNombre: fila.usuarioNombre ?? null,
    usuarioRol: fila.usuarioRol ?? null,
    pantalla: fila.pantalla ?? null,
    contexto: fila.contexto ?? {},
    leidoAt: fila.leidoAt ?? null,
    respondidoAt: fila.respondidoAt ?? null,
    resueltoAt: fila.resueltoAt ?? null,
  };
}
