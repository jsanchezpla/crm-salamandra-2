"use client";

/**
 * useQuienSoy — mi ficha de equipo y mi rol, para PINTAR (18/09/2026).
 *
 * Las dos pantallas de coordinaciones —el listado general y la pestaña de la
 * ficha del paciente— necesitan lo mismo para decidir si enseñan el botón
 * «Editar»: `/api/team/me` da la ficha de equipo (sin rol) y `/api/auth/me` da
 * el rol. Es el camino que ya usan `InterventionPlanSection` y `/equipo`; aquí
 * se escribe una vez en vez de dos.
 *
 * ⚠️ Esto solo sirve para pintar. Quien decide de verdad quién puede corregir
 * un acta es el servidor (`lib/clinica/alcanceCoordinaciones.js`): esconder un
 * botón no es un permiso.
 */

import { useEffect, useState } from "react";

export function useQuienSoy() {
  const [yo, setYo] = useState(null);
  const [rol, setRol] = useState("user");
  useEffect(() => {
    let vivo = true;
    fetch("/api/team/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo) setYo(j?.data?.member?.id ?? null); })
      .catch(() => {});
    // El rol va en `data.role`, no en `data.user.role`: la respuesta de
    // `/api/auth/me` es el usuario, no un sobre con un usuario dentro.
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo) setRol(j?.data?.role ?? "user"); })
      .catch(() => {});
    return () => { vivo = false; };
  }, []);
  return { yo, rol };
}
