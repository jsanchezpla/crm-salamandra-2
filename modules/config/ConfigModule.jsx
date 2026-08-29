"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import HelpTooltip from "../../components/ui/HelpTooltip.jsx";
import Link from "next/link";
import Select from "../../components/ui/Select.jsx";
import ConectarWhatsapp from "./ConectarWhatsapp.jsx";
import { ANTHROPIC_MODELS } from "../../lib/ai/anthropicModel.js";
import { anchoPantalla } from "@/components/layout/anchoPantalla.js";
import CorreoSalidaCard from "./CorreoSalidaCard.jsx";
import {
  PESTANAS,
  PESTANA_POR_DEFECTO,
  avisoDePestana,
  esPestanaValida,
} from "../../lib/configuracion/pestanas.js";
import { BotonZona, Field, PrimaryButton, Section, Tarjeta, inputCls } from "./tarjetas/ui.jsx";
import { CompanyDescriptionSection } from "./tarjetas/Empresa.jsx";
import DatosCentro from "./tarjetas/DatosCentro.jsx";
import {
  AI_PROVIDERS,
  ApiKeyCard,
  BancoIdField,
  CloudflareIdsField,
  EstadoCobro,
  EventosWebhook,
  UrlWebhook,
  WhatsappPhoneField,
} from "./tarjetas/Conexiones.jsx";
import {
  AgendaCompartidaCard,
  AvisosWhatsappCard,
  ColorBloqueosCard,
  RecordatoriosCard,
  VideollamadaCard,
} from "./tarjetas/Agenda.jsx";
import {
  CancelacionCard,
  PaginaReservasCard,
  PuertaAdmisionCard,
  PuertaCajaCard,
  PuertaContratoCard,
  PuertaIdentidadCard,
  ReservaOnlineCard,
} from "./tarjetas/Reservas.jsx";
import { AreaPrivadaCard, BloqueoImpagoCard } from "./tarjetas/Portal.jsx";
import { AiPermissionsCard, CategoriasExternasCard, DerivacionesCard, PlantillasClinicaCard } from "./tarjetas/Modulos.jsx";
import { ContrasenaCard, CorreoCuentaCard } from "./tarjetas/Cuenta.jsx";

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
        <div className="flex items-center gap-1 overflow-x-auto overflow-y-hidden whitespace-nowrap">
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
          {/* Los datos que imprime el informe clínico (28/08/2026). Va la
              primera porque las otras dos de esta zona se esconden solas sin
              `billing` ni `outreach`: sin ella, a un cliente sin esos módulos
              «Empresa» se le abría en blanco. */}
          {enZona(
            "datosCentro",
            <DatosCentro
              centro={cfg.centro}
              readOnly={!isAdmin || !!cfg.readOnly}
              onGuardar={(centro) => patchTenant({ centro }, "Datos del centro guardados")}
            />
          )}

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

          {/*
            CORREO DE SALIDA (25/08/2026). Varias cuentas de Resend —varios
            dominios— y varias direcciones dentro de cada una, con quién puede
            usar cada dirección. Pedido de Rodrigo; antes solo cabía UNA clave y
            UN remitente, y con eso no entraba ni `booking@` + `prensa@`.
          */}
          {enZona(
            "remitente",
            <div className="space-y-4">
            <CorreoSalidaCard
              cuentas={cfg.integrations?.resend?.cuentas ?? []}
              remitentes={cfg.integrations?.resend?.remitentes ?? []}
              usuarios={cfg.usuarios ?? []}
              isAdmin={isAdmin}
              onGuardar={async (payload) => {
                await patchTenant(payload, "Correo de salida guardado");
              }}
            />

            {/*
              La tarjeta de siempre se queda DEBAJO y en modo heredado: de este
              remitente único siguen saliendo los avisos AUTOMÁTICOS (citas,
              facturas, formularios), que no pasan por el selector de arriba.
              Quitarla dejaría a nueve clientes sin poder tocar su remitente.

              Las dos van dentro del MISMO `enZona` a propósito: son la misma
              sección de la pantalla, y `_smoke-config-pestanas.mjs` comprueba
              que cada tarjeta se monte una sola vez.
            */}
            <div className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
              <h3 className="font-display text-lg text-[var(--ink-900)]">Remitente de los avisos automáticos</h3>
              <p className="text-xs text-neutral-500 mt-1">
                De qué dirección salen los correos que el CRM manda <strong>solo</strong>: confirmaciones y
                recordatorios de cita, enlaces de videollamada, facturas. Los que escribe una persona desde
                la pantalla de Correo usan las direcciones de arriba.
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

          {/* ── Banco de verdad (29/08/2026) ─────────────────────────────────
              Credenciales de GoCardless Bank Account Data: el extracto y la
              conciliación de Facturación → Banco. Elegir el banco y autorizar
              se hace en esa pantalla; aquí solo se pegan las claves. */}
          {enZona(
            "gocardless",
            <ApiKeyCard
              provider={AI_PROVIDERS.gocardless}
              status={cfg.integrations?.gocardless}
              isAdmin={isAdmin}
              onSave={(value) => patchTenant({ gocardlessSecretKey: value }, "Clave del banco guardada")}
              onClear={() => patchTenant({ gocardlessSecretKey: null }, "Clave del banco eliminada")}
              extra={
                <BancoIdField
                  value={cfg.integrations?.gocardless?.secretId ?? ""}
                  ready={!!cfg.integrations?.gocardless?.ready}
                  isAdmin={isAdmin}
                  onSave={(v) => patchTenant({ gocardlessSecretId: v }, "Secret ID del banco guardado")}
                />
              }
            />
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
            "plantillasClinica",
            isAdmin && <PlantillasClinicaCard />
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
          {enZona("correoCuenta", <CorreoCuentaCard />)}
          {enZona("contrasena", <ContrasenaCard />)}
        </div>
      )}
    </div>
  );
}
