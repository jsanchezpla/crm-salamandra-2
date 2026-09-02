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
 * Los topes. Los mínimos están aquí y no escritos dentro de los mensajes
 * porque el usuario tiene que leer el NÚMERO exacto, y un número copiado a mano
 * en un texto se desincroniza del que de verdad aplica.
 *
 * ── EL TOPE DE VERDAD LO PONÍA NGINX, Y NO ERA EL QUE YO CREÍA ──────────────
 * Aquí ponía que nginx cortaba en 30 MB. Falso: ese 30 MB está en
 * `nginx/nginx.conf`, que es una plantilla legacy que NO se usa (la nginx real
 * es nativa del VPS y no está versionada). El bloque real del CRM no tenía
 * `client_max_body_size`, o sea el defecto de nginx: **1 MB**. Cualquier
 * captura de más de 1 MB —casi todas— se cortaba ANTES de llegar a la app, y lo
 * que volvía era una página HTML de nginx que el navegador intentaba leer como
 * JSON: «Unexpected token '<'». Lo encontró Jorge el 13/08/2026 adjuntando un
 * PNG normal.
 *
 * Se subió ese bloque a 20M para que el tope que manda sea SIEMPRE el de aquí
 * abajo, y así el usuario reciba una frase en cristiano y no el HTML del proxy.
 * Con 3 × 5 MB, la petición nunca pasa de 16 MB.
 */
export const LIMITES = {
  asuntoMinimo: 3,
  asunto: 200,
  cuerpoMinimo: 10,
  cuerpo: 5000,
  mensaje: 5000,
  pantalla: 500,
  adjuntos: 3,
  // 10 MB y no 5 (13/08/2026). El caso que se rompía con 5 es el más común
  // entre los clientes de verdad: la gente no técnica no hace captura de
  // pantalla, hace una FOTO AL MONITOR con el móvil, y eso son 3–8 MB. Con el
  // tope en 5 rebotaba la mitad — y quien ve rebotar su foto no la recorta,
  // coge el teléfono. Es además el mismo número que usa Soporte para lo mismo
  // (un hilo con adjuntos); Documentos está en 25 porque es otra cosa, un
  // archivo de contratos con su cuota por cliente.
  bytesPorAdjunto: 10 * 1024 * 1024,
};

/** «5 MB», para poder decirlo en pantalla sin escribirlo a mano en tres sitios. */
export const MB_POR_ADJUNTO = Math.round(LIMITES.bytesPorAdjunto / (1024 * 1024));

const CLAVES_TIPO = new Set(TIPOS.map((t) => t.key));
const CLAVES_ESTADO = new Set(ESTADOS.map((e) => e.key));
const CLAVES_PRIORIDAD = new Set(PRIORIDADES.map((p) => p.key));

/**
 * ¿Este fichero se puede ENSEÑAR en pantalla, y como qué? La regla (lista
 * blanca por EXTENSIÓN guardada, SVG nunca) se mudó el 02/09/2026 a
 * `lib/documents/verEnPantalla.js` porque ahora la comparten el buzón, el
 * archivo de Documentos y los adjuntos del paciente. Se reexporta para que
 * el endpoint de adjuntos, la pantalla y las pruebas sigan leyéndola de aquí.
 */
import { tipoParaVerEnPantalla } from "../documents/verEnPantalla.js";
export { tipoParaVerEnPantalla };

/**
 * ¿Le hemos contestado y todavía no lo ha abierto?
 *
 * ⚠️ ESTA CONDICIÓN ESTÁ ESCRITA DOS VECES Y TIENEN QUE DECIR LO MISMO: aquí en
 * JavaScript, para poder marcar la fila en su lista, y en SQL dentro de
 * `buzonStore.whereSinVer()`, que es lo que cuenta el punto del menú y lo que
 * saca el aviso de la portada. Si se separan, el fallo no da ningún error: sale
 * un punto encendido sin ninguna fila que lo explique —y la persona entra, mira,
 * no ve nada nuevo y deja de fiarse del punto— o, peor, una respuesta nuestra
 * marcada como nueva con el punto apagado.
 *
 * `vistoClienteAt` se apunta al abrir el hilo (`/api/ayuda/[id]`), y se compara
 * CON LA FECHA DE LA RESPUESTA en vez de con un booleano «leído» porque le
 * podemos contestar otra vez al mismo aviso: un `leido = true` se quedaría
 * puesto y la segunda respuesta no avisaría de nada.
 */
export function tieneRespuestaSinVer(fila) {
  if (!fila?.respondidoAt) return false;
  if (!fila.vistoClienteAt) return true;
  return new Date(fila.vistoClienteAt) < new Date(fila.respondidoAt);
}

