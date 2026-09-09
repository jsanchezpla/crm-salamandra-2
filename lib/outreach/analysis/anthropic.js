import Anthropic from "@anthropic-ai/sdk";

/**
 * Proveedor Claude. Devuelve el texto crudo de la respuesta.
 *
 * Se pide solo JSON, sin thinking: la respuesta es corta y directa.
 * `max_tokens` holgado porque la salida incluye, por cada línea de negocio,
 * el análisis completo más un correo modelo; si se trunca, el JSON no parsea.
 *
 * Timeout explícito: un análisis colgado bloquearía el Route Handler, que
 * mantiene abierta una conexión del pool de Sequelize.
 *
 * ── POR STREAMING CUANDO LA RESPUESTA ES LARGA (01/09/2026) ─────────────────
 * Con `stream: true` la respuesta se recibe por trozos y se junta aquí: el
 * caller sigue recibiendo lo MISMO, no cambia nada aguas abajo.
 *
 * Por qué hizo falta: la IA de Proyectos pide un plan entero (fases, tareas,
 * hitos) con `maxTokens` 12.000 — cinco veces lo que pide cualquier otro sitio
 * del CRM—, y una petición sin streaming tiene que esperar a que el modelo
 * escriba las 12.000 de golpe. A la velocidad normal de Sonnet eso son varios
 * MINUTOS, muy por encima de los 120 s de aquí: la llamada moría en un
 * `APIConnectionTimeoutError` que `handleRouteError` convertía en «Error
 * interno del servidor». Desde fuera: la IA de Proyectos no funciona, sin
 * decir por qué. Con streaming la conexión no se queda muda y el timeout deja
 * de saltar por el mero tamaño de lo que se pide.
 *
 * `timeoutMs` es un parámetro por lo mismo: 120 s valen para un resumen de
 * 700 tokens y no para un plan de 12.000.
 */
const TIMEOUT_MS = 120_000;

/**
 * ── LA CACHÉ DE PROMPT (09/09/2026) ────────────────────────────────────────
 *
 * `systemCacheado` es la parte del system que NO cambia entre llamadas —el
 * saber clínico, la voz, las reglas— y viaja marcada para que Anthropic la
 * guarde y no vuelva a procesarla. Es opcional: sin ella, `system` se manda
 * como cadena exactamente igual que siempre y los once llamantes que no la
 * usan ni se enteran.
 *
 * POR QUÉ HACE FALTA: el prompt clínico pasó de 2.219 a 29.437 tokens al
 * meterle el saber clínico (contados con `countTokens`, no estimados). A las
 * ~1.000 llamadas al mes de Aumenta eso son +58,74 $/mes de entrada en SU
 * factura (la clave es suya, BYOK). Cacheado, +11,34 $/mes.
 *
 * POR QUÉ UNA HORA Y NO LOS CINCO MINUTOS DE FÁBRICA. Medidos los huecos
 * entre llamadas de Aumenta en septiembre (263 huecos): solo el **39 %** llega
 * antes de 5 minutos, el 56 % cae entre 5 y 60, y solo el 5 % pasa de la hora.
 * Con el TTL corto se fallaría la caché el 61 % de las veces y se pagaría la
 * ESCRITURA —que cuesta más que una entrada normal— casi siempre: saldría a
 * ~40 $/mes, o sea casi nada de ahorro. Con una hora se acierta el ~95 %.
 * Escribir una hora en vez de cinco minutos vale 14 $/mes.
 *
 * ⚠️ LA CACHÉ ES UN PREFIJO. Lo cacheado va DELANTE y tiene que ser byte a
 * byte igual: una línea que cambie ahí arriba —la edad del paciente— y no hay
 * nada que reutilizar. Por eso `nucleoClinico()` está separado de
 * `restoClinico()` en `lib/clinica/estiloClinico.js`.
 *
 * Y hay un mínimo: por debajo de 1.024 tokens (4.096 en Haiku) Anthropic no
 * cachea nada. Los prompts cortos del CRM no llegan y no lo usan.
 */
export function systemDeLaPeticion(system, systemCacheado) {
  const fijo = String(systemCacheado ?? "").trim();
  if (!fijo) return system;
  const resto = String(system ?? "").trim();
  return [
    { type: "text", text: fijo, cache_control: { type: "ephemeral", ttl: "1h" } },
    ...(resto ? [{ type: "text", text: resto }] : []),
  ];
}

/**
 * Igual que `complete`, pero además dice POR QUÉ paró Claude (`stop_reason`).
 *
 * Existe desde el 01/09/2026: quien pide un JSON largo —el registro clínico
 * entero— necesita distinguir «no había nada que decir» de «me quedé sin
 * sitio», porque las dos cosas llegaban aquí como una respuesta que no parsea y
 * acababan en la misma pantalla vacía. `parada === "max_tokens"` es la segunda.
 *
 * Y es también donde viven `stream` y `timeoutMs` (ver la nota de arriba): las
 * dos cosas que hacen falta cuando lo que se pide es largo de verdad. Se
 * juntaron aquí el mismo día por dos caminos distintos y describen el mismo
 * problema desde los dos lados — cuánto tarda en escribirse una respuesta larga
 * y qué pasa cuando no cabe.
 */
export async function completeConParada({
  system,
  user,
  model,
  maxTokens = 8000,
  apiKey,
  stream = false,
  timeoutMs = TIMEOUT_MS,
  systemCacheado = null,
}) {
  // La clave es SIEMPRE la del tenant (Configuración → IA). NO hay fallback a
  // ANTHROPIC_API_KEY del entorno: cada cliente trae la suya (BYOK), así el coste
  // y el control quedan en su cuenta. Si el tenant no la ha puesto, se corta aquí.
  if (!apiKey) {
    const err = new Error("Falta la clave de Anthropic del tenant (Configuración → IA)");
    err.code = "NO_API_KEY";
    throw err;
  }

  const client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 1 });
  const params = {
    model,
    max_tokens: maxTokens,
    system: systemDeLaPeticion(system, systemCacheado),
    messages: [{ role: "user", content: user }],
  };

  // `messages.stream()` acumula por su cuenta y `finalMessage()` devuelve el
  // mensaje completo, con la misma forma que `messages.create()` — `stop_reason`
  // incluido, así que las dos vías dan la misma `parada`.
  const msg = stream
    ? await client.messages.stream(params).finalMessage()
    : await client.messages.create(params);

  const texto = msg.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  return { texto, parada: msg.stop_reason ?? null };
}

/** El texto y ya: lo que quieren los diez sitios que solo miran la respuesta. */
export async function complete(args) {
  const { texto } = await completeConParada(args);
  return texto;
}
