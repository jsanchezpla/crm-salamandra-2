"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * ClientCuentaWebSection — «Acceso a la web» desde la ficha del cliente.
 *
 * QUÉ RESUELVE (05/08/2026, Rodrigo): quien llega por el formulario de la web
 * ya sale con cuenta, porque aceptar su solicitud crea la ficha Y el usuario de
 * WordPress. Pero quien escribe por Instagram, o a quien se da de alta a mano en
 * el mostrador, se quedaba solo con la ficha: sin poder entrar a su área
 * privada, y por tanto sin ver sus citas ni poder usar un bono. Esto es ese
 * mismo paso, a un botón.
 *
 * NO VIAJA NINGUNA CONTRASEÑA: WordPress crea el usuario y le manda a la persona
 * un enlace con caducidad para que elija la suya.
 *
 * ── ERA SOLO DE nutri_laura, Y NO TENÍA POR QUÉ (12/08/2026, Rodrigo) ───────
 * Nació dentro de `modules/overrides/nutri-laura/ClientDetailModule.jsx`, así
 * que el resto de clientes —Aumenta incluida, que usa la ficha por defecto— no
 * tenía forma de abrirle la cuenta a nadie desde el CRM. El backend siempre fue
 * común (`/api/clients/[id]/portal-user` + `lib/formularios/portalUser.js`); lo
 * único que faltaba era el botón. Al sacarlo aquí lo comparten la ficha por
 * defecto y el override, que es como debe ser: si mañana cambia la forma de dar
 * de alta, cambia para los dos.
 *
 * ── SE ESCONDE SOLA ────────────────────────────────────────────────────────
 * La tarjeta desaparece —no se pinta vacía ni con un error— cuando:
 *   · quien mira no es admin (el endpoint responde 403; crear cuentas en un
 *     WordPress ajeno no es cosa de cualquiera), o
 *   · el centro no tiene web configurada (`motivo: "sin_url"`), y entonces no
 *     hay ningún sitio donde crear nada.
 * Lo que NO la esconde es que la web no conteste: eso es «no he podido
 * preguntar», que es distinto de «no tiene cuenta» y se dice tal cual.
 */
export default function ClientCuentaWebSection({ clientId, className = "mt-6 max-w-5xl" }) {
  const [oculto, setOculto] = useState(false);
  const [estado, setEstado] = useState(null); // { ok, mensaje } del último intento
  const [creando, setCreando] = useState(false);
  // null = todavía preguntando. Después: { ok, existe, motivo, email }
  const [tieneCuenta, setTieneCuenta] = useState(null);

  const comprobar = useCallback(async () => {
    if (!clientId) return;
    setTieneCuenta(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/portal-user`, { cache: "no-store" });
      if (r.status === 403) { setOculto(true); return; }
      const j = await r.json();
      const datos = j?.data ?? { ok: false, motivo: "red" };
      if (datos.motivo === "sin_url") { setOculto(true); return; }
      setTieneCuenta(datos);
    } catch {
      setTieneCuenta({ ok: false, motivo: "red" });
    }
  }, [clientId]);

  useEffect(() => { comprobar(); }, [comprobar]);

  async function crear() {
    setEstado(null);
    setCreando(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/portal-user`, { method: "POST" });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error || "No se pudo crear la cuenta");
      setEstado({ ok: !!j?.data?.ok, mensaje: j?.data?.mensaje || "Hecho." });
      comprobar(); // el distintivo tiene que reflejar lo que acaba de pasar
    } catch (e) {
      setEstado({ ok: false, mensaje: e.message });
    } finally {
      setCreando(false);
    }
  }

  if (oculto) return null;

  const correo = tieneCuenta?.email ?? "";
  const sinCorreo = tieneCuenta?.motivo === "sin_email";

  return (
    // `className` por defecto = la separación y el ancho del resto de tarjetas
    // de la ficha. La ficha de nutri_laura la pinta dentro de una columna que
    // ya reparte el espacio, y ahí pasa "".
    <div className={`bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden ${className}`}>
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
        <span className="text-[13px] font-semibold text-gray-700">Acceso a la web</span>
        <EstadoCuentaWeb estado={tieneCuenta} />
      </div>
      <div className="p-5 space-y-3">
        <p className="text-[11px] text-gray-500 leading-relaxed">
          Con cuenta en la web puede entrar a su área privada, ver sus citas y reservar solo. Se
          comprueba con el correo <strong className="text-gray-700">{correo || "—"}</strong>, que es
          el de su ficha: si entra en la web con otro distinto, su bono no le funcionará y sus citas
          no se enlazarán con esta ficha.
        </p>

        {sinCorreo && (
          <p className="text-[11px] text-amber-700">
            ⚠ Esta ficha no tiene correo, así que no se le puede crear la cuenta.
          </p>
        )}

        {tieneCuenta?.ok && tieneCuenta.existe === false && (
          <p className="text-[11px] text-amber-700">
            ⚠ No hay ninguna cuenta con este correo. O es nueva y hay que creársela, o el correo de
            la ficha no es el que usa.
          </p>
        )}

        <button
          type="button"
          onClick={crear}
          disabled={creando || sinCorreo}
          className="w-full bg-white border border-[var(--color-primary)] text-[var(--color-primary)] text-xs font-semibold py-2 rounded-md disabled:opacity-40 hover:bg-gray-50"
        >
          {creando ? "Creando…" : "Crear cuenta en la web"}
        </button>

        {estado && (
          <p className={`text-[11px] ${estado.ok ? "text-emerald-700" : "text-amber-700"}`}>
            {estado.ok ? "✓" : "⚠"} {estado.mensaje}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * El distintivo de «¿tiene cuenta con este correo?».
 *
 * TRES estados, no dos, y la diferencia importa: «no la tiene» es un aviso
 * accionable; «no he podido preguntar» —la web no responde, o todavía tiene un
 * theme sin la consulta— no lo es, y pintarlo igual sería mentir en rojo.
 */
function EstadoCuentaWeb({ estado }) {
  if (estado === null) {
    return <span className="text-[10px] text-gray-400">comprobando…</span>;
  }
  if (!estado.ok) {
    const texto =
      estado.motivo === "sin_email"
        ? "sin correo en la ficha"
        : estado.motivo === "sin_soporte"
          ? "la web aún no responde a esta consulta"
          : "no se ha podido comprobar";
    return <span className="text-[10px] text-gray-400" title={estado.motivo}>{texto}</span>;
  }
  return estado.existe ? (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
      ✓ tiene cuenta
    </span>
  ) : (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
      sin cuenta
    </span>
  );
}
