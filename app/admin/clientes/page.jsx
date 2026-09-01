"use client";

// La MISMA regla del servidor para el correo de la cuenta.
import { esCorreo as pareceCorreo } from "@/lib/auth/correoCuenta.js";

import { useCallback, useEffect, useMemo, useState } from "react";
import CredentialsModal from "@/components/team/CredentialsModal.jsx";
import { MAX_ANCHO_PANEL } from "@/components/admin/anchoPanel.js";

/**
 * Alta de clientes — el panel interno de Salamandra Solutions.
 *
 * Dar de alta un cliente costaba horas de trabajo artesanal (clonar un seed de
 * 400 líneas, un script por módulo, otro para la marca...). Aquí es un
 * formulario: nombre, identificador, módulos, marca opcional y datos fiscales.
 *
 * Vivía en el CRM de clientes (/alta-clientes) y se movió al back-office
 * (2026-07-28). El motivo no es estético: dar de alta un cliente no es una tarea
 * DE un cliente, y tenerlo en el mismo sitio donde se atiende a Aumenta o a
 * Laura invitaba a confundir el contexto. Ahora vive detrás del subdominio, con
 * su puerta de nginx delante.
 *
 * Sigue protegido por el módulo `provisioning`, que solo tiene nuestro tenant:
 * el subdominio reduce superficie, no autoriza.
 *
 * Sobre el aspecto: el back-office es oscuro, pero un FORMULARIO largo se lee
 * mejor sobre claro. Chrome oscuro, superficie de trabajo clara.
 */

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

/* ══════════════════════════════════════════════════════════════════════════
 * DEPENDENCIAS ENTRE MÓDULOS — la misma regla que el servidor
 *
 * Las REGLAS no están aquí: vienen pegadas a cada módulo del catálogo, en
 * `m.exige`, calculadas en `lib/provisioning/dependencias.js`. Lo que hay aquí
 * es solo el algoritmo que las aplica, para poder decir lo que pasa ANTES de
 * pulsar en vez de después de un 422. Copiar las reglas al navegador sería
 * garantizar que se desincronizan la primera vez que alguien toque la matriz.
 *
 * El servidor lo vuelve a comprobar SIEMPRE. Esto es comodidad, no seguridad.
 * ════════════════════════════════════════════════════════════════════════ */

const cumpleDep = (dep, tiene) =>
  dep.cualquiera ? dep.claves.some((k) => tiene.has(k)) : dep.claves.every((k) => tiene.has(k));

/** Lo que no se sostiene de una selección. No la arregla: solo lo dice. */
function validarSeleccion(seleccion, exige, orden) {
  const problemas = seleccion.flatMap((k) => faltaPara(k, seleccion, exige));
  return { modulos: orden.filter((k) => seleccion.includes(k)), problemas };
}

/**
 * Qué habría que añadir para poder marcar `clave`, en cascada. Alimenta el botón
 * «añadir también …»; NO se aplica sola.
 *
 * Sin él, marcar Clínica obligaría a ir hacia atrás —Pacientes, luego Clientes,
 * luego ya sí Clínica—, que es tres mensajes de error para llegar a lo mismo.
 * Con él es un clic, y las tres casillas quedan marcadas a la vista.
 */
function cadenaPara(clave, seleccion, exige, orden) {
  const dentro = new Set([...seleccion, clave]);
  const pend = [clave];
  while (pend.length) {
    const k = pend.pop();
    for (const dep of exige[k] ?? []) {
      if (dep.cualquiera) continue; // eso lo decide una persona
      for (const n of dep.claves) if (!dentro.has(n)) { dentro.add(n); pend.push(n); }
    }
  }
  const modulos = orden.filter((k) => dentro.has(k));
  return {
    modulos,
    anadidos: modulos.filter((k) => !seleccion.includes(k) && k !== clave),
    sinResolver: validarSeleccion(modulos, exige, orden).problemas,
  };
}

/**
 * Quién, de lo seleccionado, necesita a `clave`. Convierte un «no se puede
 * desmarcar» —que parece una pantalla rota— en «lo necesita Clínica».
 */
function quienNecesita(clave, seleccion, exige) {
  const tiene = new Set(seleccion);
  return seleccion.filter(
    (k) =>
      k !== clave &&
      (exige[k] ?? []).some(
        (d) =>
          d.claves.includes(clave) &&
          // Con alternativa solo ata si es la última que queda: quitar Citas a
          // quien tiene Clínica no rompe Equipo avanzado.
          (d.cualquiera ? !d.claves.some((o) => o !== clave && tiene.has(o)) : true)
      )
  );
}

/** La misma frase que devuelve el servidor, para que digan lo mismo. */
function fraseExigencia(p, nombreDe) {
  const lista = (p.faltan ?? p.claves).map(nombreDe).join(p.cualquiera ? " o " : " y ");
  return `Para activar ${nombreDe(p.modulo)} hace falta también ${lista}.`;
}

/**
 * Lo que le falta a `clave` para poder marcarse, con la selección de ahora.
 *
 * `faltan` es lo que hay que ir a marcar y no el requisito entero: con Clientes
 * ya puesto, «necesita Citas y Clientes» hace dudar de si Clientes está o no.
 */
function faltaPara(clave, seleccion, exige) {
  const tiene = new Set(seleccion);
  return (exige[clave] ?? [])
    .filter((dep) => !cumpleDep(dep, tiene))
    .map((dep) => ({
      modulo: clave,
      ...dep,
      faltan: dep.cualquiera ? dep.claves : dep.claves.filter((c) => !tiene.has(c)),
    }));
}

/**
 * La línea que explica por qué una casilla no se puede tocar.
 *
 * Va SIEMPRE que el estado sea distinto de «normal», nunca solo al intentarlo:
 * una casilla gris sin motivo se lee como un fallo de la pantalla, y quien la
 * ve llama por teléfono en vez de marcar lo que falta.
 */
function NotaDependencia({ tono = "gris", children }) {
  const c = tono === "rojo" ? "text-red-700" : "text-neutral-400";
  return <div className={`text-[10.5px] leading-snug mt-0.5 ${c}`}>{children}</div>;
}

function Campo({ etiqueta, pista, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">{etiqueta}</label>
      {children}
      {pista && <p className="text-[10px] text-neutral-400">{pista}</p>}
    </div>
  );
}

/**
 * Editor de un cliente ya existente.
 *
 * Dos cosas que la pantalla tiene que dejar clarísimas, porque el backend las
 * trata en serio y de nada sirve si aquí se disimulan:
 *
 *  · Activar un módulo tarda ~20 s: dispara las migraciones del schema de ese
 *    cliente. Si no se avisa ANTES de pulsar, parece que se ha colgado y alguien
 *    recargará la página a mitad.
 *  · Suspender echa a sus usuarios en el acto. No es un ajuste, es cortarle el
 *    servicio a un negocio.
 */
/**
 * Confirmación antes de tocar los módulos de un cliente REAL.
 *
 * Marcar una casilla y pulsar «Guardar» era demasiado poco para lo que pasa
 * después: activar prepara tablas en la base de datos de ese cliente y tarda
 * unos veinte segundos, y quitar hace desaparecer un módulo entero del menú de
 * gente que está trabajando en ese momento. Los dos avisos existían, pero
 * estaban en la misma pantalla donde se marca la casilla — se leen una vez y se
 * dejan de ver.
 *
 * Lo que hace este paso es OBLIGAR A MIRAR la lista concreta de lo que se va a
 * activar y de lo que se va a quitar, con el nombre del cliente delante. No pide
 * teclear nada: la fricción útil aquí es leer, no copiar; un cuadro que exige
 * escribir el nombre se rellena en automático a la tercera vez y deja de
 * proteger.
 *
 * El botón de confirmar nace DESHABILITADO durante un segundo y medio, que es lo
 * único que evita de verdad el doble clic con el que se salta cualquier
 * confirmación sin haberla leído.
 */
