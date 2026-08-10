# Plan de iteraciones — refactor base/override

**Estado**: 🟡 pendiente de aprobación de Jorge.
**Basado en**: `f0-diagnostico.md` (BD local, commit `030a35e`, 2026-08-07).

> El runbook exige aprobación explícita antes de pasar a F1, y aprobación de
> la documentación antes de pasar a F2. Este documento es el entregable de F0.

---

## Decisión previa: A o B

F0 ha destapado que el refactor literal duplica **~150.000 LOC** (la capa de
aplicación pasa de ~99k a ~240k) y deja **8 copias de Leads, 4 de Clientes,
4 de Citas y 3 de Facturación** que ya no reciben los fixes de base. El
detalle y los precedentes están en `f0-diagnostico.md §4` y `§5`.

Las dos opciones. **F1 es idéntica en ambas** y es la que Jorge pidió por su
nombre, así que puede arrancar ya sea cual sea la elección.

### Opción A — refactor literal (lo que dice el runbook)

Clonar los 40 pares tenant × módulo. Aislamiento total: tocar Aumenta no
puede romper a Laura, por construcción.

- **Coste**: 40 iteraciones × 20-40 min ≈ 15-25 h.
- **Precio**: ~150k LOC duplicados; cada fix de seguridad se multiplica por
  el número de copias del módulo.

### Opción B — documentar + override bajo demanda (recomendada)

1. **F1 completa** (igual que en A).
2. **Arreglar el mecanismo** antes de multiplicarlo — 3 tareas pequeñas:
   - un registry único (`modules/registry.js`) en vez de 8 mapas literales;
   - que el registry **lea `tenant_modules.uiOverride`**, que hoy está muerto
     (H1), o que se elimine la columna si se decide que el mapa manda;
   - un `npm run db:check-overrides` que grite cuando BD y código divergen
     (hoy nutri_laura ya diverge y nadie se enteró).
3. **Override solo cuando un tenant diverge de verdad**, con el clonado ya
   trivial gracias al registry.

- **Coste**: F1 (2-4 h) + mecanismo (2-3 h).
- **Precio**: no da aislamiento preventivo — un cambio en base sigue llegando
  a todos los tenants del módulo. Que es, hoy, el comportamiento que CLAUDE.md
  declara deseado: *"un cambio en un módulo se aplica a TODOS los tenants que
  lo tengan, a la vez"*.

**Mi recomendación es B**, porque el aislamiento que compra A ya lo dan los
schemas de PostgreSQL a nivel de datos, y a nivel de código el precio es
renunciar a que un fix de seguridad se propague solo. Pero es tu producto y
tu decisión: si eliges A, la tabla de abajo está lista para ejecutarse tal cual.

---

## Tabla de iteraciones (Opción A)

Orden por criticidad: 🔴 cliente real en producción · 🟠 datos pero uso menor ·
🟢 vacío o interno.

### 🔴 Bloque 1 — nutri_laura (cliente real, 6 módulos)

| # | Tenant | Módulo | LOC aprox | Override hoy |
| ---: | --- | --- | ---: | --- |
| 1 | nutri_laura | clients | 5.720 | parcial (`ClientDetailModule`) |
| 2 | nutri_laura | citas | 5.970 | no |
| 3 | nutri_laura | training | 5.588 | ⚠️ BD dice sí, fichero no existe (H1) |
| 4 | nutri_laura | nutricion | 2.604 | sí (y es el *base* de facto, H3) |
| 5 | nutri_laura | leads | 1.483 | sí |
| 6 | nutri_laura | formularios | 382 | no |

### 🔴 Bloque 2 — aumenta (cliente real, 12 módulos)

| # | Tenant | Módulo | LOC aprox | Override hoy |
| ---: | --- | --- | ---: | --- |
| 7 | aumenta | billing | 9.532 | no |
| 8 | aumenta | citas | 5.970 | no |
| 9 | aumenta | clinica | 5.965 | no |
| 10 | aumenta | team | 5.932 | no |
| 11 | aumenta | projects | 5.835 | no |
| 12 | aumenta | clients | 5.720 | no |
| 13 | aumenta | training | 5.588 | sí (`FormacionOverview`) |
| 14 | aumenta | pacientes | 2.852 | no |
| 15 | aumenta | leads | 1.483 | sí |
| 16 | aumenta | orders | 1.440 | no |
| 17 | aumenta | inventory | 775 | no |
| 18 | aumenta | calendar | ~600 | no |

### 🔴 Bloque 3 — retorika + spain_enzymes + quality_energy (clientes reales)

| # | Tenant | Módulo | LOC aprox | Override hoy |
| ---: | --- | --- | ---: | --- |
| 19 | retorika | training | 5.588 | no |
| 20 | spain_enzymes | billing | 9.532 | no |
| 21 | spain_enzymes | clients | 5.720 | no |
| 22 | spain_enzymes | leads | 1.483 | sí |
| 23 | spain_enzymes | orders | 1.440 | no |
| 24 | spain_enzymes | inventory | 775 | no |
| 25 | quality_energy | leads | 1.483 | sí |

