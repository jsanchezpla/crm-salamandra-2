"use client";

/**
 * ClientOrganizacionSection — «Empresa o universidad» en la ficha (15/09/2026,
 * Rodrigo; AV-0153 de Aumenta).
 *
 * Tres cosas en una tarjeta, porque se leen juntas:
 *
 *   1. QUÉ ES la ficha: un cliente de los de siempre, una empresa o una
 *      universidad. Es lo que filtra el desplegable del listado.
 *   2. Si es una persona: «Es alumno en prácticas» con su universidad (y, donde
 *      no hay consulta externa, la empresa por la que viene), con «crear nueva»
 *      en el mismo sitio.
 *   3. QUIÉN PAGA lo suyo: la persona, la organización entera o a medias. Es lo
 *      que usa Cobros para apuntar cada parte a nombre de quien la paga, y así
 *      «Facturar el mes» saca una factura a cada uno sin tocar nada.
 *
 * Si la ficha ES una universidad o una empresa, en lugar de 2 y 3 enseña quién
 * cuelga de ella. En Aumenta los alumnos son PACIENTES de la ficha de la
 * universidad (vinieron así de Organízate): esos pagan por la universidad sin
 * marcar nada, y la tarjeta lo dice.
 *
 * @param conEmpresa  pinta aquí «Viene por una empresa». Donde hay clínica ya lo
 *                    pinta «Consulta externa» (con su regla de quién la ve), y
 *                    dos desplegables de la misma empresa se contradirían.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import SelectorOrganizacion from "./SelectorOrganizacion.jsx";
import { organizacionQuePaga } from "../../lib/clients/organizaciones.js";

const TIPOS = [
  { value: "", label: "Cliente (una persona o una familia)" },
  { value: "empresa", label: "Empresa" },
  { value: "universidad", label: "Universidad" },
];

export default function ClientOrganizacionSection({ clientId, conEmpresa = true }) {
  const [ficha, setFicha] = useState(null);
  const [vinculados, setVinculados] = useState([]);
  const [nombreOrg, setNombreOrg] = useState(null);
  const [pctTexto, setPctTexto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    const j = await fetch(`/api/clients/${clientId}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const f = j?.data ?? null;
    setFicha(f);
    if (!f) return;
    setPctTexto(f.pagoOrganizacionPct == null ? "" : String(Number(f.pagoOrganizacionPct)));
    if (f.tipoFicha) {
      const v = await fetch(`/api/clients?vinculadosA=${clientId}&limit=200&orden=nombre&dir=asc`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null)).catch(() => null);
      setVinculados(v?.data?.clients ?? []);
    }
    const org = organizacionQuePaga(f) ?? (f.empresaId ? { id: f.empresaId } : null);
    if (org?.id) {
      const o = await fetch(`/api/clients/${org.id}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      setNombreOrg(o?.data?.name ?? null);
    } else {
      setNombreOrg(null);
    }
  }, [clientId]);

  useEffect(() => { cargar(); }, [cargar]);
  // La empresa de una consulta externa se elige en SU tarjeta: al cambiarla,
  // «Quién paga lo suyo» tiene que aparecer aquí sin recargar la página.
  useEffect(() => {
    const alCambiar = (e) => { if (String(e.detail?.clientId) === String(clientId)) cargar(); };
    window.addEventListener("crm:ficha-organizacion", alCambiar);
    return () => window.removeEventListener("crm:ficha-organizacion", alCambiar);
  }, [clientId, cargar]);

  async function guardar(cambios, mensaje) {
    setGuardando(true);
    setError(null);
    setAviso(null);
    // Optimista: la pantalla cambia ya, y si el servidor dice que no, se recarga.
    setFicha((f) => ({ ...f, ...cambios }));
    try {
      const r = await fetch(`/api/clients/${clientId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cambios),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error || "No se ha podido guardar");
      setAviso(mensaje);
    } catch (e) {
      setError(e.message);
    }
    await cargar();
    setGuardando(false);
  }

  if (!ficha) return null;

  const tipo = ficha.tipoFicha ?? "";
  const org = organizacionQuePaga(ficha);
  const laOrg = nombreOrg ?? (org?.tipo === "universidad" ? "la universidad" : "la empresa");
  const pct = ficha.pagoOrganizacionPct == null ? null : Number(ficha.pagoOrganizacionPct);
  const modoPago = pct == null ? "" : pct >= 100 ? "todo" : pct <= 0 ? "persona" : "reparto";
  const pacientes = Array.isArray(ficha.pacientes) ? ficha.pacientes : [];

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden mt-6">
      <div className="px-5 py-4 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-700">Empresa o universidad</span>
      </div>

      <div className="p-5 space-y-5">
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Esta ficha es</label>
          <select
            value={tipo}
            disabled={guardando}
            onChange={(e) => {
              const v = e.target.value || null;
              guardar({ tipoFicha: v }, v ? `Marcada como ${v}: ya sale en su filtro del listado.` : "Marcada como cliente.");
            }}
            className="w-full sm:w-auto border border-gray-200 rounded-md px-2.5 py-1.5 text-sm bg-white"
          >
            {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>

        {tipo ? (
          <div>
            <p className="text-[11px] font-medium text-gray-500 mb-1.5">
              {tipo === "universidad" ? "Alumnos en prácticas" : "Quién viene por esta empresa"}
            </p>
            {vinculados.length === 0 && pacientes.length === 0 ? (
              <p className="text-sm text-gray-400">
                Nadie todavía. Se añade desde la ficha de cada {tipo === "universidad" ? "alumno" : "persona"}.
              </p>
            ) : (
              <ul className="space-y-1">
                {vinculados.map((v) => (
                  <li key={v.id} className="text-sm">
                    <Link href={`/clientes/${v.id}`} className="text-[var(--color-primary)] hover:underline">{v.name}</Link>
                    <span className="text-[11px] text-gray-400 ml-2">{textoDePago(v.pagoOrganizacionPct)}</span>
                  </li>
                ))}
                {pacientes.map((p) => (
                  <li key={p.id ?? p.nombre} className="text-sm text-gray-700">
                    {p.nombre ?? [p.firstName, p.lastName].filter(Boolean).join(" ")}
                    <span className="text-[11px] text-gray-400 ml-2">paciente de esta ficha · lo paga esta {tipo}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <>
            <div>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!ficha.esAlumnoPracticas}
                  disabled={guardando}
                  onChange={(e) => {
                    const v = e.target.checked;
                    guardar({ esAlumnoPracticas: v }, v ? "Marcado como alumno en prácticas." : "Ya no es alumno en prácticas.");
                  }}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                />
                <span className="text-sm text-gray-700">
                  Es alumno en prácticas
                  <span className="block text-[11px] text-gray-500 mt-0.5 leading-relaxed">
                    Viene de una universidad. Elige cuál y abajo quién paga lo suyo.
                  </span>
                </span>
              </label>
              {ficha.esAlumnoPracticas && (
                <div className="mt-3 sm:ml-7">
                  <SelectorOrganizacion
                    tipo="universidad"
                    etiqueta="Universidad"
                    value={ficha.universidadId ?? ""}
                    excluirId={clientId}
                    disabled={guardando}
                    onChange={(id, nombre) => {
                      setNombreOrg(nombre);
                      guardar({ universidadId: id }, id ? `Universidad: ${nombre}` : "Universidad quitada");
                    }}
                  />
                </div>
              )}
            </div>

            {conEmpresa && (
              <SelectorOrganizacion
                tipo="empresa"
                etiqueta="Viene por una empresa"
                value={ficha.empresaId ?? ""}
                excluirId={clientId}
                disabled={guardando}
                onChange={(id, nombre) => {
                  if (!org) setNombreOrg(nombre);
                  guardar({ empresaId: id, categoriaExterna: nombre }, id ? `Empresa: ${nombre}` : "Empresa quitada");
                }}
              />
            )}

            {org && (
              <div>
                <p className="text-[11px] font-medium text-gray-500 mb-1.5">Quién paga lo suyo</p>
                <div className="space-y-1.5">
                  {[
                    { modo: "todo", texto: `Todo ${nombreOrg ?? laOrg}`, pct: 100 },
                    { modo: "persona", texto: "Todo la propia persona", pct: 0 },
                    { modo: "reparto", texto: "A medias", pct: modoPago === "reparto" ? pct : 50 },
                  ].map((o) => (
                    <label key={o.modo} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                      <input
                        type="radio"
                        name={`pago-org-${clientId}`}
                        checked={modoPago === o.modo}
                        disabled={guardando}
                        onChange={() => guardar({ pagoOrganizacionPct: o.pct }, "Guardado quién paga.")}
                        className="accent-[var(--color-primary)]"
                      />
                      {o.texto}
                    </label>
                  ))}
                </div>
                {modoPago === "reparto" && (
                  <div className="mt-2 sm:ml-6 flex items-center gap-2 flex-wrap text-sm text-gray-700">
                    <span>{nombreOrg ?? laOrg} paga el</span>
                    <input
                      inputMode="decimal"
                      value={pctTexto}
                      onChange={(e) => setPctTexto(e.target.value)}
                      onBlur={() => {
                        if (String(Number(pctTexto.replace(",", "."))) === String(pct)) return;
                        guardar({ pagoOrganizacionPct: pctTexto }, "Guardado el reparto.");
                      }}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                      className="w-16 border border-gray-200 rounded-md px-2 py-1 text-sm text-right"
                    />
                    <span>% y la persona el resto.</span>
                  </div>
                )}
                {modoPago === "" && (
                  <p className="text-[11px] text-amber-700 mt-1.5">Sin decir: Cobros lo apuntará todo a nombre de esta ficha.</p>
                )}
                <p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed">
                  Al apuntar un cobro de esta ficha en Facturación → Cobros, cada parte se pone a nombre de quien
                  la paga, y «Facturar el mes» le saca a cada uno su factura.
                </p>
              </div>
            )}
          </>
        )}

        {aviso && <p className="text-[11px] text-emerald-700">{aviso}</p>}
        {error && <p className="text-[11px] text-red-600">{error}</p>}
      </div>
    </div>
  );
}

function textoDePago(pctCrudo) {
  if (pctCrudo == null) return "quién paga: sin decir";
  const n = Number(pctCrudo);
  if (n >= 100) return "lo paga todo la organización";
  if (n <= 0) return "lo paga la persona";
  return `la organización paga el ${n.toLocaleString("es-ES")} %`;
}
