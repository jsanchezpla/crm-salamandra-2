/**
 * _smoke-puerta-valoracion.mjs — a la primera visita solo se llega por el formulario.
 *
 * DE DÓNDE SALE ESTO
 * La valoración inicial está eximida A PROPÓSITO de las dos puertas que había:
 * no firma contrato (es lo que la define: se entra sin papeles) y no pasa por
 * caja cuando el centro la da gratis. Con la admisión global apagada —como está
 * en producción— lo único que la protegía era el «una sola vez por persona», y
 * ese se cruza por el correo que escribe quien manda la petición: un correo
 * distinto cada vez y la agenda se llena de primeras visitas.
 *
 * Lo que se fija aquí:
 *   · con la puerta encendida, sin solicitud aceptada NO se reserva la primera
 *     visita, y se le dice a dónde ir;
 *   · con la solicitud aceptada, sí;
 *   · las citas de SEGUIMIENTO no se ven afectadas — es la diferencia entera
 *     con la puerta de admisión global, que se las llevaría por delante;
 *   · apagada (el estado de fábrica) no cambia nada para nadie;
 *   · y lo que protege a los otros tres clientes con citas: un centro SIN
 *     módulo de formularios o SIN URL configurada sigue pudiendo reservar
 *     valoraciones. Cerrar sin dar salida no protege: deja la agenda muerta.
 *
 * Requiere el servidor de desarrollo levantado.
 * Uso: node --env-file=.env.local scripts/_smoke-puerta-valoracion.mjs [slug]
 */

import { Op } from "sequelize";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { invalidateTenantCache } from "../lib/tenant/tenantResolver.js";
import { signPortalSession } from "../lib/citas/portalSession.js";
import { puedePedirValoracion } from "../lib/citas/puertaValoracion.js";

const SLUG = process.argv[2] || "nutri_laura";
const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const MARCA = "smoke-pval";
const IP_PRUEBA = `203.0.113.${20 + Math.floor(Math.random() * 200)}`;
const URL_FORM = "https://ejemplo.test/primer-contacto";

let fallos = 0;
const ok = (m) => process.stdout.write(`  ✓ ${m}\n`);
const mal = (m) => { fallos++; process.stderr.write(`  ✗ ${m}\n`); };
const paso = (m) => process.stdout.write(`\n▶ ${m}\n`);
const esperar = (c, m) => (c ? ok(m) : mal(m));

const correo = (q) => `${MARCA}-${q}@example.com`;