### 🟠 Bloque 4 — healim + abarcaia

| # | Tenant | Módulo | LOC aprox | Nota |
| ---: | --- | --- | ---: | --- |
| 26 | healim | citas | 5.970 | tenant nuevo, no está en CLAUDE.md |
| 27 | abarcaia | leads | 1.483 | **solo producción**, no en BD local |
| 28 | abarcaia | referidos | ~400 | **solo producción** |

### 🟢 Bloque 5 — demo + interno

| # | Tenant | Módulo | LOC aprox |
| ---: | --- | --- | ---: |
| 29-38 | demo | billing, citas, clients, projects, team, training, inventory, leads, calendar, cuestionarios | ~42.200 |
| 39 | salamandra_solutions | provisioning | ~300 |
| 40 | *(sandbox)* | leads | — |

⚠️ **Iteraciones 27, 28 y 40 no son testables en local**: `abarcaia` y
`sandbox` no existen en la BD local. Habría que sembrarlos o aplazarlas.

---

## Bloqueos para arrancar F2

### ✅ Resuelto — autenticación por tenant en los smoke tests

El patrón ya existe y lo usan los 56 smoke tests del repo: se firma un token
en local con `signAccessToken()` de `lib/auth/jwt.js` y se manda como cookie.
No hacen falta credenciales reales.

```js
import { signAccessToken } from "../lib/auth/jwt.js";

const cabeceras = {
  "Content-Type": "application/json",
  "x-tenant": SLUG,
  Cookie: `access_token=${await signAccessToken({
    userId: admin.id, email: admin.email, role: "admin", tenantSlug: SLUG,
  })}`,
};
```

Referencia: `scripts/_smoke-dinero-solo-direccion.mjs:54-66`. Sirve además
para probar **roles distintos** sobre el mismo tenant, que es justo lo que
piden los tests 2 y 3.

### ✅ Resuelto — los 3 tenants que faltan en local se pueden sembrar

- `npm run db:seed:sandbox`
- `npm run db:seed:healim`
- `scripts/seed-abarcaia.js` (sin entrada en `package.json`)

Pendiente solo la autorización de Jorge para escribir en su BD local.

### ⛔ Abierto — H3: Nutrición no tiene base

No se puede "clonar el base" de un módulo cuyo base es el override de
nutri-laura (ver `backlog.md`). Hay que extraer un base antes, y eso **toca
código base**, que el runbook prohíbe sin autorización expresa.

Afecta a la **iteración 4**.

---

## Decisiones tomadas

Jorge eligió la opción **A** y luego delegó el resto ("resuelve las preguntas
como creas más adecuadas", 2026-08-07). Quedan aquí por escrito para que se
puedan revisar o revertir.

| # | Pregunta | Decisión | Motivo |
| --- | --- | --- | --- |
| 1 | ¿A o B? | **A** | Decisión de Jorge. |
| 2 | Login por tenant en los tests | **Resuelto**: `signAccessToken()` | Patrón ya usado por los 56 smoke tests del repo. |
| 3 | ¿Por dónde arranco? | **`nutri_laura`** | 6 módulos en vez de 12: ciclo de feedback más corto y radio de impacto menor si el patrón falla. Además ya tiene 17 ficheros de override, así que el patrón está rodado. `aumenta` va después, con el método ya validado. |
| 4 | ¿Siembro sandbox/healim/abarcaia? | **No, de momento** | Escribe en la BD local de Jorge y no hace falta para avanzar. Sus 3 iteraciones (27, 28, 40) se mueven **al final del plan**. Se pregunta cuando toque. |
| 5 | ¿Entran `healim` y `salamandra_solutions`? | **`healim` sí, `salamandra_solutions` no** | `healim` es un cliente real (`active`, plan starter, módulo `citas`). `salamandra_solutions` solo tiene `provisioning`, que es el panel INTERNO de Salamandra en su propio host: no es un módulo de cliente y no tiene sentido darle override. Iteración 39 **eliminada**. |
| 6 | ¿Extraigo un base de Nutrición (H3)? | **No. Iteración 4 aplazada** | Extraer el base toca código base y el runbook lo prohíbe sin autorización expresa ("si tienes duda: NO TOCAR"). Además la iteración es casi un no-op: `nutri_laura` **ya tiene** override propio de los 4 módulos de nutrición — lo que falta es el base, y no hay ningún otro tenant con `nutricion` que lo necesite hoy. Queda como **H3** en el backlog. |

**Total de iteraciones tras estas decisiones: 36** (40 − 1 eliminada −
3 aplazadas), más la iteración 4 aplazada = 35 ejecutables ahora.

### Orden de ejecución

1. 🔴 `nutri_laura` — clients, citas, training, leads, formularios *(nutricion aplazada)*
2. 🔴 `aumenta` — 12 módulos
3. 🔴 `retorika`, `spain_enzymes`, `quality_energy`
4. 🟠 `healim`
5. 🟢 `demo` (10 módulos)
6. ⏸️ Al final y previa consulta: `abarcaia`, `sandbox` (hay que sembrarlos)
