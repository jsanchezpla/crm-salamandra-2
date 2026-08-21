/**
 * _fake-n8n.mjs — un n8n de mentira, SOLO para pruebas.
 *
 * Hermano del `_fake-stripe.mjs` de Pagos, con una diferencia de forma: aquel se
 * enchufa como librería (un cargador sustituye el paquete `stripe`) y este es un
 * servidor de verdad, porque el CRM habla con n8n por HTTP y no por import
 * (`lib/outreach/scraping.js` → `POST $OUTREACH_SCRAPING_WEBHOOK_URL`). Lo
 * inventado es la respuesta de n8n; todo lo que se ejercita del CRM —firmar,
 * pedir, normalizar y deduplicar— es el de verdad.
 *
 * ── POR QUÉ NO CONTESTA 200 A TODO ──────────────────────────────────────────
 * El webhook va firmado con HMAC-SHA256 del cuerpo crudo (cabecera
 * `x-outreach-signature`, secreto `OUTREACH_WEBHOOK_SECRET`) para que el flujo
 * real de n8n pueda rechazar lo que no venga del CRM. Un falso que contestara
 * 200 a cualquier cosa dejaría la prueba en verde sin haber mirado la firma,
 * que es justo lo único que esa rama dice fijar: peor que no tener prueba. Así
 * que aquí se VERIFICA de verdad — sin firma, o con una que no cuadre → 401, y
 * el CRM lo traduce a un 502 que la prueba ve. Y sin `OUTREACH_WEBHOOK_SECRET`
 * ni siquiera arranca: sin secreto no hay forma honrada de comprobar nada.
 *
 * ── LAS TRES EMPRESAS QUE DEVUELVE, Y EL PAPEL DE CADA UNA ──────────────────
 * Fijas y siempre las mismas (nada de estado ni de guiones por petición: es la
 * misma idea que los ids de `_fake-stripe.mjs`, que una prueba no pueda
 * contaminar a otra). Cada una entra por una rama distinta del dedupe de
 * `lib/outreach/persistLeads.js`: una se inserta, otra ya la teníamos y la
 * tercera se descarta por no traer nombre. De ahí salen los números que fija
 * `_smoke-outreach-e2e.mjs` (inserted 1 · ya lo teníamos 1 · ignored 1).
 *
 * ── QUÉ RECUERDA ────────────────────────────────────────────────────────────
 * `GET /last` devuelve la última petición recibida: si traía firma, si la firma
 * era correcta y el cuerpo que llegó. Esos tres campos van en inglés
 * (`hadSignature`, `signatureOk`, `payload`) porque son el contrato que ya lee
 * `_smoke-outreach-e2e.mjs`. Con el servidor recién arrancado contesta
 * `{ recibido: false }`, que es de paso el modo de saber que ya escucha.
 *
 * ── USO ─────────────────────────────────────────────────────────────────────
 * La prueba e2e lo arranca y lo para sola, heredándole su entorno; a mano:
 *
 *   node --env-file=.env.local scripts/_fake-n8n.mjs
 *
 * Para que el CRM le hable, el `npm run dev` tiene que arrancar con estas dos
 * en su `.env.local` (y el mismo secreto que vea este script):
 *
 *   OUTREACH_SCRAPING_WEBHOOK_URL=http://127.0.0.1:5999/webhook/scraping
 *   OUTREACH_WEBHOOK_SECRET=<cualquier cosa, la misma para los dos>
 */

import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";

/**
 * Lo que este n8n de mentira "encuentra". Los alias de campo van mezclados en
 * español y en inglés a propósito: el flujo real puede devolver cualquiera de
 * los dos y `normalizeCompany` los admite (`lib/outreach/scraping.js`).
 */
export const EMPRESAS = [
  // 1) Nueva: no la siembra nadie, así que se INSERTA. La prueba la busca luego
  //    por «Mirador» para borrarla y dejar el tenant como estaba.
  {
    nombre: "Óptica El Mirador",
    sector: "Ópticas",
    ubicacion: "Salamanca",
    web: "https://optica-el-mirador.example",
    telefono: "+34 923 100 200",
  },
  // 2) Repetida a propósito: copia EXACTA de (name, location, source) de una de
  //    las empresas que siembra `scripts/seed-outreach.js`, que es la terna con
  //    la que deduplica `persistLeads.js`. Si cambia el seed, hay que cambiar
  //    esto o la prueba dejará de ver el camino del duplicado.
  {
    name: "Asesoría Ledesma & Asociados",
    sector: "Asesorías / gestorías",
    location: "Zamora",
    website: "https://ledesma-asesores.example",
    source: "paginas_amarillas",
  },
  // 3) Sin nombre: un scraper devuelve celdas vacías y sin nombre no hay fila
  //    que guardar. Van espacios en vez de vacío para que se ejercite el trim.
  {
    nombre: "   ",
    sector: "Ópticas",
    ubicacion: "Salamanca",
    web: "https://sin-nombre.example",
  },
];

