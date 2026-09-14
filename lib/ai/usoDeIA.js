/**
 * lib/ai/usoDeIA.js — cada llamada de pago a la IA deja una fila con lo que
 * costó (11/09/2026).
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 * El 10/09/2026 Aumenta se quedó sin saldo de Anthropic a los diez días y no
 * había forma de saber en qué se había ido: `master.audit_logs` contaba
 * INTENTOS (`ai.uso`), pero ni tokens, ni modelo, ni coste. La auditoría de
 * ese día lo estimó a mano a partir del código. Desde aquí se guarda de
 * verdad, llamada a llamada, en `master.ai_uso`.
 *
 * ── CÓMO SABE DE QUIÉN ES LA LLAMADA SIN TOCAR LOS 17 SITIOS QUE LLAMAN ────
 * Quien llama al modelo es una función de `lib/` (structureSession,
 * pulirInforme…) que no tiene el contexto del tenant; quien lo tiene es la
 * ruta. Llevar el tenant y la acción como parámetro hasta el cliente central
 * obligaría a tocar todas las rutas y todas las funciones intermedias. En su
 * lugar, `withTenant` abre un contexto asíncrono (`AsyncLocalStorage`) con el
 * tenant y el usuario, `vetoAi` le apunta la acción legible («transcribir una
 * sesión clínica»), y el cliente central lo lee cuando registra. Es el mismo
 * mecanismo que usa Next por dentro: sobrevive a todos los `await` de la
 * petición y no se mezcla entre peticiones.
 *
 * Sin contexto (un script suelto) la fila sale sin tenant. Se guarda igual:
 * cuenta el gasto aunque no sepa de quién es. (Desde el 13/09/2026 las rutas
 * públicas de `withPublicTenant` también abren el contexto.)
 *
 * El mismo contexto lleva, desde el 13/09/2026, `avisarFalloDeCuenta`: el
 * gancho con el que el cliente central avisa a dirección cuando la cuenta de
 * IA falla (`lib/ai/trasFalloDeIa.js`). Lo pone quien sabe del tenant
 * (`datosDelContexto` de `lib/ai/avisoDeCuentaIa.js`), así este fichero sigue
 * sin base de datos.
 *
 * ── NUNCA ROMPE UNA LLAMADA ────────────────────────────────────────────────
 * Registrar es best-effort: si la tabla no está migrada o la base no
 * responde, se avisa por consola y la respuesta del modelo sigue su camino.
 * Un fallo de contabilidad no puede costarle a una terapeuta un registro que
 * ya está pagado.
 *
 * ── Y LO QUE FALLA (14/09/2026, regla #2) ──────────────────────────────────
 * Hasta hoy solo apuntaba la llamada que RESPONDÍA: `registrarUso` iba detrás
 * del `await` del proveedor, y una llamada rechazada no dejaba ni una fila. El
 * día que se acabara el saldo no se sabría cuántas fueron ni por qué. Desde hoy
 * `registrarFallo` deja la fila también de la que falla: a coste 0, sin tokens,
 * con la CAUSA en una palabra (`error`, `causaDelFallo` de
 * `lib/ai/errorLegible.js`) y el estado HTTP (`errorHttp`); nunca el mensaje ni
 * el cuerpo del proveedor. La llama un solo sitio, `lib/ai/trasFalloDeIa.js`,
 * por donde ya pasan los cuatro clientes que hablan con un proveedor. Lo que no
 * llegó a salir (sin clave, sin audio, audio demasiado grande) no deja fila.
 *
 * Una fila que respondió NO lleva la clave `error`, y se crea con
 * `returning: false`: así sigue entrando aunque las columnas nuevas no estén
 * migradas todavía. Las pruebas cambian a dónde van las filas con
 * `destinoDeUsoParaPruebas`, para no escribir en ninguna base.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { causaDelFallo } from "./errorLegible.js";
import { costeAnthropicUsd, costeOpenAIUsd, costeWhisperUsd, desgloseDeUsage } from "./precios.js";

const contexto = new AsyncLocalStorage();

/*
 * A dónde van las filas cuando quien registra no pasa `crear`. Solo lo cambian
 * las pruebas (una prueba ligera no puede escribir en la base de quien la lanza).
 */
