"use client";

/**
 * useAccionesDeBono — anular, reactivar y VOLVER A COGER un bono, con sus
 * preguntas y sus avisos (10/09/2026, submódulo Bonos).
 *
 * Lo piden las dos pantallas de bonos —la lista y la ficha de un grupo— y las
 * tres acciones tienen texto: qué le pasa a las sesiones ya dadas, qué le pasa
 * a su cobro pendiente, y por qué renovar crea otro bono en vez de reabrir el
 * de antes. Escrito dos veces, cada pantalla habría acabado avisando de una
 * cosa distinta sobre el mismo botón.
 *
 * El hook se queda con el diálogo y los dos mensajes de la pantalla (verde y
 * rojo) porque son parte de la acción: una anulación que retira un cobro
 * pendiente tiene que decirlo, y si la pantalla se olvidara de pintarlo el
 * ajuste de dinero pasaría en silencio.
 *
 * Las reglas no están aquí: `lib/billing/bonos.js` dice cuándo un bono está
 * cerrado y qué avisar al renovar; el servidor dice qué le pasa a su cobro.
 */

import { useCallback, useState } from "react";

import { useDialogo } from "../ui/Dialogo.jsx";
import { avisosDeRenovacion, parteDelCobro } from "../../lib/billing/bonos.js";
import { formatMoney } from "../../lib/payments/money.js";

export function useAccionesDeBono({ recargar } = {}) {
  const { confirmar, dialogo } = useDialogo();
  const [errorMsg, setErrorMsg] = useState(null);
  const [okMsg, setOkMsg] = useState(null);

  const patch = useCallback(
    async (id, cambios, mensaje) => {
      setErrorMsg(null);
      setOkMsg(null);
      try {
        const r = await fetch(`/api/billing/bonos/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cambios),
        });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || "No se pudo guardar");
        setOkMsg(`${mensaje}${parteDelCobro(j.data?.cobro)}`);
        await recargar?.();
      } catch (e) {
        setErrorMsg(e.message);
      }
    },
    [recargar]
  );

  const anular = useCallback(
    async (b) => {
      const quien = b.paciente || b.familia || "esta familia";
      const dadas = Number(b.gastadas) || 0;
      // Lo de «sus sesiones ya dadas» solo se dice si las hay: en un bono
      // recién dado, «sus 0 sesiones ya dadas siguen en la agenda» no explica
      // nada y suena a error de la pantalla.
      const yaDadas = dadas
        ? ` ${dadas === 1 ? "Su sesión ya dada sigue" : `Sus ${dadas} sesiones ya dadas siguen`} en la agenda con su número.`
        : "";
      const seguro = await confirmar({
        titulo: "Anular el bono",
        texto: `El bono de «${b.nombre}» de ${quien} deja de dar derecho a citas.${yaDadas} Si tiene un cobro pendiente se retira; lo ya cobrado se queda, que para devolverlo está «Devuelto» en Caja.`,
        confirmar: "Anular",
        cancelar: "Volver",
        tono: "peligro",
      });
      if (!seguro) return;
      await patch(b.id, { status: "anulado" }, "Bono anulado");
    },
    [confirmar, patch]
  );

  const reactivar = useCallback(
    async (b) => { await patch(b.id, { status: "active" }, "Bono reactivado"); },
    [patch]
  );

  /** Volver a coger el bono: otra fila con su cobro. Nunca reabre el anterior. */
  const renovar = useCallback(
    async (b) => {
      const quien = b.paciente || b.familia || "esta familia";
      const seguro = await confirmar({
        titulo: "Volver a coger el bono",
        texto: [
          `Se le da a ${quien} otro bono de «${b.nombre}»: ${b.total} ${b.total === 1 ? "sesión" : "sesiones"}${b.amount ? ` por ${formatMoney(b.amount)}` : " sin importe"}, con su cobro pendiente aparte.`,
          "El bono anterior se queda como está, con las sesiones que ya se dieron y su número.",
          ...avisosDeRenovacion(b),
        ].join(" "),
        confirmar: "Renovar",
        cancelar: "Volver",
      });
      if (!seguro) return;
      setErrorMsg(null);
      setOkMsg(null);
      try {
        const r = await fetch(`/api/billing/bonos/${b.id}/renovar`, { method: "POST" });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || "No se pudo renovar el bono");
        setOkMsg(
          `Bono renovado${j.data?.cobro ? " y su cobro pendiente apuntado en Cobros" : " (sin importe: no ha nacido ningún cobro)"}.`
        );
        await recargar?.();
      } catch (e) {
        setErrorMsg(e.message);
      }
    },
    [confirmar, recargar]
  );

  return { anular, reactivar, renovar, errorMsg, okMsg, setErrorMsg, setOkMsg, dialogo };
}
