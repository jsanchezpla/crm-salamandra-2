// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-support-serialize-buzon.mjs — lo que sale por las dos ventanas públicas:
 * el portal de Soporte del tenant y el Buzón de ayuda (20/08/2026).
 *
 *   node scripts/_smoke-support-serialize-buzon.mjs
 *   node --test-name-pattern="portal" scripts/_smoke-support-serialize-buzon.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * Prueba `lib/support/serialize.js` y `lib/buzon/buzon.js`. Los dos ficheros
 * tienen la misma función delicada: decidir QUÉ CAMPOS salen hacia alguien que
 * no somos nosotros. El portal de Soporte es público (se entra por un enlace
 * con token, sin login): si `serializePortalTicket` deja de recortar, el
 * cliente final ve las notas internas del equipo, el correo del solicitante o
 * los plazos del SLA — y no hay ningún error que lo avise. En el Buzón,
 * `serializarAviso(..., { para: "cliente" })` es lo único que separa lo que un
 * cliente ve de lo que escribimos SOBRE él.
 *
 * `serialize.js` no tenía ninguna prueba. Del buzón, `_smoke-buzon.mjs` fija
 * los casos con historia (la nota interna, el «sigue pasando», los mínimos con
 * su número); esta prueba NO los repite: fija lo que ahí quedó sin red —la
 * forma ENTERA de cada salida pública con un deepEqual (cualquier campo que se
 * cuele en el futuro revienta aquí), la tabla completa de `estadoTrasMensaje`,
 * la lista blanca de `tipoParaVerEnPantalla` (el SVG NO se enseña en línea:
 * puede llevar script y una de las pantallas es el back-office), que
 * `serializarAdjunto` no expone la ruta del disco, y los vocabularios cerrados
 * (tipos, estados con su color, asignables, topes).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ticketRef,
  serializeAttachment,
  serializeMessage,
  serializeTicket,
  serializePortalTicket,
  serializeCategory,
  serializeTemplate,
  serializeSettings,
} from "../lib/support/serialize.js";
import {
  estadoActual,
  TIPOS,
  ESTADOS,
  PRIORIDADES,
  ASIGNABLES,
  LIMITES,
  MB_POR_ADJUNTO,
  tipoParaVerEnPantalla,
  referencia,
  estadoTrasMensaje,
  validarCambio,
  serializarMensaje,
  serializarAdjunto,
  serializarAviso,
} from "../lib/buzon/buzon.js";

/* ── Fixtures de Soporte: un ticket con TODO lo interno puesto ──────────────── */

/** Resuelto y con fechas fijas a propósito: su SLA no depende del reloj de hoy. */
function ticketCompleto() {
  return {
    id: "tk-1",
    number: 42,
    title: "No llegan los correos",
    description: "Desde ayer no sale ninguna notificación.",
    status: "resolved",
    priority: "high",
    channel: "portal",
    clientId: "c-9",
    client: { id: "c-9", name: null, displayName: "Clínica Sol", vatNumber: "B123" },
    contactId: "ct-3",
    contact: { id: "ct-3", name: "Eva", email: "eva@clinicasol.es", phone: "600000000" },
    categoryId: "cat-1",
    category: { id: "cat-1", name: "Correo", color: "#333333", sortOrder: 2 },
    assignedTo: "tm-7",
    assignee: { id: "tm-7", displayName: "Rodrigo", email: "rodrigo@salamandra.es" },
    requesterName: "Eva",
    requesterEmail: "eva@clinicasol.es",
    portalToken: "tok-secreto-123",
    firstResponseDueAt: "2026-08-19T14:00:00.000Z",
    resolutionDueAt: "2026-08-20T10:00:00.000Z",
    firstResponseAt: "2026-08-19T11:00:00.000Z",
    resolvedAt: "2026-08-19T20:00:00.000Z",
    closedAt: null,
    lastMessageAt: "2026-08-19T11:00:00.000Z",
    createdAt: "2026-08-19T10:00:00.000Z",
  };
}

