"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import HelpTooltip from "../../components/ui/HelpTooltip.jsx";
import { anchoPantalla } from "../../components/layout/anchoPantalla.js";
import { textosPortada } from "../../lib/training/formacionAbierta.js";

/**
 * ── UNA PORTADA PARA TODOS, «COMPLETA» O «ABIERTA» (18/08/2026) ─────────────
 *
 * Hasta hoy Aumenta tenía la suya en `modules/overrides/aumenta/`: la misma
 * pantalla con tres tarjetas en vez de cinco (sin Empresas ni Cuestionarios),
 * tres cifras en vez de cuatro, sin el botón de sincronizar con WordPress y
 * con sus frases. Era la portada base recortada y copiada, y cada arreglo
 * había que hacerlo dos veces (los propios comentarios de abajo lo cuentan).
 *
 * Ahora es UNA portada con un interruptor: la prop `abierta`, que la página
 * resuelve leyendo `featureFlags.formacionAbierta` del módulo `training` del
 * tenant (`lib/training/formacionAbierta.js`, donde está explicado qué es y
 * por qué no se leen las banderas viejas de `logicOverrides`). Con `abierta`:
 * fuera Empresas y Cuestionarios (tarjetas y cifra), fuera «Sincronizar con la
 * web», y las palabras de formación abierta. Las frases que solo son de un
 * cliente —el párrafo de Aumenta sobre su centro— llegan por `textos` desde la
 * página, no viven aquí.
 *
 * ── LAS PERSONAS SON «ALUMNOS» Y LAS INSCRIPCIONES «MATRÍCULAS» ─────────────
 * (13/08/2026, decisión de Rodrigo.)
 *
 * Antes había TRES pares de palabras para las mismas dos cosas: el menú y las
 * tarjetas decían «Usuarios» y «Alumnos por curso», las métricas de aquí arriba
 * decían «Usuarios» y «Matrículas», y el override de Aumenta llamaba «Alumnos» a
 * las personas. Con tres vocabularios, quien entra por primera vez no sabe en
 * cuál de las dos pantallas se dan de alta alumnos.
 *
 * La prueba de que no se entendía estaba escrita en la propia ayuda de Empresas,
 * en mayúsculas: «IMPORTANTE: los alumnos de empresa se importan desde aquí» —
 * porque quien quería dar de alta alumnos entraba en «Usuarios», que es donde no
 * se hace. Ese aviso a gritos ya no hace falta y se ha quitado: lo que dice
 * ahora es una frase normal, y además está en las dos pantallas.
 *
 * Las RUTAS no se han tocado (`/formacion/usuarios` y `/formacion/alumnos`):
 * cambiarlas rompería enlaces guardados por cinco clientes a cambio de nada. Es
 * el mismo criterio que en Nutrición, donde `/nutricion/asignados` se llama
 * «Pautas».
 */
/**
 * Las tarjetas de acceso. `soloCompleta` marca las que una formación abierta
 * no ofrece; los textos que cambian entre completa y abierta llegan en
 * `textos` (los de Empresas y Cuestionarios no cambian: cuando se ven, es
 * porque el centro los usa como siempre).
 */
function seccionesDe(textos, abierta) {
  const todas = [
  {
    soloCompleta: true,
    href: "/formacion/empresas",
    label: "Empresas",
    desc: "Gestión de empresas cliente y cursos asignados",
    help: "Aquí ves todas las empresas que tienen alumnos en tu plataforma de formación. Puedes crear una nueva empresa, abrir cada ficha para ver sus empleados y qué cursos tienen asignados. Los alumnos que vienen de una empresa se dan de alta desde aquí: entra en su ficha y usa «Importar empleados» con un Excel.",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
      </svg>
    ),
  },
  {
    href: "/formacion/cursos",
    label: "Cursos",
    desc: textos.descCursos,
    help: textos.ayudaCursos,
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
      </svg>
    ),
  },
  {
    href: "/formacion/usuarios",
    label: "Alumnos",
    desc: textos.descAlumnos,
    help: textos.ayudaAlumnos,
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-4.5 0 2.625 2.625 0 014.5 0z" />
      </svg>
    ),
  },
  {
    href: "/formacion/alumnos",
    label: "Matrículas",
    desc: textos.descMatriculas,
    help: textos.ayudaMatriculas,
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
      </svg>
    ),
  },
  {
    soloCompleta: true,
    href: "/formacion/cuestionarios",
    label: "Cuestionarios",
    desc: "Intentos de quiz sincronizados con TutorLMS",
    help: "Los exámenes que han hecho tus alumnos. Cada línea es un intento: ves quién lo hizo, en qué curso, cuántas preguntas acertó y si aprobó o suspendió. Al abrir uno verás todas las preguntas con la respuesta del alumno y la correcta.",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
      </svg>
    ),
  },
  ];
  return abierta ? todas.filter((s) => !s.soloCompleta) : todas;
}

