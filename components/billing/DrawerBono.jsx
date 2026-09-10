"use client";

/**
 * DrawerBono — dar un bono (a uno o a un grupo) y corregirlo (10/09/2026,
 * submódulo Bonos).
 *
 * ── UN SOLO CAJÓN PARA LAS TRES COSAS ──────────────────────────────────────
 * Lo que se teclea es idéntico en los tres casos —tipo, sesiones, importe,
 * fecha, nota— y en tres formularios distintos acabaría divergiendo, que es
 * exactamente lo que pasó con los dos botones de alta de Cuotas. Lo único que
 * cambia es de dónde sale el destinatario:
 *
 *   · ALTA desde Bonos: se eligen destinatarios (uno u ocho) y el tipo.
 *   · ALTA desde un GRUPO (`tipoFijo`): el tipo ya está decidido —es el grupo
 *     en el que se está— y solo se elige a quién se le añade.
 *   · EDICIÓN (`bono`): el destinatario y el tipo están fijados; se corrige lo
 *     que se tecleó mal y, si la familia tiene varios pacientes, de quién es.
 *
 * Vive en `components/billing/` y no dentro de una página porque lo piden dos
 * (la lista de bonos y la ficha de un tipo), igual que pasó con
 * `SelectorDestinatarios` el 09/09/2026: dos cajones de alta que se comportan
 * distinto es una forma segura de dar bonos donde no tocan.
 *
 * Las reglas de negocio no están aquí: `lib/billing/bonos.js` dice qué se
 * valida y `lib/billing/cobroDelBono.js` cuándo nace la deuda.
 */

import { useEffect, useMemo, useState } from "react";

import Select from "../ui/Select.jsx";
import SelectorDestinatarios from "./SelectorDestinatarios.jsx";
import { eurosToCents, centsToEuros } from "../../lib/payments/money.js";
import { rotuloDelBono, parteDelCobro, SESIONES_MAX } from "../../lib/billing/bonos.js";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

/** Hoy en MADRID, no el día de UTC: a las 00:30 `toISOString` dice el de ayer. */
function hoyIso() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
}