/** El hilo, con los cuatro autores posibles: cliente, equipo, nota interna, sistema. */
function hiloCompleto() {
  return [
    {
      id: "pm-1",
      authorType: "client",
      authorName: "Eva",
      authorEmail: "eva@clinicasol.es",
      body: "No llegan los correos.",
      isInternal: false,
      createdAt: "2026-08-19T10:00:00.000Z",
    },
    {
      id: "pm-2",
      authorType: "team",
      authorUserId: "u-1",
      authorName: "Rodrigo",
      authorEmail: "rodrigo@salamandra.es",
      body: "Lo estamos mirando.",
      isInternal: false,
      emailStatus: "sent",
      createdAt: "2026-08-19T11:00:00.000Z",
    },
    {
      id: "pm-3",
      authorType: "team",
      authorName: "Rodrigo",
      body: "Nota: es el DNS del cliente, otra vez.",
      isInternal: true,
      createdAt: "2026-08-19T11:05:00.000Z",
    },
    {
      id: "pm-4",
      authorType: "system",
      authorName: null,
      body: "Prioridad cambiada a high",
      isInternal: false,
      createdAt: "2026-08-19T11:10:00.000Z",
    },
  ];
}

function adjuntosCompletos() {
  return [
    {
      id: "at-1",
      messageId: null,
      fileName: "pantallazo.png",
      fileSize: 34567,
      mimeType: "image/png",
      uploadedByType: "client",
    },
    {
      id: "at-2",
      messageId: "pm-2",
      fileName: "guia.pdf",
      fileSize: 100,
      mimeType: "application/pdf",
      uploadedByType: "team",
    },
    {
      id: "at-3",
      messageId: "pm-3",
      fileName: "traza-interna.txt",
      fileSize: 999,
      mimeType: "text/plain",
      uploadedByType: "team",
    },
  ];
}

/* ── La referencia que se dice por teléfono ──────────────────────────────────── */

describe("ticketRef / referencia: el número de teléfono de cada módulo", () => {
  it("TK se rellena con ceros a cuatro cifras y aguanta números largos", () => {
    assert.equal(ticketRef(42), "TK-0042");
    assert.equal(ticketRef(7), "TK-0007");
    assert.equal(ticketRef(12345), "TK-12345");
  });
  it("el 0 es un número de verdad, no un hueco: TK-0000 y AV-0000", () => {
    assert.equal(ticketRef(0), "TK-0000");
    assert.equal(referencia(0), "AV-0000");
  });
  it("sin número no se inventa uno, y cada módulo tiene su propio hueco", () => {
    assert.equal(ticketRef(null), "TK-—");
    assert.equal(ticketRef(undefined), "TK-—");
    assert.equal(referencia(undefined), "AV-????");
  });
});

/* ── El portal público de Soporte ───────────────────────────────────────────── */

