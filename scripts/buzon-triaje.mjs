/**
 * buzon-triaje.mjs — la herramienta de la skill `incidencias-buzon`.
 *
 * Lee del buzón lo que los clientes nos cuentan como **fallo**, y —cuando la
 * skill ya ha decidido— marca el aviso o le contesta.
 *
 * ── CÓMO SE EJECUTA ─────────────────────────────────────────────────────────
 * POR TUBERÍA, desde la raíz del proyecto. Contra producción:
 *
 *   ssh crm-vps 'docker exec -i -e TRIAJE_ACCION=listar \
 *     crm-salamandra-app-1 node --input-type=module' < scripts/buzon-triaje.mjs
 *
 * Y en local, para probarlo sin tocar nada de nadie:
 *
 *   node --env-file=.env.local --input-type=module - < scripts/buzon-triaje.mjs
 *
 * Se ejecuta DENTRO del contenedor a propósito, y no por `docker exec node
 * scripts/…`: así corre siempre la versión que hay en el repo local, sin esperar
 * a desplegar. Es lo que permite arreglar la herramienta y usarla el mismo
 * minuto. Los parámetros van por variables de entorno porque la entrada estándar
 * ya la ocupa el propio script.
 *
 * ── POR QUÉ ES UN SCRIPT Y NO CUATRO ÓRDENES DENTRO DE LA SKILL ─────────────
 * Porque contestar a un cliente son DOS cosas, no una: guardar el mensaje
 * (`anadirMensaje`) y encenderle la campana en su CRM (`avisarEnSuCrm`). El
 * endpoint del panel hace las dos. Una skill que escribiera en la base por su
 * cuenta se dejaría la segunda el día que nadie se acuerde, y el cliente se
 * quedaría con una respuesta que no sabe que tiene. Aquí está escrito una vez,
 * en el repositorio, donde se revisa en el diff.
 *
 * ── LO QUE ESCRIBE, SOLO SI SE LE DICE ──────────────────────────────────────
 * `marcar` y `responder` NO hacen nada sin `TRIAJE_CONFIRMAR=1`: enseñan lo que
 * harían y salen. Es la misma convención que `backfill-patients-client.js`, y
 * aquí importa el doble porque `responder` le manda un mensaje a una persona de
 * carne y hueso que no se puede desenviar.
 *
 * ── VARIABLES ───────────────────────────────────────────────────────────────
 *   TRIAJE_ACCION      listar (por defecto) | marcar | responder
 *   TRIAJE_REF         «AV-0007» o el UUID del aviso
 *   TRIAJE_ESTADO      para `marcar`; por defecto `enviado` (al Registro; desde
 *                      el 02/09/2026 el botón de /admin/buzon lo hace solo)
 *   TRIAJE_TEXTO       para `responder`; el mensaje tal cual lo verá el cliente
 *   TRIAJE_AUTOR       quién firma la respuesta; por defecto «Salamandra»
 *   TRIAJE_CONFIRMAR   «1» para escribir de verdad
 */

import { pathToFileURL } from "node:url";

// Los import van por URL calculada desde el directorio de trabajo, y no con una
// ruta relativa, porque este fichero se ejecuta por tubería: sin ruta propia, un
// `../lib/…` no tiene desde dónde contar. Así vale igual ejecutado dentro del
// contenedor (cwd `/app`) que en local desde la raíz del repo.
const RAIZ = pathToFileURL(process.cwd() + "/");
const desde = (ruta) => import(new URL(ruta, RAIZ).href);

const { getMasterDb, getMasterModels } = await desde("lib/db/masterDb.js");
const { referencia, serializarAviso } = await desde("lib/buzon/buzon.js");
const { leerParaSalamandra, anadirMensaje, cambiar, listarParaSalamandra } =
  await desde("lib/buzon/buzonStore.js");
const { avisarEnSuCrm } = await desde("lib/buzon/avisarEnSuCrm.js");
const { auditar } = await desde("lib/utils/auditoria.js");

const ACCION = process.env.TRIAJE_ACCION || "listar";
const REF = (process.env.TRIAJE_REF || "").trim();
const CONFIRMAR = process.env.TRIAJE_CONFIRMAR === "1";

