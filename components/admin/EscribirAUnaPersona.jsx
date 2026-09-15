"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { coincidePorNombre } from "@/lib/utils/busqueda.js";
import { LIMITES, MB_POR_ADJUNTO } from "../../lib/buzon/buzon.js";

/**
 * EscribirAUnaPersona — el panel «Escribir» del Buzón (15/09/2026, Rodrigo).
 *
 * Cliente → persona → asunto, mensaje y capturas, lo mismo que puede
 * mandarnos cualquiera de ellos desde Ayuda. Los dos desplegables llevan
 * buscador (sin tildes ni mayúsculas, `coincidePorNombre`). Al mandar, abre el
 * hilo recién creado en la bandeja (`onEnviado(id)`).
 */

const ROL = { admin: "dirección", superadmin: "dirección", manager: "responsable", user: "equipo" };

function Buscable({ etiqueta, placeholder, opciones, valor, onElegir, deshabilitado, vacio }) {
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const caja = useRef(null);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e) => {
      if (caja.current && !caja.current.contains(e.target)) setAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto]);

  const elegida = opciones.find((o) => o.id === valor) ?? null;
  const visibles = opciones.filter((o) => coincidePorNombre(q, [o.titulo, o.detalle]));

  return (
    <div ref={caja} className="relative">
      <label className="block text-[11px] mb-1" style={{ color: "var(--tenue)" }}>
        {etiqueta}
      </label>
      <button
        type="button"
        disabled={deshabilitado}
        onClick={() => {
          setAbierto((v) => !v);
          setQ("");
        }}
        className="w-full text-left rounded px-3 py-2 text-[13px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between gap-2"
        style={{ background: "var(--bg)", border: "1px solid var(--line)", color: elegida ? "var(--text)" : "var(--tenue)" }}
      >
        <span className="truncate">
          {elegida ? (
            <>
              {elegida.titulo}
              {elegida.detalle && <span style={{ color: "var(--tenue)" }}> · {elegida.detalle}</span>}
            </>
          ) : (
            placeholder
          )}
        </span>
        <span aria-hidden="true" style={{ color: "var(--tenue)" }}>▾</span>
      </button>

      {abierto && (
        <div
          className="absolute left-0 right-0 mt-1 z-10 rounded shadow-lg overflow-hidden"
          style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
        >
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar…"
            className="w-full px-3 py-2 text-[13px] outline-none"
            style={{ background: "var(--bg)", borderBottom: "1px solid var(--line)", color: "var(--text)" }}
          />
          <ul className="max-h-64 overflow-y-auto">
            {visibles.length === 0 && (
              <li className="px-3 py-2 text-[12px]" style={{ color: "var(--tenue)" }}>
                {opciones.length ? "Nada con esa búsqueda." : vacio}
              </li>
            )}
            {visibles.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => {
                    onElegir(o.id);
                    setAbierto(false);
                  }}
                  className="w-full text-left px-3 py-2 text-[13px] cursor-pointer hover:bg-black/5"
                  style={{ color: "var(--text)", background: o.id === valor ? "var(--panel-alto)" : undefined }}
                >
                  {o.titulo}
                  {o.detalle && (
                    <span className="block text-[11px]" style={{ color: "var(--tenue)" }}>
                      {o.detalle}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function EscribirAUnaPersona({ onCerrar, onEnviado }) {
  const [clientes, setClientes] = useState(null);
  const [tenantId, setTenantId] = useState("");
  const [personas, setPersonas] = useState([]);
  const [cargandoPersonas, setCargandoPersonas] = useState(false);
  const [usuarioId, setUsuarioId] = useState("");
  const [asunto, setAsunto] = useState("");
  const [cuerpo, setCuerpo] = useState("");
  const [ficheros, setFicheros] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState(null);

  useEffect(() => {
    fetch("/api/admin/buzon/escribir", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) throw new Error(j.error || "No se pudieron leer los clientes");
        setClientes(j.data.clientes);
      })
      .catch((e) => setFallo(e.message));
  }, []);

  useEffect(() => {
    setUsuarioId("");
    setPersonas([]);
    if (!tenantId) return;
    let vivo = true;
    setCargandoPersonas(true);
    fetch(`/api/admin/buzon/escribir?tenantId=${tenantId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!vivo) return;
        if (!j.ok) throw new Error(j.error || "No se pudieron leer las personas");
        setPersonas(j.data.personas);
      })
      .catch((e) => vivo && setFallo(e.message))
      .finally(() => vivo && setCargandoPersonas(false));
    return () => {
      vivo = false;
    };
  }, [tenantId]);

  const opcionesClientes = useMemo(
    () => (clientes ?? []).map((c) => ({ id: c.id, titulo: c.nombre, detalle: c.slug })),
    [clientes]
  );
  const opcionesPersonas = useMemo(
    () =>
      personas.map((p) => ({
        id: p.id,
        titulo: p.nombre || p.usuario,
        detalle: [p.nombre ? p.usuario : null, ROL[p.rol] ?? p.rol].filter(Boolean).join(" · "),
      })),
    [personas]
  );

  function elegirFicheros(e) {
    const lista = Array.from(e.target.files ?? []);
    e.target.value = "";
    const todos = [...ficheros, ...lista];
    if (todos.length > LIMITES.adjuntos) {
      setFallo(`Como mucho ${LIMITES.adjuntos} capturas.`);
      return;
    }
    const grande = todos.find((f) => f.size > LIMITES.bytesPorAdjunto);
    if (grande) {
      setFallo(`«${grande.name}» pesa más de ${MB_POR_ADJUNTO} MB.`);
      return;
    }
    setFallo(null);
    setFicheros(todos);
  }

  const listo = tenantId && usuarioId && asunto.trim().length >= LIMITES.asuntoMinimo && cuerpo.trim();

  async function enviar(e) {
    e.preventDefault();
    if (!listo || enviando) return;
    setEnviando(true);
    setFallo(null);
    try {
      const fd = new FormData();
      fd.set("tenantId", tenantId);
      fd.set("usuarioId", usuarioId);
      fd.set("asunto", asunto);
      fd.set("cuerpo", cuerpo);
      for (const f of ficheros) fd.append("adjuntos", f);
      const res = await fetch("/api/admin/buzon/escribir", { method: "POST", body: fd });
      let json = null;
      try {
        json = await res.json();
      } catch {
        throw new Error(res.status === 413 ? `Demasiado grande: como mucho ${MB_POR_ADJUNTO} MB por captura.` : "No se pudo enviar");
      }
      if (!res.ok) throw new Error(json.error || "No se pudo enviar");
      onEnviado(json.data.id);
    } catch (err) {
      setFallo(err.message);
      setEnviando(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onCerrar} aria-hidden="true" />
      <aside
        className="fixed top-0 right-0 bottom-0 w-full sm:w-[540px] z-50 shadow-xl flex flex-col"
        style={{ background: "var(--panel)" }}
      >
        <div className="px-5 py-4 flex items-start justify-between gap-3" style={{ borderBottom: "1px solid var(--line)" }}>
          <div>
            <div className="text-[11px]" style={{ color: "var(--tenue)" }}>
              Buzón · nuevo mensaje
            </div>
            <h2 className="text-[15px] font-semibold" style={{ color: "var(--text)" }}>
              Escribir a una persona
            </h2>
          </div>
          <button onClick={onCerrar} className="cursor-pointer text-xl leading-none" style={{ color: "var(--tenue)" }} aria-label="Cerrar">
            ×
          </button>
        </div>

        <form onSubmit={enviar} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <Buscable
            etiqueta="Cliente"
            placeholder={clientes ? "Elige el cliente…" : "Cargando clientes…"}
            opciones={opcionesClientes}
            valor={tenantId}
            onElegir={setTenantId}
            deshabilitado={!clientes}
            vacio="No hay clientes activos."
          />
          <Buscable
            etiqueta="Persona"
            placeholder={!tenantId ? "Primero elige el cliente" : cargandoPersonas ? "Cargando personas…" : "Elige la persona…"}
            opciones={opcionesPersonas}
            valor={usuarioId}
            onElegir={setUsuarioId}
            deshabilitado={!tenantId || cargandoPersonas}
            vacio="Este cliente no tiene cuentas."
          />

          <div>
            <label className="block text-[11px] mb-1" style={{ color: "var(--tenue)" }} htmlFor="escribir-asunto">
              Asunto
            </label>
            <input
              id="escribir-asunto"
              value={asunto}
              onChange={(e) => setAsunto(e.target.value)}
              maxLength={LIMITES.asunto}
              className="w-full rounded px-3 py-2 text-[13px] outline-none"
              style={{ background: "var(--bg)", border: "1px solid var(--line)", color: "var(--text)" }}
            />
          </div>

          <div>
            <label className="block text-[11px] mb-1" style={{ color: "var(--tenue)" }} htmlFor="escribir-cuerpo">
              Mensaje
            </label>
            <textarea
              id="escribir-cuerpo"
              value={cuerpo}
              onChange={(e) => setCuerpo(e.target.value)}
              rows={12}
              maxLength={LIMITES.cuerpo}
              className="w-full rounded px-3 py-2 text-[13px] outline-none leading-relaxed"
              style={{ background: "var(--bg)", border: "1px solid var(--line)", color: "var(--text)" }}
            />
            <div className="text-[11px] text-right" style={{ color: "var(--tenue)" }}>
              {cuerpo.length} / {LIMITES.cuerpo}
            </div>
          </div>

          <div>
            <label className="inline-block text-[12px] px-3 py-1.5 rounded cursor-pointer" style={{ border: "1px solid var(--line)", color: "var(--dim)" }}>
              Adjuntar capturas
              <input type="file" multiple accept="image/*,application/pdf" onChange={elegirFicheros} className="hidden" />
            </label>
            <span className="text-[11px] ml-2" style={{ color: "var(--tenue)" }}>
              Hasta {LIMITES.adjuntos}, {MB_POR_ADJUNTO} MB cada una
            </span>
            {ficheros.length > 0 && (
              <ul className="mt-2 space-y-1">
                {ficheros.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-[12px]" style={{ color: "var(--text)" }}>
                    <span className="truncate">{f.name}</span>
                    <span style={{ color: "var(--tenue)" }}>{Math.round(f.size / 1024)} kB</span>
                    <button
                      type="button"
                      onClick={() => setFicheros(ficheros.filter((_, j) => j !== i))}
                      className="cursor-pointer"
                      style={{ color: "var(--alerta)" }}
                    >
                      quitar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="text-[11px] leading-relaxed" style={{ color: "var(--tenue)" }}>
            Le llega a su CRM, en Ayuda, con aviso en la campana; no sale correo. Como todo lo de Ayuda, lo
            pueden ver sus compañeros del mismo centro. Si contesta, vuelve aquí como cualquier aviso.
          </p>

          {fallo && <div className="text-[12px]" style={{ color: "var(--alerta)" }}>{fallo}</div>}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!listo || enviando}
              className="px-4 py-2 rounded text-[13px] text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: "var(--ok)" }}
            >
              {enviando ? "Enviando…" : "Enviar"}
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}
