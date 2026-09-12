"use client";

import { useCallback, useState } from "react";
import { useDialogo } from "../ui/Dialogo.jsx";
import { formatoHoras, puedeDesbloquear, HORAS_MAX_TOPE } from "../../lib/clinica/diagnostico.js";

/**
 * useAccionesDeDiagnostico — parar, seguir, desbloquear, cerrar y cambiar
 * de terapeuta un expediente de diagnóstico, con sus confirmaciones
 * (12/09/2026, segunda entrega del Diagnóstico; Rodrigo con Isa, Aumenta).
 *
 * Nació dentro de la lista (`/clinica/diagnosticos`) y se sacó a un hook el
 * día que el expediente ganó ficha propia (`/clinica/diagnosticos/[id]`): las
 * dos pantallas enseñan los MISMOS botones y tienen que confirmar con las
 * mismas frases y llamar a los mismos POST. Copiado, la primera vez que
 * cambiara el texto del cobro en una, la otra seguiría diciendo lo de antes.
 *
 * ── LO QUE DECIDE Y LO QUE NO ──────────────────────────────────────────────
 * Aquí no hay regla de negocio: qué botones salen viene en `acciones` de la
 * fila de la API, y lo que costará «Seguir» viene en `e.cobroAlSeguir`
 * (importe, descuento de la entrevista ya cobrada y texto), calculado por el
 * servidor con la misma función que apuntará el cobro. El hook solo pregunta,
 * llama y cuenta lo que pasó.
 *
 * ── CÓMO SE USA ────────────────────────────────────────────────────────────
 *
 *   const acciones = useAccionesDeDiagnostico({
 *     cobroEntrevista,           // el cobro de la entrevista al parar (de la
 *                                // lista: `data.cobroEntrevista`) o null
 *     reemplazar: (fila) => …,   // sustituye la fila por la que devuelve la API
 *     recargar: async () => …,   // vuelve a pedir lo que haya que pedir
 *   });
 *   …
 *   <DiagnosticoFila … ocupado={acciones.ocupadoId === e.id} onParar={acciones.parar} … />
 *   {acciones.dialogo}
 *
 * `reemplazar` se usa cuando la respuesta trae la fila entera y basta con
 * ella (terapeuta, tope de horas); `recargar` cuando la acción cambia más
 * cosas que la fila (parar, seguir y cerrar tocan bono, citas y cobros). Los
 * mensajes (`errorMsg`, `okMsg`) los pinta quien llama; `flash` y `avisar`
 * se exponen para que la pantalla los use con sus otras acciones.
 */

const euros = (n) => `${Number(n ?? 0).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €`;

