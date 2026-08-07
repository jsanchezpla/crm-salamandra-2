/**
 * _smoke-dinero-solo-direccion.mjs — el equipo no ve el dinero de las citas.
 *
 * DE DÓNDE SALE
 * Laura se quejó de que su empleada —usuario del CRM con rol `user`— veía en la
 * agenda el chip «No se pudo cobrar · 360,00 €» de una clienta.
 *
 * LO QUE ESTA PRUEBA VIGILA DE VERDAD
 * No que el chip desaparezca de la pantalla: que el importe NO VIAJE en el JSON.
 * Ese es el fallo que ya se cometió una vez —el precio de los tipos de cita se
 * escondió en la interfaz el 06/08 y el endpoint lo siguió devolviendo, así que
 * se veía desde el inspector del navegador—. Por eso aquí se llama a la API
 * directamente y se mira el cuerpo, sin pasar por ninguna pantalla.
 *
 * Requiere el servidor de desarrollo levantado.
 * Uso: node --env-file=.env.local scripts/_smoke-dinero-solo-direccion.mjs [slug]
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { signAccessToken } from "../lib/auth/jwt.js";

const SLUG = process.argv[2] || "nutri_laura";
const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3000";

let fallos = 0;
const ok = (m) => process.stdout.write(`  ✓ ${m}\n`);
const mal = (m) => { fallos++; process.stderr.write(`  ✗ ${m}\n`); };
const paso = (m) => process.stdout.write(`\n▶ ${m}\n`);
const esperar = (c, m) => (c ? ok(m) : mal(m));

/**
 * Los IMPORTES no pueden llegarle a quien no es dirección.
 *
 * `paymentStatus` NO está aquí a propósito: el estado de cobro sí lo ve todo el
 * equipo (decisión de Laura del 07/08). Lo que se prohíbe son las cifras. Se
 * comprueba abajo, aparte, que ese estado SÍ siga llegando — si un día alguien
 * lo mete en esta lista "por si acaso", recepción se queda sin saber si una
 * sesión está cobrada y esa comprobación lo cazará.
 */
const PROHIBIDOS_CITA = ["amount", "paymentSessionId"];
const PROHIBIDOS_TIPO = ["price", "instalmentPrice", "instalmentMonths"];

const sinNinguno = (obj, campos) => campos.every((c) => obj?.[c] === undefined);
const conAlguno = (obj, campos) => campos.filter((c) => obj?.[c] !== undefined);

