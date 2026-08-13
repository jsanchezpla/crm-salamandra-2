/**
 * migrate-buzon.js — el buzón por el que un cliente nos escribe A NOSOTROS.
 *
 * POR QUÉ HACE FALTA
 * Hasta el 13/08/2026 no había ningún camino por el que un cliente nos contara
 * que algo va mal. Lo único era un `mailto:` en la pantalla de Soporte, y encima
 * solo lo veían los clientes SIN el módulo `support`: Aumenta y la demo, que sí
 * lo tienen, no tenían ni eso.
 *
 * POR QUÉ SE LLAMA «BUZÓN» Y NO «INCIDENCIAS» NI «AVISOS»
 * Las dos palabras están cogidas, y por cosas distintas:
 *   · `Incidencia` (`models/tenant/Incidencia.model.js`) es el Programa de
 *     Excelencia de Clínica: se queda dentro del centro. En el sidebar de
 *     Aumenta ya hay una entrada con ese nombre.
 *   · `ClientNotice` es «Aviso al cliente» y tiene su `POST /api/citas/avisos`:
 *     va de nosotros-el-centro hacia el paciente, o sea al revés que esto.
 * `buzon` estaba libre en todo el repo. Dos cosas que se llaman igual y no son
 * lo mismo es el error que este proyecto lleva meses deshaciendo.
 *
 * POR QUÉ EN MASTER Y NO EN EL SCHEMA DE CADA CLIENTE
 * Fue la decisión que el backlog dejaba abierta a propósito, y hay tres motivos:
 *
 *   1. Un aviso tiene que SOBREVIVIR a la baja del cliente. El 12/08 se dieron
 *      de baja tres y se purgaron sus schemas; lo que escribieron antes de irse
 *      suele ser justo la explicación de por qué se van.
 *   2. Tiene que funcionar AUNQUE su base esté rota, que es exactamente cuando
 *      escriben. Guardar «mi CRM no va» dentro del CRM que no va es pedirlo.
 *   3. Nuestra bandeja es UNA consulta, no abrir conexión a todos los schemas.
 *
 * ⚠️ Esto es una EXCEPCIÓN a una regla escrita del repo: `lib/utils/auditoria.js`
 * y `docs/base/db-conventions.md` §6.2 prohíben duplicar en master datos
 * personales del schema de un cliente. Se sostiene porque el texto no es una
 * COPIA de ninguna ficha: lo escribe una persona, a propósito y dirigido a
 * nosotros. Pero va acompañada de tres frenos, no de uno: el formulario pide que
 * no se escriban nombres de pacientes, la auditoría guarda solo el número y el
 * cliente (nunca el texto), y `scripts/podar-buzon.js` lo caduca.
 *
 * OJO: opera sobre el schema MASTER, no sobre los `crm_*` — por eso no va en el
 * registro de migraciones por tenant. Se lanza una vez a mano:
 *
 * Uso local:  node --env-file=.env.local scripts/migrate-buzon.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-buzon.js
 *
 * Es idempotente: se puede repetir sin miedo.
 */

