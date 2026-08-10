# F0 — Diagnóstico del mecanismo base/override

**Fecha**: 2026-08-07
**Estado**: completo, pendiente de que Jorge apruebe el `plan.md`
**Entorno inspeccionado**: local (`.env.local`), commit `030a35e`

---

## 1. Mecanismo real de routing base ↔ override

No hay un resolver central. El mecanismo es **un mapa literal por página**,
con imports estáticos, repetido en 8 sitios:

```jsx
// app/(dashboard)/leads/page.jsx
import DefaultLeadsModule from "../../../modules/leads/LeadsModule.jsx";
import AumentaLeadsModule from "../../../modules/overrides/aumenta/LeadsModule.jsx";

const UI_OVERRIDES = {
  aumenta: AumentaLeadsModule,
  // …8 entradas
};

export default async function LeadsPage() {
  const tenantSlug = (await headers()).get("x-tenant");
  const LeadsModule = (tenantSlug && UI_OVERRIDES[tenantSlug]) || DefaultLeadsModule;
  return <LeadsModule />;
}
```

El `x-tenant` lo inyecta `middleware.js:262` desde el payload del JWT, ya
verificado. Esa parte es sólida.

### Las 8 páginas con mecanismo de override

| Página | Base | Overrides registrados |
| --- | --- | --- |
| `app/(dashboard)/leads/page.jsx` | `modules/leads/LeadsModule.jsx` | 8 (quality_energy, retorika, aumenta, sandbox, abarcaia, demo, spain_enzymes, nutri_laura) |
| `app/(dashboard)/clientes/[id]/page.jsx` | `modules/default/ClientDetailModule.jsx` | 1 (nutri_laura) |
| `app/(dashboard)/formacion/page.jsx` | `modules/training/FormacionOverview.jsx` | 1 (aumenta) |
| `app/(dashboard)/nutricion/recetas/page.jsx` | ⚠️ `overrides/nutri-laura/NutricionRecetasModule.jsx` | — |
| `app/(dashboard)/nutricion/alimentos/page.jsx` | ⚠️ override nutri-laura | — |
| `app/(dashboard)/nutricion/plantillas/page.jsx` | ⚠️ override nutri-laura | — |
| `app/(dashboard)/nutricion/asignados/page.jsx` | ⚠️ override nutri-laura | — |
| `app/(dashboard)/citas/page.jsx` | `modules/default/CitasModule.jsx` | 0 (mapa vacío a propósito) |
| `app/(dashboard)/formularios/page.jsx` | `modules/formularios/FormulariosModule.jsx` | 0 (mapa vacío) |
| `app/(dashboard)/soporte/page.jsx` | `modules/support/SupportModule.jsx` | 0 (mapa vacío) |

**Las otras 67 páginas del dashboard no tienen mecanismo de override
ninguno.** Son componentes de servidor que renderizan directamente.

---

## 2. Hallazgos

### H1 — `tenant_modules.uiOverride` está muerto (severidad: media)

La columna existe, los scripts de seed la escriben, `inspect-tenant-modules.js`
y `app/admin/page.jsx` la muestran… y **ningún código de la app la lee jamás**.
El grep de `uiOverride` sobre `*.js{,x}` solo devuelve scripts, el panel admin
y el inspector.

La prueba definitiva: en BD local, `nutri_laura` tiene
`training → uiOverride = "nutri-laura/FormacionOverview"`, pero

- ese fichero **no existe** en `modules/overrides/nutri-laura/`, y
- `app/(dashboard)/formacion/page.jsx` solo mapea `aumenta`.

Si el mecanismo leyera la BD, nutri_laura tendría la pantalla de Formación
rota. Funciona precisamente porque la BD es decorativa.

Consecuencia: **la BD y el código pueden divergir sin que nada avise**, y hoy
ya divergen.

### H2 — Query muerta en la página de Leads (severidad: menor, perf)

`app/(dashboard)/leads/page.jsx:39-47` hace `Tenant.findOne` +
`TenantModule.findOne` y **descarta el resultado**: no se asigna a nada. Son
dos roundtrips a master en cada render de `/leads`, sin efecto.

### H3 — En Nutrición, el "base" ES el override de nutri-laura (severidad: media)

Las 4 páginas de `/nutricion/*` importan
`modules/overrides/nutri-laura/Nutricion*Module.jsx` **como fallback por
defecto**. No hay base. Si mañana entra un segundo tenant con `nutricion`
(hoy solo lo tiene nutri_laura), hereda la UI de Laura, incluidos sus textos.

### H4 — Convención de slugs confirmada

- BD y `x-tenant`: **underscore** (`nutri_laura`, `quality_energy`).
- Carpetas de `modules/overrides/`: **guión** (`nutri-laura`, `quality-energy`).
- Las claves del mapa `UI_OVERRIDES` son las de BD (underscore).

Coincide con CLAUDE.md. Sin sorpresas.

### H5 — Overrides huérfanos y tenants nuevos

- `modules/overrides/sandbox/` y `modules/overrides/abarcaia/` existen en
  código, pero **ninguno de los dos tenants está en la BD local** (abarcaia
  es solo-producción; sandbox no aparece en ninguno de los dos).
