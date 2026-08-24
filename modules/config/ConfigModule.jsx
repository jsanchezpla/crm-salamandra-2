"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import HelpTooltip from "../../components/ui/HelpTooltip.jsx";
import Link from "next/link";
import Select from "../../components/ui/Select.jsx";
import ConectarWhatsapp from "./ConectarWhatsapp.jsx";
import { ANTHROPIC_MODELS } from "../../lib/ai/anthropicModel.js";
import { COLOR_BLOQUEO_POR_DEFECTO, colorTextoSobre } from "../../lib/citas/coloresBloqueo.js";
import { EVENTOS_WEBHOOK_STRIPE } from "../../lib/payments/eventosWebhook.js";
import { anchoPantalla } from "@/components/layout/anchoPantalla.js";
import {
  PESTANAS,
  PESTANA_POR_DEFECTO,
  avisoDePestana,
  avisoDeTarjeta,
  esPestanaValida,
  etiquetaDeModulo,
} from "../../lib/configuracion/pestanas.js";

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

/**
 * `modulos` viene de la página (servidor): la lista de moduleKeys activos, o
 * `null` si no se pudo averiguar. Sirve solo para ATENUAR y explicar las
 * tarjetas cuyo módulo no está contratado — todas se siguen pudiendo rellenar,
 * porque la Configuración es universal (regla #14).
 */