const destino = { crear: crearEnMaster };

/** Solo pruebas: a dónde van las filas por defecto (`null` repone `master.ai_uso`). Devuelve el anterior. */
export function destinoDeUsoParaPruebas(crear) {
  const antes = destino.crear;
  destino.crear = typeof crear === "function" ? crear : crearEnMaster;
  return antes;
}

/**
 * Ejecuta `fn` con el tenant y el usuario de esta petición a mano.
 *
 * `impersonadorId` (12/09/2026): en una sesión «como admin» del calendario
 * global, el id de la cuenta de Salamandra que entró (lo pone `withTenant`
 * tras verificar el token). No lo usa la contabilidad de la IA: lo lee el
 * modelo AuditLog para guardar quién fue en cada fila de auditoría. Vive aquí
 * porque este es ya el contexto de la petición; abrir un segundo
 * AsyncLocalStorage para un solo campo sería otra cosa que mantener.
 */
export function conContextoDeUso(datos, fn) {
  return contexto.run(
    {
      tenantId: datos?.tenantId ?? null,
      userId: datos?.userId ?? null,
      impersonadorId: datos?.impersonadorId ?? null,
      // Con qué avisar a los admins si la cuenta de IA falla (13/09/2026).
      avisarFalloDeCuenta: typeof datos?.avisarFalloDeCuenta === "function" ? datos.avisarFalloDeCuenta : null,
      accion: null,
    },
    fn
  );
}

/** La etiqueta legible de lo que se va a hacer; la pone `vetoAi`. */
export function marcarAccion(accion) {
  const s = contexto.getStore();
  if (s && typeof accion === "string" && accion.trim()) s.accion = accion.trim().slice(0, 200);
}

/** Lo que se sabe de la petición en curso, o `null` fuera de una. */
export function contextoDeUso() {
  return contexto.getStore() ?? null;
}

/**
 * Cuánto costó, según quién contestó: Anthropic por tokens; OpenAI por minuto
 * de audio si fue Whisper y por tokens si fue ChatGPT (12/09/2026, desde que
 * también se redacta con OpenAI). El modelo distingue a Whisper cuando no hay
 * segundos que contar.
 */
function costeDeLaLlamada(proveedor, modelo, usage, segundos) {
  if (proveedor !== "openai") return costeAnthropicUsd(modelo, usage);
  if (segundos > 0 || /^whisper/i.test(String(modelo ?? ""))) return costeWhisperUsd(segundos);
  return costeOpenAIUsd(modelo, usage);
}

/**
 * Guarda una llamada. `usage` es el bloque de Anthropic (el de OpenAI llega ya
 * traducido a esa forma por `lib/ai/openai.js`); `segundosAudio` el de
 * Whisper. Lo que no venga se rellena del contexto de la petición.
 * `crear` existe para las pruebas: por defecto escribe en `master.ai_uso`.
 *
 * `error` y `errorHttp` (14/09/2026) solo los pone `registrarFallo`: con
 * `error`, la fila va a coste 0 y sin tokens ni audio, porque no respondió.
 */