function ConfirmarModulos({ cliente, nuevos, quitados, nombres, onConfirmar, onCancelar }) {
  const [listo, setListo] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setListo(true), 1500);
    return () => clearTimeout(t);
  }, []);

  const nombreDe = (key) => nombres[key] ?? key;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(15,23,42,0.55)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirmar-modulos-titulo"
    >
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl p-6 space-y-5">
        <div>
          <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">
            Vas a cambiar los módulos de
          </div>
          <h2 id="confirmar-modulos-titulo" className="text-xl font-semibold text-neutral-900 mt-1">
            {cliente.nombre}
          </h2>
        </div>

        {nuevos.length > 0 && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
            <div className="text-[11px] font-semibold text-emerald-900 uppercase tracking-wide mb-1.5">
              Se activan {nuevos.length}
            </div>
            <ul className="text-sm text-emerald-900 space-y-0.5">
              {nuevos.map((k) => <li key={k}>· {nombreDe(k)}</li>)}
            </ul>
            <p className="text-[11px] text-emerald-800 mt-2 leading-relaxed">
              Se preparan sus tablas en la base de datos de este cliente. Tarda unos 20 segundos y no
              se puede interrumpir a medias: no cierres la página.
            </p>
          </div>
        )}

        {quitados.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <div className="text-[11px] font-semibold text-amber-900 uppercase tracking-wide mb-1.5">
              Se quitan {quitados.length}
            </div>
            <ul className="text-sm text-amber-900 space-y-0.5">
              {quitados.map((k) => <li key={k}>· {nombreDe(k)}</li>)}
            </ul>
            <p className="text-[11px] text-amber-800 mt-2 leading-relaxed">
              Desaparecen del menú de quien esté trabajando ahora mismo. Sus datos se conservan y
              vuelven si los reactivas.
            </p>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={onCancelar}
            className="px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wide text-neutral-600 hover:bg-neutral-100"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={!listo}
            className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-40"
            style={{ background: "var(--color-primary, #1B3A2D)" }}
          >
            {listo ? "Sí, cambiar los módulos" : "Lee lo de arriba…"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * ⚠️ EL COLOR PRINCIPAL NO ES UN ACENTO: ES EL FONDO DEL SIDEBAR.
 *
 * Encima va texto blanco a opacidades que bajan hasta el 30%, así que un color
 * claro deja el menú ilegible. Con el turquesa de la marca de Somos salía 2,22:1
 * cuando hacen falta 4,5:1, y por eso su azul acabó siendo tan oscuro. Sin este
 * aviso, quien elija un color claro desde aquí se lleva la misma sorpresa y no
 * entiende por qué.
 *
 * Es la fórmula de contraste de la WCAG: luminancia relativa de cada color y
 * `(L1 + 0.05) / (L2 + 0.05)`.
 */
function contrasteConBlanco(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex ?? "").trim());
  if (!m) return null;
  const canal = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const n = parseInt(m[1], 16);
  const L =
    0.2126 * canal((n >> 16) & 255) +
    0.7152 * canal((n >> 8) & 255) +
    0.0722 * canal(n & 255);
  return 1.05 / (L + 0.05);
}

/**
 * Cerrar la cuenta de un cliente.
 *
 * ── LAS TRAMPAS SON LAS DE SUSPENDER, MÁS UNA ───────────────────────────────
 * Teclear el identificador, enseñar cuántos datos hay dentro y nunca a nosotros
 * mismos. La que se añade es la que faltaba en todas partes: decir QUÉ hay en
 * disco. Un cliente puede tener cero filas y doscientos documentos de salud
 * subidos, y hasta hoy nadie lo veía porque `borrar-tenant.js` ni miraba
 * `uploads/`.
 *
 * Y la frase que evita el pánico: esto NO borra. Aparta el schema y los
 * ficheros, y deja escrito el comando exacto para deshacerlo. Lo que no se puede
 * deshacer —la purga— no está aquí ni va a estarlo.
 *
 * El botón nace deshabilitado un segundo y medio, igual que el de módulos: es lo
 * único que de verdad evita el doble clic con el que se salta cualquier
 * confirmación sin haberla leído.
 */