export default function ConfigModule({ modulos = null }) {
  const [me, setMe] = useState(null);
  const isAdmin = me?.role === "admin" || me?.role === "superadmin";

  // `null` = no se sabe, y entonces no se avisa de nada: un aviso falso manda a
  // alguien a pedir un módulo que ya tiene.
  const tieneModulo = useMemo(() => {
    if (!Array.isArray(modulos)) return null;
    const activos = new Set(modulos);
    return (k) => activos.has(k);
  }, [modulos]);

  // La pestaña abierta viaja en la URL (?zona=conexiones) para poder enlazar
  // «mira esto» a un sitio concreto en vez de «baja hasta que lo veas». Se
  // valida contra el catálogo: lo que llegue raro cae en la primera.
  const [pestana, setPestana] = useState(PESTANA_POR_DEFECTO);
  useEffect(() => {
    const pedida = new URLSearchParams(window.location.search).get("zona");
    if (esPestanaValida(pedida)) setPestana(pedida);
  }, []);
  const irA = useCallback((clave) => {
    setPestana(clave);
    const url = new URL(window.location.href);
    url.searchParams.set("zona", clave);
    // `replaceState` y no `push`: cambiar de pestaña no es navegar, y llenar el
    // historial obligaría a dar seis veces atrás para salir de Configuración.
    window.history.replaceState(null, "", url);
    window.scrollTo({ top: 0 });
  }, []);

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

  function setStripeField(k, v) {
    setCfg((c) => ({ ...c, integrations: { ...c.integrations, stripe: { ...c.integrations?.stripe, [k]: v } } }));
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

  /*
   * ── QUIEN NO ES ADMIN VE ESTA PANTALLA, PERO SOLO SU CUENTA (24/08/2026) ──
   * `GET /api/tenant/settings` es solo de admin a propósito: devuelve pistas
   * enmascaradas de las claves de IA. Eso no se toca. Pero hasta hoy su 403
   * dejaba a un no-admin con un cartel rojo y nada más, y con la contraseña
   * viviendo aquí dentro eso dejaba fuera justo a quien la necesita: de los 24
   * usuarios de clientes reales, 16 tienen rol `user` — 15 de ellos en Aumenta.
   *
   * Así que el 403 deja de ser un error y pasa a ser una respuesta: se pinta la
   * pantalla con la ÚNICA zona que es suya. El endpoint sigue diciendo que no,
   * y ni una clave sale de él; lo que cambia es lo que hace la pantalla cuando
   * se lo dicen.
   *
   * Se distingue por el rol y no por el texto del error: leer el mensaje para
   * decidir es la forma de que un día lo reescriban y esto se rompa en silencio.
   */
  const soloSuCuenta = me && !isAdmin;

  if (!cfg && !soloSuCuenta) {
    // Distinguir cargando de error: si el GET de ajustes falla (500/401/offline)
    // hay que mostrar el error, no dejar el spinner colgado para siempre.
    return (
      <div className={anchoPantalla("ajustes")}>
        {loadError ? (
          <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{loadError}</div>
        ) : (
          <div className="text-xs text-neutral-400">Cargando...</div>
        )}
      </div>
    );
  }

  /*
   * Para quien no es admin solo existe una zona, y `pestanaViva` la fuerza.
   *
   * Es lo que impide que el resto del render se ejecute con `cfg` a null: todos
   * los bloques de abajo leen `cfg.loQueSea`, y sin este ancla la pantalla se
   * abriría por «Empresa» —que es la pestaña por defecto— y reventaría antes de
   * pintar nada. Se ancla aquí, en un sitio, en vez de poner un `cfg?.` en las
   * doscientas lecturas de abajo.
   */
  const pestanasVisibles = soloSuCuenta ? PESTANAS.filter((p) => p.clave === "cuenta") : PESTANAS;
  const pestanaViva = soloSuCuenta ? "cuenta" : pestana;
  const zona = PESTANAS.find((p) => p.clave === pestanaViva) ?? PESTANAS[0];
  const avisoZona = avisoDePestana(pestanaViva, tieneModulo);
  // Dentro de una zona ya resumida arriba no se repite el aviso tarjeta a
  // tarjeta: se atenúan igual, pero callando.
  const enZona = (clave, children) => (
    <Tarjeta clave={clave} tieneModulo={tieneModulo} callado={!!avisoZona}>
      {children}
    </Tarjeta>
  );

  return (
    <div className={`${anchoPantalla("ajustes")} space-y-5`}>
      <div>
        <div className="eyebrow">Cuenta · Configuración</div>
        <h1 className="font-display text-2xl lg:text-3xl text-[var(--ink-900)] mt-1">
          Configuración
          {/* El recibo por correo (lib/configuracion/avisoCambio.js) es lo único
              de esta pantalla que pasa sin verse: se guarda un ajuste y sale un
              correo a gente que no está delante. Va en el h1 porque afecta a
              todas las tarjetas, no a una. */}
          <HelpTooltip title="Cada cambio se avisa por correo" className="ml-2">
            Al guardar una clave, un interruptor o una dirección de aquí, les llega un correo a{" "}
            <strong className="text-white">todos los administradores</strong> con qué cambió y
            quién lo hizo. De las claves solo se dice si se puso, se cambió o se borró: el valor
            nunca viaja en ese correo. Si recibes uno que no has hecho tú, alguien más ha tocado tu
            configuración — nosotros incluidos.
          </HelpTooltip>
        </h1>
        <p className="text-xs text-neutral-400 mt-1">{zona?.resumen}</p>
      </div>

      {/* ── Las seis zonas ───────────────────────────────────────────────────
          Hasta el 23/08/2026 esto era UNA columna de 28 tarjetas, y todo lo que
          hay debajo —de la clave de Anthropic a las puertas de la agenda—
          colgaba del mismo bloque titulado «Inteligencia Artificial». El
          reparto vive en `lib/configuracion/pestanas.js` y no aquí, porque de
          él sale también qué tarjeta depende de qué módulo, y eso es una regla
          por módulos, no una decisión de pintura. */}
      <div className="border-b border-neutral-100 -mx-4 lg:-mx-8 px-4 lg:px-8">
        <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap">
          {pestanasVisibles.map((p) => (
            <BotonZona key={p.clave} activa={p.clave === pestanaViva} onClick={() => irA(p.clave)}>
              {p.titulo}
            </BotonZona>
          ))}
        </div>
      </div>

      {/* Cuando TODA la zona depende del mismo módulo se dice una vez aquí, en
          vez de repetir la misma frase en cada tarjeta. */}
      {avisoZona && (
        <div className="px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-lg text-xs text-neutral-600">
          {avisoZona}
        </div>
      )}

      {errorMsg && <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{errorMsg}</div>}
      {okMsg && <div className="px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-lg text-xs text-emerald-700">{okMsg}</div>}
      {/* El aviso mandaba a la gente a ninguna parte: decía que no pueden tocar
          nada y punto. Desde el 24/08/2026 hay una cosa que SÍ es suya —su
          contraseña—, así que se dice y se enlaza. En esa pestaña no sale, que
          allí sería mentira. */}
      {/* `!soloSuCuenta` sobra en la práctica —a un no-admin `pestanaViva` ya le
          vale siempre «cuenta»— pero se deja porque `me` tarda un instante en
          llegar, y en ese hueco `isAdmin` es false y el aviso parpadearía. */}
      {!isAdmin && !soloSuCuenta && pestanaViva !== "cuenta" && (
        <div className="px-4 py-3 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-800">
          Solo los administradores pueden modificar la configuración. Lo que sí puedes cambiar es tu
          contraseña, en{" "}
          <button
            type="button"
            onClick={() => irA("cuenta")}
            className="underline font-semibold cursor-pointer"
          >
            Tu cuenta
          </button>
          .
        </div>
      )}

      {pestanaViva === "empresa" && (
        <div className="space-y-4">
          {enZona(
            "fiscal",
             billing && (
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
            ) 

          )}

          {enZona(
            "descripcionEmpresa",
            <CompanyDescriptionSection isAdmin={isAdmin} flash={flash} onError={setErrorMsg} />
          )}
        </div>
      )}

      {pestanaViva === "conexiones" && (
        <div className="space-y-4">
          {enZona(
            "anthropic",
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
          )}

          {enZona(
            "openai",
            <ApiKeyCard
              provider={AI_PROVIDERS.openai}
              status={cfg.integrations?.openai}
              isAdmin={isAdmin}
              onSave={(value) => patchTenant({ openaiApiKey: value }, "Clave de OpenAI guardada")}
              onClear={() => patchTenant({ openaiApiKey: null }, "Clave de OpenAI eliminada")}
            />
          )}

          {enZona(
            "googlePlaces",
            <ApiKeyCard
              provider={AI_PROVIDERS.googlePlaces}
              status={cfg.integrations?.googlePlaces}
              isAdmin={isAdmin}
              onSave={(value) => patchTenant({ googlePlacesApiKey: value }, "Clave de Google guardada")}
              onClear={() => patchTenant({ googlePlacesApiKey: null }, "Clave de Google eliminada")}
            />
          )}

          {enZona(
            "resend",
            <ApiKeyCard
              provider={AI_PROVIDERS.resend}
              status={cfg.integrations?.resend}
              isAdmin={isAdmin}
              onSave={(value) => patchTenant({ resendApiKey: value }, "Clave de Resend guardada")}
              onClear={() => patchTenant({ resendApiKey: null }, "Clave de Resend eliminada")}
            />

          )}

          {enZona(
            "remitente",
            <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
              <h3 className="font-display text-lg text-[var(--ink-900)]">Remitente del correo</h3>
              <p className="text-xs text-neutral-500 mt-1">
                De qué dirección salen <strong>todos</strong> los correos que manda el CRM en tu nombre
                —confirmaciones y recordatorios de cita, enlaces de videollamada, captación— y a dónde
                llegan las respuestas. Tiene que ser de un dominio verificado en tu cuenta de Resend.
              </p>
              {/* Se llamaba «Remitente del correo de captación», y por eso se
                  quedaba vacío: quien no usa Outreach daba por hecho que no le
                  tocaba. De aquí salen TODOS los correos del cliente. */}
              {cfg.integrations?.resend?.configured && !(cfg.integrations?.resend?.fromEmail ?? "").trim() && (
                <p className="text-[11px] font-medium text-amber-700 mt-2">
                  Tienes la clave de Resend puesta pero no hay remitente: sin una dirección desde la que
                  enviar, <strong>el CRM no manda ningún correo</strong>. Rellena el campo de abajo.
                </p>
              )}
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

          )}

          {enZona(
            "cloudflare",
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
          )}

          {enZona(
            "whatsapp",
            <ApiKeyCard
              provider={AI_PROVIDERS.whatsapp}
              status={cfg.integrations?.whatsapp}
              isAdmin={isAdmin}
              onSave={(value) => patchTenant({ whatsappToken: value }, "Token de WhatsApp guardado")}
              onClear={() => patchTenant({ whatsappToken: null }, "Token de WhatsApp eliminado")}
              extra={
                <>
                  <ConectarWhatsapp
                    isAdmin={isAdmin}
                    conectado={!!cfg.integrations?.whatsapp?.phoneNumberId}
                    numero={cfg.integrations?.whatsapp?.numero}
                    conectadoAt={cfg.integrations?.whatsapp?.conectadoAt}
                    onConectado={async () => {
                      const r = await fetch("/api/tenant/settings", { cache: "no-store" });
                      const j = await r.json().catch(() => null);
                      if (j?.ok) setCfg(j.data);
                      flash("WhatsApp conectado");
                    }}
                  />
                  <WhatsappPhoneField
                    value={cfg.integrations?.whatsapp?.phoneNumberId ?? ""}
                    isAdmin={isAdmin}
                    onSave={(v) => patchTenant({ whatsappPhoneNumberId: v }, "Número de WhatsApp guardado")}
                  />
                </>
              }
            />
          )}

          {enZona(
            "stripe",
            <>
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
                        extra={
                          <>
                            <UrlWebhook slug={cfg.slug} />
                            <EventosWebhook />
                          </>
                        }
                      />

                      {/* La clave PUBLICABLE. No es un secreto —viaja al navegador de cada
                          paciente— y por eso va en un campo normal y a la vista, no en una
                          tarjeta de secreto enmascarada.

                          Faltaba (03/08/2026): el endpoint la aceptaba y el widget la
                          necesita para pintar el formulario de tarjeta, pero no había dónde
                          escribirla. Al pasar de claves de prueba a claves reales había que
                          cambiarla por SSH, que es justo lo que estas tarjetas venían a
                          quitar. */}
                      <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
                        <h3 className="font-display text-lg text-[var(--ink-900)]">Clave publicable de Stripe</h3>
                        <p className="text-xs text-neutral-500 mt-1">
                          La que empieza por <code>pk_</code>. Sin ella el paciente no llega a ver el formulario de
                          tarjeta. Tiene que ser del mismo entorno que la clave secreta: las dos de prueba
                          (<code>pk_test_</code> + <code>sk_test_</code>) o las dos reales
                          (<code>pk_live_</code> + <code>sk_live_</code>).
                        </p>
                        <div className="mt-4">
                          <Field label="Clave publicable (pk_…)">
                            <input
                              disabled={!isAdmin}
                              value={cfg.integrations?.stripe?.publishableKey ?? ""}
                              onChange={(e) => setStripeField("publishableKey", e.target.value)}
                              placeholder="pk_live_..."
                              className={inputCls}
                            />
                          </Field>
                        </div>
                        {isAdmin && (
                          <div className="flex justify-end mt-3">
                            <PrimaryButton
                              onClick={() =>
                                patchTenant(
                                  { stripePublishableKey: cfg.integrations?.stripe?.publishableKey ?? "" },
                                  "Clave publicable guardada"
                                )
                              }
                            >
                              Guardar clave publicable
                            </PrimaryButton>
                          </div>
                        )}
                      </div>

                      {/* Remitente + reply-to del correo de captación (no son secretos). */}
            </>
          )}
        </div>
      )}

      {pestanaViva === "agenda" && (
        <div className="space-y-4">
          {enZona(
            "recordatorios",
             isAdmin && (
              <RecordatoriosCard
                activo={!!cfg.recordatoriosCitas}
                readOnly={!!cfg.readOnly}
                onChange={(v) => patchTenant({ recordatoriosCitas: v }, v ? "Recordatorios activados" : "Recordatorios desactivados")}
              />
            ) 

          )}

          {enZona(
            "agendaCompartida",
             isAdmin && (
              <AgendaCompartidaCard
                activo={!!cfg.agendaCompartida}
                readOnly={!!cfg.readOnly}
                onChange={(v) => patchTenant({ agendaCompartida: v }, v ? "Todo el equipo verá la agenda completa" : "Cada profesional volverá a ver solo su agenda")}
              />
            ) 

          )}

          {enZona(
            "colorBloqueos",
             isAdmin && (
              <ColorBloqueosCard
                color={cfg.colorBloqueos}
                readOnly={!!cfg.readOnly}
                onGuardar={(v) => patchTenant({ colorBloqueos: v }, "Color de los bloqueos guardado")}
              />
            ) 

          )}

          {enZona(
            "videollamada",
             isAdmin && (
              <VideollamadaCard
                meetModo={cfg.meetModo}
                salas={cfg.salasVideollamada ?? []}
                readOnly={!!cfg.readOnly}
                onChange={(v) => patchTenant({ meetModo: v }, v === "automatico" ? "Las citas online heredarán el enlace del tipo de cita" : "El enlace de videollamada se pondrá a mano en cada cita")}
              />
            ) 
          )}

          {enZona(
            "avisosWhatsapp",
             isAdmin && (
              <AvisosWhatsappCard
                activo={!!cfg.avisosWhatsapp}
                readOnly={!!cfg.readOnly}
                configurado={!!cfg.integrations?.whatsapp?.configured}
                irAConexiones={() => irA("conexiones")}
                onChange={(v) =>
                  patchTenant(
                    { avisosWhatsapp: v },
                    v ? "Los avisos de cita saldrán también por WhatsApp" : "Los avisos vuelven a ir solo por correo"
                  )
                }
              />
            ) 

          )}
        </div>
      )}

      {pestanaViva === "reservas" && (
        <div className="space-y-4">
          {enZona(
            "reservaOnline",
             isAdmin && (
              <ReservaOnlineCard
                activo={!!cfg.reservaOnlineCerrada}
                readOnly={!!cfg.readOnly}
                onChange={(v) =>
                  patchTenant(
                    { reservaOnlineCerrada: v },
                    v
                      ? "La agenda pública queda cerrada"
                      : "Vuelve a poder pedirse cita por internet"
                  )
                }
              />
            ) 

          )}

          {enZona(
            "cancelacion",
             isAdmin && (
              <CancelacionCard
                activo={!!cfg.cancelacionBloqueada}
                readOnly={!!cfg.readOnly}
                onChange={(v) =>
                  patchTenant(
                    { cancelacionBloqueada: v },
                    v
                      ? "Las citas se anularán solo desde el centro"
                      : "Las familias vuelven a poder anular sus citas"
                  )
                }
              />
            ) 

          )}

          {enZona(
            "puertaAdmision",
             isAdmin && (
              <PuertaAdmisionCard
                key={cfg.formularioUrl ?? ""}
                activo={!!cfg.formularioObligatorio}
                url={cfg.formularioUrl ?? ""}
                readOnly={!!cfg.readOnly}
                onChange={(v) =>
                  patchTenant(
                    { formularioObligatorio: v },
                    v
                      ? "Ahora solo puede reservar quien tenga la solicitud aceptada"
                      : "Vuelve a poder reservar cualquiera con el enlace de la agenda"
                  )
                }
                onGuardarUrl={(v) => patchTenant({ formularioUrl: v }, "Dirección del formulario guardada")}
              />
            ) 

          )}

          {enZona(
            "puertaContrato",
             isAdmin && (
              <PuertaContratoCard
                activo={!!cfg.contratoObligatorio}
                readOnly={!!cfg.readOnly}
                onChange={(v) =>
                  patchTenant(
                    { contratoObligatorio: v },
                    v
                      ? "Ahora hace falta tener los contratos firmados para reservar"
                      : "Vuelve a poderse reservar sin haber firmado nada"
                  )
                }
              />
            ) 

          )}

          {enZona(
            "puertaIdentidad",
             isAdmin && (
              <PuertaIdentidadCard
                activo={!!cfg.identidadObligatoria}
                readOnly={!!cfg.readOnly}
                onChange={(v) =>
                  patchTenant(
                    { identidadObligatoria: v },
                    v
                      ? "Ahora hay que tener cuenta en tu web para poder pedir cita"
                      : "Vuelve a poderse reservar sin cuenta"
                  )
                }
              />
            ) 

          )}

          {enZona(
            "puertaCaja",
             isAdmin && (
              <PuertaCajaCard
                activo={!!cfg.soloConPago}
                readOnly={!!cfg.readOnly}
                onChange={(v) =>
                  patchTenant(
                    { soloConPago: v },
                    v
                      ? "Desde la agenda pública ya solo se puede reservar pagando"
                      : "Vuelven a poderse reservar online las citas sin precio"
                  )
                }
              />
            ) 

          )}

          {enZona(
            "paginaReservas",
             isAdmin && (
              <PaginaReservasCard
                key={cfg.reservaUrl ?? ""}
                url={cfg.reservaUrl ?? ""}
                readOnly={!!cfg.readOnly}
                onGuardar={(v) => patchTenant({ reservaUrl: v }, "Dirección de la página de reservas guardada")}
              />
            ) 
          )}
        </div>
      )}

      {pestanaViva === "portal" && (
        <div className="space-y-4">
          {enZona(
            "areaPrivada",
             isAdmin && (
              <AreaPrivadaCard
                key={cfg.portalUrl ?? ""}
                url={cfg.portalUrl ?? ""}
                readOnly={!!cfg.readOnly}
                onGuardar={(v) => patchTenant({ portalUrl: v }, "Dirección del área privada guardada")}
              />
            ) 
          )}

          {enZona(
            "bloqueoImpago",
             isAdmin && (
              <BloqueoImpagoCard
                activo={!!cfg.portalBloqueoImpago}
                readOnly={!!cfg.readOnly}
                onChange={(v) =>
                  patchTenant(
                    { portalBloqueoImpago: v },
                    v
                      ? "Los documentos del portal se abrirán al registrar el cobro de cada mes"
                      : "Las familias vuelven a ver toda su documentación"
                  )
                }
              />
            ) 

          )}
        </div>
      )}

      {pestanaViva === "modulos" && (
        <div className="space-y-4">
          {enZona(
            "derivaciones",
            isAdmin && <DerivacionesCard /> 
          )}

          {enZona(
            "consultasExternas",
             isAdmin && (
              <CategoriasExternasCard
                categorias={cfg.categoriasExternas}
                readOnly={!!cfg.readOnly}
                onChange={(lista) => patchTenant({ categoriasExternas: lista }, "Empresas actualizadas")}
              />
            ) 

          )}

          {enZona(
            "permisosIa",
             isAdmin && (
              <AiPermissionsCard
                aiAccess={cfg.aiAccess}
                readOnly={!!cfg.readOnly}
                onToggle={(v) => patchTenant({ aiAccess: v }, v === "restringido" ? "La IA ahora requiere tu permiso" : "La IA vuelve a ser libre para el equipo")}
              />
            )
          )}
        </div>
      )}

      {/*
        TU CUENTA — la única zona SIN `isAdmin &&` de toda la pantalla, y es a
        propósito. Las otras seis son de la empresa; esta es de la persona, y
        justo quien no es admin es quien la necesita: de los 24 usuarios de
        clientes reales, 16 tienen rol `user` (15 de ellos en Aumenta).
      */}
      {pestanaViva === "cuenta" && (
        <div className="space-y-4">
          {enZona("contrasena", <ContrasenaCard />)}
        </div>
      )}
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
/**
 * Las empresas con las que hay acuerdo, para clasificar las consultas externas
 * (07/08/2026, Rodrigo).
 *
 * Va en Configuración y no en una pantalla propia porque es una lista de
 * nombres y nada más; y se enseña a TODOS los clientes, usen o no las consultas
 * externas, porque la Configuración es universal (regla 14).
 *
 * Quitar una empresa de aquí NO se la quita a los pacientes que ya la tenían:
 * su ficha conserva el texto. Es una lista para teclear más rápido, no un
 * catálogo cerrado — y se dice en pantalla, para que nadie borre pensando que
 * está limpiando fichas.
 */
function CategoriasExternasCard({ categorias, readOnly, onChange }) {
  const [nueva, setNueva] = useState("");
  const lista = Array.isArray(categorias) ? categorias : [];

  function anadir() {
    const t = nueva.trim();
    if (!t) return;
    // Se compara sin mayúsculas: «Empresa A» y «empresa a» son la misma.
    if (lista.some((c) => c.toLocaleLowerCase("es") === t.toLocaleLowerCase("es"))) {
      setNueva("");
      return;
    }
    onChange([...lista, t]);
    setNueva("");
  }

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="text-sm font-semibold text-neutral-800">Empresas con acuerdo</div>
      <p className="text-xs text-neutral-400 mt-0.5 max-w-lg">
        Para clasificar las consultas externas: pacientes que atiendes por un acuerdo con una
        empresa. Aparecen como desplegable en su ficha. Quitar una de aquí no se la quita a los
        pacientes que ya la tienen puesta.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {lista.length === 0 && (
          <span className="text-xs text-neutral-400">Todavía no has añadido ninguna.</span>
        )}
        {lista.map((c) => (
          <span key={c} className="inline-flex items-center gap-1.5 text-xs bg-neutral-100 text-neutral-700 rounded-lg pl-2.5 pr-1.5 py-1">
            {c}
            {!readOnly && (
              <button
                type="button"
                onClick={() => onChange(lista.filter((x) => x !== c))}
                className="text-neutral-400 hover:text-red-600"
                aria-label={`Quitar ${c}`}
              >
                ✕
              </button>
            )}
          </span>
        ))}
      </div>

      {/* Rodrigo, 23/08/2026: «no hay una forma de añadir, al igual que sí que
          hay en el elemento de encima». La había —este campo y su botón—, pero
          no se leía como tal: el botón iba en negro al 40 % con el campo vacío,
          que es aspecto de botón roto, y nada decía para qué servía el hueco.
          Ahora lleva su etiqueta y el MISMO botón verde que «Guardar catálogo»
          justo encima, para que las dos tarjetas se parezcan en lo que hacen. */}
      {!readOnly && (
        <div className="mt-4">
          <label className="block text-[11px] font-medium text-neutral-500 mb-1">Añadir una empresa</label>
          <div className="flex gap-2">
            <input
              value={nueva}
              onChange={(e) => setNueva(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); anadir(); } }}
              placeholder="Nombre de la empresa"
              maxLength={80}
              className="flex-1 border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-neutral-400"
            />
            <button
              type="button"
              onClick={anadir}
              disabled={!nueva.trim()}
              className="text-xs font-medium px-3 py-2 rounded-lg text-white disabled:opacity-50 shrink-0"
              style={{ background: "var(--color-primary, #1B3A2D)" }}
            >
              Añadir
            </button>
          </div>
          <p className="text-[11px] text-neutral-400 mt-1.5">
            Escribe el nombre y pulsa Añadir (o Intro). Se guarda al momento.
          </p>
        </div>
      )}
    </div>
  );
}

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