/**
 * Lo mismo, del revés: ¿nos ha escrito ÉL algo que no hemos abierto?
 *
 * Es lo que enciende la campana del panel. Mismo par de fechas, cambiado de
 * lado: `clienteEscribioAt` (cuándo escribió él) contra `leidoAt` (cuándo
 * miramos nosotros), igual que `respondidoAt` contra `vistoClienteAt`.
 *
 * ⚠️ Y POR ESO `leidoAt` SE REESCRIBE EN CADA APERTURA, no solo la primera.
 * Mientras significó «la primera vez que lo abrimos» esta comparación no se
 * podía hacer: un cliente que insistía por tercera vez en un hilo ya visto no
 * encendía nada y su mensaje se quedaba esperando a que alguien bajara por la
 * lista. Si algún día se vuelve a poner un `if (!aviso.leidoAt)` en
 * `leerParaSalamandra`, esto deja de funcionar y no da ningún error.
 *
 * Su gemela en SQL es `buzonStore.wherePendienteNuestro()`.
 */
export function tienePendienteNuestro(fila) {
  if (!fila?.clienteEscribioAt) return false;
  if (!fila.leidoAt) return true;
  return new Date(fila.leidoAt) < new Date(fila.clienteEscribioAt);
}

/**
 * El nombre del evento con el que la pantalla de Ayuda le dice al MENÚ cuántas
 * respuestas quedan sin abrir.
 *
 * Vive aquí, y no escrito a mano en los dos sitios, por lo de siempre: un
 * `"buzon:sin-ver"` mal tecleado en uno de los dos no da error, simplemente deja
 * de apagarse el punto y nadie sabe por qué.
 *
 * Por qué un evento del navegador y no un contexto de React: las dos piezas no
 * comparten árbol —el menú lo pinta el layout del dashboard y Ayuda es una
 * página de dentro—, así que haría falta un provider en el layout para pasar un
 * número entero. Más cañería que problema.
 */
export const EVENTO_SIN_VER = "buzon:sin-ver";

/**
 * El mismo aviso, en el panel: la bandeja le dice a la CAMPANA de la barra
 * superior cuántos avisos quedan sin mirar. Mismo motivo que el de arriba —la
 * campana la pinta `app/admin/layout.jsx` y la bandeja es una página de dentro,
 * así que no comparten estado.
 */
export const EVENTO_PENDIENTES = "buzon:pendientes";

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

  // Los mensajes dicen el NÚMERO exacto y cuánto lleva escrito. Un «cuéntanos un
  // poco más» sin cifra deja a la persona probando a ciegas: no sabe si le
  // faltan dos letras o dos frases (Jorge, 13/08/2026).
  if (asunto.length < LIMITES.asuntoMinimo) {
    return {
      ok: false,
      status: 422,
      error: `El asunto necesita al menos ${LIMITES.asuntoMinimo} caracteres y llevas ${asunto.length}.`,
    };
  }
  if (cuerpo.length < LIMITES.cuerpoMinimo) {
    return {
      ok: false,
      status: 422,
      error:
        `Cuéntanos un poco más: hacen falta al menos ${LIMITES.cuerpoMinimo} caracteres y llevas ${cuerpo.length}. ` +
        `Con decirnos qué hacías y qué esperabas que pasara nos vale.`,
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
    // Si se puede enseñar, y como qué. Lo decide la EXTENSIÓN GUARDADA, igual
    // que en el endpoint, para que el botón «Ver» no aparezca donde luego iba a
    // salir una descarga. `ruta` no se expone: es una ruta de nuestro disco.
    verComo: tipoParaVerEnPantalla(a.ruta ?? a.nombre),
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
export function serializarAviso(fila, { para = "salamandra", quienMira = null } = {}) {
  const esCliente = para === "cliente";
  // Desde el 02/09/2026 (AV-0015) el cliente ve los avisos de todo su equipo,
  // pero lo que le toca hacer a ÉL —el «Nueva respuesta», el punto del menú—
  // sigue siendo solo de quien escribió. `quienMira` es el id del usuario que
  // pide la lista; sin él (pruebas, back-office) se considera suyo.
  const esMio = !esCliente || !quienMira || fila.usuarioId === quienMira;
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
    // Va en la parte COMÚN a propósito: al cliente le pinta el «Nueva
    // respuesta» de su lista, y a nosotros nos dice si ya ha leído lo que le
    // contestamos, que es justo lo que hay que saber antes de insistirle.
    sinLeer: esMio ? tieneRespuestaSinVer(fila) : false,
    mensajes,
    adjuntos,
  };

  if (esCliente) {
    return {
      ...base,
      // Quién lo escribió, para que la lista del equipo diga de quién es cada
      // uno; y si es del que mira, que es lo que decide el «Tú» del hilo.
      usuarioNombre: fila.usuarioNombre ?? null,
      esMio,
    };
  }

  return {
    ...base,
    // Solo para nosotros: es lo que marca la fila en la bandeja y lo que cuenta
    // la campana. Al cliente no le importa —ni le sirve— si ya lo hemos abierto.
    pendiente: tienePendienteNuestro(fila),
    clienteEscribioAt: fila.clienteEscribioAt ?? null,
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
