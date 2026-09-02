// @prueba ligera — nombra a Sequelize solo dentro de un comentario; no toca la base de datos.
/**
 * _smoke-buzon.mjs — las reglas del buzón, fijadas.
 *
 * Se ejecuta SIN base de datos y SIN servidor:
 *
 *   node scripts/_smoke-buzon.mjs
 *
 * POR QUÉ EXISTE: de todo lo que hace el buzón, hay una función que si falla
 * falla en silencio y hacia fuera — `serializarAviso(..., { para: "cliente" })`.
 * Si algún día deja de recortar las notas internas, nadie ve un error: el
 * cliente ve lo que escribimos de él y nos enteramos por su llamada. Eso no se
 * comprueba a ojo, se fija aquí.
 */

import {
  referencia,
  limpiarPantalla,
  limpiarContexto,
  validarAvisoNuevo,
  validarMensaje,
  validarCambio,
  estadoActual,
  estadoTrasMensaje,
  serializarAviso,
  tieneRespuestaSinVer,
  tienePendienteNuestro,
  LIMITES,
} from "../lib/buzon/buzon.js";

let fallos = 0;
let pasadas = 0;

function comprobar(que, condicion, detalle = "") {
  if (condicion) {
    pasadas++;
    process.stdout.write(`  ✓ ${que}\n`);
  } else {
    fallos++;
    process.stdout.write(`  ✗ ${que}${detalle ? ` — ${detalle}` : ""}\n`);
  }
}

process.stdout.write("\n▶ La referencia que se dice por teléfono\n");
comprobar("se rellena con ceros", referencia(42) === "AV-0042", referencia(42));
comprobar("aguanta números largos", referencia(12345) === "AV-12345");
comprobar("sin número, no inventa uno", referencia(null) === "AV-????");

process.stdout.write("\n▶ La pantalla desde la que escribió\n");
comprobar("se guarda el camino", limpiarPantalla("/clientes/lista-espera") === "/clientes/lista-espera");
comprobar(
  "LA QUERY SE TIRA (ahí van nombres de personas)",
  limpiarPantalla("/clientes?q=Juan+Pérez") === "/clientes",
  limpiarPantalla("/clientes?q=Juan+Pérez")
);
comprobar("el ancla también", limpiarPantalla("/citas#hoy") === "/citas");
comprobar("una URL de fuera no entra", limpiarPantalla("https://otro-sitio.com/x") === null);
comprobar("vacío es nulo, no cadena vacía", limpiarPantalla("   ") === null);

process.stdout.write("\n▶ El contexto del navegador es una lista CERRADA\n");
{
  const c = limpiarContexto({ navegador: "Firefox", ventana: "1280x720", sesion: { token: "secreto" } });
  comprobar("pasa lo que se espera", c.navegador === "Firefox" && c.ventana === "1280x720");
  comprobar("lo que no está en la lista NO entra", c.sesion === undefined, JSON.stringify(c));
  comprobar("un contexto que no es objeto no rompe", JSON.stringify(limpiarContexto("x")) === "{}");
}

process.stdout.write("\n▶ Lo que NO se puede mandar, y CON QUÉ NÚMERO se dice\n");
{
  const corto = validarAvisoNuevo({ asunto: "ab", cuerpo: "esto es suficientemente largo" });
  comprobar("un asunto de dos letras", !corto.ok && corto.status === 422, corto.error);
  comprobar(
    "dice el mínimo del asunto y lo que lleva",
    corto.error.includes(String(LIMITES.asuntoMinimo)) && corto.error.includes("2"),
    corto.error
  );

  // El caso exacto de Jorge (13/08/2026): «prueba», seis letras. El mensaje de
  // antes decía «cuéntanos un poco más» y ya está, así que no había forma de
  // saber si faltaban dos letras o dos frases.
  const flojo = validarAvisoNuevo({ asunto: "PRUEBA del buzón", cuerpo: "prueba" });
  comprobar("un cuerpo de seis letras", !flojo.ok && flojo.status === 422, flojo.error);
  comprobar(
    "DICE EL MÍNIMO EXACTO y cuánto lleva",
    flojo.error.includes(String(LIMITES.cuerpoMinimo)) && flojo.error.includes("6"),
    flojo.error
  );

  const vacio = validarMensaje({ cuerpo: "   " });
  comprobar("un mensaje en blanco", !vacio.ok && vacio.status === 422, vacio.error);
}