function DerivacionesCard() {
  const [lineas, setLineas] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState(null);

  useEffect(() => {
    fetch("/api/clinica/derivaciones", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j?.data) return; // 403: el cliente no tiene Clínica → la tarjeta no se pinta
        setLineas((j.data.especialidades ?? []).map((e) => e.label).join("\n"));
      })
      .catch(() => {});
  }, []);

  async function guardar() {
    setGuardando(true);
    setAviso(null);
    try {
      const r = await fetch("/api/clinica/derivaciones", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ especialidades: lineas.split("\n").map((l) => l.trim()).filter(Boolean) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo guardar");
      setLineas((j.data.especialidades ?? []).map((e) => e.label).join("\n"));
      setAviso("Catálogo guardado");
    } catch (e) {
      setAviso(e.message);
    } finally {
      setGuardando(false);
    }
  }

  if (lineas === null) return null;

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="text-sm font-semibold text-neutral-800">Especialidades de derivación</div>
      <p className="text-xs text-neutral-400 mt-0.5 max-w-lg">
        A qué especialistas EXTERNOS deriva el centro (no son las especialidades propias). Una por
        línea; es lo que se puede elegir al crear un informe de derivación.
      </p>
      <textarea
        rows={8}
        value={lineas}
        onChange={(e) => setLineas(e.target.value)}
        className="mt-3 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm font-mono leading-relaxed focus:outline-none focus:border-neutral-400"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={guardar}
          disabled={guardando}
          className="text-xs font-medium px-3 py-2 rounded-lg text-white disabled:opacity-50"
          style={{ background: "var(--color-primary, #1B3A2D)" }}
        >
          {guardando ? "Guardando…" : "Guardar catálogo"}
        </button>
        {aviso && <span className="text-[11px] text-neutral-500">{aviso}</span>}
      </div>
      <p className="text-[10px] text-neutral-400 mt-2">
        Renombrar una línea cambia solo la etiqueta: los informes ya escritos siguen apuntando a la
        misma especialidad. Quitar una no borra los informes que la usaban.
      </p>
    </div>
  );
}

