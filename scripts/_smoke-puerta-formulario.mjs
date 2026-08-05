/**
 * _smoke-puerta-formulario.mjs — sin formulario aceptado no hay cita.
 *
 * La agenda pública no miraba la bandeja de solicitudes: cualquiera con el
 * enlace del widget reservaba, hubiera pasado por el formulario o no. Con
 * retención de tarjeta de por medio eso además bloquea dinero de alguien a
 * quien la profesional no ha admitido.
 *
 * Lo que se fija aquí:
 *   · con la puerta encendida, quien no ha mandado el formulario NO reserva;
 *   · quien lo mandó y sigue sin revisar TAMPOCO;
 *   · quien fue descartado TAMPOCO;
 *   · quien tiene una solicitud aceptada SÍ;
 *   · el correo se cruza sin distinguir mayúsculas (nadie lo escribe dos veces
 *     igual), y una aceptada manda sobre una pendiente posterior;
 *   · a una petición ANÓNIMA no se le dice si un correo concreto está pendiente
 *     o no existe — sería un buscador de pacientes de la consulta;
 *   · el enlace al formulario viaja en el CUERPO, no en `details`, que el
 *     servidor borra en producción;
 *   · y el control que da sentido a todo lo anterior: con la puerta apagada,
 *     ese mismo correo sin solicitud reserva sin problema.
 *
 * Requiere el servidor de desarrollo levantado.
 * Uso: node --env-file=.env.local scripts/_smoke-puerta-formulario.mjs [slug]
 *
 * ⚠️ Esta prueba enciende y apaga la puerta, y la deja como estaba. Si en algún
 * momento se queda encendida en local (p. ej. tras encenderla a mano para mirar
 * el widget), TODAS las demás smokes de citas fallan a la vez con un
 * "no se pudo reservar" que no dice por qué: reservan por /book con correos de
 * prueba que nunca han pasado por el formulario. Antes de investigar un fallo
 * raro en esas, mirar `settings.citas.formularioObligatorio` del tenant.
 */

import { Op } from "sequelize";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { invalidateTenantCache } from "../lib/tenant/tenantResolver.js";
import { signPortalSession } from "../lib/citas/portalSession.js";

const SLUG = process.argv[2] || "nutri_laura";
const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const URL_FORM = "https://ejemplo.test/primer-contacto";
/**
 * IP propia: el límite de /book es POR IP y toda la tanda desde una sola
 * agotaría el cupo.
 *
 * Y DISTINTA EN CADA EJECUCIÓN dentro del rango de pruebas (203.0.113.0/24,
 * reservado para documentación por el RFC 5737, así que no es de nadie). Con
 * una IP fija, lanzar la prueba dos veces seguidas agotaba el cupo de la
 * anterior y todo salía 429: fallos que parecían del producto y eran de haber
 * probado mucho.
 */
const IP_PRUEBA = `203.0.113.${20 + Math.floor(Math.random() * 200)}`;

let fallos = 0;
const ok = (m) => process.stdout.write(`  ✓ ${m}\n`);
const mal = (m) => { fallos++; process.stderr.write(`  ✗ ${m}\n`); };
const paso = (m) => process.stdout.write(`\n▶ ${m}\n`);
const esperar = (c, m) => (c ? ok(m) : mal(m));

const correo = (q) => `smoke-puerta-${q}@example.com`;

