/**
 * _smoke-webhook-whatsapp.mjs — la puerta de entrada de WhatsApp, cerrada.
 *
 * POR QUÉ EXISTE. `/api/webhooks/whatsapp/[tenantSlug]` es el único sitio del
 * CRM donde alguien de fuera, SIN sesión y sin cookie, escribe filas en el
 * schema de un cliente. Todo lo que puede salir mal aquí sale mal en silencio:
 * no hay pantalla que se rompa ni un 500 que mirar, solo mensajes de pacientes
 * que aparecen donde no debían o que no aparecen en absoluto. Las cuatro
 * propiedades que fija este smoke son exactamente esas:
 *
 *   1. **La firma es la única llave.** Sin `X-Hub-Signature-256` calculada con
 *      NUESTRO App Secret no entra nada. Y se calcula sobre los BYTES EXACTOS
 *      del cuerpo: si alguien mete un `JSON.parse` antes de verificar, la firma
 *      del mismo JSON reformateado pasaría a valer, y aquí se comprueba que no.
 *
 *   2. **El tenant lo decide la URL, no el payload.** Siendo Tech Provider
 *      todas las cuentas cuelgan de la misma app de Meta, así que el schema
 *      destino sale del slug de la ruta y de nada más. El token de verificación
 *      de un cliente no abre la puerta de otro, y un mensaje entregado en la
 *      URL de uno no aparece en la tabla del otro. Es el mismo agujero que se
 *      corrigió el 26/07/2026 en los webhooks de TutorLMS, donde el tenant
 *      destino viajaba en una cabecera que controlaba quien llamaba.
 *
 *   3. **Meta entrega "al menos una vez".** Reintenta todo lo que no reciba un
 *      200, así que el mismo mensaje llega dos y tres veces. Sin idempotencia
 *      por `wamId` el hilo de un paciente saldría con cada frase repetida.
 *
 *   4. **De quién es cada mensaje.** Se empareja por los últimos 9 dígitos
 *      contra el teléfono principal y los secundarios; y si casan DOS fichas se
 *      deja sin asignar, que es lo correcto: un mensaje sin dueño se ve en la
 *      bandeja y se arregla, uno colgado de la ficha equivocada es una fuga de
 *      datos entre pacientes.
 *
 * De paso quedan fijados los acuses de entrega, que son lo único que explica
 * por qué un recordatorio no llegó — incluido que un `read` no retroceda a
 * `delivered` porque un reintento llegue tarde y desordenado.
 *
 * Requiere el servidor de desarrollo levantado, el tenant `sandbox`
 * (scripts/seed-sandbox.js), la tabla `whatsapp_messages`
 * (scripts/migrate-whatsapp-messages.js) y las dos variables del webhook en
 * `.env.local` — valores inventados: aquí no hay ninguna cuenta de Meta detrás,
 * el smoke firma los payloads igual que los firmaría Meta.
 *
 * Crea lo que necesita y lo borra al terminar.
 *
 * Uso:  node --env-file=.env.local scripts/_smoke-webhook-whatsapp.mjs [slug] [otroSlug]
 */

import { createHmac } from "node:crypto";
import { Op } from "sequelize";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";
import { verifyTokenFor } from "../lib/whatsapp/webhookAuth.js";

const SLUG = process.argv[2] || "sandbox";
const OTRO = process.argv[3] || "demo_clinica";
const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3000";

let fallos = 0;
const ok = (m) => process.stdout.write(`  ✓ ${m}\n`);
const mal = (m) => { fallos++; process.stderr.write(`  ✗ ${m}\n`); };
const paso = (m) => process.stdout.write(`\n▶ ${m}\n`);
const esperar = (c, m, detalle = "") => (c ? ok(m) : mal(`${m}${detalle ? ` — ${detalle}` : ""}`));

const MARCA = `smoke-wa-${Date.now()}`;
const wam = (n) => `wamid.${MARCA}-${n}`;

// El número del CENTRO. Es lo que Meta manda en `metadata.display_phone_number`
// y lo que distingue, en el historial, lo que dijo el negocio de lo que dijo el
// paciente.
const NUMERO_CENTRO = "34911223344";