function AvisosWhatsappCard({ activo, readOnly, configurado, onChange, irAConexiones }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-neutral-800">Avisos de cita por WhatsApp</div>
          <p className="text-xs text-neutral-400 mt-0.5 max-w-lg">
            Además del correo, mandar por WhatsApp la confirmación de la cita, el enlace de la
            videollamada y el recordatorio de la víspera. Sale desde el número del negocio, y nunca
            se escribe a quien tenga marcado que no quiere WhatsApp.
          </p>
        </div>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onChange(!activo)}
          className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 ${activo ? "bg-[var(--color-primary,#1B3A2D)]" : "bg-neutral-300"}`}
          aria-label={activo ? "Desactivar avisos por WhatsApp" : "Activar avisos por WhatsApp"}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${activo ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>
      <div className="mt-1 text-[11px] font-medium">
        {/* El aviso de «falta conectar» decía «abajo», y dejó de ser verdad el
            23/08/2026: al repartir la pantalla en zonas, WhatsApp se fue a
            «Conexiones» y este interruptor se quedó en «Agenda». Va un botón
            que cambia de zona y no un <Link>: navegar a la misma página no
            remonta el componente, así que la pestaña no cambiaría y el enlace
            no haría nada. */}
        {!configurado ? (
          <span className="text-amber-700">
            Falta conectar WhatsApp en{" "}
            <button type="button" onClick={irAConexiones} className="underline hover:no-underline font-medium">
              Conexiones
            </button>{" "}
            (token y número): mientras tanto no sale ningún mensaje.
          </span>
        ) : activo ? (
          <span className="text-emerald-700">Activos: cada aviso de cita va por correo y por WhatsApp.</span>
        ) : (
          <span className="text-neutral-400">Apagados: los avisos van solo por correo.</span>
        )}
      </div>
      <p className="text-[10px] text-neutral-400 mt-2">
        Meta cobra por conversación iniciada por el negocio, y si la persona no te ha escrito en las
        últimas 24 h exige una <strong>plantilla aprobada</strong>: esos mensajes los rechaza hasta
        que la tengas dada de alta.
      </p>
    </div>
  );
}

/**
 * Puerta de admisión: solo reserva quien ha pasado por el formulario y ha sido
 * aceptado en la bandeja. El enlace es obligatorio en la práctica —sin él, a
 * quien no ha pasado se le dice que le falta algo pero no a dónde ir—, así que
 * la tarjeta avisa en ámbar cuando está encendida y vacía.
 */
/**
 * Puerta de CONTRATOS (04/08/2026). Hermana de la de admisión, pero mira otra
 * cosa: aquella pregunta «¿te admito?» y esta «¿has firmado?». Sin URL que
 * configurar — el sitio donde se firma es el área privada, que ya se sabe.
 */
function PuertaContratoCard({ activo, readOnly, onChange }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-neutral-800">Contratos firmados para pedir cita</div>
          <p className="text-xs text-neutral-400 mt-0.5 max-w-lg">
            Solo puede reservar quien tenga firmados los documentos del centro. Al resto se les
            enseña el aviso con el enlace a su área privada, no un error.{" "}
            <strong className="text-neutral-500">La valoración inicial se salta esta puerta</strong>{" "}
            —es la primera visita y todavía no hay nada que firmar—, y quien firmó en papel cuenta
            como firmado.
          </p>
        </div>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onChange(!activo)}
          className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 ${activo ? "bg-[var(--color-primary,#1B3A2D)]" : "bg-neutral-300"}`}
          aria-label={activo ? "Quitar los contratos obligatorios" : "Exigir contratos firmados para reservar"}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${activo ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>

      <div className="mt-1 text-[11px] font-medium">
        {activo ? (
          <span className="text-emerald-700">
            Activa: sin los documentos firmados solo se puede pedir la valoración inicial.
          </span>
        ) : (
          <span className="text-neutral-400">
            Apagada: se puede reservar y dejar la tarjeta sin haber firmado nada.
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Puerta de identidad (05/08/2026): sin cuenta en la web no se reserva.
 *
 * Es la más básica de las cuatro y la única que hasta hoy era MENTIRA: el
 * widget enseñaba un cartel de «inicia sesión» que se saltaba escribiendo
 * `?wpa=1` en la URL, y el servidor no comprobaba nada.
 */
function PuertaIdentidadCard({ activo, readOnly, onChange }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-neutral-800 flex items-center gap-1.5">
            Pedir cita solo con cuenta
            {/* La ayuda del CONJUNTO va aquí, en la primera de las cuatro: cada
                tarjeta se explica sola, pero nadie dice cómo se relacionan ni
                en qué orden actúan, que es lo que de verdad despista. */}
            <HelpTooltip title="Las cuatro puertas de la agenda" placement="bottom">
              Hay cuatro filtros para reservar y se pueden encender por separado. Actúan en este
              orden: <strong className="text-white">1) tener cuenta</strong> (esta),
              {" "}2) estar admitido por el formulario, 3) tener el contrato firmado y 4) pagar.
              {" "}
              Todas vienen APAGADAS. Enciende de una en una y comprueba que se puede reservar
              después de cada una: encender varias de golpe deja gente fuera y no se sabe cuál fue.
            </HelpTooltip>
          </div>
          <p className="text-xs text-neutral-400 mt-0.5 max-w-lg">
            Para reservar hay que haber iniciado sesión en tu web. Sin esto, cualquiera con el
            enlace de tu agenda pide hora, y esa cita entra <strong className="text-neutral-500">sin
            paciente detrás</strong>: no hay ficha a la que enlazarla y hay que adivinar de quién es.{" "}
            <strong className="text-neutral-500">La valoración inicial tampoco se libra</strong> — se
            salta los contratos, que es otra cosa, pero cuenta tiene que tener.
          </p>
        </div>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onChange(!activo)}
          className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 ${activo ? "bg-[var(--color-primary,#1B3A2D)]" : "bg-neutral-300"}`}
          aria-label={activo ? "Permitir reservar sin cuenta" : "Exigir cuenta para reservar"}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${activo ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>

      <div className="mt-1 text-[11px] font-medium">
        {activo ? (
          <span className="text-emerald-700">
            Activa: quien no haya iniciado sesión en tu web no puede reservar.
          </span>
        ) : (
          <span className="text-neutral-400">
            Apagada: cualquiera con el enlace del widget puede reservar sin identificarse.
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Puerta de caja (05/08/2026): desde la agenda pública solo se reserva lo que
 * se cobra. Apagada por defecto — hay centros cuyos tipos de cita no tienen
 * precio porque cobran cuotas por fuera, y encenderla para todos los dejaría
 * sin poder reservar nada.
 */
function PuertaCajaCard({ activo, readOnly, onChange }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-neutral-800">Reservar online solo pagando</div>
          <p className="text-xs text-neutral-400 mt-0.5 max-w-lg">
            Desde la agenda pública solo se puede reservar lo que pasa por caja: o lo cobra la
            pasarela en ese momento, o ya lo pagó un bono.{" "}
            <strong className="text-neutral-500">Las citas gratuitas las creas tú a mano</strong>{" "}
            desde tu agenda. Enciéndelo si cobras por fuera (transferencia, Bizum) y no quieres que
            nadie se cuele reservando una cita sin pagar.
          </p>
        </div>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onChange(!activo)}
          className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 ${activo ? "bg-[var(--color-primary,#1B3A2D)]" : "bg-neutral-300"}`}
          aria-label={activo ? "Permitir reservar citas sin pago" : "Exigir pago para reservar online"}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${activo ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>

      <div className="mt-1 text-[11px] font-medium">
        {activo ? (
          <span className="text-emerald-700">
            Activa: una cita sin precio y sin bono no se puede reservar desde la web.
          </span>
        ) : (
          <span className="text-neutral-400">
            Apagada: se puede reservar cualquier tipo de cita, tenga precio o no.
          </span>
        )}
      </div>
    </div>
  );
}

