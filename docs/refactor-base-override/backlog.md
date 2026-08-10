# Backlog — detectado en base, NO tocado

Regla 5 del runbook: si se detecta algo en código base, se apunta aquí y se
sigue. Nada de esto se ha modificado.

---

## H1 — `tenant_modules.uiOverride` está muerto

**Severidad**: media · **Detectado**: F0, 2026-08-07 · **Área**: mecanismo de overrides

La columna existe en `master.tenant_modules`, los scripts de seed la escriben,
`scripts/inspect-tenant-modules.js` y `app/admin/page.jsx` la muestran — y
**ningún código de la app la lee**. El override real es un mapa literal
hardcodeado en cada página.

Divergencia viva hoy: `nutri_laura` tiene `training → uiOverride =
"nutri-laura/FormacionOverview"` en BD, pero ese fichero no existe y
`app/(dashboard)/formacion/page.jsx` solo mapea `aumenta`.

**Opciones**: que el registry lea la columna, o eliminarla y dejar que el mapa
mande. Lo que no puede quedarse es la ambigüedad: hoy el panel de admin enseña
a Jorge un override que no está activo.

---

## H2 — Query muerta en `/leads`

**Severidad**: menor (perf) · **Detectado**: F0, 2026-08-07
**Sitio**: `app/(dashboard)/leads/page.jsx:39-47`

```js
if (tenantSlug) {
  const { Tenant, TenantModule } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: tenantSlug } });
  if (tenant) {
    await TenantModule.findOne({           // ← el resultado se descarta
      where: { tenantId: tenant.id, moduleKey: "leads" },
    });
  }
}
```

Dos roundtrips a master por cada render de `/leads`, sin ningún efecto. Se
borra en una línea, pero es código base: no se toca sin permiso.

---

## H3 — Nutrición no tiene base

**Severidad**: media · **Detectado**: F0, 2026-08-07
**Sitios**: `app/(dashboard)/nutricion/{recetas,alimentos,plantillas,asignados}/page.jsx`

Las 4 páginas importan `modules/overrides/nutri-laura/Nutricion*Module.jsx`
**como fallback por defecto**. El "base" del módulo es el override de un
tenant concreto.

Hoy no da problemas porque `nutricion` solo lo tiene `nutri_laura`. El día que
entre un segundo cliente de nutrición hereda la UI de Laura, con sus textos.

**Bloquea** cualquier iteración de F2 sobre Nutrición: no se puede clonar el
base de un módulo que no tiene base.

---

## H5 — Overrides huérfanos y tenants sin documentar

**Severidad**: menor · **Detectado**: F0, 2026-08-07

- `modules/overrides/sandbox/LeadsModule.jsx` y
  `modules/overrides/abarcaia/LeadsModule.jsx` existen en código, pero
  ninguno de los dos tenants está en la BD **local**. `abarcaia` es
  solo-producción (documentado); `sandbox` no aparece en ningún sitio.
- `healim` (starter, solo `citas`) y `salamandra_solutions` (free, solo
  `provisioning`) están activos en BD local y **no salen en la tabla de
  tenants de CLAUDE.md**.

Sugerencia: actualizar la tabla de CLAUDE.md, que es la que todo el mundo
lee primero.
