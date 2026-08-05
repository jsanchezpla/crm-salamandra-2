/**
 * sync-formacion-nocturno.js — el repaso de madrugada del módulo Formación
 * (05/08/2026).
 *
 * Le pide a la web de cada cliente con `training` que mande TODOS sus cursos y
 * matrículas. Es lo mismo que hace el botón «Sincronizar todo», sin nadie
 * delante.
 *
 * POR QUÉ EXISTE: el puente TutorLMS → CRM avisa solo al publicar un curso y al
 * matricularse una alumna, pero si en ese momento algo falla —la web sin red,
 * el CRM reiniciándose por un despliegue, un secreto mal puesto— ese aviso se
 * pierde y NADIE se entera. Pasó en julio y estuvo días roto. Con esto, lo peor
 * que pasa es que un dato tarde una noche.
 *
 * Es IDEMPOTENTE: el CRM da de alta lo que falta y salta lo que ya tiene. Se
 * puede lanzar tantas veces como haga falta.
 *
 * NO hardcodea slugs: lee de `master.tenants` quién tiene el módulo, como
 * manda la regla #12.
 *
 * Uso local:  node --env-file=.env.local scripts/sync-formacion-nocturno.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/sync-formacion-nocturno.js
 *
 * En el VPS lo dispara un timer de systemd (ver docs/modules/training.md).
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { sincronizarDesdeWordpress } from "../lib/training/syncWordpress.js";

function log(msg) { process.stdout.write(`${msg}\n`); }

async function main() {
  getMasterDb();
  const { Tenant, TenantModule } = getMasterModels();

  const modulos = await TenantModule.findAll({ where: { moduleKey: "training", enabled: true } });
  if (!modulos.length) {
    log("· Ningún cliente tiene el módulo de formación activo.");
    process.exit(0);
  }

  let conErrores = 0;

  for (const mod of modulos) {
    const tenant = await Tenant.findByPk(mod.tenantId);
    if (!tenant || tenant.status !== "active") continue;

    const { models: tenantModels } = getTenantDb(tenant.slug);

    try {
      const res = await sincronizarDesdeWordpress(tenant.toJSON(), tenantModels);
      if (res.ok) {
        log(`✓ ${tenant.slug}: ${res.mensaje}`);
      } else {
        // `sin_url` y `sin_soporte` NO son fallos: son clientes que no tienen
        // web conectada, o que aún no han instalado la versión del tema que
        // trae esto. Avisar de ellos cada noche llenaría el registro de ruido
        // y acabaría con nadie leyéndolo.
        const esperado = res.motivo === "sin_url" || res.motivo === "sin_soporte";
        log(`${esperado ? "·" : "✗"} ${tenant.slug}: ${res.mensaje}`);
        if (!esperado) conErrores++;
      }
    } catch (err) {
      log(`✗ ${tenant.slug}: ${err.message}`);
      conErrores++;
    }
  }

  // Se sale con error solo si algo falló DE VERDAD, para que el timer lo marque
  // como fallido y se pueda mirar con `systemctl status`.
  process.exit(conErrores ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err.stack || err.message}\n`);
  process.exit(1);
});
