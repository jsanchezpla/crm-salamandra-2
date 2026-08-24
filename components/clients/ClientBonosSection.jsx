"use client";

/**
 * ClientBonosSection — «Bonos de sesiones» de la ficha.
 *
 * ── DE DÓNDE VIENE (13/08/2026, Rodrigo) ────────────────────────────────────
 * Esto vivía dentro de `modules/overrides/nutri-laura/ClientDetailModule.jsx`,
 * o sea que el único sitio del CRM donde se podía DAR un bono era la ficha de
 * Laura. El resto del motor siempre fue universal —la tabla `session_packs`, el
 * endpoint, el descuento de sesiones y, desde hoy, el tipo de cita que se pone
 * solo en el alta manual—, pero sin pantalla no había forma de estrenarlo:
 * «todo el mundo tiene bonos, solo tienen que ponerlos» y no tenían dónde.
 * Ahora la sección es un componente compartido y sale en CUALQUIER ficha de un
 * cliente con `citas`.
 *
 * ── QUÉ RESUELVE UN BONO ────────────────────────────────────────────────────
 * Los cobros que NO pasan por la pasarela: transferencia, Bizum, efectivo. Se
 * cobra fuera, aquí se abre el bono, y a partir de ahí sus citas de ese tipo
 * van descontando y —si el centro tiene área privada— puede pedirlas solo,
 * aunque el tipo esté oculto para todos los demás.
 *
 * ── LO QUE DECIDE ESTA PANTALLA ─────────────────────────────────────────────
 * · **Se pinta solo si el centro tiene Citas** (403/404 en `event-types` = no
 *   lo tiene), como `ClientCitasSection`: un bono sin agenda no gobierna nada.
 * · **Dar y quitar son de admin**, igual que el endpoint (`POST /api/citas/
 *   packs` responde 403 a los demás). Quien no lo sea ve los bonos y su cuenta,
 *   que es lo que necesita para atender, pero no los botones: enseñar un botón
 *   que siempre falla es peor que no enseñarlo.
 * · **Lo primero es cuántas le quedan**, y las reservadas se dicen aparte: están
 *   puestas en la agenda pero todavía se pueden cancelar a tiempo.
 * · La tarjeta se pinta aunque no haya ningún bono —ahí está el botón de darlo—,
 *   al revés que antes en la ficha de Laura, donde sin bonos no salía nada.
 */

import { useCallback, useEffect, useState } from "react";

import { useDialogo } from "../ui/Dialogo.jsx";
import { eurosToCents } from "../../lib/payments/money.js";

const ADMIN_ROLES = ["admin", "superadmin"];

