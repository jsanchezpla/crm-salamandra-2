/**
 * _smoke-backoffice-ciclo.mjs — las dos puntas del ciclo de vida de un cliente:
 * ponerle las credenciales y cerrarle la cuenta.
 *
 * Las dos salieron desplegadas el 13/08/2026 y las dos se quedaron sin
 * comprobar por el mismo motivo: no se pueden mirar, hay que HACERLAS. Ponerle
 * una clave a alguien y darle de baja a alguien no son cosas que se ensayen
 * contra un cliente de verdad, así que esto las ensaya contra el sandbox y le
 * deshace la baja al terminar.
 *
 * Lo que se comprueba:
 *
 *   CLAVES  · se guardan CIFRADAS y no se devuelven jamás, ni al que acaba de
 *             escribirlas (el back-office no lee credenciales, solo escribe);
 *           · un pegado a medias se rechaza EN EL MOMENTO;
 *           · a una demo no se le pone una clave ni pidiéndolo.
 *   BAJA    · la radiografía dice lo que hay dentro ANTES de tocar nada;
 *           · sin teclear el identificador no se cierra nada;
 *           · no se puede cerrar el tenant desde el que trabajas, ni una demo;
 *           · al cerrarla, el schema se APARTA (no se borra) y queda su red de
 *             rescate;
 *           · y el cliente desaparece de master.
 *
 * ⚠️ SOLO LOCAL. Se planta si la base de datos parece de producción o si el
 * tenant destino no es un sandbox: esto cierra cuentas.
 *
 * Requiere el servidor de desarrollo levantado.
 * Uso: node --env-file=.env.local scripts/_smoke-backoffice-ciclo.mjs
 */

import http from "node:http";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { signAccessToken } from "../lib/auth/jwt.js";
import { isEncrypted } from "../lib/crypto/secretBox.js";

const DESTINO = process.argv[2] || "sandbox";
const PANEL = process.env.ADMIN_HOST?.trim() || "admin.localhost:3000";
// Se conecta por IP y se manda el Host a mano: en Windows `admin.localhost` no
// resuelve, y es la cabecera Host —no el DNS— lo que decide si esto es el
// back-office (lib/auth/backoffice.js).
const BASE = `http://127.0.0.1:${PANEL.split(":")[1] || "3000"}`;

// Una clave de mentira con la pinta de una de verdad (>=16, sin espacios).
const CLAVE_FALSA = "sk-ant-api03-PRUEBA-DEL-SMOKE-no-sirve-para-nada-000";

let fallos = 0;
const ok = (m) => process.stdout.write(`  ✓ ${m}\n`);
const mal = (m) => { fallos++; process.stderr.write(`  ✗ ${m}\n`); };
const paso = (m) => process.stdout.write(`\n▶ ${m}\n`);
const esperar = (c, m, detalle = "") => (c ? ok(m) : mal(`${m}${detalle ? ` — ${detalle}` : ""}`));

