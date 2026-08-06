/**
 * _smoke-borrar-paciente.mjs — qué se lleva por delante borrar a un paciente
 * (06/08/2026, Rodrigo).
 *
 * Lógica pura, sin base de datos:
 *   node scripts/_smoke-borrar-paciente.mjs
 *
 * Lo que se fija:
 *   · se borran sus documentos (fila) y se intenta borrar el fichero;
 *   · se borran las citas FUTURAS;
 *   · las PASADAS no se tocan — son la prueba del trabajo hecho, y esa es la
 *     mitad del cambio que se rompería sin que nadie lo notara hasta que a
 *     alguien le faltara un historial;
 *   · las citas se buscan por ficha Y por correo (la valoración inicial se pide
 *     antes de que exista la ficha);
 *   · si algo falla, no se rompe el borrado: devuelve el recuento igual.
 */

import { borrarRastroDelCliente } from "../lib/clients/borrarRastro.js";

let fallos = 0;
function check(etiqueta, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  process.stdout.write(`${ok ? "✓" : "✗"} ${etiqueta}\n`);
  if (!ok) process.stdout.write(`    esperado ${JSON.stringify(esperado)}, salió ${JSON.stringify(real)}\n`);
}

// Modelos de mentira que apuntan lo que se les pide.
function modelos({ documentos = [], fallaDocumentos = false } = {}) {
  const visto = { documentDestroy: null, bookingDestroy: null };
  return {
    visto,
    tenantModels: {
      Document: {
        findAll: async () => {
          if (fallaDocumentos) throw new Error("boom");
          return documentos;
        },
        destroy: async ({ where }) => {
          visto.documentDestroy = where;
          return documentos.length;
        },
      },
      Booking: {
        destroy: async ({ where }) => {
          visto.bookingDestroy = where;
          return 2;
        },
      },
    },
  };
}

const simbolos = (obj) => Object.getOwnPropertySymbols(obj);

process.stdout.write("\n▶ Lo que borra\n");
{
  // Ruta con la forma real (documents/{tenant}/{cliente}/{id}.ext): así el
  // borrado del fichero llega hasta el disco y falla por no existir —que es lo
  // que tiene que hacer, en silencio— en vez de rebotar en la validación.
  const ruta = "documents/nutri_laura/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.pdf";
  const m = modelos({ documentos: [{ id: "d1", storagePath: ruta }, { id: "d2", storagePath: null }] });
  const cuenta = await borrarRastroDelCliente({
    tenantModels: m.tenantModels,
    tenantSlug: "nutri_laura",
    clientId: "cli-1",
    clientEmail: "paciente@ejemplo.com",
  });
  check("cuenta los documentos borrados", cuenta.documentos, 2);
  check("y las citas futuras", cuenta.citasFuturas, 2);
  check("los documentos, solo los de su ficha", m.visto.documentDestroy, { clientId: "cli-1" });

  const where = m.visto.bookingDestroy ?? {};
  const orKey = simbolos(where).find((s) => String(s) === "Symbol(or)");
  check("las citas se buscan por ficha Y por correo", (where[orKey] ?? []).length, 2);

  const fecha = where.scheduledAt ?? {};
  const gtKey = simbolos(fecha).find((s) => String(s) === "Symbol(gt)");
  check("solo las que aún no han ocurrido", !!gtKey, true);
  const corte = fecha[gtKey];
  check("el corte es la hora actual, no el día", corte instanceof Date, true);
  check("y mira al futuro", corte.getTime() > Date.now() - 5000, true);
}

process.stdout.write("\n▶ Sin correo (ficha sin email)\n");
{
  const m = modelos({ documentos: [] });
  await borrarRastroDelCliente({
    tenantModels: m.tenantModels,
    tenantSlug: "nutri_laura",
    clientId: "cli-2",
    clientEmail: null,
  });
  const where = m.visto.bookingDestroy ?? {};
  const orKey = simbolos(where).find((s) => String(s) === "Symbol(or)");
  check("solo se busca por ficha", (where[orKey] ?? []).length, 1);
  check("sin documentos, no se llama a destroy", m.visto.documentDestroy, null);
}

process.stdout.write("\n▶ Si algo falla, el borrado sigue\n");
{
  const m = modelos({ fallaDocumentos: true });
  const cuenta = await borrarRastroDelCliente({
    tenantModels: m.tenantModels,
    tenantSlug: "nutri_laura",
    clientId: "cli-3",
    clientEmail: "otra@ejemplo.com",
  });
  check("no lanza", cuenta.documentos, 0);
  check("y las citas se borran igual", cuenta.citasFuturas, 2);
}

process.stdout.write("\n▶ Sin ficha no hace nada\n");
{
  const m = modelos({});
  const cuenta = await borrarRastroDelCliente({ tenantModels: m.tenantModels, tenantSlug: "x", clientId: null });
  check("recuento a cero", cuenta, { documentos: 0, citasFuturas: 0 });
  check("y no toca las citas", m.visto.bookingDestroy, null);
}

process.stdout.write(
  fallos === 0 ? "\n✓ Todo correcto\n\n" : `\n✗ ${fallos} comprobacion(es) fallidas\n\n`
);
process.exit(fallos === 0 ? 0 : 1);