/**
 * ¿La firma que llega es la del cuerpo que llega, hecha con este secreto?
 *
 * El secreto entra por parámetro y no por `process.env` para que se pueda
 * comprobar suelta desde una prueba ligera (`_smoke-fake-n8n.mjs`).
 * `cuerpo` es el crudo —Buffer o string—, nunca el JSON reparseado: firmar lo
 * reparseado sería firmar otra cosa (el orden de las claves y los espacios
 * cambian el hash).
 */
export function firmaValida(secreto, cuerpo, firma) {
  // 64 hex en minúscula es lo que produce `digest("hex")`, que es lo que manda
  // el CRM. Con el largo ya fijado, `timingSafeEqual` nunca revienta por medida.
  if (!secreto || typeof firma !== "string" || !/^[0-9a-f]{64}$/.test(firma)) return false;
  const esperada = createHmac("sha256", secreto).update(cuerpo).digest("hex");
  return timingSafeEqual(Buffer.from(esperada), Buffer.from(firma));
}

function responder(res, codigo, cuerpo) {
  const texto = JSON.stringify(cuerpo);
  res.writeHead(codigo, { "Content-Type": "application/json; charset=utf-8" });
  res.end(texto);
}

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    const trozos = [];
    req.on("data", (t) => trozos.push(t));
    req.on("end", () => resolve(Buffer.concat(trozos)));
    req.on("error", reject);
  });
}

function arrancar() {
  const secreto = process.env.OUTREACH_WEBHOOK_SECRET;
  if (!secreto) {
    process.stderr.write(
      "\n✗ n8n de mentira: falta OUTREACH_WEBHOOK_SECRET.\n" +
        "  Sin secreto no se puede verificar la firma, y un falso que dice que sí a todo\n" +
        "  es peor que no tenerlo. Ponlo en .env.local (el mismo que vea `npm run dev`)\n" +
        "  y arranca con: node --env-file=.env.local scripts/_fake-n8n.mjs\n\n"
    );
    process.exit(1);
  }

  const base = new URL(process.env.SMOKE_N8N_FALSO || "http://127.0.0.1:5999");
  const puerto = Number(base.port || 80);

  // Si el CRM apunta a otro sitio, la prueba fallaría con un «no se pudo
  // contactar con n8n» que no dice por qué. Mejor decirlo aquí y en voz alta.
  const delCrm = process.env.OUTREACH_SCRAPING_WEBHOOK_URL;
  if (delCrm) {
    try {
      const u = new URL(delCrm);
      if (u.host !== base.host) {
        process.stderr.write(
          `⚠ OUTREACH_SCRAPING_WEBHOOK_URL apunta a ${u.host} y este falso escucha en ${base.host}: el CRM no le va a hablar.\n`
        );
      }
    } catch {
      process.stderr.write(`⚠ OUTREACH_SCRAPING_WEBHOOK_URL no es una URL válida: ${delCrm}\n`);
    }
  }

  let peticiones = 0;
  let ultima = { recibido: false, peticiones: 0 };

  const servidor = createServer((req, res) => {
    if (req.method === "GET" && req.url.startsWith("/last")) {
      responder(res, 200, ultima);
      return;
    }
    if (req.method !== "POST") {
      responder(res, 404, { error: "n8n de mentira: solo POST al webhook y GET /last" });
      return;
    }

    leerCuerpo(req).then((cuerpo) => {
      peticiones += 1;
      const firma = req.headers["x-outreach-signature"];
      const valida = firmaValida(secreto, cuerpo, firma);

      let payload = null;
      try {
        payload = JSON.parse(cuerpo.toString("utf8"));
      } catch {
        payload = null; // n8n tampoco entendería esto; queda constancia igual
      }

      // Se apunta ANTES de contestar, y también cuando la firma es mala: la
      // prueba necesita poder mirar por qué se rechazó.
      ultima = {
        recibido: true,
        hadSignature: typeof firma === "string" && firma.length > 0,
        signatureOk: valida,
        payload,
        ruta: req.url,
        cuando: new Date().toISOString(),
        peticiones,
      };

      const marca = valida ? "✓ firma correcta" : ultima.hadSignature ? "✗ firma que no cuadra" : "✗ sin firma";
      process.stdout.write(`  · POST ${req.url} — ${marca}\n`);

      if (!valida) {
        responder(res, 401, {
          error: ultima.hadSignature ? "firma inválida" : "falta la cabecera x-outreach-signature",
        });
        return;
      }
      responder(res, 200, { empresas: EMPRESAS });
    });
  });

  servidor.on("error", (err) => {
    const detalle = err.code === "EADDRINUSE" ? `el puerto ${puerto} ya está ocupado` : err.message;
    process.stderr.write(`\n✗ n8n de mentira: ${detalle}\n\n`);
    process.exit(1);
  });

  servidor.listen(puerto, base.hostname, () => {
    process.stdout.write(`\n▶ n8n de mentira escuchando en http://${base.host} (firma HMAC obligatoria)\n`);
  });

  for (const senal of ["SIGINT", "SIGTERM"]) {
    process.on(senal, () => {
      servidor.close();
      process.exit(0);
    });
  }
}

// Solo levanta el servidor si se lanza como script. Importarlo (lo hace
// `_smoke-fake-n8n.mjs` para comprobar la firma y las empresas) no debe abrir
// ningún puerto ni leer ninguna variable de entorno.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  arrancar();
}