async function main() {
  process.stdout.write(`\n═══ Smoke: el dinero de las citas solo lo ve dirección (${SLUG}) ═══\n`);

  getMasterDb();
  const { Tenant, User } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) throw new Error(`no existe el tenant ${SLUG}`);

  const admin = await User.findOne({ where: { tenantId: tenant.id, role: "admin" } });
  if (!admin) throw new Error("este cliente no tiene ningún admin");

  // Un usuario de equipo. Si el cliente no tiene ninguno se firma uno de
  // mentira: lo que se prueba es el ROL, y el rol lo lleva el token.
  const user = await User.findOne({ where: { tenantId: tenant.id, role: "user" } });

  const cabecerasDe = async (rol, u) => ({
    "Content-Type": "application/json",
    "x-tenant": SLUG,
    Cookie: `access_token=${await signAccessToken({
      userId: u?.id ?? admin.id,
      email: u?.email ?? `equipo@${SLUG}.test`,
      role: rol,
      tenantSlug: SLUG,
    })}`,
  });

  const comoAdmin = await cabecerasDe("admin", admin);
  const comoEquipo = await cabecerasDe("user", user);

  const pedir = async (ruta, cabeceras) => {
    const r = await fetch(`${BASE}${ruta}`, { headers: cabeceras });
    return { status: r.status, cuerpo: await r.json().catch(() => null) };
  };

  // Hace falta al menos una cita con precio para que la prueba pruebe algo.
  const { models } = getTenantDb(SLUG);
  const conPrecio = await models.Booking.findOne({
    where: { paymentStatus: ["paid", "authorized", "failed", "void", "pending"] },
    order: [["createdAt", "DESC"]],
  });

  paso("Los tipos de cita: la tarifa del centro");
  const tiposEquipo = await pedir("/api/citas/event-types", comoEquipo);
  const tiposAdmin = await pedir("/api/citas/event-types", comoAdmin);
  esperar(tiposEquipo.status === 200, `el equipo sigue viendo el catálogo (HTTP ${tiposEquipo.status})`);

  const unoEquipo = (tiposEquipo.cuerpo?.data ?? [])[0];
  const unoAdmin = (tiposAdmin.cuerpo?.data ?? [])[0];
  if (unoEquipo) {
    esperar(!!unoEquipo.name && !!unoEquipo.duration,
      "y con lo que necesita para trabajar: nombre y duración");
    const filtrados = conAlguno(unoEquipo, PROHIBIDOS_TIPO);
    esperar(filtrados.length === 0,
      `sin la tarifa en el JSON${filtrados.length ? ` — SE COLARON: ${filtrados.join(", ")}` : ""}`);
  } else {
    mal("no hay ningún tipo de cita: la prueba no ha probado nada");
  }
  if (unoAdmin) {
    esperar("price" in unoAdmin, "dirección SÍ la ve (si no, se ha roto la pantalla de tarifas)");
  }

  paso("El listado de citas: de aquí salía el «No se pudo cobrar · 360,00 €»");
  const listaEquipo = await pedir("/api/citas/bookings?limit=20", comoEquipo);
  esperar(listaEquipo.status === 200, `el equipo sigue viendo la agenda (HTTP ${listaEquipo.status})`);
  const citasEquipo = listaEquipo.cuerpo?.data?.bookings ?? [];
  if (citasEquipo.length) {
    const sucias = citasEquipo.filter((c) => conAlguno(c, PROHIBIDOS_CITA).length > 0);
    esperar(sucias.length === 0,
      `ninguna de las ${citasEquipo.length} lleva importes${
        sucias.length ? ` — ${sucias.length} SÍ lo llevan` : ""
      }`);
    esperar(citasEquipo.every((c) => c.clientName !== undefined && c.scheduledAt !== undefined),
      "y siguen llegando con nombre y hora: la agenda no se queda coja");
    // La otra mitad de la raya: el ESTADO sí se ve.
    esperar(citasEquipo.some((c) => c.paymentStatus !== undefined),
      "el equipo SÍ ve el estado de cobro: sin cifras, pero sabe si está resuelta");
  } else {
    mal("no hay ninguna cita: la prueba no ha probado nada");
  }

  const listaAdmin = await pedir("/api/citas/bookings?limit=20", comoAdmin);
  const citasAdmin = listaAdmin.cuerpo?.data?.bookings ?? [];
  esperar(citasAdmin.some((c) => c.paymentStatus !== undefined),
    "dirección SÍ recibe el estado de cobro (si no, se le ha roto la lista de espera)");

  if (conPrecio) {
    paso("El detalle de una cita con dinero de por medio");
    const detEquipo = await pedir(`/api/citas/bookings/${conPrecio.id}`, comoEquipo);
    if (detEquipo.status === 200) {
      const c = detEquipo.cuerpo?.data ?? {};
      const sucios = conAlguno(c, PROHIBIDOS_CITA);
      esperar(sucios.length === 0,
        `sin importe${sucios.length ? ` — SE COLARON: ${sucios.join(", ")}` : ""}`);
      esperar(c.paymentStatus !== undefined,
        "pero con el estado de cobro, que sí puede ver");
      // La fuga doble: la tarifa viajaba anidada dentro del tipo de cita.
      const sucioTipo = conAlguno(c.eventType, PROHIBIDOS_TIPO);
      esperar(sucioTipo.length === 0,
        `y sin la tarifa escondida dentro del tipo de cita${sucioTipo.length ? ` — SE COLARON: ${sucioTipo.join(", ")}` : ""}`);
    } else {
      ok(`(el equipo no puede abrir esa cita: HTTP ${detEquipo.status} — también vale)`);
    }

    const detAdmin = await pedir(`/api/citas/bookings/${conPrecio.id}`, comoAdmin);
    esperar(detAdmin.cuerpo?.data?.paymentStatus !== undefined,
      "dirección SÍ ve el cobro en el detalle");
  } else {
    paso("El detalle de una cita con dinero");
    mal("no hay ninguna cita con precio en este cliente: ese caso se queda sin probar");
  }

  process.stdout.write(fallos ? `\n═══ ${fallos} fallo(s) ═══\n` : `\n═══ Todo en orden ═══\n`);
  process.exit(fallos ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err.stack || err.message}\n`);
  process.exit(1);
});