function ConfirmarBaja({ cliente, onHecho, onCancelar }) {
  const [rx, setRx] = useState(null);
  const [err, setErr] = useState(null);
  const [tecleado, setTecleado] = useState("");
  const [mirados, setMirados] = useState(false);
  const [listo, setListo] = useState(false);
  const [yendo, setYendo] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setListo(true), 1500);
    fetch(`/api/admin/clientes/${cliente.slug}/baja`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => (j.ok ? setRx(j.data) : setErr(j.error)))
      .catch((e) => setErr(e.message));
    return () => clearTimeout(t);
  }, [cliente.slug]);

  const hayDatos = (rx?.filas ?? 0) > 0;
  const puede = listo && !yendo && rx && tecleado === cliente.slug && (!hayDatos || mirados);

  async function darDeBaja() {
    setYendo(true);
    setErr(null);
    try {
      const r = await fetch(`/api/admin/clientes/${cliente.slug}/baja`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmo: tecleado, conDatos: true }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) { setErr(j.error || `Error ${r.status}`); setYendo(false); return; }
      onHecho(j.data);
    } catch (e) {
      setErr(e.message);
      setYendo(false);
    }
  }

  const kb = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} kB`);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: "rgba(15,23,42,0.55)" }}
      role="dialog" aria-modal="true" aria-labelledby="baja-titulo">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl p-6 space-y-4 max-h-[85dvh] overflow-auto">
        <div>
          <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">
            Vas a cerrar la cuenta de
          </div>
          <h2 id="baja-titulo" className="text-xl font-semibold text-neutral-900 mt-1">{cliente.nombre}</h2>
          <div className="text-xs text-neutral-500 font-mono mt-0.5">{cliente.slug}</div>
        </div>

        {!rx && !err && <p className="text-sm text-neutral-500">Mirando qué hay dentro…</p>}

        {rx && (
          <>
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 space-y-1.5">
              <div className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">Qué hay dentro</div>
              <div className="text-sm text-neutral-700">
                {rx.tablas} tablas · {rx.usuarios.length} usuario{rx.usuarios.length === 1 ? "" : "s"} ·{" "}
                {rx.modulos.length} módulos
              </div>
              <div className="text-sm" style={{ color: hayDatos ? "#b45309" : "#525252" }}>
                {hayDatos
                  ? `${rx.filas.toLocaleString("es-ES")} filas en ${rx.tablasConDatos} tablas`
                  : "Ni una fila de datos"}
              </div>
              {hayDatos && (
                <div className="text-[11px] text-neutral-500 leading-relaxed">
                  {rx.datos.map((d) => `${d.tabla}=${d.n}`).join(", ")}
                  {rx.tablasConDatos > rx.datos.length ? ` (y ${rx.tablasConDatos - rx.datos.length} tablas más)` : ""}
                </div>
              )}
              <div className="text-sm" style={{ color: rx.ficheros.total.ficheros ? "#b45309" : "#525252" }}>
                {rx.ficheros.total.ficheros
                  ? `${rx.ficheros.total.ficheros} ficheros en disco (${kb(rx.ficheros.total.bytes)})`
                  : "Ningún fichero en disco"}
              </div>
            </div>

            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-[12px] text-emerald-900 leading-relaxed">
              <b>Esto no borra nada.</b> Su schema pasa a llamarse <code>zzz_baja_…</code> y sus
              ficheros se mueven a <code>uploads/_bajas/</code>: sigue todo entero. Se escribe un{" "}
              <code>.rollback.sql</code> con el comando exacto para devolverlo. Destruirlo de verdad
              solo se puede por SSH, y se lleva por delante sus facturas.
            </div>

            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-900 leading-relaxed">
              Sus usuarios dejan de poder entrar de inmediato, sus formularios y widgets públicos
              dejan de responder y desaparece del back-office.
            </div>

            {hayDatos && (
              <label className="flex items-start gap-2 text-[12px] text-neutral-700">
                <input type="checkbox" checked={mirados} onChange={(e) => setMirados(e.target.checked)} className="mt-0.5" />
                <span>He mirado esos datos y sé lo que hay dentro.</span>
              </label>
            )}

            <div>
              <label className="block text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-1">
                Escribe <span className="font-mono text-neutral-800">{cliente.slug}</span> para confirmar
              </label>
              <input value={tecleado} onChange={(e) => setTecleado(e.target.value)} autoComplete="off"
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm font-mono" placeholder={cliente.slug} />
            </div>
          </>
        )}

        {err && <p className="text-sm text-red-700">{err}</p>}

        <div className="flex justify-end gap-3 pt-1">
          <button type="button" onClick={onCancelar} disabled={yendo}
            className="px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wide text-neutral-600 hover:bg-neutral-100 disabled:opacity-40">
            Cancelar
          </button>
          <button type="button" onClick={darDeBaja} disabled={!puede}
            className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white bg-red-700 disabled:opacity-40">
            {yendo ? "Cerrando…" : "Cerrar la cuenta"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Eliminar del todo una cuenta ya cerrada. **Esto no se puede deshacer.**
 *
 * Vive aquí y no en la ficha del cliente porque a estas alturas el cliente ya no
 * existe: lo que queda es un schema apartado y una carpeta. Y es lo que hace que
 * este botón no contradiga la regla de `cicloVida.js` —un botón que borra los
 * datos de un cliente es un accidente esperando su turno—: no alcanza a ningún
 * cliente, solo a lo que YA se dio de baja. Para llegar hasta aquí hay que haber
 * cerrado la cuenta antes, tecleando su identificador.
 *
 * Dos confirmaciones, y la segunda no es burocracia: reconocer que se destruyen
 * sus FACTURAS, que hay obligación legal de conservar años. Es la única casilla
 * del back-office que existe para reconocer una consecuencia legal.
 */
function ConfirmarEliminar({ baja, onHecho, onCancelar }) {
  const [tecleado, setTecleado] = useState("");
  const [acepta, setAcepta] = useState(false);
  const [listo, setListo] = useState(false);
  const [yendo, setYendo] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setListo(true), 1500);
    return () => clearTimeout(t);
  }, []);

  const puede = listo && !yendo && tecleado === baja.slug && acepta;

  async function eliminar() {
    setYendo(true);
    setErr(null);
    try {
      const q = new URLSearchParams({
        slug: baja.slug, sello: baja.sello, confirmo: tecleado, facturas: "destruir",
      });
      const r = await fetch(`/api/admin/bajas?${q}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok || !j.ok) { setErr(j.error || `Error ${r.status}`); setYendo(false); return; }
      onHecho(j.data);
    } catch (e) {
      setErr(e.message);
      setYendo(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: "rgba(15,23,42,0.55)" }}
      role="dialog" aria-modal="true" aria-labelledby="eliminar-titulo">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl p-6 space-y-4 max-h-[85dvh] overflow-auto">
        <div>
          <div className="text-[10px] font-semibold text-red-500 uppercase tracking-widest">
            Esto no se puede deshacer
          </div>
          <h2 id="eliminar-titulo" className="text-xl font-semibold text-neutral-900 mt-1">
            Eliminar del todo a {baja.slug}
          </h2>
          <div className="text-xs text-neutral-500 mt-0.5">
            Dado de baja el {new Date(baja.cuando).toLocaleString("es-ES")}
          </div>
        </div>

        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 space-y-1.5">
          <div className="text-[11px] font-semibold text-red-800 uppercase tracking-wide">Se destruye</div>
          <ul className="text-sm text-red-900 space-y-0.5">
            {baja.schema && <li>· Su schema <code className="text-xs">{baja.schema}</code>, con sus {baja.tablas} tablas y todo lo que hay dentro.</li>}
            {baja.ficheros && <li>· Todos sus ficheros: documentos, adjuntos, firmas y contratos.</li>}
            {baja.red && <li>· Su red de rescate, o sea la posibilidad de recuperarlo.</li>}
          </ul>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-900 leading-relaxed">
          Entre lo que se destruye hay <b>facturas</b>, que tienen obligación legal de conservarse
          años. Sus registros de auditoría no se borran —nunca se borran— pero se quedan sin dueño
          para siempre: con esto desaparece la última forma de saber de quién eran.
        </div>

        <label className="flex items-start gap-2 text-[12px] text-neutral-800">
          <input type="checkbox" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} className="mt-0.5" />
          <span>Sé que destruyo sus facturas y que esto no tiene vuelta atrás.</span>
        </label>

        <div>
          <label className="block text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-1">
            Escribe <span className="font-mono text-neutral-800">{baja.slug}</span> para confirmar
          </label>
          <input value={tecleado} onChange={(e) => setTecleado(e.target.value)} autoComplete="off"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm font-mono" placeholder={baja.slug} />
        </div>

        {err && <p className="text-sm text-red-700">{err}</p>}

        <div className="flex justify-end gap-3 pt-1">
          <button type="button" onClick={onCancelar} disabled={yendo}
            className="px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wide text-neutral-600 hover:bg-neutral-100 disabled:opacity-40">
            Cancelar
          </button>
          <button type="button" onClick={eliminar} disabled={!puede}
            className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white bg-red-700 disabled:opacity-40">
            {yendo ? "Eliminando…" : "Eliminar para siempre"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Las cuentas cerradas que siguen apartadas.
 *
 * Existe por algo que no se veía en ningún sitio: tras una baja, lo que queda
 * —un schema `zzz_baja_*` y una carpeta con sus papeles— no salía en ninguna
 * pantalla. Había que entrar por SSH y listar schemas para saber si quedaba algo
 * de alguien. Los tres `.rollback.sql` que sobrevivieron a la purga del 12/08,
 * con los `password_hash` dentro, estuvieron ahí porque nadie podía verlos.
 *
 * Si no hay ninguna, el bloque no se pinta: un apartado vacío en pantalla es
 * ruido permanente por algo que pasa dos veces al año.
 */
function CuentasCerradas({ bajas, onEliminada }) {
  const [eliminando, setEliminando] = useState(null);
  const [hecho, setHecho] = useState(null);

  if (!bajas?.length && !hecho) return null;

  return (
    <div className="mb-8">
      <div className="flex items-baseline gap-3 mb-2">
        <h2 className="text-[11px] font-bold uppercase tracking-widest text-neutral-400">Cuentas cerradas</h2>
        <span className="text-[11px] text-neutral-400">
          apartadas y recuperables — eliminar es lo único que no tiene vuelta atrás
        </span>
      </div>

      {hecho && (
        <div className="mb-3 rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="text-xs text-neutral-700">
              <b>{hecho.slug}</b> eliminado del todo
              {hecho.schemaDestruido ? ` (${hecho.tablas} tablas)` : ""}
              {hecho.ficheros?.length ? " · con sus ficheros" : ""}
              {hecho.redes?.length ? " · y su red de rescate" : ""}.
            </div>
            <button onClick={() => setHecho(null)} className="text-[11px] text-neutral-500 hover:underline shrink-0">
              Entendido
            </button>
          </div>
        </div>
      )}

      <ul className="rounded-xl border border-neutral-200 bg-white divide-y divide-neutral-100">
        {bajas.map((b) => (
          <li key={`${b.slug}_${b.sello}`} className="px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-neutral-800">
                {b.slug}
                <span className="ml-2 text-[11px] text-neutral-400 font-normal">
                  {new Date(b.cuando).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" })}
                </span>
              </div>
              <div className="text-[11px] text-neutral-400 truncate">
                {[
                  b.schema ? `${b.tablas} tablas en ${b.schema}` : "sin schema",
                  b.ficheros ? "con sus ficheros" : null,
                  b.red ? "con red de rescate" : "SIN red de rescate",
                ].filter(Boolean).join(" · ")}
              </div>
            </div>
            <button type="button" onClick={() => setEliminando(b)}
              className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-red-700 hover:text-red-900">
              Eliminar del todo
            </button>
          </li>
        ))}
      </ul>

      {eliminando && (
        <ConfirmarEliminar
          baja={eliminando}
          onCancelar={() => setEliminando(null)}
          onHecho={(res) => { setEliminando(null); setHecho(res); onEliminada(); }}
        />
      )}
    </div>
  );
}

function EditorCliente({ cliente, catalogo, onGuardar, onBaja, guardando, avisos }) {
  const [f, setF] = useState({
    nombre: cliente.nombre,
    modulos: [...cliente.modulos],
    // El PLAN se editaba aquí y se quitó el 12/08/2026 (Jorge): no gateaba nada
    // y era un campo de TEXTO LIBRE sobre una columna que en base de datos es un
    // ENUM de cuatro valores, así que escribir cualquier otra cosa reventaba con
    // un error de PostgreSQL. La columna sigue ahí; lo que se retiró es poder
    // escribirla a ciegas.
    primaryColor: cliente.marca?.primaryColor ?? "",
    secondaryColor: cliente.marca?.secondaryColor ?? "",
    accentColor: cliente.marca?.accentColor ?? "",
    logoUrl: cliente.marca?.logoUrl ?? "",
    isotipoUrl: cliente.marca?.isotipoUrl ?? "",
  });

  const [confirmando, setConfirmando] = useState(false);
  const [cerrandoCuenta, setCerrandoCuenta] = useState(false);

  // La confirmación enseña nombres, no claves: quien decide si un cliente tiene
  // «Documentos avanzado» no tiene por qué saber que por dentro se llama
  // `documents_avanzado`.
  const nombresDeModulo = useMemo(() => {
    const m = {};
    for (const g of catalogo ?? []) for (const mod of g.modulos ?? []) m[mod.key] = mod.nombre;
    return m;
  }, [catalogo]);
  const nombreDe = (k) => nombresDeModulo[k] ?? k;

  const planos = useMemo(() => (catalogo ?? []).flatMap((g) => g.modulos ?? []), [catalogo]);
  const orden = useMemo(() => planos.map((m) => m.key), [planos]);
  const exige = useMemo(() => Object.fromEntries(planos.map((m) => [m.key, m.exige ?? []])), [planos]);

  // Lo marcado es lo que se guarda: ni se completa ni se corrige. La
  // confirmación que viene después promete exactamente esto.
  const resuelto = useMemo(() => validarSeleccion(f.modulos, exige, orden), [f.modulos, exige, orden]);

  const nuevos = resuelto.modulos.filter((m) => !cliente.modulos.includes(m));

  /*
   * ⚠️ SOLO SE CUENTA COMO «SE QUITA» LO QUE EL SERVIDOR VA A QUITAR DE VERDAD
   * (12/08/2026, encontrado al probar el editor en producción).
   *
   * `cliente.modulos` son los módulos ACTIVOS, y `resuelto.modulos` sale de
   * `orden`, que es el catálogo de venta. Un módulo interno —hoy solo
   * `provisioning`, que es el que abre el back-office y lo tiene nuestro propio
   * tenant— no está en el catálogo, así que no tiene casilla y caía siempre en
   * `quitados`.
   *
   * Consecuencia, comprobada abriendo nuestra ficha en producción: al pulsar
   * «Guardar cambios» salía la confirmación diciendo **«SE QUITAN 1 ·
   * provisioning»**. Y era MENTIRA: `cicloVida.js:190` filtra por
   * `CLAVES_VALIDAS` justo para que guardar nuestra ficha no nos deje fuera del
   * panel. O sea que la pantalla prometía apagar el módulo más delicado del CRM
   * y el servidor lo ignoraba en silencio.
   *
   * Las dos mitades son malas: una confirmación que asusta con algo que no va a
   * pasar se acaba pulsando sin leer, que es exactamente lo contrario de para lo
   * que está. Aquí se aplica el MISMO filtro que el servidor.
   */
  const enCatalogo = useMemo(() => new Set(orden), [orden]);
  const quitados = cliente.modulos.filter(
    (m) => !resuelto.modulos.includes(m) && enCatalogo.has(m)
  );

  // La marca se manda SOLO si cambió: `editarTenant` hace merge sobre lo que ya
  // hubiera, y mandarla siempre reescribiría el `settings` del cliente en cada
  // guardado aunque solo se hubiera tocado el nombre.
  const marcaTocada =
    (f.primaryColor || "") !== (cliente.marca?.primaryColor ?? "") ||
    (f.secondaryColor || "") !== (cliente.marca?.secondaryColor ?? "") ||
    (f.accentColor || "") !== (cliente.marca?.accentColor ?? "") ||
    (f.logoUrl || "") !== (cliente.marca?.logoUrl ?? "") ||
    (f.isotipoUrl || "") !== (cliente.marca?.isotipoUrl ?? "");

  const contraste = contrasteConBlanco(f.primaryColor);
  const menuIlegible = contraste !== null && contraste < 4.5;

  const hayCambios =
    f.nombre !== cliente.nombre || marcaTocada || nuevos.length > 0 || quitados.length > 0;

  const cambiosAMandar = () => ({
    nombre: f.nombre,
    modulos: resuelto.modulos,
    ...(marcaTocada
      ? {
          brand: {
            primaryColor: f.primaryColor,
            secondaryColor: f.secondaryColor,
            accentColor: f.accentColor,
            logoUrl: f.logoUrl,
            isotipoUrl: f.isotipoUrl,
          },
        }
      : {}),
  });

  function alternar(key) {
    setF((p) => ({
      ...p,
      modulos: p.modulos.includes(key) ? p.modulos.filter((k) => k !== key) : [...p.modulos, key],
    }));
  }

  async function suspender() {
    const suspendido = cliente.estado === "suspended";
    const texto = suspendido
      ? `Reactivar «${cliente.nombre}».\n\nSus usuarios volverán a poder entrar.`
      : `SUSPENDER «${cliente.nombre}».\n\nSus usuarios dejarán de poder entrar DE INMEDIATO y sus formularios públicos dejarán de responder.\n\nLos datos se conservan intactos.\n\n¿Seguro?`;
    if (!confirm(texto)) return;
    await onGuardar(cliente.slug, { estado: suspendido ? "active" : "suspended", confirmar: true });
  }

  return (
    <div className="mt-3 pt-3 border-t border-neutral-100 space-y-4">
      <Campo etiqueta="Nombre">
        <input value={f.nombre} onChange={(e) => setF((p) => ({ ...p, nombre: e.target.value }))} className={inputCls} />
      </Campo>

      {/* MARCA — antes solo se podía poner al crear el cliente. Cambiársela
          después era escribir un script, commitear, desplegar y correrlo con
          `docker exec`: media hora para dos campos de seis caracteres. El
          servidor ya sabía hacerlo (`editarTenant` valida el hex y hace merge);
          lo único que faltaba era esto. */}
      <div>
        <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-2">Marca</div>
        <div className="grid md:grid-cols-3 gap-3">
          <Campo etiqueta="Color principal" pista="Es el FONDO del menú lateral, no un acento.">
            <div className="flex gap-2">
              <input type="color" value={f.primaryColor || "#1B3A2D"}
                onChange={(e) => setF((p) => ({ ...p, primaryColor: e.target.value }))}
                className="h-9 w-12 rounded border border-neutral-200 bg-white shrink-0" />
              <input value={f.primaryColor} onChange={(e) => setF((p) => ({ ...p, primaryColor: e.target.value }))}
                className={inputCls + " font-mono"} placeholder="#1B3A2D" />
            </div>
          </Campo>
          <Campo etiqueta="Color secundario">
            <div className="flex gap-2">
              <input type="color" value={f.secondaryColor || "#3E6B54"}
                onChange={(e) => setF((p) => ({ ...p, secondaryColor: e.target.value }))}
                className="h-9 w-12 rounded border border-neutral-200 bg-white shrink-0" />
              <input value={f.secondaryColor} onChange={(e) => setF((p) => ({ ...p, secondaryColor: e.target.value }))}
                className={inputCls + " font-mono"} placeholder="#3E6B54" />
            </div>
          </Campo>
          <Campo etiqueta="Color de acento (opcional)" pista="El tercer color del logo, si lo hay. Solo lo usa el PDF del informe clínico.">
            <div className="flex items-center gap-2">
              <input type="color" value={f.accentColor || "#563EA6"}
                onChange={(e) => setF((p) => ({ ...p, accentColor: e.target.value }))}
                className="h-9 w-12 rounded border border-neutral-200 bg-white shrink-0" />
              <input value={f.accentColor} onChange={(e) => setF((p) => ({ ...p, accentColor: e.target.value }))}
                className={inputCls + " font-mono"} placeholder="#FF0188" />
            </div>
          </Campo>
          <Campo etiqueta="Logo (ruta o URL)" pista="Para que salga en los PDF tiene que ser una ruta de este servidor, como /aumenta-logo.png.">
            <input value={f.logoUrl} onChange={(e) => setF((p) => ({ ...p, logoUrl: e.target.value }))}
              className={inputCls} placeholder="/aumenta-logo.png" />
          </Campo>
          <Campo etiqueta="Isotipo (ruta)" pista="La marca sin el texto. Cierra la última página del informe clínico.">
            <input value={f.isotipoUrl} onChange={(e) => setF((p) => ({ ...p, isotipoUrl: e.target.value }))}
              className={inputCls} placeholder="/aumenta-isotipo.png" />
          </Campo>
        </div>
        {menuIlegible && (
          <div className="mt-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Con ese color principal, el texto blanco del menú queda en{" "}
            <b>{contraste.toFixed(2)}:1</b> y hacen falta <b>4,5:1</b> para poder leerlo. El menú
            lateral se pinta de este color con el texto encima: elige uno más oscuro, o deja el claro
            para el secundario.
          </div>
        )}
      </div>

      <div>
        <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-2">
          Módulos ({resuelto.modulos.length})
        </div>
        <div className="grid md:grid-cols-2 gap-x-4 gap-y-1">
          {planos.map((m) => {
            const marcado = f.modulos.includes(m.key);
            const necesitadoPor = marcado ? quienNecesita(m.key, f.modulos, exige) : [];
            const fijo = necesitadoPor.length > 0;
            const falta = marcado ? [] : faltaPara(m.key, f.modulos, exige);
            const cadena = falta.length ? cadenaPara(m.key, f.modulos, exige, orden) : null;
            const esNuevo = marcado && !cliente.modulos.includes(m.key);
            const seQuita = !marcado && cliente.modulos.includes(m.key);
            return (
              <div key={m.key} className="py-1">
                <label className={`flex items-center gap-2 text-sm ${fijo || falta.length ? "cursor-default" : "cursor-pointer"}`}>
                  <input type="checkbox" checked={marcado} disabled={fijo || falta.length > 0}
                    onChange={() => alternar(m.key)}
                    className="rounded border-neutral-300 accent-[var(--color-primary,#1B3A2D)] disabled:opacity-50" />
                  <span className={seQuita ? "text-neutral-400 line-through" : "text-neutral-700"}>{m.nombre}</span>
                  {esNuevo && <span className="text-[10px] text-emerald-700">se activará</span>}
                  {seQuita && <span className="text-[10px] text-amber-700">se quitará</span>}
                </label>
                {fijo && (
                  <NotaDependencia>
                    no se puede quitar: lo necesita {necesitadoPor.map(nombreDe).join(", ")}
                  </NotaDependencia>
                )}
                {falta.length > 0 && (
                  <NotaDependencia tono="rojo">
                    {falta.map((p) => fraseExigencia(p, nombreDe)).join(" ")}
                    {cadena && cadena.sinResolver.length === 0 && (
                      <button type="button" onClick={() => setF((p) => ({ ...p, modulos: cadena.modulos }))}
                        className="ml-1 underline underline-offset-2 hover:no-underline">
                        activar también {cadena.anadidos.map(nombreDe).join(" y ")}
                      </button>
                    )}
                  </NotaDependencia>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {resuelto.problemas.length > 0 && (
        <div className="text-[11px] text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2 space-y-0.5">
          {resuelto.problemas.map((p, i) => <div key={i}>{fraseExigencia(p, nombreDe)}</div>)}
        </div>
      )}
      {nuevos.length > 0 && (
        <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          Al guardar se prepararán las tablas de {nuevos.map(nombreDe).join(", ")} en la base de datos de
          este cliente.<b> Tarda unos 20 segundos.</b> No cierres la página.
        </div>
      )}
      {quitados.length > 0 && (
        <div className="text-[11px] text-neutral-600 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2">
          Quitar {quitados.map(nombreDe).join(", ")} solo los esconde del menú. <b>Sus datos se conservan</b> y vuelven si los reactivas.
        </div>
      )}

      {avisos?.length > 0 && (
        <ul className="text-[11px] text-neutral-700 bg-[#F4F6F4] border border-neutral-200 rounded-lg px-3 py-2 space-y-1">
          {avisos.map((a, i) => <li key={i}>· {a}</li>)}
        </ul>
      )}

      <div className="flex items-center justify-between gap-3 pt-1">
        <div className="flex items-center gap-4 flex-wrap">
          <button type="button" onClick={suspender} disabled={guardando}
            className={`text-xs font-semibold uppercase tracking-wide disabled:opacity-40 ${
              cliente.estado === "suspended" ? "text-emerald-700" : "text-red-700"
            }`}>
            {cliente.estado === "suspended" ? "Reactivar cliente" : "Suspender cliente"}
          </button>
          {/* CERRAR LA CUENTA (13/08/2026). Antes esto se acababa en «suspender»:
              quien se iba se quedaba apagado y ya, con su usuario y su schema
              enteros, escondido tras el interruptor de suspendidos, y nada decía
              qué pasaba con él. La baja de verdad era SSH — así se dieron las
              tres del 12/08. */}
          <button type="button" onClick={() => setCerrandoCuenta(true)} disabled={guardando}
            className="text-xs font-semibold uppercase tracking-wide text-red-700 disabled:opacity-40">
            Cerrar la cuenta
          </button>
        </div>
        {/* Cambiar el nombre o la marca se guarda directo; tocar los módulos
            pasa por la confirmación, que es lo que mueve tablas y menús. Se
            manda la lista RESUELTA: es la que se acaba de enseñar y confirmar. */}
        <button type="button" disabled={!hayCambios || guardando || resuelto.problemas.length > 0}
          onClick={() => {
            const tocaModulos = nuevos.length > 0 || quitados.length > 0;
            if (tocaModulos) setConfirmando(true);
            else onGuardar(cliente.slug, cambiosAMandar());
          }}
          className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-40"
          style={{ background: "var(--color-primary, #1B3A2D)" }}>
          {guardando ? (nuevos.length ? "Preparando la base de datos…" : "Guardando…") : "Guardar cambios"}
        </button>
      </div>

      {confirmando && (
        <ConfirmarModulos
          cliente={cliente}
          nuevos={nuevos}
          quitados={quitados}
          nombres={nombresDeModulo}
          onCancelar={() => setConfirmando(false)}
          onConfirmar={() => {
            setConfirmando(false);
            onGuardar(cliente.slug, cambiosAMandar());
          }}
        />
      )}

      {/* La RED del alta de administradores (27/08/2026). La vía normal es que
          se la dé el propio cliente desde Equipo; esto es para cuando dentro no
          queda nadie que pueda — once clientes tienen un solo admin. */}
      <AdminsDelCliente slug={cliente.slug} />

      {cerrandoCuenta && (
        <ConfirmarBaja
          cliente={cliente}
          onCancelar={() => setCerrandoCuenta(false)}
          onHecho={(res) => {
            setCerrandoCuenta(false);
            onBaja(res);
          }}
        />
      )}
    </div>
  );
}

/**
 * Los administradores de un cliente, y el alta de uno más.
 *
 * Se carga sola al abrir la ficha porque la pregunta que trae aquí a alguien
 * suele ser «¿a quién llamo, que no puede entrar?», y esa se contesta viendo la
 * lista —con su correo y su última entrada— antes de crear nada.
 *
 * No hay botón de cambiar contraseña ni de borrar, y es a propósito: este panel
 * crea cuentas, no entra en las de nadie (el porqué entero, en la cabecera de
 * `app/api/admin/clientes/[slug]/admins/route.js`).
 */
function AdminsDelCliente({ slug }) {
  const [admins, setAdmins] = useState(null);
  const [error, setError] = useState(null);
  const [creando, setCreando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [nuevo, setNuevo] = useState({ usuario: "", correo: "", password: "" });
  const [hecho, setHecho] = useState(null);

  const cargar = useCallback(() => {
    fetch(`/api/admin/clientes/${slug}/admins`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => (j.ok ? setAdmins(j.data.admins) : setError(j.error || "No se pudo leer")))
      .catch(() => setError("No se pudo leer"));
  }, [slug]);

  useEffect(() => { cargar(); }, [cargar]);

  async function crear() {
    setOcupado(true); setError(null);
    try {
      const r = await fetch(`/api/admin/clientes/${slug}/admins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nuevo),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo crear");
      // La contraseña la enseñamos NOSOTROS, con la que se acaba de escribir: el
      // servidor no la devuelve nunca.
      setHecho({ usuario: j.data.usuario, password: nuevo.password });
      setNuevo({ usuario: "", correo: "", password: "" });
      setCreando(false);
      cargar();
    } catch (e) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  const fecha = (v) =>
    v ? new Date(v).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) : "nunca ha entrado";

  return (
    <div className="mt-5 pt-4 border-t border-neutral-200">
      <div className="text-[11px] font-bold uppercase tracking-wide text-neutral-500 mb-2">
        Administradores
      </div>

      {admins === null ? (
        <div className="text-[11px] text-neutral-400">Cargando…</div>
      ) : admins.length === 0 ? (
        <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1.5">
          Este cliente no tiene ninguna cuenta de administrador. Nadie de dentro puede
          gestionar su equipo.
        </div>
      ) : (
        <ul className="space-y-1 mb-2">
          {admins.map((a) => (
            <li key={a.usuario} className="text-xs text-neutral-700 flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono">{a.usuario}</span>
              {a.correo ? (
                <span className="text-neutral-500">{a.correo}</span>
              ) : (
                <span className="text-amber-700">sin correo: no puede recuperar su contraseña</span>
              )}
              <span className="text-neutral-400">· {fecha(a.ultimaEntrada)}</span>
            </li>
          ))}
        </ul>
      )}

      {admins?.length === 1 && (
        <p className="text-[10px] text-neutral-400 mb-2">
          Con una sola cuenta de dirección, el día que esa persona no pueda entrar no queda
          nadie dentro que pueda arreglarlo.
        </p>
      )}

      {hecho && (
        <div className="mb-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
          <div className="text-[11px] font-bold text-emerald-800 mb-1">Administrador creado</div>
          <div className="text-xs font-mono text-emerald-900 break-all">
            {hecho.usuario} · {hecho.password}
          </div>
          <p className="text-[10px] text-emerald-700 mt-1">
            Apúntala ahora: no se puede volver a consultar. Que se la cambie al entrar.
          </p>
          <button onClick={() => setHecho(null)} className="text-[10px] text-emerald-700 underline mt-1">
            Ya está
          </button>
        </div>
      )}

      {error && <div className="text-[11px] text-red-600 mb-2">{error}</div>}

      {!creando ? (
        <button
          type="button"
          onClick={() => setCreando(true)}
          className="text-[11px] px-2.5 py-1 rounded border border-neutral-300 text-neutral-700 hover:bg-neutral-50"
        >
          Añadir administrador
        </button>
      ) : (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 space-y-2">
          <input
            value={nuevo.usuario}
            onChange={(e) => setNuevo((n) => ({ ...n, usuario: e.target.value }))}
            placeholder={`usuario (se le añade _${slug} si no lo lleva)`}
            className="w-full rounded-lg px-3 py-2 text-sm font-mono text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400"
          />
          <input
            type="email"
            autoComplete="off"
            spellCheck={false}
            value={nuevo.correo}
            onChange={(e) => setNuevo((n) => ({ ...n, correo: e.target.value }))}
            placeholder="correo (a donde va el enlace si pierde la contraseña)"
            className="w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400"
          />
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={nuevo.password}
            onChange={(e) => setNuevo((n) => ({ ...n, password: e.target.value }))}
            placeholder="contraseña con la que va a entrar"
            className="w-full rounded-lg px-3 py-2 text-sm font-mono text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={crear}
              disabled={ocupado || !nuevo.usuario.trim() || !nuevo.correo.trim() || !nuevo.password}
              className="text-[11px] px-3 py-1.5 rounded-lg font-semibold text-white disabled:opacity-50"
              style={{ background: "var(--color-primary, #1B3A2D)" }}
            >
              {ocupado ? "Creando…" : "Crear administrador"}
            </button>
            <button
              type="button"
              onClick={() => { setCreando(false); setError(null); }}
              disabled={ocupado}
              className="text-[11px] px-2.5 py-1 rounded border border-neutral-300 text-neutral-700 hover:bg-neutral-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function sugerirSlug(nombre) {
  return String(nombre || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 41);
}

export default function AltaClientesPage() {
  const [datos, setDatos] = useState(null);
  const [err, setErr] = useState(null);
  const [creando, setCreando] = useState(false);
  const [credenciales, setCredenciales] = useState(null);
  // Aparte de las credenciales a propósito: los avisos son tareas pendientes y
  // no deben desaparecer al cerrar el modal de la contraseña.
  const [avisos, setAvisos] = useState([]);
  const [abierto, setAbierto] = useState(false);
  // Edición de un cliente ya existente.
  const [editando, setEditando] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [avisosEdit, setAvisosEdit] = useState([]);
  // Resultado de la última baja. Se queda en pantalla hasta que se cierra a
  // mano: lleva la ruta del .rollback.sql, que es lo que la hace reversible.
  const [baja, setBaja] = useState(null);
  // Las cuentas ya cerradas que siguen apartadas. Van en su propia petición
  // porque no salen de `master.tenants`: salen de los schemas y del disco.
  const [bajas, setBajas] = useState([]);

  const [form, setForm] = useState({
    nombre: "",
    slug: "",
    slugTocado: false,
    adminEmail: "",
    adminCorreo: "",
    // A quién se le escribe, que no es el de arriba: ver
    // lib/provisioning/contactoCliente.js.
    contactoEmail: "",
    contactoNombre: "",
    contactoTelefono: "",
    modulos: [],
    primaryColor: "",
    secondaryColor: "",
    accentColor: "",
    logoUrl: "",
    isotipoUrl: "",
    fiscalName: "",
    taxId: "",
    address: "",
    city: "",
    zip: "",
  });

  // Los suspendidos NO salen por defecto en ninguna pantalla del back-office
  // (10/08/2026). Esta es la excepción y la puerta de vuelta: es la única que
  // sabe reactivar, así que puede pedirlos — pero hay que pedirlo.
  const [verSuspendidos, setVerSuspendidos] = useState(false);

  const cargar = useCallback(() => {
    const url = `/api/provisioning/clientes${verSuspendidos ? "?incluirSuspendidos=1" : ""}`;
    fetch(url, { cache: "no-store" })
      .then((r) => r.json().then((j) => ({ status: r.status, j })))
      .then(({ status, j }) => {
        if (j.ok) {
          setDatos(j.data);
          setForm((f) => (f.modulos.length ? f : { ...f, modulos: j.data.recomendados }));
        } else setErr(status === 403 ? "Este panel es solo para Salamandra Solutions." : j.error || "Error");
      })
      .catch(() => setErr("No se pudo cargar el panel"));
  }, [verSuspendidos]);

  useEffect(() => { cargar(); }, [cargar]);

  // Dependencias: Nutrición no se puede marcar sin Clientes, y la casilla lo
  // dice con esas palabras en vez de dejarse marcar y añadirlo por detrás.
  const planos = useMemo(() => (datos?.catalogo ?? []).flatMap((g) => g.modulos ?? []), [datos]);
  const ordenModulos = useMemo(() => planos.map((m) => m.key), [planos]);
  const exige = useMemo(() => Object.fromEntries(planos.map((m) => [m.key, m.exige ?? []])), [planos]);
  const nombreDe = useCallback((k) => planos.find((m) => m.key === k)?.nombre ?? k, [planos]);

  const resuelto = useMemo(
    () => validarSeleccion(form.modulos, exige, ordenModulos),
    [form.modulos, exige, ordenModulos]
  );

  /**
   * ¿Lo marcado coincide EXACTAMENTE con algún paquete? Solo sirve para decir
   * cuál está puesto; no se guarda ni se manda. En cuanto se toca una casilla
   * pasa a `null` y la pantalla dice «Personalizado», que es lo que de verdad
   * tienen todos los clientes.
   */
  const paquetePuesto = useMemo(() => {
    const mio = [...form.modulos].sort().join(",");
    const p = (datos?.paquetes ?? []).find((x) => [...x.modulos].sort().join(",") === mio);
    return p?.key ?? null;
  }, [form.modulos, datos]);

  function toggleModulo(key) {
    setForm((f) => ({
      ...f,
      modulos: f.modulos.includes(key) ? f.modulos.filter((k) => k !== key) : [...f.modulos, key],
    }));
  }

  function cambiarNombre(v) {
    setForm((f) => ({ ...f, nombre: v, slug: f.slugTocado ? f.slug : sugerirSlug(v) }));
  }

  /**
   * Guarda cambios de un cliente existente.
   *
   * La petición puede tardar ~20 s cuando activa módulos (dispara las
   * migraciones de su schema), por eso no hay ningún timeout: cortarla dejaría
   * las filas escritas y el schema a medias, que es justo el estado que el
   * backend se esfuerza en evitar.
   */
  async function guardarEdicion(slug, cambios) {
    setErr(null);
    setAvisosEdit([]);
    setGuardando(true);
    try {
      const r = await fetch(`/api/admin/clientes/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cambios),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo guardar");
      setAvisosEdit(Array.isArray(j.data?.avisos) ? j.data.avisos : []);
      cargar();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setGuardando(false);
    }
  }

  /**
   * Cuenta cerrada. Se cierra la ficha (el cliente ya no está en la lista) y se
   * dejan a la vista las dos cosas que hay que saber DESPUÉS: dónde quedó su
   * schema y cuál es el comando para deshacerlo. Eso no puede quedarse en un
   * `alert` que se cierra solo — es lo único que hace la baja reversible.
   */
  function cerrarCuenta(res) {
    setEditando(null);
    setAvisosEdit([]);
    setBaja(res);
    cargar();
    cargarBajas();
  }

  /**
   * Las cuentas cerradas. No se propaga el error a la pantalla a propósito: si
   * este listado falla, el alta de clientes tiene que seguir funcionando.
   */
  const cargarBajas = useCallback(() => {
    fetch("/api/admin/bajas", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setBajas(j.ok ? j.data.bajas : []))
      .catch(() => setBajas([]));
  }, []);

  useEffect(() => { cargarBajas(); }, [cargarBajas]);

  async function crear(e) {
    e.preventDefault();
    setErr(null);
    if (!form.nombre.trim()) { setErr("Escribe el nombre del cliente"); return; }
    if (!resuelto.modulos.length) { setErr("Elige al menos un módulo"); return; }
    // El servidor lo vuelve a comprobar; esto es para no llegar allí.
    if (resuelto.problemas.length) {
      setErr(resuelto.problemas.map((p) => fraseExigencia(p, nombreDe)).join(" "));
      return;
    }
    if (!confirm(`Se va a crear el cliente «${form.nombre}» con identificador «${form.slug}».\n\nEl identificador NO se puede cambiar después. ¿Continuar?`)) return;

    setCreando(true);
    try {
      const r = await fetch("/api/provisioning/clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: form.nombre,
          slug: form.slug,
          adminEmail: form.adminEmail || undefined,
          adminCorreo: form.adminCorreo,
          contacto: {
            email: form.contactoEmail,
            nombre: form.contactoNombre,
            telefono: form.contactoTelefono,
          },
          // La lista RESUELTA: lo que la pantalla acaba de enseñar marcado.
          modulos: resuelto.modulos,
          brand: {
            primaryColor: form.primaryColor,
            secondaryColor: form.secondaryColor,
            accentColor: form.accentColor,
            logoUrl: form.logoUrl,
            isotipoUrl: form.isotipoUrl,
          },
          fiscal: { fiscalName: form.fiscalName, taxId: form.taxId, address: form.address, city: form.city, zip: form.zip },
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo crear el cliente");
      setCredenciales({ username: j.data.adminEmail, password: j.data.password, slug: j.data.slug, modulos: j.data.modulos });
      setAvisos(Array.isArray(j.data.avisos) ? j.data.avisos : []);
      setAbierto(false);
      setForm((f) => ({ ...f, nombre: "", slug: "", slugTocado: false, adminEmail: "", adminCorreo: "", contactoEmail: "", contactoNombre: "", contactoTelefono: "", fiscalName: "", taxId: "", address: "", city: "", zip: "" }));
      cargar();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setCreando(false);
    }
  }

  return (
    <div
      className={`p-4 lg:p-8 ${MAX_ANCHO_PANEL} mx-auto my-6 lg:my-10 rounded-xl bg-[#FAF9F7] text-neutral-800 shadow-[0_2px_40px_rgba(0,0,0,0.5)]`}
    >
      <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-[0.18em] mb-1.5">
            Salamandra · Interno
          </div>
          <h1 className="text-[26px] lg:text-[34px] leading-[1.05] text-neutral-900 tracking-tight">
            Alta de clientes
          </h1>
          <p className="text-xs text-neutral-400 mt-2 max-w-xl">
            Crea un cliente nuevo con sus módulos, su marca y sus datos fiscales. Todo lo que antes
            eran scripts a mano.
          </p>
        </div>
        {!abierto && datos && (
          <button onClick={() => setAbierto(true)}
            className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white"
            style={{ background: "var(--color-primary, #1B3A2D)" }}>
            + Nuevo cliente
          </button>
        )}
      </div>

      {err && <div className="mb-4 text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</div>}

      {!datos && !err && <div className="text-xs text-neutral-400">Cargando…</div>}

      {/* Formulario de alta */}
      {abierto && datos && (
        <form onSubmit={crear} className="bg-white border border-neutral-200 rounded-xl p-5 space-y-5 mb-8">
          <div className="grid md:grid-cols-2 gap-4">
            <Campo etiqueta="Nombre del cliente *">
              <input value={form.nombre} onChange={(e) => cambiarNombre(e.target.value)}
                className={inputCls} placeholder="Centro Aumenta" />
            </Campo>
            <Campo etiqueta="Identificador *" pista="Es el nombre interno en la base de datos: NO se puede cambiar después.">
              <input value={form.slug}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value, slugTocado: true }))}
                className={inputCls + " font-mono"} placeholder="centro_aumenta" />
            </Campo>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Campo etiqueta="Usuario administrador" pista="Con lo que ENTRA al CRM. Si lo dejas vacío se crea admin_{identificador}. La contraseña se genera sola y se enseña una vez.">
              <input value={form.adminEmail} onChange={(e) => setForm((f) => ({ ...f, adminEmail: e.target.value }))}
                className={inputCls} placeholder="direccion@sucliente.com" />
            </Campo>
            {/*
              EL CORREO DE ESA CUENTA, OBLIGATORIO (26/08/2026, Jorge). No es el
              campo de al lado —ese es el login y puede no llevar arroba— ni el
              «correo de contacto» de abajo, que es de la empresa y puede ser
              otra persona. Este es a dónde se le escribe A ÉL si pierde la
              contraseña, y además le sirve para entrar.

              Importa más de lo que parece: 11 clientes tienen UN SOLO
              administrador, así que sin esto ese cliente se queda parado hasta
              que uno de nosotros entre por SSH.
            */}
            <Campo etiqueta="Correo del administrador *" pista="A donde se le manda el enlace si pierde la contraseña. También le sirve para entrar.">
              <input type="email" value={form.adminCorreo}
                onChange={(e) => setForm((f) => ({ ...f, adminCorreo: e.target.value }))}
                className={inputCls} placeholder="direccion@sucliente.com" />
            </Campo>
          </div>

          {/*
            A QUIÉN SE LE ESCRIBE (13/08/2026, el otro medio recado de Jorge del
            12/08). No había dónde apuntarlo: se daba por hecho que el campo de
            arriba servía, y no sirve — es el nombre de usuario con el que entra,
            puede no llevar arroba y si se deja vacío se lo inventa el alta. El
            día que Custodia dice que a un cliente le faltan cuatro credenciales,
            a quién se le pide estaba en la cabeza de alguien.
          */}
          <div className="grid md:grid-cols-3 gap-4">
            <Campo etiqueta="Correo de contacto" pista="A quién se le escribe cuando hay que pedirle algo.">
              <input type="email" value={form.contactoEmail}
                onChange={(e) => setForm((f) => ({ ...f, contactoEmail: e.target.value }))}
                className={inputCls} placeholder="maria@sucliente.com" />
            </Campo>
            <Campo etiqueta="Persona de contacto">
              <input value={form.contactoNombre}
                onChange={(e) => setForm((f) => ({ ...f, contactoNombre: e.target.value }))}
                className={inputCls} placeholder="María Ruiz" />
            </Campo>
            <Campo etiqueta="Teléfono">
              <input value={form.contactoTelefono}
                onChange={(e) => setForm((f) => ({ ...f, contactoTelefono: e.target.value }))}
                className={inputCls} placeholder="600 11 22 33" />
            </Campo>
          </div>

          {/* Módulos */}
          <div>
            <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-2">
              Módulos contratados ({resuelto.modulos.length})
            </div>

            {/*
              LAS DOS FORMAS, DICHAS (12/08/2026, Jorge: «que se puedan ambas
              formas, por paquetes y número de módulos personalizados, que es lo
              que tienen todos los tenants ahora»).

              Los paquetes ya estaban, pero como dos botones sueltos encima de
              las casillas: nada decía que fueran una manera de empezar, ni cuál
              se había usado. Ahora es una elección con su rótulo y su estado —
              y sigue sin guardarse en ninguna parte: en cuanto se toca una
              casilla, esto pasa a «Personalizado» y lo que se manda es la lista
              de módulos, como siempre.
            */}
            <div className="mb-4 rounded-lg border border-neutral-200 bg-neutral-50/60 px-3 py-2.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mr-1">
                  Cómo se monta
                </span>
                {(datos.paquetes ?? []).map((p) => {
                  const puesto = paquetePuesto === p.key;
                  return (
                    <button key={p.key} type="button" title={p.desc}
                      onClick={() => setForm((f) => ({ ...f, modulos: [...p.modulos] }))}
                      className={`px-3 py-1.5 rounded-lg border text-xs transition ${
                        puesto
                          ? "border-transparent text-white"
                          : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
                      }`}
                      style={puesto ? { background: "var(--color-primary, #1B3A2D)" } : undefined}>
                      {p.nombre}
                    </button>
                  );
                })}
                <button type="button"
                  onClick={() => setForm((f) => ({ ...f, modulos: [...(datos.recomendados ?? [])] }))}
                  className={`px-3 py-1.5 rounded-lg border text-xs transition ${
                    paquetePuesto === null
                      ? "border-neutral-400 bg-white text-neutral-800"
                      : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
                  }`}>
                  Personalizado
                </button>
              </div>
              <p className="text-[11px] text-neutral-500 mt-2">
                {paquetePuesto
                  ? "Un paquete solo marca sus casillas: desde aquí puedes añadir o quitar lo que haga falta, y deja de ser un paquete."
                  : `Personalizado: ${resuelto.modulos.length} módulo(s) marcados a mano. Es como está dado de alta todo el mundo.`}
              </p>
            </div>

            <div className="space-y-4">
              {datos.catalogo.map((g) => (
                <div key={g.grupo}>
                  <div className="text-[11px] font-semibold text-neutral-500 mb-1.5">{g.grupo}</div>
                  <div className="grid md:grid-cols-2 gap-x-4 gap-y-1.5">
                    {g.modulos.map((m) => {
                      const marcado = form.modulos.includes(m.key);
                      // Si alguien lo necesita, no se puede quitar. Y si no se
                      // puede marcar todavía, se dice qué falta — con el atajo
                      // para marcarlo, que si no hay que ir hacia atrás módulo
                      // a módulo hasta llegar a Clientes.
                      const necesitadoPor = marcado ? quienNecesita(m.key, form.modulos, exige) : [];
                      const fijo = necesitadoPor.length > 0;
                      const falta = marcado ? [] : faltaPara(m.key, form.modulos, exige);
                      const cadena = falta.length ? cadenaPara(m.key, form.modulos, exige, ordenModulos) : null;
                      const trabado = fijo || falta.length > 0;
                      return (
                        <label key={m.key}
                          className={`flex items-start gap-2.5 p-2 rounded-lg transition ${trabado ? "cursor-default" : "cursor-pointer"} ${marcado ? "bg-neutral-50" : falta.length ? "opacity-70" : "hover:bg-neutral-50/60"}`}>
                          <input type="checkbox" checked={marcado} disabled={trabado}
                            onChange={() => toggleModulo(m.key)}
                            className="mt-0.5 rounded border-neutral-300 accent-[var(--color-primary,#1B3A2D)] disabled:opacity-50" />
                          <div className="min-w-0">
                            <div className="text-sm text-neutral-800">{m.nombre}</div>
                            <div className="text-[11px] text-neutral-500 leading-snug">{m.desc}</div>
                            {fijo && (
                              <NotaDependencia>
                                no se puede quitar: lo necesita {necesitadoPor.map(nombreDe).join(", ")}
                              </NotaDependencia>
                            )}
                            {falta.length > 0 && (
                              <NotaDependencia tono="rojo">
                                {falta.map((p) => fraseExigencia(p, nombreDe)).join(" ")}
                                {cadena && cadena.sinResolver.length === 0 && (
                                  <button type="button"
                                    onClick={() => setForm((f) => ({ ...f, modulos: cadena.modulos }))}
                                    className="ml-1 underline underline-offset-2 hover:no-underline">
                                    marcar también {cadena.anadidos.map(nombreDe).join(" y ")}
                                  </button>
                                )}
                              </NotaDependencia>
                            )}
                            {m.avisa && marcado && (
                              <div className="text-[11px] text-amber-700 mt-0.5">⚠ {m.avisa}</div>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Red de seguridad: las notas de cada casilla se leen cuando ya
                sabes dónde mirar. Esto es lo que ve quien va a pulsar «Crear
                cliente» sin repasar la lista — con las casillas bloqueadas no
                debería salir nunca, y por eso mismo sale si sale. */}
            {resuelto.problemas.length > 0 && (
              <div className="mt-3 text-[11px] text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2 space-y-0.5">
                {resuelto.problemas.map((p, i) => (
                  <div key={i}>{fraseExigencia(p, nombreDe)}</div>
                ))}
              </div>
            )}
          </div>

          {/* Marca */}
          <details className="border-t border-neutral-100 pt-4">
            <summary className="text-sm font-medium text-neutral-700 cursor-pointer">Marca (opcional)</summary>
            <div className="grid md:grid-cols-3 gap-4 mt-3">
              <Campo etiqueta="Color principal" pista="Hex, p. ej. #563EA6">
                <div className="flex gap-2">
                  <input type="color" value={form.primaryColor || "#1B3A2D"}
                    onChange={(e) => setForm((f) => ({ ...f, primaryColor: e.target.value }))}
                    className="h-9 w-12 rounded border border-neutral-200 bg-white" />
                  <input value={form.primaryColor} onChange={(e) => setForm((f) => ({ ...f, primaryColor: e.target.value }))}
                    className={inputCls + " font-mono"} placeholder="#563EA6" />
                </div>
              </Campo>
              <Campo etiqueta="Color secundario">
                <div className="flex gap-2">
                  <input type="color" value={form.secondaryColor || "#15063F"}
                    onChange={(e) => setForm((f) => ({ ...f, secondaryColor: e.target.value }))}
                    className="h-9 w-12 rounded border border-neutral-200 bg-white" />
                  <input value={form.secondaryColor} onChange={(e) => setForm((f) => ({ ...f, secondaryColor: e.target.value }))}
                    className={inputCls + " font-mono"} placeholder="#15063F" />
                </div>
              </Campo>
              <Campo etiqueta="Logo (URL)" pista="Se puede subir después desde su Configuración.">
                <input value={form.logoUrl} onChange={(e) => setForm((f) => ({ ...f, logoUrl: e.target.value }))}
                  className={inputCls} placeholder="https://…/logo.png" />
              </Campo>
            </div>
          </details>

          {/* Fiscal */}
          <details className="border-t border-neutral-100 pt-4">
            <summary className="text-sm font-medium text-neutral-700 cursor-pointer">
              Datos fiscales (opcional, para su facturación)
            </summary>
            <div className="grid md:grid-cols-2 gap-4 mt-3">
              <Campo etiqueta="Razón social">
                <input value={form.fiscalName} onChange={(e) => setForm((f) => ({ ...f, fiscalName: e.target.value }))}
                  className={inputCls} placeholder="Centro Aumenta S.L." />
              </Campo>
              <Campo etiqueta="CIF / NIF">
                <input value={form.taxId} onChange={(e) => setForm((f) => ({ ...f, taxId: e.target.value }))}
                  className={inputCls} placeholder="B12345678" />
              </Campo>
              <Campo etiqueta="Dirección">
                <input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} className={inputCls} />
              </Campo>
              <div className="grid grid-cols-2 gap-3">
                <Campo etiqueta="Ciudad">
                  <input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} className={inputCls} />
                </Campo>
                <Campo etiqueta="C.P.">
                  <input value={form.zip} onChange={(e) => setForm((f) => ({ ...f, zip: e.target.value }))} className={inputCls} />
                </Campo>
              </div>
            </div>
            <p className="text-[10px] text-neutral-400 mt-2">
              Solo se guardan si el cliente lleva el módulo de Facturación. Si no, se rellenan luego.
            </p>
          </details>

          <div className="flex justify-end gap-2 pt-2 border-t border-neutral-100">
            <button type="button" onClick={() => setAbierto(false)}
              className="px-4 py-2 text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700">
              Cancelar
            </button>
            {/* El servidor lo vuelve a validar; esto evita el 422. */}
            <button type="submit" disabled={creando || resuelto.problemas.length > 0 || !pareceCorreo(form.adminCorreo)}
              className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-50"
              style={{ background: "var(--color-primary, #1B3A2D)" }}>
              {creando ? "Creando cliente…" : "Crear cliente"}
            </button>
          </div>
        </form>
      )}

      {/* Clientes existentes */}
      {datos && (
        <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between gap-3 flex-wrap">
            <span className="text-sm font-semibold text-neutral-700">
              Clientes en el CRM
              {!verSuspendidos && datos.suspendidos > 0 && (
                <span className="ml-2 font-normal text-[11px] text-neutral-400">
                  (sin {datos.suspendidos} suspendido{datos.suspendidos === 1 ? "" : "s"})
                </span>
              )}
            </span>
            <div className="flex items-center gap-3">
              {/* La puerta de vuelta. Solo se ofrece si hay alguno: un
                  interruptor que nunca cambia nada estorba. */}
              {(datos.suspendidos > 0 || verSuspendidos) && (
                <button
                  type="button"
                  onClick={() => setVerSuspendidos((v) => !v)}
                  className="text-[11px] text-neutral-500 hover:text-neutral-800 underline underline-offset-2"
                >
                  {verSuspendidos ? "ocultar suspendidos" : `ver los ${datos.suspendidos} suspendidos`}
                </button>
              )}
              <span className="text-[10px] text-neutral-400 uppercase tracking-widest">{datos.clientes.length}</span>
            </div>
          </div>
          <ul className="divide-y divide-neutral-100">
            {datos.clientes.map((c) => (
              <li key={c.id} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-neutral-800">{c.nombre}</span>
                    <span className="text-[11px] text-neutral-400 font-mono ml-2">{c.slug}</span>
                    {c.estado !== "active" && (
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100">
                        {c.estado}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[11px] text-neutral-400">
                      {c.modulos.length} módulo{c.modulos.length === 1 ? "" : "s"}
                    </span>
                    <button
                      onClick={() => { setEditando(editando === c.slug ? null : c.slug); setAvisosEdit([]); }}
                      className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 hover:text-neutral-900"
                    >
                      {editando === c.slug ? "Cerrar" : "Editar"}
                    </button>
                  </div>
                </div>
                <div className="text-[11px] text-neutral-400 mt-1 truncate">{c.modulos.join(" · ") || "sin módulos"}</div>
                {editando === c.slug && datos && (
                  <EditorCliente
                    cliente={c}
                    catalogo={datos.catalogo}
                    onGuardar={guardarEdicion}
                    onBaja={cerrarCuenta}
                    guardando={guardando}
                    avisos={avisosEdit}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Las cuentas cerradas que siguen apartadas, y su segundo acto. */}
      <CuentasCerradas bajas={bajas} onEliminada={cargarBajas} />

      {/* Avisos del alta (p.ej. migraciones que no se pudieron aplicar). Van
          FUERA del modal de credenciales para que no se cierren con él: son
          cosas que hay que hacer, no un "hecho". */}
      {avisos.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-start justify-between gap-3 mb-1.5">
            <div className="text-[11px] font-bold uppercase tracking-wide text-amber-800">
              El alta terminó, pero queda algo por hacer
            </div>
            <button onClick={() => setAvisos([])} className="text-[11px] text-amber-700 hover:underline shrink-0">
              Entendido
            </button>
          </div>
          <ul className="space-y-1">
            {avisos.map((a, i) => (
              <li key={i} className="text-xs text-amber-900 break-words">{a}</li>
            ))}
          </ul>
        </div>
      )}

      {baja && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: "rgba(15,23,42,0.55)" }}
          role="dialog" aria-modal="true">
          <div className="w-full max-w-xl rounded-xl bg-white shadow-xl p-6 space-y-4 max-h-[85dvh] overflow-auto">
            <div>
              <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">Cuenta cerrada</div>
              <h2 className="text-xl font-semibold text-neutral-900 mt-1">{baja.nombre}</h2>
            </div>

            <ul className="text-sm text-neutral-700 space-y-1">
              <li>· {baja.modulos} módulos, {baja.usuarios} usuarios y su ficha, fuera de master.</li>
              {baja.schemaApartado && <li>· Su schema, apartado como <code className="text-xs">{baja.schemaApartado}</code>.</li>}
              {baja.ficheros.movidos > 0 && <li>· {baja.ficheros.movidos} ficheros movidos a <code className="text-xs">{baja.ficheros.carpeta}</code>.</li>}
            </ul>

            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
              <div className="text-[11px] font-semibold text-emerald-900 uppercase tracking-wide mb-1.5">
                Para deshacerlo
              </div>
              <code className="block text-[12px] text-emerald-950 break-all">psql &lt; {baja.rollback}</code>
              <p className="text-[11px] text-emerald-800 mt-2 leading-relaxed">
                Apunta esta ruta: es lo único que hace reversible la baja, y el fichero caduca.
                Sus ficheros no vuelven con ese comando — hay que mover las carpetas a mano.
              </p>
            </div>

            {baja.ficheros.errores?.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-900">
                No se han podido apartar todos sus ficheros: {baja.ficheros.errores.join("; ")}
              </div>
            )}

            <div className="flex justify-end">
              <button type="button" onClick={() => setBaja(null)}
                className="px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wide text-white"
                style={{ background: "var(--color-primary, #1B3A2D)" }}>
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {credenciales && (
        <CredentialsModal
          username={credenciales.username}
          password={credenciales.password}
          title={`Cliente «${credenciales.slug}» creado`}
          onClose={() => setCredenciales(null)}
        />
      )}
    </div>
  );
}