async function main() {
  if (/prod|production/i.test(process.env.DATABASE_URL || "")) {
    process.stderr.write("\n✗ Esta base de datos parece de producción. Este smoke CIERRA CUENTAS. Abortando.\n\n");
    process.exit(1);
  }
  if (!/sandbox|prueba|test/.test(DESTINO)) {
    process.stderr.write(`\n✗ "${DESTINO}" no parece un tenant de pruebas. Abortando.\n\n`);
    process.exit(1);
  }

  process.stdout.write(`\n═══ Smoke: back-office — claves y cierre de cuenta (${DESTINO}) ═══\n`);
  process.stdout.write(`  panel: ${BASE}\n`);

  const db = getMasterDb();
  const { Tenant, User } = getMasterModels();

  const nosotros = await Tenant.findOne({ where: { slug: "salamandra_solutions" } });
  if (!nosotros) throw new Error("no existe salamandra_solutions: sin él no hay back-office");
  const admin = await User.findOne({ where: { tenantId: nosotros.id, role: ["admin", "superadmin"] } });
  if (!admin) throw new Error("salamandra_solutions no tiene admin");

  // `bo: true` es el sello de "esta sesión nació en el panel": el middleware
  // exige que coincida con el host, y sin él la petición sale 401 aunque el
  // token esté bien firmado.
  const jwt = await signAccessToken({
    userId: admin.id, email: admin.email, role: admin.role, tenantSlug: "salamandra_solutions", bo: true,
  });
  const H = {
    "Content-Type": "application/json",
    Cookie: `access_token=${jwt}`,
    "x-user-id": admin.id,
    Host: PANEL,
  };

  /**
   * Se pide con `node:http` y NO con `fetch` a propósito: `fetch` descarta la
   * cabecera `Host` (es de las prohibidas por la spec), y sin ella la petición
   * no es del back-office — el middleware devolvía 404 a todo y la prueba
   * pasaba en verde comprobando cuatro cosas que nunca llegaron a ocurrir.
   */
  const pedir = (ruta, opts = {}) =>
    new Promise((resolve, reject) => {
      const cuerpo = opts.body ?? null;
      const req = http.request(
        {
          host: "127.0.0.1",
          port: Number(PANEL.split(":")[1] || 3000),
          path: ruta,
          method: opts.method || "GET",
          headers: {
            ...H,
            ...(opts.headers || {}),
            ...(cuerpo ? { "Content-Length": Buffer.byteLength(cuerpo) } : {}),
          },
        },
        (res) => {
          let texto = "";
          res.on("data", (c) => (texto += c));
          res.on("end", () => {
            let j = {};
            try { j = JSON.parse(texto); } catch { /* sin JSON */ }
            resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, j });
          });
        }
      );
      req.on("error", reject);
      if (cuerpo) req.write(cuerpo);
      req.end();
    });

  const destino = await Tenant.findOne({ where: { slug: DESTINO } });
  if (!destino) throw new Error(`no existe el tenant "${DESTINO}" (créalo con scripts/seed-sandbox.js)`);

  // ── 1. Poner una credencial ───────────────────────────────────────────────
  paso("Ponerle una clave a un cliente");
  {
    const r = await pedir(`/api/admin/configuraciones`, {
      method: "PUT",
      body: JSON.stringify({ slug: DESTINO, claves: { anthropicApiKey: CLAVE_FALSA } }),
    });
    esperar(r.ok, `el panel la acepta (${r.status})`, JSON.stringify(r.j).slice(0, 300));

    const cuerpo = JSON.stringify(r.j);
    esperar(
      !cuerpo.includes(CLAVE_FALSA) && !cuerpo.includes("sk-ant-api03-PRUEBA"),
      "y NO la devuelve, ni siquiera a quien acaba de escribirla"
    );

    await destino.reload();
    const guardada = destino.settings?.integrations?.anthropicApiKey;
    esperar(!!guardada, "queda guardada en el cliente");
    esperar(isEncrypted(guardada), "y CIFRADA en reposo, no en claro", String(guardada).slice(0, 12));
  }

  paso("Un pegado a medias canta en el momento");
  {
    for (const [valor, porque] of [
      ["corta", "demasiado corta"],
      ["con espacios en medio de la clave", "con espacios"],
      ["clave\ncon\nsaltos", "con saltos de línea"],
    ]) {
      const r = await pedir(`/api/admin/configuraciones`, {
        method: "PUT",
        body: JSON.stringify({ slug: DESTINO, claves: { openaiApiKey: valor } }),
      });
      esperar(!r.ok || r.j?.data?.resultados?.openaiApiKey === "rechazada", `se rechaza ${porque}`, `${r.status} ${JSON.stringify(r.j).slice(0, 160)}`);
    }
  }

  paso("A una demo no se le pone una clave");
  {
    const r = await pedir(`/api/admin/configuraciones`, {
      method: "PUT",
      body: JSON.stringify({ slug: "demo", claves: { anthropicApiKey: CLAVE_FALSA } }),
    });
    esperar(!r.ok, `se rechaza (${r.status})`, JSON.stringify(r.j).slice(0, 200));
  }

  // ── 2. La radiografía previa ──────────────────────────────────────────────
  paso("Antes de cerrar, qué hay dentro");
  {
    const r = await pedir(`/api/admin/clientes/${DESTINO}/baja`);
    esperar(r.ok, `la radiografía responde (${r.status})`, JSON.stringify(r.j).slice(0, 200));
    const d = r.j?.data ?? {};
    esperar(typeof d.usuarios === "number" || Array.isArray(d.usuarios) || d.tablas != null, "y dice usuarios/tablas", JSON.stringify(d).slice(0, 250));
  }

  // ── 3. Los candados ───────────────────────────────────────────────────────
  paso("Los candados del cierre");
  {
    const sinTeclear = await pedir(`/api/admin/clientes/${DESTINO}/baja`, { method: "POST", body: JSON.stringify({}) });
    esperar(!sinTeclear.ok, "sin teclear el identificador, no se cierra", `${sinTeclear.status}`);

    const malTecleado = await pedir(`/api/admin/clientes/${DESTINO}/baja`, {
      method: "POST", body: JSON.stringify({ confirmo: "otra_cosa", conDatos: true }),
    });
    esperar(!malTecleado.ok, "con el identificador mal tecleado, tampoco", `${malTecleado.status}`);

    const unaDemo = await pedir(`/api/admin/clientes/demo_clinica/baja`, {
      method: "POST", body: JSON.stringify({ confirmo: "demo_clinica", conDatos: true }),
    });
    esperar(!unaDemo.ok && unaDemo.status === 409, "una demo no se cierra: se rehace con su script", `${unaDemo.status}`);

    const yoMismo = await pedir(`/api/admin/clientes/salamandra_solutions/baja`, {
      method: "POST", body: JSON.stringify({ confirmo: "salamandra_solutions", conDatos: true }),
    });
    esperar(!yoMismo.ok && yoMismo.status === 409, "y no puedes cerrarte a ti mismo", `${yoMismo.status}`);
  }

  // ── 4. Cerrar de verdad ───────────────────────────────────────────────────
  paso("Cerrar la cuenta");
  {
    const r = await pedir(`/api/admin/clientes/${DESTINO}/baja`, {
      method: "POST", body: JSON.stringify({ confirmo: DESTINO, conDatos: true }),
    });
    esperar(r.ok, `se cierra (${r.status})`, JSON.stringify(r.j).slice(0, 300));

    const sigue = await Tenant.findOne({ where: { slug: DESTINO } });
    esperar(!sigue, "el cliente ya no está en master.tenants");

    const [schemas] = await db.query(
      `SELECT nspname FROM pg_namespace WHERE nspname LIKE 'zzz_baja_${DESTINO}_%' ORDER BY nspname DESC`
    );
    esperar(schemas.length > 0, "el schema se ha APARTADO, no borrado", JSON.stringify(schemas));

    const [vivo] = await db.query(`SELECT to_regclass('crm_${DESTINO}.clients') IS NOT NULL AS existe`);
    esperar(vivo[0]?.existe === false, `y crm_${DESTINO} ya no responde`);

    const bajas = await pedir(`/api/admin/bajas`);
    const lista = bajas.j?.data?.bajas ?? [];
    esperar(lista.some((b) => b.slug === DESTINO), "y aparece en la lista de cuentas cerradas", JSON.stringify(lista).slice(0, 250));
    const suya = lista.find((b) => b.slug === DESTINO);
    // `red` es el .rollback.sql que devuelve la baja entera. Sin él, apartar
    // dejaría de ser reversible, que es lo único que justifica que esto sea un
    // botón y no un SSH.
    esperar(suya?.red === true, "con su red de rescate", JSON.stringify(suya ?? {}).slice(0, 250));
    esperar(!!suya?.schema?.startsWith("zzz_baja_"), "y el schema apartado con su sello de fecha", String(suya?.schema));
  }

  process.stdout.write(
    `\n  · El sandbox se ha quedado cerrado a propósito: así queda la prueba a la vista.\n` +
      `    Para volver a tenerlo:  node --env-file=.env.local scripts/seed-sandbox.js\n` +
      `    Y para quitar su red de rescate: node --env-file=.env.local scripts/podar-bajas.js --dias=0 --aplicar\n` +
      `    (el schema apartado se borra aparte: scripts/borrar-tenant.js, o a mano con DROP SCHEMA)\n`
  );
}

main()
  .then(async () => {
    process.stdout.write(fallos === 0 ? "\n✅ Todo en orden\n\n" : `\n❌ ${fallos} fallo(s)\n\n`);
    await getMasterDb().close().catch(() => {});
    process.exit(fallos === 0 ? 0 : 1);
  })
  .catch(async (err) => {
    process.stderr.write(`\n✗ Se ha roto: ${err.stack || err.message}\n\n`);
    await getMasterDb().close().catch(() => {});
    process.exit(1);
  });