// Los rótulos son los MISMOS que los de las tarjetas de abajo, a propósito: eran
// un tercer par de palabras («Usuarios» / «Matrículas») para las dos cosas que
// el menú llamaba de otra forma.
function metricHelpDe(textos) {
  return {
    Empresas: "Número total de empresas dadas de alta en tu plataforma de formación.",
    "Cursos activos": "Cursos que actualmente están visibles para los alumnos. Los cursos desactivados no cuentan aquí.",
    Alumnos: textos.metricaAlumnos,
    Matrículas: "Inscripciones a cursos. Si un alumno está apuntado a 3 cursos, cuenta 3 veces — por eso este número suele ser mayor que el de Alumnos.",
  };
}

/*
 * El número va ABAJO, no debajo del rótulo (14/08/2026).
 *
 * Al estrechar la portada, «Cursos activos» dejó de caber en una línea —necesita
 * 136 px y tiene 122— y su número se quedó 16 px por debajo de los otros tres.
 * Cuatro cifras grandes desalineadas se ven antes que el motivo.
 *
 * `justify-between` en una tarjeta que ya estira a la altura de la fila (son
 * celdas de un grid) los deja a la misma altura sea cual sea el rótulo, en vez
 * de depender de que ninguno crezca. Que es lo que pasa en cuanto se añade una
 * métrica o el cliente le cambia el nombre.
 */
function MetricCard({ label, value, loading, help }) {
  return (
    <div className="bg-white border border-neutral-100 rounded-xl p-5 flex flex-col justify-between">
      <div className="flex items-center gap-1.5 mb-2">
        <p className="text-[11px] font-medium text-neutral-400 uppercase tracking-widest">{label}</p>
        {help && (
          <HelpTooltip title={label} placement="bottom">
            {help}
          </HelpTooltip>
        )}
      </div>
      {loading ? (
        <div className="h-8 w-16 bg-neutral-100 rounded animate-pulse" />
      ) : (
        <p
          className="text-3xl font-extrabold"
          style={{ fontFamily: "'Syne', sans-serif", color: "var(--color-primary)" }}
        >
          {value ?? "—"}
        </p>
      )}
    </div>
  );
}

/**
 * «Sincronizar con la web» (05/08/2026, Rodrigo).
 *
 * Lo del día a día ya va solo: publicar un curso o matricular a alguien avisa al
 * CRM en el momento. Esto es para PONERSE AL DÍA cuando algo no llegó — que es
 * lo que pasó en julio, con el puente roto durante días sin que nadie lo notara.
 *
 * Tarda: recorre todos los cursos y todas las matrículas de la web. Por eso el
 * botón dice lo que está haciendo en vez de quedarse mudo.
 */