import { Sequelize } from "sequelize";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { logging: false });

  // El correlativo lo pone la BASE DE DATOS, nunca la app — mismo criterio que
  // `Ticket.number` (`models/tenant/Ticket.model.js:12-15`). Dos avisos que
  // entran a la vez no pueden pelearse por el número. Aquí la secuencia es
  // GLOBAL: una sola bandeja para todos los clientes, no una por schema.
  await s.query(`CREATE SEQUENCE IF NOT EXISTS master.buzon_numero_seq`);
  process.stdout.write("✓ master.buzon_numero_seq\n");

  // ── El aviso ──────────────────────────────────────────────────────────────
  //
  // `tenant_id` y `usuario_id` van SIN clave ajena, y los nombres se guardan
  // como FOTO DE TEXTO al lado. Es deliberado, y hay prueba de qué pasa si no:
  // `master.audit_logs` SÍ tiene FK con ON DELETE SET NULL, y por eso
  // `scripts/borrar-tenant.js` necesita una sección entera para que el histórico
  // no se quede sin atribución al dar de baja a alguien. Con la foto, el aviso
  // se lee para siempre aunque ya no exista ni el schema.
  //
  // Los campos de lista cerrada (`tipo`, `estado`, `prioridad`) son VARCHAR sin
  // CHECK a propósito: quien escribe aquí es SIEMPRE `lib/buzon/buzonStore.js`,
  // que valida con `lib/buzon/buzon.js`. Un CHECK obligaría a una migración cada
  // vez que se añada un estado, y pondría la validación en dos sitios.
  await s.query(`
    CREATE TABLE IF NOT EXISTS master.buzon_avisos (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      numero            INTEGER NOT NULL DEFAULT nextval('master.buzon_numero_seq'),

      tenant_id         UUID,
      tenant_slug       VARCHAR(63) NOT NULL,
      tenant_nombre     VARCHAR(255),
      usuario_id        UUID,
      usuario_email     VARCHAR(255),
      usuario_nombre    VARCHAR(255),
      usuario_rol       VARCHAR(40),

      tipo              VARCHAR(20)  NOT NULL DEFAULT 'error',
      asunto            VARCHAR(200) NOT NULL,
      cuerpo            TEXT         NOT NULL,
      bloquea           BOOLEAN      NOT NULL DEFAULT false,

      estado            VARCHAR(20) NOT NULL DEFAULT 'nuevo',
      prioridad         VARCHAR(10) NOT NULL DEFAULT 'normal',
      asignado_a        VARCHAR(40),

      pantalla          VARCHAR(500),
      contexto          JSONB NOT NULL DEFAULT '{}'::jsonb,

      -- leido_at es cuándo lo abrimos NOSOTROS; visto_cliente_at, cuándo lo
      -- abrió ÉL. Los dos hacen falta y no son simétricos: el segundo es lo
      -- único que permite poner un punto en su menú cuando le hemos contestado
      -- y todavía no lo ha visto. Sin esa columna, el punto se quedaría
      -- encendido para siempre.
      leido_at          TIMESTAMPTZ,
      visto_cliente_at  TIMESTAMPTZ,
      respondido_at     TIMESTAMPTZ,
      resuelto_at       TIMESTAMPTZ,
      ultimo_mensaje_at TIMESTAMPTZ,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  process.stdout.write("✓ master.buzon_avisos\n");

  // ── El hilo ───────────────────────────────────────────────────────────────
  //
  // Tabla propia y no una columna JSONB: hace falta saber quién escribió cada
  // línea y cuándo, y marcar las NOTAS INTERNAS que el cliente no ve. La columna
  // `messages` JSONB de `tickets` nació así y quedó muerta por esto mismo
  // (`docs/modules/support.md`).
  await s.query(`
    CREATE TABLE IF NOT EXISTS master.buzon_mensajes (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      aviso_id     UUID NOT NULL REFERENCES master.buzon_avisos(id) ON DELETE CASCADE,
      autor_tipo   VARCHAR(20) NOT NULL DEFAULT 'cliente',
      autor_nombre VARCHAR(255),
      autor_email  VARCHAR(255),
      cuerpo       TEXT NOT NULL,
      interno      BOOLEAN NOT NULL DEFAULT false,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  process.stdout.write("✓ master.buzon_mensajes\n");

  // ── Los adjuntos ──────────────────────────────────────────────────────────
  //
  // El FICHERO vive en disco (`lib/buzon/buzonStorage.js`, volumen
  // `/app/uploads`); aquí solo está su ficha. `mensaje_id` nulo = adjunto del
  // alta, o sea de la descripción inicial y no de una respuesta.
  await s.query(`
    CREATE TABLE IF NOT EXISTS master.buzon_adjuntos (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      aviso_id   UUID NOT NULL REFERENCES master.buzon_avisos(id) ON DELETE CASCADE,
      mensaje_id UUID REFERENCES master.buzon_mensajes(id) ON DELETE CASCADE,
      nombre     VARCHAR(255) NOT NULL,
      ruta       VARCHAR(500) NOT NULL,
      bytes      INTEGER NOT NULL DEFAULT 0,
      mime       VARCHAR(120),
      subido_por VARCHAR(20) NOT NULL DEFAULT 'cliente',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  process.stdout.write("✓ master.buzon_adjuntos\n");

  // ── Índices ───────────────────────────────────────────────────────────────
  const indices = [
    // El número es la referencia que se le da al cliente («AV-0042»): único.
    `CREATE UNIQUE INDEX IF NOT EXISTS buzon_avisos_numero_uidx
       ON master.buzon_avisos (numero)`,
    // Cómo se pinta NUESTRA bandeja: por estado, lo que se movió hace menos arriba.
    `CREATE INDEX IF NOT EXISTS buzon_avisos_estado_idx
       ON master.buzon_avisos (estado, ultimo_mensaje_at DESC)`,
    // Cómo se pinta la pantalla del CLIENTE: los suyos, los últimos primero.
    `CREATE INDEX IF NOT EXISTS buzon_avisos_usuario_idx
       ON master.buzon_avisos (usuario_id, created_at DESC)`,
    // Para agrupar por cliente cuando queramos ver a quién le va peor.
    `CREATE INDEX IF NOT EXISTS buzon_avisos_tenant_idx
       ON master.buzon_avisos (tenant_slug)`,
    `CREATE INDEX IF NOT EXISTS buzon_mensajes_aviso_idx
       ON master.buzon_mensajes (aviso_id, created_at ASC)`,
    `CREATE INDEX IF NOT EXISTS buzon_adjuntos_aviso_idx
       ON master.buzon_adjuntos (aviso_id)`,
  ];
  for (const sql of indices) await s.query(sql);
  process.stdout.write(`✓ ${indices.length} índices\n`);

  // La secuencia tiene que ir por delante de lo que ya hubiera, o el primer
  // aviso nuevo chocaría con el índice único. Solo hace algo si se repite la
  // migración sobre una tabla que ya tiene filas.
  //
  // El tercer argumento (`is_called`) es el que hace que el PRIMER aviso sea el
  // número 1 y no el 2: con la tabla vacía se deja la secuencia «sin estrenar»,
  // así que `nextval` devuelve 1. Con `true` —que es el defecto— devolvería 2, y
  // un correlativo que empieza en AV-0002 parece que ha perdido uno por el
  // camino.
  await s.query(`
    SELECT setval('master.buzon_numero_seq',
                  GREATEST((SELECT COALESCE(MAX(numero), 0) FROM master.buzon_avisos), 1),
                  (SELECT COUNT(*) > 0 FROM master.buzon_avisos))
  `);

  const [filas] = await s.query(`
    SELECT (SELECT count(*)::int FROM master.buzon_avisos)   AS avisos,
           (SELECT count(*)::int FROM master.buzon_mensajes) AS mensajes,
           (SELECT count(*)::int FROM master.buzon_adjuntos) AS adjuntos
  `);
  const { avisos, mensajes, adjuntos } = filas[0];
  process.stdout.write(`  · ${avisos} aviso(s), ${mensajes} mensaje(s), ${adjuntos} adjunto(s)\n`);

  await s.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
