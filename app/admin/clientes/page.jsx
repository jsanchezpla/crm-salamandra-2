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
 * Vivía en el CRM de clientes (/alta-clientes) y se movió al back-office
 * (2026-07-28). El motivo no es estético: dar de alta un cliente no es una tarea
 * DE un cliente, y tenerlo en el mismo sitio donde se atiende a Aumenta o a
 * Laura invitaba a confundir el contexto. Ahora vive detrás del subdominio, con
 * su puerta de nginx delante.
 *
 * Sigue protegido por el módulo `provisioning`, que solo tiene nuestro tenant:
 * el subdominio reduce superficie, no autoriza.
 *
 * Sobre el aspecto: el back-office es oscuro, pero un FORMULARIO largo se lee
 * mejor sobre claro. Chrome oscuro, superficie de trabajo clara.
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

/**
 * Editor de un cliente ya existente.
 *
 * Dos cosas que la pantalla tiene que dejar clarísimas, porque el backend las
 * trata en serio y de nada sirve si aquí se disimulan:
 *
 *  · Activar un módulo tarda ~20 s: dispara las migraciones del schema de ese
 *    cliente. Si no se avisa ANTES de pulsar, parece que se ha colgado y alguien
 *    recargará la página a mitad.
 *  · Suspender echa a sus usuarios en el acto. No es un ajuste, es cortarle el
 *    servicio a un negocio.
 */
/**
 * Confirmación antes de tocar los módulos de un cliente REAL.
 *
 * Marcar una casilla y pulsar «Guardar» era demasiado poco para lo que pasa
 * después: activar prepara tablas en la base de datos de ese cliente y tarda
 * unos veinte segundos, y quitar hace desaparecer un módulo entero del menú de
 * gente que está trabajando en ese momento. Los dos avisos existían, pero
 * estaban en la misma pantalla donde se marca la casilla — se leen una vez y se
 * dejan de ver.
 *
 * Lo que hace este paso es OBLIGAR A MIRAR la lista concreta de lo que se va a
 * activar y de lo que se va a quitar, con el nombre del cliente delante. No pide
 * teclear nada: la fricción útil aquí es leer, no copiar; un cuadro que exige
 * escribir el nombre se rellena en automático a la tercera vez y deja de
 * proteger.
 *
 * El botón de confirmar nace DESHABILITADO durante un segundo y medio, que es lo
 * único que evita de verdad el doble clic con el que se salta cualquier
 * confirmación sin haberla leído.
 */
