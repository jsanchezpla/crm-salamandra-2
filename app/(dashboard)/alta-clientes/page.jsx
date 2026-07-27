"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import CredentialsModal from "@/components/team/CredentialsModal.jsx";

/**
 * Alta de clientes — el panel interno de Salamandra Solutions.
 *
 * Dar de alta un cliente costaba horas de trabajo artesanal (clonar un seed de
 * 400 líneas, un script por módulo, otro para la marca...). Aquí es un
 * formulario: nombre, identificador, módulos, marca opcional y datos fiscales.
 *
 * Solo lo ve nuestro propio tenant (módulo `provisioning`).
 */

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

function Campo({ etiqueta, pista, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">{etiqueta}</label>
      {children}
      {pista && <p className="text-[10px] text-neutral-400">{pista}</p>}
    </div>
  );
}

function sugerirSlug(nombre) {
  return String(nombre || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 41);
}

export default function AltaClientesPage() {
  const [datos, setDatos] = useState(null);
  const [err, setErr] = useState(null);
  const [creando, setCreando] = useState(false);
  const [credenciales, setCredenciales] = useState(null);
  const [abierto, setAbierto] = useState(false);

  const [form, setForm] = useState({
    nombre: "",
    slug: "",
    slugTocado: false,
    adminEmail: "",
    modulos: [],
    primaryColor: "",
    secondaryColor: "",
    logoUrl: "",
    fiscalName: "",
    taxId: "",
    address: "",
    city: "",
    zip: "",
  });

  const cargar = useCallback(() => {
    fetch("/api/provisioning/clientes", { cache: "no-store" })
      .then((r) => r.json().then((j) => ({ status: r.status, j })))
      .then(({ status, j }) => {
        if (j.ok) {
          setDatos(j.data);
          setForm((f) => (f.modulos.length ? f : { ...f, modulos: j.data.recomendados }));
        } else setErr(status === 403 ? "Este panel es solo para Salamandra Solutions." : j.error || "Error");
      })
      .catch(() => setErr("No se pudo cargar el panel"));
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  // Dependencias: marcar Clínica arrastra Pacientes y Clientes, y se avisa.
  const metaPorClave = useMemo(() => {
    const m = {};
    for (const g of datos?.catalogo ?? []) for (const x of g.modulos) m[x.key] = x;
    return m;
  }, [datos]);

  const arrastrados = useMemo(() => {
    const fuera = new Set();
    const pend = [...form.modulos];
    while (pend.length) {
      const k = pend.pop();
      for (const dep of metaPorClave[k]?.requiere || []) {
        if (!form.modulos.includes(dep)) { fuera.add(dep); pend.push(dep); }
      }
    }
    return [...fuera];
  }, [form.modulos, metaPorClave]);

  function toggleModulo(key) {
    setForm((f) => ({
      ...f,
      modulos: f.modulos.includes(key) ? f.modulos.filter((k) => k !== key) : [...f.modulos, key],
    }));
  }

  function cambiarNombre(v) {
    setForm((f) => ({ ...f, nombre: v, slug: f.slugTocado ? f.slug : sugerirSlug(v) }));
  }

  async function crear(e) {
    e.preventDefault();
    setErr(null);
    if (!form.nombre.trim()) { setErr("Escribe el nombre del cliente"); return; }
    if (!form.modulos.length) { setErr("Elige al menos un módulo"); return; }
    if (!confirm(`Se va a crear el cliente «${form.nombre}» con identificador «${form.slug}».\n\nEl identificador NO se puede cambiar después. ¿Continuar?`)) return;

    setCreando(true);
    try {
      const r = await fetch("/api/provisioning/clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: form.nombre,
          slug: form.slug,
          adminEmail: form.adminEmail || undefined,
          modulos: form.modulos,
          brand: { primaryColor: form.primaryColor, secondaryColor: form.secondaryColor, logoUrl: form.logoUrl },
          fiscal: { fiscalName: form.fiscalName, taxId: form.taxId, address: form.address, city: form.city, zip: form.zip },
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo crear el cliente");
      setCredenciales({ username: j.data.adminEmail, password: j.data.password, slug: j.data.slug, modulos: j.data.modulos });
      setAbierto(false);
      setForm((f) => ({ ...f, nombre: "", slug: "", slugTocado: false, adminEmail: "", fiscalName: "", taxId: "", address: "", city: "", zip: "" }));
      cargar();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setCreando(false);
    }
  }

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto">
      <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <div className="eyebrow mb-1.5">Salamandra · Interno</div>
          <h1 className="font-display text-[26px] lg:text-[34px] leading-[1.05] text-[var(--ink-900)] tracking-tight">
            Alta de clientes
          </h1>
          <p className="text-xs text-neutral-400 mt-2 max-w-xl">
            Crea un cliente nuevo con sus módulos, su marca y sus datos fiscales. Todo lo que antes
            eran scripts a mano.
          </p>
        </div>
        {!abierto && datos && (
          <button onClick={() => setAbierto(true)}
            className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white"
            style={{ background: "var(--color-primary, #1B3A2D)" }}>
            + Nuevo cliente
          </button>
        )}
      </div>

      {err && <div className="mb-4 text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</div>}

      {!datos && !err && <div className="text-xs text-neutral-400">Cargando…</div>}

      {/* Formulario de alta */}
      {abierto && datos && (
        <form onSubmit={crear} className="bg-white border border-neutral-200 rounded-xl p-5 space-y-5 mb-8">
          <div className="grid md:grid-cols-2 gap-4">
            <Campo etiqueta="Nombre del cliente *">
              <input value={form.nombre} onChange={(e) => cambiarNombre(e.target.value)}
                className={inputCls} placeholder="Centro Aumenta" />
            </Campo>
            <Campo etiqueta="Identificador *" pista="Es el nombre interno en la base de datos: NO se puede cambiar después.">
              <input value={form.slug}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value, slugTocado: true }))}
                className={inputCls + " font-mono"} placeholder="centro_aumenta" />
            </Campo>
          </div>

          <Campo etiqueta="Usuario administrador" pista="Si lo dejas vacío se crea admin_{identificador}. La contraseña se genera sola y se enseña una vez.">
            <input value={form.adminEmail} onChange={(e) => setForm((f) => ({ ...f, adminEmail: e.target.value }))}
              className={inputCls} placeholder="direccion@sucliente.com" />
          </Campo>

          {/* Módulos */}
          <div>
            <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-2">
              Módulos contratados ({form.modulos.length})
            </div>
            <div className="space-y-4">
              {datos.catalogo.map((g) => (
                <div key={g.grupo}>
                  <div className="text-[11px] font-semibold text-neutral-500 mb-1.5">{g.grupo}</div>
                  <div className="grid md:grid-cols-2 gap-x-4 gap-y-1.5">
                    {g.modulos.map((m) => {
                      const marcado = form.modulos.includes(m.key);
                      const auto = arrastrados.includes(m.key);
                      return (
                        <label key={m.key}
                          className={`flex items-start gap-2.5 p-2 rounded-lg cursor-pointer transition ${marcado || auto ? "bg-neutral-50" : "hover:bg-neutral-50/60"}`}>
                          <input type="checkbox" checked={marcado || auto} disabled={auto}
                            onChange={() => toggleModulo(m.key)}
                            className="mt-0.5 rounded border-neutral-300 accent-[var(--color-primary,#1B3A2D)]" />
                          <div className="min-w-0">
                            <div className="text-sm text-neutral-800">
                              {m.nombre}
                              {auto && <span className="ml-1.5 text-[10px] text-neutral-400">(lo necesita otro módulo)</span>}
                            </div>
                            <div className="text-[11px] text-neutral-500 leading-snug">{m.desc}</div>
                            {m.avisa && (marcado || auto) && (
                              <div className="text-[11px] text-amber-700 mt-0.5">⚠ {m.avisa}</div>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Marca */}
          <details className="border-t border-neutral-100 pt-4">
            <summary className="text-sm font-medium text-neutral-700 cursor-pointer">Marca (opcional)</summary>
            <div className="grid md:grid-cols-3 gap-4 mt-3">
              <Campo etiqueta="Color principal" pista="Hex, p. ej. #563EA6">
                <div className="flex gap-2">
                  <input type="color" value={form.primaryColor || "#1B3A2D"}
                    onChange={(e) => setForm((f) => ({ ...f, primaryColor: e.target.value }))}
                    className="h-9 w-12 rounded border border-neutral-200 bg-white" />
                  <input value={form.primaryColor} onChange={(e) => setForm((f) => ({ ...f, primaryColor: e.target.value }))}
                    className={inputCls + " font-mono"} placeholder="#563EA6" />
                </div>
              </Campo>
              <Campo etiqueta="Color secundario">
                <div className="flex gap-2">
                  <input type="color" value={form.secondaryColor || "#15063F"}
                    onChange={(e) => setForm((f) => ({ ...f, secondaryColor: e.target.value }))}
                    className="h-9 w-12 rounded border border-neutral-200 bg-white" />
                  <input value={form.secondaryColor} onChange={(e) => setForm((f) => ({ ...f, secondaryColor: e.target.value }))}
                    className={inputCls + " font-mono"} placeholder="#15063F" />
                </div>
              </Campo>
              <Campo etiqueta="Logo (URL)" pista="Se puede subir después desde su Configuración.">
                <input value={form.logoUrl} onChange={(e) => setForm((f) => ({ ...f, logoUrl: e.target.value }))}
                  className={inputCls} placeholder="https://…/logo.png" />
              </Campo>
            </div>
          </details>

          {/* Fiscal */}
          <details className="border-t border-neutral-100 pt-4">
            <summary className="text-sm font-medium text-neutral-700 cursor-pointer">
              Datos fiscales (opcional, para su facturación)
            </summary>
            <div className="grid md:grid-cols-2 gap-4 mt-3">
              <Campo etiqueta="Razón social">
                <input value={form.fiscalName} onChange={(e) => setForm((f) => ({ ...f, fiscalName: e.target.value }))}
                  className={inputCls} placeholder="Centro Aumenta S.L." />
              </Campo>
              <Campo etiqueta="CIF / NIF">
                <input value={form.taxId} onChange={(e) => setForm((f) => ({ ...f, taxId: e.target.value }))}
                  className={inputCls} placeholder="B12345678" />
              </Campo>
              <Campo etiqueta="Dirección">
                <input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} className={inputCls} />
              </Campo>
              <div className="grid grid-cols-2 gap-3">
                <Campo etiqueta="Ciudad">
                  <input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} className={inputCls} />
                </Campo>
                <Campo etiqueta="C.P.">
                  <input value={form.zip} onChange={(e) => setForm((f) => ({ ...f, zip: e.target.value }))} className={inputCls} />
                </Campo>
              </div>
            </div>
            <p className="text-[10px] text-neutral-400 mt-2">
              Solo se guardan si el cliente lleva el módulo de Facturación. Si no, se rellenan luego.
            </p>
          </details>

          <div className="flex justify-end gap-2 pt-2 border-t border-neutral-100">
            <button type="button" onClick={() => setAbierto(false)}
              className="px-4 py-2 text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700">
              Cancelar
            </button>
            <button type="submit" disabled={creando}
              className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-50"
              style={{ background: "var(--color-primary, #1B3A2D)" }}>
              {creando ? "Creando cliente…" : "Crear cliente"}
            </button>
          </div>
        </form>
      )}

      {/* Clientes existentes */}
      {datos && (
        <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-neutral-700">Clientes en el CRM</span>
            <span className="text-[10px] text-neutral-400 uppercase tracking-widest">{datos.clientes.length}</span>
          </div>
          <ul className="divide-y divide-neutral-100">
            {datos.clientes.map((c) => (
              <li key={c.id} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-neutral-800">{c.nombre}</span>
                    <span className="text-[11px] text-neutral-400 font-mono ml-2">{c.slug}</span>
                    {c.estado !== "active" && (
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100">
                        {c.estado}
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-neutral-400 shrink-0">
                    {c.modulos.length} módulo{c.modulos.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="text-[11px] text-neutral-400 mt-1 truncate">{c.modulos.join(" · ") || "sin módulos"}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {credenciales && (
        <CredentialsModal
          username={credenciales.username}
          password={credenciales.password}
          title={`Cliente «${credenciales.slug}» creado`}
          onClose={() => setCredenciales(null)}
        />
      )}
    </div>
  );
}
