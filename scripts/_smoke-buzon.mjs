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
  estadoTrasMensaje,
  serializarAviso,
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

process.stdout.write("\n▶ Lo que NO se puede mandar\n");
{
  const corto = validarAvisoNuevo({ asunto: "ab", cuerpo: "esto es suficientemente largo" });
  comprobar("un asunto de dos letras", !corto.ok && corto.status === 422, corto.error);

  const flojo = validarAvisoNuevo({ asunto: "No va el calendario", cuerpo: "no va" });
  comprobar("un cuerpo de cuatro letras", !flojo.ok && flojo.status === 422, flojo.error);

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

  const parcial = validarCambio({ estado: "en_curso" });
  comprobar(
    "un PATCH parcial no pisa lo que no menciona",
    parcial.ok && parcial.limpio.prioridad === undefined && parcial.limpio.asignadoA === undefined
  );
}

process.stdout.write("\n▶ La pelota cambia de tejado\n");
comprobar("contestamos → espera al cliente", estadoTrasMensaje("nuevo", "salamandra") === "esperando");
comprobar("escribe él → vuelve a ser cosa nuestra", estadoTrasMensaje("esperando", "cliente") === "en_curso");
comprobar(
  "SIGUE PASANDO reabre un aviso resuelto",
  estadoTrasMensaje("resuelto", "cliente") === "en_curso",
  estadoTrasMensaje("resuelto", "cliente")
);
comprobar("añadir datos a uno nuevo no lo mueve", estadoTrasMensaje("nuevo", "cliente") === "nuevo");
comprobar("un resuelto no se reabre solo por nosotros", estadoTrasMensaje("resuelto", "salamandra") === "resuelto");

process.stdout.write("\n▶ Lo que el CLIENTE no puede ver\n");
{
  const fila = {
    id: "a1",
    numero: 7,
    tipo: "error",
    asunto: "No va",
    cuerpo: "eso",
    estado: "en_curso",
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
  comprobar("sí ve su referencia y su estado", suyo.ref === "AV-0007" && suyo.estadoLabel === "En curso");

  const nuestro = serializarAviso(fila, { para: "salamandra" });
  comprobar("nosotros sí vemos las dos líneas", nuestro.mensajes.length === 2);
  comprobar("y el hilo va en orden", nuestro.mensajes[0].id === "m1" && nuestro.mensajes[1].id === "m2");
  comprobar("y de quién es", nuestro.asignadoA === "rodrigo" && nuestro.tenantSlug === "aumenta");
}

process.stdout.write("\n▶ El asunto del correo, con la fila CRUDA de la base\n");
{
  // Se rompió en producción el 13/08/2026: a la plantilla del correo al cliente
  // le llega la fila de Sequelize, que tiene `numero` pero NO `ref` —eso solo
  // existe en el objeto serializado—, y salió un correo con el asunto «Te hemos
  // contestado · undefined». No dio ningún error: se envió tal cual.
  const { avisoParaNosotros, respuestaParaElCliente } = await import(
    "../lib/email/templates/buzon/avisoNuevo.js"
  );
  const filaCruda = { numero: 7, asunto: "No va", cuerpo: "eso", tipo: "error", tenantSlug: "aumenta" };

  const paraNosotros = avisoParaNosotros({ aviso: filaCruda, url: "https://x/admin/buzon" });
  comprobar("el nuestro lleva la referencia", paraNosotros.subject.startsWith("AV-0007"), paraNosotros.subject);

  const paraEl = respuestaParaElCliente({ aviso: filaCruda, mensaje: { cuerpo: "ya está" } });
  comprobar("y el suyo TAMBIÉN, sin `ref` en la fila", paraEl.subject === "Te hemos contestado · AV-0007", paraEl.subject);
  comprobar("nunca sale la palabra undefined", !/undefined/.test(paraEl.subject + paraEl.text), paraEl.subject);
}

process.stdout.write(`\n${fallos === 0 ? "✓" : "✗"} ${pasadas} bien · ${fallos} mal\n\n`);
process.exit(fallos === 0 ? 0 : 1);
