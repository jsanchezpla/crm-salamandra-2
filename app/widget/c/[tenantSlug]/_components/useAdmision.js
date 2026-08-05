"use client";

/**
 * useAdmision — ¿esta paciente ya puede reservar? (05/08/2026, Rodrigo)
 *
 * Lo preguntan DOS pantallas —la agenda y el área privada— y tienen que
 * contestar lo mismo: si «Reservar cita» te manda al formulario, «Mi perfil»
 * también. Con la condición escrita en cada una, la primera vez que cambie
 * quedarán discrepando y la paciente entrará por la puerta que no filtra.
 *
 * Estados:
 *   · `cargando: true`        → todavía no se sabe. NO enseñar nada aún: pintar
 *     la agenda un instante y quitarla es peor que esperar medio segundo.
 *   · `admitida: true`        → adelante (o el centro no tiene la puerta puesta).
 *   · `admitida: false`       → `aviso` trae el título y el texto, y
 *     `urlFormulario` a dónde mandarla.
 *
 * Ante cualquier fallo se deja pasar: el servidor vuelve a comprobarlo en
 * `/book` y corta ahí. Bloquear la agenda porque una consulta no respondió
 * dejaría sin cita a quien sí puede pedirla.
 */

import { useEffect, useState } from "react";

export function useAdmision(tenantSlug, portal) {
  const [estado, setEstado] = useState({ cargando: true, admitida: true, aviso: null, urlFormulario: null });

  const listo = portal?.status && portal.status !== "loading";
  const token = portal?.sessionToken ?? null;

  useEffect(() => {
    if (!tenantSlug || !listo) return;

    // Sin sesión no se puede preguntar por nadie. Que pase: si el centro exige
    // identificarse, de eso ya se encarga el gate de acceso.
    if (!token) {
      setEstado({ cargando: false, admitida: true, aviso: null, urlFormulario: null });
      return;
    }

    let cancelado = false;
    fetch(`/api/public/c/${tenantSlug}/citas-portal/admision`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelado) return;
        const d = j?.data;
        setEstado({
          cargando: false,
          admitida: d ? d.admitida !== false : true,
          aviso: d?.aviso ?? null,
          urlFormulario: d?.urlFormulario ?? null,
        });
      })
      .catch(() => {
        if (!cancelado) setEstado({ cargando: false, admitida: true, aviso: null, urlFormulario: null });
      });

    return () => { cancelado = true; };
  }, [tenantSlug, listo, token]);

  return estado;
}
