"use client";

import { useEffect, useState } from "react";
import SalirBoton from "../admin/SalirBoton.jsx";
import { cargarVinculos } from "./useClientes.js";

/**
 * La parte derecha de la cabecera del calendario global (12/09/2026): con qué
 * cuenta se está mirando y «Salir».
 *
 * El correo sale de `GET /api/calendario-global/vinculos`, la MISMA petición
 * que usa la lista de clientes (`cargarVinculos` la guarda para toda la
 * página): pintar la cabecera no cuesta una llamada más. En el móvil el
 * correo no cabe junto a las pestañas y se esconde.
 *
 * `SalirBoton` es el del back-office (cierra por POST) y escribe «salir» en
 * minúscula; aquí se capitaliza por CSS para no tocar un componente que usa
 * otra pantalla.
 */
export default function CabeceraCuenta() {
  const [email, setEmail] = useState(null);

  useEffect(() => {
    let vivo = true;
    cargarVinculos()
      .then((d) => {
        if (vivo) setEmail(d?.yo?.email ?? null);
      })
      .catch(() => {
        // Sin correo la cabecera sigue sirviendo; el error lo enseña la pestaña.
      });
    return () => {
      vivo = false;
    };
  }, []);

  return (
    <div className="flex items-center gap-2 sm:gap-3 min-w-0">
      {email && (
        <span className="hidden md:block truncate max-w-[240px] text-[12px] text-white/65" title={email}>
          {email}
        </span>
      )}
      <SalirBoton className="capitalize h-8 px-2.5 rounded-md text-[12.5px] text-white/80 hover:text-white hover:bg-white/10 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white/70" />
    </div>
  );
}