describe("serializePortalTicket: la vista pública, campo a campo", () => {
  it("la salida ENTERA son estas ocho claves y nada más (cualquier fuga futura revienta aquí)", () => {
    assert.deepEqual(serializePortalTicket(ticketCompleto(), hiloCompleto(), adjuntosCompletos()), {
      ref: "TK-0042",
      title: "No llegan los correos",
      description: "Desde ayer no sale ninguna notificación.",
      status: "resolved",
      createdAt: "2026-08-19T10:00:00.000Z",
      resolvedAt: "2026-08-19T20:00:00.000Z",
      messages: [
        {
          id: "pm-1",
          from: "you",
          authorName: "Eva",
          body: "No llegan los correos.",
          createdAt: "2026-08-19T10:00:00.000Z",
        },
        {
          id: "pm-2",
          from: "team",
          authorName: null,
          body: "Lo estamos mirando.",
          createdAt: "2026-08-19T11:00:00.000Z",
        },
      ],
      attachments: [
        { id: "at-1", messageId: null, fileName: "pantallazo.png", fileSize: 34567 },
        { id: "at-2", messageId: "pm-2", fileName: "guia.pdf", fileSize: 100 },
      ],
    });
  });

  it("ni rastro de lo interno: token, correos, plazos del SLA, prioridad, asignado, ids", () => {
    const salida = serializePortalTicket(ticketCompleto(), hiloCompleto(), adjuntosCompletos());
    for (const campo of [
      "id",
      "number",
      "portalToken",
      "requesterEmail",
      "requesterName",
      "priority",
      "assignedTo",
      "assignee",
      "firstResponseDueAt",
      "resolutionDueAt",
      "firstResponseAt",
      "sla",
      "clientId",
      "client",
      "contactId",
      "categoryId",
      "channel",
    ]) {
      assert.equal(campo in salida, false, `se escapa «${campo}» al portal`);
    }
  });

  it("la nota interna y el mensaje del sistema no llegan; el adjunto de la nota se va con ella", () => {
    const salida = serializePortalTicket(ticketCompleto(), hiloCompleto(), adjuntosCompletos());
    assert.deepEqual(
      salida.messages.map((m) => m.id),
      ["pm-1", "pm-2"]
    );
    assert.deepEqual(
      salida.attachments.map((a) => a.id),
      ["at-1", "at-2"]
    );
  });

  it("el equipo sale como «team» y SIN nombre propio; el cliente como «you» y con el suyo", () => {
    const [delCliente, delEquipo] = serializePortalTicket(
      ticketCompleto(),
      hiloCompleto()
    ).messages;
    assert.equal(delCliente.from, "you");
    assert.equal(delCliente.authorName, "Eva");
    assert.equal(delEquipo.from, "team");
    assert.equal(delEquipo.authorName, null);
    assert.equal("authorEmail" in delEquipo, false);
  });

  it("un fichero del EQUIPO colgado del ticket sin mensaje hoy SÍ sale al portal", () => {
    // SOSPECHOSO: el filtro de adjuntos solo mira messageId, no uploadedByType.
    // Un adjunto subido por el equipo directamente al ticket (messageId null)
    // enseña su nombre y tamaño en el portal público. Hoy ahí solo acaba lo que
    // sube el propio solicitante al abrir el ticket, así que no hay fuga real;
    // si algún día el dashboard deja adjuntar al ticket sin mensaje, esto lo
    // enseñaría. Se fija lo que DEVUELVE HOY.
    const salida = serializePortalTicket(
      ticketCompleto(),
      [],
      [
        {
          id: "at-9",
          messageId: null,
          fileName: "interno-equipo.pdf",
          fileSize: 5,
          uploadedByType: "team",
        },
      ]
    );
    assert.deepEqual(salida.attachments, [
      { id: "at-9", messageId: null, fileName: "interno-equipo.pdf", fileSize: 5 },
    ]);
  });

  it("acepta filas recién sacadas de la base (con toJSON) y devuelve exactamente lo mismo", () => {
    const conToJson = (obj) => ({ toJSON: () => ({ ...obj }) });
    const directa = serializePortalTicket(ticketCompleto(), hiloCompleto(), adjuntosCompletos());
    const envuelta = serializePortalTicket(
      conToJson(ticketCompleto()),
      hiloCompleto().map(conToJson),
      adjuntosCompletos().map(conToJson)
    );
    assert.deepEqual(envuelta, directa);
  });

  it("sin hilo ni adjuntos: listas vacías, no undefined", () => {
    const salida = serializePortalTicket(ticketCompleto());
    assert.deepEqual(salida.messages, []);
    assert.deepEqual(salida.attachments, []);
  });
});

/* ── El dashboard de Soporte (el contraste: aquí SÍ va lo interno) ──────────── */

