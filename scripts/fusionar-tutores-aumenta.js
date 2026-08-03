/**
 * fusionar-tutores-aumenta.js — deja un solo tutor donde Organízate dejó dos.
 *
 * ⚠️ SIMULA POR DEFECTO. Sin `--confirm` no escribe nada.
 *
 * ── De dónde sale ──────────────────────────────────────────────────────────
 *
 * La auditoría encontró 46 familias con dos (o tres) tutores que son la misma
 * persona tecleada de varias formas en Organízate. **Ninguna se decidió por
 * parecido**: la lista se le pasó a Rodrigo en PDF y él fue diciendo, una a
 * una, cuál era la buena (02-03/08/2026). Esta tabla es su respuesta.
 *
 * Por qué no lo decide un algoritmo: entre esas 46 hay parejas que NO son la
 * misma persona —«Adriah Podari» y «María Podari» son dos— y hay casos en los
 * que el nombre correcto es el que MENOS se parece al de la ficha. Fundir a dos
 * familiares de un menor por parecido sería peor que dejarlos separados.
 *
 * ── Qué hace con los datos ─────────────────────────────────────────────────
 *
 * El tutor que se va puede tener un teléfono, un correo o un DNI que al que se
 * queda le faltan. Antes de borrarlo se le pasan esos huecos: se fusiona, no se
 * descarta. Lo que ya tenga el bueno NUNCA se pisa.
 *
 * Uso:
 *   node --env-file=.env.local scripts/fusionar-tutores-aumenta.js
 *   docker exec crm-salamandra-app-1 node scripts/fusionar-tutores-aumenta.js --confirm
 */

import { getTenantDb } from "../lib/db/tenantDb.js";

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const SLUG = args.includes("--tenant") ? args[args.indexOf("--tenant") + 1] : "aumenta";

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();

/**
 * Decisiones de Rodrigo. `familia` es el nombre de la ficha; `queda` el tutor
 * bueno; `fuera` los que se borran.
 *
 * `nombreNuevo` es para el único caso en el que no valía ninguna de las dos
 * opciones tal cual: el apellido lleva guion pero sin espacios.
 */
