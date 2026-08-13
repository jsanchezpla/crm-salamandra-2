"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { EVENTO_PENDIENTES } from "../../lib/buzon/buzon.js";

/**
 * La campana del panel: qué nos han escrito los clientes y aún no hemos mirado.
 *
 * ── POR QUÉ ESTÁ EN LA BARRA Y NO DENTRO DEL BUZÓN ──────────────────────────
 * Porque el buzón es la única pantalla donde ya se ve, y es justo la que no
 * estás mirando cuando entra un aviso. El día que se montó, la única forma de
 * enterarse de que un cliente había escrito era abrir `/admin/buzon` a mano o
 * mirar el correo. Aquí se ve desde Registro, Módulos o Alta de clientes, que es
 * donde se pasa el rato (lo pidió Jorge, 13/08/2026).
 *
 * ── QUÉ CUENTA, EXACTAMENTE ─────────────────────────────────────────────────
 * Avisos donde el CLIENTE ha escrito después de la última vez que lo abrimos
 * nosotros — el alta incluida. O sea: lo nuevo y lo que ha vuelto a moverse. NO
 * cuenta lo que hemos contestado y está esperándole a él, que es trabajo hecho.
 * La regla vive en `tienePendienteNuestro` (`lib/buzon/buzon.js`) y en su gemela
 * de SQL; aquí solo se pinta.
 *
 * ── SE APAGA SOLA ───────────────────────────────────────────────────────────
 * Abrir el aviso en el buzón ya apunta la visita en la base. Lo que hace que el
 * número baje SIN recargar es que esa pantalla avisa por `EVENTO_PENDIENTES` y
 * aquí se vuelve a preguntar. La bandeja no manda el número —no lo sabe— sino un
 * «vuelve a mirar»; es la diferencia con el aviso equivalente del CRM, donde la
 * cuenta sale de la propia lista que el usuario tiene delante.
 */

const CADA = 60_000;

function hace(v) {
  if (!v) return "";
  const minutos = Math.round((Date.now() - new Date(v).getTime()) / 60000);
  if (minutos < 1) return "ahora mismo";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.round(horas / 24);
  return dias === 1 ? "ayer" : `hace ${dias} días`;
}

