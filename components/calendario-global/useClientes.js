/**
 * useClientes — qué clientes hay y cuáles se están mirando, para las dos
 * pestañas del calendario global (12/09/2026).
 *
 * ── DE QUÉ PETICIÓN NACE ────────────────────────────────────────────────────
 * Rodrigo: «No puedo seleccionar los calendarios que quiera ver dentro de la
 * app (debería tener acceso a todos los tenants y ver el calendario que
 * quiera)». La pantalla de antes guardaba los ocultos en memoria, así que cada
 * recarga volvía a enseñarlo todo, y además filtraba DESPUÉS de haber leído
 * todos los clientes en el servidor. Ahora la selección se recuerda y viaja al
 * servidor (`?slugs=`), que solo abre los schemas de los que se miran.
 *
 * ── LO QUE SE GUARDA SON LOS OCULTOS, NO LOS VISIBLES ──────────────────────
 * Clave `calendario-global:ocultos:<yo.id>` en `localStorage`. Si se guardaran
 * los visibles, un cliente dado de alta mañana nacería oculto y nadie lo
 * echaría de menos. El id de la cuenta va en la clave porque el navegador
 * puede ser compartido. Sin id (una API anterior al 12/09/2026) la selección
 * vive solo en memoria.
 *
 * La lista sale de `GET /api/calendario-global/vinculos` UNA vez por carga de
 * la página: la comparten la cabecera (`CabeceraCuenta`) y las dos pestañas,
 * y navegar entre ellas no la vuelve a pedir.
 *
 * Devuelve:
 *   yo            { id, email, tenant, todos } | null
 *   clientes      [Ficha] = { slug, nombre, color, calendario, proyectos, saltoComo, saltoEmail, fallo? }
 *   visibles      [slug]  — identidad estable mientras no cambie la selección
 *   cargando, error
 *   alternar(slug), soloEste(slug), todos(), ninguno()
 *   fusionarFichas([Ficha]) — mezcla las fichas frescas que traen `/eventos` o
 *                 `/proyectos` (con `fallo`); estable, apta para dependencias
 *   reintentar()  — vuelve a pedir la lista tras un error
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { guardar, useValorGuardado } from "./almacen.js";
import { pedirJson } from "./api.js";

let promesaVinculos = null;

/** La lista de clientes y la cuenta, pedida una sola vez por página. */
export function cargarVinculos({ forzar = false } = {}) {
  if (!promesaVinculos || forzar) {
    promesaVinculos = pedirJson("/api/calendario-global/vinculos").catch((err) => {
      promesaVinculos = null; // que el siguiente intento vuelva a pedirla
      throw err;
    });
  }
  return promesaVinculos;
}

export function claveOcultos(usuarioId) {
  return usuarioId ? `calendario-global:ocultos:${usuarioId}` : null;
}

function leerOcultos(crudo) {
  if (!crudo) return new Set();
  try {
    const lista = JSON.parse(crudo);
    return new Set(Array.isArray(lista) ? lista.filter((s) => typeof s === "string") : []);
  } catch {
    return new Set();
  }
}

const CAMPOS_FICHA = ["nombre", "color", "calendario", "proyectos", "saltoComo", "saltoEmail", "fallo"];

function mismaFicha(a, b) {
  return CAMPOS_FICHA.every((k) => (a?.[k] ?? null) === (b?.[k] ?? null));
}

export function useClientes() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [intento, setIntento] = useState(0);
  const [frescas, setFrescas] = useState(() => new Map());
  const [ocultosEnMemoria, setOcultosEnMemoria] = useState(() => new Set());

  useEffect(() => {
    let vivo = true;
    cargarVinculos({ forzar: intento > 0 })
      .then((d) => {
        if (vivo) setDatos(d ?? { yo: null, calendarios: [] });
      })
      .catch((e) => {
        if (vivo) setError(e?.message || "No se ha podido cargar la lista de clientes.");
      });
    return () => {
      vivo = false;
    };
  }, [intento]);

  const yo = datos?.yo ?? null;
  const clave = claveOcultos(yo?.id);
  const crudo = useValorGuardado(clave);
  const ocultos = useMemo(() => (clave ? leerOcultos(crudo) : ocultosEnMemoria), [clave, crudo, ocultosEnMemoria]);

  const clientes = useMemo(() => {
    const base = Array.isArray(datos?.calendarios) ? datos.calendarios : [];
    if (!frescas.size) return base;
    const vistos = new Set();
    const lista = base.map((c) => {
      vistos.add(c.slug);
      const f = frescas.get(c.slug);
      return f ? { ...c, ...f } : c;
    });
    // Un cliente que el servidor autoriza y la lista de esta carga aún no
    // tenía (alta de hace un rato): se añade al final.
    for (const [slug, f] of frescas) if (!vistos.has(slug) && f.nombre) lista.push(f);
    return lista;
  }, [datos, frescas]);

  const claveVisibles = clientes
    .filter((c) => !ocultos.has(c.slug))
    .map((c) => c.slug)
    .join(",");
  const visibles = useMemo(() => (claveVisibles ? claveVisibles.split(",") : []), [claveVisibles]);

  function fijarOcultos(set) {
    if (clave) guardar(clave, JSON.stringify([...set]));
    else setOcultosEnMemoria(set);
  }

  function alternar(slug) {
    const s = new Set(ocultos);
    if (s.has(slug)) s.delete(slug);
    else s.add(slug);
    fijarOcultos(s);
  }

  function soloEste(slug) {
    fijarOcultos(new Set(clientes.map((c) => c.slug).filter((s) => s !== slug)));
  }

  function todos() {
    fijarOcultos(new Set());
  }

  function ninguno() {
    fijarOcultos(new Set(clientes.map((c) => c.slug)));
  }

  const fusionarFichas = useCallback((fichas) => {
    if (!Array.isArray(fichas) || !fichas.length) return;
    setFrescas((prev) => {
      let cambia = false;
      const siguiente = new Map(prev);
      for (const f of fichas) {
        if (!f?.slug) continue;
        if (!mismaFicha(siguiente.get(f.slug), f)) {
          siguiente.set(f.slug, f);
          cambia = true;
        }
      }
      // Devolver el mismo Map si nada cambia evita repintar (y un bucle con
      // quien llama a esto después de cada carga de eventos).
      return cambia ? siguiente : prev;
    });
  }, []);

  const reintentar = useCallback(() => {
    setError(null);
    setIntento((n) => n + 1);
  }, []);

  return {
    yo,
    clientes,
    visibles,
    ocultos,
    cargando: !datos && !error,
    error,
    alternar,
    soloEste,
    todos,
    ninguno,
    fusionarFichas,
    reintentar,
  };
}