function ConfirmarModulos({ cliente, nuevos, quitados, nombres, onConfirmar, onCancelar }) {
  const [listo, setListo] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setListo(true), 1500);
    return () => clearTimeout(t);
  }, []);

  const nombreDe = (key) => nombres[key] ?? key;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(15,23,42,0.55)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirmar-modulos-titulo"
    >
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl p-6 space-y-5">
        <div>
          <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">
            Vas a cambiar los módulos de
          </div>
          <h2 id="confirmar-modulos-titulo" className="text-xl font-semibold text-neutral-900 mt-1">
            {cliente.nombre}
          </h2>
        </div>

        {nuevos.length > 0 && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
            <div className="text-[11px] font-semibold text-emerald-900 uppercase tracking-wide mb-1.5">
              Se activan {nuevos.length}
            </div>
            <ul className="text-sm text-emerald-900 space-y-0.5">
              {nuevos.map((k) => <li key={k}>· {nombreDe(k)}</li>)}
            </ul>
            <p className="text-[11px] text-emerald-800 mt-2 leading-relaxed">
              Se preparan sus tablas en la base de datos de este cliente. Tarda unos 20 segundos y no
              se puede interrumpir a medias: no cierres la página.
            </p>
          </div>
        )}

        {quitados.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <div className="text-[11px] font-semibold text-amber-900 uppercase tracking-wide mb-1.5">
              Se quitan {quitados.length}
            </div>
            <ul className="text-sm text-amber-900 space-y-0.5">
              {quitados.map((k) => <li key={k}>· {nombreDe(k)}</li>)}
            </ul>
            <p className="text-[11px] text-amber-800 mt-2 leading-relaxed">
              Desaparecen del menú de quien esté trabajando ahora mismo. Sus datos se conservan y
              vuelven si los reactivas.
            </p>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={onCancelar}
            className="px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wide text-neutral-600 hover:bg-neutral-100"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={!listo}
            className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-40"
            style={{ background: "var(--color-primary, #1B3A2D)" }}
          >
            {listo ? "Sí, cambiar los módulos" : "Lee lo de arriba…"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditorCliente({ cliente, catalogo, onGuardar, guardando, avisos }) {
  const [f, setF] = useState({
    nombre: cliente.nombre,
    plan: cliente.plan,
    modulos: [...cliente.modulos],
  });

  const [confirmando, setConfirmando] = useState(false);

  const nuevos = f.modulos.filter((m) => !cliente.modulos.includes(m));
  const quitados = cliente.modulos.filter((m) => !f.modulos.includes(m));
  const hayCambios =
    f.nombre !== cliente.nombre || f.plan !== cliente.plan || nuevos.length > 0 || quitados.length > 0;

  // La confirmación enseña nombres, no claves: quien decide si un cliente tiene
  // «Documentos avanzado» no tiene por qué saber que por dentro se llama
  // `documents_avanzado`.
  const nombresDeModulo = useMemo(() => {
    const m = {};
    for (const g of catalogo ?? []) for (const mod of g.modulos ?? []) m[mod.key] = mod.nombre;
    return m;
  }, [catalogo]);

  function alternar(key) {
    setF((p) => ({
      ...p,
      modulos: p.modulos.includes(key) ? p.modulos.filter((k) => k !== key) : [...p.modulos, key],
    }));
  }

  async function suspender() {
    const suspendido = cliente.estado === "suspended";
    const texto = suspendido
      ? `Reactivar «${cliente.nombre}».\n\nSus usuarios volverán a poder entrar.`
      : `SUSPENDER «${cliente.nombre}».\n\nSus usuarios dejarán de poder entrar DE INMEDIATO y sus formularios públicos dejarán de responder.\n\nLos datos se conservan intactos.\n\n¿Seguro?`;
    if (!confirm(texto)) return;
    await onGuardar(cliente.slug, { estado: suspendido ? "active" : "suspended", confirmar: true });
  }

  return (
    <div className="mt-3 pt-3 border-t border-neutral-100 space-y-4">
      <div className="grid md:grid-cols-2 gap-3">
        <Campo etiqueta="Nombre">
          <input value={f.nombre} onChange={(e) => setF((p) => ({ ...p, nombre: e.target.value }))} className={inputCls} />
        </Campo>
        <Campo etiqueta="Plan">
          <input value={f.plan} onChange={(e) => setF((p) => ({ ...p, plan: e.target.value }))} className={inputCls} />
        </Campo>
      </div>

      <div>
        <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-2">
          Módulos ({f.modulos.length})
        </div>
        <div className="grid md:grid-cols-2 gap-x-4 gap-y-1">
          {catalogo.flatMap((g) => g.modulos).map((m) => {
            const marcado = f.modulos.includes(m.key);
            const esNuevo = marcado && !cliente.modulos.includes(m.key);
            const seQuita = !marcado && cliente.modulos.includes(m.key);
            return (
              <label key={m.key} className="flex items-center gap-2 py-1 cursor-pointer text-sm">
                <input type="checkbox" checked={marcado} onChange={() => alternar(m.key)}
                  className="rounded border-neutral-300 accent-[var(--color-primary,#1B3A2D)]" />
                <span className={seQuita ? "text-neutral-400 line-through" : "text-neutral-700"}>{m.nombre}</span>
                {esNuevo && <span className="text-[10px] text-emerald-700">se activará</span>}
                {seQuita && <span className="text-[10px] text-amber-700">se quitará</span>}
              </label>
            );
          })}
        </div>
      </div>

      {nuevos.length > 0 && (
        <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          Al guardar se prepararán las tablas de {nuevos.join(", ")} en la base de datos de este cliente.
          <b> Tarda unos 20 segundos.</b> No cierres la página.
        </div>
      )}
      {quitados.length > 0 && (
        <div className="text-[11px] text-neutral-600 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2">
          Quitar {quitados.join(", ")} solo los esconde del menú. <b>Sus datos se conservan</b> y vuelven si los reactivas.
        </div>
      )}

      {avisos?.length > 0 && (
        <ul className="text-[11px] text-neutral-700 bg-[#F4F6F4] border border-neutral-200 rounded-lg px-3 py-2 space-y-1">
          {avisos.map((a, i) => <li key={i}>· {a}</li>)}
        </ul>
      )}

      <div className="flex items-center justify-between gap-3 pt-1">
        <button type="button" onClick={suspender} disabled={guardando}
          className={`text-xs font-semibold uppercase tracking-wide disabled:opacity-40 ${
            cliente.estado === "suspended" ? "text-emerald-700" : "text-red-700"
          }`}>
          {cliente.estado === "suspended" ? "Reactivar cliente" : "Suspender cliente"}
        </button>
        {/* Cambiar el nombre o el plan se guarda directo; tocar los módulos pasa
            por la confirmación, que es lo que mueve tablas y menús. */}
        <button type="button" disabled={!hayCambios || guardando}
          onClick={() => {
            const tocaModulos = nuevos.length > 0 || quitados.length > 0;
            if (tocaModulos) setConfirmando(true);
            else onGuardar(cliente.slug, { nombre: f.nombre, plan: f.plan, modulos: f.modulos });
          }}
          className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-40"
          style={{ background: "var(--color-primary, #1B3A2D)" }}>
          {guardando ? (nuevos.length ? "Preparando la base de datos…" : "Guardando…") : "Guardar cambios"}
        </button>
      </div>

      {confirmando && (
        <ConfirmarModulos
          cliente={cliente}
          nuevos={nuevos}
          quitados={quitados}
          nombres={nombresDeModulo}
          onCancelar={() => setConfirmando(false)}
          onConfirmar={() => {
            setConfirmando(false);
            onGuardar(cliente.slug, { nombre: f.nombre, plan: f.plan, modulos: f.modulos });
          }}
        />
      )}
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
  // Aparte de las credenciales a propósito: los avisos son tareas pendientes y
  // no deben desaparecer al cerrar el modal de la contraseña.
  const [avisos, setAvisos] = useState([]);
  const [abierto, setAbierto] = useState(false);
  // Edición de un cliente ya existente.
  const [editando, setEditando] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [avisosEdit, setAvisosEdit] = useState([]);

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

  /**
   * Guarda cambios de un cliente existente.
   *
   * La petición puede tardar ~20 s cuando activa módulos (dispara las
   * migraciones de su schema), por eso no hay ningún timeout: cortarla dejaría
   * las filas escritas y el schema a medias, que es justo el estado que el
   * backend se esfuerza en evitar.
   */
  async function guardarEdicion(slug, cambios) {
    setErr(null);
    setAvisosEdit([]);
    setGuardando(true);
    try {
      const r = await fetch(`/api/admin/clientes/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cambios),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo guardar");
      setAvisosEdit(Array.isArray(j.data?.avisos) ? j.data.avisos : []);
      cargar();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setGuardando(false);
    }
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
      setAvisos(Array.isArray(j.data.avisos) ? j.data.avisos : []);
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
    <div className="p-4 lg:p-8 max-w-5xl mx-auto my-6 lg:my-10 rounded-xl bg-[#FAF9F7] text-neutral-800 shadow-[0_2px_40px_rgba(0,0,0,0.5)]">
      <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-[0.18em] mb-1.5">
            Salamandra · Interno
          </div>
          <h1 className="text-[26px] lg:text-[34px] leading-[1.05] text-neutral-900 tracking-tight">
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

            {/* Paquetes: marcan de golpe lo que se vende con un nombre. No
                sustituyen a las casillas — después se añade o se quita. */}
            {(datos.paquetes ?? []).length > 0 && (
              <div className="mb-4 flex flex-wrap gap-2">
                {datos.paquetes.map((p) => (
                  <button key={p.key} type="button" title={p.desc}
                    onClick={() => setForm((f) => ({ ...f, modulos: [...p.modulos] }))}
                    className="px-3 py-1.5 rounded-lg border border-neutral-200 text-xs text-neutral-700 hover:bg-neutral-50 transition">
                    {p.nombre}
                  </button>
                ))}
              </div>
            )}

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
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[11px] text-neutral-400">
                      {c.modulos.length} módulo{c.modulos.length === 1 ? "" : "s"}
                    </span>
                    <button
                      onClick={() => { setEditando(editando === c.slug ? null : c.slug); setAvisosEdit([]); }}
                      className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 hover:text-neutral-900"
                    >
                      {editando === c.slug ? "Cerrar" : "Editar"}
                    </button>
                  </div>
                </div>
                <div className="text-[11px] text-neutral-400 mt-1 truncate">{c.modulos.join(" · ") || "sin módulos"}</div>
                {editando === c.slug && datos && (
                  <EditorCliente
                    cliente={c}
                    catalogo={datos.catalogo}
                    onGuardar={guardarEdicion}
                    guardando={guardando}
                    avisos={avisosEdit}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Avisos del alta (p.ej. migraciones que no se pudieron aplicar). Van
          FUERA del modal de credenciales para que no se cierren con él: son
          cosas que hay que hacer, no un "hecho". */}
      {avisos.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-start justify-between gap-3 mb-1.5">
            <div className="text-[11px] font-bold uppercase tracking-wide text-amber-800">
              El alta terminó, pero queda algo por hacer
            </div>
            <button onClick={() => setAvisos([])} className="text-[11px] text-amber-700 hover:underline shrink-0">
              Entendido
            </button>
          </div>
          <ul className="space-y-1">
            {avisos.map((a, i) => (
              <li key={i} className="text-xs text-amber-900 break-words">{a}</li>
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