describe("serializeTicket: lo que ve el equipo, con o sin hilo", () => {
  it("la bandeja va sin hilo; el detalle con withThread lo lleva ENTERO, notas internas incluidas", () => {
    const bandeja = serializeTicket(ticketCompleto());
    assert.equal("messages" in bandeja, false);
    assert.equal("attachments" in bandeja, false);
    const detalle = serializeTicket(
      { ...ticketCompleto(), messages: hiloCompleto(), attachments: adjuntosCompletos() },
      { withThread: true }
    );
    assert.equal(detalle.messages.length, 4);
    assert.equal(detalle.messages[2].isInternal, true);
    assert.equal(detalle.attachments.length, 3);
  });

  it("el dashboard sí lleva el token del portal y el correo del solicitante (para el enlace y para contestar)", () => {
    const t = serializeTicket(ticketCompleto());
    assert.equal(t.ref, "TK-0042");
    assert.equal(t.portalToken, "tok-secreto-123");
    assert.equal(t.requesterEmail, "eva@clinicasol.es");
    assert.equal(t.priority, "high");
  });

  it("los anidados se encogen: cliente a id+nombre (displayName si no hay name), contacto sin teléfono, categoría con color, asignado sin correo", () => {
    const t = serializeTicket(ticketCompleto());
    assert.deepEqual(t.client, { id: "c-9", name: "Clínica Sol" });
    assert.deepEqual(t.contact, { id: "ct-3", name: "Eva", email: "eva@clinicasol.es" });
    assert.deepEqual(t.category, { id: "cat-1", name: "Correo", color: "#333333" });
    assert.deepEqual(t.assignee, { id: "tm-7", displayName: "Rodrigo" });
  });

  it("el SLA va calculado dentro: este resuelto a tiempo sale met/met, pase el tiempo que pase", () => {
    assert.deepEqual(serializeTicket(ticketCompleto()).sla, {
      firstResponse: {
        dueAt: "2026-08-19T14:00:00.000Z",
        doneAt: "2026-08-19T11:00:00.000Z",
        state: "met",
      },
      resolution: {
        dueAt: "2026-08-20T10:00:00.000Z",
        doneAt: "2026-08-19T20:00:00.000Z",
        state: "met",
      },
    });
  });

  it("un ticket pelado: canal manual, sin número TK-—, sin anidados, último mensaje = alta, SLA none", () => {
    const t = serializeTicket({
      id: "tk-2",
      title: "Suelto",
      status: "open",
      priority: "low",
      createdAt: "2026-08-19T10:00:00.000Z",
    });
    assert.equal(t.ref, "TK-—");
    assert.equal(t.channel, "manual");
    assert.equal(t.client, null);
    assert.equal(t.contact, null);
    assert.equal(t.category, null);
    assert.equal(t.assignee, null);
    assert.equal(t.lastMessageAt, "2026-08-19T10:00:00.000Z");
    assert.deepEqual(t.sla, {
      firstResponse: { dueAt: null, doneAt: null, state: "none" },
      resolution: { dueAt: null, doneAt: null, state: "none" },
    });
  });
});

describe("serializeMessage / serializeAttachment: cada línea del hilo, con sus defaults", () => {
  it("mensaje: forma exacta, isInternal a booleano, via crm de fábrica, adjuntos anidados serializados", () => {
    assert.deepEqual(
      serializeMessage({
        id: "m-1",
        authorType: "team",
        body: "hola",
        isInternal: 1,
        attachments: [{ id: "a-1", fileName: "f.png" }],
      }),
      {
        id: "m-1",
        authorType: "team",
        authorUserId: null,
        authorName: null,
        authorEmail: null,
        body: "hola",
        isInternal: true,
        emailStatus: null,
        via: "crm",
        createdAt: null,
        attachments: [
          {
            id: "a-1",
            messageId: null,
            fileName: "f.png",
            fileSize: 0,
            mimeType: null,
            uploadedByType: "team",
            createdAt: null,
          },
        ],
      }
    );
  });

  it("adjunto suelto: tamaño 0 y subido por el equipo si no se dice otra cosa", () => {
    const a = serializeAttachment({ id: "a-2", fileName: "sin-datos.bin" });
    assert.equal(a.fileSize, 0);
    assert.equal(a.uploadedByType, "team");
    assert.equal(a.mimeType, null);
  });
});

describe("serializeCategory / serializeTemplate / serializeSettings: los ajustes con su forma", () => {
  it("categoría y plantilla: sortOrder 0 y active booleano de fábrica", () => {
    assert.deepEqual(serializeCategory({ id: "c-1", name: "Correo" }), {
      id: "c-1",
      name: "Correo",
      color: null,
      sortOrder: 0,
      active: false,
    });
    assert.deepEqual(serializeTemplate({ id: "t-1", name: "Saludo", body: "Hola", active: true }), {
      id: "t-1",
      name: "Saludo",
      body: "Hola",
      sortOrder: 0,
      active: true,
    });
  });

  it("ajustes: notifyEmails que no es lista cae a [], slaConfig nulo a {}, apagados por defecto", () => {
    assert.deepEqual(serializeSettings({ notifyEmails: "a@b.c", slaConfig: null }), {
      slaEnabled: false,
      slaConfig: {},
      portalEnabled: false,
      portalIntro: null,
      notifyEmails: [],
      autoClassify: false,
      supportEmail: null,
    });
  });
});

/* ── El Buzón: vocabulario cerrado, adjuntos y estados ──────────────────────── */