function PuertaAdmisionCard({ activo, url, readOnly, onChange, onGuardarUrl }) {
  // El borrador arranca del valor guardado. Cuando ese valor cambia, la
  // tarjeta se vuelve a montar (`key` en quien la pinta) en vez de
  // resincronizarse con un efecto.
  const [borrador, setBorrador] = useState(url ?? "");

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-neutral-800">Formulario obligatorio para pedir cita</div>
          <p className="text-xs text-neutral-400 mt-0.5 max-w-lg">
            Solo pueden reservar las personas cuya solicitud del formulario esté aceptada en la
            bandeja. Al resto se les enseña el aviso con el enlace al formulario, no un error.
            Afecta a todos los tipos de cita y a todo el mundo, también a quien ya era paciente.
          </p>
        </div>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onChange(!activo)}
          className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 ${activo ? "bg-[var(--color-primary,#1B3A2D)]" : "bg-neutral-300"}`}
          aria-label={activo ? "Quitar el formulario obligatorio" : "Exigir formulario para reservar"}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${activo ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>

      <div className="mt-1 text-[11px] font-medium">
        {activo && !(url ?? "").trim() ? (
          <span className="text-amber-700">
            Falta la dirección del formulario: sin ella el aviso no lleva a ningún sitio.
          </span>
        ) : activo ? (
          <span className="text-emerald-700">Activa: sin solicitud aceptada no se puede reservar.</span>
        ) : (
          <span className="text-neutral-400">Apagada: cualquiera con el enlace de la agenda puede reservar.</span>
        )}
      </div>

      <div className="mt-3">
        <label className="block text-[11px] text-neutral-500 mb-1">
          Dirección del formulario (en tu web)
        </label>
        <div className="flex gap-2 flex-wrap">
          <input
            type="url"
            inputMode="url"
            value={borrador}
            disabled={readOnly}
            onChange={(e) => setBorrador(e.target.value)}
            placeholder="https://tuweb.com/primer-contacto"
            className="flex-1 min-w-[220px] text-sm border border-neutral-200 rounded-lg px-3 py-2 disabled:bg-neutral-50"
          />
          {!readOnly && (
            <PrimaryButton onClick={() => onGuardarUrl(borrador.trim())}>Guardar</PrimaryButton>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Dirección del área privada, que vive en la WEB del cliente (el portal va
 * incrustado en un iframe de su WordPress, no en un sitio nuestro), así que el
 * CRM no puede deducirla.
 *
 * Sin ella, a quien acaba de reservar solo se le puede ofrecer el enlace de
 * cancelación con el identificador dentro, y se le pide que se lo guarde —una
 * nota que se pierde el mismo día—. Con ella se le manda a su área privada,
 * donde además ve sus citas y los avisos.
 */
function AreaPrivadaCard({ url, readOnly, onGuardar }) {
  const [borrador, setBorrador] = useState(url ?? "");

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="text-sm font-semibold text-neutral-800">Área privada del cliente</div>
      <p className="text-xs text-neutral-400 mt-0.5 max-w-lg">
        La página de tu web donde tienes puesta el área privada. Se usa para mandar ahí a quien
        quiera consultar o cancelar sus citas, en vez de darle un enlace suelto que tenga que
        guardarse.
      </p>

      <div className="mt-1 text-[11px] font-medium">
        {(url ?? "").trim() ? (
          <span className="text-emerald-700">Puesta: al reservar se les manda ahí.</span>
        ) : (
          <span className="text-neutral-400">
            Sin poner: al reservar se les da el enlace directo de cancelación.
          </span>
        )}
      </div>

      <div className="mt-3">
        <label className="block text-[11px] text-neutral-500 mb-1">Dirección del área privada</label>
        <div className="flex gap-2 flex-wrap">
          <input
            type="url"
            inputMode="url"
            value={borrador}
            disabled={readOnly}
            onChange={(e) => setBorrador(e.target.value)}
            placeholder="https://tuweb.com/area-privada"
            className="flex-1 min-w-[220px] text-sm border border-neutral-200 rounded-lg px-3 py-2 disabled:bg-neutral-50"
          />
          {!readOnly && (
            <PrimaryButton onClick={() => onGuardar(borrador.trim())}>Guardar</PrimaryButton>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * PaginaReservasCard — dónde vive la agenda dentro de la web del cliente
 * (06/08/2026, Rodrigo).
 *
 * Sin esto, el botón de «copiar enlace» de cada tipo de cita daba la dirección
 * del CRM. Ese enlace, abierto desde un WhatsApp, cae fuera de la web del centro
 * —donde no hay sesión— y lo único que puede enseñar es «inicia sesión para
 * reservar». Con la página puesta, el enlace que se copia es el de SU web.
 */
function PaginaReservasCard({ url, readOnly, onGuardar }) {
  const [borrador, setBorrador] = useState(url ?? "");

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="text-sm font-semibold text-neutral-800">Página de reservas de tu web</div>
      <p className="text-xs text-neutral-400 mt-0.5 max-w-lg">
        La página donde tienes puesta la agenda. Se usa para los enlaces de cita única que copias
        en Tipos de cita: así quien los abra entra por tu web, con su sesión, en vez de encontrarse
        una pantalla pidiéndole que inicie sesión.
      </p>

      <div className="mt-1 text-[11px] font-medium">
        {(url ?? "").trim() ? (
          <span className="text-emerald-700">Puesta: los enlaces de cita apuntan a tu web.</span>
        ) : (
          <span className="text-neutral-400">Sin poner: los enlaces apuntan al CRM y pedirán iniciar sesión.</span>
        )}
      </div>

      <div className="mt-3">
        <label className="block text-[11px] text-neutral-500 mb-1">Dirección de la página de reservas</label>
        <div className="flex gap-2 flex-wrap">
          <input
            type="url"
            inputMode="url"
            value={borrador}
            disabled={readOnly}
            onChange={(e) => setBorrador(e.target.value)}
            placeholder="https://tuweb.com/citas"
            className="flex-1 min-w-[220px] text-sm border border-neutral-200 rounded-lg px-3 py-2 disabled:bg-neutral-50"
          />
          {!readOnly && (
            <PrimaryButton onClick={() => onGuardar(borrador.trim())}>Guardar</PrimaryButton>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Color de los tramos bloqueados de la agenda (10/08/2026, Rodrigo).
 *
 * Es el del CENTRO. Cada profesional puede pisarlo con el suyo desde su ficha
 * de equipo, y por eso la tarjeta lo dice: si no, alguien cambia esto, ve que
 * los bloqueos de una compañera siguen igual y piensa que no se ha guardado.
 */
function ColorBloqueosCard({ color, readOnly, onGuardar }) {
  const [borrador, setBorrador] = useState(color ?? COLOR_BLOQUEO_POR_DEFECTO);

  // Si el color llega más tarde que el primer render (la carga es asíncrona),
  // el selector tiene que ponerse al día o enseñaría el negro por defecto.
  useEffect(() => { setBorrador(color ?? COLOR_BLOQUEO_POR_DEFECTO); }, [color]);

  const valido = /^#[0-9a-fA-F]{6}$/.test(borrador.trim());
  const sinCambios = borrador.trim().toUpperCase() === (color ?? "").toUpperCase();

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="text-sm font-semibold text-neutral-800">Color de los bloqueos</div>
      <p className="text-xs text-neutral-400 mt-0.5 max-w-lg">
        El color con el que se pintan en la agenda las vacaciones, ausencias y cierres del
        centro. Cada profesional puede tener el suyo propio desde su ficha en Equipo; este es el
        que se usa cuando no lo tiene.
      </p>

      <div className="mt-3 flex gap-2 flex-wrap items-end">
        <div>
          <label className="block text-[11px] text-neutral-500 mb-1">Color</label>
          <input
            type="color"
            value={valido ? borrador : COLOR_BLOQUEO_POR_DEFECTO}
            disabled={readOnly}
            onChange={(e) => setBorrador(e.target.value.toUpperCase())}
            className="h-10 w-14 border border-neutral-200 rounded-lg p-1 disabled:opacity-40 cursor-pointer"
            aria-label="Elegir el color de los bloqueos"
          />
        </div>
        <div className="flex-1 min-w-[140px]">
          <label className="block text-[11px] text-neutral-500 mb-1">Código</label>
          <input
            type="text"
            value={borrador}
            disabled={readOnly}
            onChange={(e) => setBorrador(e.target.value)}
            placeholder={COLOR_BLOQUEO_POR_DEFECTO}
            className="w-full text-sm border border-neutral-200 rounded-lg px-3 py-2 font-mono disabled:bg-neutral-50"
          />
        </div>
        {!readOnly && (
          <PrimaryButton onClick={() => valido && onGuardar(borrador.trim().toUpperCase())}>
            Guardar
          </PrimaryButton>
        )}
      </div>

      {!valido && (
        <p className="text-[11px] text-rose-600 mt-2">
          Tiene que ser un código de color tipo <span className="font-mono">#0F0F0F</span>.
        </p>
      )}

      {/* Cómo queda. La muestra lleva la MISMA letra que calcula la agenda, o
          enseñaría algo legible aquí e ilegible allí. */}
      <div className="mt-3">
        <div className="text-[11px] text-neutral-500 mb-1">Así se verá en la agenda</div>
        <div
          className="rounded px-2 py-1 text-[11px] font-medium inline-block"
          style={{
            backgroundColor: valido ? borrador : COLOR_BLOQUEO_POR_DEFECTO,
            color: colorTextoSobre(valido ? borrador : COLOR_BLOQUEO_POR_DEFECTO),
          }}
        >
          Vacaciones · Laura
        </div>
      </div>

      {!readOnly && !sinCambios && valido && (
        <p className="text-[10px] text-neutral-400 mt-2">Sin guardar todavía.</p>
      )}
    </div>
  );
}

function BloqueoImpagoCard({ activo, readOnly, onChange }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-neutral-800">Documentos del portal por mes pagado</div>
          <p className="text-xs text-neutral-400 mt-0.5 max-w-lg">
            En el área privada, la familia ve los documentos de un mes solo cuando consta el cobro
            de ese mes. Al registrar el cobro, sus documentos se abren solos. Lo que sube la propia
            familia nunca se bloquea, y siempre se puede abrir un mes a mano desde su ficha.
          </p>
        </div>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onChange(!activo)}
          className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 ${activo ? "bg-[var(--color-primary,#1B3A2D)]" : "bg-neutral-300"}`}
          aria-label={activo ? "Desactivar bloqueo por impago" : "Activar bloqueo por impago"}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${activo ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>
      <div className="mt-1 text-[11px] font-medium">
        {activo
          ? <span className="text-emerald-700">Activo: cada mes se abre al registrar su cobro.</span>
          : <span className="text-neutral-400">Apagado: la familia ve toda su documentación.</span>}
      </div>
      <p className="text-[10px] text-neutral-400 mt-2">
        Ojo: si el centro no registra los cobros con su <strong>mes</strong>, al encenderlo
        desaparece de golpe la documentación de todas las familias.
      </p>
    </div>
  );
}

