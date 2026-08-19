/**
 * update-somos-brand.js — Paleta de colores del tenant Somos
 *
 * Jorge, 12/08/2026: el azul pasa a principal y el naranja a secundario.
 *
 *   nació →  primary #F59C00 (naranja)   secondary #4BBDCF (turquesa claro)
 *   ahora →  primary #124A55 (azul petróleo) secondary #F59C00 (naranja)
 *
 * ── POR QUÉ EL AZUL ES TAN OSCURO Y NO EL #4BBDCF DE SU MARCA ───────────────
 * Porque `primaryColor` NO es un acento: es el FONDO del sidebar
 * (`components/layout/Sidebar.jsx:432`), y encima va texto blanco a opacidades
 * que bajan hasta el 30%. Con el turquesa claro los números eran:
 *
 *   blanco sobre #4BBDCF ......... 2,22:1   (hace falta 4,5:1 para leer)
 *   el naranja sobre #4BBDCF ..... 1,02:1   (invisible, literalmente)
 *
 * Con #124A55 quedan en 9,83:1 y 4,51:1, dentro de la banda de los fondos de
 * sidebar que ya funcionan: Retorika 8,93 · Aumenta 7,97 · Salamandra 12,43.
 *
 * Si alguien quiere devolverle el turquesa claro a la marca, el sitio es el
 * ACENTO, no este campo — o habría que cambiar el color del texto del sidebar,
 * que es común a todos los clientes.
 *
 * Los valores van ESCRITOS, no se leen y se intercambian. Un script que
 * intercambia lo que encuentre deja de ser idempotente: correrlo dos veces lo
 * devolvería al principio, y estos scripts se corren de más constantemente.
 *
 * Uso local:  node --env-file=.env.local scripts/update-somos-brand.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/update-somos-brand.js
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { invalidateTenantCache } from "../lib/tenant/tenantResolver.js";

const SLUG = "somos";

const COLORES = {
  primaryColor: "#124A55",   // azul petróleo — fondo del sidebar
  secondaryColor: "#F59C00", // naranja de su marca
};

async function main() {
  process.stdout.write("\n▶ Paleta de Somos: azul petróleo de fondo, naranja de acento\n");

  getMasterDb();
  const { Tenant } = getMasterModels();

  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) {
    process.stderr.write(`  ✗ El cliente "${SLUG}" no existe en esta base de datos.\n`);
    process.exit(1);
  }

  const brandAntes = tenant.settings?.brand ?? {};
  process.stdout.write(
    `  · antes: primary=${brandAntes.primaryColor ?? "—"} secondary=${brandAntes.secondaryColor ?? "—"}\n`
  );

  // Se hace MERGE sobre el brand que haya, no se reemplaza entero: hoy solo
  // tiene los dos colores, pero si mañana alguien le pone el logo desde
  // Configuración, este script no debe borrárselo al correrse otra vez.
  const settings = {
    ...(tenant.settings ?? {}),
    brand: { ...brandAntes, ...COLORES },
  };
  await tenant.update({ settings });

  // Solo limpia la caché de ESTE proceso; la de la app son 60 s y se renueva
  // sola. Se llama igual que en los scripts hermanos, por si algún día esto se
  // ejecuta desde dentro de la aplicación.
  invalidateTenantCache(SLUG);

  const comprobado = await Tenant.findOne({ where: { slug: SLUG } });
  const brandDespues = comprobado.settings?.brand ?? {};
  process.stdout.write(
    `  ✓ ahora: primary=${brandDespues.primaryColor} secondary=${brandDespues.secondaryColor}\n`
  );
  process.stdout.write("  · El dashboard lo coge al recargar (hasta 60 s por la caché del tenant).\n\n");
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
