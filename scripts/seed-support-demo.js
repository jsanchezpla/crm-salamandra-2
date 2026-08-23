// @vivo — Único seed que llena el módulo Soporte de la demo (4 categorías, 2 plantillas, 8 tickets con hilo y SLA, solo si crm_demo no tiene tickets) y el… (leído el 19/08/2026; ver scripts/_hechos/README.md)
/**
 * seed-support-demo.js — datos de ejemplo del módulo Soporte para el tenant
 * DEMO (escaparate con datos FALSOS, ver CLAUDE.md). Crea categorías,
 * plantillas de respuesta y una bandeja creíble: tickets en varios estados y
 * prioridades, con hilo (respuestas + notas internas) y algún SLA vencido para
 * que la campana y el aviso rojo tengan algo que enseñar.
 *
 * SOLO toca crm_demo, a propósito (mismo criterio que seed-clinica-demo.js:
 * los seeds de escaparate son por-tenant). Idempotente a lo bruto: si ya hay
 * tickets en demo, no hace nada.
 *
 * Uso local:  node --env-file=.env.local scripts/seed-support-demo.js
 */

import { Sequelize } from "sequelize";

const SCHEMA = "crm_demo";

function log(msg) { process.stdout.write(`  ${msg}\n`); }

async function main() {
  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" Seed: módulo Soporte en demo\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const [[{ n }]] = await s.query(`SELECT COUNT(*)::int AS n FROM "${SCHEMA}".tickets`);
  if (n > 0) {
    log(`· Ya hay ${n} tickets en demo — no se toca nada.`);
    await s.close();
    process.exit(0);
  }

  // ── Categorías y plantillas ────────────────────────────────────────────────
  const categorias = [
    ["Facturación", "#B45309", 0],
    ["Incidencia técnica", "#B91C1C", 1],
    ["Pedidos", "#0E7490", 2],
    ["Consulta general", "#4D7C0F", 3],
  ];
  for (const [name, color, orden] of categorias) {
    await s.query(
      `INSERT INTO "${SCHEMA}".ticket_categories (name, color, sort_order)
       SELECT :name, :color, :orden
        WHERE NOT EXISTS (SELECT 1 FROM "${SCHEMA}".ticket_categories WHERE name = :name)`,
      { replacements: { name, color, orden } }
    );
  }
  log(`✓ ${categorias.length} categorías`);

  const plantillas = [
    [
      "Pedimos captura de pantalla",
      "¡Hola! Para localizar el problema nos ayudaría mucho una captura de pantalla de lo que ves, junto con la hora aproximada a la que pasó. Con eso lo miramos enseguida.",
    ],
    [
      "Factura reenviada",
      "Te acabamos de reenviar la factura al email de tu ficha. Si en unos minutos no la ves, revisa la carpeta de spam y dinos algo.",
    ],
  ];
  for (const [name, body] of plantillas) {
    await s.query(
      `INSERT INTO "${SCHEMA}".ticket_templates (name, body, sort_order)
       SELECT :name, :body, 0
        WHERE NOT EXISTS (SELECT 1 FROM "${SCHEMA}".ticket_templates WHERE name = :name)`,
      { replacements: { name, body } }
    );
  }
  log(`✓ ${plantillas.length} plantillas`);

  await s.query(`INSERT INTO "${SCHEMA}".support_settings (id) SELECT gen_random_uuid()
                  WHERE NOT EXISTS (SELECT 1 FROM "${SCHEMA}".support_settings)`);

  // ── Material de enlace: clientes y equipo reales del schema demo ───────────
  const [clientes] = await s.query(`SELECT id, name, email FROM "${SCHEMA}".clients ORDER BY created_at LIMIT 4`);
  const [equipo] = await s.query(`SELECT id, display_name FROM "${SCHEMA}".team_members ORDER BY created_at LIMIT 3`);
  const [cats] = await s.query(`SELECT id, name FROM "${SCHEMA}".ticket_categories ORDER BY sort_order`);
  const cat = (nombre) => cats.find((c) => c.name === nombre)?.id ?? null;
  const cli = (i) => clientes[i % Math.max(clientes.length, 1)] ?? null;
  const tm = (i) => equipo[i % Math.max(equipo.length, 1)] ?? null;

  // ── Tickets ───────────────────────────────────────────────────────────────
  // h = horas hacia atrás desde ahora. Los "due" se colocan a mano para que
  // haya de todo: en plazo, a punto de vencer y vencidos.
  const H = 3600 * 1000;
  const ahora = Date.now();
  const iso = (hAtras) => new Date(ahora - hAtras * H).toISOString();

  const tickets = [
    {
      title: "No me llega la factura de junio",
      description: "Buenas, en el área de cliente no aparece la factura de junio y la necesito para contabilidad antes del viernes.",
      status: "open", priority: "high", channel: "portal", categoria: cat("Facturación"),
      cliente: cli(0), asignado: null,
      createdH: 30, dueFrH: 26, dueRsH: 6, // SLA de 1ª respuesta VENCIDO y sin responder
      mensajes: [],
    },
    {
      title: "Error al exportar el listado de pedidos",
      description: "Al pulsar en Exportar a Excel sale un error 500 y no descarga nada. Nos pasa a dos compañeras desde ayer.",
      status: "in_progress", priority: "critical", channel: "portal", categoria: cat("Incidencia técnica"),
      cliente: cli(1), asignado: tm(0),
      createdH: 5, dueFrH: 3, dueRsH: -3, firstRespH: 4,
      mensajes: [
        { tipo: "team", autor: tm(0)?.display_name || "Equipo", texto: "Lo estamos reproduciendo: pasa solo con listados de más de 500 filas. Estamos en ello, te digo algo hoy mismo.", interna: false, hAtras: 4 },
        { tipo: "team", autor: tm(0)?.display_name || "Equipo", texto: "Es el timeout del generador de Excel. Subo el límite y pruebo con su cuenta antes de responder.", interna: true, hAtras: 3 },
      ],
    },
    {
      title: "¿Podéis cambiar la dirección de entrega del pedido 1042?",
      description: "El pedido 1042 tiene que ir al almacén nuevo del polígono, no a la tienda. ¿Llegáis a tiempo?",
      status: "waiting", priority: "medium", channel: "manual", categoria: cat("Pedidos"),
      cliente: cli(2), asignado: tm(1),
      createdH: 26, dueFrH: 18, dueRsH: 46, firstRespH: 24,
      mensajes: [
        { tipo: "team", autor: tm(1)?.display_name || "Equipo", texto: "¡Hecho! Queda redirigido al polígono. ¿Me confirmas que el horario de recepción sigue siendo de 8 a 14?", interna: false, hAtras: 24 },
      ],
    },
    {
      title: "Duda con el nuevo panel de informes",
      description: "¿Los datos del panel de informes se actualizan al momento o una vez al día? Lo pregunto porque no me cuadra una cifra de esta mañana.",
      status: "resolved", priority: "low", channel: "portal", categoria: cat("Consulta general"),
      cliente: cli(3), asignado: tm(2),
      createdH: 76, dueFrH: 52, dueRsH: -44, firstRespH: 70, resolvedH: 50,
      mensajes: [
        { tipo: "team", autor: tm(2)?.display_name || "Equipo", texto: "Se actualizan cada hora en punto. La cifra que no te cuadraba era de las 9:00; a las 10:00 ya estaba corregida.", interna: false, hAtras: 70 },
        { tipo: "client", autor: "Cliente", texto: "¡Perfecto, era eso! Gracias.", interna: false, hAtras: 52 },
      ],
    },
    {
      title: "El lector de códigos no conecta con el inventario",
      description: "Desde la actualización del viernes el lector PDA no sincroniza con el stock. Estamos apuntando entradas a mano.",
      status: "open", priority: "high", channel: "manual", categoria: cat("Incidencia técnica"),
      cliente: cli(0), asignado: tm(0),
      createdH: 50, dueFrH: 46, dueRsH: 26, // TODO vencido: 1ª respuesta y resolución
      mensajes: [],
    },
    {
      title: "Solicitud de alta de dos usuarios nuevos",
      description: "Se incorporan dos personas al equipo de administración la semana que viene. ¿Podéis darles acceso con perfil básico?",
      status: "closed", priority: "low", channel: "manual", categoria: cat("Consulta general"),
      cliente: cli(1), asignado: tm(1),
      createdH: 200, dueFrH: 176, dueRsH: 80, firstRespH: 196, resolvedH: 190, closedH: 100,
      mensajes: [
        { tipo: "team", autor: tm(1)?.display_name || "Equipo", texto: "Creados los dos accesos con perfil básico. Les llega email de bienvenida con su contraseña temporal.", interna: false, hAtras: 196 },
      ],
    },
    {
      title: "Cargo duplicado en la cuota de mayo",
      description: "En el extracto aparecen dos cargos de la cuota de mayo con un día de diferencia. Uno de los dos sobra.",
      status: "waiting", priority: "high", channel: "portal", categoria: cat("Facturación"),
      cliente: cli(2), asignado: tm(2),
      createdH: 10, dueFrH: 6, dueRsH: 14, firstRespH: 8,
      mensajes: [
        { tipo: "team", autor: tm(2)?.display_name || "Equipo", texto: "Tienes razón, el segundo cargo es un duplicado del banco. Hemos pedido la devolución: la verás en 2-3 días hábiles. ¿Te aviso por aquí cuando salga?", interna: false, hAtras: 8 },
        { tipo: "team", autor: tm(2)?.display_name || "Equipo", texto: "Devolución pedida en el TPV con referencia 8841. Pendiente de confirmar por el banco.", interna: true, hAtras: 7 },
      ],
    },
    {
      title: "¿Hay descuento por facturación anual?",
      description: "Estamos valorando pasar de pago mensual a anual. ¿Qué condiciones tendría?",
      status: "open", priority: "medium", channel: "portal", categoria: cat("Consulta general"),
      cliente: cli(3), asignado: null,
      createdH: 2, dueFrH: 6, dueRsH: 70, // fresco, en plazo, sin asignar
      mensajes: [],
    },
  ];

  let creados = 0;
  for (const t of tickets) {
    const [[fila]] = await s.query(
      `INSERT INTO "${SCHEMA}".tickets
         (title, description, status, priority, channel, category_id, client_id, assigned_to,
          portal_token, requester_name, requester_email,
          first_response_due_at, resolution_due_at, first_response_at, resolved_at, closed_at,
          last_message_at, created_at, updated_at)
       VALUES
         (:title, :description, :status, :priority, :channel, :categoria, :clienteId, :asignado,
          md5(random()::text) || md5(random()::text), :reqName, :reqEmail,
          :dueFr, :dueRs, :firstResp, :resolved, :closed,
          :lastMsg, :created, :created)
       RETURNING id`,
      {
        replacements: {
          title: t.title,
          description: t.description,
          status: t.status,
          priority: t.priority,
          channel: t.channel,
          categoria: t.categoria,
          clienteId: t.cliente?.id ?? null,
          asignado: t.asignado?.id ?? null,
          reqName: t.cliente?.name ?? "Cliente de prueba",
          reqEmail: t.cliente?.email ?? "cliente@ejemplo.com",
          created: iso(t.createdH),
          dueFr: t.dueFrH != null ? iso(t.dueFrH) : null,
          dueRs: t.dueRsH != null ? iso(t.dueRsH) : null,
          firstResp: t.firstRespH != null ? iso(t.firstRespH) : null,
          resolved: t.resolvedH != null ? iso(t.resolvedH) : null,
          closed: t.closedH != null ? iso(t.closedH) : null,
          lastMsg: iso(t.mensajes.length ? Math.min(...t.mensajes.map((m) => m.hAtras)) : t.createdH),
        },
      }
    );
    for (const m of t.mensajes) {
      await s.query(
        `INSERT INTO "${SCHEMA}".ticket_messages
           (ticket_id, author_type, author_name, body, is_internal, email_status, created_at, updated_at)
         VALUES (:ticketId, :tipo, :autor, :texto, :interna, :emailStatus, :fecha, :fecha)`,
        {
          replacements: {
            ticketId: fila.id,
            tipo: m.tipo,
            autor: m.autor,
            texto: m.texto,
            interna: m.interna,
            emailStatus: m.tipo === "team" && !m.interna ? "sent" : null,
            fecha: iso(m.hAtras),
          },
        }
      );
    }
    creados++;
  }
  log(`✓ ${creados} tickets con su hilo`);

  process.stdout.write("\n✓ Seed de Soporte en demo completado\n\n");
  await s.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
