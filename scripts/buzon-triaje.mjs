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
const { comoBuscarElAviso, interpretar } = await desde("lib/incidencias/identificador.js");
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

/*
 * ── `ver`: UN caso entero, de una sola consulta (18/09/2026) ────────────────
 *
 * Es la puerta de la skill `/incidencia`. Hasta hoy, para ponerse al día de un
 * aviso concreto había que usar `listar`, que **ignora TRIAJE_REF** y vuelca los
 * ~300 avisos enteros: el filtrado lo hacía el modelo ya dentro del contexto. O
 * sea que abrir un caso costaba el buzón entero, y una conversación nueva
 * empezaba con el contexto medio gastado antes de mirar nada.
 *
 * Aquí se junta lo que estaba en dos sitios y nunca se había juntado:
 *   · el aviso con su hilo y sus capturas (Buzón);
 *   · su tarea del Registro, en qué sección está y si sigue abierta (tablero).
 *
 * ── CÓMO SE CASAN, Y EN QUÉ ORDEN ──────────────────────────────────────────
 * Manda la FICHA (`BuzonAviso.registroFicha`, el vínculo real desde el
 * 02/09/2026). Si el aviso no la tiene —los anteriores al botón, que se
 * apuntaron a mano con /mailbox— se cae a buscar la cita `AV-####` dentro del
 * texto, que es exactamente lo que ya hace `sincronizarConRegistro` para
 * decidir si un aviso sigue vivo. Sin ninguna de las dos, se dice que no hay
 * tarea; no se adivina por parecido de título.
 *
 * Solo LEE. No marca, no contesta y no publica nada.
 */