async function main() {
  process.stdout.write(`\n═══ Smoke: puerta de admisión por formulario (${SLUG}) ═══\n`);

  getMasterDb();
  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) throw new Error(`no existe el tenant ${SLUG}`);

  const { models } = getTenantDb(SLUG);
  const { EventType, Booking, FormSubmission, Form } = models;

  const eventType = await EventType.findOne({ where: { active: true }, order: [["order", "ASC"]] });
  if (!eventType) throw new Error("el tenant no tiene tipos de cita activos");

  const ajustesOriginales = tenant.settings ?? {};
  const precioOriginal = eventType.price;
  // Sin precio: esta prueba es sobre la puerta, no sobre el cobro. Con precio
  // arrastraría a Stripe y taparía lo que se quiere medir.
  await eventType.update({ price: null });

  /**
   * Enciende o apaga la puerta y ESPERA a que el servidor lo vea.
   *
   * `invalidateTenantCache` vacía la caché de ESTE proceso, y el servidor de
   * desarrollo es otro: allí la config del tenant sigue cacheada hasta 60 s.
   * Sin esperar, la prueba mide la configuración anterior y da por bueno un
   * comportamiento que no existe —que es justo lo que pasó la primera vez—.
   * Se pregunta por /info, que es la misma config que usa /book.
   */
  async function puerta(encendida) {
    await tenant.update({
      settings: {
        ...ajustesOriginales,
        citas: {
          ...(ajustesOriginales.citas ?? {}),
          formularioObligatorio: encendida,
          formularioUrl: URL_FORM,
        },
      },
    });
    invalidateTenantCache(SLUG);

    const limite = Date.now() + 75_000;
    for (;;) {
      const r = await fetch(`${BASE}/api/public/c/${SLUG}/info`);
      const datos = (await r.json())?.data ?? null;
      const visto = datos?.admision?.requerida === true;
      // Devuelve lo que ha visto para que quien llama compruebe sobre ESTO y no
      // tenga que volver a preguntar (ver el comentario de más abajo).
      if (datos && visto === encendida) return datos;
      if (Date.now() > limite) {
        throw new Error(`el servidor no ha visto la puerta ${encendida ? "encendida" : "apagada"} en 75 s`);
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  /** Un hueco libre cualquiera, buscando hacia delante como el resto de smokes. */
  async function buscarHueco() {
    for (let d = 4; d <= 24; d++) {
      const dia = new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
      const r = await fetch(`${BASE}/api/public/c/${SLUG}/availability?date=${dia}&eventTypeId=${eventType.id}`);
      const huecos = (await r.json())?.data?.slots ?? [];
      if (huecos.length) return huecos[huecos.length - 1].datetime;
    }
    throw new Error("sin huecos en las próximas 3 semanas");
  }

  /**
   * Reserva CON sesión de portal firmada.
   *
   * Desde que `/book` exige identidad (puertaIdentidad, 05/08/2026) una reserva
   * anónima recibe 401 y esta prueba entera fallaba en bloque midiendo esa
   * puerta en vez de la suya. El sitio de comprobar la identidad es su propia
   * smoke; aquí se entra ya identificado para poder mirar lo que toca.
   */
  async function reservar(email, hora) {
    const r = await fetch(`${BASE}/api/public/c/${SLUG}/book`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-real-ip": IP_PRUEBA,
        Authorization: `Bearer ${await signPortalSession({ email, tenant: SLUG })}`,
      },
      body: JSON.stringify({
        eventTypeId: eventType.id,
        scheduledAt: hora,
        clientName: "Smoke Puerta",
        clientEmail: email,
        clientPhone: "+34600111222",
      }),
    });
    return { status: r.status, cuerpo: await r.json() };
  }

  async function solicitud(email, status) {
    const form = await Form.findOne({ order: [["createdAt", "ASC"]] });
    return FormSubmission.create({
      formId: form?.id ?? crypto.randomUUID(),
      formSlug: form?.slug ?? "smoke",
      formTitle: form?.title ?? "Smoke",
      name: "Smoke Puerta",
      email,
      answers: [],
      status,
      ...(status === "accepted" ? { acceptedAt: new Date() } : {}),
      ...(status === "rejected" ? { rejectedAt: new Date() } : {}),
    });
  }

  try {
    // ── Control: con la puerta apagada se reserva sin nada ──────────────────
    paso("Control — con la puerta APAGADA no hace falta formulario");
    await puerta(false);
    const sinPuerta = await reservar(correo("control"), await buscarHueco());
    esperar(
      sinPuerta.status === 201,
      `un desconocido reserva cuando la puerta está apagada (HTTP ${sinPuerta.status})`
    );

    // ── La puerta cierra ────────────────────────────────────────────────────
    paso("Con la puerta ENCENDIDA");
    await puerta(true);

    const desconocido = await reservar(correo("nadie"), await buscarHueco());
    esperar(desconocido.status === 403, `sin solicitud no se reserva (HTTP ${desconocido.status})`);
    esperar(
      desconocido.cuerpo?.codigo === "ADMISION_REQUERIDA",
      `se le dice qué le falta con un código que la pantalla entiende ('${desconocido.cuerpo?.codigo}')`
    );
    esperar(
      desconocido.cuerpo?.urlFormulario === URL_FORM,
      "y a dónde ir: el enlace al formulario viene en la respuesta"
    );
    // Lo que de verdad se está midiendo: que NO viaje dentro de `details`, que
    // apiResponse borra cuando NODE_ENV === "production".
    esperar(
      desconocido.cuerpo?.details === undefined,
      "el enlace va en el cuerpo, no en `details` (que en producción se borra)"
    );

    await solicitud(correo("pendiente"), "pending");
    const pendiente = await reservar(correo("pendiente"), await buscarHueco());
    esperar(pendiente.status === 403, `una solicitud sin revisar no abre la puerta (HTTP ${pendiente.status})`);
    esperar(
      pendiente.cuerpo?.codigo === "ADMISION_PENDIENTE",
      "a quien ha entrado con su sesión SÍ se le dice que está en revisión"
    );

    // La otra mitad de lo mismo: a quien NO ha entrado no se le contesta nada
    // sobre ese correo. Antes esto se medía pidiendo que un pendiente y un
    // desconocido fueran indistinguibles; hoy lo tapa la puerta de identidad,
    // que corta ANTES de mirar la bandeja. Se afirma explícitamente porque es
    // lo que sostiene que el mensaje de arriba no sea una fuga.
    const fisgon = await fetch(`${BASE}/api/public/c/${SLUG}/book`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-real-ip": IP_PRUEBA },
      body: JSON.stringify({
        eventTypeId: eventType.id,
        scheduledAt: await buscarHueco(),
        clientName: "Fisgón",
        clientEmail: correo("pendiente"),
        clientPhone: "+34600111222",
      }),
    });
    esperar(
      fisgon.status === 401,
      `sin sesión no se contesta nada sobre ese correo (HTTP ${fisgon.status})`
    );

    await solicitud(correo("descartado"), "rejected");
    const descartado = await reservar(correo("descartado"), await buscarHueco());
    esperar(descartado.status === 403, `una solicitud descartada no abre la puerta (HTTP ${descartado.status})`);

    // ── La puerta abre ──────────────────────────────────────────────────────
    paso("Quien tiene la solicitud aceptada sí reserva");
    await solicitud(correo("aceptado"), "accepted");
    const aceptado = await reservar(correo("aceptado"), await buscarHueco());
    esperar(aceptado.status === 201, `con la solicitud aceptada se reserva (HTTP ${aceptado.status})`);

    paso("Detalles que se rompen solos");
    // Mayúsculas: el formulario guarda lo que la persona teclee.
    await solicitud(`SMOKE-PUERTA-MAYUS@Example.COM`, "accepted");
    const mayus = await reservar(correo("mayus"), await buscarHueco());
    esperar(mayus.status === 201, `el correo se cruza sin distinguir mayúsculas (HTTP ${mayus.status})`);

    // Aceptada + otra pendiente después: sigue siendo paciente.
    await solicitud(correo("aceptado"), "pending");
    const reincidente = await reservar(correo("aceptado"), await buscarHueco());
    esperar(
      reincidente.status === 201,
      `mandar otra solicitud después no devuelve a la cola a quien ya fue admitido (HTTP ${reincidente.status})`
    );

    // ── El aviso por delante ────────────────────────────────────────────────
    paso("El widget se entera antes de que la persona rellene nada");
    const info = await (await fetch(`${BASE}/api/public/c/${SLUG}/info`)).json();
    esperar(info?.data?.admision?.requerida === true, "/info anuncia que hay puerta");
    esperar(info?.data?.admision?.urlFormulario === URL_FORM, "/info trae el enlace del formulario");

    // Se comprueba con lo que DEVUELVE el sondeo, no con una petición nueva:
    // entre las del sondeo y las reservas, `/info` se acaba topando por límite
    // de peticiones y devuelve un cuerpo sin `data`. Con las dos aserciones
    // usando `?.`, eso salía como «la puerta sigue encendida» —un fallo que no
    // era del producto sino de haber preguntado una vez de más.
    const infoApagada = await puerta(false);
    esperar(
      infoApagada?.admision?.requerida === false,
      "y con la puerta apagada dice que no la hay"
    );
    esperar(
      infoApagada?.data?.admision?.urlFormulario === undefined,
      "sin filtrar la dirección cuando no aplica"
    );
  } finally {
    // ── Limpieza ────────────────────────────────────────────────────────────
    await Booking.destroy({ where: { clientEmail: { [Op.iLike]: "smoke-puerta-%" } }, force: true });
    await FormSubmission.destroy({ where: { email: { [Op.iLike]: "smoke-puerta-%" } }, force: true });
    await eventType.update({ price: precioOriginal });
    await tenant.update({ settings: ajustesOriginales });
    invalidateTenantCache(SLUG);
  }

  process.stdout.write(
    fallos ? `\n═══ ${fallos} fallo(s) ═══\n` : `\n═══ Todo en orden ═══\n`
  );
  process.exit(fallos ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err.stack || err.message}\n`);
  process.exit(1);
});
