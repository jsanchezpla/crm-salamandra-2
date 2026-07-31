"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Select from "../../components/ui/Select.jsx";
import { ANTHROPIC_MODELS } from "../../lib/ai/anthropicModel.js";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

// Tutoriales de alta de cada credencial de IA. Autoservicio con fricción: el
// cliente sigue los pasos en la plataforma, copia la clave y la pega aquí.
const AI_PROVIDERS = {
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
      'Pulsa "Crear token" y elige "Crear token personalizado" (empezar desde cero).',
      'Añade UN solo permiso: Cuenta · "Analytics de Cloudflare Web" · Lectura. En "Recursos de la cuenta" elige la cuenta de la web.',
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
      'Selecciona estos eventos: checkout.session.completed, checkout.session.expired, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed y charge.refunded.',
      'Crea el punto de conexión y copia su "Secreto de firma" (empieza por whsec_).',
      "Pégalo abajo y pulsa Guardar.",
    ],
    note: "El secreto es distinto en modo prueba y en producción: si cambias de uno a otro, hay que actualizar también este campo.",
  },
};

export default function ConfigModule() {
  const [me, setMe] = useState(null);
  const isAdmin = me?.role === "admin" || me?.role === "superadmin";

  const [cfg, setCfg] = useState(null); // /api/tenant/settings
  const [billing, setBilling] = useState(null); // /api/billing/settings (o null si no hay módulo)
  const [errorMsg, setErrorMsg] = useState(null);
  const [okMsg, setOkMsg] = useState(null);
  const [loadError, setLoadError] = useState(null); // fallo al cargar los ajustes del tenant

  const flash = (msg) => {
    setOkMsg(msg);
    setTimeout(() => setOkMsg(null), 2500);
  };

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).then((j) => j.ok && setMe(j.data)).catch(() => {});
    fetch("/api/tenant/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => (j.ok ? setCfg(j.data) : setLoadError(j.error || "No se pudo cargar la configuración")))
      .catch((e) => setLoadError(e.message));
    // Facturación es opcional: si el tenant no tiene el módulo, el GET responde
    // 403 y simplemente no mostramos esa sección.
    fetch("/api/billing/settings", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => j?.ok && setBilling(j.data)).catch(() => {});
  }, []);

  function setBillingField(k, v) {
    setBilling((b) => ({ ...b, [k]: v }));
  }
  function setResendField(k, v) {
    setCfg((c) => ({ ...c, integrations: { ...c.integrations, resend: { ...c.integrations?.resend, [k]: v } } }));
  }

  async function patchTenant(payload, successMsg) {
    setErrorMsg(null);
    try {
      const r = await fetch("/api/tenant/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Error guardando");
      setCfg((c) => ({ ...c, ...j.data }));
      flash(successMsg);
      return true;
    } catch (e) {
      setErrorMsg(e.message);
      return false;
    }
  }

  async function saveBilling() {
    setErrorMsg(null);
    try {
      const r = await fetch("/api/billing/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fiscalName: billing.fiscalName,
          taxId: billing.taxId,
          fiscalAddress: billing.fiscalAddress,
          fiscalCity: billing.fiscalCity,
          fiscalZip: billing.fiscalZip,
          fiscalCountry: billing.fiscalCountry,
          defaultVatRate: Number(billing.defaultVatRate),
          vatExempt: !!billing.vatExempt,
          vatExemptNote: billing.vatExemptNote ?? null,
          // 3 regímenes: company (SL) / autonomo (sin retención) / freelance
          // (autónomo profesional, −15%). Solo freelance lleva IRPF por defecto.
          taxRegime: ["company", "autonomo", "freelance"].includes(billing.taxRegime) ? billing.taxRegime : "company",
          defaultIrpfRate: billing.taxRegime === "freelance" ? Number(billing.defaultIrpfRate) : 0,
          defaultPaymentTermsDays: Number(billing.defaultPaymentTermsDays),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Error guardando facturación");
      setBilling(j.data);
      flash("Datos de facturación guardados");
    } catch (e) {
      setErrorMsg(e.message);
    }
  }

  if (!cfg) {
    // Distinguir cargando de error: si el GET de ajustes falla (500/401/offline)
    // hay que mostrar el error, no dejar el spinner colgado para siempre.
    return (
      <div className="p-4 lg:p-8 max-w-4xl mx-auto">
        {loadError ? (
          <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{loadError}</div>
        ) : (
          <div className="text-xs text-neutral-400">Cargando...</div>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8 max-w-4xl mx-auto space-y-5">
      <div>
        <div className="eyebrow">Cuenta · Configuración</div>
        <h1 className="font-display text-2xl lg:text-3xl text-[var(--ink-900)] mt-1">Configuración</h1>
        <p className="text-xs text-neutral-400 mt-1">Empresa, facturación e inteligencia artificial</p>
      </div>

      {errorMsg && <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{errorMsg}</div>}
      {okMsg && <div className="px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-lg text-xs text-emerald-700">{okMsg}</div>}
      {!isAdmin && (
        <div className="px-4 py-3 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-800">
          Solo los administradores pueden modificar la configuración.
        </div>
      )}

      {/* ── Descripción de empresa (alimenta Captación) ──────────────────── */}
      <CompanyDescriptionSection isAdmin={isAdmin} flash={flash} onError={setErrorMsg} />

      {/* ── Facturación ──────────────────────────────────────────────────── */}
      {billing && (
        <Section title="Facturación" right={<Link href="/facturacion/configuracion" className="text-[11px] font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">Config. completa →</Link>}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Razón social">
              <input disabled={!isAdmin} value={billing.fiscalName ?? ""} onChange={(e) => setBillingField("fiscalName", e.target.value)} className={inputCls} />
            </Field>
            <Field label="NIF / CIF">
              <input disabled={!isAdmin} value={billing.taxId ?? ""} onChange={(e) => setBillingField("taxId", e.target.value)} className={inputCls} />
            </Field>
            <Field label="Dirección" full>
              <input disabled={!isAdmin} value={billing.fiscalAddress ?? ""} onChange={(e) => setBillingField("fiscalAddress", e.target.value)} className={inputCls} />
            </Field>
            <Field label="Ciudad">
              <input disabled={!isAdmin} value={billing.fiscalCity ?? ""} onChange={(e) => setBillingField("fiscalCity", e.target.value)} className={inputCls} />
            </Field>
            <Field label="Código postal">
              <input disabled={!isAdmin} value={billing.fiscalZip ?? ""} onChange={(e) => setBillingField("fiscalZip", e.target.value)} className={inputCls} />
            </Field>
            <Field label="País (ISO 2)">
              <input disabled={!isAdmin} maxLength={2} value={billing.fiscalCountry ?? ""} onChange={(e) => setBillingField("fiscalCountry", e.target.value.toUpperCase())} className={inputCls} />
            </Field>
            <Field label="IVA por defecto">
              <Select disabled={!isAdmin} value={Number(billing.defaultVatRate)} onChange={(v) => setBillingField("defaultVatRate", Number(v))} options={(billing.availableVatRates ?? [21, 10, 4, 0]).map((v) => ({ value: Number(v), label: `${v}%` }))} className={inputCls} />
            </Field>
            <Field label="Exención de IVA" full>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" disabled={!isAdmin} checked={!!billing.vatExempt} onChange={(e) => setBillingField("vatExempt", e.target.checked)} className="h-4 w-4 accent-[var(--color-primary,#1B3A2D)]" />
                <span className="text-sm text-neutral-700">Mis servicios están exentos de IVA (no repercuto IVA)</span>
              </label>
              {billing.vatExempt ? (
                <div className="mt-2">
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">Nota legal de exención (aparece en la factura)</label>
                  <textarea disabled={!isAdmin} rows={2} value={billing.vatExemptNote ?? ""} onChange={(e) => setBillingField("vatExemptNote", e.target.value)} className={inputCls} />
                  <p className="text-[11px] text-neutral-400 mt-1">Con esto activo, las nuevas facturas nacen a IVA 0 y llevan esta nota. El «IVA por defecto» de arriba se ignora.</p>
                </div>
              ) : (
                <p className="text-[11px] text-neutral-400 mt-1">Actívalo si nunca repercutes IVA (p. ej. sanidad/educación): las facturas saldrán sin IVA con su nota legal.</p>
              )}
            </Field>
            <Field label="¿Cómo facturas? (régimen fiscal)" full>
              {/* 3 regímenes. Solo "Autónomo profesional" aplica retención de
                  IRPF (−15% por defecto); "Autónomo" a secas (actividad
                  empresarial) factura sin retención, igual que una SL. */}
              {(() => {
                const regime = ["company", "autonomo", "freelance"].includes(billing.taxRegime) ? billing.taxRegime : "company";
                const btnCls = (active) =>
                  `px-3 py-1.5 rounded-lg text-sm border transition disabled:opacity-60 ${
                    active ? "border-transparent text-white" : "border-neutral-200 text-neutral-500 hover:bg-neutral-50"
                  }`;
                const btnStyle = (active) => (active ? { backgroundColor: "var(--color-primary, #1B3A2D)" } : undefined);
                return (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      {/* company/autonomo NO tocan defaultIrpfRate: se conserva
                          el % que tuviera el tenant (saveBilling ya manda 0 al
                          guardar si el régimen no es freelance), así volver a
                          "Autónomo profesional" recupera el % personalizado. */}
                      <button
                        type="button"
                        disabled={!isAdmin}
                        onClick={() => setBillingField("taxRegime", "company")}
                        className={btnCls(regime === "company")}
                        style={btnStyle(regime === "company")}
                      >
                        Empresa / SL
                      </button>
                      <button
                        type="button"
                        disabled={!isAdmin}
                        onClick={() => setBillingField("taxRegime", "autonomo")}
                        className={btnCls(regime === "autonomo")}
                        style={btnStyle(regime === "autonomo")}
                      >
                        Autónomo (sin −15%)
                      </button>
                      <button
                        type="button"
                        disabled={!isAdmin}
                        onClick={() => { setBillingField("taxRegime", "freelance"); if (!(Number(billing.defaultIrpfRate) > 0)) setBillingField("defaultIrpfRate", 15); }}
                        className={btnCls(regime === "freelance")}
                        style={btnStyle(regime === "freelance")}
                      >
                        Autónomo profesional (−15% IRPF)
                      </button>
                      {regime === "freelance" && (
                        <div className="flex items-center gap-1.5">
                          <input disabled={!isAdmin} type="number" min="0" max="100" step="0.01" value={billing.defaultIrpfRate ?? 15} onChange={(e) => setBillingField("defaultIrpfRate", e.target.value)} className={`${inputCls} w-20`} />
                          <span className="text-xs text-neutral-500">% IRPF</span>
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] text-neutral-400 mt-1">
                      {regime === "freelance"
                        ? "Se restará este IRPF por defecto en tus facturas (ajustable en cada factura)."
                        : regime === "autonomo"
                          ? "Autónomo con actividad empresarial: factura SIN retención de IRPF."
                          : "Sin retención de IRPF por defecto (lo habitual en SL / empresa)."}
                    </p>
                  </>
                );
              })()}
            </Field>
            <Field label="Días de vencimiento">
              <input disabled={!isAdmin} type="number" min="0" value={billing.defaultPaymentTermsDays ?? 30} onChange={(e) => setBillingField("defaultPaymentTermsDays", e.target.value)} className={inputCls} />
            </Field>
          </div>
          {isAdmin && (
            <div className="flex justify-end mt-4">
              <PrimaryButton onClick={saveBilling}>Guardar facturación</PrimaryButton>
            </div>
          )}
        </Section>
      )}

      {/* ── Inteligencia Artificial ──────────────────────────────────────── */}
      <div>
        <h2 className="eyebrow mb-1">Inteligencia Artificial</h2>
        <p className="text-xs text-neutral-400 mb-3">
          Conecta las credenciales del tenant. Se guardan cifradas del lado del servidor y nunca se muestran enteras.
        </p>
        <div className="space-y-4">
          <ApiKeyCard
            provider={AI_PROVIDERS.anthropic}
            status={cfg.integrations?.anthropic}
            isAdmin={isAdmin}
            onSave={(value) => patchTenant({ anthropicApiKey: value }, "Clave de Anthropic guardada")}
            onClear={() => patchTenant({ anthropicApiKey: null }, "Clave de Anthropic eliminada")}
            models={ANTHROPIC_MODELS}
            currentModel={cfg.integrations?.anthropic?.model}
            onModelChange={(v) => patchTenant({ anthropicModel: v }, "Modelo de IA actualizado")}
          />
          <ApiKeyCard
            provider={AI_PROVIDERS.openai}
            status={cfg.integrations?.openai}
            isAdmin={isAdmin}
            onSave={(value) => patchTenant({ openaiApiKey: value }, "Clave de OpenAI guardada")}
            onClear={() => patchTenant({ openaiApiKey: null }, "Clave de OpenAI eliminada")}
          />
          <ApiKeyCard
            provider={AI_PROVIDERS.whatsapp}
            status={cfg.integrations?.whatsapp}
            isAdmin={isAdmin}
            onSave={(value) => patchTenant({ whatsappToken: value }, "Token de WhatsApp guardado")}
            onClear={() => patchTenant({ whatsappToken: null }, "Token de WhatsApp eliminado")}
            extra={
              <WhatsappPhoneField
                value={cfg.integrations?.whatsapp?.phoneNumberId ?? ""}
                isAdmin={isAdmin}
                onSave={(v) => patchTenant({ whatsappPhoneNumberId: v }, "Número de WhatsApp guardado")}
              />
            }
          />
          <ApiKeyCard
            provider={AI_PROVIDERS.googlePlaces}
            status={cfg.integrations?.googlePlaces}
            isAdmin={isAdmin}
            onSave={(value) => patchTenant({ googlePlacesApiKey: value }, "Clave de Google guardada")}
            onClear={() => patchTenant({ googlePlacesApiKey: null }, "Clave de Google eliminada")}
          />
          <ApiKeyCard
            provider={AI_PROVIDERS.cloudflare}
            status={cfg.integrations?.cloudflare}
            isAdmin={isAdmin}
            onSave={(value) => patchTenant({ cloudflareApiToken: value }, "Token de Cloudflare guardado")}
            onClear={() => patchTenant({ cloudflareApiToken: null }, "Token de Cloudflare eliminado")}
            extra={
              <CloudflareIdsField
                accountId={cfg.integrations?.cloudflare?.accountId ?? ""}
                siteTag={cfg.integrations?.cloudflare?.siteTag ?? ""}
                ready={cfg.integrations?.cloudflare?.ready}
                isAdmin={isAdmin}
                onSaveAccount={(v) => patchTenant({ cloudflareAccountId: v }, "Cuenta de Cloudflare guardada")}
                onSaveSite={(v) => patchTenant({ cloudflareSiteTag: v }, "Sitio de Cloudflare guardado")}
              />
            }
          />
          <ApiKeyCard
            provider={AI_PROVIDERS.resend}
            status={cfg.integrations?.resend}
            isAdmin={isAdmin}
            onSave={(value) => patchTenant({ resendApiKey: value }, "Clave de Resend guardada")}
            onClear={() => patchTenant({ resendApiKey: null }, "Clave de Resend eliminada")}
          />

          {/* ── Cobro online ────────────────────────────────────────────────
              Hasta ahora estas claves solo se podían meter con un script por
              SSH, lo que convertía "activar el cobro" en una tarea nuestra. */}
          <EstadoCobro status={cfg.integrations?.stripe} />
          <ApiKeyCard
            provider={AI_PROVIDERS.stripeSecret}
            status={cfg.integrations?.stripe}
            isAdmin={isAdmin}
            onSave={(value) => patchTenant({ stripeSecretKey: value }, "Clave de Stripe guardada")}
            onClear={() => patchTenant({ stripeSecretKey: null }, "Clave de Stripe eliminada")}
          />
          <ApiKeyCard
            provider={AI_PROVIDERS.stripeWebhook}
            // El webhook solo tiene un sí/no: su valor no se devuelve nunca, ni
            // enmascarado, porque no aporta nada y es un secreto de firma.
            status={{ configured: !!cfg.integrations?.stripe?.webhook, hint: null }}
            isAdmin={isAdmin}
            onSave={(value) => patchTenant({ stripeWebhookSecret: value }, "Secreto del webhook guardado")}
            onClear={() => patchTenant({ stripeWebhookSecret: null }, "Secreto del webhook eliminado")}
            extra={<UrlWebhook slug={cfg.slug} />}
          />

          {/* Remitente + reply-to del correo de captación (no son secretos). */}
          <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
            <h3 className="font-display text-lg text-[var(--ink-900)]">Remitente del correo de captación</h3>
            <p className="text-xs text-neutral-500 mt-1">
              De qué dirección salen los correos en frío y a dónde llegan las respuestas. El remitente debe ser de un
              dominio verificado en tu cuenta de Resend. Déjalo vacío para usar el valor por defecto del sistema.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
              <Field label="Remitente (from)">
                <input
                  disabled={!isAdmin}
                  value={cfg.integrations?.resend?.fromEmail ?? ""}
                  onChange={(e) => setResendField("fromEmail", e.target.value)}
                  placeholder="hola@tudominio.com"
                  className={inputCls}
                />
              </Field>
              <Field label="Responder a (reply-to)">
                <input
                  disabled={!isAdmin}
                  value={cfg.integrations?.resend?.replyTo ?? ""}
                  onChange={(e) => setResendField("replyTo", e.target.value)}
                  placeholder="info@tudominio.com"
                  className={inputCls}
                />
              </Field>
            </div>
            {isAdmin && (
              <div className="flex justify-end mt-3">
                <PrimaryButton
                  onClick={() =>
                    patchTenant(
                      {
                        resendFromEmail: cfg.integrations?.resend?.fromEmail ?? "",
                        resendReplyTo: cfg.integrations?.resend?.replyTo ?? "",
                      },
                      "Remitente guardado"
                    )
                  }
                >
                  Guardar remitente
                </PrimaryButton>
              </div>
            )}
          </div>

          {isAdmin && (
            <RecordatoriosCard
              activo={!!cfg.recordatoriosCitas}
              readOnly={!!cfg.readOnly}
              onChange={(v) => patchTenant({ recordatoriosCitas: v }, v ? "Recordatorios activados" : "Recordatorios desactivados")}
            />
          )}

          {isAdmin && (
            <AgendaCompartidaCard
              activo={!!cfg.agendaCompartida}
              readOnly={!!cfg.readOnly}
              onChange={(v) => patchTenant({ agendaCompartida: v }, v ? "Todo el equipo verá la agenda completa" : "Cada profesional volverá a ver solo su agenda")}
            />
          )}

          {isAdmin && (
            <VideollamadaCard
              meetModo={cfg.meetModo}
              readOnly={!!cfg.readOnly}
              onChange={(v) => patchTenant({ meetModo: v }, v === "automatico" ? "Las citas online heredarán el enlace del tipo de cita" : "El enlace de videollamada se pondrá a mano en cada cita")}
            />
          )}

          {isAdmin && (
            <AiPermissionsCard
              aiAccess={cfg.aiAccess}
              readOnly={!!cfg.readOnly}
              onToggle={(v) => patchTenant({ aiAccess: v }, v === "restringido" ? "La IA ahora requiere tu permiso" : "La IA vuelve a ser libre para el equipo")}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Tarjeta de credencial de IA con tutorial + botón + campo ─────────────────
/**
 * Permisos de IA — el candado para empleados.
 *
 * Con el candado puesto (aiAccess = "restringido"), un empleado que dispare
 * una acción de IA genera una solicitud que cae aquí: el admin la concede
 * (para siempre o para una sola vez), la deniega, o revoca lo concedido.
 * Los avisos van por la campana en ambos sentidos.
 */
function AiPermissionsCard({ aiAccess, readOnly, onToggle }) {
  const [datos, setDatos] = useState(null);
  const [err, setErr] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const restringido = aiAccess === "restringido";

  const cargar = useCallback(() => {
    fetch("/api/ai-permisos", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j.ok) setDatos(j.data); else setErr(j.error || "Error"); })
      .catch(() => setErr("No se pudieron cargar los permisos"));
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  async function decidir(id, decision) {
    setBusyId(id); setErr(null);
    try {
      const r = await fetch(`/api/ai-permisos/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo guardar la decisión");
      cargar();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyId(null);
    }
  }

  const btn = "px-2.5 py-1 rounded-md text-[11px] font-semibold border transition disabled:opacity-40";

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-neutral-800">Permisos de IA del equipo</div>
          <p className="text-xs text-neutral-400 mt-0.5 max-w-md">
            La IA consume tu clave (cuesta dinero). Con el candado puesto, los empleados
            necesitan tu permiso para usarla: al intentarlo te llega una solicitud a la campana
            y decides si es para siempre o para una sola vez. Los administradores nunca lo necesitan.
          </p>
        </div>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onToggle(restringido ? "libre" : "restringido")}
          className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 ${restringido ? "bg-[var(--color-primary,#1B3A2D)]" : "bg-neutral-300"}`}
          aria-label={restringido ? "Quitar el candado de la IA" : "Poner candado a la IA"}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${restringido ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>
      <div className="mt-1 text-[11px] font-medium">
        {restringido
          ? <span className="text-amber-700">Candado puesto: los empleados piden permiso.</span>
          : <span className="text-neutral-400">Sin candado: todo el equipo puede usar la IA.</span>}
      </div>

      {err && <div className="mt-3 text-xs text-red-600">{err}</div>}

      {datos && (datos.pendientes.length > 0 || datos.concedidos.length > 0) && (
        <div className="mt-4 space-y-4">
          {datos.pendientes.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-2">
                Solicitudes pendientes
              </div>
              <ul className="divide-y divide-neutral-100 border border-neutral-100 rounded-lg overflow-hidden">
                {datos.pendientes.map((p) => (
                  <li key={p.id} className="px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap bg-amber-50/40">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-neutral-800 truncate">{p.usuario}</div>
                      <div className="text-[11px] text-neutral-500">
                        {p.accion || "usar la IA"} · {new Date(p.solicitadaEl).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button disabled={busyId === p.id} onClick={() => decidir(p.id, "conceder-general")}
                        className={`${btn} text-white border-transparent`} style={{ background: "var(--color-primary, #1B3A2D)" }}>
                        Siempre
                      </button>
                      <button disabled={busyId === p.id} onClick={() => decidir(p.id, "conceder-una-vez")}
                        className={`${btn} border-neutral-300 text-neutral-700 hover:bg-neutral-50`}>
                        Solo una vez
                      </button>
                      <button disabled={busyId === p.id} onClick={() => decidir(p.id, "denegar")}
                        className={`${btn} border-red-200 text-red-600 hover:bg-red-50`}>
                        Denegar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {datos.concedidos.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-2">
                Permisos concedidos
              </div>
              <ul className="divide-y divide-neutral-100 border border-neutral-100 rounded-lg overflow-hidden">
                {datos.concedidos.map((p) => (
                  <li key={p.id} className="px-3 py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-neutral-800 truncate">{p.usuario}</div>
                      <div className="text-[11px] text-neutral-500">
                        {p.scope === "general" ? "Para siempre" : "Un solo uso (sin gastar)"}
                        {p.decididaPor ? ` · concedido por ${p.decididaPor}` : ""}
                      </div>
                    </div>
                    <button disabled={busyId === p.id} onClick={() => decidir(p.id, "revocar")}
                      className={`${btn} border-red-200 text-red-600 hover:bg-red-50 shrink-0`}>
                      Revocar
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {restringido && datos && datos.pendientes.length === 0 && datos.concedidos.length === 0 && (
        <p className="mt-3 text-[11px] text-neutral-400">
          Nadie ha pedido permiso todavía. Cuando un empleado intente usar la IA, su solicitud aparecerá aquí.
        </p>
      )}
    </div>
  );
}

/** Identificador del número de WhatsApp (no es secreto: se enseña entero). */
function WhatsappPhoneField({ value, isAdmin, onSave }) {
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
function CloudflareIdsField({ accountId, siteTag, ready, isAdmin, onSaveAccount, onSaveSite }) {
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

/**
 * Cómo consigue su enlace una cita online. Por defecto MANUAL: la cita nace
 * sin enlace, la profesional lo pega y pulsa «Guardar y enviar». Automático es
 * para quien tiene sala de videollamada contratada y la ha puesto en el tipo
 * de cita: la cita lo hereda sola.
 */
/**
 * Recordatorio automático la víspera de la cita. APAGADO por defecto: al
 * encenderlo empiezan a salir correos hacia pacientes reales, y esa decisión
 * es del cliente, no del CRM.
 */
function AgendaCompartidaCard({ activo, readOnly, onChange }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-neutral-800">Agenda compartida</div>
          <p className="text-xs text-neutral-400 mt-0.5 max-w-lg">
            Que cada profesional vea las citas de TODO el equipo, no solo las suyas. Útil en un
            centro donde se cubren entre compañeras y hay que cuadrar recuperaciones sin
            preguntar. Con el interruptor apagado, cada una ve únicamente su agenda.
          </p>
        </div>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onChange(!activo)}
          className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 ${activo ? "bg-[var(--color-primary,#1B3A2D)]" : "bg-neutral-300"}`}
          aria-label={activo ? "Desactivar agenda compartida" : "Activar agenda compartida"}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${activo ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>
      <div className="mt-1 text-[11px] font-medium">
        {activo
          ? <span className="text-emerald-700">Activa: todo el equipo ve la agenda completa.</span>
          : <span className="text-neutral-400">Apagada: cada profesional ve solo sus citas.</span>}
      </div>
      <p className="text-[10px] text-neutral-400 mt-2">
        Ojo: el listado de citas enseña <strong>nombre, email y teléfono</strong> del paciente. Al
        encenderlo, esos datos quedan a la vista de toda la plantilla.
      </p>
    </div>
  );
}

function RecordatoriosCard({ activo, readOnly, onChange }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-neutral-800">Recordatorio de cita</div>
          <p className="text-xs text-neutral-400 mt-0.5 max-w-lg">
            Un correo automático el día antes, con la hora, el sitio (o el enlace de videollamada)
            y un botón para avisar si no puede venir. Reduce las citas a las que no se presenta
            nadie, que es una hora perdida que no se recupera.
          </p>
        </div>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onChange(!activo)}
          className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 ${activo ? "bg-[var(--color-primary,#1B3A2D)]" : "bg-neutral-300"}`}
          aria-label={activo ? "Desactivar recordatorios" : "Activar recordatorios"}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${activo ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>
      <div className="mt-1 text-[11px] font-medium">
        {activo
          ? <span className="text-emerald-700">Activo: se envía a las citas confirmadas del día siguiente.</span>
          : <span className="text-neutral-400">Apagado: no se manda ningún recordatorio.</span>}
      </div>
      <p className="text-[10px] text-neutral-400 mt-2">
        Solo a citas <strong>confirmadas</strong> y con email. Cada persona recibe uno y solo uno.
        Las citas pendientes de confirmar no reciben recordatorio.
      </p>
    </div>
  );
}

function VideollamadaCard({ meetModo, readOnly, onChange }) {
  const auto = meetModo === "automatico";
  const opciones = [
    {
      id: "manual",
      titulo: "A mano (recomendado)",
      desc: "La cita se crea sin enlace. Lo pegas en su ficha y pulsas «Guardar y enviar» para que le llegue al paciente por email.",
    },
    {
      id: "automatico",
      titulo: "Automático (sala fija)",
      desc: "Si tienes sala de videollamada contratada (Google Meet, Zoom…) y su enlace puesto en el tipo de cita, la cita lo hereda sola y el paciente lo recibe al confirmar.",
    },
  ];

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="text-sm font-semibold text-neutral-800">Enlace de videollamada</div>
      <p className="text-xs text-neutral-400 mt-0.5 mb-3 max-w-xl">
        Solo afecta a las citas online del módulo de Citas.
      </p>
      <div className="space-y-2">
        {opciones.map((o) => {
          const activa = (o.id === "automatico") === auto;
          return (
            <label
              key={o.id}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${
                activa ? "border-[var(--color-primary,#1B3A2D)] bg-neutral-50/60" : "border-neutral-200 hover:border-neutral-300"
              } ${readOnly ? "opacity-60 cursor-not-allowed" : ""}`}
            >
              <input
                type="radio"
                name="meetModo"
                checked={activa}
                disabled={readOnly}
                onChange={() => onChange(o.id)}
                className="mt-0.5 accent-[var(--color-primary,#1B3A2D)]"
              />
              <div>
                <div className="text-sm font-medium text-neutral-800">{o.titulo}</div>
                <div className="text-[11px] text-neutral-500 leading-snug">{o.desc}</div>
              </div>
            </label>
          );
        })}
      </div>
      <p className="text-[10px] text-neutral-400 mt-3">
        El modo automático reutiliza el enlace de sala fija del tipo de cita. Crear salas nuevas en Google
        automáticamente requiere conectar Google Calendar, que todavía no está disponible.
      </p>
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
function EstadoCobro({ status }) {
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
function UrlWebhook({ slug }) {
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

function ApiKeyCard({ provider, status, isAdmin, onSave, onClear, models, currentModel, onModelChange, extra }) {
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

// ── Descripción de empresa: descripción general + líneas de negocio ──────────
// Reutiliza los datos del módulo Outreach (OutreachSettings.companyContext y
// OutreachBusinessLine). Es lo que Captación usa para analizar sin volver a
// pedir las líneas: la descripción encabeza el prompt y cada línea se puntúa.
// Solo se muestra si el tenant tiene el módulo Outreach (GET responde 403 si no).
function CompanyDescriptionSection({ isAdmin, flash, onError }) {
  const [available, setAvailable] = useState(null); // null = cargando, false = oculto, true = mostrar
  const [companyContext, setCompanyContext] = useState("");
  const [ctxDirty, setCtxDirty] = useState(false);
  const [lines, setLines] = useState([]);
  const [linesLoaded, setLinesLoaded] = useState(false); // ¿resolvió el GET de líneas?
  const [linesError, setLinesError] = useState(null); // fallo al cargar las líneas
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/outreach/settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => {
        if (!alive) return;
        setCompanyContext(j.data?.settings?.companyContext ?? "");
        setAvailable(true);
      })
      .catch(() => alive && setAvailable(false));
    // Si este GET falla no debe verse como "no hay líneas" (falso vacío): se
    // distingue cargando / error / vacío real. Además, sin la lista real no se
    // ofrece "Añadir" (el slug se deduplica contra la lista y podría colisionar).
    fetch("/api/outreach/business-lines?all=true", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("No se pudieron cargar las líneas de negocio"))))
      .then((j) => {
        if (!alive) return;
        if (j?.ok) setLines(j.data?.items ?? []);
        else throw new Error("No se pudieron cargar las líneas de negocio");
      })
      .catch((e) => alive && setLinesError(e.message))
      .finally(() => alive && setLinesLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  async function saveContext() {
    try {
      const r = await fetch("/api/outreach/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyContext: companyContext.trim() || null }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Error guardando");
      setCtxDirty(false);
      flash("Descripción de empresa guardada");
    } catch (e) {
      onError(e.message);
    }
  }

  // La clave es un id estable e inmutable (los análisis la referencian). Se
  // deriva del título para que el usuario no tenga que inventarla.
  function slugify(name) {
    let base = name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // quita diacríticos (á → a)
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/_+/g, "_");
    if (!base) base = "linea";
    // `key` es STRING(64) con regex [a-z0-9_]. Recorta (y limpia el _ final) para
    // que un título largo no desborde la columna; deja hueco al sufijo _NN.
    base = base.slice(0, 56).replace(/_+$/, "") || "linea";
    const taken = new Set(lines.map((l) => l.key));
    let key = base;
    let n = 2;
    while (taken.has(key)) key = `${base}_${n++}`;
    return key;
  }

  async function addLine({ name, description }) {
    try {
      const r = await fetch("/api/outreach/business-lines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: slugify(name),
          name: name.trim(),
          description: description.trim() || null,
          sortOrder: lines.length,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Error creando la línea");
      setLines((ls) => [...ls, j.data]);
      setShowAdd(false);
      flash("Línea de negocio creada");
      return true;
    } catch (e) {
      onError(e.message);
      return false;
    }
  }

  async function saveLine(id, patch) {
    try {
      const r = await fetch(`/api/outreach/business-lines/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Error guardando la línea");
      setLines((ls) => ls.map((l) => (l.id === id ? j.data : l)));
      flash("Línea guardada");
      return true;
    } catch (e) {
      onError(e.message);
      return false;
    }
  }

  if (available !== true) return null;

  return (
    <Section
      title="Descripción de empresa"
      right={
        <Link
          href="/outreach/configuracion"
          className="text-[11px] font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors"
        >
          Config. avanzada →
        </Link>
      }
    >
      <p className="text-xs text-neutral-500 -mt-1 mb-4">
        La captación usa esto para analizar empresas automáticamente: la descripción general encabeza el análisis y
        cada línea de negocio es un servicio contra el que se puntúa a cada lead.
      </p>

      {/* Descripción general */}
      <Field label="Descripción general de la empresa" full>
        <textarea
          disabled={!isAdmin}
          rows={4}
          value={companyContext}
          onChange={(e) => {
            setCompanyContext(e.target.value);
            setCtxDirty(true);
          }}
          placeholder="A qué se dedica la empresa, a quién vende y qué la diferencia. La IA lo lee para analizar cada lead."
          className={inputCls}
        />
      </Field>
      {isAdmin && ctxDirty && (
        <div className="flex justify-end mt-2">
          <PrimaryButton onClick={saveContext}>Guardar descripción</PrimaryButton>
        </div>
      )}

      {/* Líneas de negocio */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[11px] font-semibold text-neutral-400 uppercase tracking-widest">Líneas de negocio</h3>
          {isAdmin && !showAdd && !linesError && linesLoaded && (
            <button
              onClick={() => setShowAdd(true)}
              className="text-[11px] font-semibold text-neutral-500 hover:text-neutral-800 transition-colors"
            >
              + Añadir línea
            </button>
          )}
        </div>

        {linesError ? (
          <p className="text-xs text-rose-600 py-3">{linesError}</p>
        ) : !linesLoaded ? (
          <p className="text-xs text-neutral-400 py-3">Cargando líneas…</p>
        ) : lines.length === 0 && !showAdd ? (
          <p className="text-xs text-neutral-400 py-3">Aún no hay líneas de negocio. Añade la primera.</p>
        ) : null}

        <div className="space-y-2">
          {lines.map((line) => (
            <BusinessLineRow key={line.id} line={line} isAdmin={isAdmin} onSave={saveLine} />
          ))}
        </div>

        {showAdd && <AddBusinessLine onAdd={addLine} onCancel={() => setShowAdd(false)} />}
      </div>
    </Section>
  );
}

// Fila plegable de línea de negocio: cabecera con título + estado; al abrir,
// edición de título, descripción y activa.
function BusinessLineRow({ line, isAdmin, onSave }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(line.name ?? "");
  const [description, setDescription] = useState(line.description ?? "");
  const [active, setActive] = useState(line.active !== false);
  const [busy, setBusy] = useState(false);

  const dirty = name !== (line.name ?? "") || description !== (line.description ?? "") || active !== (line.active !== false);

  async function handleSave() {
    if (!name.trim()) return;
    setBusy(true);
    // Enviar y adoptar los valores normalizados (trim) que persiste el server,
    // para que el botón Guardar no quede "sucio" tras un guardado correcto.
    const nextName = name.trim();
    const nextDescription = description.trim() || null;
    const okDone = await onSave(line.id, { name: nextName, description: nextDescription, active });
    if (okDone) {
      setName(nextName);
      setDescription(nextDescription ?? "");
    }
    setBusy(false);
  }

  return (
    <div className="border border-neutral-200 rounded-lg bg-white overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-neutral-50 transition-colors"
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${line.active !== false ? "bg-emerald-500" : "bg-neutral-300"}`} />
        <span className="text-sm text-neutral-700 font-medium truncate flex-1">{line.name}</span>
        {line.active === false && <span className="text-[10px] text-neutral-400 uppercase tracking-wide">inactiva</span>}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-4 h-4 text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-neutral-100 space-y-3">
          <Field label="Título" full>
            <input disabled={!isAdmin} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Descripción (qué vende esta línea)" full>
            <textarea disabled={!isAdmin} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} placeholder="La IA lo lee literalmente para puntuar a cada lead." />
          </Field>
          {isAdmin && (
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-xs text-neutral-600 select-none cursor-pointer">
                <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-[var(--color-primary,#1B3A2D)]" />
                Línea activa (se puntúa y aparece en las fichas)
              </label>
              <button
                onClick={handleSave}
                disabled={busy || !dirty || !name.trim()}
                className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-40"
                style={{ background: "var(--color-primary, #1B3A2D)" }}
              >
                {busy ? "..." : "Guardar"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Formulario inline para crear una línea de negocio nueva.
function AddBusinessLine({ onAdd, onCancel }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleAdd() {
    if (!name.trim()) return;
    setBusy(true);
    const done = await onAdd({ name, description });
    setBusy(false);
    if (done) {
      setName("");
      setDescription("");
    }
  }

  return (
    <div className="mt-2 border border-dashed border-neutral-300 rounded-lg bg-neutral-50 p-3 space-y-3">
      <Field label="Título" full>
        <input autoFocus maxLength={120} value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Ej. Diseño web" />
      </Field>
      <Field label="Descripción (qué vende esta línea)" full>
        <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} placeholder="La IA lo lee literalmente para puntuar a cada lead." />
      </Field>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-2 rounded-lg text-xs font-semibold text-neutral-500 border border-neutral-200 hover:bg-white">
          Cancelar
        </button>
        <button
          onClick={handleAdd}
          disabled={busy || !name.trim()}
          className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-40"
          style={{ background: "var(--color-primary, #1B3A2D)" }}
        >
          {busy ? "..." : "Crear línea"}
        </button>
      </div>
    </div>
  );
}

// ── Helpers de estilo (mismos que la config de facturación) ──────────────────
function Section({ title, right, children }) {
  return (
    <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="eyebrow">{title}</h2>
        {right}
      </div>
      {children}
    </div>
  );
}
function Field({ label, children, full }) {
  return (
    <div className={`flex flex-col gap-1 ${full ? "sm:col-span-2" : ""}`}>
      <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">{label}</label>
      {children}
    </div>
  );
}
function PrimaryButton({ onClick, children }) {
  return (
    <button onClick={onClick} className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white"
      style={{ background: "var(--color-primary, #1B3A2D)" }}>
      {children}
    </button>
  );
}
