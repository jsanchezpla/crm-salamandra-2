/**
 * lib/provisioning/credencialesCliente.js — PONER (nunca leer) las credenciales
 * de un cliente desde el back-office.
 *
 * (Fichero nuevo en /lib, regla #2: la lista de credenciales la comparten la
 * pantalla que dice cuáles faltan y la que las pone, y las reglas de escritura
 * tienen que ser las MISMAS que las de la Configuración del cliente. Dos copias
 * de esto se separan y una de las dos acaba guardando un secreto en claro.)
 *
 * ── POR QUÉ EXISTE (13/08/2026, recado de Jorge del 12/08) ──────────────────
 * Custodia sabía, cliente por cliente, qué credenciales le faltaban — hasta con
 * la frase «Ya tiene todas las claves puestas. No hay nada que pedirle» — y no
 * podía ponerlas. La única forma era que entrara el cliente, en su propia
 * Configuración. Y no entran: 1 de 9 clientes tenía clave de Anthropic (y
 * éramos nosotros) y 0 de 9 la de OpenAI, con once disparadores de IA
 * desplegados y sin usar por nadie. Jorge: que las pueda poner el cliente **o**
 * nosotros.
 *
 * ── ESTO NO ROMPE LA REGLA DEL ENDPOINT, Y CONVIENE DECIRLO ─────────────────
 * La regla de `/api/admin/configuraciones` es que NO DESCIFRA NADA: «no existe
 * un caso legítimo en el que haga falta LEER la clave de Stripe de un cliente».
 * Sigue en pie, entera. Escribir una clave no obliga a leer la anterior.
 *
 * El campo es DE SOLO ESCRIBIR: se pega, se cifra con `secretBox` —igual que lo
 * hace la Configuración del cliente— y no se devuelve nunca, ni enmascarado, ni
 * a quien acaba de escribirlo. De vuelta solo va QUÉ le pasó a cada clave:
 * puesta, cambiada o borrada. Una sesión robada del back-office se sigue
 * llevando una lista de qué está puesto, y no las credenciales de nadie.
 *
 * ── LO QUE SÍ SE RECHAZA ────────────────────────────────────────────────────
 *   · Las demos. Son públicas y dan sesión de admin a cualquiera: una clave ahí
 *     es la de un cliente real detrás de un enlace público (lib/demo/isDemo.js).
 *   · Sin `SETTINGS_ENCRYPTION_KEY`. Fuera de producción `encryptSecret`
 *     degrada a texto plano con un aviso por stderr, y eso dejaría la clave
 *     LEGIBLE en la base de datos mientras la pantalla dice «configurada».
 *   · Lo que no puede ser una credencial de ninguna manera: espacios, saltos de
 *     línea, caracteres de control, menos de 16 caracteres. Un pegado a medias
 *     tiene que cantar EN EL MOMENTO, no tres semanas después con un
 *     «Authentication failed» del proveedor (pasó con Cloudflare el 31/07).
 *
 * Lo que NO se rechaza es un prefijo raro: eso sale como AVISO. Los proveedores
 * cambian sus formatos, y bloquear una clave buena por una lista nuestra
 * desactualizada sería peor que el problema que evita.
 */

import { getMasterModels } from "../db/masterDb.js";
import { encryptSecret, isEncrypted, isEncryptionConfigured } from "../crypto/secretBox.js";
import { esSlugDemo } from "../demo/demos.js";
import { invalidateTenantCache } from "../tenant/tenantResolver.js";

/**
 * Las credenciales que un cliente puede tener. Es la MISMA lista que pinta la
 * portada de Custodia (de hecho la lee de aquí), para que no pueda haber una
 * credencial que se anuncie como «le falta» y no se pueda poner.
 *
 * `prefijos` es solo para el aviso. `donde` es lo que se le dice a quien la
 * pega, que suele no ser quien la generó.
 */