process.stdout.write("\n▶ Lo que SÍ se manda\n");
{
  const r = validarAvisoNuevo({
    asunto: "  No se abre la ficha  ",
    cuerpo: "  Al pulsar en una familia de la lista no pasa nada.  ",
    tipo: "inventado",
    bloquea: "true",
    pantalla: "/clientes?q=Ana",
  });
  comprobar("entra", r.ok, r.error);
  if (r.ok) {
    comprobar("sin espacios de sobra", r.limpio.asunto === "No se abre la ficha");
    comprobar("un tipo que no existe cae en 'error'", r.limpio.tipo === "error", r.limpio.tipo);
    comprobar("'true' de un formulario es true", r.limpio.bloquea === true);
    comprobar("la pantalla ya viene limpia", r.limpio.pantalla === "/clientes");
  }
  const topes = validarAvisoNuevo({ asunto: "x".repeat(500), cuerpo: "y".repeat(9000) });
  comprobar(
    "lo que se pasa de largo se corta, no se rechaza",
    topes.ok && topes.limpio.asunto.length === LIMITES.asunto && topes.limpio.cuerpo.length === LIMITES.cuerpo
  );
}

process.stdout.write("\n▶ Lo que cambiamos NOSOTROS\n");
{
  const malEstado = validarCambio({ estado: "cerrado_del_todo" });
  comprobar("un estado inventado", !malEstado.ok && malEstado.status === 422, malEstado.error);

  const malAlguien = validarCambio({ asignadoA: "pepe" });
  comprobar("alguien que no somos", !malAlguien.ok, malAlguien.error);

  const nadie = validarCambio({ asignadoA: null });
  comprobar("desasignar SÍ vale", nadie.ok && nadie.limpio.asignadoA === null);

  const nada = validarCambio({});
  comprobar("un PATCH vacío se rechaza", !nada.ok, nada.error);

  const parcial = validarCambio({ estado: "enviado" });
  comprobar(
    "un PATCH parcial no pisa lo que no menciona",
    parcial.ok && parcial.limpio.prioridad === undefined && parcial.limpio.asignadoA === undefined
  );
}

process.stdout.write("\n▶ El estado dice si está en el Registro, no de quién es la pelota (02/09/2026)\n");
comprobar("contestar nosotros no mueve un nuevo", estadoTrasMensaje("nuevo", "salamandra") === "nuevo");
comprobar("contestar nosotros no saca nada del Registro", estadoTrasMensaje("enviado", "salamandra") === "enviado");
comprobar("añadir datos a uno nuevo no lo mueve", estadoTrasMensaje("nuevo", "cliente") === "nuevo");
comprobar("escribir él sobre uno enviado lo deja enviado (la campana ya avisa)", estadoTrasMensaje("enviado", "cliente") === "enviado");
comprobar("un estado que no existe vuelve al principio", estadoTrasMensaje("archivado", "cliente") === "nuevo");
comprobar(
  "los tres nombres viejos se leen con el de hoy",
  estadoActual("en_curso") === "enviado" && estadoActual("esperando") === "nuevo" && estadoActual("resuelto") === "enviado"
);
comprobar("«resuelto» ya no se puede escribir: el Buzón acaba en el Registro", !validarCambio({ estado: "resuelto" }).ok);