export async function registrarUso(
  {
    proveedor,
    modelo = null,
    accion = null,
    usage = null,
    segundosAudio = 0,
    ms = null,
    parada = null,
    cacheado = false,
    tenantId,
    userId,
    error = null,
    errorHttp = null,
  },
  { crear = destino.crear } = {}
) {
  try {
    const ctx = contexto.getStore();
    const fallo = error ? String(error).slice(0, 40) : null;
    const sinCoste = cacheado || !!fallo;
    const d = desgloseDeUsage(usage);
    const segundos =
      !fallo && Number.isFinite(Number(segundosAudio)) && Number(segundosAudio) > 0 ? Math.round(Number(segundosAudio)) : 0;
    const costeUsd = sinCoste ? 0 : costeDeLaLlamada(proveedor, modelo, usage, segundos);
    await crear({
      tenantId: tenantId ?? ctx?.tenantId ?? null,
      userId: userId ?? ctx?.userId ?? null,
      proveedor: proveedor === "openai" ? "openai" : "anthropic",
      modelo: modelo ? String(modelo).slice(0, 80) : null,
      accion: (accion ?? ctx?.accion ?? null)?.slice(0, 200) ?? null,
      inputTokens: sinCoste ? 0 : d.entrada,
      cacheWriteTokens: sinCoste ? 0 : d.escritura,
      cacheReadTokens: sinCoste ? 0 : d.lectura,
      outputTokens: sinCoste ? 0 : d.salida,
      segundosAudio: segundos,
      costeUsd,
      ms: Number.isFinite(Number(ms)) ? Math.round(Number(ms)) : null,
      parada: !fallo && parada ? String(parada).slice(0, 40) : null,
      cacheado: !fallo && !!cacheado,
      // Solo la fila que falló lleva las columnas del 14/09/2026 (ver cabecera).
      ...(fallo ? { error: fallo, errorHttp: Number.isInteger(errorHttp) ? errorHttp : null } : {}),
    });
    return true;
  } catch (e) {
    console.warn("[ai:uso] no se pudo registrar la llamada:", e?.message);
    return false;
  }
}

/*
 * El mismo objeto de error no deja dos filas (14/09/2026), aunque pasara dos
 * veces por `trasFalloDeIa` (un envoltorio que relanza hacia otro que también
 * lo pasa). Un WeakSet no retiene los errores: se van con la petición.
 */
const yaApuntados = new WeakSet();

/**
 * La llamada a la IA FALLÓ (14/09/2026): una fila a coste 0 con la causa en una
 * palabra y el estado HTTP, nunca el mensaje. Devuelve si la dejó.
 *
 * Punto único: la llama `lib/ai/trasFalloDeIa.js`, por donde pasan los cuatro
 * clientes que hablan con un proveedor antes de relanzar. Un error que no llegó
 * a salir (`causaDelFallo` → null) no deja fila. Nunca lanza.
 *
 * `tenantId`, `userId` y `accion` son opcionales: lo que no venga sale del
 * contexto de la petición, como en `registrarUso`.
 */
export async function registrarFallo({ proveedor, modelo = null, err, ms = null, tenantId, userId, accion = null } = {}, { crear } = {}) {
  try {
    const causa = causaDelFallo(err);
    if (!causa) return false;
    if (yaApuntados.has(err)) return false;
    yaApuntados.add(err);
    const http = Number.isInteger(err.status) && err.status >= 100 && err.status <= 599 ? err.status : null;
    return await registrarUso(
      { proveedor, modelo, ms, tenantId, userId, accion, error: causa, errorHttp: http },
      crear ? { crear } : {}
    );
  } catch (e) {
    console.warn("[ai:uso] no se pudo registrar el fallo:", e?.message);
    return false;
  }
}

async function crearEnMaster(fila) {
  // Import perezoso: así este fichero se puede importar (y probar) sin base
  // de datos, y solo se abre Sequelize cuando de verdad hay algo que guardar.
  const { getMasterModels } = await import("../db/masterDb.js");
  const { AiUso } = getMasterModels();
  if (!AiUso) throw new Error("el modelo AiUso no está registrado");
  // Sin `returning` (14/09/2026): Sequelize pediría de vuelta TODAS las
  // columnas del modelo, y una fila buena fallaría si `error`/`error_http`
  // aún no están migradas. El INSERT solo lleva los campos que trae la fila.
  await AiUso.create(fila, { returning: false });
}