describe("el vocabulario cerrado del Buzón, fijado como dato", () => {
  it("tres tipos, dos estados con su etiqueta y su color (02/09/2026), tres prioridades", () => {
    assert.deepEqual(
      TIPOS.map((t) => t.key),
      ["error", "duda", "mejora"]
    );
    assert.deepEqual(ESTADOS, [
      { key: "nuevo", label: "Nuevo", nivel: "amber" },
      { key: "enviado", label: "Enviado al registro", nivel: "blue" },
    ]);
    assert.deepEqual(
      PRIORIDADES.map((p) => p.key),
      ["baja", "normal", "alta"]
    );
  });

  it("solo jorge y rodrigo son asignables, y da igual cómo se teclee el nombre", () => {
    assert.deepEqual(ASIGNABLES, ["jorge", "rodrigo"]);
    assert.deepEqual(validarCambio({ asignadoA: "  JORGE " }), {
      ok: true,
      limpio: { asignadoA: "jorge" },
    });
  });

  it("el tope por adjunto son 10 MB y el rótulo de pantalla sale del MISMO número", () => {
    assert.equal(LIMITES.bytesPorAdjunto, 10 * 1024 * 1024);
    assert.equal(MB_POR_ADJUNTO, 10);
    assert.equal(LIMITES.adjuntos, 3);
  });
});

describe("tipoParaVerEnPantalla: qué se enseña en línea y qué se obliga a descargar", () => {
  it("las imágenes y el pdf se ven, cada uno con su Content-Type", () => {
    assert.equal(tipoParaVerEnPantalla("captura.png"), "image/png");
    assert.equal(tipoParaVerEnPantalla("foto.jpg"), "image/jpeg");
    assert.equal(tipoParaVerEnPantalla("foto.jpeg"), "image/jpeg");
    assert.equal(tipoParaVerEnPantalla("animacion.gif"), "image/gif");
    assert.equal(tipoParaVerEnPantalla("moderna.webp"), "image/webp");
    assert.equal(tipoParaVerEnPantalla("factura.pdf"), "application/pdf");
  });

  it("EL SVG SE DESCARGA SIEMPRE: es XML con posible script dentro, y una de las pantallas es el back-office", () => {
    assert.equal(tipoParaVerEnPantalla("logo.svg"), null);
  });

  it("lista blanca: lo que no está se descarga — html, zip, sin extensión, vacío, null", () => {
    assert.equal(tipoParaVerEnPantalla("pagina.html"), null);
    assert.equal(tipoParaVerEnPantalla("todo.zip"), null);
    assert.equal(tipoParaVerEnPantalla("sin-extension"), null);
    assert.equal(tipoParaVerEnPantalla("acaba-en-punto."), null);
    assert.equal(tipoParaVerEnPantalla(""), null);
    assert.equal(tipoParaVerEnPantalla(null), null);
  });

  it("no distingue mayúsculas y manda la ÚLTIMA extensión", () => {
    assert.equal(tipoParaVerEnPantalla("CAPTURA.PNG"), "image/png");
    assert.equal(tipoParaVerEnPantalla("inocente.png.svg"), null);
    assert.equal(tipoParaVerEnPantalla("disfrazado.svg.png"), "image/png");
  });
});

describe("serializarAdjunto: el botón «Ver» lo decide la extensión GUARDADA, y la ruta del disco no sale", () => {
  it("forma exacta: sin «ruta», y verComo nace de ella", () => {
    assert.deepEqual(
      serializarAdjunto({
        id: "ad-1",
        nombre: "captura.png",
        bytes: 123,
        mime: "image/png",
        mensajeId: null,
        subidoPor: "cliente",
        ruta: "/datos/buzon/av-1/captura.png",
      }),
      {
        id: "ad-1",
        nombre: "captura.png",
        bytes: 123,
        mime: "image/png",
        mensajeId: null,
        subidoPor: "cliente",
        verComo: "image/png",
      }
    );
  });

  it("el mime que declaró quien subió NO decide nada: manda la ruta que escribimos nosotros", () => {
    const a = serializarAdjunto({
      id: "ad-2",
      nombre: "pagina.html",
      mime: "image/png",
      subidoPor: "cliente",
      ruta: "/datos/buzon/av-1/pagina.html",
    });
    assert.equal(a.verComo, null);
    assert.equal(a.mime, "image/png");
  });

  it("sin ruta cae al nombre; bytes y mime que faltan salen como 0 y null", () => {
    const a = serializarAdjunto({ id: "ad-3", nombre: "foto.jpg", subidoPor: "cliente" });
    assert.equal(a.verComo, "image/jpeg");
    assert.equal(a.bytes, 0);
    assert.equal(a.mime, null);
  });
});