process.stdout.write("\n▶ «Te hemos contestado y no lo has abierto»\n");
{
  // Esta regla está escrita DOS veces: aquí en JavaScript (marca la fila en la
  // lista del cliente) y en SQL dentro de `buzonStore.whereSinVer()` (cuenta el
  // punto del menú y saca el aviso de la portada). No se pueden unificar —una
  // corre en Postgres y la otra en el navegador—, así que lo único que impide
  // que se separen es esta lista de casos. Si alguien toca una de las dos, que
  // sea mirando estos cinco.
  const t = (s) => new Date(s);

  comprobar(
    "sin contestar, no hay nada que leer",
    tieneRespuestaSinVer({ respondidoAt: null, vistoClienteAt: null }) === false
  );
  comprobar(
    "contestado y nunca abierto → sin leer",
    tieneRespuestaSinVer({ respondidoAt: t("2026-08-13T11:00:00Z"), vistoClienteAt: null }) === true
  );
  comprobar(
    "lo abrió DESPUÉS de contestarle → leído",
    tieneRespuestaSinVer({
      respondidoAt: t("2026-08-13T11:00:00Z"),
      vistoClienteAt: t("2026-08-13T11:05:00Z"),
    }) === false
  );
  // El caso que obliga a comparar fechas en vez de guardar un booleano «leído»:
  // le contestamos por segunda vez a un aviso que ya había abierto.
  comprobar(
    "SEGUNDA respuesta a un hilo ya abierto → vuelve a estar sin leer",
    tieneRespuestaSinVer({
      respondidoAt: t("2026-08-13T18:00:00Z"),
      vistoClienteAt: t("2026-08-13T11:05:00Z"),
    }) === true
  );
  comprobar(
    "abierto pero sin contestar todavía no cuenta",
    tieneRespuestaSinVer({ respondidoAt: null, vistoClienteAt: t("2026-08-13T09:00:00Z") }) === false
  );
  comprobar("una fila que no existe no revienta", tieneRespuestaSinVer(null) === false);
}

process.stdout.write("\n▶ «Nos ha escrito y no lo hemos mirado» (la campana del panel)\n");
{
  // El espejo de lo de arriba, y con la misma trampa: es la regla que decide si
  // la campana del panel enseña un número. Su gemela en SQL es
  // `buzonStore.wherePendienteNuestro()`.
  const t = (s) => new Date(s);

  comprobar(
    "un aviso recién creado nos espera",
    tienePendienteNuestro({ clienteEscribioAt: t("2026-08-13T09:00:00Z"), leidoAt: null }) === true
  );
  comprobar(
    "abierto después de que escribiera → mirado",
    tienePendienteNuestro({
      clienteEscribioAt: t("2026-08-13T09:00:00Z"),
      leidoAt: t("2026-08-13T09:30:00Z"),
    }) === false
  );
  // ⚠️ EL CASO QUE ANTES NO SE VEÍA. `leidoAt` significaba «la primera vez que
  // lo abrimos» y solo se escribía una vez, así que el cliente podía insistir
  // por tercera vez en un hilo ya visto sin encender absolutamente nada.
  comprobar(
    "VUELVE A ESCRIBIR en un hilo ya abierto → vuelve a esperarnos",
    tienePendienteNuestro({
      clienteEscribioAt: t("2026-08-13T18:00:00Z"),
      leidoAt: t("2026-08-13T09:30:00Z"),
    }) === true
  );
  comprobar(
    "sin que él haya escrito, no hay nada pendiente",
    tienePendienteNuestro({ clienteEscribioAt: null, leidoAt: null }) === false
  );
  comprobar("una fila que no existe no revienta", tienePendienteNuestro(null) === false);

  // Las dos reglas son independientes: que él tenga algo sin leer no nos pone a
  // nosotros nada pendiente, ni al revés. Si algún día alguien las funde en una,
  // esto lo caza.
  const contestadoYVisto = {
    respondidoAt: t("2026-08-13T12:00:00Z"),
    vistoClienteAt: null,
    clienteEscribioAt: t("2026-08-13T09:00:00Z"),
    leidoAt: t("2026-08-13T11:00:00Z"),
  };
  comprobar(
    "le hemos contestado: él lo tiene sin leer y nosotros no tenemos nada",
    tieneRespuestaSinVer(contestadoYVisto) === true &&
      tienePendienteNuestro(contestadoYVisto) === false
  );
}

