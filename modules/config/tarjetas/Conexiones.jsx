"use client";

// modules/config/tarjetas/Conexiones.jsx — pestaña «Conexiones» de
// Configuración: la tarjeta de credencial con tutorial (ApiKeyCard y su mapa
// AI_PROVIDERS) y las piezas de WhatsApp, Cloudflare y Stripe.

// Tutoriales de alta de cada credencial de IA. Autoservicio con fricción: el
// cliente sigue los pasos en la plataforma, copia la clave y la pega aquí.

import { useEffect, useState } from "react";
import { EVENTOS_WEBHOOK_STRIPE } from "../../../lib/payments/eventosWebhook.js";
import Select from "../../../components/ui/Select.jsx";
import { inputCls } from "./ui.jsx";
export const AI_PROVIDERS = {
  anthropic: {
    title: "Anthropic (Claude)",
    subtitle: "IA de todo el CRM: análisis de leads (Outreach) y resumen de sesiones clínicas. El modelo elegido se aplica en todo.",
    field: "anthropicApiKey",
    prefix: "sk-ant-",
    platformUrl: "https://console.anthropic.com/settings/keys",
    platformLabel: "Abrir Anthropic Console",
    steps: [
      "Entra en console.anthropic.com y crea una cuenta (o inicia sesión).",
      'En el menú lateral abre "API Keys" y pulsa "Create Key".',
      'Ponle un nombre (p. ej. "CRM Salamandra") y créala.',
      "Copia la clave (empieza por sk-ant-). Solo se muestra una vez.",
      "Pégala abajo y pulsa Guardar.",
    ],
    note: "El análisis con IA es de pago por uso: añade saldo en Plans & Billing dentro de la consola.",
  },
  whatsapp: {
    title: "WhatsApp (Meta Cloud API)",
    subtitle: "Envío automático de mensajes desde el número de WhatsApp del negocio: avisos de cita, menús, recordatorios.",
    field: "whatsappToken",
    prefix: "EAA",
    platformUrl: "https://business.facebook.com/wa/manage/home/",
    platformLabel: "Abrir WhatsApp Business",
    steps: [
      "Necesitas una cuenta de WhatsApp Business y un número dado de alta en Meta (no vale el WhatsApp normal del móvil).",
      "Entra en developers.facebook.com → tu app → WhatsApp → Configuración de la API.",
      'Copia el "Identificador del número de teléfono" y pégalo en el campo de abajo.',
      'Genera un token de acceso PERMANENTE (Usuarios del sistema → Generar token). Los temporales caducan en 24h.',
      "Pega el token y pulsa Guardar.",
    ],
    note: "Meta cobra por conversación iniciada por el negocio. El primer mensaje a alguien que no te ha escrito en 24h debe usar una plantilla aprobada por Meta.",
  },
  openai: {
    title: "OpenAI (Whisper)",
    subtitle: "Transcripción de audio de sesiones clínicas (voz → texto) con la API de Whisper. Luego Claude resume la sesión.",
    field: "openaiApiKey",
    prefix: "sk-",
    platformUrl: "https://platform.openai.com/api-keys",
    platformLabel: "Abrir OpenAI Platform",
    steps: [
      "Entra en platform.openai.com y crea una cuenta (o inicia sesión).",
      'En "Settings → Billing" añade saldo (la transcripción es de pago por uso).',
      'En "API keys" pulsa "Create new secret key".',
      'Ponle un nombre (p. ej. "CRM Salamandra") y créala.',
      "Copia la clave (empieza por sk-). Solo se muestra una vez.",
      "Pégala abajo y pulsa Guardar.",
    ],
    note: "Solo se usa Whisper para transcribir; el coste es muy bajo (~0,006 $ por minuto de audio).",
  },
  googlePlaces: {
    title: "Google Cloud (Places)",
    subtitle: 'Búsqueda de negocios en "Buscar nuevos" (nombre, dirección, teléfono y web).',
    field: "googlePlacesApiKey",
    prefix: "AIza",
    platformUrl: "https://console.cloud.google.com/",
    platformLabel: "Abrir Google Cloud",
    steps: [
      "Entra en console.cloud.google.com y crea un proyecto.",
      'Activa "Places API (New)" en "APIs y servicios → Biblioteca".',
      "Activa la facturación (tarjeta). Es gratis hasta 1.000 búsquedas al mes.",
      '"APIs y servicios → Credenciales → Crear credenciales → Clave de API".',
      "Recomendado: restringe la clave a Places API y pon un límite de cuota a 1.000/mes para no pagar nunca de más.",
      "Copia la clave (empieza por AIza) y pégala abajo.",
    ],
    note: "Con el límite de cuota a 1.000 es imposible que Google te cobre: la API deja de responder al llegar al tope gratis.",
  },
  cloudflare: {
    title: "Cloudflare (visitas de la web)",
    subtitle: "Alimenta el módulo Analíticas: visitas, países, páginas y origen del tráfico. Medición sin cookies.",
    field: "cloudflareApiToken",
    // Los tokens de Cloudflare no tienen prefijo fijo, así que no se valida por
    // forma: se comprueba de verdad en la primera consulta, que es cuando
    // Cloudflare responde si sirve o no.
    prefix: "",
    platformUrl: "https://dash.cloudflare.com/profile/api-tokens",
    platformLabel: "Abrir tokens de Cloudflare",
    steps: [
      "La web tiene que tener ya activado Cloudflare Web Analytics y su fragmento de medición puesto.",
      "Entra en dash.cloudflare.com → Mi perfil → Tokens de API.",
      'Pulsa "Crear token" y elige "Crear token personalizado" (botón "Comenzar").',
      'Añade UN solo permiso, con los tres desplegables: "Cuenta" · "Account Analytics" · "Leer". El del medio sale escribiendo «Analytics».',
      'En "Recursos de cuenta" deja "Incluir" y elige tu cuenta concreta en vez de "Todas las cuentas".',
      "Crea el token y cópialo (Cloudflare solo lo enseña una vez).",
      "Pégalo abajo, rellena el identificador de cuenta y pulsa Guardar.",
    ],
    note: "Es un token de SOLO LECTURA de estadísticas: no puede tocar dominios, DNS ni nada de la cuenta. Web Analytics es gratis.",
  },
  resend: {
    title: "Resend (correo de captación)",
    subtitle: "Enviar el correo modelo en frío a los leads captados.",
    field: "resendApiKey",
    prefix: "re_",
    platformUrl: "https://resend.com/api-keys",
    platformLabel: "Abrir Resend",
    steps: [
      "Entra en resend.com y crea una cuenta (o inicia sesión).",
      "En Domains, verifica tu dominio de envío (registros SPF + DKIM).",
      'Ve a "API Keys" → "Create API Key" (permiso de envío).',
      "Copia la clave (empieza por re_) y pégala abajo.",
      "Rellena el remitente con un email de ESE dominio verificado.",
    ],
    note: "El remitente (from) debe ser de un dominio verificado en ESTA cuenta de Resend, o Resend rechaza el envío.",
  },
  stripeSecret: {
    title: "Stripe — clave secreta",
    subtitle: "Cobrar por adelantado las citas que tengan precio. El dinero va a TU cuenta de Stripe.",
    field: "stripeSecretKey",
    prefix: "sk_",
    platformUrl: "https://dashboard.stripe.com/apikeys",
    platformLabel: "Abrir Stripe",
    steps: [
      "Entra en dashboard.stripe.com y crea una cuenta (o inicia sesión).",
      'Para probar sin cobrar dinero real, activa el interruptor "Modo de prueba" arriba a la derecha.',
      'Ve a "Desarrolladores" → "Claves de API".',
      'En "Clave secreta" pulsa "Revelar" y cópiala (empieza por sk_test_ o sk_live_).',
      "Pégala abajo y pulsa Guardar. Después configura el webhook (más abajo).",
    ],
    note: "Con una clave sk_test_ no se cobra dinero real: sirve para probar el circuito entero antes de abrir a pacientes.",
  },
  gocardless: {
    title: "Banco (GoCardless) — Secret Key",
    subtitle:
      "Conecta tu cuenta del banco de verdad: el CRM trae los movimientos (solo lectura, vía PSD2) y los casa con tus cobros y gastos.",
    field: "gocardlessSecretKey",
    prefix: "",
    platformUrl: "https://bankaccountdata.gocardless.com/user-secrets/",
    platformLabel: "Abrir GoCardless Bank Account Data",
    steps: [
      "Entra en bankaccountdata.gocardless.com y crea una cuenta gratuita (no es el GoCardless de cobros: es su portal de datos bancarios).",
      'En el menú, abre "User secrets" y pulsa "Create new".',
      'Ponle un nombre (p. ej. "CRM Salamandra") y créalo.',
      "Copia el Secret ID y la Secret Key (la clave solo se enseña una vez).",
      "Pega la Secret Key aquí y el Secret ID en el campo de abajo, y guarda los dos.",
      "Después, en Facturación → Banco, elige tu banco y autoriza el acceso en su web.",
    ],
    note: "El acceso es de SOLO LECTURA (PSD2): con estas claves no se puede mover dinero. El consentimiento del banco dura 90 días y se renueva desde la pantalla de Banco.",
  },
  stripeWebhook: {
    title: "Stripe — secreto del webhook",
    subtitle: "Es lo que nos avisa de que un pago se ha completado. Sin esto, el paciente paga y su cita no se confirma nunca.",
    field: "stripeWebhookSecret",
    prefix: "whsec_",
    platformUrl: "https://dashboard.stripe.com/webhooks",
    platformLabel: "Abrir webhooks de Stripe",
    steps: [
      'En Stripe, ve a "Desarrolladores" → "Webhooks" → "Añadir punto de conexión".',
      "Pega como URL la dirección que aparece justo debajo de este recuadro.",
      "Marca TODOS los eventos de la lista que sale debajo de esa dirección: cada uno avisa de algo distinto y el que falte es un cobro del que el CRM no se entera.",
      'Crea el punto de conexión y copia su "Secreto de firma" (empieza por whsec_).',
      "Pégalo abajo y pulsa Guardar.",
    ],
    note: "El secreto es distinto en modo prueba y en producción: si cambias de uno a otro, hay que actualizar también este campo.",
  },
};

