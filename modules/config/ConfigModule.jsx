"use client";

import { useEffect, useState } from "react";
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
};

export default function ConfigModule() {
  const [me, setMe] = useState(null);
  const isAdmin = me?.role === "admin" || me?.role === "superadmin";

  const [cfg, setCfg] = useState(null); // /api/tenant/settings
  const [billing, setBilling] = useState(null); // /api/billing/settings (o null si no hay módulo)
  const [errorMsg, setErrorMsg] = useState(null);
  const [okMsg, setOkMsg] = useState(null);

  const flash = (msg) => {
    setOkMsg(msg);
    setTimeout(() => setOkMsg(null), 2500);
  };

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).then((j) => j.ok && setMe(j.data)).catch(() => {});
    fetch("/api/tenant/settings", { cache: "no-store" }).then((r) => r.json()).then((j) => j.ok && setCfg(j.data)).catch((e) => setErrorMsg(e.message));
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
          defaultIrpfRate: Number(billing.defaultIrpfRate),
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
    return <div className="p-4 lg:p-8 text-xs text-neutral-400">Cargando...</div>;
  }

  return (
    <div className="p-4 lg:p-8 max-w-4xl mx-auto space-y-5">
      <div>
        <div className="eyebrow">Cuenta · Configuración</div>
        <h1 className="font-display text-2xl lg:text-3xl text-[var(--ink-900)] mt-1">Configuración</h1>
        <p className="text-xs text-neutral-400 mt-1">Facturación e inteligencia artificial</p>
      </div>

      {errorMsg && <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{errorMsg}</div>}
      {okMsg && <div className="px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-lg text-xs text-emerald-700">{okMsg}</div>}
      {!isAdmin && (
        <div className="px-4 py-3 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-800">
          Solo los administradores pueden modificar la configuración.
        </div>
      )}

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
            <Field label="IRPF por defecto (%)">
              <input disabled={!isAdmin} type="number" min="0" max="100" step="0.01" value={billing.defaultIrpfRate ?? 0} onChange={(e) => setBillingField("defaultIrpfRate", e.target.value)} className={inputCls} />
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
            provider={AI_PROVIDERS.googlePlaces}
            status={cfg.integrations?.googlePlaces}
            isAdmin={isAdmin}
            onSave={(value) => patchTenant({ googlePlacesApiKey: value }, "Clave de Google guardada")}
            onClear={() => patchTenant({ googlePlacesApiKey: null }, "Clave de Google eliminada")}
          />
          <ApiKeyCard
            provider={AI_PROVIDERS.resend}
            status={cfg.integrations?.resend}
            isAdmin={isAdmin}
            onSave={(value) => patchTenant({ resendApiKey: value }, "Clave de Resend guardada")}
            onClear={() => patchTenant({ resendApiKey: null }, "Clave de Resend eliminada")}
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
        </div>
      </div>
    </div>
  );
}

// ── Tarjeta de credencial de IA con tutorial + botón + campo ─────────────────
function ApiKeyCard({ provider, status, isAdmin, onSave, onClear, models, currentModel, onModelChange }) {
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
            placeholder={configured ? "Pega una clave nueva para reemplazarla" : `Pega la clave (${provider.prefix}...)`}
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