export default function ClientBonosSection({ clientId, onCambio }) {
  const [disponible, setDisponible] = useState(false); // ¿este centro tiene Citas?
  const [esAdmin, setEsAdmin] = useState(false);
  const [cliente, setCliente] = useState(null);
  const [bonos, setBonos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [abierto, setAbierto] = useState(false);
  const [quitando, setQuitando] = useState(null);
  const [falloQuitar, setFalloQuitar] = useState(null);
  const { confirmar, dialogo } = useDialogo();

  const cargar = useCallback(() => {
    let vivo = true;
    Promise.all([
      // 403/404 = este centro no tiene Citas. Mismo criterio que ClientCitasSection.
      fetch("/api/citas/event-types?active=true", { cache: "no-store" }).then((r) => r.ok),
      fetch(`/api/clients/${clientId}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      fetch("/api/auth/me", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
      .then(([hayCitas, ficha, yo]) => {
        if (!vivo) return;
        setDisponible(hayCitas);
        setCliente(ficha?.data ?? null);
        setBonos(Array.isArray(ficha?.data?.bonos) ? ficha.data.bonos : []);
        setEsAdmin(ADMIN_ROLES.includes(yo?.data?.role));
      })
      .catch(() => {})
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [clientId]);

  useEffect(() => cargar(), [cargar]);

  function recargar() {
    cargar();
    onCambio?.();
  }

  /*
   * Quitarle el bono (06/08/2026, Rodrigo). Por dentro se ANULA, no se borra:
   * la fila se queda con lo que se cobró, quién lo dio y cuándo, y las sesiones
   * que ya se dieron conservan su número. Borrarla dejaría sesiones numeradas
   * colgando de un bono que nadie recuerda.
   *
   * De cara a quien atiende da igual: deja de contar, desaparece de aquí y esa
   * persona vuelve a dejar de ver ese tipo de cita en la agenda.
   */
  async function quitar(b) {
    const quedan = b.restantes > 0 ? `Le quedan ${b.restantes} sesión(es) sin usar.\n\n` : "";
    const seguro = await confirmar({
      titulo: `Quitar el bono «${b.nombre}»`,
      texto: `${quedan}Dejará de poder reservar con él. Las citas que ya tenga puestas no se tocan.`,
      confirmar: "Quitarlo",
      tono: "peligro",
    });
    if (!seguro) return;
    setQuitando(b.id);
    setFalloQuitar(null);
    try {
      const res = await fetch(`/api/citas/packs/${b.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "anulado" }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error || "No se ha podido quitar el bono");
      recargar();
    } catch (e) {
      setFalloQuitar(e.message);
    }
    setQuitando(null);
  }

  if (cargando || !disponible) return null;

  // Los anulados no se enseñan: dejaron de contar y su rastro vive en la
  // auditoría, no en la ficha.
  const lista = bonos.filter((b) => b.estado !== "anulado");

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden mt-6">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-gray-700">Bonos de sesiones</span>
        {esAdmin && (
          <button
            type="button"
            onClick={() => setAbierto((v) => !v)}
            className="text-xs font-semibold text-[var(--color-primary)] hover:underline shrink-0"
          >
            {abierto ? "Cancelar" : "Dar un bono"}
          </button>
        )}
      </div>

      {abierto && (
        <DarBonoForm
          cliente={cliente}
          onHecho={() => { setAbierto(false); recargar(); }}
        />
      )}

      {lista.length === 0 && !abierto && (
        <p className="px-5 py-4 text-[11px] text-gray-400">
          {esAdmin ? (
            <>
              Todavía no tiene ningún bono. Dale uno cuando te pague por fuera de la pasarela
              (transferencia, Bizum, efectivo): a partir de ahí sus citas de ese tipo van descontando
              del bono, y en el alta manual el tipo de cita se pone solo al elegirle.
            </>
          ) : (
            <>Todavía no tiene ningún bono.</>
          )}
        </p>
      )}

      {falloQuitar && <p className="px-5 pt-3 text-[11px] text-red-600">{falloQuitar}</p>}

      <div className={lista.length ? "p-5 space-y-4" : "hidden"}>
        {lista.map((b) => (
          <div key={b.id}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-gray-800">{b.nombre}</span>
              <span
                className={`text-sm font-semibold ${b.restantes > 0 ? "text-[var(--color-primary)]" : "text-gray-400"}`}
              >
                {b.restantes > 0 ? `Le quedan ${b.restantes}` : "Agotado"}
              </span>
            </div>
            <div className="text-[11px] text-gray-500 mt-0.5 flex items-baseline justify-between gap-3">
              <span>
                {b.resumen}
                {b.modoPago === "instalment" && " · pago fraccionado"}
              </span>
              {esAdmin && (
                <button
                  type="button"
                  onClick={() => quitar(b)}
                  disabled={quitando === b.id}
                  title="Deja de contar y esa persona deja de ver ese tipo de cita. Queda registrado que se le dio."
                  className="text-[11px] text-gray-400 hover:text-red-600 hover:underline shrink-0 disabled:opacity-50"
                >
                  {quitando === b.id ? "Quitando…" : "Quitar bono"}
                </button>
              )}
            </div>
            {/* Barra de progreso: gastadas + reservadas sobre el total. */}
            <div className="mt-2 h-1.5 rounded-full bg-gray-100 overflow-hidden flex">
              <div
                className="bg-[var(--color-primary)]"
                style={{ width: `${b.total ? (b.gastadas / b.total) * 100 : 0}%` }}
              />
              <div
                className="bg-[var(--color-primary)] opacity-40"
                style={{ width: `${b.total ? (b.reservadas / b.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {dialogo}
    </div>
  );
}

/**
 * Dar un bono a mano (05/08/2026).
 *
 * El importe es opcional y NO se comprueba contra el precio del tipo de cita:
 * un acuerdo cerrado por WhatsApp puede ser otro, y bloquear el alta por un
 * descuadre de 10 € obligaría a mentir en el formulario.
 *
 * ⚠️ **El bono va atado al CORREO.** Es como lo encuentra todo lo demás: el
 * portal para enseñarle su tipo de cita, y el alta manual para descontar la
 * sesión. Sin correo en la ficha no se puede dar, y por eso el formulario lo
 * dice y no deja enviar en vez de dejar que el servidor conteste un 422.
 */
function DarBonoForm({ cliente, onHecho }) {
  const [tipos, setTipos] = useState([]);
  const [eventTypeId, setEventTypeId] = useState("");
  const [sesiones, setSesiones] = useState("");
  const [importe, setImporte] = useState("");
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState(null);
  const [avisos, setAvisos] = useState([]);

  useEffect(() => {
    let vivo = true;
    fetch("/api/citas/event-types?active=true", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (vivo && j.ok) setTipos(j.data ?? []); })
      .catch(() => { if (vivo) setErr("No se pudieron cargar los tipos de cita"); });
    return () => { vivo = false; };
  }, []);

  // Al elegir el tipo, se propone su número de sesiones. Se puede cambiar: no
  // todos los acuerdos son el paquete estándar.
  function elegirTipo(id) {
    setEventTypeId(id);
    const t = tipos.find((x) => x.id === id);
    setSesiones(String(t?.sessionsCount ?? 1));
  }

  const correo = cliente?.portalEmail || cliente?.email || "";

  async function guardar(e) {
    e.preventDefault();
    setErr(null);
    setAvisos([]);
    if (!eventTypeId) { setErr("Elige el tipo de cita"); return; }
    if (!correo) { setErr("Esta ficha no tiene correo, y el bono va atado a uno"); return; }

    setGuardando(true);
    try {
      const res = await fetch("/api/citas/packs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: cliente?.id ?? null,
          clientEmail: correo,
          eventTypeId,
          totalSessions: Number(sesiones) || 1,
          amount: importe === "" ? null : eurosToCents(importe),
          notes: nota.trim() || null,
        }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error || "No se pudo dar el bono");
      // Los avisos no bloquean: el bono ya está dado. Se enseñan un momento por
      // si algo no encaja (tipo a la vista de todos, sesiones de más).
      if (j?.data?.avisos?.length) {
        setAvisos(j.data.avisos);
        setTimeout(() => onHecho?.(), 3500);
      } else {
        onHecho?.();
      }
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setGuardando(false);
    }
  }

  const inputCls =
    "w-full text-xs border border-gray-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]";

  return (
    <form onSubmit={guardar} className="px-5 py-4 bg-gray-50/70 border-b border-gray-100 space-y-3">
      {correo ? (
        <p className="text-[11px] text-gray-500">
          El bono se le da al correo <strong className="text-gray-700">{correo}</strong>, que es con el
          que entra en su área privada y con el que se le descuentan las sesiones.
        </p>
      ) : (
        <p className="text-[11px] text-red-600">
          Esta ficha no tiene correo. El bono va atado a uno —es como se le encuentra al descontar la
          sesión—, así que ponle antes el correo en sus datos.
        </p>
      )}

      <div>
        <label className="block text-[11px] font-medium text-gray-500 mb-1">Tipo de cita</label>
        <select value={eventTypeId} onChange={(e) => elegirTipo(e.target.value)} className={inputCls}>
          <option value="">Elige…</option>
          {tipos.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}{t.isHidden ? " · oculto" : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Sesiones</label>
          <input
            type="number" min={1} max={200}
            value={sesiones}
            onChange={(e) => setSesiones(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Importe cobrado (€)</label>
          <input
            type="number" step="0.01" min={0}
            value={importe}
            onChange={(e) => setImporte(e.target.value)}
            placeholder="Opcional"
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label className="block text-[11px] font-medium text-gray-500 mb-1">Nota</label>
        <input
          type="text"
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder="Transferencia recibida el 3/8"
          className={inputCls}
        />
      </div>

      {err && <p className="text-[11px] text-red-600">{err}</p>}
      {avisos.map((a, i) => (
        <p key={i} className="text-[11px] text-amber-700">⚠ {a}</p>
      ))}

      <button
        type="submit"
        disabled={guardando || !correo}
        className="w-full bg-[var(--color-primary)] text-white text-xs font-semibold py-2 rounded-md disabled:opacity-50"
      >
        {guardando ? "Dando el bono…" : "Dar el bono"}
      </button>
    </form>
  );
}