// ── Tarjeta de credencial de IA con tutorial + botón + campo ─────────────────
export function ApiKeyCard({ provider, status, isAdmin, onSave, onClear, models, currentModel, onModelChange, extra }) {
  const [showSteps, setShowSteps] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const configured = !!status?.configured;

  async function handleSave() {
    if (!value.trim()) return;
    setBusy(true);
    const okDone = await onSave(value.trim());
    setBusy(false);
    if (okDone) setValue("");
  }
  async function handleClear() {
    setBusy(true);
    await onClear();
    setBusy(false);
    setValue("");
  }

  return (
    <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-display text-lg text-[var(--ink-900)]">{provider.title}</h3>
            {configured ? (
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Conectada
              </span>
            ) : (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-500 border border-neutral-200">Sin configurar</span>
            )}
          </div>
          <p className="text-xs text-neutral-500 mt-1">{provider.subtitle}</p>
          {configured && status?.hint && (
            <p className="text-[11px] text-neutral-400 mt-1 font-mono">Clave actual: {status.hint}</p>
          )}
        </div>
        <button onClick={() => setShowSteps((v) => !v)} className="shrink-0 text-[11px] font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">
          {showSteps ? "Ocultar" : "Cómo conseguirla"}
        </button>
      </div>

      {showSteps && (
        <div className="mt-4 rounded-lg bg-neutral-50 border border-neutral-100 p-4">
          <ol className="list-decimal list-inside space-y-1.5 text-xs text-neutral-600">
            {provider.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          {provider.note && <p className="text-[11px] text-neutral-400 mt-3">{provider.note}</p>}
          <a href={provider.platformUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 mt-3 px-3 py-2 rounded-lg text-xs font-semibold text-white hover:opacity-90 transition"
            style={{ background: "var(--color-primary, #1B3A2D)" }}>
            {provider.platformLabel}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
          </a>
        </div>
      )}

      {isAdmin && (
        <div className="mt-4 flex flex-col sm:flex-row gap-2 sm:items-center">
          <input
            type="password"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            // Cloudflare no usa prefijo fijo en sus tokens: sin este condicional
            // el hueco decía "Pega la clave (...)", que no ayuda a nadie.
            placeholder={
              configured
                ? "Pega una clave nueva para reemplazarla"
                : provider.prefix
                  ? `Pega la clave (${provider.prefix}...)`
                  : "Pega el token"
            }
            className={inputCls + " font-mono flex-1"}
          />
          <button onClick={handleSave} disabled={busy || !value.trim()} className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-40"
            style={{ background: "var(--color-primary, #1B3A2D)" }}>
            {busy ? "..." : "Guardar"}
          </button>
          {configured && (
            <button onClick={handleClear} disabled={busy} className="px-3 py-2 rounded-lg text-xs font-semibold text-neutral-500 border border-neutral-200 hover:bg-neutral-50 disabled:opacity-40">
              Eliminar
            </button>
          )}
        </div>
      )}

      {extra}

      {models && (
        <div className="mt-4 pt-4 border-t border-neutral-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="min-w-0">
            <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Modelo de IA</label>
            <p className="text-[11px] text-neutral-400 mt-0.5">
              {models.find((m) => m.id === currentModel)?.description ?? "Sonnet es el recomendado: más barato que Opus, calidad similar."}
            </p>
          </div>
          <Select
            disabled={!isAdmin}
            value={currentModel ?? ""}
            onChange={(v) => onModelChange?.(v)}
            options={models.map((m) => ({ value: m.id, label: m.label }))}
            className={inputCls + " sm:w-52 shrink-0"}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Resumen de si el cobro online funciona de verdad.
 *
 * Los dos estados peligrosos son silenciosos y se avisan en amarillo: tener la
 * clave sin el secreto del webhook (el paciente paga y su cita no se confirma
 * jamás, porque nadie nos avisa del cobro), y estar en modo prueba creyendo que
 * se está cobrando.
 */
export function EstadoCobro({ status }) {
  const tieneClave = !!status?.configured;
  const tieneWebhook = !!status?.webhook;
  const listo = !!status?.ready;
  const real = !!status?.liveMode;

  let tono = "bg-neutral-50 border-neutral-200 text-neutral-600";
  let titulo = "Cobro online sin configurar";
  let detalle = "Las citas con precio no se podrán reservar hasta que rellenes las dos claves de abajo.";

  if (tieneClave && !tieneWebhook) {
    tono = "bg-amber-50 border-amber-200 text-amber-800";
    titulo = "Falta el secreto del webhook";
    detalle =
      "Con la clave puesta pero sin webhook, el paciente pagaría y su cita no se confirmaría nunca, porque nadie nos avisa del cobro. El cobro sigue desactivado a propósito hasta que lo rellenes.";
  } else if (listo && !real) {
    tono = "bg-amber-50 border-amber-200 text-amber-800";
    titulo = "Listo, pero en modo PRUEBA";
    detalle =
      "El circuito funciona de principio a fin, pero con claves de prueba no se cobra dinero real. Cuando lo hayas comprobado, sustituye ambas claves por las de producción.";
  } else if (listo && real) {
    tono = "bg-emerald-50 border-emerald-200 text-emerald-800";
    titulo = "Cobrando de verdad";
    detalle = "Las citas con precio se cobran por adelantado y el dinero entra en tu cuenta de Stripe.";
  }

  return (
    <div className={`rounded-xl border p-4 lg:p-5 ${tono}`}>
      <div className="font-display text-lg">{titulo}</div>
      <p className="text-xs mt-1 leading-relaxed">{detalle}</p>
    </div>
  );
}

/** La URL que hay que dar de alta en Stripe. El paso que más se olvida. */
export function UrlWebhook({ slug }) {
  const [copiado, setCopiado] = useState(false);
  const url = typeof window !== "undefined" ? `${window.location.origin}/api/webhooks/stripe/${slug}` : "";

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* sin portapapeles: queda visible para copiar a mano */
    }
  }

  return (
    <div className="mt-4 pt-4 border-t border-neutral-100">
      <div className="text-xs text-neutral-500 mb-2">
        Esta es la URL que hay que pegar en Stripe al crear el punto de conexión:
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 truncate text-[12px] bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 text-neutral-700">
          {url}
        </code>
        <button
          type="button"
          onClick={copiar}
          className="shrink-0 text-xs px-3 py-2 rounded-lg border border-neutral-200 text-neutral-600 hover:border-neutral-400 transition"
        >
          {copiado ? "Copiada" : "Copiar"}
        </button>
      </div>
    </div>
  );
}

/**
 * Los eventos que hay que marcar en el punto de conexión.
 *
 * Salen de `lib/payments/eventosWebhook.js` —la misma lista que comprueba
 * `scripts/comprobar-stripe.js`— y no de un texto escrito aquí: cuando estaban
 * escritos a mano, esta pantalla pedía cinco de los once que el webhook trata.
 */
/**
 * Los eventos que hay que marcar en Stripe.
 *
 * Va PLEGADO (23/08/2026): son once filas con su explicación y medían más de
 * media pantalla, en una zona —Conexiones— que ya es la más larga de las seis.
 * Es una lista que se consulta UNA vez, el día que se crea el punto de conexión
 * en Stripe, y que después estorba para siempre a quien solo venía a cambiar
 * una clave.
 *
 * El botón de copiar se queda FUERA del plegado a propósito: es lo que de
 * verdad se usa —se pegan los once de golpe en Stripe— y esconderlo detrás de
 * un clic obligaría a desplegar la lista para no leerla.
 */
export function EventosWebhook() {
  const [copiado, setCopiado] = useState(false);
  const [abierto, setAbierto] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(EVENTOS_WEBHOOK_STRIPE.map((e) => e.evento).join("\n"));
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* sin portapapeles: quedan visibles para buscarlos a mano */
    }
  }

  return (
    <div className="mt-4 pt-4 border-t border-neutral-100">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-xs text-neutral-500">
          Y estos son los <strong>{EVENTOS_WEBHOOK_STRIPE.length} eventos</strong> que hay que marcar.
          Si falta alguno, ese cobro ocurre en Stripe y el CRM no se entera.
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAbierto((v) => !v)}
            aria-expanded={abierto}
            className="text-xs px-3 py-2 rounded-lg border border-neutral-200 text-neutral-600 hover:border-neutral-400 transition"
          >
            {abierto ? "Ocultar la lista" : "Ver la lista"}
          </button>
          <button
            type="button"
            onClick={copiar}
            className="text-xs px-3 py-2 rounded-lg border border-neutral-200 text-neutral-600 hover:border-neutral-400 transition"
          >
            {copiado ? "Copiados" : "Copiar"}
          </button>
        </div>
      </div>
      {abierto && (
        <ul className="space-y-1">
          {EVENTOS_WEBHOOK_STRIPE.map(({ evento, porque }) => (
            <li
              key={evento}
              className="text-[12px] bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2"
            >
              <code className="text-neutral-700 break-all">{evento}</code>
              <span className="block text-[11px] text-neutral-400 mt-0.5">{porque}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * El Secret ID de GoCardless (no es secreto de verdad: identifica el par y sin
 * la Secret Key no abre nada, así que se enseña entero — como los ids de
 * Cloudflare). Con las dos piezas puestas, el botón lleva a conectar el banco.
 */
export function BancoIdField({ value, ready, isAdmin, onSave }) {
  const [v, setV] = useState(value ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setV(value ?? ""); }, [value]);
  const sucio = (v ?? "").trim() !== (value ?? "");

  return (
    <div className="mt-4 pt-4 border-t border-neutral-100">
      <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Secret ID</label>
      <p className="text-[11px] text-neutral-400 mt-0.5 mb-2">
        La pareja de la clave: GoCardless los da juntos en «User secrets».
      </p>
      <div className="flex gap-2">
        <input
          disabled={!isAdmin}
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder="p. ej. 1b2f3a4c-…"
          className={inputCls + " font-mono flex-1"}
        />
        {isAdmin && sucio && (
          <button
            onClick={async () => { setBusy(true); try { await onSave(v.trim() || null); } finally { setBusy(false); } }}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-40"
            style={{ background: "var(--color-primary, #1B3A2D)" }}
          >
            {busy ? "..." : "Guardar"}
          </button>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className={`text-[11px] ${ready ? "text-emerald-600" : "text-amber-600"}`}>
          {ready
            ? "Credenciales listas: ya se puede conectar tu banco."
            : "Faltan datos: hacen falta la Secret Key y el Secret ID."}
        </p>
        {ready && (
          <a
            href="/facturacion/banco"
            className="shrink-0 inline-flex items-center px-3 py-2 rounded-lg text-xs font-semibold text-white hover:opacity-90 transition"
            style={{ background: "var(--color-primary, #1B3A2D)" }}
          >
            Conectar tu banco
          </a>
        )}
      </div>
    </div>
  );
}

/** Identificador del número de WhatsApp (no es secreto: se enseña entero). */
export function WhatsappPhoneField({ value, isAdmin, onSave }) {
  const [v, setV] = useState(value ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setV(value ?? ""); }, [value]);
  const sucio = (v ?? "").trim() !== (value ?? "");

  return (
    <div className="mt-4 pt-4 border-t border-neutral-100">
      <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">
        Identificador del número de teléfono
      </label>
      <p className="text-[11px] text-neutral-400 mt-0.5 mb-2">
        No es el número en sí: es el identificador largo que da Meta en la configuración de la API.
      </p>
      <div className="flex gap-2">
        <input
          disabled={!isAdmin}
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder="p. ej. 123456789012345"
          className={inputCls + " font-mono flex-1"}
        />
        {isAdmin && sucio && (
          <button
            onClick={async () => { setBusy(true); try { await onSave(v.trim() || null); } finally { setBusy(false); } }}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-40"
            style={{ background: "var(--color-primary, #1B3A2D)" }}
          >
            {busy ? "..." : "Guardar"}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Los dos identificadores de Cloudflare que acompañan al token.
 *
 * Ninguno es secreto: salen de la barra de direcciones del panel de Cloudflare
 * y por sí solos no dan acceso a nada. El de cuenta es OBLIGATORIO (sin él el
 * token no sabe a qué cuenta preguntar); el de sitio es opcional y solo hace
 * falta cuando la misma cuenta mide varias webs.
 */
export function CloudflareIdsField({ accountId, siteTag, ready, isAdmin, onSaveAccount, onSaveSite }) {
  const [cuenta, setCuenta] = useState(accountId ?? "");
  const [sitio, setSitio] = useState(siteTag ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setCuenta(accountId ?? ""); }, [accountId]);
  useEffect(() => { setSitio(siteTag ?? ""); }, [siteTag]);

  const cuentaSucia = (cuenta ?? "").trim() !== (accountId ?? "");
  const sitioSucio = (sitio ?? "").trim() !== (siteTag ?? "");

  const guardar = async (fn, valor) => {
    setBusy(true);
    try {
      await fn(valor.trim() || null);
    } finally {
      setBusy(false);
    }
  };

  const campo = (etiqueta, ayuda, valor, setValor, sucio, onSave, placeholder) => (
    <div className="mb-3 last:mb-0">
      <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">{etiqueta}</label>
      <p className="text-[11px] text-neutral-400 mt-0.5 mb-2">{ayuda}</p>
      <div className="flex gap-2">
        <input
          disabled={!isAdmin}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder={placeholder}
          className={inputCls + " font-mono flex-1"}
        />
        {isAdmin && sucio && (
          <button
            onClick={() => guardar(onSave, valor)}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-40"
            style={{ background: "var(--color-primary, #1B3A2D)" }}
          >
            {busy ? "..." : "Guardar"}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="mt-4 pt-4 border-t border-neutral-100">
      {campo(
        "Identificador de cuenta (obligatorio)",
        "Es el código que sale en la dirección del panel, justo después de dash.cloudflare.com/",
        cuenta, setCuenta, cuentaSucia, onSaveAccount,
        "p. ej. 70a432e290147ab582ed3d8f2e70498c"
      )}
      {campo(
        "Identificador del sitio (opcional)",
        "Solo si esa cuenta mide varias webs. Se ve en Web Analytics → Administrar sitio, al final de la dirección. Vacío = se suman todas.",
        sitio, setSitio, sitioSucio, onSaveSite,
        "vacío = todos los sitios"
      )}
      <p className={`text-[11px] mt-1 ${ready ? "text-emerald-600" : "text-amber-600"}`}>
        {ready
          ? "Listo: el módulo Analíticas ya puede leer las visitas."
          : "Faltan datos: hacen falta el token y el identificador de cuenta para que Analíticas funcione."}
      </p>
    </div>
  );
}
