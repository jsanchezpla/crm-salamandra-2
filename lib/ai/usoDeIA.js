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
 * Sin contexto (una ruta pública, un script suelto) la fila sale sin tenant.
 * Se guarda igual: cuenta el gasto aunque no sepa de quién es.
 *
 * ── NUNCA ROMPE UNA LLAMADA ────────────────────────────────────────────────
 * Registrar es best-effort: si la tabla no está migrada o la base no
 * responde, se avisa por consola y la respuesta del modelo sigue su camino.
 * Un fallo de contabilidad no puede costarle a una terapeuta un registro que
 * ya está pagado.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { costeAnthropicUsd, costeOpenAIUsd, costeWhisperUsd, desgloseDeUsage } from "./precios.js";

const contexto = new AsyncLocalStorage();

/** Ejecuta `fn` con el tenant y el usuario de esta petición a mano. */
export function conContextoDeUso(datos, fn) {
  return contexto.run({ tenantId: datos?.tenantId ?? null, userId: datos?.userId ?? null, accion: null }, fn);
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
 */
export async function registrarUso(
  { proveedor, modelo = null, accion = null, usage = null, segundosAudio = 0, ms = null, parada = null, cacheado = false, tenantId, userId },
  { crear = crearEnMaster } = {}
) {
  try {
    const ctx = contexto.getStore();
    const d = desgloseDeUsage(usage);
    const segundos = Number.isFinite(Number(segundosAudio)) && Number(segundosAudio) > 0 ? Math.round(Number(segundosAudio)) : 0;
    const costeUsd = cacheado ? 0 : costeDeLaLlamada(proveedor, modelo, usage, segundos);
    await crear({
      tenantId: tenantId ?? ctx?.tenantId ?? null,
      userId: userId ?? ctx?.userId ?? null,
      proveedor: proveedor === "openai" ? "openai" : "anthropic",
      modelo: modelo ? String(modelo).slice(0, 80) : null,
      accion: (accion ?? ctx?.accion ?? null)?.slice(0, 200) ?? null,
      inputTokens: cacheado ? 0 : d.entrada,
      cacheWriteTokens: cacheado ? 0 : d.escritura,
      cacheReadTokens: cacheado ? 0 : d.lectura,
      outputTokens: cacheado ? 0 : d.salida,
      segundosAudio: segundos,
      costeUsd,
      ms: Number.isFinite(Number(ms)) ? Math.round(Number(ms)) : null,
      parada: parada ? String(parada).slice(0, 40) : null,
      cacheado: !!cacheado,
    });
    return true;
  } catch (e) {
    console.warn("[ai:uso] no se pudo registrar la llamada:", e?.message);
    return false;
  }
}

async function crearEnMaster(fila) {
  // Import perezoso: así este fichero se puede importar (y probar) sin base
  // de datos, y solo se abre Sequelize cuando de verdad hay algo que guardar.
  const { getMasterModels } = await import("../db/masterDb.js");
  const { AiUso } = getMasterModels();
  if (!AiUso) throw new Error("el modelo AiUso no está registrado");
  await AiUso.create(fila);
}