export default function DrawerBono({
  tipos = [],
  bono = null,
  tipoNombre = null,
  tipoFijo = null,
  inicial = null,
  onClose,
  onDone,
}) {
  const editando = !!bono;
  const [eventTypeId, setEventTypeId] = useState(
    bono?.eventTypeId ?? tipoFijo?.id ?? inicial?.eventTypeId ?? ""
  );
  const [destinatarios, setDestinatarios] = useState([]);
  const [sesiones, setSesiones] = useState(
    bono ? String(bono.total) : tipoFijo ? String(Number(tipoFijo.sesionesDelTipo) || 1) : ""
  );
  const [importe, setImporte] = useState(
    bono?.amount
      ? centsToEuros(bono.amount)
      : Number.isInteger(tipoFijo?.precio) && tipoFijo.precio > 0
        ? centsToEuros(tipoFijo.precio)
        : ""
  );
  /*
   * SIN IMPORTE ES UNA DECISIÓN, NO UN DESPISTE (AV-0070, Rosa).
   *
   * El campo se llamaba «Importe cobrado» y se dejaba en blanco porque todavía
   * no se había cobrado; el resultado era un bono sin deuda en ninguna parte.
   * Ahora hay que poner lo que VALE, y quien de verdad lo regala lo dice
   * marcando esto.
   */
  const [sinImporte, setSinImporte] = useState(editando ? !bono?.amount : false);
  const [fecha, setFecha] = useState(bono?.compradoEl ? String(bono.compradoEl).slice(0, 10) : hoyIso());
  const [nota, setNota] = useState(bono?.notes ?? "");
  const [patientId, setPatientId] = useState(bono?.patientId ?? "");
  const [pacientesDeLaFamilia, setPacientesDeLaFamilia] = useState([]);
  const [permitirDuplicados, setPermitirDuplicados] = useState(false);

  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState(null);
  const [omitidos, setOmitidos] = useState([]);
  const [avisos, setAvisos] = useState([]);

  // El tipo elegido, con caída al fijo: la ficha de un grupo no carga el
  // catálogo entero para pintar el cajón de su propio bono.
  const tipo = useMemo(() => {
    const suyo = tipos.find((t) => String(t.id) === String(eventTypeId));
    if (suyo) return suyo;
    return tipoFijo && String(tipoFijo.id) === String(eventTypeId) ? tipoFijo : null;
  }, [tipos, tipoFijo, eventTypeId]);

  const nombreDelTipo = tipoNombre ?? tipo?.name ?? tipoFijo?.name ?? "";

  // Los hermanos, para poder decir de quién es el bono (AV-0055). Solo en la
  // edición: en el alta el paciente lo trae el selector de destinatarios.
  useEffect(() => {
    if (!editando || !bono?.clientId) return;
    let vivo = true;
    fetch(`/api/pacientes?clientId=${bono.clientId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo) setPacientesDeLaFamilia(j?.data?.patients ?? []); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [editando, bono?.clientId]);

  /** Al elegir el tipo se proponen SUS sesiones y SU precio. Se pueden cambiar:
   *  un acuerdo cerrado por teléfono no siempre es el paquete estándar. */
  function elegirTipo(id) {
    setEventTypeId(id);
    const t = tipos.find((x) => String(x.id) === String(id));
    if (!t) return;
    setSesiones(String(Number(t.sesionesDelTipo) || 1));
    if (Number.isInteger(t.precio) && t.precio > 0) {
      setImporte(centsToEuros(t.precio));
      setSinImporte(false);
    }
  }

  async function enviar(e) {
    e.preventDefault();
    setErr(null);
    setOmitidos([]);
    setAvisos([]);

    if (!eventTypeId) { setErr("Elige el tipo de bono"); return; }
    if (!editando && !destinatarios.length) { setErr("Elige a quién se le da el bono"); return; }
    const n = Number(sesiones);
    if (!Number.isInteger(n) || n < 1 || n > SESIONES_MAX) {
      setErr(`Las sesiones tienen que ser un número entre 1 y ${SESIONES_MAX}`);
      return;
    }
    if (!sinImporte && !(Number(String(importe).replace(",", ".")) > 0)) {
      setErr("Pon lo que vale el bono: es lo que hace que su cobro salga pendiente en Cobros. Si de verdad no se cobra, marca la casilla.");
      return;
    }

    const cuerpo = {
      eventTypeId,
      totalSessions: n,
      // A céntimos aquí y no en la API: es la unidad de `session_packs` y de
      // Stripe, y la conversión vive en el borde del formulario.
      amount: sinImporte ? null : eurosToCents(importe),
      purchasedAt: fecha || null,
      notes: nota.trim() || null,
    };

    setGuardando(true);
    try {
      const res = editando
        ? await fetch(`/api/billing/bonos/${bono.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            // En la edición el tipo no se toca (sería otro bono) y sí se puede
            // corregir de qué hijo de la familia es.
            body: JSON.stringify({
              totalSessions: cuerpo.totalSessions,
              amount: cuerpo.amount,
              purchasedAt: cuerpo.purchasedAt,
              notes: cuerpo.notes,
              patientId: patientId || null,
            }),
          })
        : await fetch("/api/billing/bonos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...cuerpo,
              destinatarios: destinatarios.map((d) => ({ clientId: d.clientId, patientId: d.patientId ?? null })),
              permitirDuplicados,
            }),
          });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "No se pudo guardar el bono");

      if (editando) {
        onDone(`Bono corregido${parteDelCobro(j.data?.cobro)}`);
        return;
      }

      const creados = Number(j.data?.creados ?? 0);
      const cobros = Number(j.data?.cobros ?? 0);
      const saltados = j.data?.omitidos ?? [];
      const mensaje = `${creados} ${creados === 1 ? "bono dado" : "bonos dados"}${
        cobros ? ` · ${cobros} ${cobros === 1 ? "cobro pendiente" : "cobros pendientes"} en Cobros` : " · sin importe: ningún cobro"
      }${saltados.length ? ` · ${saltados.length} saltado${saltados.length === 1 ? "" : "s"}` : ""}`;

      /*
       * Los saltados NO cierran el cajón (01/09/2026, la misma decisión que en
       * el alta de cuotas): «ya tiene uno vivo con 3 sesiones sin usar» es justo
       * lo que hay que leer antes de insistir, y con la casilla de abajo se
       * insiste sin volver a teclear nada.
       */
      if (saltados.length || (j.data?.avisos ?? []).length) {
        setOmitidos(saltados);
        setAvisos(creados ? [mensaje, ...(j.data?.avisos ?? [])] : (j.data?.avisos ?? []));
        return;
      }
      onDone(mensaje);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      {/* Capas y barra móvil, regla #13: fondo z-40, panel z-50 y `top-14
          lg:top-0` para no taparle la barra de arriba en el móvil. */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={() => !guardando && onClose()} />
      <aside className="fixed top-14 lg:top-0 right-0 bottom-0 w-full sm:w-[560px] bg-white z-50 shadow-pop overflow-y-auto ink-scroll slide-right">
        <form onSubmit={enviar} className="p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="eyebrow">{editando ? "Editar" : "Alta"}</div>
              <h2 className="font-display text-xl text-neutral-900 mt-1">
                {editando ? "Corregir el bono" : tipoFijo ? "Añadir al grupo" : "Nuevo bono"}
              </h2>
              {editando ? (
                <p className="text-xs text-neutral-400 mt-1">
                  {nombreDelTipo} · {bono.paciente || bono.familia} · {rotuloDelBono(bono)}
                </p>
              ) : (
                <p className="text-xs text-neutral-400 mt-1">
                  Dar el bono no es cobrarlo: su cobro nace <strong className="text-neutral-600">pendiente</strong> en
                  Cobros y se salda cuando el dinero entre.
                </p>
              )}
            </div>
            <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-700 text-sm">Cerrar</button>
          </div>

          {err && <div className="px-3 py-2 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{err}</div>}

          {avisos.length > 0 && (
            <div className="px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-800 space-y-1">
              {avisos.map((a, i) => <p key={i}>{a}</p>)}
            </div>
          )}

          {omitidos.length > 0 && (
            <div className="px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-lg text-xs text-neutral-600 space-y-1">
              <p className="font-semibold text-neutral-700">Estos se han saltado:</p>
              {omitidos.map((o, i) => (
                <p key={i}>· {o.nombre || "sin nombre"} — {o.motivo}</p>
              ))}
              <label className="flex items-center gap-1.5 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={permitirDuplicados}
                  onChange={(e) => setPermitirDuplicados(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-neutral-300 accent-[var(--color-primary,#1B3A2D)]"
                />
                Dárselo igual: quiero que tenga otro bono a la vez
              </label>
            </div>
          )}

          {!editando && (
            <SelectorDestinatarios
              valores={destinatarios}
              onChange={setDestinatarios}
              etiqueta="A quién se le da este bono *"
            />
          )}

          <div>
            <label className="block text-[11px] font-medium text-neutral-500 mb-1">Tipo de bono *</label>
            {editando || tipoFijo ? (
              <p className="text-sm text-neutral-700">
                {nombreDelTipo}
                {editando && (
                  <span className="block text-[11px] text-neutral-400 mt-0.5">
                    El tipo no se cambia: sería otro bono, con otras sesiones y otro precio, y las citas ya
                    enganchadas dejarían de cuadrar. Para eso, anúlalo y da uno nuevo.
                  </span>
                )}
              </p>
            ) : (
              <Select
                value={String(eventTypeId)}
                onChange={elegirTipo}
                options={tipos.map((t) => ({
                  value: String(t.id),
                  label: `${t.name}${(Number(t.sesionesDelTipo) || 1) > 1 ? ` · ${t.sesionesDelTipo} sesiones` : " · cita suelta"}${t.oculto ? " · oculto" : ""}`,
                }))}
                placeholder="Elige…"
                searchable
                className="w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200"
              />
            )}
          </div>

          {editando && pacientesDeLaFamilia.length > 1 && (
            <div>
              <label className="block text-[11px] font-medium text-neutral-500 mb-1">De quién es</label>
              <Select
                value={String(patientId)}
                onChange={setPatientId}
                options={[
                  { value: "", label: "De la familia (cualquiera de sus pacientes)" },
                  ...pacientesDeLaFamilia.map((p) => ({
                    value: String(p.id),
                    label: `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || "(sin nombre)",
                  })),
                ]}
                className="w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200"
              />
              <p className="text-[11px] text-neutral-400 mt-1">
                Con un paciente puesto, el bono solo se le descuenta a él. De la familia, se lo gasta el
                primero que pida cita — que es lo que hacía que el bono de un hermano se le fuera al otro.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-neutral-500 mb-1">Sesiones *</label>
              <input
                type="number" min="1" max={SESIONES_MAX}
                value={sesiones}
                onChange={(e) => setSesiones(e.target.value)}
                placeholder={tipo ? String(tipo.sesionesDelTipo ?? 1) : "10"}
                className={inputCls}
              />
              {editando && bono.gastadas > 0 && (
                <p className="text-[11px] text-neutral-400 mt-1">
                  Ya ha usado {bono.gastadas}: no se puede bajar de ahí.
                </p>
              )}
            </div>
            <div>
              <label className="block text-[11px] font-medium text-neutral-500 mb-1">Importe del bono *</label>
              <input
                value={importe}
                onChange={(e) => setImporte(e.target.value)}
                disabled={sinImporte}
                placeholder={tipo && Number.isInteger(tipo.precio) ? centsToEuros(tipo.precio) : "0,00"}
                className={`${inputCls} disabled:bg-neutral-50 disabled:text-neutral-400`}
              />
              <p className="text-[11px] text-neutral-400 mt-1">En euros. Es lo que vale, no lo que ya se ha cobrado.</p>
            </div>
          </div>

          <label className="flex items-center gap-1.5 text-xs text-neutral-600 cursor-pointer">
            <input
              type="checkbox"
              checked={sinImporte}
              onChange={(e) => setSinImporte(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-neutral-300 accent-[var(--color-primary,#1B3A2D)]"
            />
            Este bono no se cobra (regalado o ya facturado por otra vía)
          </label>

          <div>
            <label className="block text-[11px] font-medium text-neutral-500 mb-1">Fecha del bono</label>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputCls} />
            <p className="text-[11px] text-neutral-400 mt-1">
              La fecha con la que nace su cobro. Los bonos se dan con antelación: si el dinero entra otro
              día, eso se apunta al saldarlo en Cobros.
            </p>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-neutral-500 mb-1">Nota</label>
            <textarea
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              rows={2}
              placeholder="Lo que haya que recordar de este acuerdo..."
              className={inputCls}
            />
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button
              type="submit"
              disabled={guardando}
              className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-50"
              style={{ background: "var(--color-primary, #1B3A2D)" }}
            >
              {guardando
                ? "Guardando..."
                : editando
                  ? "Guardar"
                  : destinatarios.length > 1
                    ? `Dar ${destinatarios.length} bonos`
                    : "Dar el bono"}
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-semibold text-neutral-500 hover:text-neutral-800">
              Cancelar
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}
