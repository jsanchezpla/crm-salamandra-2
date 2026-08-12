/**
 * migrate-paquetes-modulos.js — la tabla donde viven los paquetes de módulos.
 *
 * POR QUÉ HACE FALTA
 * Hasta el 12/08/2026 los dos paquetes que se ofrecían en el alta —Nutrición y
 * Clínica— estaban ESCRITOS en `lib/provisioning/catalogo.js`. Inventar un
 * tercero, o cambiar qué lleva uno, era tocar código y desplegar. Jorge pidió
 * poder crearlos desde el back-office.
 *
 * Lo que NO cambia: un paquete sigue sin guardarse en ningún cliente. Todos los
 * tenants tienen sus módulos puestos a mano y así se quedan; el paquete es solo
 * un atajo para marcar casillas al dar de alta.
 *
 * LA SEMILLA
 * Se insertan los dos de siempre con `ON CONFLICT (clave) DO NOTHING`. A partir
 * de ahí manda la tabla: si alguien los edita o los borra, esta migración
 * repetida NO se los devuelve. Esa es la diferencia entre sembrar y restaurar,
 * y es a propósito — un borrado que no borra es peor que no poder borrar.
 *
 * OJO: opera sobre el schema MASTER, no sobre los `crm_*`, así que no va en el
 * registro de migraciones por tenant. Se lanza una vez a mano:
 *
 * Uso local:  npm run db:migrate:paquetes
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-paquetes-modulos.js
 *
 * Es idempotente: se puede repetir sin miedo.
 */

import { Sequelize } from "sequelize";

/*
 * La semilla va COPIADA aquí y no importada de `catalogo.js` a propósito.
 *
 * Una migración es una foto de un momento: tiene que hacer dentro de seis meses
 * exactamente lo que hace hoy. Si leyera la constante del código, el día que
 * alguien edite esa lista —para documentar otra cosa, por ejemplo— esta
 * migración empezaría a sembrar algo distinto en cualquier entorno nuevo, sin
 * que nadie lo hubiera pedido.
 */
const SEMILLA = [
  {
    clave: "nutricion",
    nombre: "Paquete Nutrición",
    descripcion:
      "Lo que tiene un centro de nutrición: agenda con área privada, fichas, leads profesionales y comerciales, equipo y el contrato del centro.",
    modulos: ["citas", "clients", "leads", "formularios", "team", "documents", "nutricion"],
    orden: 10,
  },
  {
    clave: "clinica",
    nombre: "Paquete Clínica",
    descripcion:
      "El de Nutrición cambiando el recetario por el bloque clínico: pacientes, sesiones, informes y coordinaciones.",
    modulos: ["citas", "clients", "leads", "formularios", "team", "documents", "pacientes", "clinica"],
    orden: 20,
  },
];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { logging: false });

  await s.query(`
    CREATE TABLE IF NOT EXISTS master.paquetes_modulos (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      clave        VARCHAR(60) NOT NULL UNIQUE,
      nombre       VARCHAR(120) NOT NULL,
      descripcion  TEXT,
      modulos      JSONB NOT NULL DEFAULT '[]'::jsonb,
      orden        INTEGER NOT NULL DEFAULT 0,
      activo       BOOLEAN NOT NULL DEFAULT true,
      tocado_por   VARCHAR(255),
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  process.stdout.write("✓ master.paquetes_modulos\n");

  for (const p of SEMILLA) {
    await s.query(
      `INSERT INTO master.paquetes_modulos (clave, nombre, descripcion, modulos, orden)
       VALUES (:clave, :nombre, :descripcion, CAST(:modulos AS jsonb), :orden)
       ON CONFLICT (clave) DO NOTHING`,
      {
        replacements: {
          clave: p.clave,
          nombre: p.nombre,
          descripcion: p.descripcion,
          modulos: JSON.stringify(p.modulos),
          orden: p.orden,
        },
      }
    );
  }

  const [filas] = await s.query(
    "SELECT clave, nombre, jsonb_array_length(modulos) AS n, activo FROM master.paquetes_modulos ORDER BY orden, nombre"
  );
  process.stdout.write(`  · ${filas.length} paquete(s):\n`);
  for (const f of filas) {
    process.stdout.write(`      ${f.activo ? "✓" : "✗"} ${String(f.clave).padEnd(16)} ${f.n} módulos — ${f.nombre}\n`);
  }

  await s.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