describe("serializarMensaje: una línea del hilo, con su forma exacta", () => {
  it("solo estas seis claves, interno a booleano y autor sin nombre como null (lo que sobre en la fila, fuera)", () => {
    assert.deepEqual(
      serializarMensaje({
        id: "m-9",
        autorTipo: "cliente",
        interno: 0,
        cuerpo: "hola",
        createdAt: "2026-08-13T09:00:00.000Z",
        avisoId: "no-debe-salir",
      }),
      {
        id: "m-9",
        autorTipo: "cliente",
        autorNombre: null,
        interno: false,
        cuerpo: "hola",
        createdAt: "2026-08-13T09:00:00.000Z",
      }
    );
  });
});

describe("estadoTrasMensaje: el estado dice si está en el Registro, la tabla ENTERA (02/09/2026)", () => {
  // _smoke-buzon.mjs fija los casos con historia; aquí va la tabla completa
  // (2 estados × 2 autores, más los tres nombres viejos) para que un estado
  // nuevo o un if torcido se vea.
  it("las celdas: un mensaje, de quien sea, no mueve nada; lo viejo sale traducido", () => {
    const tabla = {};
    for (const estado of ["nuevo", "enviado", "en_curso", "esperando", "resuelto"]) {
      tabla[estado] = {
        salamandra: estadoTrasMensaje(estado, "salamandra"),
        cliente: estadoTrasMensaje(estado, "cliente"),
      };
    }
    assert.deepEqual(tabla, {
      nuevo: { salamandra: "nuevo", cliente: "nuevo" },
      enviado: { salamandra: "enviado", cliente: "enviado" },
      // Los viejos salen ya traducidos: nada vuelve a escribir `en_curso` ni
      // `resuelto` (el Buzón acaba en el Registro; Rodrigo, 02/09/2026).
      en_curso: { salamandra: "enviado", cliente: "enviado" },
      esperando: { salamandra: "nuevo", cliente: "nuevo" },
      resuelto: { salamandra: "enviado", cliente: "enviado" },
    });
  });

  it("quien no es salamandra cuenta como cliente, y un estado desconocido vuelve al principio", () => {
    assert.equal(estadoTrasMensaje("enviado", undefined), "enviado");
    assert.equal(estadoTrasMensaje("enviado", "portal"), "enviado");
    assert.equal(estadoTrasMensaje("archivado", "cliente"), "nuevo");
    assert.equal(estadoTrasMensaje("archivado", "salamandra"), "nuevo");
    assert.equal(estadoActual("resuelto"), "enviado");
  });
});

/* ── serializarAviso: la forma exacta de cada lado ──────────────────────────── */

function avisoCompleto() {
  return {
    id: "av-1",
    numero: 7,
    tipo: "error",
    asunto: "No carga la lista",
    cuerpo: "Al entrar en Clientes la lista se queda en blanco.",
    bloquea: 1,
    estado: "enviado",
    prioridad: "alta",
    asignadoA: "jorge",
    tenantSlug: "aumenta",
    tenantNombre: null,
    tenantId: "t-1",
    usuarioEmail: "maria@aumenta.es",
    usuarioNombre: "María",
    usuarioRol: "user",
    pantalla: "/clientes",
    contexto: { navegador: "Firefox" },
    createdAt: "2026-08-13T09:00:00.000Z",
    ultimoMensajeAt: "2026-08-14T10:00:00.000Z",
    leidoAt: "2026-08-13T10:00:00.000Z",
    clienteEscribioAt: "2026-08-13T09:30:00.000Z",
    respondidoAt: "2026-08-14T10:00:00.000Z",
    vistoClienteAt: null,
    resueltoAt: null,
    // Desordenados a propósito: el serializador ordena por fecha.
    mensajes: [
      {
        id: "m2",
        autorTipo: "salamandra",
        autorNombre: "Jorge",
        interno: false,
        cuerpo: "Ya está subido el arreglo.",
        createdAt: "2026-08-14T10:00:00.000Z",
      },
      {
        id: "m1",
        autorTipo: "salamandra",
        autorNombre: "Jorge",
        interno: true,
        cuerpo: "Es el índice de la lista, otra vez.",
        createdAt: "2026-08-13T12:00:00.000Z",
      },
      {
        id: "m0",
        autorTipo: "cliente",
        autorNombre: "María",
        interno: false,
        cuerpo: "Os paso una captura.",
        createdAt: "2026-08-13T09:30:00.000Z",
      },
    ],
    adjuntos: [
      {
        id: "ad1",
        nombre: "captura.png",
        bytes: 120000,
        mime: "image/png",
        mensajeId: "m0",
        subidoPor: "cliente",
        ruta: "/datos/buzon/av-1/captura.png",
      },
      {
        id: "ad2",
        nombre: "traza.txt",
        bytes: 900,
        mime: "text/plain",
        mensajeId: "m1",
        subidoPor: "salamandra",
        ruta: "/datos/buzon/av-1/traza.txt",
      },
    ],
  };
}