async function main() {
  process.stdout.write(`\n═══ Smoke: la primera visita pasa por el formulario (${SLUG}) ═══\n`);

  getMasterDb();
  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) throw new Error(`no existe el tenant ${SLUG}`);

  const { models } = getTenantDb(SLUG);
  const { Booking, EventType, Form, FormSubmission } = models;

  const ajustesOriginales = JSON.parse(JSON.stringify(tenant.settings ?? {}));

  // El tipo marcado como valoración; si el centro no tiene, se marca uno para
  // la prueba y se deja como estaba al terminar.
  let valoracion = await EventType.findOne({ where: { isInitialAssessment: true, active: true } });
  let marcadoPorLaPrueba = false;
  if (!valoracion) {
    valoracion = await EventType.findOne({ where: { active: true }, order: [["order", "ASC"]] });
    await valoracion.update({ isInitialAssessment: true });
    marcadoPorLaPrueba = true;
  }
  const seguimiento = await EventType.findOne({
    where: { active: true, isInitialAssessment: false },
    order: [["order", "ASC"]],
  });
  const form = await Form.findOne({ order: [["createdAt", "ASC"]] });

  // Precio fuera: si la cita cobra, la reserva arrastra a Stripe y taparía lo
  // que se quiere medir.
  const precioValoracion = valoracion.price;
  const precioSeguimiento = seguimiento?.price ?? null;
  await valoracion.update({ price: null });
  if (seguimiento) await seguimiento.update({ price: null });

  /** Enciende o apaga la puerta y espera a que el servidor lo vea. */
  async function puerta(encendida) {
    await tenant.update({
      settings: {
        ...ajustesOriginales,
        citas: {
          ...(ajustesOriginales.citas ?? {}),
          valoracionSoloConFormulario: encendida,
          formularioUrl: URL_FORM,
          // La global se deja como estaba: lo que se mide es la de la primera
          // visita, y encender las dos no distinguiría cuál corta.
          formularioObligatorio: false,
        },
      },
    });
    invalidateTenantCache(SLUG);
    const limite = Date.now() + 75_000;
    for (;;) {
      const r = await fetch(`${BASE}/api/public/c/${SLUG}/info`);
      const d = (await r.json())?.data ?? null;
      if (d?.valoracion?.requiereFormulario === encendida) return d;
      if (Date.now() > limite) throw new Error("el servidor no ve el cambio de ajustes");
      await new Promise((s) => setTimeout(s, 1500));
    }
  }

  /**
   * Un hueco libre PARA ESE TIPO de cita.
   *
   * El tipo importa: cada uno dura lo suyo, y un hueco válido para una
   * valoración de 60 min no tiene por qué serlo para un seguimiento de 30. Se
   * pide por tipo y se avanza día a día en vez de fijar uno: con un día fijo la
   * prueba se cae sola el sábado y, peor, se cae en silencio.
   *
   * El campo es `datetime` —no `start`—; leerlo mal devuelve `undefined` y el
   * servidor contesta 422 «scheduledAt inválido», que se confunde a simple
   * vista con un rechazo de la puerta que se está midiendo.
   */
  async function buscarHueco(tipoId = valoracion.id) {
    for (let d = 2; d < 25; d++) {
      const dia = new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
      const r = await fetch(
        `${BASE}/api/public/c/${SLUG}/availability?eventTypeId=${tipoId}&date=${dia}`
      );
      const huecos = (await r.json())?.data?.slots ?? [];
      const libre = huecos.find((h) => h?.datetime);
      if (libre) return libre.datetime;
    }
    throw new Error(`no hay ni un hueco libre en 25 días para el tipo ${tipoId}`);
  }

  async function reservar(email, tipoId, hora) {
    const r = await fetch(`${BASE}/api/public/c/${SLUG}/book`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-real-ip": IP_PRUEBA,
        Authorization: `Bearer ${await signPortalSession({ email, tenant: SLUG })}`,
      },
      body: JSON.stringify({
        eventTypeId: tipoId,
        scheduledAt: hora,
        clientName: "Smoke Valoración",
        clientEmail: email,
        clientPhone: "+34600444333",
      }),
    });
    return { status: r.status, cuerpo: await r.json().catch(() => null) };
  }

  const solicitud = (email, status) =>
    FormSubmission.create({
      formId: form.id, formSlug: form.slug, formTitle: form.title,
      name: "Smoke Valoración", email, answers: [], status,
      ...(status === "accepted" ? { acceptedAt: new Date() } : {}),
    });

  try {
    paso("Con la puerta ENCENDIDA");
    const info = await puerta(true);
    esperar(info?.valoracion?.urlFormulario === URL_FORM,
      "/info anuncia la puerta y a dónde manda, para poder avisar ANTES de rellenar nada");

    const hora = await buscarHueco();
    const sinNada = await reservar(correo("sin"), valoracion.id, hora);
    esperar(sinNada.status === 403,
      `sin solicitud NO se reserva la primera visita (HTTP ${sinNada.status})`);
    esperar(sinNada.cuerpo?.urlFormulario === URL_FORM,
      "y la respuesta lleva el enlace al formulario, no solo un 'no'");
    esperar(!!sinNada.cuerpo?.codigo,
      `con un código que la pantalla entiende ('${sinNada.cuerpo?.codigo}')`);

    await solicitud(correo("pendiente"), "pending");
    const pend = await reservar(correo("pendiente"), valoracion.id, hora);
    esperar(pend.status === 403, `una solicitud sin revisar tampoco abre (HTTP ${pend.status})`);

    paso("Lo que NO debe verse afectado — es la diferencia con la puerta global");
    if (seguimiento) {
      // Se exige que reserve DE VERDAD, no solo que no sea 403: un 422 por otro
      // motivo daría verde a una prueba que no ha probado nada.
      const segu = await reservar(correo("sin"), seguimiento.id, await buscarHueco(seguimiento.id));
      esperar(segu.status === 201 || segu.status === 200,
        `el paciente de siempre reserva su SEGUIMIENTO sin formulario (HTTP ${segu.status} ${segu.cuerpo?.codigo ?? segu.cuerpo?.error ?? ""})`);
    } else {
      ok("(este centro solo tiene el tipo de valoración: no hay control que hacer)");
    }

    paso("Con la solicitud aceptada");
    await solicitud(correo("ok"), "accepted");
    const acept = await reservar(correo("ok"), valoracion.id, await buscarHueco());
    esperar(acept.status === 201 || acept.status === 200,
      `con la solicitud aceptada sí reserva (HTTP ${acept.status} ${acept.cuerpo?.codigo ?? acept.cuerpo?.error ?? ""})`);

    paso("Con la puerta APAGADA — el estado de fábrica");
    await puerta(false);
    const apagada = await reservar(correo("nadie"), valoracion.id, await buscarHueco());
    esperar(apagada.status === 201 || apagada.status === 200,
      `apagada no cambia nada para nadie (HTTP ${apagada.status} ${apagada.cuerpo?.codigo ?? apagada.cuerpo?.error ?? ""})`);

    paso("Lo que protege a los otros centros con citas");
    // Estas dos se comprueban contra el helper y no por HTTP: describen a OTROS
    // clientes (aumenta, healim), y montarles el escenario en su schema para
    // luego deshacerlo es más riesgo del que quita.
    const encendido = { settings: { citas: { valoracionSoloConFormulario: true, formularioUrl: URL_FORM } } };
    const sinModulo = await puedePedirValoracion(encendido, {
      tieneFormularios: false, FormSubmission, email: correo("sin"),
    });
    esperar(sinModulo.puede === true,
      "un centro SIN módulo de formularios sigue reservando: cerrar sin dar salida no protege");

    const sinUrl = await puedePedirValoracion(
      { settings: { citas: { valoracionSoloConFormulario: true } } },
      { tieneFormularios: true, FormSubmission, email: correo("sin") }
    );
    esperar(sinUrl.puede === true,
      "y un centro sin formulario configurado, también: el 403 sería un callejón sin salida");

    const deFabrica = await puedePedirValoracion({ settings: {} }, {
      tieneFormularios: true, FormSubmission, email: correo("sin"),
    });
    esperar(deFabrica.puede === true, "de fábrica está apagada: nadie se la encuentra sin pedirla");
  } finally {
    await Booking.destroy({ where: { clientEmail: { [Op.iLike]: `${MARCA}-%` } }, force: true });
    await FormSubmission.destroy({ where: { email: { [Op.iLike]: `${MARCA}-%` } }, force: true });
    await valoracion.update({
      price: precioValoracion,
      ...(marcadoPorLaPrueba ? { isInitialAssessment: false } : {}),
    });
    if (seguimiento) await seguimiento.update({ price: precioSeguimiento });
    await tenant.update({ settings: ajustesOriginales });
    invalidateTenantCache(SLUG);
  }

  process.stdout.write(fallos ? `\n═══ ${fallos} fallo(s) ═══\n` : `\n═══ Todo en orden ═══\n`);
  process.exit(fallos ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err.stack || err.message}\n`);
  process.exit(1);
});