const DECISIONES = [
  { familia: "AINARA BARRA CAMINOS", queda: "AINARA IBARRA CAMINOS", fuera: ["AINARA BARRA CAMINOS"] },
  { familia: "ALEJANDRO CONESA FERNÁNEZ", queda: "ALEJANDRO CONESA FERNÁNDEZ", fuera: ["ALEJANDRO CONESA FERNÁNEZ"] },
  { familia: "ALFONSO PÉREZ HERNÁNDEZ", queda: "ALFONSO PÉREZ HERNÁNDEZ", fuera: ["ALFONSO  PÉREZ HERNÁNZDEZ"] },
  { familia: "ANA BELÉN YUSTRES CATALÁN", queda: "ANA BELÉN YUSTRES CATALÁN", fuera: ["Ana Belén Yustres Catatlán"] },
  { familia: "ANA ISABEL MORENO-MANZANERO HERNÁNDEZ", queda: "ANA ISABEL MORENO-MANZANERO HERNÁNDEZ", fuera: ["ANA ISABEL MORENO-MANZANARO HERNÁNEZ"] },
  { familia: "Ana María Cano Macareno", queda: "Ana María Cano Macareno", fuera: ["Ana María  Cano Macarena"] },
  { familia: "Ángel Rocano López", queda: "Ángel Rocano López", fuera: ["Ángel Rocano Pérez"] },
  // El único con nombre nuevo: ni «Santana -Fermín» ni «Santana Fermín».
  { familia: "Anny Ramírez Hiciano", queda: "Juan Pablo  Santana -Fermín", fuera: ["Juan Pablo  Santana Fermín"], nombreNuevo: "Juan Pablo Santana-Fermín" },
  { familia: "ARANCHA SANCHO CASTRO", queda: "ARANCHA SANCHO CASTRO", fuera: ["ARANTZA SANCHO CASTRO"] },
  { familia: "ASINTER SERVICIOS", queda: "ASINTER SERVICIOS", fuera: ["ASINTER SERVICOS"] },
  { familia: "CECILIA RODRÍGUEZ MARTÍNEZ ALEGRÍA", queda: "CECILIA RODRÍGUEZ MARTÍNEZ ALEGRÍA", fuera: ["CECILIA  RODRÍGUEZ MARTÍNEZ DE ALEGRÍA"] },
  { familia: "DAVID DIAZ MARISCAL", queda: "JO ALICE TORRES MARIN", fuera: ["JOALICE TORRES MARÍN"] },
  { familia: "ILTNNYS VANESSA ANDRADE BRACAMONTE", queda: "ILENNYS VANESSA ANDRADE BRACAMONTE", fuera: ["ILTNNYS VANESSA ANDRADE BRACAMONTE"] },
  { familia: "IRENE ASIEDUA DANSO", queda: "THOMAS KWIRKU AGYEKUM", fuera: ["THOMAS KWAKU  AGYEKUM"] },
  { familia: "ISABEL SACEDON ESPINOSA", queda: "RUBÉN CORONADO GÓMEZ", fuera: ["RUBEN CORONADO GAMEZ"] },
  { familia: "Javier Da Costa Villamiel", queda: "Javier Da Costa Villamiel", fuera: ["Javier Dacosta Villamiel"] },
  { familia: "José Carlos Vargas Cuesta", queda: "Mª. Coronada Calderón Navas", fuera: ["Mª.Coronada Calderón Navas"] },
  { familia: "Jose Manuel Fernández Agraz", queda: "Jose Manuel Fernández Agraz", fuera: ["JOSE MANUEL FEERNÁNDEZ AGRAZ"] },
  { familia: "JUAN CARLOS FRESNEDA GUIRAO", queda: "JUAN CARLOS FRESNEDA GUIRAO", fuera: ["JUAN CARLOS FRESNEDA GUIRADO"] },
  { familia: "Laura Bravo Gonzalez", queda: "Ismael Fernández Almendros", fuera: ["Ismael Fernández Almedros"] },
  { familia: "LAURA S. FERNÁNDEZ MORENO", queda: "LAURA S. FERNÁNDEZ MORENO", fuera: ["Laura Fernández Moreno"] },
  { familia: "Mª. Ángeles Valoria López", queda: "Mª. Ángeles Valoria López", fuera: ["Mª ANGELES VALORIA LÓPEZ"] },
  { familia: "Mª. Donova Varela Ortega", queda: "Mª. Donova Varela Ortega", fuera: ["Mª. DANOVA VARELA ORTEGA"] },
  { familia: "Mª. EUGENIA REDONDO CLAUDIO", queda: "Mª. EUGENIA REDONDO CLAUDIO", fuera: ["Mª EUGENIA REDONDO CLAUDIO"] },
  { familia: "MALIKA ELYOUSSOUFI", queda: "MALIKA ELYOUSSOUFI", fuera: ["MALIKA EL YOUSSOUFI"] },
  { familia: "MANUEL FERNÁNDEZ RUÍZ", queda: "MANUEL FERNÁNDEZ RUÍZ", fuera: ["MANUEL  FERNÁNDEZ MUÑOZ"] },
  { familia: "Mari Paz García Rodríguez", queda: "Mari Paz García Rodríguez", fuera: ["Mª. Paz  García Rodríguez"] },
  { familia: "MARÍA DÍAZ FERNÁNEZ", queda: "María Díaz Fernández", fuera: ["MARÍA DÍAZ FERNÁNEZ"] },
  // «Adriah Podari» y «María Podari» son DOS personas. No se toca.
  { familia: "MART HERNÁNDEZ MARTÍN DE LA SIERRA", queda: "MARTA HERNÁNDEZ MARTÍN DE LA SIERRA", fuera: ["MART HERNÁNDEZ MARTÍN DE LA SIERRA"] },
  { familia: "MOHAMMED BADAOU", queda: "MOHAMMED BADAOU", fuera: ["MOHAMED  BADAOU"] },
  { familia: "OLENA KRASOUSKA", queda: "OLENA KRASOVSKA", fuera: ["OLENA KRASOUSKA"] },
  { familia: "ÓSCAR COGOLLUDO IZQUIERDO", queda: "ÓSCAR COGOLLUDO IZQUIERDO", fuera: ["ÓSCAR COGULLUDO IZQUIERDO"] },
  { familia: "PATRICIA DURAN MASCARAQUE", queda: "PATRICIA DURAN MASCARAQUE", fuera: ["PATRICIA DURÁN MASCAREQUE"] },
  { familia: "ROBERTO GARCÍA SANZ", queda: "ROBERTO GARCÍA SANZ", fuera: ["ROBERTO GARCÍA SAINZ"] },
  { familia: "SARA GARCÍA HERNÁNEZ", queda: "Sara  García Hernández", fuera: ["SARA GARCÍA HERNÁNEZ"] },
  // Tres entradas de la MISMA persona. Rodrigo: «es la de antes también».
  { familia: "SHEILA MARTIN LANCHO", queda: "SHEILA MARTIN LANCHO", fuera: ["SHEILA MARTÍN VANGIO", "SHEILA MARTÍN LANGIO"] },
  { familia: "SILVIA VICENTE SEISDEDOS", queda: "SILVIA VICENTE SEISDEDOS", fuera: ["SILVIA VICENTE SEIDEDOS"] },
  { familia: "Susana Fernández Álvarez", queda: "SILVERIO DAVID GUERRERO CASADO", fuera: ["Siverio David Guerrero Casado"] },
  { familia: "SUSANA SAMPEDRO MATEO", queda: "SUSANA SAMPEDRO MATEO", fuera: ["SUSANA SAN PEDRO MATEO"] },
  { familia: "SUSET FUNDORA BENÍTEZ", queda: "SUSET FUNDORA BENÍTEZ", fuera: ["SUSET Fundora Benítez."] },
  { familia: "TAMARA DÍAZ CALVETE", queda: "TAMARA DÍAZ CALVETE", fuera: ["TAMARA  DIAS CALVETE"] },
  { familia: "TAMARA DÍAZ JAUREGUI", queda: "TAMARA DÍAZ JAUREGUI", fuera: ["tamara diaz jaureguin"] },
  { familia: "WILLIANA ANDREA BUSTAMANTE MORENO", queda: "WILLIANA ANDREA BUSTAMANTE MORENO", fuera: ["WIILLIANA ANDREA BUSTAMANTE MORENO"] },
];

