"use client";

/**
 * CorreoModule — escribir un mensaje y mandárselo a mucha gente a la vez.
 *
 * Nació el 24/08/2026 para Laura Úbeda («poder unir la cantidad de correos que
 * quiera y elegir con qué correo quiero mandar el mensaje») y el 26/08/2026 se
 * generalizó (Rodrigo): textos neutros por vocabulario, filtros por profesional
 * y tipo de terapia, tutores y pacientes en la lista, listas guardadas,
 * plantillas ilimitadas, adjuntos (imágenes y PDF) y pies de firma automáticos.
 *
 * ── LA DECISIÓN DE PANTALLA ────────────────────────────────────────────────
 * Los destinatarios se eligen de UNA fuente cada vez pero se acumulan en una
 * sola lista de destino. Es lo que significa «unir»: se entra varias veces y se
 * sale con una lista. Por eso la lista elegida vive fuera del selector y no se
 * vacía al cambiar de fuente; si se vaciara, juntar dos orígenes sería
 * imposible. Cada destinatario recuerda de qué fuente salió, y se enseña.
 *
 * ── EL IDIOMA LO PONE EL CENTRO ────────────────────────────────────────────
 * Nada de «Contratantes» en una clínica: el rótulo de la fuente de fichas
 * llega del servidor (`vocab`, lib/clients/vocabulario.js) y los extras de
 * cada oficio (filtros de terapia, tutores) solo se pintan donde su módulo
 * existe. El componente no sabe de slugs: sabe de módulos.
 *
 * ── EL BOTÓN NO MIENTE ─────────────────────────────────────────────────────
 * Si no hay clave de Resend o no hay remitente, se dice ARRIBA y el botón queda
 * desactivado. Al terminar se enseña el desglose real: enviados, simulados y
 * fallidos con su motivo. «Simulado» es dry-run y NO es enviado.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Select from "@/components/ui/Select.jsx";
import { VOCABULARIO_CLIENTE } from "@/lib/clients/vocabulario.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Los mismos topes que valida el servidor (lib/correo/composicion.js). Aquí
// solo evitan el viaje: la palabra final la tiene el endpoint.
const MAX_ADJUNTOS = 10;
const MAX_ADJUNTO_BYTES = 10 * 1024 * 1024;
const MAX_ADJUNTOS_BYTES = 15 * 1024 * 1024;
const EXT_ADJUNTO = /\.(png|jpe?g|gif|webp|pdf)$/i;
const MAX_FIRMA_IMAGEN_BYTES = 1024 * 1024;

const COLOR_FUENTE = {
  contratantes: "bg-emerald-100 text-emerald-700",
  contactos: "bg-sky-100 text-sky-700",
  propuestas: "bg-violet-100 text-violet-700",
  lista: "bg-amber-100 text-amber-700",
};

function pesoLegible(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Un fichero → su base64 pelado (sin el prefijo `data:`). */
function leerBase64(fichero) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result).split(",")[1] ?? "");
    lector.onerror = () => reject(new Error("No se ha podido leer el fichero"));
    lector.readAsDataURL(fichero);
  });
}

