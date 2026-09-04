"use client";

/**
 * ClientFiscalSection — «Datos de facturación» de la ficha (08/08/2026).
 *
 * Nace para cerrar un callejón sin salida: cuando faltan datos fiscales, la
 * pantalla de facturas deshabilita «Emitir», enseña un aviso y ofrece un enlace
 * a la ficha del cliente… donde no había ningún campo fiscal. Hasta hoy eso
 * solo se corregía llamando a la API a mano.
 *
 * ── LAS DOS COLUMNAS DE DOCUMENTO ──────────────────────────────────────────
 * El DNI/NIE de arriba, en los datos de la ficha, es el de la PERSONA: el que
 * sale en el contrato que la familia firma en el área privada. El de aquí es a
 * nombre de quién se emite la FACTURA, que puede ser el otro progenitor o una
 * empresa con CIF. Se dejan separados a propósito: mezclarlos dejaría un
 * contrato de servicios a un menor identificado con el CIF de una sociedad.
 *
 * Solo se monta donde hay módulo de facturación. Si el endpoint responde 403
 * (tenant sin módulo `clients`), se esconde sola, como el resto de secciones.
 */

import { useCallback, useEffect, useState } from "react";
import HelpTooltip from "../ui/HelpTooltip.jsx";
// La lista de campos vive en lib/ y la comparte el panel «Editar ficha» del
// listado (31/08/2026): así los dos sitios enseñan y guardan LO MISMO.
import { CAMPOS_FISCALES as CAMPOS } from "../../lib/clients/camposFiscales.js";
// A nombre de cuál de sus tutores se factura por defecto (04/09/2026).
import { opcionesDeRazonSocial, razonSocialPorDefecto, nombreDeRazonSocial, LA_FICHA } from "../../lib/billing/razonSocial.js";

