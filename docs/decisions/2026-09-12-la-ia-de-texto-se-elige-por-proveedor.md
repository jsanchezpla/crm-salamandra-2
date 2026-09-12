# La IA de texto se elige por proveedor: Claude o ChatGPT (12/09/2026)

## Qué pasó

Rodrigo, 12/09/2026: «un par de clientes me han pedido hacer el trabajo que
hace Claude en el CRM también con ChatGPT, con una clave de OpenAI. Todas las
tareas que hace Claude; no las de Whisper».

Hasta hoy el CRM tenía dos claves de IA por tenant y un reparto fijo: la de
Anthropic para todo lo que se REDACTA (registros de sesión, informes, actas de
reunión, correos de Mailing, análisis de leads, propuestas de huecos, el
asistente, la IA de Proyectos, los tickets…) y la de OpenAI solo para Whisper
(voz → texto). Veinte rutas pedían `getTenantAnthropicKey(ctx)` y
`getTenantAnthropicModel(ctx)` y se los pasaban a dos envoltorios,
`lib/outreach/analysis/anthropic.js` (`complete` / `completeConParada`) y
`lib/assistant/anthropic.js` (`chat`).

## Qué se decidió

**Un interruptor por tenant, no un modelo mezclado.**
`settings.integrations.aiProvider` vale «anthropic» (por defecto: ningún
cliente cambia sin tocar nada) u «openai», y decide el proveedor de TODO lo
que redacta. Cada proveedor conserva su clave y su modelo (`anthropicApiKey` +
`anthropicModel`, `openaiApiKey` + `openaiModel`): cambiar y volver no pierde
nada. Se descartó meter los modelos de los dos en un solo desplegable porque
lo que pidieron los clientes es «con ChatGPT», no «con tal modelo», y porque
la clave que hace falta depende del proveedor y hay que poder avisar de cuál
falta.

**Whisper no entra.** La transcripción sigue pidiendo la clave de OpenAI se
elija lo que se elija: un centro con Claude para redactar tiene las dos claves
puestas, como hasta hoy. Por eso la tarjeta de OpenAI deja de rotularse
«Clínica»: ya es universal, como la de Anthropic.

**El modelo lleva dentro a su proveedor.** Las rutas piden ahora
`getTenantIaKey(ctx)` y `getTenantIaModel(ctx)` (`lib/ai/proveedorIa.js`) —los
del proveedor elegido— y los dos envoltorios miran el id del modelo
(`proveedorDelModelo`): un `gpt-…` se lo lleva `lib/ai/openai.js`, lo demás
sigue por Anthropic. Así no hubo que llevar un tercer parámetro por toda la
cadena de funciones intermedias (`structureSession`, `pulirInforme`,
`redactarActa`…), que no se tocaron. Los nombres nuevos son honestos a
propósito: `getTenantAnthropicKey` devolviendo una clave de OpenAI habría sido
una trampa para el siguiente que leyera una ruta.

**El cliente de OpenAI devuelve exactamente lo mismo.** `{ texto, parada }`
con `parada` en el vocabulario de Anthropic (`stop` → `end_turn`, `length` →
`max_tokens`), porque quien pide un registro clínico mira
`parada === "max_tokens"` para saber que se quedó corto y tiene que seguir
valiendo. Sin SDK, con `fetch` a Chat Completions como hace Whisper;
`max_completion_tokens` y `reasoning_effort: "none"` (por lo mismo que el
11/09 se apagó el razonamiento en Sonnet); streaming con timeout de SILENCIO
para las respuestas largas; la caché de respuestas repetidas y la fila en
`master.ai_uso` con el `usage` traducido a los contadores de Anthropic
(`usageAnthropicDe`), para que la contabilidad y la tarjeta de consumo sean
una sola. La caché de prompt no hay que pedirla: OpenAI cachea sola el prefijo
repetido, y `systemCacheado` se pone delante byte a byte igual.

**Los errores hablan el mismo idioma.** Lo que lanza `lib/ai/openai.js` lleva
`status`, `code` y `proveedor: "openai"`, y `lib/ai/errorLegible.js` nombra la
cuenta que toca. El «sin saldo» de OpenAI es un **429 con
`insufficient_quota`**, no un 400 como en Anthropic; sin mirar el código se
confundiría con «espera unos minutos», que es justo el error que costó una
tarde de tickets el 10/09.

**Tres modelos, en la misma escalera que los de Claude** (`lib/ai/openaiModel.js`):
GPT-5.6 Luna por defecto (económico), Terra (matiz) y Sol (máxima calidad),
con sus precios en `lib/ai/precios.js`. IDs verificados contra el catálogo
público de OpenAI el 12/09/2026; se cambian ahí cuando cambien.

## Cómo se aplica hoy

- Configuración → Conexiones tiene una tarjeta nueva delante de las dos
  claves, «Con qué IA se redacta», con el consumo del mes debajo (antes vivía
  en la tarjeta de Anthropic: es de la IA entera, no de una cuenta). Avisa en
  ámbar si el proveedor elegido no tiene clave. La tarjeta de OpenAI gana su
  desplegable de modelo.
- `GET /api/tenant/settings` devuelve `integrations.proveedorIa` y
  `integrations.openai.model`; el `PATCH` acepta `aiProvider` y `openaiModel`
  (listas cerradas), los audita como campos abiertos y los cuenta en el recibo
  por correo.
- Las rutas que decían «Configura la clave de Anthropic…» dicen ahora la del
  proveedor elegido (`sinClaveDeIa(ctx, …)`).
- Prueba: `scripts/_smoke-proveedor-ia.mjs`. Lo que NO se pudo probar en local
  es la llamada real a OpenAI (no hay clave, como con Anthropic:
  `docs/modules/configuracion.md`): el primer centro que lo encienda es la
  prueba, y `master.ai_uso` dirá lo que costó.
- No hay migración: todo vive en el JSONB de `master.tenants.settings`.