// Teléfonos de los pacientes de prueba. Nueve dígitos nacionales (7XXXXXXXX),
// derivados del reloj para no chocar con ninguna ficha real del sandbox.
const raiz = String(Date.now()).slice(-8);
const tel = (n) => `347${raiz.slice(0, 7)}${n}`;
const TEL_PACIENTE = tel(1);
const TEL_SECUNDARIO = tel(2);
const TEL_GEMELAS = tel(3);
const TEL_DESCONOCIDO = tel(4);

/** El mismo teléfono como lo escribe una persona en una ficha, con su formato. */
const comoLoEscribeUnHumano = (t) => `+${t.slice(0, 2)} ${t.slice(2, 5)} ${t.slice(5, 8)} ${t.slice(8)}`;

// Una marca de tiempo VIEJA a propósito: lo que se guarda tiene que ser la hora
// de Meta y no la nuestra. Si se guardara `now`, el historial de 180 días de la
// coexistencia saldría entero con fecha de hoy y el hilo, del revés.
const HACE_DOS_HORAS = Math.floor((Date.now() - 2 * 3_600_000) / 1000);

// ── Construir lo que manda Meta ─────────────────────────────────────────────

/** Un evento del webhook, con la envoltura que pone Meta. */
function evento(value) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "0",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: NUMERO_CENTRO, phone_number_id: "0" },
              ...value,
            },
          },
        ],
      },
    ],
  };
}

const mensajeTexto = (id, de, texto, extra = {}) => ({
  id,
  from: de,
  timestamp: String(HACE_DOS_HORAS),
  type: "text",
  text: { body: texto },
  ...extra,
});

const firmar = (cuerpo) =>
  `sha256=${createHmac("sha256", process.env.WHATSAPP_APP_SECRET).update(cuerpo, "utf8").digest("hex")}`;

/**
 * Entrega un evento como lo entregaría Meta.
 *
 * `firmaDe` es la cadena sobre la que se calcula la firma; por defecto el
 * cuerpo que se manda, que es el caso bueno. Pasarle otra cosa es cómo se
 * simula una firma que no cuadra. `sinFirma` quita la cabecera entera.
 */
async function entregar(slug, payload, { firmaDe = null, sinFirma = false } = {}) {
  const cuerpo = JSON.stringify(payload);
  const headers = { "Content-Type": "application/json" };
  if (!sinFirma) headers["x-hub-signature-256"] = firmar(firmaDe ?? cuerpo);

  const r = await fetch(`${BASE}/api/webhooks/whatsapp/${slug}`, { method: "POST", headers, body: cuerpo });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
}

/** El apretón de manos del alta. Devuelve el cuerpo CRUDO, que es lo que importa. */
async function verificarUrl(slug, token, { mode = "subscribe", reto = "1158201444" } = {}) {
  const q = new URLSearchParams({ "hub.mode": mode, "hub.verify_token": token ?? "", "hub.challenge": reto });
  const r = await fetch(`${BASE}/api/webhooks/whatsapp/${slug}?${q}`, { cache: "no-store" });
  return { status: r.status, cuerpo: await r.text(), tipo: r.headers.get("content-type") || "", reto };
}