/**
 * El centro decide si la familia puede anular sus citas sola (08/08/2026).
 *
 * La tarjeta explica las DOS cosas que se apagan a la vez —el botón del área
 * privada y el enlace de los correos— porque apagar solo una es el error que se
 * comete: el «Cancela aquí» del correo cancela sin iniciar sesión y no caduca.
 */
/**
 * El centro no da cita por internet (08/08/2026).
 *
 * La tarjeta insiste en que esto NO es esconder el enlace: la agenda respondía
 * a cualquiera que conociera la dirección aunque no estuviera enlazada en
 * ningún sitio, entregando el catálogo entero de tipos de cita.
 */
function ReservaOnlineCard({ activo, readOnly, onChange }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-neutral-800">Las citas se piden solo en el centro</div>
          <p className="text-xs text-neutral-400 mt-0.5 max-w-lg">
            Cierra la agenda pública: nadie puede pedir cita por internet ni ver el catálogo de
            tipos de cita, aunque conozca la dirección. Quien entre verá un aviso con la marca del
            centro y un enlace a vuestra web. El área privada de las familias sigue funcionando.
          </p>
        </div>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onChange(!activo)}
          className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 ${activo ? "bg-[var(--color-primary,#1B3A2D)]" : "bg-neutral-300"}`}
          aria-label={activo ? "Abrir la agenda pública" : "Cerrar la agenda pública"}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${activo ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>
      <div className="mt-1 text-[11px] font-medium">
        {activo
          ? <span className="text-emerald-700">Activo: la agenda pública está cerrada.</span>
          : <span className="text-neutral-400">Apagado: cualquiera con el enlace puede pedir cita.</span>}
      </div>
      <p className="text-[10px] text-neutral-400 mt-2">
        No basta con no enlazar la agenda desde vuestra web: sin esto, la dirección responde
        igual y enseña <strong>todos</strong> vuestros tipos de cita.
      </p>
    </div>
  );
}

function CancelacionCard({ activo, readOnly, onChange }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-neutral-800">Las citas se anulan solo desde el centro</div>
          <p className="text-xs text-neutral-400 mt-0.5 max-w-lg">
            Para centros que gestionan su agenda por teléfono. Al activarlo, la familia deja de
            tener el botón de anular en su área privada y los correos de cita dejan de llevar el
            enlace de «Cancela aquí». El equipo sigue pudiendo anular con normalidad desde el CRM.
          </p>
        </div>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onChange(!activo)}
          className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 ${activo ? "bg-[var(--color-primary,#1B3A2D)]" : "bg-neutral-300"}`}
          aria-label={activo ? "Permitir que la familia anule sus citas" : "Impedir que la familia anule sus citas"}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${activo ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>
      <div className="mt-1 text-[11px] font-medium">
        {activo
          ? <span className="text-emerald-700">Activo: para cambiar una cita, la familia llama al centro.</span>
          : <span className="text-neutral-400">Apagado: la familia puede anular sus citas ella misma.</span>}
      </div>
      <p className="text-[10px] text-neutral-400 mt-2">
        Al activarlo dejan de funcionar también los enlaces de cancelar de los correos
        <strong> ya enviados</strong>, que hasta ahora no caducaban nunca.
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

function VideollamadaCard({ meetModo, salas = [], readOnly, onChange }) {
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
      {/* Lo que HEREDARÍAN las citas online si se pasa a automático. Se enseña
          siempre, no solo en automático: el momento en que hace falta verlo es
          justo ANTES de cambiar el modo. */}
      {salas.length > 0 && (
        <div className="mt-3 border-t border-neutral-100 pt-3">
          <div className="text-[11px] font-medium text-neutral-500 mb-1.5">
            Salas que se usarían en modo automático
          </div>
          <ul className="space-y-1">
            {salas.map((s) => (
              <li key={s.nombre} className="text-[11px] flex flex-wrap gap-x-2 gap-y-0.5">
                <span className="text-neutral-700">{s.nombre}</span>
                {s.url ? (
                  <span className="text-neutral-400 break-all">{s.url}</span>
                ) : (
                  <span className="text-amber-700">sin enlace</span>
                )}
              </li>
            ))}
          </ul>
          {auto && salas.some((s) => !s.url) && (
            <p className="text-[11px] text-amber-700 mt-1.5">
              Las citas online de los tipos sin enlace se crearán igualmente sin él.
            </p>
          )}
          <p className="text-[10px] text-neutral-400 mt-1.5">
            Nadie comprueba que estos enlaces funcionen: si alguno es de ejemplo, el paciente
            recibirá una sala que no existe. Se cambian en cada tipo de cita.
          </p>
        </div>
      )}

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
function EventosWebhook() {
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
/** Una zona del menú de arriba. Mismo gesto que las pestañas de la ficha. */
function BotonZona({ activa, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={activa ? "page" : undefined}
      className={`px-3 py-2.5 text-sm border-b-2 -mb-px transition-colors ${
        activa
          ? "border-[var(--color-primary,#1B3A2D)] text-[var(--ink-900)] font-medium"
          : "border-transparent text-neutral-400 hover:text-neutral-700"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Envuelve una tarjeta y, si su módulo no está contratado, la atenúa y lo dice.
 *
 * **No la desactiva**, y eso es deliberado: la Configuración es universal
 * (regla #14) y un cliente tiene que poder dejar puesta su clave de Stripe hoy
 * y contratar Citas el mes que viene. Por eso vuelve a opacidad entera al pasar
 * por encima o al escribir dentro — atenuada es «esto todavía no hace nada»,
 * no «esto no se toca».
 *
 * `callado` la atenúa sin repetir el texto: se usa cuando la zona entera ya lo
 * ha dicho una vez arriba.
 *
 * Si `children` no pinta nada (un `isAdmin && …` que vale `false`), no se
 * envuelve nada: sería un aviso flotando solo, sin la tarjeta a la que se
 * refiere.
 */
function Tarjeta({ clave, tieneModulo, callado = false, children }) {
  if (!children) return null;
  const aviso = avisoDeTarjeta(clave, tieneModulo);
  // De qué módulo es, en TODAS las zonas. No depende de lo contratado: es qué
  // ES la tarjeta, no si le sirve. Las universales no llevan rótulo — con esto
  // en todas partes, no llevarlo ya significa «vale para todo el CRM».
  const etiqueta = etiquetaDeModulo(clave);
  if (!aviso && !etiqueta) return children;
  return (
    <div className={aviso ? "opacity-60 hover:opacity-100 focus-within:opacity-100 transition-opacity" : undefined}>
      {etiqueta && (
        <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-1.5">
          {etiqueta}
        </p>
      )}
      {aviso && !callado && <p className="text-[11px] text-neutral-500 mb-1.5">{aviso}</p>}
      {children}
    </div>
  );
}

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

/**
 * Cambiarte TU contraseña (24/08/2026, Jorge).
 *
 * ── POR QUÉ ES LA ÚNICA TARJETA DE ESTA PANTALLA SIN `readOnly` ───────────
 * Todo lo demás de Configuración es de la EMPRESA, y por eso está en
 * solo-lectura para quien no es admin. Esto es de la PERSONA. En producción hay
 * 24 usuarios de clientes reales y 16 tienen rol `user` —15 de ellos en
 * Aumenta—, o sea que si esta tarjeta heredara el `disabled={!isAdmin}` del
 * resto dejaría fuera justo a quien viene a servir.
 *
 * Hasta hoy nadie podía cambiarse la suya: la única forma era que un admin la
 * RESTABLECIERA desde Equipo, y eso genera una aleatoria de 12 caracteres. La
 * que te dan es la que te queda.
 *
 * ── LO QUE LA PANTALLA HACE Y LO QUE NO ──────────────────────────────────
 * No decide nada: manda las tres cosas al servidor y pinta lo que conteste. Las
 * reglas de qué contraseña vale viven en `lib/auth/contrasena.js` y las aplica
 * el endpoint; aquí solo se ADELANTAN para no hacer escribir tres campos y
 * fallar después. Si algún día divergen, manda el servidor.
 *
 * El campo de repetir no es un capricho: no hay forma de recuperar una
 * contraseña en este CRM —el «¿Olvidaste tu contraseña?» del login no lleva a
 * ninguna parte todavía—, así que una errata al escribirla te deja fuera y hay
 * que llamar por teléfono.
 */
function ContrasenaCard() {
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetir, setRepetir] = useState("");
  const [verlas, setVerlas] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [fallo, setFallo] = useState(null);
  const [hecho, setHecho] = useState(false);
  /*
   * Los topes y si esto es una demo los DICE EL SERVIDOR, no se escriben aquí.
   *
   * Estaban a mano como valores por defecto de las props y no los pasaba nadie:
   * o sea, dos sitios con el mismo número esperando a separarse. Es el mismo
   * fallo que ya costó una imagen rota hoy mismo con las capturas — la pantalla
   * decidiendo por su cuenta algo que decide el servidor.
   *
   * Mientras no llegan, se pinta con los que hay: la tarjeta no se queda en
   * blanco por una petición lenta, y el botón valida igual al pulsarlo.
   */
  const [reglas, setReglas] = useState({ minimo: 10, maximo: 72, enDemo: false });
  useEffect(() => {
    let vivo = true;
    fetch("/api/auth/password", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (vivo && j?.ok) setReglas(j.data);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);
  const { minimo, maximo, enDemo } = reglas;

  /*
   * Lo que se puede decir ANTES de molestar al servidor.
   *
   * El largo se mide en BYTES, igual que lo mide él, y no con el `maxLength` del
   * input — que cuenta caracteres. No es lo mismo: una tilde ocupa dos bytes y
   * un emoji cuatro, así que 72 caracteres de tildes son 144 bytes. Con
   * `maxLength` la pantalla dejaría escribir algo que el servidor rechaza, que
   * es exactamente la clase de desajuste que se paga en un sitio donde el
   * mensaje de error llega después de escribir tres campos.
   */
  const bytes = new TextEncoder().encode(nueva).length;
  const corta = nueva.length > 0 && nueva.length < minimo;
  const larga = bytes > maximo;
  const noCoinciden = repetir.length > 0 && nueva !== repetir;
  const puede = actual && nueva && repetir && !corta && !larga && !noCoinciden && !guardando;

  async function guardar() {
    setGuardando(true);
    setFallo(null);
    setHecho(false);
    try {
      const r = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actual, nueva }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error || `Error ${r.status}`);
      setHecho(true);
      setActual("");
      setNueva("");
      setRepetir("");
    } catch (e) {
      setFallo(e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="text-sm font-semibold text-neutral-800">Tu contraseña</div>
      <p className="text-xs text-neutral-400 mt-0.5 max-w-lg">
        {/* El texto decía «se cierran tus sesiones en los demás dispositivos», y
            eso prometía más de lo que hace: lo que caduca es su token de
            refresco, así que caen la próxima vez que renueven — hasta un cuarto
            de hora después. Decirlo mal importa porque quien cambia la
            contraseña por sospecha necesita saber cuándo queda cerrado. */}
        La eliges tú. Los demás dispositivos donde tengas la sesión abierta se cerrarán en un cuarto
        de hora como mucho, pero <strong className="text-neutral-500">aquí sigues dentro</strong>,
        sin volver a entrar.
      </p>

      {/* En la demo se dice ANTES, no después de escribir tres campos: la cuenta
          la comparten todos los visitantes y cambiarla dejaría fuera al resto. */}
      {enDemo ? (
        <div className="mt-4 px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-800 max-w-sm">
          En la demo no se puede cambiar: esta cuenta la comparte todo el que entra a mirarla.
        </div>
      ) : (
      <div className="mt-4 grid gap-3 max-w-sm">
        <label className="block">
          <span className="block text-xs text-neutral-500 mb-1">La de ahora</span>
          <input
            type={verlas ? "text" : "password"}
            autoComplete="current-password"
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            className={inputCls}
          />
        </label>

        <label className="block">
          <span className="block text-xs text-neutral-500 mb-1">La nueva</span>
          <input
            type={verlas ? "text" : "password"}
            autoComplete="new-password"
            value={nueva}
            onChange={(e) => setNueva(e.target.value)}
            className={inputCls}
          />
          {/* La regla se dice SIEMPRE, no solo al fallar: es una sola y así
              nadie escribe tres campos para que le digan que no vale. */}
          <span
            className={`block text-[11px] mt-1 ${corta || larga ? "text-red-600" : "text-neutral-400"}`}
          >
            {larga
              ? `Demasiado larga: el tope son ${maximo} caracteres, algo menos si lleva tildes o emojis.`
              : `Al menos ${minimo} caracteres. Nada de mayúsculas ni símbolos obligatorios: es más seguro que sea larga y que te la puedas acordar.`}
          </span>
        </label>

        <label className="block">
          <span className="block text-xs text-neutral-500 mb-1">La nueva otra vez</span>
          <input
            type={verlas ? "text" : "password"}
            autoComplete="new-password"
            maxLength={maximo}
            value={repetir}
            onChange={(e) => setRepetir(e.target.value)}
            className={inputCls}
          />
          {noCoinciden && (
            <span className="block text-[11px] mt-1 text-red-600">Las dos no son iguales.</span>
          )}
        </label>

        <label className="flex items-center gap-2 text-xs text-neutral-500 cursor-pointer">
          <input
            type="checkbox"
            checked={verlas}
            onChange={(e) => setVerlas(e.target.checked)}
            className="h-4 w-4 accent-[var(--color-primary,#1B3A2D)]"
          />
          Verlas mientras escribo
        </label>
      </div>
      )}

      {fallo && (
        <div className="mt-3 px-3 py-2 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600 max-w-sm">
          {fallo}
        </div>
      )}
      {hecho && (
        <div className="mt-3 px-3 py-2 bg-emerald-50 border border-emerald-100 rounded-lg text-xs text-emerald-700 max-w-sm">
          Cambiada. La próxima vez entra con la nueva.
        </div>
      )}

      <div className="mt-4">
        {/* Botón propio y no `PrimaryButton`: ese no acepta `disabled`, y aquí
            hace falta — con los tres campos a medias no se manda nada. Tocarlo
            a él afectaría a sus veinte usos por un caso. */}
        <button
          type="button"
          onClick={guardar}
          disabled={!puede || enDemo}
          className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: "var(--color-primary, #1B3A2D)" }}
        >
          {guardando ? "Cambiando…" : "Cambiar la contraseña"}
        </button>
      </div>
    </div>
  );
}