describe("serializarAviso: al cliente le llega EXACTAMENTE esto, ni un campo más", () => {
  it("la salida entera del lado cliente, con deepEqual (prioridad, asignado, correo, rol, tenant y fechas nuestras: fuera)", () => {
    assert.deepEqual(serializarAviso(avisoCompleto(), { para: "cliente" }), {
      id: "av-1",
      numero: 7,
      ref: "AV-0007",
      tipo: "error",
      asunto: "No carga la lista",
      cuerpo: "Al entrar en Clientes la lista se queda en blanco.",
      bloquea: true,
      estado: "enviado",
      estadoLabel: "Enviado al registro",
      estadoNivel: "blue",
      createdAt: "2026-08-13T09:00:00.000Z",
      ultimoMensajeAt: "2026-08-14T10:00:00.000Z",
      sinLeer: true,
      // Desde el 02/09/2026 (AV-0015) el equipo entero ve la lista: cada
      // aviso dice de quién es, y `esMio` decide el «Tú» y el «Nueva respuesta».
      usuarioNombre: "María",
      esMio: true,
      mensajes: [
        {
          id: "m0",
          autorTipo: "cliente",
          autorNombre: "María",
          interno: false,
          cuerpo: "Os paso una captura.",
          createdAt: "2026-08-13T09:30:00.000Z",
        },
        {
          id: "m2",
          autorTipo: "salamandra",
          autorNombre: "Jorge",
          interno: false,
          cuerpo: "Ya está subido el arreglo.",
          createdAt: "2026-08-14T10:00:00.000Z",
        },
      ],
      adjuntos: [
        {
          id: "ad1",
          nombre: "captura.png",
          bytes: 120000,
          mime: "image/png",
          mensajeId: "m0",
          subidoPor: "cliente",
          verComo: "image/png",
        },
      ],
    });
  });

  it("un compañero del mismo centro lo ve, pero sin «Nueva respuesta» y sin que sea suyo (02/09/2026)", () => {
    const fila = { ...avisoCompleto(), usuarioId: "u-maria" };
    const paraMaria = serializarAviso(fila, { para: "cliente", quienMira: "u-maria" });
    const paraSilvia = serializarAviso(fila, { para: "cliente", quienMira: "u-silvia" });
    assert.equal(paraMaria.esMio, true);
    assert.equal(paraMaria.sinLeer, true);
    assert.equal(paraSilvia.esMio, false);
    assert.equal(paraSilvia.sinLeer, false);
    assert.equal(paraSilvia.usuarioNombre, "María");
    // Y sigue sin ver lo nuestro: ni prioridad, ni correo, ni notas internas.
    assert.equal(paraSilvia.prioridad, undefined);
    assert.equal(paraSilvia.usuarioEmail, undefined);
    assert.deepEqual(paraSilvia.mensajes.map((m) => m.id), paraMaria.mensajes.map((m) => m.id));
    // Sin `quienMira` (pruebas, back-office) se considera suyo, como siempre.
    assert.equal(serializarAviso(fila, { para: "cliente" }).esMio, true);
    // Y a nosotros no nos añade nada: la vista de Salamandra no lleva `esMio`.
    assert.equal(serializarAviso(fila, { para: "salamandra", quienMira: "u-silvia" }).esMio, undefined);
  });

  it("el adjunto de un mensaje VISIBLE sí viaja con el cliente (solo se va el de la nota interna)", () => {
    const suyo = serializarAviso(avisoCompleto(), { para: "cliente" });
    assert.deepEqual(
      suyo.adjuntos.map((a) => a.id),
      ["ad1"]
    );
    assert.equal(suyo.adjuntos[0].mensajeId, "m0");
  });

  it("un adjunto NUESTRO colgado del aviso sin mensaje hoy SÍ le llega al cliente", () => {
    // SOSPECHOSO: mismo agujero latente que en serializePortalTicket — el filtro
    // del lado cliente es `!a.mensajeId || visibles.has(a.mensajeId)`: solo mira
    // de qué mensaje cuelga, nunca `subidoPor`. Hoy no pasa porque el back-office
    // del buzón no adjunta ficheros (solo el cliente, al abrir el aviso o en sus
    // mensajes); si algún día adjuntamos nosotros a nivel de aviso, el nombre del
    // fichero saldría en su pantalla (y el endpoint de descarga, que solo tapa
    // salamandra+mensajeId, lo serviría). Se fija lo que DEVUELVE HOY.
    const conNuestro = serializarAviso(
      {
        ...avisoCompleto(),
        mensajes: [],
        adjuntos: [
          {
            id: "ad-9",
            nombre: "traza-interna.txt",
            bytes: 9,
            mime: "text/plain",
            mensajeId: null,
            subidoPor: "salamandra",
            ruta: "/datos/buzon/av-1/traza-interna.txt",
          },
        ],
      },
      { para: "cliente" }
    );
    assert.deepEqual(conNuestro.adjuntos, [
      {
        id: "ad-9",
        nombre: "traza-interna.txt",
        bytes: 9,
        mime: "text/plain",
        mensajeId: null,
        subidoPor: "salamandra",
        verComo: null,
      },
    ]);
  });

  it("nuestro lado añade lo nuestro: pendiente, prioridad, asignado, tenant (con el slug de nombre si falta), correo y fechas", () => {
    const nuestro = serializarAviso(avisoCompleto(), { para: "salamandra" });
    // leidoAt (10:00) es posterior a clienteEscribioAt (09:30): nada pendiente.
    assert.equal(nuestro.pendiente, false);
    assert.equal(nuestro.prioridad, "alta");
    assert.equal(nuestro.asignadoA, "jorge");
    assert.equal(nuestro.tenantSlug, "aumenta");
    assert.equal(nuestro.tenantNombre, "aumenta");
    assert.equal(nuestro.usuarioEmail, "maria@aumenta.es");
    assert.equal(nuestro.usuarioRol, "user");
    assert.equal(nuestro.leidoAt, "2026-08-13T10:00:00.000Z");
    assert.equal(nuestro.respondidoAt, "2026-08-14T10:00:00.000Z");
    assert.equal(nuestro.mensajes.length, 3);
    assert.equal(nuestro.adjuntos.length, 2);
    // Y si el cliente insiste después de leerlo nosotros, pendiente se enciende.
    const insiste = serializarAviso(
      { ...avisoCompleto(), clienteEscribioAt: "2026-08-13T11:00:00.000Z" },
      { para: "salamandra" }
    );
    assert.equal(insiste.pendiente, true);
  });

  it("«pendiente» no existe en el lado del cliente: es nuestro semáforo, no el suyo", () => {
    assert.equal("pendiente" in serializarAviso(avisoCompleto(), { para: "cliente" }), false);
  });

  it("un estado que no existe no revienta: cae a la etiqueta del primero (Nuevo, amber)", () => {
    const raro = serializarAviso({ ...avisoCompleto(), estado: "archivado" }, { para: "cliente" });
    assert.equal(raro.estado, "archivado");
    assert.equal(raro.estadoLabel, "Nuevo");
    assert.equal(raro.estadoNivel, "amber");
  });

  it("sin hilo ni adjuntos en la fila, salen listas vacías", () => {
    const pelado = serializarAviso(
      { id: "av-2", numero: 8, tipo: "duda", asunto: "x", cuerpo: "y", estado: "nuevo" },
      { para: "cliente" }
    );
    assert.deepEqual(pelado.mensajes, []);
    assert.deepEqual(pelado.adjuntos, []);
    assert.equal(pelado.ref, "AV-0008");
  });
});
