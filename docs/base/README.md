# Documentación de la base

Qué hace cada pieza del CRM y dónde vive. Escrita para que un Claude (o una
persona) que llega nuevo pueda tocar un módulo sin releerse el código entero.

Generada el **2026-08-07** contra el commit `030a35e`, verificada contra
código y contra la BD local. Si el código y esta doc discrepan, **manda el
código**: actualiza la doc.

---

## Empieza por aquí

| Doc | Cuándo leerla |
| --- | --- |
| [`arquitectura.md`](arquitectura.md) | Primera vez en el proyecto. Diagrama, multi-tenant, capas de personalización. |
| [`routing-overrides.md`](routing-overrides.md) | **Antes de tocar cualquier override.** La doc más importante de esta carpeta. |
| [`tenant-resolver.md`](tenant-resolver.md) | Al escribir un endpoint, un script o un smoke test. |
| [`module-access.md`](module-access.md) | Al activar un módulo o al preguntarte por qué alguien no ve algo. |
| [`convenciones.md`](convenciones.md) | Al escribir código nuevo. |
| [`db-conventions.md`](db-conventions.md) | Al tocar modelos, migraciones o auditoría. |
| [`patterns.md`](patterns.md) | Antes de inventar una solución: mira si ya existe. |
| [`deploy.md`](deploy.md) | Al desplegar o al ejecutar algo en producción. |

## Fichas de módulo

Una por módulo, con el **inventario exacto de ficheros que lo componen** —
que es lo que hay que clonar para crear un override.

| Módulo | Ficheros | LOC | Tenants |
| --- | ---: | ---: | --- |
| [`billing`](billing.md) | 69 | 10.514 | aumenta, demo, spain_enzymes |
| [`citas`](citas.md) | 31 | 8.771 | aumenta, demo, healim, nutri_laura |
| [`training`](training.md) | 47 | 8.017 | aumenta, demo, nutri_laura, retorika |
| [`clients`](clients.md) | 43 | 6.779 | aumenta, demo, nutri_laura, spain_enzymes |
| [`clinica`](clinica.md) | 47 | 6.568 | aumenta |
| [`projects`](projects.md) | 37 | 6.516 | aumenta, demo |
| [`team`](team.md) | 30 | 6.431 | aumenta, demo, nutri_laura |
| [`outreach`](outreach.md) | 21 | 3.479 | — |
| [`support`](support.md) | 18 | 3.450 | demo (solo local) |
| [`pacientes`](pacientes.md) | 15 | 3.100 | aumenta |
| [`nutricion`](nutricion.md) | 27 | 2.934 | nutri_laura |
| [`leads`](leads.md) | 12 | 1.732 | 6 tenants — **el más personalizado** |
| [`documents`](documents.md) | 15 | 1.671 | — |
| [`orders`](orders.md) | 7 | 1.562 | aumenta, spain_enzymes |
| [`cuestionarios`](cuestionarios.md) | 6 | 1.446 | demo |
| [`calendar`](calendar.md) | 4 | 1.253 | aumenta, demo |
| [`formularios`](formularios.md) | 5 | 997 | nutri_laura |
| [`analytics`](analytics.md) | 4 | 912 | spain_enzymes (prod) |
| [`inventory`](inventory.md) | 5 | 871 | aumenta, demo, spain_enzymes |
| [`referidos`](referidos.md) | 3 | 95 | abarcaia (prod) |
| **Total** | **446** | **77.098** | |

> El **detalle funcional y de negocio** de cada módulo sigue viviendo en
> [`docs/modules/`](../modules/). Estas fichas no lo duplican: dicen **dónde
> está el código** y **cómo se extiende**.

## Las tres cosas que más se pisan

1. **Clave de override con underscore, carpeta con guión.** `nutri_laura:` en
   el mapa, `modules/overrides/nutri-laura/` en disco. Equivocarse no da
   error: el override sencillamente no se aplica.
2. **`tenant_modules.uiOverride` no lo lee nadie.** Escribirlo en BD no activa
   nada; hay que editar el mapa de la página.
   Ver [`routing-overrides.md §4`](routing-overrides.md).
3. **Tres puertas para ver un módulo**: contrato del tenant, `module_access`
   del usuario y `hasModule()` del endpoint. La segunda es la que se olvida —
   las dos últimas veces lo detectó el cliente.
   Ver [`module-access.md`](module-access.md).

## Deuda conocida

Los hallazgos abiertos sobre la base están en
[`../refactor-base-override/backlog.md`](../refactor-base-override/backlog.md):
**H1** (uiOverride muerto), **H2** (query muerta en `/leads`), **H3**
(Nutrición sin base), **H5** (overrides huérfanos y tenants sin documentar).