export default function CorreoModule({
  vocab = VOCABULARIO_CLIENTE,
  conPacientes = false,
  conBooking = false,
  conLeads = false,
}) {
  const [remitentes, setRemitentes] = useState([]);
  const [remitenteId, setRemitenteId] = useState("");
  const [listo, setListo] = useState(true);
  const [motivo, setMotivo] = useState(null);
  const [puedeConfigurar, setPuedeConfigurar] = useState(false);
  const [modoPrueba, setModoPrueba] = useState(false);

  // Las fuentes hablan el idioma del centro. La clave `contratantes` es el
  // identificador interno de siempre (renombrarla rompería las listas
  // guardadas); lo que se ve es el rótulo.
  const FUENTES = useMemo(() => {
    const fuentes = [
      {
        key: "contratantes",
        label: vocab.plural,
        pista: conPacientes
          ? "La familia: su correo y el de cada tutor, con sus pacientes al lado."
          : conBooking
            ? "La organización: ayuntamiento, sala, festival o medio."
            : `Las fichas de ${vocab.plural.toLowerCase()} que tienen correo.`,
      },
      { key: "contactos", label: "Personas", pista: "La persona concreta dentro de una ficha, con su cargo." },
    ];
    if (conLeads) {
      fuentes.push({
        key: "propuestas",
        label: conBooking ? "Propuestas" : "Oportunidades",
        pista: "Oportunidades abiertas del embudo.",
      });
    }
    return fuentes;
  }, [vocab, conPacientes, conBooking, conLeads]);

  const rotuloFuente = useCallback(
    (key) => FUENTES.find((f) => f.key === key)?.label ?? (key === "lista" ? "Lista" : "Pegado"),
    [FUENTES]
  );

  const [fuente, setFuente] = useState("contratantes");
  const [busqueda, setBusqueda] = useState("");
  const [candidatos, setCandidatos] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [errorLista, setErrorLista] = useState(null);

  // Filtros por profesional y tipo de terapia (solo centros con `pacientes`).
  const [opcionesFiltros, setOpcionesFiltros] = useState({ profesionales: [], terapias: [] });
  const [filtroProfesional, setFiltroProfesional] = useState("");
  const [filtroTerapia, setFiltroTerapia] = useState("");

  // La lista que se va a usar de verdad. Clave = email, para que juntar dos
  // fuentes que traen la misma dirección no la duplique.
  const [elegidos, setElegidos] = useState(() => new Map());
  const [pegados, setPegados] = useState("");

  // Listas guardadas del centro.
  const [listas, setListas] = useState([]);
  const [nombreListaNueva, setNombreListaNueva] = useState("");
  const [guardandoLista, setGuardandoLista] = useState(false);

  // Plantillas del centro.
  const [plantillas, setPlantillas] = useState([]);
  const [plantillaSel, setPlantillaSel] = useState("");
  const [nombrePlantillaNueva, setNombrePlantillaNueva] = useState("");
  const [guardandoPlantilla, setGuardandoPlantilla] = useState(false);
  const [avisoPlantilla, setAvisoPlantilla] = useState(null);

  // Adjuntos del envío.
  const [adjuntos, setAdjuntos] = useState([]);
  const [errorAdjuntos, setErrorAdjuntos] = useState(null);

  // Pie de firma de quien escribe.
  const [firma, setFirma] = useState(null);
  const [incluirFirma, setIncluirFirma] = useState(true);
  const [gestionFirmas, setGestionFirmas] = useState({ puedeGestionarEquipo: false, usuarios: [] });
  const [modalFirma, setModalFirma] = useState(false);

  // «Escribirle» desde una ficha llega aquí con `?destinatario=`. Se mete en la
  // lista y ya está: quien viene de una ficha quiere escribirle a esa persona,
  // no volver a buscarla en un desplegable de cientos.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("destinatario");
    if (!q || !EMAIL_RE.test(q)) return;
    const email = q.trim().toLowerCase();
    setElegidos((prev) => {
      if (prev.has(email)) return prev;
      const m = new Map(prev);
      m.set(email, { email, nombre: null, detalle: null, fuente: "contratantes" });
      return m;
    });
  }, []);

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
        setModoPrueba(!!json?.data?.modoPrueba);
      } catch {
        if (vivo) { setListo(false); setMotivo("No se ha podido leer la configuración de correo."); }
      }
    })();
    return () => { vivo = false; };
  }, []);

  // ── Filtros, listas, plantillas y firma: una carga al entrar ──────────────
  useEffect(() => {
    let vivo = true;
    if (conPacientes) {
      fetch("/api/correo/filtros", { cache: "no-store" })
        .then((r) => r.json())
        .then((json) => {
          if (!vivo) return;
          setOpcionesFiltros({
            profesionales: json?.data?.profesionales ?? [],
            terapias: json?.data?.terapias ?? [],
          });
        })
        .catch(() => {});
    }
    fetch("/api/correo/listas", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => { if (vivo) setListas(json?.data?.listas ?? []); })
      .catch(() => {});
    fetch("/api/correo/plantillas", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => { if (vivo) setPlantillas(json?.data?.plantillas ?? []); })
      .catch(() => {});
    fetch("/api/correo/firmas", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (!vivo) return;
        setFirma(json?.data?.firma ?? null);
        setGestionFirmas({
          puedeGestionarEquipo: !!json?.data?.puedeGestionarEquipo,
          usuarios: json?.data?.usuarios ?? [],
        });
      })
      .catch(() => {});
    return () => { vivo = false; };
  }, [conPacientes]);

  // ── Candidatos de la fuente elegida ───────────────────────────────────────
  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorLista(null);
    try {
      const params = new URLSearchParams({ fuente, q: busqueda });
      if (fuente === "contratantes" && conPacientes) {
        if (filtroProfesional) params.set("profesional", filtroProfesional);
        if (filtroTerapia) params.set("terapia", filtroTerapia);
      }
      const res = await fetch(`/api/correo/destinatarios?${params}`, { cache: "no-store" });
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
  }, [fuente, busqueda, conPacientes, filtroProfesional, filtroTerapia]);

  useEffect(() => {
    const t = setTimeout(cargar, busqueda ? 300 : 0);
    return () => clearTimeout(t);
  }, [cargar, busqueda]);

  // ── Selección ─────────────────────────────────────────────────────────────
  const alternar = (d) => {
    setElegidos((prev) => {
      const m = new Map(prev);
      if (m.has(d.email)) m.delete(d.email);
      else m.set(d.email, { ...d, fuente: d.fuente ?? fuente });
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
    // un correo antiguo o de una lista con comas.
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

  // ── Listas guardadas ──────────────────────────────────────────────────────
  const cargarLista = (l) => {
    setElegidos((prev) => {
      const m = new Map(prev);
      for (const d of l.destinatarios ?? []) {
        const email = String(d.email ?? "").toLowerCase();
        if (email && !m.has(email)) m.set(email, { ...d, email, fuente: d.fuente || "lista" });
      }
      return m;
    });
  };

  const guardarLista = async () => {
    const nombre = nombreListaNueva.trim();
    if (!nombre || !elegidos.size) return;
    setGuardandoLista(true);
    try {
      const res = await fetch("/api/correo/listas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, destinatarios: [...elegidos.values()] }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "No se ha podido guardar la lista");
      setListas((prev) => [...prev, { ...json.data.lista }].sort((a, b) => a.nombre.localeCompare(b.nombre)));
      setNombreListaNueva("");
    } catch (e) {
      setErrorLista(e.message);
    } finally {
      setGuardandoLista(false);
    }
  };

  const borrarLista = async (l) => {
    if (!window.confirm(`¿Borrar la lista «${l.nombre}»? Los correos de la gente no se tocan; solo se borra la lista.`)) return;
    try {
      const res = await fetch(`/api/correo/listas/${l.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("No se ha podido borrar");
      setListas((prev) => prev.filter((x) => x.id !== l.id));
    } catch (e) {
      setErrorLista(e.message);
    }
  };

  // ── Plantillas ────────────────────────────────────────────────────────────
  const aplicarPlantilla = (id) => {
    setPlantillaSel(id);
    const p = plantillas.find((x) => x.id === id);
    if (!p) return;
    if ((asunto.trim() || cuerpo.trim()) && !window.confirm("Vas a sustituir lo que hay escrito por la plantilla. ¿Seguimos?")) {
      return;
    }
    setAsunto(p.asunto ?? "");
    setCuerpo(p.cuerpo ?? "");
  };

  const guardarPlantillaNueva = async () => {
    const nombre = nombrePlantillaNueva.trim();
    if (!nombre) return;
    setAvisoPlantilla(null);
    try {
      const res = await fetch("/api/correo/plantillas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, asunto: asunto.trim(), cuerpo: cuerpo.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "No se ha podido guardar la plantilla");
      setPlantillas((prev) => [...prev, json.data.plantilla].sort((a, b) => a.nombre.localeCompare(b.nombre)));
      setPlantillaSel(json.data.plantilla.id);
      setNombrePlantillaNueva("");
      setGuardandoPlantilla(false);
      setAvisoPlantilla(`Guardada como «${json.data.plantilla.nombre}».`);
    } catch (e) {
      setAvisoPlantilla(e.message);
    }
  };

  const actualizarPlantilla = async () => {
    const p = plantillas.find((x) => x.id === plantillaSel);
    if (!p) return;
    setAvisoPlantilla(null);
    try {
      const res = await fetch(`/api/correo/plantillas/${p.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: p.nombre, asunto: asunto.trim(), cuerpo: cuerpo.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "No se ha podido actualizar");
      setPlantillas((prev) => prev.map((x) => (x.id === p.id ? json.data.plantilla : x)));
      setAvisoPlantilla(`«${p.nombre}» actualizada con lo que hay escrito.`);
    } catch (e) {
      setAvisoPlantilla(e.message);
    }
  };

  const borrarPlantilla = async () => {
    const p = plantillas.find((x) => x.id === plantillaSel);
    if (!p) return;
    if (!window.confirm(`¿Borrar la plantilla «${p.nombre}»?`)) return;
    try {
      const res = await fetch(`/api/correo/plantillas/${p.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("No se ha podido borrar");
      setPlantillas((prev) => prev.filter((x) => x.id !== p.id));
      setPlantillaSel("");
      setAvisoPlantilla(null);
    } catch (e) {
      setAvisoPlantilla(e.message);
    }
  };

  // ── Adjuntos ──────────────────────────────────────────────────────────────
  const anadirAdjuntos = async (ficheros) => {
    setErrorAdjuntos(null);
    const nuevos = [];
    let total = adjuntos.reduce((s, a) => s + a.bytes, 0);
    for (const f of ficheros) {
      if (adjuntos.length + nuevos.length >= MAX_ADJUNTOS) {
        setErrorAdjuntos(`Como mucho ${MAX_ADJUNTOS} adjuntos por envío.`);
        break;
      }
      if (!EXT_ADJUNTO.test(f.name)) {
        setErrorAdjuntos(`«${f.name}»: solo imágenes (png, jpg, gif, webp) o PDF.`);
        continue;
      }
      if (f.size > MAX_ADJUNTO_BYTES) {
        setErrorAdjuntos(`«${f.name}» pesa demasiado (máximo ${pesoLegible(MAX_ADJUNTO_BYTES)} por fichero).`);
        continue;
      }
      if (total + f.size > MAX_ADJUNTOS_BYTES) {
        setErrorAdjuntos(`Los adjuntos juntos no pueden pasar de ${pesoLegible(MAX_ADJUNTOS_BYTES)}.`);
        break;
      }
      try {
        const base64 = await leerBase64(f);
        total += f.size;
        nuevos.push({ nombre: f.name, tipo: f.type, base64, bytes: f.size });
      } catch {
        setErrorAdjuntos(`«${f.name}» no se ha podido leer.`);
      }
    }
    if (nuevos.length) setAdjuntos((prev) => [...prev, ...nuevos]);
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
          adjuntos: adjuntos.map((a) => ({ nombre: a.nombre, base64: a.base64 })),
          conFirma: firma ? incluirFirma : false,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "No se ha podido enviar");
      setResultado(json.data);
      // Solo se limpia si salió algo de verdad. Si todo falló, el texto se
      // queda: reescribirlo entero sería el segundo castigo por el mismo fallo.
      if (json.data.enviados?.length) {
        setElegidos(new Map());
        setAsunto("");
        setCuerpo("");
        setAdjuntos([]);
        setPlantillaSel("");
      }
    } catch (e) {
      setErrorEnvio(e.message);
    } finally {
      setEnviando(false);
    }
  };

  const fuenteActual = FUENTES.find((f) => f.key === fuente);
  const conFiltros = conPacientes && fuente === "contratantes";

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

      {listo && modoPrueba && (
        <div className="mb-6 rounded-lg border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          <strong className="font-semibold">Modo de prueba.</strong> La clave de Resend está puesta en{" "}
          <code className="text-xs">dry-run</code>, así que puedes escribir y darle a enviar sin que salga
          nada al exterior. {puedeConfigurar && "Pon la clave real en Configuración → Conexiones cuando quieras enviar de verdad."}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px] items-start">
        {/* ── Izquierda: el mensaje ───────────────────────────────────────── */}
        <section className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
            {/* Plantillas: cargar una, o guardar lo escrito como una nueva. */}
            <div>
              <label htmlFor="plantilla" className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
                Plantilla
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-[220px] flex-1">
                  <Select
                    id="plantilla"
                    value={plantillaSel}
                    onChange={aplicarPlantilla}
                    options={[
                      { value: "", label: plantillas.length ? "— Sin plantilla —" : "— Aún no hay plantillas —" },
                      ...plantillas.map((p) => ({ value: p.id, label: p.nombre })),
                    ]}
                  />
                </div>
                {plantillaSel && (
                  <>
                    <button type="button" onClick={actualizarPlantilla} className="text-xs underline text-gray-500 hover:text-gray-800">
                      Actualizar con lo escrito
                    </button>
                    <button type="button" onClick={borrarPlantilla} className="text-xs underline text-gray-400 hover:text-red-600">
                      Borrar
                    </button>
                  </>
                )}
                {!guardandoPlantilla ? (
                  <button
                    type="button"
                    onClick={() => setGuardandoPlantilla(true)}
                    disabled={!asunto.trim() && !cuerpo.trim()}
                    className="text-xs underline text-gray-500 hover:text-gray-800 disabled:opacity-40"
                  >
                    Guardar como plantilla nueva
                  </button>
                ) : (
                  <span className="flex items-center gap-1">
                    <input
                      type="text"
                      value={nombrePlantillaNueva}
                      onChange={(e) => setNombrePlantillaNueva(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") guardarPlantillaNueva(); }}
                      placeholder="Nombre de la plantilla"
                      maxLength={120}
                      autoFocus
                      className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
                    />
                    <button type="button" onClick={guardarPlantillaNueva} className="text-xs underline text-gray-600 hover:text-gray-900">
                      Guardar
                    </button>
                    <button type="button" onClick={() => { setGuardandoPlantilla(false); setNombrePlantillaNueva(""); }} className="text-xs text-gray-400 px-1">
                      ×
                    </button>
                  </span>
                )}
              </div>
              {avisoPlantilla && <p className="text-xs text-gray-500 mt-1">{avisoPlantilla}</p>}
            </div>

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
                placeholder="El asunto del mensaje"
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

            {/* Adjuntos */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
                Adjuntos
              </label>
              {adjuntos.length > 0 && (
                <ul className="mb-2 space-y-1">
                  {adjuntos.map((a, i) => (
                    <li key={`${a.nombre}-${i}`} className="flex items-center gap-2 text-xs text-gray-700">
                      <span className="px-1.5 py-0.5 rounded bg-gray-100">{a.nombre}</span>
                      <span className="text-gray-400">{pesoLegible(a.bytes)}</span>
                      <button
                        type="button"
                        onClick={() => setAdjuntos((prev) => prev.filter((_, j) => j !== i))}
                        aria-label={`Quitar ${a.nombre}`}
                        className="text-gray-400 hover:text-red-600 px-1"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <label className="inline-block text-xs underline text-gray-500 hover:text-gray-800 cursor-pointer">
                Añadir imagen o PDF
                <input
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
                  className="hidden"
                  onChange={(e) => { anadirAdjuntos([...e.target.files]); e.target.value = ""; }}
                />
              </label>
              <span className="text-[11px] text-gray-400 ml-2">
                Hasta {MAX_ADJUNTOS} ficheros y {pesoLegible(MAX_ADJUNTOS_BYTES)} en total. Van en cada correo.
              </span>
              {errorAdjuntos && <p className="text-xs text-red-600 mt-1">{errorAdjuntos}</p>}
            </div>

            {/* Firma */}
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {firma ? (
                <label className="flex items-center gap-2 text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={incluirFirma} onChange={(e) => setIncluirFirma(e.target.checked)} />
                  Añadir mi pie de firma al final
                </label>
              ) : (
                <span className="text-gray-500 text-xs">Todavía no tienes pie de firma.</span>
              )}
              <button type="button" onClick={() => setModalFirma(true)} className="text-xs underline text-gray-500 hover:text-gray-800">
                {firma ? "Ver o cambiar la firma" : "Crear mi pie de firma"}
              </button>
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
            <>
              <div className="max-h-44 overflow-y-auto rounded-lg bg-gray-50 p-2 space-y-1">
                {lista.map((d) => (
                  <div key={d.email} className="flex items-center gap-2 text-xs">
                    <span className={`px-1.5 py-0.5 rounded ${COLOR_FUENTE[d.fuente] ?? "bg-gray-200 text-gray-600"}`}>
                      {rotuloFuente(d.fuente)}
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
              {/* Guardar la selección para la próxima vez. */}
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={nombreListaNueva}
                  onChange={(e) => setNombreListaNueva(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") guardarLista(); }}
                  placeholder="Guardar como lista…"
                  maxLength={80}
                  className="flex-1 rounded-lg border border-gray-300 px-2 py-1 text-xs"
                />
                <button
                  type="button"
                  onClick={guardarLista}
                  disabled={!nombreListaNueva.trim() || guardandoLista}
                  className="text-xs underline text-gray-500 hover:text-gray-800 disabled:opacity-40"
                >
                  Guardar
                </button>
              </div>
            </>
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

          {/* Filtros por profesional y terapia (centros con pacientes). */}
          {conFiltros && (opcionesFiltros.profesionales.length > 0 || opcionesFiltros.terapias.length > 0) && (
            <div className="grid grid-cols-1 gap-2">
              {opcionesFiltros.profesionales.length > 0 && (
                <Select
                  id="filtro-profesional"
                  value={filtroProfesional}
                  onChange={setFiltroProfesional}
                  options={[
                    { value: "", label: "Cualquier profesional" },
                    ...opcionesFiltros.profesionales.map((p) => ({ value: p.id, label: p.nombre })),
                  ]}
                />
              )}
              {opcionesFiltros.terapias.length > 0 && (
                <Select
                  id="filtro-terapia"
                  value={filtroTerapia}
                  onChange={setFiltroTerapia}
                  options={[
                    { value: "", label: "Cualquier terapia" },
                    ...opcionesFiltros.terapias.map((t) => ({ value: t.key, label: t.label })),
                  ]}
                />
              )}
            </div>
          )}

          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder={conPacientes ? "Buscar por nombre, tutor, paciente o correo…" : "Buscar por nombre o correo…"}
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

          {/* Listas guardadas del centro. */}
          {listas.length > 0 && (
            <div className="pt-2 border-t border-gray-100 space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Listas guardadas</p>
              {listas.map((l) => (
                <div key={l.id} className="flex items-center gap-2 text-xs">
                  <span className="truncate flex-1 text-gray-700">
                    {l.nombre} <span className="text-gray-400">({(l.destinatarios ?? []).length})</span>
                  </span>
                  <button type="button" onClick={() => cargarLista(l)} className="underline text-gray-500 hover:text-gray-800">
                    añadir
                  </button>
                  <button
                    type="button"
                    onClick={() => borrarLista(l)}
                    aria-label={`Borrar la lista ${l.nombre}`}
                    className="text-gray-400 hover:text-red-600 px-1"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
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

      {modalFirma && (
        <FirmaModal
          alCerrar={() => setModalFirma(false)}
          firmaPropia={firma}
          gestion={gestionFirmas}
          alGuardarPropia={(f) => { setFirma(f); if (f) setIncluirFirma(true); }}
        />
      )}
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

      {(r.adjuntos > 0 || r.conFirma) && (
        <p className="text-xs text-gray-500">
          {r.adjuntos > 0 && `Con ${r.adjuntos} ${r.adjuntos === 1 ? "adjunto" : "adjuntos"}. `}
          {r.conFirma && "Con tu pie de firma al final."}
        </p>
      )}

      {r.enviados?.length > 0 && (
        <p className="text-xs text-gray-500">
          <strong className="text-gray-700">{r.apuntadosEnFicha ?? 0}</strong> han quedado apuntados en su
          ficha, en la pestaña «Interacciones».
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

/**
 * FirmaModal — crear o cambiar un pie de firma: el propio y, si quien mira es
 * admin, el de cualquier persona del equipo (Rodrigo, 26/08/2026). Acepta texto
 * tal cual, un fichero .html o una imagen; el servidor lo sanea y lo guarda con
 * su versión de texto plano.
 */
function FirmaModal({ alCerrar, firmaPropia, gestion, alGuardarPropia }) {
  const [usuarioSel, setUsuarioSel] = useState("");
  const [texto, setTexto] = useState(firmaPropia?.html ?? "");
  const [imagen, setImagen] = useState(firmaPropia?.imagen ?? null);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState(null);

  // Al cambiar de persona (solo admin), se trae SU firma.
  useEffect(() => {
    if (!gestion.puedeGestionarEquipo) return;
    let vivo = true;
    setCargando(true);
    setAviso(null);
    const url = usuarioSel ? `/api/correo/firmas?usuario=${usuarioSel}` : "/api/correo/firmas";
    fetch(url, { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (!vivo) return;
        setTexto(json?.data?.firma?.html ?? "");
        setImagen(json?.data?.firma?.imagen ?? null);
      })
      .catch(() => { if (vivo) setAviso("No se ha podido cargar esa firma."); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [usuarioSel, gestion.puedeGestionarEquipo]);

  const subirImagen = async (fichero) => {
    if (!fichero) return;
    if (!/^image\/(png|jpeg|gif|webp)$/.test(fichero.type)) {
      setAviso("La imagen tiene que ser png, jpg, gif o webp.");
      return;
    }
    if (fichero.size > MAX_FIRMA_IMAGEN_BYTES) {
      setAviso(`La imagen no puede pasar de ${pesoLegible(MAX_FIRMA_IMAGEN_BYTES)}.`);
      return;
    }
    try {
      const base64 = await leerBase64(fichero);
      setImagen({ nombre: fichero.name, tipo: fichero.type, base64 });
      setAviso(null);
    } catch {
      setAviso("No se ha podido leer la imagen.");
    }
  };

  const subirHtml = (fichero) => {
    if (!fichero) return;
    const lector = new FileReader();
    lector.onload = () => { setTexto(String(lector.result ?? "")); setAviso(null); };
    lector.onerror = () => setAviso("No se ha podido leer el fichero.");
    lector.readAsText(fichero);
  };

  const guardar = async (vaciar = false) => {
    setGuardando(true);
    setAviso(null);
    try {
      const res = await fetch("/api/correo/firmas", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usuarioId: usuarioSel || undefined,
          html: vaciar ? "" : texto,
          imagen: vaciar ? null : imagen,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "No se ha podido guardar");
      const firmaNueva = json?.data?.firma ?? null;
      if (!usuarioSel) alGuardarPropia(firmaNueva);
      if (vaciar) { setTexto(""); setImagen(null); }
      setAviso(vaciar ? "Firma quitada." : "Firma guardada. Se añadirá al final de cada correo.");
    } catch (e) {
      setAviso(e.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 top-14 lg:top-0 bg-black/40 z-40" onClick={alCerrar} />
      <div className="fixed inset-x-0 top-14 lg:top-0 bottom-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-lg max-h-full overflow-y-auto rounded-xl bg-white shadow-xl p-5 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Pie de firma</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Se añade solo al final de cada correo que envíe esa persona. Vale texto normal, HTML o una imagen.
              </p>
            </div>
            <button type="button" onClick={alCerrar} aria-label="Cerrar" className="text-gray-400 hover:text-gray-700 text-lg px-1">
              ×
            </button>
          </div>

          {gestion.puedeGestionarEquipo && gestion.usuarios.length > 0 && (
            <div>
              <label htmlFor="firma-usuario" className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
                La firma de
              </label>
              <Select
                id="firma-usuario"
                value={usuarioSel}
                onChange={setUsuarioSel}
                options={[
                  { value: "", label: "Mi firma" },
                  ...gestion.usuarios.map((u) => ({
                    value: u.id,
                    label: u.tieneFirma ? `${u.email} · con firma` : u.email,
                  })),
                ]}
              />
            </div>
          )}

          {cargando ? (
            <p className="text-xs text-gray-400">Cargando…</p>
          ) : (
            <>
              <div>
                <label htmlFor="firma-texto" className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
                  Texto de la firma
                </label>
                <textarea
                  id="firma-texto"
                  value={texto}
                  rows={5}
                  maxLength={20000}
                  onChange={(e) => setTexto(e.target.value)}
                  placeholder={"María García · Psicóloga\nCentro Ejemplo — 600 000 000"}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <div className="flex flex-wrap gap-3 mt-1">
                  <label className="text-xs underline text-gray-500 hover:text-gray-800 cursor-pointer">
                    Subir un fichero .html
                    <input
                      type="file"
                      accept=".html,.htm,text/html"
                      className="hidden"
                      onChange={(e) => { subirHtml(e.target.files?.[0]); e.target.value = ""; }}
                    />
                  </label>
                  <label className="text-xs underline text-gray-500 hover:text-gray-800 cursor-pointer">
                    {imagen ? "Cambiar la imagen" : "Añadir una imagen"}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/webp"
                      className="hidden"
                      onChange={(e) => { subirImagen(e.target.files?.[0]); e.target.value = ""; }}
                    />
                  </label>
                  {imagen && (
                    <button type="button" onClick={() => setImagen(null)} className="text-xs underline text-gray-400 hover:text-red-600">
                      Quitar la imagen
                    </button>
                  )}
                </div>
              </div>

              {imagen?.base64 && (
                <img
                  src={`data:${imagen.tipo};base64,${imagen.base64}`}
                  alt="Imagen de la firma"
                  className="max-h-28 max-w-full rounded border border-gray-200"
                />
              )}

              {aviso && <p className="text-xs text-gray-600 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">{aviso}</p>}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => guardar(false)}
                  disabled={guardando || (!texto.trim() && !imagen)}
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                  style={{ backgroundColor: "var(--color-primary)" }}
                >
                  {guardando ? "Guardando…" : "Guardar la firma"}
                </button>
                <button
                  type="button"
                  onClick={() => guardar(true)}
                  disabled={guardando}
                  className="text-xs underline text-gray-400 hover:text-red-600 disabled:opacity-40"
                >
                  Quitar la firma del todo
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