export function useAccionesDeDiagnostico({ cobroEntrevista = null, reemplazar, recargar } = {}) {
  // El expediente sobre el que hay una petición en vuelo: sus botones se apagan.
  const [ocupadoId, setOcupadoId] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [okMsg, setOkMsg] = useState(null);

  const { confirmar, avisar, pedirTexto, dialogo } = useDialogo();

  const flash = useCallback((msg) => {
    setOkMsg(msg);
    setTimeout(() => setOkMsg(null), 5000);
  }, []);

  const llamar = useCallback(async (exp, url, opciones, despues) => {
    setOcupadoId(exp.id);
    setErrorMsg(null);
    try {
      const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opciones });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo hacer");
      await despues?.(j.data);
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setOcupadoId(null);
    }
  }, []);

  const cambiarTerapeuta = useCallback(
    (exp, therapistId) =>
      llamar(exp, `/api/clinica/diagnosticos/${exp.id}`, { method: "PATCH", body: JSON.stringify({ therapistId }) }, (d) => {
        reemplazar?.(d.expediente);
        flash(d.expediente.terapeuta ? `Ahora lo lleva ${d.expediente.terapeuta.nombre}` : "Diagnóstico sin terapeuta asignado");
      }),
    [llamar, reemplazar, flash]
  );

  const parar = useCallback(
    async (exp) => {
      // Si el expediente ya tiene su cobro de entrevista (lo adoptó al abrirse
      // desde lo que ya había), parar no crea otro: el servidor lo dice igual.
      const yaCobrada = exp.dinero?.entrevista ?? null;
      const frase = yaCobrada
        ? `La entrevista ya tiene su cobro apuntado (${euros(yaCobrada.importe)}${yaCobrada.status === "pending" ? ", pendiente" : ""}): no nace otro.`
        : cobroEntrevista
          ? `Nace un cobro pendiente de ${euros(cobroEntrevista.importeEuros)} («${cobroEntrevista.texto}») para la familia, que aparecerá en Cobros.`
          : "Nace el cobro pendiente de la entrevista inicial para la familia.";
      const ok = await confirmar({
        titulo: `¿Parar el diagnóstico de ${exp.paciente?.nombre ?? "este paciente"}?`,
        texto: `${frase}\n\nEl expediente pasa a «No continúa» y no admite más citas. No se puede volver a «En curso»: si la familia cambia de idea, se abre otro diagnóstico.`,
        confirmar: "Parar el diagnóstico",
      });
      if (!ok) return;
      return llamar(exp, `/api/clinica/diagnosticos/${exp.id}/parar`, { method: "POST" }, async (d) => {
        await recargar?.();
        flash(
          d.cobro && !d.cobro.yaExistia
            ? `Diagnóstico parado · cobro pendiente de ${euros(d.cobro.importe)} apuntado en Cobros`
            : `Diagnóstico parado${d.avisos?.length ? ` · ${d.avisos.join(" ")}` : ""}`
        );
      });
    },
    [cobroEntrevista, confirmar, llamar, recargar, flash]
  );

  const seguir = useCallback(
    async (exp) => {
      // Lo que costará seguir en ESTE expediente, con la entrevista ya cobrada
      // descontada: lo calcula el servidor (decisión 15), aquí solo se lee.
      const cobro = exp.cobroAlSeguir ?? null;
      const importe = cobro?.importe ?? null;
      const descuento = Number(cobro?.descuento) || 0;
      let frase;
      if (importe === null) {
        frase = `Nace un bono DIAGNÓSTICO sin tope de sesiones para el paciente. No hay precio para «${exp.producto?.nombre}»: el bono nacerá sin cobro.`;
      } else if (importe === 0 && descuento > 0) {
        frase = `Nace un bono DIAGNÓSTICO sin tope de sesiones para el paciente. La entrevista inicial ya cobrada (${euros(descuento)}) cubre el precio de «${exp.producto?.nombre}»: el bono nacerá sin cobro.`;
      } else {
        const entrevista = descuento > 0 ? ` Va descontada la entrevista inicial ya cobrada (${euros(descuento)}).` : " La entrevista inicial va dentro de ese precio.";
        frase = `Nace un bono DIAGNÓSTICO sin tope de sesiones para el paciente y un cobro pendiente de ${euros(importe)}${cobro?.texto ? ` («${cobro.texto}»)` : ""}, que aparecerá en Cobros.${entrevista}`;
      }
      const ok = await confirmar({
        titulo: `¿Seguir con el diagnóstico de ${exp.paciente?.nombre ?? "este paciente"}?`,
        texto: `${frase}\n\nDesde entonces «Añadir horas» apunta citas contra ese bono hasta las ${formatoHoras(exp.horasMax)} h del producto.`,
        confirmar: "Seguir con el diagnóstico",
      });
      if (!ok) return;
      return llamar(exp, `/api/clinica/diagnosticos/${exp.id}/seguir`, { method: "POST" }, async (d) => {
        await recargar?.();
        flash(
          d.cobro
            ? `En curso · bono sin tope creado y cobro pendiente de ${euros(d.cobro.importe)} apuntado en Cobros${d.avisos?.length ? ` · ${d.avisos.join(" ")}` : ""}`
            : `En curso · bono sin tope creado${d.avisos?.length ? ` · ${d.avisos.join(" ")}` : ""}`
        );
      });
    },
    [confirmar, llamar, recargar, flash]
  );

  const desbloquear = useCallback(
    async (exp) => {
      const actual = Number(exp.horasMax) || 0;
      const texto = await pedirTexto({
        titulo: "Desbloquear horas",
        texto: `${exp.paciente?.nombre ?? "Este paciente"} tiene ${formatoHoras(actual)} h en su ${exp.producto?.nombre ?? "diagnóstico"}${exp.horas?.libres ? ` (${formatoHoras(exp.horas.libres)} libres)` : " y no le queda ninguna libre"}. ¿Hasta cuántas horas en total? Solo hacia arriba, de media en media y como mucho ${HORAS_MAX_TOPE}. Quedará apuntado quién lo hizo.`,
        valorInicial: String(actual + 5),
        placeholder: String(actual + 5),
        obligatorio: true,
        confirmar: "Desbloquear",
      });
      if (texto === null) return;
      const nuevo = Number(String(texto).replace(",", "."));
      const v = puedeDesbloquear(actual, nuevo);
      if (!v.ok) {
        await avisar({ titulo: "No se puede", texto: v.motivo });
        return;
      }
      return llamar(exp, `/api/clinica/diagnosticos/${exp.id}/horas`, { method: "POST", body: JSON.stringify({ horasMax: nuevo }) }, (d) => {
        reemplazar?.(d.expediente);
        flash(`Tope subido de ${formatoHoras(d.horasMax.antes)} a ${formatoHoras(d.horasMax.ahora)} h`);
      });
    },
    [pedirTexto, avisar, llamar, reemplazar, flash]
  );

  const cerrar = useCallback(
    async (exp) => {
      const avisos = [];
      if (exp.horas?.reservadas > 0) avisos.push(`Tiene ${formatoHoras(exp.horas.reservadas)} h de citas por delante en la agenda: seguirán ahí, pero el expediente no admitirá más.`);
      if (exp.horas?.libres > 0 && exp.status === "en_curso") avisos.push(`Quedan ${formatoHoras(exp.horas.libres)} h sin dar de las ${formatoHoras(exp.horasMax)}.`);
      if (exp.cobroPendiente) avisos.push(`Sigue habiendo ${euros(exp.cobroPendiente.importe)} sin cobrar: cerrar no lo retira de Cobros.`);
      const ok = await confirmar({
        titulo: `¿Cerrar el diagnóstico de ${exp.paciente?.nombre ?? "este paciente"}?`,
        texto: `${avisos.join(" ")}${avisos.length ? "\n\n" : ""}El expediente pasa a «Cerrado» y deja de salir en «En curso». El bono y el cobro no se tocan.`,
        confirmar: "Cerrar el diagnóstico",
      });
      if (!ok) return;
      return llamar(exp, `/api/clinica/diagnosticos/${exp.id}/cerrar`, { method: "POST" }, async (d) => {
        await recargar?.();
        flash(d.horasSinDar > 0 ? `Diagnóstico cerrado con ${formatoHoras(d.horasSinDar)} h sin dar` : "Diagnóstico cerrado");
      });
    },
    [confirmar, llamar, recargar, flash]
  );

  return {
    parar,
    seguir,
    desbloquear,
    cerrar,
    cambiarTerapeuta,
    ocupadoId,
    errorMsg,
    setErrorMsg,
    okMsg,
    flash,
    confirmar,
    avisar,
    dialogo,
  };
}
