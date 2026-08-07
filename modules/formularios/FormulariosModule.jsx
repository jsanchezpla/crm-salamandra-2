"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import HelpTooltip from "../../components/ui/HelpTooltip.jsx";

/**
 * Bandeja del módulo Formularios.
 *
 * Cada solicitud es una tarjeta con lo que la persona escribió, tal cual, y
 * dos decisiones: aceptar (crea la ficha de cliente) o descartar.
 *
 * Es TARJETAS y no tabla a propósito, también en escritorio: las respuestas son
 * texto largo —un motivo de consulta, lo que espera del acompañamiento— y en
 * una tabla habría que recortarlas con puntos suspensivos justo en lo que hay
 * que leer para decidir.
 *
 * Genérico por diseño: no sabe qué preguntas hay. Pinta lo que venga en
 * `answers`, que trae el enunciado dentro de cada respuesta.
 */

const PESTANAS = [
  { key: "pending", label: "Pendientes" },
  { key: "accepted", label: "Aceptadas" },
  { key: "rejected", label: "Descartadas" },
];

function fmtFecha(valor) {
  if (!valor) return "—";
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" }) +
    " · " + d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function haceCuanto(valor) {
  if (!valor) return "";
  const minutos = Math.floor((Date.now() - new Date(valor).getTime()) / 60000);
  if (minutos < 1) return "ahora mismo";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? "ayer" : `hace ${dias} días`;
}

export default function FormulariosModule() {
  const [tab, setTab] = useState("pending");
  const [datos, setDatos] = useState({ submissions: [], recuento: { pending: 0, accepted: 0, rejected: 0 }, forms: [] });
  const [cargando, setCargando] = useState(true);
  const [fallo, setFallo] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [trabajando, setTrabajando] = useState(null);
  const [descartando, setDescartando] = useState(null);
  const [motivoDescarte, setMotivoDescarte] = useState("");
  const [duplicados, setDuplicados] = useState({});
  const [equipo, setEquipo] = useState([]);

  /*
   * El equipo, para poder asignar la paciente al aceptarla (06/08/2026,
   * Rodrigo): «hay que asignar el paciente a una nutricionista y así ve solo
   * los horarios de esa».
   *
   * Si el cliente no tiene el módulo de equipo, esto responde 403 y la lista se
   * queda vacía: entonces no se enseña el desplegable y aceptar funciona como
   * siempre. Una bandeja que ya funciona no se rompe por no poder asignar.
   */
  useEffect(() => {
    let vivo = true;
    fetch("/api/team?status=active&limit=200", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo && j?.data?.members) setEquipo(j.data.members); })
      .catch(() => {});
    return () => { vivo = false; };
  }, []);

  const cargar = useCallback(async (estado) => {
    setCargando(true);
    setFallo(null);
    try {
      const res = await fetch(`/api/formularios?status=${estado}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se han podido cargar las solicitudes");
      setDatos(json.data || json);
    } catch (e) {
      setFallo(e.message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(tab); }, [tab, cargar]);

  // Para las pendientes, preguntamos si esa persona ya tiene ficha, y así
  // ofrecer "usar la que ya existe" en vez de crear una repetida.
  useEffect(() => {
    if (tab !== "pending") return;
    let vivo = true;
    (async () => {
      const encontrados = {};
      for (const s of datos.submissions) {
        try {
          const res = await fetch(`/api/formularios/${s.id}/accept`);
          if (!res.ok) continue;
          const json = await res.json();
          if (json.posibleDuplicado) encontrados[s.id] = json.posibleDuplicado;
        } catch { /* sin conexión: se sigue sin el aviso */ }
      }
      if (vivo) setDuplicados(encontrados);
    })();
    return () => { vivo = false; };
  }, [tab, datos.submissions]);

  async function aceptar(submission, clientId = null, asignarA = null) {
    setTrabajando(submission.id);
    setAviso(null);
    try {
      const res = await fetch(`/api/formularios/${submission.id}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(clientId ? { clientId } : {}),
          ...(asignarA ? { asignarA } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se ha podido aceptar");

      const partes = [json.creado ? "Ficha creada" : "Enlazada con la ficha existente"];
      if (json.acceso?.intentado) {
        partes.push(json.acceso.ok ? json.acceso.mensaje : `Acceso a la web NO creado: ${json.acceso.mensaje}`);
      } else if (json.acceso?.motivo === "sin_email") {
        partes.push(json.acceso.mensaje);
      }
      setAviso({
        tipo: json.acceso?.intentado && !json.acceso.ok ? "warn" : "ok",
        texto: partes.join(". "),
        clientId: json.client?.id,
      });
      await cargar(tab);
    } catch (e) {
      setAviso({ tipo: "err", texto: e.message });
    } finally {
      setTrabajando(null);
    }
  }

  async function cambiarEstado(submission, status, rejectionReason = null) {
    setTrabajando(submission.id);
    setAviso(null);
    try {
      const res = await fetch(`/api/formularios/${submission.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, rejectionReason }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se ha podido cambiar");
      setDescartando(null);
      setMotivoDescarte("");
      await cargar(tab);
    } catch (e) {
      setAviso({ tipo: "err", texto: e.message });
    } finally {
      setTrabajando(null);
    }
  }

  // Eliminar DEL TODO una solicitud descartada (borrado físico, irreversible).
  async function eliminar(submission) {
    if (!window.confirm("¿Eliminar del todo esta solicitud descartada? Esta acción no se puede deshacer.")) return;
    setTrabajando(submission.id);
    setAviso(null);
    try {
      const res = await fetch(`/api/formularios/${submission.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "No se ha podido eliminar");
      await cargar(tab);
    } catch (e) {
      setAviso({ tipo: "err", texto: e.message });
    } finally {
      setTrabajando(null);
    }
  }

  const vacio = !cargando && datos.submissions.length === 0;

  return (
    <div className="min-h-full bg-gray-50">
      {/* Cabecera */}
      <div className="px-4 lg:px-8 pt-5 lg:pt-7 pb-3">
        <div className="text-[10px] uppercase tracking-[0.18em] text-gray-400 mb-1">
          Solicitudes desde la web
        </div>
        <h1 className="text-gray-900 text-xl font-semibold">
          Leads Comerciales
          <HelpTooltip title="Aceptar o descartar" className="ml-2">
            Aceptar no solo crea la ficha: también le manda un correo a la persona
            diciéndole que ya puede pedir cita, y{" "}
            <strong className="text-white">no tiene vuelta atrás</strong> — una solicitud
            aceptada ya no puede volver a Pendientes. Descartar no le avisa de nada y sí
            se puede rectificar.
          </HelpTooltip>
        </h1>
        {datos.forms?.length > 0 && (
          <p className="text-sm text-gray-500 mt-1">
            {datos.forms.filter((f) => f.active).map((f) => f.title).join(" · ")}
          </p>
        )}
      </div>

      {/* Pestañas */}
      <div className="px-4 lg:px-8">
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1 shadow-sm overflow-x-auto">
          {PESTANAS.map((p) => (
            <button
              key={p.key}
              onClick={() => setTab(p.key)}
              className={`flex items-center gap-2 text-sm font-medium px-3.5 py-1.5 rounded-md whitespace-nowrap transition-colors ${
                tab === p.key
                  ? "bg-[var(--color-primary)] text-white"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              {p.label}
              {datos.recuento?.[p.key] > 0 && (
                <span
                  className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${
                    tab === p.key
                      ? "bg-white/25 text-white"
                      : p.key === "pending"
                        ? "bg-red-500 text-white"
                        : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {datos.recuento[p.key]}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Aviso de resultado */}
      {aviso && (
        <div className="px-4 lg:px-8 mt-3">
          <div
            className={`rounded-xl px-4 py-3 text-sm flex items-start gap-3 border ${
              aviso.tipo === "ok"
                ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                : aviso.tipo === "warn"
                  ? "bg-amber-50 border-amber-200 text-amber-800"
                  : "bg-red-50 border-red-200 text-red-700"
            }`}
          >
            <span className="flex-1">{aviso.texto}</span>
            {aviso.clientId && (
              <a href={`/clientes/${aviso.clientId}`} className="font-semibold underline whitespace-nowrap">
                Abrir ficha
              </a>
            )}
            <button onClick={() => setAviso(null)} className="text-current/60 hover:text-current" aria-label="Cerrar">✕</button>
          </div>
        </div>
      )}

      {/* Lista */}
      <div className="px-4 lg:px-8 py-4 space-y-3">
        {cargando && (
          <div className="flex items-center gap-3 text-sm text-gray-500 py-10 justify-center">
            <div className="w-4 h-4 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
            Cargando solicitudes…
          </div>
        )}

        {fallo && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{fallo}</div>
        )}

        {vacio && (
          <div className="border border-dashed border-gray-200 rounded-2xl p-12 text-center bg-white">
            <p className="text-gray-500 text-sm">
              {tab === "pending"
                ? "No hay solicitudes pendientes. Cuando alguien rellene el formulario de la web, aparecerá aquí."
                : tab === "accepted"
                  ? "Todavía no has aceptado ninguna solicitud."
                  : "No has descartado ninguna solicitud."}
            </p>
          </div>
        )}

        {datos.submissions.map((s) => (
          <Tarjeta
            key={s.id}
            submission={s}
            duplicado={duplicados[s.id]}
            ocupada={trabajando === s.id}
            descartando={descartando === s.id}
            motivoDescarte={motivoDescarte}
            onMotivo={setMotivoDescarte}
            equipo={equipo}
            onAceptar={(clientId, asignarA) => aceptar(s, clientId, asignarA)}
            onPedirDescarte={() => { setDescartando(s.id); setMotivoDescarte(""); }}
            onCancelarDescarte={() => setDescartando(null)}
            onDescartar={() => cambiarEstado(s, "rejected", motivoDescarte || null)}
            onRecuperar={() => cambiarEstado(s, "pending")}
            onEliminar={() => eliminar(s)}
          />
        ))}
      </div>
    </div>
  );
}

function Tarjeta({
  submission, duplicado, ocupada, descartando, motivoDescarte, equipo,
  onMotivo, onAceptar, onPedirDescarte, onCancelarDescarte, onDescartar, onRecuperar, onEliminar,
}) {
  const s = submission;
  const respuestas = useMemo(
    () => (Array.isArray(s.answers) ? s.answers.filter((a) => a.type !== "consent" && String(a.value || "").trim()) : []),
    [s.answers]
  );

  // Un aviso, no un bloqueo: la decisión clínica es de la nutricionista.
  const edad = respuestas.find((a) => /edad|años/i.test(a.label))?.value;
  const esMenor = edad && Number(edad) > 0 && Number(edad) < 18;

  // Plegada por defecto: con 6 respuestas por solicitud, desplegarlas todas
  // obliga a hacer scroll para ver la siguiente. Plegada caben varias de un
  // vistazo y se decide a quién abrir.
  const [abierta, setAbierta] = useState(false);
  const alternar = () => setAbierta((v) => !v);

  // A quién se le asigna. Vacío = sin asignar, que es lo que pasaba hasta hoy
  // y sigue siendo válido: entonces ve la agenda del centro entera.
  const [asignarA, setAsignarA] = useState("");
  const hayEquipo = (equipo ?? []).length > 0;

  return (
    <article className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
      {/* Cabecera: toda ella es el mando para plegar y desplegar. Los enlaces
          de contacto van FUERA, porque un <a> dentro de un <button> no es
          HTML válido y el teléfono dejaría de abrirse desde el móvil. */}
      <button
        type="button"
        onClick={alternar}
        aria-expanded={abierta}
        className="w-full text-left px-4 lg:px-5 pt-4 pb-3 flex items-start justify-between gap-3 hover:bg-gray-50/70 transition-colors cursor-pointer"
      >
        <div className="min-w-0 flex-1">
          <h2 className="text-gray-900 font-semibold text-base leading-tight">{s.name || "Sin nombre"}</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {fmtFecha(s.createdAt)} <span className="text-gray-400">· {haceCuanto(s.createdAt)}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end shrink-0">
          {esMenor && (
            <span className="text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 px-2 py-1 rounded-full">
              Menor de edad
            </span>
          )}
          {s.status === "accepted" && (
            <span className="text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-1 rounded-full">
              Aceptada
            </span>
          )}
          {s.status === "rejected" && (
            <span className="text-[11px] font-semibold bg-gray-100 text-gray-600 border border-gray-200 px-2 py-1 rounded-full">
              Descartada
            </span>
          )}
          <svg
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
            className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${abierta ? "rotate-180" : ""}`}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </div>
      </button>

      {/* Contacto: pinchable, que Laura lo abre desde el móvil */}
      <div className="px-4 lg:px-5 pb-3 flex items-center gap-4 flex-wrap text-sm">
        {s.phone && (
          <a href={`tel:${s.phone}`} className="text-[var(--color-primary)] font-medium hover:underline">
            {s.phone}
          </a>
        )}
        {s.email ? (
          <a href={`mailto:${s.email}`} className="text-[var(--color-primary)] font-medium hover:underline break-all">
            {s.email}
          </a>
        ) : (
          <span className="text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-0.5 text-xs">
            Sin email — no se le podrá agendar cita
          </span>
        )}
      </div>

      {/* Lo que escribió: solo cuando se despliega */}
      {abierta ? (
        <div className="px-4 lg:px-5 pb-4 space-y-2.5">
          {respuestas.map((a) => (
            <div key={a.key} className="bg-gray-50 border border-gray-100 rounded-xl px-3.5 py-2.5">
              <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">{a.label}</div>
              <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{a.value}</div>
            </div>
          ))}
        </div>
      ) : (
        respuestas.length > 0 && (
          <div className="px-4 lg:px-5 pb-4">
            <button
              type="button"
              onClick={alternar}
              className="text-xs text-gray-500 hover:text-[var(--color-primary)] transition-colors underline underline-offset-2 decoration-gray-300"
            >
              Ver {respuestas.length === 1 ? "la respuesta" : `las ${respuestas.length} respuestas`}
            </button>
          </div>
        )
      )}

      {s.rejectionReason && (
        <div className="px-4 lg:px-5 pb-4">
          <div className="text-xs text-gray-500">
            <span className="font-semibold">Motivo del descarte (interno):</span> {s.rejectionReason}
          </div>
        </div>
      )}

      {duplicado && s.status === "pending" && (
        <div className="mx-4 lg:mx-5 mb-4 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-3 text-sm text-amber-900">
          <p className="font-semibold mb-1">Puede que ya tengas su ficha</p>
          <p className="mb-2">
            Hay un cliente con el mismo teléfono o email: <strong>{duplicado.name}</strong>.
          </p>
          <button
            onClick={() => onAceptar(duplicado.id, asignarA || null)}
            disabled={ocupada}
            className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            Usar la ficha que ya existe
          </button>
        </div>
      )}

      {/* Acciones */}
      {s.status === "pending" && (
        <div className="border-t border-gray-100 px-4 lg:px-5 py-3 bg-gray-50/60">
          {!descartando ? (
            <div className="flex items-center gap-2 flex-wrap">
              {hayEquipo && (
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <span className="font-medium">Con</span>
                  <select
                    value={asignarA}
                    onChange={(e) => setAsignarA(e.target.value)}
                    disabled={ocupada}
                    className="border border-gray-200 rounded-lg px-2.5 py-2 text-sm bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-50"
                  >
                    <option value="">Sin asignar</option>
                    {equipo.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.displayName || m.email}
                        {m.tieneHorario === false ? " (sin horario)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {/*
                Sin horario propio, su paciente no ve NI UN HUECO (07/08/2026).
                Se avisa aquí, en el momento de asignar, porque después el
                síntoma es una paciente diciendo que la agenda le sale vacía y
                nadie relaciona una cosa con la otra.
              */}
              {asignarA && equipo.find((m) => m.id === asignarA)?.tieneHorario === false && (
                <span className="w-full text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Esta persona no tiene su horario puesto, así que quien se le asigne no verá
                  ningún hueco al pedir cita. Rellénalo en Equipo → su ficha → horario.
                </span>
              )}
              <button
                onClick={() => onAceptar(null, asignarA || null)}
                disabled={ocupada}
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {ocupada && <div className="w-3.5 h-3.5 border-2 border-white/50 border-t-transparent rounded-full animate-spin" />}
                Aceptar y crear ficha
              </button>
              <button
                onClick={onPedirDescarte}
                disabled={ocupada}
                className="bg-white border border-red-200 text-red-600 hover:bg-red-50 text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                Descartar
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block text-xs text-gray-600">
                ¿Por qué la descartas? (opcional, solo lo ves tú)
              </label>
              <input
                type="text"
                value={motivoDescarte}
                onChange={(e) => onMotivo(e.target.value)}
                placeholder="Por ejemplo: no es mi ámbito, la derivo"
                className="w-full text-sm rounded-lg border border-gray-200 px-3 py-2 focus:outline-none focus:border-[var(--color-primary)]"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={onDescartar}
                  disabled={ocupada}
                  className="bg-red-500 hover:bg-red-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
                >
                  Confirmar descarte
                </button>
                <button
                  onClick={onCancelarDescarte}
                  className="text-sm text-gray-600 hover:text-gray-900 px-3 py-2"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {s.status === "rejected" && (
        <div className="border-t border-gray-100 px-4 lg:px-5 py-3 bg-gray-50/60 flex items-center gap-2 flex-wrap">
          <button
            onClick={onRecuperar}
            disabled={ocupada}
            className="bg-white border border-gray-200 hover:border-gray-300 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            Devolver a pendientes
          </button>
          <button
            onClick={onEliminar}
            disabled={ocupada}
            className="bg-white border border-rose-200 hover:border-rose-300 text-rose-600 text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            Eliminar del todo
          </button>
        </div>
      )}

      {s.status === "accepted" && s.clientId && (
        <div className="border-t border-gray-100 px-4 lg:px-5 py-3 bg-gray-50/60">
          <a
            href={`/clientes/${s.clientId}`}
            className="inline-block bg-white border border-gray-200 hover:border-gray-300 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Abrir ficha del cliente
          </a>
        </div>
      )}
    </article>
  );
}