function SincronizarConLaWeb() {
  const [estado, setEstado] = useState(null); // { ok, mensaje }
  const [trabajando, setTrabajando] = useState(false);

  async function sincronizar() {
    setEstado(null);
    setTrabajando(true);
    try {
      const r = await fetch("/api/training/sync", { method: "POST" });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error || "No se pudo sincronizar");
      setEstado({ ok: !!j?.data?.ok, mensaje: j?.data?.mensaje || "Hecho." });
    } catch (e) {
      setEstado({ ok: false, mensaje: e.message });
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <div className="bg-white border border-neutral-100 rounded-xl p-5 mb-8 flex items-start justify-between gap-4 flex-wrap">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-[var(--ink-900)]">Sincronizar con la web</div>
        <p className="text-xs text-[var(--ink-500)] mt-0.5 max-w-lg leading-relaxed">
          Trae de golpe todos los cursos y todas las matrículas de tu WordPress. No hace falta para
          el día a día —al publicar un curso o matricularse una alumna, el CRM se entera solo—, pero
          viene bien si sospechas que algo no ha llegado. Repetirlo no duplica nada.
        </p>
        {estado && (
          <p className={`text-xs mt-2 ${estado.ok ? "text-emerald-700" : "text-amber-700"}`}>
            {estado.ok ? "✓" : "⚠"} {estado.mensaje}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={sincronizar}
        disabled={trabajando}
        className="shrink-0 bg-[var(--ink-900)] text-white text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
      >
        {trabajando ? "Sincronizando…" : "Sincronizar todo"}
      </button>
    </div>
  );
}

export default function FormacionOverview({ abierta = false, textos: textosProp }) {
  // Las palabras: las de completa o abierta, y encima las que el tenant tenga
  // propias (la página se las pasa; hoy solo Aumenta).
  const textos = { ...textosPortada(abierta), ...(textosProp ?? {}) };
  const SECTIONS = seccionesDe(textos, abierta);
  const METRIC_HELP = metricHelpDe(textos);

  const [stats, setStats] = useState({ companies: null, courses: null, users: null, enrollments: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // En formación abierta no hay empresas que contar: ni se pide.
    const empresas = abierta
      ? Promise.resolve({ ok: false })
      : fetch("/api/training/companies").then((r) => r.json());
    Promise.all([
      empresas,
      fetch("/api/training/courses?active=true").then((r) => r.json()),
      fetch("/api/training/users?limit=1").then((r) => r.json()),
      fetch("/api/training/enrollments?limit=1").then((r) => r.json()),
    ])
      .then(([companies, courses, users, enrollments]) => {
        setStats({
          companies: companies.ok ? companies.data.length : 0,
          courses: courses.ok ? courses.data.length : 0,
          users: users.ok ? users.data.total : 0,
          enrollments: enrollments.ok ? enrollments.data.total : 0,
        });
      })
      .finally(() => setLoading(false));
  }, [abierta]);

  return (
    // El ancho ya NO se escribe aquí (13/08/2026). Esta pantalla se estrechó una
    // vez el 27/07 —venía copiada del workspace de Clientes, con p-10 y una
    // banda de 72rem— y seguía viéndose ancha, porque el arreglo tocó estas dos
    // portadas y las otras cinco pantallas del módulo se quedaron cada una con
    // el suyo. Ahora lo decide `components/layout/anchoPantalla.js`, que es donde
    // está explicado por qué esto volvía cada vez.
    <div className={anchoPantalla("portada")}>
      {/* Header */}
      <div className="mb-6 lg:mb-8">
        <div className="eyebrow mb-1.5 lg:mb-2">{textos.eyebrow}</div>
        <h1 className="font-display text-2xl lg:text-4xl text-[var(--ink-900)] tracking-tight mb-3 flex items-center gap-2">
          <span>
            Formación <span className="font-display-italic text-[var(--ink-400)]">{textos.tituloSufijo}</span>
          </span>
          <HelpTooltip title="Módulo de Formación" placement="bottom">
            {textos.ayudaModulo}
          </HelpTooltip>
        </h1>
        <p className="text-sm text-[var(--ink-500)] max-w-xl leading-relaxed">
          {textos.intro}
        </p>
      </div>

      {/* Sin WordPress detrás no hay nada que sincronizar. */}
      {!abierta && <SincronizarConLaWeb />}

      {/* Métricas: cuatro, o tres sin Empresas en formación abierta. */}
      <div className={`grid gap-4 mb-8 ${abierta ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-2 lg:grid-cols-4"}`}>
        {!abierta && (
          <MetricCard label="Empresas" value={stats.companies} loading={loading} help={METRIC_HELP.Empresas} />
        )}
        <MetricCard label="Cursos activos" value={stats.courses} loading={loading} help={METRIC_HELP["Cursos activos"]} />
        <MetricCard label="Alumnos" value={stats.users} loading={loading} help={METRIC_HELP.Alumnos} />
        <MetricCard label="Matrículas" value={stats.enrollments} loading={loading} help={METRIC_HELP.Matrículas} />
      </div>

      {/* Accesos rápidos. TRES columnas en pantalla grande, y no es un capricho:
          va atado a que la portada sea `max-w-7xl` (24/08/2026). A dos columnas
          en ese ancho, cada tarjeta se iría a ~590 px para un icono de 40 y dos
          líneas de texto — el «cajas grandes con el texto pegado a la izquierda»
          que ya se arregló una vez. Ver components/layout/anchoPantalla.js. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {SECTIONS.map((s) => (
          <div
            key={s.href}
            className="group bg-white border border-neutral-100 rounded-xl p-5 flex items-start gap-4 transition-all hover:shadow-md hover:border-neutral-200 relative"
          >
            <Link href={s.href} className="absolute inset-0 rounded-xl" aria-label={s.label} />
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-colors"
              style={{ background: "color-mix(in srgb, var(--color-primary) 10%, white)" }}
            >
              <span style={{ color: "var(--color-primary)" }}>{s.icon}</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 mb-0.5">
                <p
                  className="text-sm font-bold text-neutral-900"
                  style={{ fontFamily: "'Syne', sans-serif" }}
                >
                  {s.label}
                </p>
                {/* z-10 para que el botón quede por encima del Link absoluto */}
                <span className="relative z-10">
                  <HelpTooltip title={s.label} placement="bottom">
                    {s.help}
                  </HelpTooltip>
                </span>
              </div>
              <p className="text-xs text-neutral-400">{s.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
