"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import HelpTooltip from "../../../../components/ui/HelpTooltip.jsx";
import Select from "@/components/ui/Select.jsx";
import { fmtMoney, fmtDate } from "../_components/Kpi.jsx";
import { anchoPantalla } from "@/components/layout/anchoPantalla.js";

/**
 * /facturacion/banco — el extracto REAL del banco, dentro del CRM.
 *
 * La banca online española no da un enlace estable por movimiento, así que «un
 * botón del cobro al banco» solo puede ser esto: traerse los movimientos
 * (GoCardless, PSD2, solo lectura), casarlos con los cobros y gastos, y que el
 * botón de Cobros salte AQUÍ (?mov=<id>). Las credenciales viven en
 * Configuración → Conexiones; esta pantalla conecta cuentas, sincroniza y casa.
 */

const inputCls =
  "rounded-lg px-3 py-1.5 text-xs text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition";

const ESTADO_CUENTA = {
  linked: { texto: "Conectada", cls: "bg-emerald-50 text-emerald-700 border-emerald-100" },
  expired: { texto: "Consentimiento caducado", cls: "bg-amber-50 text-amber-700 border-amber-100" },
  suspended: { texto: "Suspendida", cls: "bg-red-50 text-red-700 border-red-100" },
};

export default function BancoModule() {
  const [me, setMe] = useState(null);
  const isAdmin = me?.role === "admin" || me?.role === "superadmin";

  const [estado, setEstado] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [okMsg, setOkMsg] = useState(null);
  const flash = (msg) => {
    setOkMsg(msg);
    setTimeout(() => setOkMsg(null), 4000);
  };

  // ── Extracto ──────────────────────────────────────────────────────────────
  const [movimientos, setMovimientos] = useState([]);
  const [totalMov, setTotalMov] = useState(0);
  const [page, setPage] = useState(1);
  const [cargando, setCargando] = useState(false);
  const [fEstado, setFEstado] = useState("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  // El botón «Banco» de Cobros llega con ?mov=<id>: se enseña ESE movimiento.
  const [movParam, setMovParam] = useState(null);

  const LIMIT = 100;

  useEffect(() => {
    const id = setTimeout(() => setQ(qInput.trim()), 300);
    return () => clearTimeout(id);
  }, [qInput]);

  const loadEstado = useCallback(async () => {
    try {
      const r = await fetch("/api/banco/estado", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo cargar el estado del banco");
      setEstado(j.data);
    } catch (e) {
      setErrorMsg(e.message);
    }
  }, []);

  const loadMovimientos = useCallback(async () => {
    setCargando(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (movParam) params.set("id", movParam);
      if (fEstado) params.set("estado", fEstado);
      if (q) params.set("q", q);
      const r = await fetch(`/api/banco/movimientos?${params}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo cargar el extracto");
      setMovimientos(j.data?.movimientos ?? []);
      setTotalMov(j.data?.total ?? 0);
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setCargando(false);
    }
  }, [page, fEstado, q, movParam]);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).then((j) => j.ok && setMe(j.data)).catch(() => {});
    loadEstado();
  }, [loadEstado]);

  useEffect(() => {
    loadMovimientos();
  }, [loadMovimientos]);

  // ── La vuelta del banco (?ref=) y el salto desde Cobros (?mov=) ───────────
  const [confirmando, setConfirmando] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mov = params.get("mov");
    if (mov) setMovParam(mov);

    const ref = params.get("ref");
    if (!ref) return;
    // GoCardless redirige aquí al terminar el consentimiento: se remata la
    // conexión y se limpia la URL para que un F5 no vuelva a confirmarla.
    setConfirmando(true);
    fetch("/api/banco/confirmar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) throw new Error(j.error || "No se pudo confirmar la conexión");
        const n = j.data?.cuentas?.length ?? 0;
        flash(n === 1 ? "Banco conectado: 1 cuenta" : `Banco conectado: ${n} cuentas`);
      })
      .catch((e) => setErrorMsg(e.message))
      .finally(() => {
        setConfirmando(false);
        const url = new URL(window.location.href);
        url.searchParams.delete("ref");
        window.history.replaceState(null, "", url);
        loadEstado();
      });
  }, [loadEstado]);

  // ── Conectar un banco ─────────────────────────────────────────────────────
  const [showConectar, setShowConectar] = useState(false);
  const [bancos, setBancos] = useState(null); // null = sin cargar
  const [buscaBanco, setBuscaBanco] = useState("");
  const [conectando, setConectando] = useState(null); // institutionId en curso

  async function abrirConectar() {
    setShowConectar(true);
    if (bancos) return;
    try {
      const r = await fetch("/api/banco/bancos", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo cargar la lista de bancos");
      setBancos(j.data?.bancos ?? []);
    } catch (e) {
      setErrorMsg(e.message);
      setShowConectar(false);
    }
  }

  async function conectar(banco) {
    setConectando(banco.id);
    setErrorMsg(null);
    try {
      const r = await fetch("/api/banco/conectar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          institutionId: banco.id,
          origen: window.location.origin,
          diasHistorico: banco.diasHistorico,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo abrir la conexión");
      // Al banco: el consentimiento se da ALLÍ, con sus claves. Volverá aquí
      // con ?ref=.
      window.location.href = j.data.link;
    } catch (e) {
      setErrorMsg(e.message);
      setConectando(null);
    }
  }

  const bancosFiltrados = useMemo(() => {
    if (!bancos) return [];
    const t = buscaBanco.trim().toLowerCase();
    if (!t) return bancos;
    return bancos.filter((b) => b.nombre.toLowerCase().includes(t));
  }, [bancos, buscaBanco]);

  // ── Sincronizar ───────────────────────────────────────────────────────────
  const [sincronizando, setSincronizando] = useState(false);
  async function sincronizar() {
    setSincronizando(true);
    setErrorMsg(null);
    try {
      const r = await fetch("/api/banco/sincronizar", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo sincronizar");
      const problemas = (j.data?.resultados ?? []).filter((x) => x.estado.startsWith("error"));
      flash(
        `${j.data?.totalNuevos ?? 0} movimiento(s) nuevo(s)` +
          (problemas.length ? ` · ${problemas.length} cuenta(s) con error` : "")
      );
      await Promise.all([loadEstado(), loadMovimientos()]);
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setSincronizando(false);
    }
  }

  // ── Casar / descasar ──────────────────────────────────────────────────────
  const [drawerMov, setDrawerMov] = useState(null);
  const [sugerencias, setSugerencias] = useState(null); // null = cargando
  const [casando, setCasando] = useState(false);

  async function abrirCasar(mov) {
    setDrawerMov(mov);
    setSugerencias(null);
    try {
      const r = await fetch(`/api/banco/sugerencias?movimiento=${mov.id}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudieron cargar las sugerencias");
      setSugerencias(j.data);
    } catch (e) {
      setErrorMsg(e.message);
      setSugerencias({ lado: mov.amount >= 0 ? "cobro" : "gasto", sugerencias: [] });
    }
  }

  async function casar(mov, tipo, id) {
    setCasando(true);
    setErrorMsg(null);
    try {
      const r = await fetch("/api/banco/casar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ movimiento: mov.id, tipo, id }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo casar");
      flash(j.data?.descuadre ? "Casado (con importes distintos: queda anotado)" : "Movimiento casado");
      setDrawerMov(null);
      await Promise.all([loadEstado(), loadMovimientos()]);
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setCasando(false);
    }
  }

  async function descasar(mov) {
    if (!window.confirm("¿Deshacer el casado de este movimiento? El cobro o gasto no se toca; solo se suelta el enlace.")) return;
    setErrorMsg(null);
    try {
      const r = await fetch("/api/banco/descasar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ movimiento: mov.id }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo descasar");
      flash("Movimiento descasado");
      await Promise.all([loadEstado(), loadMovimientos()]);
    } catch (e) {
      setErrorMsg(e.message);
    }
  }

  async function eliminarCuenta(cuenta) {
    if (
      !window.confirm(
        `¿Quitar la cuenta ${cuenta.iban || cuenta.institutionName || ""}? Se borra su extracto del CRM (reconectar lo vuelve a traer); los cobros y gastos se quedan, solo pierden el enlace.`
      )
    )
      return;
    setErrorMsg(null);
    try {
      const r = await fetch(`/api/banco/cuentas/${cuenta.id}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo quitar la cuenta");
      flash("Cuenta quitada");
      await Promise.all([loadEstado(), loadMovimientos()]);
    } catch (e) {
      setErrorMsg(e.message);
    }
  }

  const totalPaginas = Math.max(1, Math.ceil(totalMov / LIMIT));

  return (
    <div className={anchoPantalla("listado")}>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
        <div>
          <div className="eyebrow">Finanzas · Tesorería</div>
          <h1 className="font-display text-2xl text-[var(--ink-900)] mt-1 flex items-center gap-2">
            Banco
            <HelpTooltip title="El extracto real, dentro del CRM" placement="bottom">
              Los movimientos vienen del banco por PSD2 (GoCardless), en <strong className="text-white">solo lectura</strong>:
              el CRM puede mirarlos, nunca mover dinero. Casar un movimiento con su cobro o gasto es lo
              que enciende el botón «Banco» en la pantalla de Cobros. El consentimiento del banco dura
              90 días; cuando caduque, se reconecta desde aquí.
            </HelpTooltip>
          </h1>
          {estado && (
            <p className="text-xs text-neutral-400 mt-1">
              {estado.totalMovimientos} movimientos · <span className={estado.sinCasar ? "text-amber-600 font-semibold" : "text-emerald-700"}>{estado.sinCasar} sin casar</span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <Link href="/facturacion/cobros" className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">← Cobros</Link>
          {estado?.configured && estado.cuentas.length > 0 && (
            <button
              onClick={sincronizar}
              disabled={sincronizando}
              className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-50"
              style={{ background: "var(--color-primary, #1B3A2D)" }}
            >
              {sincronizando ? "Sincronizando..." : "Sincronizar"}
            </button>
          )}
        </div>
      </div>

      {errorMsg && <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">{errorMsg}</div>}
      {okMsg && <div className="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-lg text-xs text-emerald-700">{okMsg}</div>}
      {confirmando && <div className="mb-4 px-4 py-3 bg-neutral-50 border border-neutral-100 rounded-lg text-xs text-neutral-500">Confirmando la conexión con el banco...</div>}

      {!estado && !errorMsg && <div className="text-xs text-neutral-400">Cargando...</div>}

      {/* ── Sin credenciales: a Configuración ── */}
      {estado && !estado.configured && (
        <div className="bg-white border border-neutral-100 rounded-xl p-6">
          <h2 className="font-display text-lg text-[var(--ink-900)]">Conecta tu banco</h2>
          <p className="text-xs text-neutral-500 mt-2 max-w-2xl leading-relaxed">
            Para traer el extracto hacen falta las credenciales de GoCardless Bank Account Data (gratuitas,
            de solo lectura). Se pegan una sola vez en Configuración; después, desde aquí se elige el banco
            y se autoriza el acceso en su propia web — el CRM nunca ve tus claves del banco.
          </p>
          <Link
            href="/configuracion?zona=conexiones"
            className="inline-block mt-4 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white"
            style={{ background: "var(--color-primary, #1B3A2D)" }}
          >
            Ir a Configuración
          </Link>
        </div>
      )}

      {/* ── Cuentas conectadas ── */}
      {estado?.configured && (
        <div className="mb-4">
          <div className="flex flex-wrap gap-3">
            {estado.cuentas.map((c) => {
              const chip = ESTADO_CUENTA[c.status] ?? { texto: c.status, cls: "bg-neutral-100 text-neutral-600 border-neutral-200" };
              return (
                <div key={c.id} className="bg-white border border-neutral-100 rounded-xl px-4 py-3 flex items-start gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-neutral-800">{c.institutionName ?? "Banco"}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border ${chip.cls}`}>{chip.texto}</span>
                    </div>
                    <div className="text-[11px] text-neutral-500 font-mono mt-0.5">{c.iban ?? c.name ?? ""}</div>
                    <div className="text-[10px] text-neutral-400 mt-0.5">
                      {c.lastSyncedAt ? `Sincronizada ${fmtDate(c.lastSyncedAt)}` : "Sin sincronizar todavía"}
                    </div>
                    {c.lastSyncError && <div className="text-[10px] text-red-500 mt-0.5 max-w-xs">{c.lastSyncError}</div>}
                    {c.status === "expired" && isAdmin && (
                      <button onClick={abrirConectar} className="text-[11px] text-[var(--color-primary,#1B3A2D)] hover:underline mt-1">
                        Reconectar
                      </button>
                    )}
                  </div>
                  {isAdmin && (
                    <button
                      onClick={() => eliminarCuenta(c)}
                      title="Quitar esta cuenta"
                      className="text-neutral-300 hover:text-red-500 transition-colors text-sm leading-none mt-0.5"
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
            {isAdmin && (
              <button
                onClick={abrirConectar}
                className="border border-dashed border-neutral-300 rounded-xl px-4 py-3 text-xs text-neutral-500 hover:border-neutral-400 hover:text-neutral-700 transition"
              >
                {estado.cuentas.length ? "+ Conectar otro banco" : "+ Conectar tu banco"}
              </button>
            )}
            {!isAdmin && !estado.cuentas.length && (
              <div className="text-xs text-neutral-400">Todavía no hay ninguna cuenta conectada. Conectarla es cosa de un administrador.</div>
            )}
          </div>
        </div>
      )}

      {/* ── Filtros del extracto ── */}
      {estado?.configured && estado.cuentas.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {movParam ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-500">Enseñando el movimiento del cobro.</span>
              <button
                onClick={() => {
                  setMovParam(null);
                  const url = new URL(window.location.href);
                  url.searchParams.delete("mov");
                  window.history.replaceState(null, "", url);
                }}
                className="text-xs text-[var(--color-primary,#1B3A2D)] hover:underline"
              >
                Ver todo el extracto
              </button>
            </div>
          ) : (
            <>
              <input
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                placeholder="Buscar por concepto o quién paga..."
                className={inputCls + " w-full sm:w-72"}
              />
              <Select
                value={fEstado}
                onChange={(v) => {
                  setFEstado(v);
                  setPage(1);
                }}
                className={inputCls}
                options={[
                  { value: "", label: "Todos" },
                  { value: "sin_casar", label: "Sin casar" },
                  { value: "casados", label: "Casados" },
                ]}
              />
            </>
          )}
        </div>
      )}

      {/* ── Extracto ── */}
      {estado?.configured && (
        <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="border-b border-neutral-100 text-left text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Banco</th>
                  <th className="px-4 py-3">Concepto</th>
                  <th className="px-4 py-3 text-right">Importe</th>
                  <th className="px-4 py-3">Conciliación</th>
                </tr>
              </thead>
              <tbody>
                {cargando && movimientos.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-12 text-xs text-neutral-400">Cargando...</td></tr>
                )}
                {!cargando && movimientos.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center py-12 text-xs text-neutral-400">
                      {estado.cuentas.length === 0
                        ? "Conecta tu banco para traer el extracto."
                        : totalMov === 0 && !q && !fEstado
                          ? "Sin movimientos todavía: pulsa Sincronizar."
                          : "Sin movimientos que coincidan con los filtros."}
                    </td>
                  </tr>
                )}
                {movimientos.map((m) => (
                  <tr key={m.id} className={`border-b border-neutral-50 transition-colors ${movParam === m.id ? "bg-amber-50/60" : "hover:bg-neutral-50/70"}`}>
                    <td className="px-4 py-3 text-neutral-500 text-xs whitespace-nowrap">{fmtDate(m.bookingDate)}</td>
                    <td className="px-4 py-3 text-neutral-500 text-xs">{m.account?.institutionName ?? "—"}</td>
                    <td className="px-4 py-3 text-xs">
                      <div className="text-neutral-800">{m.counterparty ?? "—"}</div>
                      {m.concept && <div className="text-neutral-400 text-[11px] max-w-md truncate" title={m.concept}>{m.concept}</div>}
                    </td>
                    <td className={`px-4 py-3 text-right font-semibold tabular whitespace-nowrap ${m.amount < 0 ? "text-red-600" : "text-emerald-700"}`}>
                      {m.amount > 0 ? "+" : ""}{fmtMoney(m.amount)}
                    </td>
                    <td className="px-4 py-3">
                      {m.casadoCon ? (
                        <div className="flex items-center gap-2">
                          {m.casadoCon.tipo === "cobro" ? (
                            <Link
                              href="/facturacion/cobros"
                              className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 hover:bg-emerald-100 transition-colors"
                              title={`Cobro de ${fmtMoney(m.casadoCon.importe)} (${fmtDate(m.casadoCon.fecha)})`}
                            >
                              Cobro · {m.casadoCon.texto}
                            </Link>
                          ) : (
                            <Link
                              href="/facturacion/costes"
                              className="text-[11px] px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-100 hover:bg-sky-100 transition-colors"
                              title={`Gasto de ${fmtMoney(m.casadoCon.importe)} (${fmtDate(m.casadoCon.fecha)})`}
                            >
                              Gasto · {m.casadoCon.texto}
                            </Link>
                          )}
                          <button onClick={() => descasar(m)} className="text-[11px] text-neutral-400 hover:text-red-500 transition-colors" title="Deshacer el casado">
                            deshacer
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => abrirCasar(m)}
                          className="text-[11px] px-2.5 py-1 rounded-lg border border-neutral-200 text-neutral-600 hover:border-neutral-400 transition"
                        >
                          Casar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!movParam && totalPaginas > 1 && (
            <div className="px-4 py-2.5 border-t border-neutral-100 flex items-center justify-between text-xs text-neutral-500">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="disabled:opacity-30 hover:text-neutral-800">← Anteriores</button>
              <span>Página {page} de {totalPaginas}</span>
              <button disabled={page >= totalPaginas} onClick={() => setPage((p) => p + 1)} className="disabled:opacity-30 hover:text-neutral-800">Siguientes →</button>
            </div>
          )}
        </div>
      )}

      {/* ── DRAWER: elegir banco ── */}
      {showConectar && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setShowConectar(false)} />
          <aside className="fixed top-14 lg:top-0 right-0 bottom-0 w-full sm:w-[480px] bg-white z-50 shadow-pop overflow-y-auto ink-scroll slide-right">
            <div className="px-6 pt-6 pb-4 border-b border-neutral-100 flex items-start justify-between gap-3">
              <div>
                <div className="eyebrow">Conectar</div>
                <h2 className="font-display text-xl text-neutral-900 mt-1">Elige tu banco</h2>
                <p className="text-[11px] text-neutral-400 mt-1 leading-relaxed">
                  Te llevará a la web de tu banco para autorizar el acceso de SOLO LECTURA a los
                  movimientos. Dura 90 días; después se reconecta desde aquí.
                </p>
              </div>
              <button onClick={() => setShowConectar(false)} className="text-neutral-300 hover:text-neutral-700 transition-colors p-1">✕</button>
            </div>
            <div className="px-6 py-4">
              <input
                autoFocus
                value={buscaBanco}
                onChange={(e) => setBuscaBanco(e.target.value)}
                placeholder="Busca tu banco (BBVA, CaixaBank...)"
                className={inputCls + " w-full mb-3"}
              />
              {!bancos && <div className="text-xs text-neutral-400 py-6 text-center">Cargando bancos...</div>}
              {bancos && bancosFiltrados.length === 0 && (
                <div className="text-xs text-neutral-400 py-6 text-center">Ningún banco coincide.</div>
              )}
              <ul className="divide-y divide-neutral-50">
                {bancosFiltrados.map((b) => (
                  <li key={b.id}>
                    <button
                      onClick={() => conectar(b)}
                      disabled={!!conectando}
                      className="w-full flex items-center gap-3 px-2 py-2.5 text-left hover:bg-neutral-50 rounded-lg transition disabled:opacity-50"
                    >
                      {b.logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={b.logo} alt="" className="w-6 h-6 rounded object-contain shrink-0" />
                      ) : (
                        <span className="w-6 h-6 rounded bg-neutral-100 shrink-0" />
                      )}
                      <span className="text-sm text-neutral-800 min-w-0 truncate">{b.nombre}</span>
                      {conectando === b.id && <span className="ml-auto text-[11px] text-neutral-400">Abriendo...</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </>
      )}

      {/* ── DRAWER: casar un movimiento ── */}
      {drawerMov && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => !casando && setDrawerMov(null)} />
          <aside className="fixed top-14 lg:top-0 right-0 bottom-0 w-full sm:w-[480px] bg-white z-50 shadow-pop overflow-y-auto ink-scroll slide-right">
            <div className="px-6 pt-6 pb-4 border-b border-neutral-100 flex items-start justify-between gap-3">
              <div>
                <div className="eyebrow">Conciliar</div>
                <h2 className="font-display text-xl text-neutral-900 mt-1">
                  {drawerMov.amount >= 0 ? "¿De qué cobro es este ingreso?" : "¿De qué gasto es este cargo?"}
                </h2>
                <p className="text-[11px] text-neutral-400 mt-1">
                  {fmtDate(drawerMov.bookingDate)} · <span className={drawerMov.amount < 0 ? "text-red-600" : "text-emerald-700"}>{drawerMov.amount > 0 ? "+" : ""}{fmtMoney(drawerMov.amount)}</span>
                  {drawerMov.counterparty ? ` · ${drawerMov.counterparty}` : ""}
                </p>
                {drawerMov.concept && <p className="text-[11px] text-neutral-400 mt-0.5 max-w-sm">{drawerMov.concept}</p>}
              </div>
              <button onClick={() => setDrawerMov(null)} className="text-neutral-300 hover:text-neutral-700 transition-colors p-1">✕</button>
            </div>
            <div className="px-6 py-4">
              {sugerencias === null && <div className="text-xs text-neutral-400 py-6 text-center">Buscando candidatos...</div>}
              {sugerencias && sugerencias.sugerencias.length === 0 && (
                <div className="text-xs text-neutral-500 py-4 leading-relaxed">
                  No hay ningún {sugerencias.lado} sin casar con ese importe exacto a menos de 10 días.
                  {sugerencias.lado === "cobro" ? (
                    <> Si el cobro aún no está registrado, apúntalo primero en <Link href="/facturacion/cobros" className="text-[var(--color-primary,#1B3A2D)] hover:underline">Cobros</Link> y vuelve.</>
                  ) : (
                    <> Si el gasto aún no está registrado, apúntalo primero en <Link href="/facturacion/costes" className="text-[var(--color-primary,#1B3A2D)] hover:underline">Gastos</Link> y vuelve.</>
                  )}
                </div>
              )}
              {sugerencias && sugerencias.sugerencias.length > 0 && (
                <ul className="space-y-2">
                  {sugerencias.sugerencias.map((s) => (
                    <li key={s.id} className="border border-neutral-100 rounded-lg px-3 py-2.5 flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-neutral-800 truncate">{s.etiqueta}</div>
                        <div className="text-[11px] text-neutral-400">
                          {fmtDate(s.fecha)} · {fmtMoney(s.importe)}
                          {s.nombreCoincide && <span className="text-emerald-600 ml-1">· el nombre coincide</span>}
                        </div>
                      </div>
                      <button
                        onClick={() => casar(drawerMov, sugerencias.lado, s.id)}
                        disabled={casando}
                        className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-50"
                        style={{ background: "var(--color-primary, #1B3A2D)" }}
                      >
                        {casando ? "..." : "Casar"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
