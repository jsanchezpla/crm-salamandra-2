"use client";

/**
 * CorreoModule — escribir un mensaje y mandárselo a mucha gente a la vez.
 *
 * Lo pidió Rodrigo el 24/08/2026: «poder unir la cantidad de correos que quiera
 * y elegir con qué correo quiero mandar el mensaje».
 *
 * ── LA DECISIÓN DE PANTALLA ────────────────────────────────────────────────
 * Los destinatarios se eligen de UNA fuente cada vez —contratantes, contactos,
 * propuestas, captación— pero se acumulan en una sola lista de destino. Es lo
 * que significa «unir»: se entra cuatro veces y se sale con una lista. Por eso
 * la lista elegida vive fuera del selector y no se vacía al cambiar de fuente;
 * si se vaciara, juntar dos orígenes sería imposible.
 *
 * Cada destinatario recuerda de qué fuente salió, y se enseña. Mandar a un
 * ayuntamiento con el que ya trabajas y a uno frío el mismo texto es un error
 * caro, y la única forma de evitarlo es que se vea antes de darle a enviar.
 *
 * ── EL BOTÓN NO MIENTE ─────────────────────────────────────────────────────
 * Si no hay clave de Resend o no hay remitente, se dice ARRIBA y el botón queda
 * desactivado, en vez de dejar escribir un mensaje largo para fallar al final.
 * Y al terminar se enseña el desglose real: enviados, simulados y fallidos con
 * su motivo. «Simulado» es dry-run y NO es enviado: esa confusión ya costó un
 * disgusto en Citas (ver lib/email/resendClient.js).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Select from "@/components/ui/Select.jsx";

// «Captación» salió el 24/08/2026: sus contactos son ahora fichas de
// Contratante, así que la fuente enseñaría una copia vieja de lo mismo.
const FUENTES = [
  { key: "contratantes", label: "Contratantes", pista: "La organización: ayuntamiento, sala, festival o medio." },
  { key: "contactos", label: "Personas", pista: "La persona concreta dentro de una ficha, con su cargo." },
  { key: "propuestas", label: "Propuestas", pista: "Oportunidades abiertas del embudo." },
];

const COLOR_FUENTE = {
  contratantes: "bg-emerald-100 text-emerald-700",
  contactos: "bg-sky-100 text-sky-700",
  propuestas: "bg-violet-100 text-violet-700",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function CorreoModule() {
  const [remitentes, setRemitentes] = useState([]);
  const [remitenteId, setRemitenteId] = useState("");
  const [listo, setListo] = useState(true);
  const [motivo, setMotivo] = useState(null);
  const [puedeConfigurar, setPuedeConfigurar] = useState(false);

  const [fuente, setFuente] = useState("contratantes");
  const [busqueda, setBusqueda] = useState("");
  const [candidatos, setCandidatos] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [errorLista, setErrorLista] = useState(null);

  // La lista que se va a usar de verdad. Clave = email, para que juntar dos
  // fuentes que traen la misma dirección no la duplique.
  const [elegidos, setElegidos] = useState(() => new Map());
  const [pegados, setPegados] = useState("");

  const [asunto, setAsunto] = useState("");
  const [cuerpo, setCuerpo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [errorEnvio, setErrorEnvio] = useState(null);

  // ── Remitentes ────────────────────────────────────────────────────────────
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const res = await fetch("/api/correo/remitentes", { cache: "no-store" });
        const json = await res.json();
        if (!vivo) return;
        const lista = json?.data?.remitentes ?? [];
        setRemitentes(lista);
        setRemitenteId(lista.find((r) => r.porDefecto)?.id ?? lista[0]?.id ?? "");
        setListo(!!json?.data?.listo);
        setMotivo(json?.data?.motivo ?? null);
        setPuedeConfigurar(!!json?.data?.puedeConfigurar);
      } catch {
        if (vivo) { setListo(false); setMotivo("No se ha podido leer la configuración de correo."); }
      }
    })();
    return () => { vivo = false; };
  }, []);

  // ── Candidatos de la fuente elegida ───────────────────────────────────────
  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorLista(null);
    try {
      const url = `/api/correo/destinatarios?fuente=${fuente}&q=${encodeURIComponent(busqueda)}`;
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "No se ha podido cargar la lista");
      setCandidatos(json?.data?.destinatarios ?? []);
    } catch (e) {
      setCandidatos([]);
      // Un 403 aquí casi siempre es «no tienes ese módulo», no un error de red.
      setErrorLista(e.message === "Forbidden" ? "Este cliente no tiene ese módulo." : e.message);
    } finally {
      setCargando(false);
    }
  }, [fuente, busqueda]);

  useEffect(() => {
    const t = setTimeout(cargar, busqueda ? 300 : 0);
    return () => clearTimeout(t);
  }, [cargar, busqueda]);

  // ── Selección ─────────────────────────────────────────────────────────────
  const alternar = (d) => {
    setElegidos((prev) => {
      const m = new Map(prev);
      if (m.has(d.email)) m.delete(d.email);
      else m.set(d.email, { ...d, fuente });
      return m;
    });
  };

  const anadirTodos = () => {
    setElegidos((prev) => {
      const m = new Map(prev);
      for (const d of candidatos) if (!m.has(d.email)) m.set(d.email, { ...d, fuente });
      return m;
    });
  };

  const anadirPegados = () => {
    // Se acepta cualquier separador razonable: la gente pega desde Excel, desde
    // un correo antiguo o de una lista con comas. Rechazar por el separador
    // sería obligarles a limpiar a mano lo que el código puede limpiar solo.
    const trozos = pegados.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    const buenos = trozos.filter((e) => EMAIL_RE.test(e));
    setElegidos((prev) => {
      const m = new Map(prev);
      for (const email of buenos) if (!m.has(email)) m.set(email, { email, nombre: null, detalle: null, fuente: "pegado" });
      return m;
    });
    const malos = trozos.filter((e) => !EMAIL_RE.test(e));
    setPegados(malos.join("\n"));
  };

  const lista = useMemo(() => [...elegidos.values()], [elegidos]);
  const puedeEnviar = listo && lista.length > 0 && asunto.trim() && cuerpo.trim() && !enviando;

  // ── Envío ─────────────────────────────────────────────────────────────────
  const enviar = async () => {
    setEnviando(true);
    setErrorEnvio(null);
    setResultado(null);
    try {
      const res = await fetch("/api/correo/envios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          remitenteId,
          asunto: asunto.trim(),
          cuerpo: cuerpo.trim(),
          destinatarios: lista.map((d) => ({ email: d.email, nombre: d.nombre })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "No se ha podido enviar");
      setResultado(json.data);
      // Solo se limpia si salió algo de verdad. Si todo falló, el texto se
      // queda: reescribirlo entero sería el segundo castigo por el mismo fallo.
      if (json.data.enviados?.length) { setElegidos(new Map()); setAsunto(""); setCuerpo(""); }
    } catch (e) {
      setErrorEnvio(e.message);
    } finally {
      setEnviando(false);
    }
  };

  const fuenteActual = FUENTES.find((f) => f.key === fuente);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Correo</h1>
        <p className="text-gray-500 text-sm mt-0.5">
          Un mensaje, la gente que elijas, y desde la dirección que elijas.
        </p>
      </header>

      {!listo && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong className="font-semibold">Todavía no se puede enviar.</strong> {motivo}{" "}
          {puedeConfigurar ? (
            <>Se arregla en <a className="underline" href="/configuracion">Configuración → Conexiones</a>.</>
          ) : (
            <>Lo tiene que resolver quien administre el CRM.</>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px] items-start">
        {/* ── Izquierda: el mensaje ───────────────────────────────────────── */}
        <section className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
            <div>
              <label htmlFor="remitente" className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
                Enviar desde
              </label>
              {remitentes.length > 1 ? (
                <Select
                  id="remitente"
                  value={remitenteId}
                  onChange={setRemitenteId}
                  options={remitentes.map((r) => ({
                    value: r.id,
                    label: r.nombre ? `${r.nombre} <${r.email}>` : r.email,
                  }))}
                />
              ) : (
                <p className="text-sm text-gray-700 py-2">
                  {remitentes[0] ? (remitentes[0].nombre ? `${remitentes[0].nombre} <${remitentes[0].email}>` : remitentes[0].email) : "—"}
                  <span className="block text-xs text-gray-400 mt-0.5">
                    {puedeConfigurar
                      ? "Para elegir entre varias direcciones, añádelas en Configuración → Conexiones."
                      : "Es la dirección que tienes asignada."}
                  </span>
                </p>
              )}
            </div>

            <div>
              <label htmlFor="asunto" className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
                Asunto
              </label>
              <input
                id="asunto"
                type="text"
                value={asunto}
                maxLength={200}
                onChange={(e) => setAsunto(e.target.value)}
                placeholder="Propuesta de actuación — Laura Úbeda"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-offset-0"
                style={{ "--tw-ring-color": "var(--color-primary)" }}
              />
            </div>

            <div>
              <label htmlFor="cuerpo" className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
                Mensaje
              </label>
              <textarea
                id="cuerpo"
                value={cuerpo}
                rows={12}
                maxLength={20000}
                onChange={(e) => setCuerpo(e.target.value)}
                placeholder="Escribe aquí. Se manda tal cual, en texto."
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal focus:outline-none focus:ring-2"
                style={{ "--tw-ring-color": "var(--color-primary)" }}
              />
              <p className="text-xs text-gray-400 mt-1">
                Se manda un correo por persona, nunca todos en el mismo «Para»: nadie ve la lista de los demás.
              </p>
            </div>

            {errorEnvio && (
              <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{errorEnvio}</p>
            )}

            <button
              type="button"
              onClick={enviar}
              disabled={!puedeEnviar}
              className="w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: "var(--color-primary)" }}
            >
              {enviando
                ? "Enviando…"
                : lista.length
                  ? `Enviar a ${lista.length} ${lista.length === 1 ? "persona" : "personas"}`
                  : "Elige a quién escribir"}
            </button>
          </div>

          {resultado && <Resultado r={resultado} />}
        </section>

        {/* ── Derecha: a quién ────────────────────────────────────────────── */}
        <aside className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Destinatarios</h2>
            {lista.length > 0 && (
              <button type="button" onClick={() => setElegidos(new Map())} className="text-xs text-gray-400 hover:text-gray-700 underline">
                vaciar
              </button>
            )}
          </div>

          {lista.length > 0 && (
            <div className="max-h-44 overflow-y-auto rounded-lg bg-gray-50 p-2 space-y-1">
              {lista.map((d) => (
                <div key={d.email} className="flex items-center gap-2 text-xs">
                  <span className={`px-1.5 py-0.5 rounded ${COLOR_FUENTE[d.fuente] ?? "bg-gray-200 text-gray-600"}`}>
                    {FUENTES.find((f) => f.key === d.fuente)?.label ?? "Pegado"}
                  </span>
                  <span className="truncate flex-1 text-gray-700">{d.nombre || d.email}</span>
                  <button
                    type="button"
                    onClick={() => alternar(d)}
                    aria-label={`Quitar ${d.email}`}
                    className="text-gray-400 hover:text-red-600 px-1"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-1">
            {FUENTES.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFuente(f.key)}
                className={`px-2 py-1 rounded text-xs font-medium ${
                  fuente === f.key ? "text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
                style={fuente === f.key ? { backgroundColor: "var(--color-primary)" } : undefined}
              >
                {f.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400">{fuenteActual?.pista}</p>

          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o correo…"
            aria-label="Buscar destinatarios"
            className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
          />

          <div className="max-h-64 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-100">
            {cargando && <p className="p-3 text-xs text-gray-400">Cargando…</p>}
            {!cargando && errorLista && <p className="p-3 text-xs text-red-600">{errorLista}</p>}
            {!cargando && !errorLista && candidatos.length === 0 && (
              <p className="p-3 text-xs text-gray-400">Nadie con correo en esta lista.</p>
            )}
            {!cargando &&
              candidatos.map((d) => (
                <label key={d.email} className="flex items-start gap-2 p-2 hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={elegidos.has(d.email)}
                    onChange={() => alternar(d)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium text-gray-800 truncate">{d.nombre || d.email}</span>
                    <span className="block text-[11px] text-gray-400 truncate">
                      {d.nombre ? d.email : ""} {d.detalle ? `· ${d.detalle}` : ""}
                    </span>
                  </span>
                </label>
              ))}
          </div>

          {candidatos.length > 0 && (
            <button type="button" onClick={anadirTodos} className="text-xs underline text-gray-500 hover:text-gray-800">
              Añadir los {candidatos.length} de esta lista
            </button>
          )}

          <div className="pt-2 border-t border-gray-100">
            <label htmlFor="pegados" className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
              O pega direcciones
            </label>
            <textarea
              id="pegados"
              rows={2}
              value={pegados}
              onChange={(e) => setPegados(e.target.value)}
              placeholder="una@sitio.com, otra@sitio.com"
              className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs"
            />
            <button
              type="button"
              onClick={anadirPegados}
              disabled={!pegados.trim()}
              className="mt-1 text-xs underline text-gray-500 hover:text-gray-800 disabled:opacity-40"
            >
              Añadir a la lista
            </button>
            <p className="text-[11px] text-gray-400 mt-1">
              Valen comas, espacios o saltos de línea. Lo que no sea un correo se queda ahí para que lo corrijas.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

/** El desglose de un envío. Simulado NUNCA se cuenta como enviado. */
function Resultado({ r }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      <h2 className="text-sm font-semibold text-gray-900">Resultado del envío</h2>

      <div className="flex flex-wrap gap-4 text-sm">
        <span className="text-emerald-700 font-semibold">{r.enviados?.length ?? 0} enviados</span>
        {r.simulados?.length > 0 && (
          <span className="text-amber-700 font-semibold">{r.simulados.length} simulados</span>
        )}
        {r.fallidos?.length > 0 && <span className="text-red-700 font-semibold">{r.fallidos.length} fallidos</span>}
      </div>

      {r.enviados?.length > 0 && (
        <p className="text-xs text-gray-500">
          <strong className="text-gray-700">{r.apuntadosEnFicha ?? 0}</strong> han quedado apuntados en la ficha de
          su contratante, en la pestaña «Interacciones».
          {r.enviados.length - (r.apuntadosEnFicha ?? 0) > 0 && (
            <> Los otros {r.enviados.length - (r.apuntadosEnFicha ?? 0)} eran direcciones sueltas, sin ficha detrás.</>
          )}
        </p>
      )}

      {r.simulados?.length > 0 && (
        <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
          <strong>Simulado no es enviado.</strong> La clave de Resend está en modo prueba, así que no ha salido
          nada al exterior. En cuanto se ponga la clave real, estos correos saldrán de verdad.
        </p>
      )}

      {r.fallidos?.length > 0 && (
        <ul className="text-xs text-red-700 space-y-0.5">
          {r.fallidos.map((f) => (
            <li key={f.email}>
              <span className="font-medium">{f.nombre || f.email}</span> — {f.motivo}
            </li>
          ))}
        </ul>
      )}

      {r.invalidos?.length > 0 && (
        <p className="text-xs text-gray-500">
          No se intentaron por estar mal escritas: {r.invalidos.join(", ")}
        </p>
      )}
    </div>
  );
}