- Aparecen **dos tenants que CLAUDE.md no documenta**: `healim` (starter,
  solo `citas`) y `salamandra_solutions` (free, solo `provisioning`).

---

## 3. Matriz tenant × módulo (BD local, 2026-08-07)

| Tenant | Plan | Módulos activos | uiOverride en BD |
| --- | --- | --- | --- |
| `aumenta` | pro | billing, calendar, citas, clients, clinica, inventory, leads, orders, pacientes, projects, team, training (**12**) | leads, training |
| `demo` | pro | billing, calendar, citas, clients, cuestionarios, inventory, leads, projects, team, training (**10**) | leads |
| `nutri_laura` | starter | citas, clients, formularios, leads, nutricion, training (**6**) | leads, nutricion, training⚠️ |
| `spain_enzymes` | pro | billing, clients, inventory, leads, orders (**5**) | leads |
| `healim` | starter | citas (**1**) | — |
| `quality_energy` | pro | leads (**1**) | leads |
| `retorika` | pro | training (**1**) | — |
| `salamandra_solutions` | free | provisioning (**1**) | — |
| `abarcaia` *(solo prod)* | — | leads, referidos (**2**) | — |

**Total: 40 combinaciones tenant × módulo activo.**

⚠️ El `uiOverride` de training en nutri_laura apunta a un fichero inexistente
(ver H1).

---

## 4. Coste del refactor literal

El runbook pide clonar el módulo base a un override propio para cada tenant
que lo use. Medido sobre el código real (`app/(dashboard)/**` +
`app/api/**` + `components/**`, sin `lib/` ni `models/`):

### LOC por módulo

| Módulo | Ficheros | LOC | | Módulo | Ficheros | LOC |
| --- | ---: | ---: | --- | --- | ---: | ---: |
| billing | 69 | 9.532 | | pacientes | 15 | 2.852 |
| citas | 30 | 5.970 | | nutricion | 27 | 2.604 |
| clinica | 47 | 5.965 | | leads | 11 | 1.483 |
| projects | 35 | 5.835 | | orders | 7 | 1.440 |
| team | 30 | 5.932 | | support | 12 | 1.165 |
| clients | 42 | 5.720 | | documents | 14 | 1.088 |
| training | 42 | 5.588 | | outreach | 14 | 1.025 |
| inventory | 5 | 775 | | formularios | 4 | 382 |

**Base clonable ≈ 57.400 LOC** (+ ~2.100 de calendar, cuestionarios,
referidos y provisioning, no desglosados).

### LOC duplicados si se ejecuta el plan literal

| Tenant | Módulos | LOC a clonar |
| --- | ---: | ---: |
| `aumenta` | 12 | ~51.700 |
| `demo` | 10 | ~42.200 |
| `nutri_laura` | 6 | ~21.700 |
| `spain_enzymes` | 5 | ~19.000 |
| `healim` | 1 | ~6.000 |
| `retorika` | 1 | ~5.600 |
| `abarcaia` | 2 | ~1.900 |
| `quality_energy` | 1 | ~1.500 |
| `salamandra_solutions` | 1 | ~300 |
| **TOTAL** | **40** | **~150.000** |

La capa de aplicación pasaría de **~99.000 LOC a ~240.000**. Habría
**8 copias de Leads, 4 de Clientes, 4 de Citas, 3 de Facturación**, etc.

---

## 5. El riesgo que hay que decidir antes de F1

**Un fix en base deja de propagarse.**

Precedentes de este mismo repo, sacados de CLAUDE.md:

- El arreglo del rol fresco (2026-07-28) tocó `withTenant` **una vez** y
  cubrió ~90 endpoints que gatean por `x-user-role`. Con Clientes clonado 4
  veces, ese mismo fix son 4 parches, y basta olvidar uno para que un usuario
  degradado siga entrando en un tenant.
- El repaso de auditoría del 2026-07-28 encontró **11 de 15 sitios mal**
  cuando había una sola copia de cada uno.
- Los guards de `lib/demo/isDemo.js` protegen la demo pública. Un módulo
  clonado que se quede sin guard convierte el CRM en relé de correo.

A esto se suma que hoy **nada valida que un override siga al día con su base**:
H1 demuestra que ya hay una divergencia BD↔código viva y nadie se enteró.
Multiplicar por 40 el número de copias sin un detector de deriva es el punto
donde esto se vuelve difícil de revertir.

**Esto no bloquea el refactor: es una decisión de producto que le toca a
Jorge.** Lo que sí sostengo es que la decisión debe tomarse con los ~150.000
LOC delante, no después de la iteración 12.

---

## 6. Lo que sí es puro beneficio, sin discusión

**F1 (documentar la base) no tiene ninguna de estas pegas.** Es la fase que
Jorge pidió textualmente ("documentar bien toda la base para ver qué hace
cada cosa y que trabaje Claude más rápido"), no duplica una sola línea de
código, y hace más seguras todas las sesiones futuras, se ejecute F2 o no.

Los tres hallazgos H1/H2/H3 salieron de F0 en 40 minutos precisamente porque
nadie había mirado el mecanismo entero de golpe. F1 hará aflorar más.

Ver `plan.md` para las dos opciones de continuación.