if (ACCION === "ver") {
  const { trocearTodo } = await desde("lib/tablero/parser.js");
  const { ultimaVersion } = await desde("lib/tablero/documentos.js");
  const { claveDeTarea } = await desde("lib/tablero/estado.js");

  const q = interpretar(REF);
  if (q.tipo === "texto") {
    console.error(
      REF
        ? `«${REF}» no es una referencia (AV-0007), ni una ficha (s55hv5), ni un UUID.`
        : "Falta TRIAJE_REF (p. ej. AV-0007, o la ficha s55hv5)."
    );
    await salir(1);
  }

  const { BuzonAviso, TableroEstado, TableroAdjunto } = getMasterModels();
  const fila = await BuzonAviso.findOne({ where: comoBuscarElAviso(REF) });

  // Una ficha puede no tener aviso detrás: hay tareas del Registro que nadie
  // mandó desde el Buzón. Eso no es un error — es media respuesta.
  const aviso = fila ? serializarAviso(await leerParaSalamandra(fila.id, { marcarLeido: false }), { para: "salamandra" }) : null;
  if (!aviso && q.tipo !== "ficha") {
    console.error(`No existe ningún aviso ${REF}.`);
    await salir(1);
  }

  const ficha = q.tipo === "ficha" ? q.ficha : (aviso?.registroFicha ?? null);
  const numero = aviso?.numero ?? (q.tipo === "aviso" ? q.numero : null);
  // La misma regex que `citaLaReferencia`: el `(?!\d)` impide que AV-0017
  // case dentro de AV-0170.
  const cita = numero == null ? null : new RegExp(`${referencia(numero)}(?!\d)`);

  const docs = {};
  for (const nombre of ["backlog", "resuelto"]) {
    const doc = await ultimaVersion(getMasterModels(), nombre);
    docs[nombre] = doc ? { version: doc.version, contenido: doc.contenido } : null;
  }

  let tarea = null;
  for (const nombre of ["backlog", "resuelto"]) {
    if (!docs[nombre] || tarea) continue;
    for (const seccion of trocearTodo(docs[nombre].contenido).secciones) {
      if (seccion.esManual || tarea) continue;
      for (const t of seccion.tareas) {
        // La ficha manda; la cita es la red para las tareas de antes del botón.
        const suya = ficha ? t.id === ficha : cita ? cita.test(t.cuerpo) : false;
        if (!suya) continue;
        tarea = {
          documento: nombre,
          abierta: nombre === "backlog",
          version: docs[nombre].version,
          seccion: seccion.titulo,
          ficha: t.id,
          titulo: t.titulo,
          quien: t.quien,
          linea: t.linea,
          cuerpo: t.cuerpo,
          casadaPor: ficha && t.id === ficha ? "ficha" : "cita AV",
        };
        break;
      }
    }
  }

  // El tick, el reparto y la solución que se escribieron desde el móvil: viven
  // encima del texto, en otra tabla, casados por título normalizado.
  let estado = null;
  if (tarea) {
    const e = await TableroEstado.findOne({ where: { clave: claveDeTarea(tarea.titulo) } });
    if (e) {
      estado = {
        asignadoA: e.asignadoA ?? null,
        marcada: e.resuelta ?? null,
        tocadaPor: e.tocadaPor ?? null,
        solucion: e.solucion ?? null,
        apuntadaEn: e.apuntadaEn ?? null,
      };
    }
  }

  // Las capturas del tablero cuelgan de la ficha. Aquí van solo los nombres:
  // para VERLAS, `node scripts/registro.mjs capturas <ficha>`.
  const capturas = tarea?.ficha
    ? (await TableroAdjunto.findAll({ where: { ficha: tarea.ficha }, order: [["createdAt", "ASC"]] })).map((a) => ({
        nombre: a.nombre,
        bytes: a.bytes,
      }))
    : [];

  console.log(
    JSON.stringify(
      {
        buscadoComo: q.tipo,
        aviso: aviso ? resumenDelAviso(aviso) : null,
        avisoFicha: aviso?.registroFicha ?? null,
        avisoEnviadoAlRegistro: aviso?.registroEnviadoAt ?? null,
        tarea,
        estado,
        capturasDelTablero: capturas,
        // Para que quien lea esto sepa qué NO le estamos contando.
        nota: tarea
          ? null
          : ficha || cita
            ? "No hay tarea en el Registro para este caso: ni por ficha ni por cita AV-####. O no se apuntó nunca, o se borró."
            : "Sin ficha y sin número: no hay por dónde casarlo con el Registro.",
      },
      null,
      1
    )
  );
  await salir(0);
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

/*
 * `escribir` (15/09/2026): lo mismo que el botón «Escribir a una persona» del
 * panel, desde la terminal. Abre un aviso NUESTRO para una persona que no ha
 * escrito nada.
 *   TRIAJE_CLIENTE  slug del cliente (`aumenta`)
 *   TRIAJE_PARA     su usuario de entrada, su correo o su nombre de equipo
 *   TRIAJE_ASUNTO   el asunto
 *   TRIAJE_TEXTO    el mensaje
 *   TRIAJE_AUTOR    quién firma; por defecto «Salamandra»
 */
if (ACCION === "escribir") {
  const { validarAvisoDeSalamandra } = await desde("lib/buzon/buzon.js");
  const { crearAvisoDeSalamandra } = await desde("lib/buzon/buzonStore.js");
  const { personasDelCliente } = await desde("lib/buzon/destinatarios.js");
  const { Tenant } = getMasterModels();

  const slug = (process.env.TRIAJE_CLIENTE || "").trim();
  const para = (process.env.TRIAJE_PARA || "").trim().toLowerCase();
  const tenant = slug ? await Tenant.findOne({ where: { slug, status: "active" } }) : null;
  if (!tenant) {
    console.error(`No hay ningún cliente activo «${slug}».`);
    await salir(1);
  }
  const personas = await personasDelCliente(tenant);
  const candidatas = personas.filter((p) =>
    [p.usuario, p.correo, p.nombre].some((v) => v && v.toLowerCase() === para)
  );
  if (candidatas.length !== 1) {
    console.error(`«${para}» casa con ${candidatas.length} personas de ${slug}. Estas son las que hay:`);
    for (const p of personas) console.error(`  ${p.nombre ?? "—"} · ${p.usuario} · ${p.rol}`);
    await salir(1);
  }
  const persona = candidatas[0];
  const autor = process.env.TRIAJE_AUTOR || "Salamandra";

  const v = validarAvisoDeSalamandra({
    tenantId: tenant.id,
    usuarioId: persona.id,
    asunto: process.env.TRIAJE_ASUNTO,
    cuerpo: process.env.TRIAJE_TEXTO,
  });
  if (!v.ok) {
    console.error(v.error);
    await salir(1);
  }

  if (!CONFIRMAR) {
    console.log(`[ensayo] Para ${persona.nombre ?? persona.usuario} (${tenant.name}), firmado por ${autor}`);
    console.log(`Asunto: ${v.limpio.asunto}`);
    console.log("──────────────────────────────────────");
    console.log(v.limpio.cuerpo);
    console.log("──────────────────────────────────────");
    console.log("ESTO LO VA A LEER UNA PERSONA Y NO SE PUEDE DESENVIAR.");
    console.log("Para mandarlo: TRIAJE_CONFIRMAR=1");
    await salir(0);
  }

  const aviso = await crearAvisoDeSalamandra({
    tenant,
    destinatario: { id: persona.id, email: persona.usuario, nombre: persona.nombre, rol: persona.rol },
    limpio: v.limpio,
    firmante: autor,
  });
  const nosotros = await Tenant.findOne({ where: { slug: "salamandra_solutions" }, attributes: ["id"] });
  await auditar({
    tenantId: nosotros?.id ?? null,
    userId: null,
    action: "buzon.aviso_escrito",
    entity: "BuzonAviso",
    entityId: aviso.id,
    before: null,
    after: { ref: referencia(aviso.numero), tenantSlug: tenant.slug, via: "terminal" },
    ip: null,
  });
  const avisado = await avisarEnSuCrm({ aviso, titulo: "Salamandra te ha escrito" });

  console.log(`✓ ${referencia(aviso.numero)} escrito a ${persona.nombre ?? persona.usuario} (${tenant.slug})`);
  console.log(avisado?.ok ? "✓ campana encendida en su CRM" : `· sin campana (${avisado?.motivo ?? "desconocido"})`);
  await salir(0);
}

console.error(`No sé qué es «${ACCION}». Usa listar, ver, marcar, responder o escribir.`);
await salir(2);