async function main() {
  process.stdout.write(`\n═══ Smoke: el webhook de WhatsApp (${SLUG}) ═══\n`);

  if (!process.env.WHATSAPP_APP_SECRET || !process.env.WHATSAPP_WEBHOOK_SECRET) {
    throw new Error("faltan WHATSAPP_APP_SECRET y/o WHATSAPP_WEBHOOK_SECRET en .env.local");
  }

  getMasterDb();
  const { Tenant } = getMasterModels();
  for (const s of [SLUG, OTRO]) {
    const t = await Tenant.findOne({ where: { slug: s, status: "active" } });
    if (!t) throw new Error(`no existe el tenant activo "${s}" (créalo con scripts/seed-sandbox.js)`);
  }

  const { models } = getTenantDb(SLUG);
  const { WhatsappMessage, Client, ClientContactMethod } = models;
  if (!WhatsappMessage) {
    throw new Error(`${SLUG} no tiene la tabla del hilo (falta scripts/migrate-whatsapp-messages.js)`);
  }
  const { models: modelosOtro } = getTenantDb(OTRO);

  const fila = (n) => WhatsappMessage.findOne({ where: { wamId: wam(n) } });

  // Las fichas contra las que se empareja. Los teléfonos van escritos como los
  // escribe una persona —con prefijo y espacios— porque `Client.phone` es texto
  // libre y la normalización es parte de lo que se está probando.
  const paciente = await Client.create({
    type: "individual",
    name: `Paciente WhatsApp (${MARCA})`,
    phone: comoLoEscribeUnHumano(TEL_PACIENTE),
  });
  const conSecundario = await Client.create({
    type: "individual",
    name: `Con teléfono secundario (${MARCA})`,
  });
  await ClientContactMethod.create({
    clientId: conSecundario.id,
    kind: "phone",
    value: comoLoEscribeUnHumano(TEL_SECUNDARIO),
    label: "Móvil de la madre",
  });
  const gemelas = await Promise.all(
    ["A", "B"].map((x) =>
      Client.create({
        type: "individual",
        name: `Número compartido ${x} (${MARCA})`,
        phone: comoLoEscribeUnHumano(TEL_GEMELAS),
      })
    )
  );

  try {
    // ── 1. El apretón de manos del alta ─────────────────────────────────────
    paso("Dar de alta la URL en Meta");
    {
      const bien = await verificarUrl(SLUG, verifyTokenFor(SLUG));
      esperar(bien.status === 200, "con el token del cliente, 200", String(bien.status));
      esperar(bien.cuerpo === bien.reto, "y devuelve el challenge tal cual", JSON.stringify(bien.cuerpo));
      // Envolverlo en JSON es el fallo clásico: Meta lo da por malo y la URL se
      // queda sin verificar, sin decir por qué.
      esperar(!bien.cuerpo.trim().startsWith("{"), "en texto plano, NO en JSON", bien.cuerpo.slice(0, 60));
      esperar(bien.tipo.includes("text/plain"), "con content-type de texto", bien.tipo);

      const inventado = await verificarUrl(SLUG, "token-que-me-acabo-de-inventar");
      esperar(inventado.status === 403, "con un token inventado, 403", String(inventado.status));

      // EL IMPORTANTE: el token de un cliente no abre la puerta de otro.
      const ajeno = await verificarUrl(SLUG, verifyTokenFor(OTRO));
      esperar(ajeno.status === 403, `con el token de ${OTRO}, 403`, String(ajeno.status));

      const sinModo = await verificarUrl(SLUG, verifyTokenFor(SLUG), { mode: "unsubscribe" });
      esperar(sinModo.status === 403, "sin hub.mode=subscribe, 403", String(sinModo.status));

      const fantasma = await verificarUrl("tenant_que_no_existe", verifyTokenFor(SLUG));
      esperar(fantasma.status === 404, "y un cliente que no existe, 404", String(fantasma.status));
    }

    // ── 2. La firma ─────────────────────────────────────────────────────────
    paso("Sin la firma de Meta no entra nada");
    {
      const conMensaje = evento({ messages: [mensajeTexto(wam("rechazado"), TEL_PACIENTE, "no debería entrar")] });

      const sin = await entregar(SLUG, conMensaje, { sinFirma: true });
      esperar(sin.status === 401, "sin cabecera de firma, 401", String(sin.status));

      const mala = await entregar(SLUG, conMensaje, { firmaDe: "otra cosa cualquiera" });
      esperar(mala.status === 401, "con una firma que no cuadra, 401", String(mala.status));

      // La firma va sobre los BYTES EXACTOS. Este cuerpo dice LO MISMO pero con
      // otro formato: si alguien parsea el JSON antes de verificar, esto pasaría
      // a colar. Es el motivo de que el endpoint lea `request.text()`.
      const reformateado = JSON.stringify(conMensaje, null, 2);
      const mismoJson = await entregar(SLUG, conMensaje, { firmaDe: reformateado });
      esperar(mismoJson.status === 401, "firmando el mismo JSON reformateado, 401", String(mismoJson.status));

      esperar(!(await fila("rechazado")), "y no se ha guardado ni una fila de los tres intentos");
    }

    // ── 3. Lo que escribe el paciente ───────────────────────────────────────
    paso("Un mensaje que entra");
    {
      const r = await entregar(SLUG, {
        ...evento({ messages: [mensajeTexto(wam(1), TEL_PACIENTE, "Hola, ¿puedo cambiar la cita del jueves?")] }),
      });
      esperar(r.status === 200 && r.guardados === 1, "se acepta y se guarda", JSON.stringify(r));

      const f = await fila(1);
      esperar(!!f, "hay fila en whatsapp_messages");
      esperar(f?.direction === "in", "entrante", f?.direction);
      esperar(f?.origin === "app", "escrito por una persona, no por el CRM", f?.origin);
      esperar(f?.phone === TEL_PACIENTE, "el teléfono queda en dígitos", f?.phone);
      esperar(f?.body === "Hola, ¿puedo cambiar la cita del jueves?", "con su texto", f?.body);
      esperar(f?.status === null, "sin estado de entrega: ya está aquí", String(f?.status));
      esperar(f?.raw?.id === wam(1), "y el payload original guardado en raw");
      // La hora es la de META. Guardar `now` pondría el historial de 180 días
      // entero con fecha de hoy.
      esperar(
        Math.abs(new Date(f?.sentAt).getTime() - HACE_DOS_HORAS * 1000) < 1500,
        "con la hora de Meta, no la nuestra",
        String(f?.sentAt)
      );
      esperar(f?.clientId === paciente.id, "colgado de la ficha de la paciente", String(f?.clientId));
    }

    paso("Meta entrega «al menos una vez»: el reintento no duplica");
    {
      const r = await entregar(SLUG, {
        ...evento({ messages: [mensajeTexto(wam(1), TEL_PACIENTE, "Hola, ¿puedo cambiar la cita del jueves?")] }),
      });
      esperar(r.status === 200, "el reintento se acepta igual (200)", String(r.status));
      esperar(r.duplicados === 1 && r.guardados === 0, "y se reconoce como ya visto", JSON.stringify(r));
      const cuantas = await WhatsappMessage.count({ where: { wamId: wam(1) } });
      esperar(cuantas === 1, "sigue habiendo UNA sola fila", `hay ${cuantas}`);
    }

    paso("Un tipo de mensaje que no sabemos leer se guarda igual");
    {
      // Meta añade tipos nuevos cada temporada. Perder el mensaje por no saber
      // pintarlo sería justo el fallo que este módulo viene a evitar.
      const raro = {
        id: wam(2),
        from: TEL_PACIENTE,
        timestamp: String(HACE_DOS_HORAS),
        type: "invento_de_meta_2027",
        invento_de_meta_2027: { cosa: "lo que sea" },
      };
      const r = await entregar(SLUG, evento({ messages: [raro] }));
      esperar(r.guardados === 1, "se acepta", JSON.stringify(r));
      const f = await fila(2);
      esperar(!!f, "y queda guardado");
      esperar(f?.body === null, "sin texto, porque no lo sabemos leer", f?.body);
      esperar(f?.raw?.invento_de_meta_2027?.cosa === "lo que sea", "pero con el payload entero en raw");
    }

    paso("Coexistencia: lo que el cliente manda desde SU móvil");
    {
      // El eco de Meta. Sin esto el hilo del CRM tendría agujeros justo donde ha
      // hablado la persona que atiende.
      const eco = {
        id: wam(3),
        to: TEL_PACIENTE,
        timestamp: String(HACE_DOS_HORAS),
        type: "text",
        text: { body: "Claro, te lo cambio al viernes" },
      };
      const r = await entregar(SLUG, evento({ message_echoes: [eco] }));
      esperar(r.guardados === 1, "el eco se guarda", JSON.stringify(r));
      const f = await fila(3);
      esperar(f?.direction === "out", "sale del centro", f?.direction);
      esperar(f?.origin === "app", "escrito a mano desde el móvil, no por el CRM", f?.origin);
      esperar(f?.phone === TEL_PACIENTE, "contra el teléfono de la paciente", f?.phone);
    }

    paso("Los 180 días de historial que llegan al conectar");
    {
      const r = await entregar(
        SLUG,
        evento({
          history: [
            {
              threads: [
                {
                  // Meta identifica cada hilo por el wa_id del contacto.
                  id: TEL_PACIENTE,
                  messages: [
                    mensajeTexto(wam(4), TEL_PACIENTE, "Buenos días, quería pedir cita"),
                    // Saliente SIN `to`: en un hilo de dos, a quién iba se da
                    // por sobreentendido y el único rastro es el id del hilo.
                    mensajeTexto(wam(5), NUMERO_CENTRO, "Buenos días, ¿le viene bien el martes?"),
                    // Y el mismo caso CON `to`, que es la otra forma en que Meta
                    // lo entrega. Las dos tienen que acabar igual.
                    mensajeTexto(wam(12), NUMERO_CENTRO, "Le confirmo entonces", { to: TEL_PACIENTE }),
                  ],
                },
              ],
            },
          ],
        })
      );
      esperar(r.status === 200 && r.historial === 3, "entran los tres mensajes del hilo", JSON.stringify(r));

      const entrante = await fila(4);
      const saliente = await fila(5);
      esperar(entrante?.origin === "history", "marcados como historial", entrante?.origin);
      esperar(entrante?.direction === "in", "lo que dijo la paciente, entrante", entrante?.direction);
      // Se distingue por el número del CENTRO que viene en `metadata`: en el
      // historial no hay `message_echoes` que lo diga.
      esperar(saliente?.direction === "out", "y lo que dijo el centro, saliente", saliente?.direction);

      // Lo que se rompía. Un saliente sin `to` se guardaba con el teléfono en
      // blanco y sin ficha: el mensaje no se perdía, pero desaparecía del hilo
      // del paciente, que es el único sitio donde alguien lo va a buscar.
      esperar(saliente?.phone === TEL_PACIENTE, "un saliente SIN «to» se cuelga del hilo igual", saliente?.phone);
      esperar(saliente?.clientId === paciente.id, "y por tanto de la ficha", String(saliente?.clientId));

      const conTo = await fila(12);
      esperar(conTo?.phone === TEL_PACIENTE, "y con «to» sale exactamente lo mismo", conTo?.phone);
    }

    // ── 4. De quién es cada mensaje ─────────────────────────────────────────
    paso("A qué ficha se cuelga cada conversación");
    {
      const r = await entregar(
        SLUG,
        evento({
          messages: [
            mensajeTexto(wam(6), TEL_SECUNDARIO, "Soy la madre de la paciente"),
            mensajeTexto(wam(7), TEL_GEMELAS, "Somos dos en este número"),
            mensajeTexto(wam(8), TEL_DESCONOCIDO, "Hola, ¿tenéis hueco esta semana?"),
          ],
        })
      );
      esperar(r.guardados === 3, "entran los tres", JSON.stringify(r));

      // Sin los secundarios, asignar una conversación a mano no serviría de
      // nada: el siguiente mensaje del mismo número volvería a la bandeja.
      esperar(
        (await fila(6))?.clientId === conSecundario.id,
        "un teléfono SECUNDARIO también empareja",
        String((await fila(6))?.clientId)
      );

      // El de verdad importante. Adivinar aquí es colgar la conversación de una
      // paciente en la ficha de otra.
      const compartido = await fila(7);
      esperar(!!compartido, "un número compartido por dos fichas se guarda");
      esperar(compartido?.clientId === null, "y se deja SIN ASIGNAR en vez de adivinar", String(compartido?.clientId));

      const desconocido = await fila(8);
      esperar(!!desconocido, "un número que no está en ninguna ficha también se guarda");
      esperar(desconocido?.clientId === null, "sin ficha, a la bandeja de sin asignar", String(desconocido?.clientId));
    }

    // ── 5. Acuses de entrega ────────────────────────────────────────────────
    paso("Los acuses de lo que mandó el CRM");
    {
      const acuse = (id, status, extra = {}) =>
        entregar(
          SLUG,
          evento({
            statuses: [
              {
                id,
                status,
                timestamp: String(HACE_DOS_HORAS),
                recipient_id: TEL_PACIENTE,
                ...extra,
              },
            ],
          })
        );

      await acuse(wam(3), "delivered");
      esperar((await fila(3))?.status === "delivered", "entregado", (await fila(3))?.status);

      await acuse(wam(3), "read");
      esperar((await fila(3))?.status === "read", "leído", (await fila(3))?.status);

      // Los acuses llegan desordenados. Un `delivered` que llegue tarde no puede
      // convertir un mensaje leído en uno solo entregado.
      await acuse(wam(3), "delivered");
      esperar(
        (await fila(3))?.status === "read",
        "y un «entregado» que llega tarde NO lo hace retroceder",
        (await fila(3))?.status
      );
    }

    paso("Un aviso que falla deja rastro aunque no tengamos el original");
    {
      // Pasa de verdad: si el acuse llega antes de que se registre el envío, no
      // hay fila que actualizar. Tirarlo dejaría sin registro precisamente los
      // envíos fallidos, que son los únicos que hay que mirar.
      const r = await entregar(
        SLUG,
        evento({
          statuses: [
            {
              id: wam(9),
              status: "failed",
              timestamp: String(HACE_DOS_HORAS),
              recipient_id: TEL_PACIENTE,
              errors: [
                {
                  code: 131047,
                  title: "Re-engagement message",
                  message: "Message failed to send because more than 24 hours have passed",
                },
              ],
            },
          ],
        })
      );
      esperar(r.status === 200 && r.estados === 1, "el acuse se acepta", JSON.stringify(r));

      const f = await fila(9);
      esperar(!!f, "se CREA la fila aunque no existiera el mensaje");
      esperar(f?.status === "failed", "marcada como fallida", f?.status);
      esperar(/24 hours/.test(f?.errorMessage || ""), "con el motivo de Meta, en sus palabras", f?.errorMessage);
      esperar(f?.clientId === paciente.id, "y emparejada con la ficha por el teléfono", String(f?.clientId));
    }

    // ── 6. Un cliente no puede escribir en el schema de otro ────────────────
    paso(`Aislamiento: lo entregado en ${SLUG} no aparece en ${OTRO}`);
    {
      const r = await entregar(SLUG, evento({ messages: [mensajeTexto(wam(10), TEL_PACIENTE, "solo para sandbox")] }));
      esperar(r.guardados === 1, `se guarda en ${SLUG}`, JSON.stringify(r));
      esperar(!!(await fila(10)), `y está en el schema de ${SLUG}`);

      const intruso = await modelosOtro.WhatsappMessage.findOne({ where: { wamId: wam(10) } });
      esperar(!intruso, `no ha tocado el schema de ${OTRO}`, intruso ? "¡hay fila!" : "");

      // Y el camino contrario: el mismo payload en la URL del otro cliente entra
      // en SU tabla, no en la de este. El destino lo fija la ruta.
      const r2 = await entregar(OTRO, evento({ messages: [mensajeTexto(wam(11), TEL_PACIENTE, "solo para el otro")] }));
      esperar(r2.status === 200, `el mismo payload en la URL de ${OTRO} se acepta`, String(r2.status));
      esperar(!(await fila(11)), `y NO aparece en ${SLUG}`);
    }
  } finally {
    paso("Limpieza");
    for (const [nombre, m] of [
      [SLUG, WhatsappMessage],
      [OTRO, modelosOtro.WhatsappMessage],
    ]) {
      try {
        const n = await m.destroy({ where: { wamId: { [Op.like]: `wamid.${MARCA}-%` } } });
        ok(`${n} mensaje(s) borrados de ${nombre}`);
      } catch (err) {
        mal(`no se han podido borrar los mensajes de ${nombre}: ${err.message}`);
      }
    }
    await ClientContactMethod.destroy({ where: { clientId: conSecundario.id } }).catch(() => {});
    await Client.destroy({ where: { id: [paciente.id, conSecundario.id, ...gemelas.map((g) => g.id)] } }).catch(() => {});
    ok("fichas de prueba borradas");
  }
}

main()
  .then(async () => {
    process.stdout.write(fallos === 0 ? "\n✅ Todo en orden\n\n" : `\n❌ ${fallos} fallo(s)\n\n`);
    await closeAllConnections().catch(() => {});
    await getMasterDb().close().catch(() => {});
    process.exit(fallos === 0 ? 0 : 1);
  })
  .catch(async (err) => {
    process.stderr.write(`\n✗ Se ha roto: ${err.stack || err.message}\n\n`);
    await closeAllConnections().catch(() => {});
    process.exit(1);
  });