export default function ClientFiscalSection({ clientId }) {
  const [datos, setDatos] = useState(null);
  const [disponible, setDisponible] = useState(true);
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  const cargar = useCallback(() => {
    let vivo = true;
    fetch(`/api/clients/${clientId}`)
      .then(async (r) => ({ r, d: await r.json().catch(() => ({})) }))
      .then(({ r, d }) => {
        if (!vivo) return;
        if (r.status === 403) { setDisponible(false); return; }
        if (!d.ok) throw new Error(d.error || "No se han podido cargar los datos de facturación");
        setDatos(d.data);
        setError(null);
      })
      .catch((e) => vivo && setError(e.message));
    return () => { vivo = false; };
  }, [clientId]);

  useEffect(() => cargar(), [cargar]);

  function abrir() {
    setBorrador({
      ...Object.fromEntries(CAMPOS.map((c) => [c.key, datos?.[c.key] || ""])),
      fiscalGuardianId: razonSocialPorDefecto(datos),
    });
    setError(null);
    setEditando(true);
  }

  async function guardar() {
    if (guardando) return;
    setGuardando(true);
    setError(null);
    try {
      const r = await fetch(`/api/clients/${clientId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(borrador),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "No se ha podido guardar");
      setEditando(false);
      cargar();
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  if (!disponible || !datos) return null;

  const inputCls = "w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm";
  const labelCls = "block text-xs font-medium text-gray-600 mb-1";
  const rellenos = CAMPOS.filter((c) => (datos[c.key] || "").trim());
  // El mismo criterio que el candado de emisión del servidor: razón social
  // (con respaldo al nombre de la ficha) y NIF, con respaldo al DNI del titular.
  const faltaParaFacturar = [
    !datos.fiscalName && !datos.name ? "la razón social" : null,
    !datos.fiscalTaxId && !datos.taxId ? "el NIF/CIF" : null,
  ].filter(Boolean);

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden mt-6">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
        <span className="text-sm font-semibold text-gray-700 inline-flex items-center gap-1.5">
          Datos de facturación
          <HelpTooltip title="Datos de facturación" placement="bottom">
            A nombre de quién se emite la factura, que no tiene por qué ser el titular de la
            ficha: puede ser el otro progenitor, o una empresa con CIF.{" "}
            <strong className="text-white">El DNI de los datos de la ficha no cambia</strong>: ese
            es el de la persona, y es el que sale en el contrato del área privada.
          </HelpTooltip>
        </span>
        {!editando && (
          <button onClick={abrir} className="text-xs text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-300 px-3 py-1.5 rounded-lg">
            Editar
          </button>
        )}
      </div>

      <div className="p-5 space-y-4">
        {!editando ? (
          <>
            {faltaParaFacturar.length > 0 && (
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Falta {faltaParaFacturar.join(" y ")}: hasta que esté, sus facturas se pueden
                guardar como borrador pero no emitir.
              </div>
            )}
            {razonSocialPorDefecto(datos) !== LA_FICHA && (
              <div className="text-[13px] text-gray-700">
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider block">A nombre de</span>
                {nombreDeRazonSocial(datos, razonSocialPorDefecto(datos))}
              </div>
            )}
            {rellenos.length === 0 ? (
              <div className="text-sm text-gray-400 italic">
                Sin datos propios de facturación. Las facturas saldrán a nombre de{" "}
                {datos.name || "esta ficha"}
                {datos.taxId ? `, con el DNI ${datos.taxId}` : ""}.
              </div>
            ) : (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                {rellenos.map((c) => (
                  <div key={c.key} className="min-w-0">
                    <dt className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{c.label}</dt>
                    <dd className="text-[13px] text-gray-700 mt-0.5 [overflow-wrap:anywhere]">{datos[c.key]}</dd>
                  </div>
                ))}
              </dl>
            )}
            {error && <div className="text-xs text-rose-600">{error}</div>}
          </>
        ) : (
          <>
            {/* A NOMBRE DE QUIÉN (04/09/2026, Rodrigo): un desplegable con los
                tutores en vez de reescribir el nombre a mano. Se guarda QUIÉN
                y no el texto, así que corregir su apellido o rellenar su DNI en
                la pestaña de tutores arregla también las facturas siguientes.
                Cada factura puede desviarse de este defecto sin tocar la ficha.
                Solo sale si la familia tiene tutores: en una empresa sobra. */}
            {opcionesDeRazonSocial(datos).length > 1 && (
              <div>
                <label className={labelCls}>A nombre de</label>
                <select
                  className={inputCls}
                  value={borrador.fiscalGuardianId ?? LA_FICHA}
                  onChange={(e) => setBorrador((b) => ({ ...b, fiscalGuardianId: e.target.value }))}
                >
                  {opcionesDeRazonSocial(datos).map((o) => (
                    <option key={o.value || "ficha"} value={o.value}>
                      {o.value === LA_FICHA ? `${o.label} (la ficha)` : o.label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-gray-400 mt-1">
                  Sale por defecto en sus facturas nuevas, y en cada una se puede cambiar.
                  {opcionesDeRazonSocial(datos).find((o) => o.value === borrador.fiscalGuardianId)?.sinDni
                    ? " Ojo: sin DNI en la ficha de tutores no se podrá emitir a su nombre."
                    : ""}
                </p>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {CAMPOS.map((c) => (
                <div key={c.key}>
                  <label className={labelCls}>{c.label}</label>
                  <input
                    className={inputCls}
                    value={borrador[c.key] ?? ""}
                    placeholder={c.placeholder}
                    onChange={(e) => setBorrador((b) => ({ ...b, [c.key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            {error && <div className="text-xs text-rose-600">{error}</div>}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={guardar}
                disabled={guardando}
                className="text-sm font-medium px-3 py-1.5 rounded-md bg-[var(--color-primary)] text-white disabled:opacity-40"
              >
                {guardando ? "Guardando…" : "Guardar"}
              </button>
              <button onClick={() => { setEditando(false); setError(null); }} className="text-sm text-gray-500">
                Cancelar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
