"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Select from "../ui/Select.jsx";
import { ESPERA_MS, hayMasDeLasQueCaben, urlDeFichas } from "../../lib/clients/buscarFichas.js";

/**
 * SelectorCliente — elegir una ficha PREGUNTANDO AL SERVIDOR según se escribe.
 *
 * ─── DE QUÉ FALLO NACE (28/08/2026) ─────────────────────────────────────────
 *
 * Once pantallas hacían lo mismo: al abrirse, `fetch("/api/clients?limit=200")`
 * y un desplegable que filtraba encima de esa lista. Con las 1.083 fichas de
 * Aumenta, **883 familias (el 82%) no salían de ninguna manera**, y varias
 * pantallas ni siquiera tenían dónde escribir: había que bajar por la lista.
 *
 * Subir el número no lo arreglaba. `/api/clients` corta en 200 por su cuenta,
 * así que el `limit=300` de Cobros y el `limit=500` del Calendario ya estaban
 * recibiendo 200 y nadie lo sabía.
 *
 * Y lo peor no era el tope, era el SILENCIO: la familia sencillamente no estaba
 * en la lista, exactamente igual que si no existiera. Un techo callado se lee
 * como una ausencia. Por eso, cuando hay más coincidencias que sitio, se dice.
 *
 * Es el mismo fallo que se cerró ese día en «Nuevo ticket» de Soporte. Aquella
 * vez se arregló en una pantalla; esta pieza existe para que no haya que
 * arreglarlo doce veces más — la regla vive AQUÍ y las pantallas la usan.
 *
 * ─── CÓMO SE USA ────────────────────────────────────────────────────────────
 *
 *     <SelectorCliente value={clientId} onChange={setClientId} />
 *
 * Es un reemplazo directo del `<Select>` que había: mismas pintas, mismo
 * teclado. La pantalla YA NO necesita bajarse la lista de fichas.
 *
 *   value        id de la ficha elegida (o "" / null)
 *   onChange     (id, ficha) — la ficha entera por si hace falta el nombre
 *   onFicha      (ficha|null) — la elegida, TAMBIÉN cuando se resuelve por id al
 *                cargar la pantalla. La necesita quien pinta algo con ella
 *                (Facturas avisa si le falta razón social o NIF).
 *   etiqueta     (ficha) => texto de cada línea. Por defecto, su nombre.
 *   params       filtros extra para la consulta, p.ej. { assignedTo: "nutricion" }
 *   placeholder  texto cuando no hay nada elegido
 *   className    clases del botón, como en Select
 *   opcionesFijas  opciones que van SIEMPRE arriba y no se filtran (`pinned`),
 *                  p.ej. «Sin cliente». Su `value` no puede chocar con un id.
 */

export default function SelectorCliente({
  value,
  onChange,
  onFicha,
  etiqueta,
  params = null,
  placeholder = "— Seleccionar cliente —",
  className = "",
  disabled = false,
  id,
  "aria-label": ariaLabel,
  opcionesFijas = [],
}) {
  const [texto, setTexto] = useState("");
  const [fichas, setFichas] = useState([]);
  const [total, setTotal] = useState(0);
  const [buscando, setBuscando] = useState(false);
  // La elegida se guarda aparte: puede no estar en la página que se ve, y sin
  // ella el botón enseñaría el placeholder aunque haya una ficha seleccionada.
  const [elegida, setElegida] = useState(null);

  // Cada consulta lleva número: si una lenta contesta después de otra más
  // nueva, se tira. Sin esto, escribir deprisa deja en pantalla un resultado
  // viejo — y aquí eso significa elegir a quien no era.
  const consulta = useRef(0);

  // Los filtros extra, como texto: quien nos usa suele pasar `params` escrito
  // en el JSX (`params={{ assignedTo: "nutricion" }}`), que es un objeto NUEVO
  // en cada render. Puesto tal cual en las dependencias del efecto, se pediría
  // la lista en bucle.
  const clave = useMemo(() => JSON.stringify(params || {}), [params]);

  // Buscar. Sin texto, las últimas; con texto, lo que case.
  useEffect(() => {
    const q = texto.trim();
    const mia = ++consulta.current;
    setBuscando(true);
    const t = setTimeout(() => {
      fetch(urlDeFichas(q, params), { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (mia !== consulta.current) return; // llegó tarde: manda la última
          setFichas(j?.data?.clients || []);
          setTotal(j?.data?.total ?? 0);
          setBuscando(false);
        })
        .catch(() => {
          if (mia === consulta.current) setBuscando(false);
        });
    }, ESPERA_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto, clave]);

  // La ficha ya elegida se pide POR SU ID. Buscarla dentro de la lista
  // descargada era justo el fallo: una que no estuviera en las 200 aparecía
  // como «sin elegir» aunque el registro sí estuviera bien guardado.
  useEffect(() => {
    if (!value) {
      setElegida(null);
      return;
    }
    if (elegida && String(elegida.id) === String(value)) return;
    const yaEstá = fichas.find((c) => String(c.id) === String(value));
    if (yaEstá) {
      setElegida(yaEstá);
      return;
    }
    // La ficha ENTERA, no solo su nombre: quien la pide puede necesitar su
    // razón social o su NIF, y volver a pedirla sería otra vuelta al servidor.
    fetch(`/api/clients/${value}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.data) setElegida(j.data);
      })
      .catch(() => {});
    // `fichas` a propósito fuera: solo se resuelve al cambiar la elegida.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // La elegida, hacia fuera. En un efecto para que llegue también cuando se
  // resuelve por id al abrir la pantalla, no solo cuando alguien la pulsa.
  useEffect(() => {
    onFicha?.(elegida);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elegida]);

  const opciones = useMemo(() => {
    const nombre = etiqueta || ((c) => c.name);
    const lista = fichas.map((c) => ({ value: c.id, label: nombre(c) }));
    // La elegida va siempre, aunque no esté en lo que se ve ahora: es lo que
    // hace que el botón enseñe su nombre y no el placeholder.
    if (elegida && !lista.some((o) => String(o.value) === String(elegida.id))) {
      lista.unshift({ value: elegida.id, label: nombre(elegida) });
    }
    return [...opcionesFijas.map((o) => ({ ...o, pinned: true })), ...lista];
  }, [fichas, elegida, opcionesFijas, etiqueta]);

  // El aviso de que hay más. `total` es cuántas casan en TODA la base, no
  // cuántas se han bajado: por eso se puede decir la verdad.
  const hayMás = !buscando && hayMasDeLasQueCaben(total, fichas.length);
  const pie = hayMás ? (
    <p className="px-3 py-2 text-[11px] leading-snug text-neutral-500 border-t border-neutral-100">
      {total} fichas coinciden; se enseñan {fichas.length}. Escribe un poco más para afinar.
    </p>
  ) : null;

  return (
    <Select
      id={id}
      aria-label={ariaLabel}
      value={value ?? ""}
      onChange={(v) => {
        const ficha = fichas.find((c) => String(c.id) === String(v)) || null;
        if (ficha) setElegida(ficha);
        onChange?.(v, ficha);
      }}
      options={opciones}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      searchable
      filtrarEnCliente={false}
      onQueryChange={setTexto}
      // Tres silencios distintos, y confundirlos es justo lo que hacía daño:
      // «estoy mirando», «he mirado y no está» y «aquí todavía no hay nada».
      mensajeVacio={
        buscando
          ? "Buscando…"
          : texto.trim()
            ? "Ninguna ficha coincide"
            : "Aún no hay fichas. Se crean en Clientes."
      }
      pie={pie}
    />
  );
}