export const CREDENCIALES = [
  {
    clave: "stripeSecretKey", nombre: "Stripe — clave secreta", grupo: "Cobros",
    prefijos: ["sk_live_", "sk_test_", "rk_live_", "rk_test_"],
    donde: "Stripe → Desarrolladores → Claves de API",
  },
  {
    clave: "stripeWebhookSecret", nombre: "Stripe — webhook", grupo: "Cobros",
    prefijos: ["whsec_"],
    donde: "Stripe → Desarrolladores → Webhooks → el endpoint del CRM",
  },
  {
    clave: "resendApiKey", nombre: "Correo (Resend)", grupo: "Correo",
    prefijos: ["re_"],
    donde: "Resend → API Keys",
  },
  {
    clave: "anthropicApiKey", nombre: "IA (Anthropic)", grupo: "IA",
    prefijos: ["sk-ant-"],
    donde: "console.anthropic.com → Settings → API keys",
  },
  {
    clave: "openaiApiKey", nombre: "Transcripción (OpenAI)", grupo: "IA",
    prefijos: ["sk-"],
    donde: "platform.openai.com → API keys",
  },
  {
    clave: "googlePlacesApiKey", nombre: "Google Places", grupo: "Otros",
    prefijos: ["AIza"],
    donde: "Google Cloud → APIs y servicios → Credenciales",
  },
  {
    clave: "whatsappToken", nombre: "WhatsApp", grupo: "Otros",
    prefijos: [],
    donde: "Meta for Developers → WhatsApp → Configuración de la API",
  },
  {
    clave: "cloudflareApiToken", nombre: "Cloudflare (visitas web)", grupo: "Otros",
    prefijos: [],
    donde: "Cloudflare → Mi perfil → Tokens de API (solo lectura de Analytics)",
  },
];

const POR_CLAVE = new Map(CREDENCIALES.map((c) => [c.clave, c]));

export function credencialPorClave(clave) {
  return POR_CLAVE.get(String(clave || "")) ?? null;
}

/** Qué se sabe de una credencial SIN abrir el sobre: si está y si está cifrada. */
export function estadoCredencial(valor) {
  if (typeof valor !== "string" || !valor.trim()) return { puesta: false, cifrada: null };
  return { puesta: true, cifrada: isEncrypted(valor) };
}

const MIN = 16;
const MAX = 500;

/**
 * ¿Esto puede ser una credencial? Devuelve `{ error }` o `{ valor, aviso }`.
 * Nunca devuelve el valor en un mensaje: un error que repite lo que has pegado
 * acaba en un log.
 */
export function revisarValor(cred, crudo) {
  const v = String(crudo ?? "").trim();
  if (!v) return { error: `${cred.nombre}: no has pegado nada.` };
  if (/\s/.test(v)) {
    return {
      error: `${cred.nombre}: lleva espacios o saltos de línea. Cópiala entera y de una vez desde ${cred.donde}.`,
    };
  }
  // Caracteres de control, escritos con \u a propósito: escribirlos literales
  // dentro de la clase deja un rango que PARECE inofensivo y no lo es — lo que
  // había aquí acabó siendo `[ -]` (de espacio a guión), que habría rechazado
  // toda clave con un guión dentro: las de Anthropic (`sk-ant-…`) y las de
  // OpenAI (`sk-…`), o sea justo las dos que hay que poder poner. Lo cazó el
  // linter, avisando de que el `eslint-disable` de no-control-regex sobraba.
  if (/[\u0000-\u001f\u007f]/.test(v)) {
    return { error: `${cred.nombre}: lleva caracteres que no le corresponden. Vuelve a copiarla.` };
  }
  if (v.length < MIN) {
    return {
      error:
        `${cred.nombre}: has pegado ${v.length} caracteres y una credencial no baja de ${MIN}. ` +
        `Parece un pegado a medias — cópiala entera desde ${cred.donde}.`,
    };
  }
  if (v.length > MAX) return { error: `${cred.nombre}: pasa de ${MAX} caracteres, eso no es una clave.` };

  let aviso = null;
  if (cred.prefijos.length && !cred.prefijos.some((p) => v.startsWith(p))) {
    aviso =
      `${cred.nombre}: se ha guardado, pero no empieza por ${cred.prefijos.join(" ni ")}, ` +
      `que es como suelen empezar las suyas. Compruébalo antes de darlo por bueno.`;
  }
  return { valor: v, aviso };
}