const db = getMasterDb();

function salir(codigo) {
  return db.close().then(() => process.exit(codigo));
}

/** «AV-0007» → 7. Un UUID se devuelve tal cual. */
function comoBuscarlo(ref) {
  const m = /^AV-?(\d+)$/i.exec(ref);
  if (m) return { numero: Number(m[1]) };
  return { id: ref };
}

async function buscar(ref) {
  if (!ref) {
    console.error("Falta TRIAJE_REF (p. ej. AV-0007).");
    return null;
  }
  const { BuzonAviso } = getMasterModels();
  const fila = await BuzonAviso.findOne({ where: comoBuscarlo(ref) });
  if (!fila) {
    console.error(`No existe ningún aviso ${ref}.`);
    return null;
  }
  return leerParaSalamandra(fila.id, { marcarLeido: false });
}

// ─────────────────────────────────────────────────────────────────────────────

// La forma en la que se le enseña un aviso a una skill.
//
// Estaba escrita a mano dentro del `map` de `fallos`. Se saca aquí (31/08/2026)
// porque ahora la usan DOS listas, y dos copias del mismo objeto acaban
// divergiendo: se le añade un campo a una, se olvida en la otra, y la skill que
// lee la otra deja de ver algo sin que nadie se entere.
function resumenDelAviso(a) {
  return {
    ref: a.ref,
    id: a.id,
    cliente: a.tenantNombre,
    slug: a.tenantSlug,
    quien: a.usuarioNombre || a.usuarioRol || null,
    asunto: a.asunto,
    cuerpo: a.cuerpo,
    leBloquea: a.bloquea,
    estado: a.estado,
    // La pantalla desde la que escribió: la mitad de las veces dice el fichero
    // por dónde empezar a mirar.
    pantalla: a.pantalla,
    navegador: a.contexto?.navegador ?? null,
    ventana: a.contexto?.ventana ?? null,
    escrito: a.createdAt,
    ultimoDelCliente: a.clienteEscribioAt,
    loAbrimos: a.leidoAt,
    leContestamos: a.respondidoAt,
    nosEspera: a.pendiente,
    hilo: a.mensajes.map((m) => ({
      de: m.autorTipo === "salamandra" ? m.autorNombre || "Salamandra" : "el cliente",
      interno: m.interno,
      cuando: m.createdAt,
      texto: m.cuerpo,
    })),
    // La skill no puede VER una captura, pero tiene que saber que existe: si el
    // aviso no se entiende sin ella, eso es lo que hay que decir en vez de
    // adivinar.
    capturas: a.adjuntos.map((x) => x.nombre),
  };
}

if (ACCION === "listar") {
  // «todos» y no «activos»: un aviso RESUELTO también hace falta verlo, porque
  // es la prueba de que algo ya se arregló y de que no hay que apuntarlo otra
  // vez. Filtrar por estado aquí escondería justo el caso que evita el trabajo
  // duplicado.
  const { avisos, soloLectura } = await listarParaSalamandra({ estado: "todos", limit: 300 });

  const todos = avisos.map((a) => serializarAviso(a, { para: "salamandra" }));
  const fallos = todos.filter((a) => a.tipo === "error");

  // Las dudas y las mejoras no las tría `incidencias-buzon` (decisión de Jorge):
  // una duda se contesta, no se apunta en el backlog, y una mejora la prioriza
  // una persona.
  //
  // Desde el 31/08/2026 se devuelven ENTERAS y no solo contadas, porque la skill
  // `mailbox` las baja todas al Registro y no puede apuntar lo que no ve. Quien
  // no las quiera sigue leyendo solo `fallos`, que no ha cambiado de forma.
  const otros = todos.filter((a) => a.tipo !== "error");

  console.log(
    JSON.stringify(
      {
        soloLectura,
        // Lo que la skill tiene que triar.
        fallos: fallos.map(resumenDelAviso),
        // Dudas y mejoras, con el mismo detalle. Cada una lleva su `tipo`
        // porque, a diferencia de los fallos, aquí van dos clases mezcladas.
        otros: otros.map((a) => ({ ...resumenDelAviso(a), tipo: a.tipo })),
        // El recuento se queda aunque ahora vaya el contenido: es lo que lee
        // `incidencias-buzon` para decir cuántas quedan sin mirar.
        sinTriar: { dudas: otros.filter((a) => a.tipo === "duda").length, mejoras: otros.filter((a) => a.tipo === "mejora").length },
      },
      null,
      1
    )
  );
  await salir(0);
}

