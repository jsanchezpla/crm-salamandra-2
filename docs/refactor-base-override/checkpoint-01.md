# Checkpoint 01 — F0 y F1 completas

**Fecha**: 2026-08-07 · **Commit base**: `030a35e` · **Fases**: F0 ✅ F1 ✅

---

## Progreso

| Fase | Estado |
| --- | --- |
| F0 diagnóstico | ✅ completa, plan aprobado por Jorge (**opción A**) |
| F1 documentación de la base | ✅ completa |
| F2 loop de overrides | ⏸️ **no arrancado** — siguiente paso |

**Iteraciones de F2 completadas: 0 de 35.**

## Qué hay entregado

### F0 — diagnóstico

- `f0-diagnostico.md` — mecanismo real de overrides, matriz tenant × módulo
  contra la BD local, coste medido y riesgos.
- `plan.md` — 40 iteraciones ordenadas por criticidad, reducidas a **35
  ejecutables** tras las decisiones delegadas.
- 4 hallazgos en `backlog.md` (H1, H2, H3, H5), **ninguno tocado**.

### F1 — documentación de la base

29 ficheros en `docs/base/` + `docs/README.md`:

- 9 docs transversales: arquitectura (con diagrama), **routing-overrides**
  (la crítica), tenant-resolver, module-access, convenciones, db-conventions,
  patterns (13 patrones), deploy, README.
- **20 fichas de módulo** con el inventario exacto de ficheros de cada uno —
  que es literalmente la lista de lo que hay que clonar en cada iteración.
- Total documentado: **446 ficheros / 77.098 LOC**.

### Extra — entorno de testing

`metodo-testing.md`, **probado end-to-end**: firma de token por tenant con
`signAccessToken`, cookie inyectada en el navegador, verificación con Claude
in Chrome. Permite cambiar de tenant a voluntad, que es lo que hace barato el
test 3 (regresión). **No usa credenciales de Jorge.**

## Testing

| Test | Resultado |
| --- | --- |
| Servidor de desarrollo | ✅ levanta y compila |
| Login como `nutri_laura` | ✅ vía token firmado |
| Consola del navegador | ✅ sin errores |
| Baseline capturado | ✅ `/clientes` de nutri_laura |

No hay tests de iteración porque F2 no ha empezado.

## Working tree

```
?? docs/README.md
?? docs/base/                    (29 ficheros)
?? docs/refactor-base-override/  (7 ficheros)
```

**0 líneas de código tocadas. 0 commits.** Todo es documentación nueva.

## Bugs bloqueantes

Ninguno. `bugs.md` está vacío.

## Decisiones tomadas por delegación

Jorge eligió la opción **A** y delegó el resto. Detalle y motivos en la tabla
de `plan.md`:

| Pregunta | Decisión |
| --- | --- |
| Por dónde arrancar | `nutri_laura` (6 módulos, no 12) |
| Sembrar sandbox/healim/abarcaia | No de momento — sus 3 iteraciones al final |
| ¿Entran healim y salamandra_solutions? | `healim` sí; `salamandra_solutions` no (solo tiene el panel interno) |
| Extraer base de Nutrición (H3) | No — toca código base. Iteración 4 aplazada |

## Para retomar

1. Leer `state.json` y `plan.md` (tabla de iteraciones + decisiones).
2. Leer `metodo-testing.md` — el entorno ya está resuelto, no hay que
   reinventarlo.
3. Leer `docs/base/routing-overrides.md` **antes de tocar el primer override**.
4. Arrancar la **iteración 1: `nutri_laura` × `clients`**. La lista exacta de
   los 43 ficheros a clonar está en `docs/base/clients.md`.

### Aviso para la iteración 1

`clients` son **43 ficheros y 6.779 LOC**, y el mecanismo de override actual
solo cubre la **ficha** (`/clientes/[id]`), no el listado ni los 26 endpoints.
Habrá que decidir si la iteración clona:

- **(a)** solo lo que hoy tiene mecanismo (la ficha) — barato, pero no es
  "el módulo";
- **(b)** el módulo entero, añadiendo mapas `UI_OVERRIDES` a páginas que hoy
  no los tienen, y duplicando endpoints — que es lo que pide el runbook, y
  toca `app/api/**`, hoy en la lista de intocables.

**(b) requiere autorización de Jorge**: el runbook prohíbe tocar endpoints
base, pero la opción A no se puede cumplir sin hacerlo. Es la primera
contradicción real entre las dos instrucciones y no la resuelvo solo.