/**
 * Escribe las credenciales de un cliente. `valores` es `{ clave: "..." }`;
 * `null` o `""` BORRAN esa credencial.
 *
 * Devuelve `{ ok, aplicado, avisos }` donde `aplicado` es
 * `{ anthropicApiKey: "puesta" | "cambiada" | "borrada" }` — nunca un valor.
 *
 * Nota sobre «cambiada»: el cifrado usa IV aleatorio, así que volver a guardar
 * la MISMA clave produce un texto cifrado distinto y no se puede distinguir de
 * un cambio real. Se registra como cambiada, que es la lectura conservadora
 * (mismo criterio que /api/tenant/settings).
 */
export async function ponerCredenciales({ slug, valores }) {
  const claves = Object.keys(valores ?? {});
  if (!claves.length) return { error: "No has mandado ninguna credencial", status: 422 };

  const desconocidas = claves.filter((k) => !POR_CLAVE.has(k));
  if (desconocidas.length) {
    return { error: `Credenciales que no existen: ${desconocidas.join(", ")}`, status: 422 };
  }

  if (esSlugDemo(slug)) {
    return {
      error:
        "Las demos son públicas y dan sesión de administrador a cualquiera: una credencial ahí la podría gastar quien entre por el enlace. No se les pone ninguna.",
      status: 409,
    };
  }

  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug } });
  if (!tenant) return { error: `No existe el cliente "${slug}"`, status: 404 };

  // Revisión ANTES de tocar nada: o entran todas las que valen, o no entra
  // ninguna. Guardar tres de cuatro y devolver un error deja al operador sin
  // saber qué quedó puesto.
  const aEscribir = [];
  const aBorrar = [];
  const avisos = [];
  for (const [clave, crudo] of Object.entries(valores)) {
    const cred = POR_CLAVE.get(clave);
    if (crudo === null || crudo === "") { aBorrar.push(cred); continue; }
    const r = revisarValor(cred, crudo);
    if (r.error) return { error: r.error, status: 422 };
    if (r.aviso) avisos.push(r.aviso);
    aEscribir.push({ cred, valor: r.valor });
  }

  if (aEscribir.length && !isEncryptionConfigured()) {
    return {
      error:
        "No se pueden guardar credenciales: falta la clave de cifrado del servidor (SETTINGS_ENCRYPTION_KEY). Sin ella se guardarían legibles en la base de datos.",
      status: 500,
    };
  }

  // Objetos nuevos, no mutar el settings cacheado; y asignar uno fresco es lo
  // que hace que Sequelize detecte el cambio del JSONB.
  const settings = { ...(tenant.settings ?? {}) };
  const integraciones = { ...(settings.integrations ?? {}) };

  const aplicado = {};
  for (const { cred, valor } of aEscribir) {
    const habia = !!integraciones[cred.clave];
    integraciones[cred.clave] = encryptSecret(valor);
    aplicado[cred.clave] = habia ? "cambiada" : "puesta";
  }
  for (const cred of aBorrar) {
    if (!integraciones[cred.clave]) continue; // no había: no se anuncia nada
    delete integraciones[cred.clave];
    aplicado[cred.clave] = "borrada";
  }

  if (!Object.keys(aplicado).length) return { ok: true, aplicado: {}, avisos };

  settings.integrations = integraciones;
  await tenant.update({ settings });

  // La caché del cliente EDITADO: sin esto, su CRM tarda hasta 60 s en ver la
  // clave nueva y quien acaba de ponerla cree que no ha funcionado.
  invalidateTenantCache(slug);

  return { ok: true, aplicado, avisos, tenantId: tenant.id };
}
