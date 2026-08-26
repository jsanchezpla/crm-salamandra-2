"use client";

/**
 * AvisoCorreoCuenta — la barra que le dice a UNA persona que su cuenta no tiene
 * correo (26/08/2026, Jorge: «que se le dé un aviso en la cuenta de cada usuario
 * si no lo tienen puesto»).
 *
 * ── POR QUÉ NO BASTABA CON LA TARJETA DE CONFIGURACIÓN ─────────────────────
 * El sitio donde se arregla es Configuración → Tu cuenta, y ahí ya lo avisa.
 * Pero es una pantalla a la que casi nadie entra: de los usuarios de clientes
 * reales, la mayoría tiene rol `user` y no administra nada. Un aviso que solo se
 * ve si ya has ido a mirar no avisa de nada.
 *
 * Una cuenta sin correo no puede recuperar su contraseña sola. El día que la
 * pierde se queda fuera hasta que alguien se la restablece a mano, y en un
 * cliente con un solo administrador eso puede ser un día entero parado. Por eso
 * el aviso va donde se trabaja, no donde se arregla.
 *
 * ── SE PUEDE CERRAR, PERO VUELVE ───────────────────────────────────────────
 * Se guarda en `sessionStorage`: se calla el resto del rato y reaparece mañana.
 * Una barra que no se puede cerrar en la pantalla que alguien usa ocho horas se
 * convierte en algo que se deja de leer —y peor, en un motivo para no abrir el
 * CRM—. Una que vuelve cada día se acaba arreglando.
 *
 * No sale nunca en las demos (la cuenta la comparte todo el mundo y no hay nada
 * que arreglar) ni, por supuesto, cuando la cuenta sí tiene correo.
 */

import { useEffect, useState } from "react";

const CLAVE = "aviso-correo-cuenta-callado";

export default function AvisoCorreoCuenta() {
  const [falta, setFalta] = useState(false);
  const [callado, setCallado] = useState(true); // hasta saberlo, no se pinta nada

  useEffect(() => {
    let vivo = true;

    // `sessionStorage` puede lanzar (ventana privada, ajustes del navegador):
    // si no se puede leer, el aviso sale, que es el lado seguro del error.
    let silenciado = false;
    try {
      silenciado = window.sessionStorage.getItem(CLAVE) === "1";
    } catch { /* sale igual */ }

    if (silenciado) return () => { vivo = false; };

    fetch("/api/auth/correo", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!vivo || !j?.ok) return;
        // `correo: null` es el único caso que importa. En la demo, nunca.
        if (!j.data.enDemo && !j.data.correo) {
          setFalta(true);
          setCallado(false);
        }
      })
      .catch(() => { /* si falla, no se molesta a nadie */ });

    return () => { vivo = false; };
  }, []);

  function cerrar() {
    setCallado(true);
    try {
      window.sessionStorage.setItem(CLAVE, "1");
    } catch { /* se volverá a ver en un rato: tampoco pasa nada */ }
  }

  if (!falta || callado) return null;

  return (
    <div
      role="status"
      className="shrink-0 flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 bg-amber-50 border-b border-amber-100 text-[12px] text-amber-900"
    >
      <span>
        <strong className="font-semibold">Tu cuenta no tiene un correo asignado.</strong>{" "}
        Si pierdes la contraseña no habrá a dónde mandarte el enlace para recuperarla.
      </span>
      <a
        href="/configuracion?zona=cuenta"
        className="font-semibold underline hover:no-underline"
      >
        Ponerlo ahora
      </a>
      <button
        onClick={cerrar}
        className="ml-auto text-amber-700/70 hover:text-amber-900 text-[11px] px-1"
        aria-label="Ocultar este aviso"
      >
        Ahora no
      </button>
    </div>
  );
}