process.stdout.write("\n▶ Lo que el CLIENTE no puede ver\n");
{
  const fila = {
    id: "a1",
    numero: 7,
    tipo: "error",
    asunto: "No va",
    cuerpo: "eso",
    estado: "enviado",
    prioridad: "baja",
    asignadoA: "rodrigo",
    tenantSlug: "aumenta",
    usuarioEmail: "quien@aumenta.es",
    createdAt: new Date("2026-08-13T09:00:00Z"),
    mensajes: [
      { id: "m2", autorTipo: "salamandra", cuerpo: "Ya lo miramos", interno: false, createdAt: new Date("2026-08-13T11:00:00Z") },
      { id: "m1", autorTipo: "salamandra", cuerpo: "Es el bug de julio, otra vez", interno: true, createdAt: new Date("2026-08-13T10:00:00Z") },
    ],
    adjuntos: [
      { id: "ad1", nombre: "captura.png", mensajeId: null, subidoPor: "cliente" },
      { id: "ad2", nombre: "traza-interna.txt", mensajeId: "m1", subidoPor: "salamandra" },
    ],
  };

  const suyo = serializarAviso(fila, { para: "cliente" });
  comprobar("LA NOTA INTERNA NO SALE", suyo.mensajes.length === 1 && suyo.mensajes[0].id === "m2", JSON.stringify(suyo.mensajes.map((m) => m.id)));
  comprobar("EL ADJUNTO DE LA NOTA INTERNA TAMPOCO", suyo.adjuntos.length === 1 && suyo.adjuntos[0].id === "ad1", JSON.stringify(suyo.adjuntos.map((a) => a.id)));
  comprobar("no ve la prioridad", suyo.prioridad === undefined);
  comprobar("no ve a quién está asignado", suyo.asignadoA === undefined);
  comprobar("no ve el correo del remitente", suyo.usuarioEmail === undefined);
  comprobar("sí ve su referencia y su estado", suyo.ref === "AV-0007" && suyo.estadoLabel === "Enviado al registro");

  const nuestro = serializarAviso(fila, { para: "salamandra" });
  comprobar("nosotros sí vemos las dos líneas", nuestro.mensajes.length === 2);
  // `sinLeer` va en la parte común: al cliente le pinta el «Nueva respuesta» y a
  // nosotros nos dice si ya ha leído lo que le contestamos.
  comprobar(
    "los DOS lados llevan si está sin leer",
    suyo.sinLeer === false && nuestro.sinLeer === false,
    `${suyo.sinLeer} / ${nuestro.sinLeer}`
  );
  const contestado = serializarAviso(
    { ...fila, respondidoAt: new Date("2026-08-13T11:00:00Z"), vistoClienteAt: null },
    { para: "cliente" }
  );
  comprobar("contestado y sin abrir sale marcado", contestado.sinLeer === true);
  comprobar("y el hilo va en orden", nuestro.mensajes[0].id === "m1" && nuestro.mensajes[1].id === "m2");
  comprobar("y de quién es", nuestro.asignadoA === "rodrigo" && nuestro.tenantSlug === "aumenta");
}

process.stdout.write("\n▶ El correo, con la fila CRUDA de la base\n");
{
  // Se rompió en producción el 13/08/2026: a la plantilla le llega a veces la
  // fila de Sequelize, que tiene `numero` pero NO `ref` —eso solo existe en el
  // objeto ya serializado—, y salió un correo con el asunto «Te hemos
  // contestado · undefined». No dio ningún error: se envió tal cual. Aquella
  // plantilla ya no existe (al cliente se le avisa dentro de su CRM, no por
  // correo), pero la trampa sigue viva en la que queda, así que se fija con la
  // fila cruda a propósito.
  const { avisoParaNosotros } = await import("../lib/email/templates/buzon/avisoNuevo.js");
  const filaCruda = { numero: 7, asunto: "No va", cuerpo: "eso", tipo: "error", tenantSlug: "aumenta" };

  const paraNosotros = avisoParaNosotros({ aviso: filaCruda, url: "https://x/admin/buzon" });
  comprobar("lleva la referencia sin `ref` en la fila", paraNosotros.subject.startsWith("AV-0007"), paraNosotros.subject);
  comprobar(
    "nunca sale la palabra undefined",
    !/undefined/.test(paraNosotros.subject + paraNosotros.text),
    paraNosotros.subject
  );
}

process.stdout.write(`\n${fallos === 0 ? "✓" : "✗"} ${pasadas} bien · ${fallos} mal\n\n`);
process.exit(fallos === 0 ? 0 : 1);
