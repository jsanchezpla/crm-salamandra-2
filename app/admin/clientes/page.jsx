"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import CredentialsModal from "@/components/team/CredentialsModal.jsx";

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

function EditorCliente({ cliente, catalogo, onGuardar, guardando, avisos }) {
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
    logoUrl: cliente.marca?.logoUrl ?? "",
  });

  const [confirmando, setConfirmando] = useState(false);

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
    (f.logoUrl || "") !== (cliente.marca?.logoUrl ?? "");

  const contraste = contrasteConBlanco(f.primaryColor);
  const menuIlegible = contraste !== null && contraste < 4.5;

  const hayCambios =
    f.nombre !== cliente.nombre || marcaTocada || nuevos.length > 0 || quitados.length > 0;

  const cambiosAMandar = () => ({
    nombre: f.nombre,
    modulos: resuelto.modulos,
    ...(marcaTocada
      ? { brand: { primaryColor: f.primaryColor, secondaryColor: f.secondaryColor, logoUrl: f.logoUrl } }
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
          <Campo etiqueta="Logo (URL)">
            <input value={f.logoUrl} onChange={(e) => setF((p) => ({ ...p, logoUrl: e.target.value }))}
              className={inputCls} placeholder="https://…/logo.png" />
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
        <button type="button" onClick={suspender} disabled={guardando}
          className={`text-xs font-semibold uppercase tracking-wide disabled:opacity-40 ${
            cliente.estado === "suspended" ? "text-emerald-700" : "text-red-700"
          }`}>
          {cliente.estado === "suspended" ? "Reactivar cliente" : "Suspender cliente"}
        </button>
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

  const [form, setForm] = useState({
    nombre: "",
    slug: "",
    slugTocado: false,
    adminEmail: "",
    modulos: [],
    primaryColor: "",
    secondaryColor: "",
    logoUrl: "",
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
          // La lista RESUELTA: lo que la pantalla acaba de enseñar marcado.
          modulos: resuelto.modulos,
          brand: { primaryColor: form.primaryColor, secondaryColor: form.secondaryColor, logoUrl: form.logoUrl },
          fiscal: { fiscalName: form.fiscalName, taxId: form.taxId, address: form.address, city: form.city, zip: form.zip },
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo crear el cliente");
      setCredenciales({ username: j.data.adminEmail, password: j.data.password, slug: j.data.slug, modulos: j.data.modulos });
      setAvisos(Array.isArray(j.data.avisos) ? j.data.avisos : []);
      setAbierto(false);
      setForm((f) => ({ ...f, nombre: "", slug: "", slugTocado: false, adminEmail: "", fiscalName: "", taxId: "", address: "", city: "", zip: "" }));
      cargar();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setCreando(false);
    }
  }

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto my-6 lg:my-10 rounded-xl bg-[#FAF9F7] text-neutral-800 shadow-[0_2px_40px_rgba(0,0,0,0.5)]">
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

          <Campo etiqueta="Usuario administrador" pista="Si lo dejas vacío se crea admin_{identificador}. La contraseña se genera sola y se enseña una vez.">
            <input value={form.adminEmail} onChange={(e) => setForm((f) => ({ ...f, adminEmail: e.target.value }))}
              className={inputCls} placeholder="direccion@sucliente.com" />
          </Campo>

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
            <button type="submit" disabled={creando || resuelto.problemas.length > 0}
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
                    guardando={guardando}
                    avisos={avisosEdit}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

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