export default function CampanaBuzon() {
  const [total, setTotal] = useState(0);
  const [avisos, setAvisos] = useState([]);
  const [abierta, setAbierta] = useState(false);
  const caja = useRef(null);

  const mirar = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/buzon/pendientes", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      if (!json?.ok) return;
      setTotal(json.data.total ?? 0);
      setAvisos(json.data.avisos ?? []);
    } catch {
      // Que no se pueda preguntar no es motivo para romper la barra de todo el
      // panel: la campana se queda con lo último que supo.
    }
  }, []);

  useEffect(() => {
    mirar();

    // Se repregunta sola porque si no, esto no es una campana: es un número que
    // se quedó fijo al cargar la página. La consulta es un COUNT sobre master y
    // la abrimos solo nosotros, así que cada minuto no le duele a nadie.
    const reloj = setInterval(mirar, CADA);

    // Y al volver a la pestaña, sin esperar al minuto: es el momento exacto en
    // que alguien quiere saber si ha entrado algo mientras no miraba.
    const alVolver = () => {
      if (document.visibilityState === "visible") mirar();
    };
    document.addEventListener("visibilitychange", alVolver);

    // La bandeja avisa cuando se abre un aviso, para que el número baje al
    // instante en vez de al minuto siguiente.
    window.addEventListener(EVENTO_PENDIENTES, mirar);

    return () => {
      clearInterval(reloj);
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener(EVENTO_PENDIENTES, mirar);
    };
  }, [mirar]);

  // Cerrar al pulsar fuera o con Escape. Sin esto, el desplegable se queda
  // abierto tapando la barra mientras se navega.
  useEffect(() => {
    if (!abierta) return;
    const fuera = (e) => {
      if (caja.current && !caja.current.contains(e.target)) setAbierta(false);
    };
    const tecla = (e) => {
      if (e.key === "Escape") setAbierta(false);
    };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", tecla);
    };
  }, [abierta]);

  return (
    <div className="relative" ref={caja}>
      {/* SIEMPRE visible, tenga o no avisos (lo pidió Jorge). Una campana que
          solo aparece cuando hay algo obliga a acordarse de que existe, y el
          hueco vacío es información: «no hay nada esperando». */}
      <button
        type="button"
        onClick={() => {
          // Al abrirla se repregunta: es el momento en que alguien está mirando
          // de verdad, y lo peor sería enseñarle una lista de hace un minuto.
          if (!abierta) mirar();
          setAbierta((v) => !v);
        }}
        className="relative p-1.5 rounded cursor-pointer transition-colors hover:opacity-70"
        style={{ color: total > 0 ? "var(--ok)" : "var(--tenue)" }}
        aria-label={total > 0 ? `Buzón: ${total} sin mirar` : "Buzón: nada pendiente"}
        aria-expanded={abierta}
        title={total > 0 ? `${total} sin mirar` : "Nada pendiente"}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-[18px] h-[18px]">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
          />
        </svg>
        {total > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 rounded-full text-[9px] font-semibold text-white flex items-center justify-center"
            style={{ background: "var(--ok)" }}
          >
            {total > 9 ? "9+" : total}
          </span>
        )}
      </button>

      {abierta && (
        // z-30 y no más: es la escala del proyecto (regla #13). Los widgets
        // flotantes van POR DEBAJO de los paneles (z-50) y sus fondos (z-40),
        // así que al abrir un aviso esto queda tapado y no pisa sus botones.
        <div
          className="absolute right-0 top-[calc(100%+8px)] w-[340px] max-w-[calc(100vw-2rem)] rounded shadow-lg z-30 overflow-hidden"
          style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
        >
          <div
            className="px-3.5 py-2.5 text-[11px] uppercase tracking-[0.16em]"
            style={{ color: "var(--tenue)", borderBottom: "1px solid var(--line-suave)" }}
          >
            {total > 0 ? `${total} sin mirar` : "Buzón"}
          </div>

          {avisos.length === 0 ? (
            <p className="px-3.5 py-5 text-[12px] leading-relaxed" style={{ color: "var(--tenue)" }}>
              Nada esperando. Cuando un cliente escriba desde su CRM, o conteste a algo nuestro,
              aparecerá aquí.
            </p>
          ) : (
            <ul>
              {avisos.map((a) => (
                <li key={a.id}>
                  {/* Enlace normal y no un `router.push`: la bandeja lo abre por
                      la query, así que funciona igual desde otra pestaña o desde
                      un marcador. */}
                  <a
                    href={`/admin/buzon?aviso=${a.id}`}
                    className="block px-3.5 py-2.5 transition-colors hover:opacity-80"
                    style={{ borderBottom: "1px solid var(--line-suave)" }}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[12px] font-semibold" style={{ color: "var(--ok)" }}>
                        {a.tenantNombre}
                      </span>
                      <span className="text-[10px]" style={{ color: "var(--tenue)" }}>
                        {a.ref}
                      </span>
                      {a.bloquea && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{ background: "#FEF3C7", color: "#92400E" }}
                        >
                          Le bloquea
                        </span>
                      )}
                    </div>
                    <div className="text-[12.5px] mt-0.5 truncate" style={{ color: "var(--text)" }}>
                      {a.asunto}
                    </div>
                    <div className="text-[10.5px] mt-0.5" style={{ color: "var(--tenue)" }}>
                      {/* «Nuevo» y «Ha vuelto a escribir» no son lo mismo, y el
                          segundo suele correr más prisa: significa que ya
                          hablamos y no le sirvió. */}
                      {a.nuevo ? "Nuevo" : "Ha vuelto a escribir"} · {hace(a.clienteEscribioAt)}
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          )}

          <a
            href="/admin/buzon"
            className="block px-3.5 py-2.5 text-[11.5px] transition-colors hover:opacity-70"
            style={{ color: "var(--dim)" }}
          >
            Abrir el buzón →
          </a>
        </div>
      )}
    </div>
  );
}