/** Campos que el tutor que se va puede aportarle al que se queda. */
const CAMPOS = ["email", "phone", "dni", "relationship"];

async function main() {
  console.log(`\n${"═".repeat(66)}`);
  console.log(` FUSIONAR TUTORES REPETIDOS → tenant "${SLUG}"`);
  console.log(`${CONFIRM ? " ⚠️  MODO REAL: va a escribir" : " · SIMULACIÓN: no se escribe nada"}`);
  console.log(`${"═".repeat(66)}\n`);

  const { models: m, sequelize } = getTenantDb(SLUG);
  const todos = await m.Client.findAll({ attributes: ["id", "name", "guardians"] });

  const porNombre = new Map();
  for (const c of todos) {
    const k = norm(c.name);
    if (!porNombre.has(k)) porNombre.set(k, []);
    porNombre.get(k).push(c);
  }

  const cambios = [];
  const problemas = [];
  const fichaTambienMal = [];

  for (const d of DECISIONES) {
    const candidatos = porNombre.get(norm(d.familia)) ?? [];
    if (candidatos.length === 0) { problemas.push(`«${d.familia}»: no está en el CRM`); continue; }
    if (candidatos.length > 1) { problemas.push(`«${d.familia}»: hay ${candidatos.length} fichas con ese nombre, no sé cuál`); continue; }

    const cliente = candidatos[0];
    const tutores = (cliente.guardians ?? []).map((g) => ({ ...g }));
    const bueno = tutores.find((g) => norm(g.name) === norm(d.queda));
    if (!bueno) { problemas.push(`«${d.familia}»: no encuentro al tutor «${d.queda}»`); continue; }

    const sobran = d.fuera.map((f) => tutores.find((g) => norm(g.name) === norm(f))).filter(Boolean);
    if (sobran.length !== d.fuera.length) { problemas.push(`«${d.familia}»: alguno de los que hay que quitar ya no está`); continue; }

    // Lo que el que se va le presta al que se queda.
    const heredado = [];
    for (const s of sobran) {
      for (const campo of CAMPOS) {
        if (!bueno[campo] && s[campo]) { bueno[campo] = s[campo]; heredado.push(`${campo} de «${s.name}»`); }
      }
    }
    // Espacios dobles fuera: en Organízate abundan («Sara  García Hernández»).
    // Colapsar espacios no cambia el nombre de nadie, y así no se arrastra la
    // suciedad al dato ya limpio.
    const limpio = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
    const nombreFinal = limpio(d.nombreNuevo ?? bueno.name);
    const renombrado = nombreFinal !== bueno.name;
    bueno.name = nombreFinal;

    const quedan = tutores.filter((g) => !sobran.some((s) => s.id ? s.id === g.id : norm(s.name) === norm(g.name)));

    // El nombre de la FICHA lleva a veces la misma errata, y ese es el que sale
    // en las facturas. Se corrige también (Rodrigo, 03/08/2026) — se preguntó
    // aparte justamente porque cambia cómo se ve un documento ya emitido.
    let fichaNueva = null;
    if (norm(cliente.name) !== norm(nombreFinal) && norm(cliente.name) === norm(d.fuera[0])) {
      fichaNueva = nombreFinal;
      fichaTambienMal.push({ ficha: cliente.name, deberia: nombreFinal });
    }

    cambios.push({ cliente, quedan, bueno: nombreFinal, sobran: sobran.map((s) => s.name), heredado, renombrado, fichaNueva });
  }

  for (const c of cambios) {
    console.log(`  «${c.cliente.name}»`);
    console.log(`      se queda  ${c.bueno}${c.renombrado ? "   ← renombrado" : ""}`);
    console.log(`      se van    ${c.sobran.join(" · ")}`);
    if (c.heredado.length) console.log(`      hereda    ${c.heredado.join(" · ")}`);
  }

  console.log(`\n── RESUMEN ────────────────────────────────────────────────────\n`);
  console.log(`  Familias que se arreglan   ${String(cambios.length).padStart(4)} de ${DECISIONES.length}`);
  console.log(`  Tutores que desaparecen    ${String(cambios.reduce((a, c) => a + c.sobran.length, 0)).padStart(4)}`);
  console.log(`  …que aportaban algún dato  ${String(cambios.filter((c) => c.heredado.length).length).padStart(4)}   se conserva\n`);

  if (fichaTambienMal.length) {
    console.log(`  En ${fichaTambienMal.length} familias se corrige TAMBIÉN el nombre de la ficha,`);
    console.log(`  que es el que sale en las facturas:\n`);
    for (const f of fichaTambienMal) console.log(`      «${f.ficha}»  →  «${f.deberia}»`);
    console.log("");
  }
  if (problemas.length) {
    console.log(`  ✗ ${problemas.length} no se pueden aplicar:`);
    for (const p of problemas) console.log(`      ${p}`);
    console.log("");
  }

  if (!CONFIRM) {
    console.log(`${"═".repeat(66)}`);
    console.log(" SIMULACIÓN: no se ha escrito nada. Con --confirm se ejecuta.");
    console.log(`${"═".repeat(66)}\n`);
    process.exit(0);
  }

  await sequelize.transaction(async (t) => {
    for (const c of cambios) {
      c.cliente.guardians = c.quedan;
      if (c.fichaNueva) c.cliente.name = c.fichaNueva;
      await c.cliente.save({ transaction: t });
    }
  });
  console.log(`Arregladas ${cambios.length} familias · ${fichaTambienMal.length} con el nombre de la ficha corregido.\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error("\n✖ Error:", e.message);
  process.exit(1);
});
