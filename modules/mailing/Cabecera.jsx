"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Cabecera — el título y las pestañas de las pantallas de Mailing, y los
 * avisos de arriba (SES sin configurar, demo, sandbox de AWS). Las pestañas
 * son páginas de verdad (cada una con su `notFound()` en el servidor), no
 * estado de cliente: se puede enlazar a /mailing/lista.
 */
const PESTANAS = [
  { href: "/mailing", label: "Campañas" },
  { href: "/mailing/lista", label: "Lista" },
  { href: "/mailing/segmentos", label: "Segmentos" },
  { href: "/mailing/bajas", label: "Bajas" },
];

export default function Cabecera({ titulo = "Mailing", subtitulo, estado, derecha = null }) {
  const pathname = usePathname();
  const ses = estado?.ses;
  return (
    <header className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{titulo}</h1>
          {subtitulo && <p className="text-gray-500 text-sm mt-0.5">{subtitulo}</p>}
        </div>
        {derecha}
      </div>

      <nav className="mt-4 flex gap-1 border-b border-neutral-200 overflow-x-auto">
        {PESTANAS.map((p) => {
          const activa = p.href === "/mailing" ? pathname === "/mailing" || /^\/mailing\/[0-9a-f-]{36}$/i.test(pathname ?? "") : pathname?.startsWith(p.href);
          return (
            <Link
              key={p.href}
              href={p.href}
              className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition ${
                activa ? "border-[var(--color-primary,#1B3A2D)] text-gray-900 font-semibold" : "border-transparent text-gray-500 hover:text-gray-800"
              }`}
            >
              {p.label}
            </Link>
          );
        })}
      </nav>

      {estado && (
        <div className="mt-4 space-y-2">
          {estado.demo && (
            <div className="rounded-lg border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-900">
              <strong className="font-semibold">Demo.</strong> Aquí se puede mirar y editar todo, pero el botón de enviar está bloqueado: la demo es pública y no manda correo a nadie.
            </div>
          )}
          {!estado.demo && ses && !ses.configurado && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <strong className="font-semibold">Todavía no se puede enviar.</strong> Falta la cuenta de Amazon SES (clave, región y remitente).{" "}
              {estado.puedeConfigurar ? (
                <>Se pone en <Link className="underline" href="/configuracion?pestana=conexiones">Configuración → Conexiones → Amazon SES</Link>.</>
              ) : (
                <>Lo tiene que resolver quien administre el CRM.</>
              )}
            </div>
          )}
          {!estado.demo && ses?.configurado && ses.cuenta?.ok && ses.cuenta.sandbox && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <strong className="font-semibold">La cuenta de AWS sigue en modo de pruebas.</strong> Solo deja escribir a direcciones verificadas y {ses.cuenta.max24h} correos al día. Hay que pedir acceso a producción en la consola de SES (es un formulario, una vez).
            </div>
          )}
          {!estado.demo && ses?.configurado && ses.cuenta && !ses.cuenta.ok && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
              <strong className="font-semibold">AWS no responde con estas credenciales.</strong> {ses.cuenta.error} ({ses.cuenta.tipo}). Revísalas en Configuración → Conexiones.
            </div>
          )}
          {!estado.demo && ses?.configurado && ses.remitente?.ok && ses.remitente.verificado === false && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <strong className="font-semibold">El remitente {ses.fromEmail} no está verificado en SES.</strong> Verifica su dominio (o esa dirección) en SES → Identities o AWS rechazará los envíos.
            </div>
          )}
        </div>
      )}
    </header>
  );
}