if (ACCION === "marcar") {
  const aviso = await buscar(REF);
  if (!aviso) await salir(1);

  const estado = process.env.TRIAJE_ESTADO || "enviado";
  const antes = { estado: aviso.estado, prioridad: aviso.prioridad, asignadoA: aviso.asignadoA };

  if (!CONFIRMAR) {
    console.log(`[ensayo] ${referencia(aviso.numero)} pasaría de «${aviso.estado}» a «${estado}».`);
    console.log("Para hacerlo de verdad: TRIAJE_CONFIRMAR=1");
    await salir(0);
  }

  await cambiar(aviso, { estado });

  // El mismo rastro que deja el endpoint del panel, con la misma acción: si un
  // día alguien mira Equipo → Actividad, un triaje hecho desde la skill y uno
  // hecho a mano tienen que contarse igual. Y como en el endpoint, en el
  // resumen va la referencia y el cliente, NUNCA el texto del aviso.
  const { Tenant } = getMasterModels();
  const nosotros = await Tenant.findOne({ where: { slug: "salamandra_solutions" }, attributes: ["id"] });
  await auditar({
    tenantId: nosotros?.id ?? null,
    userId: null, // no hay sesión: esto lo mueve la skill desde la terminal
    action: "buzon.aviso_actualizado",
    entity: "BuzonAviso",
    entityId: aviso.id,
    before: antes,
    after: { ...antes, estado, ref: referencia(aviso.numero), tenantSlug: aviso.tenantSlug, via: "skill:incidencias-buzon" },
    ip: null,
  });

  console.log(`✓ ${referencia(aviso.numero)} → ${estado}`);
  await salir(0);
}

if (ACCION === "responder") {
  const aviso = await buscar(REF);
  if (!aviso) await salir(1);

  const texto = (process.env.TRIAJE_TEXTO || "").trim();
  if (!texto) {
    console.error("Falta TRIAJE_TEXTO: el mensaje que va a leer el cliente.");
    await salir(1);
  }

  const autor = process.env.TRIAJE_AUTOR || "Salamandra";

  if (!CONFIRMAR) {
    console.log(`[ensayo] A ${referencia(aviso.numero)} · ${aviso.tenantNombre}, firmado por ${autor}:`);
    console.log("──────────────────────────────────────");
    console.log(texto);
    console.log("──────────────────────────────────────");
    console.log("ESTO LO VA A LEER UNA PERSONA Y NO SE PUEDE DESENVIAR.");
    console.log("Para mandarlo: TRIAJE_CONFIRMAR=1");
    await salir(0);
  }

  await anadirMensaje(aviso, {
    autorTipo: "salamandra",
    autorNombre: autor,
    autorEmail: null,
    cuerpo: texto,
    interno: false,
  });

  // ⚠️ ESTA LÍNEA ES LA MITAD DEL TRABAJO. Sin ella la respuesta queda guardada
  // y el cliente no se entera: lo que le enciende la campana y el aviso de su
  // portada es esto. El endpoint del panel hace exactamente lo mismo justo
  // después de guardar. Best-effort, igual que allí: si falla, la respuesta ya
  // está y la ve al entrar en /ayuda.
  const avisado = await avisarEnSuCrm({ aviso });

  console.log(`✓ contestado ${referencia(aviso.numero)} como «${autor}»`);
  console.log(
    avisado?.ok
      ? "✓ campana encendida en su CRM"
      : `· sin campana (${avisado?.motivo ?? "desconocido"}) — la respuesta está guardada igual`
  );
  await salir(0);
}

console.error(`No sé qué es «${ACCION}». Usa listar, marcar o responder.`);
await salir(2);
