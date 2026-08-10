# Routing base ↔ override

> **Doc crítica.** Léela antes de tocar cualquier override.
> Verificada contra código el 2026-08-07 (commit `030a35e`).

---

## Resumen en 30 segundos

No hay resolver central de overrides. El mecanismo es **un mapa literal
declarado en cada página**, con imports estáticos, repetido hoy en 10 sitios.

```jsx
// app/(dashboard)/leads/page.jsx — el patrón canónico
import { headers } from "next/headers";
import DefaultLeadsModule from "../../../modules/leads/LeadsModule.jsx";
import AumentaLeadsModule from "../../../modules/overrides/aumenta/LeadsModule.jsx";

const UI_OVERRIDES = {
  aumenta: AumentaLeadsModule,      // clave = slug de BD, con UNDERSCORE
};

export default async function LeadsPage() {
  const tenantSlug = (await headers()).get("x-tenant");
  const LeadsModule = (tenantSlug && UI_OVERRIDES[tenantSlug]) || DefaultLeadsModule;

  // eslint-disable-next-line react-hooks/static-components
  return <LeadsModule />;
}
```

Tres cosas que hay que interiorizar:

1. **La clave del mapa lleva underscore** (`nutri_laura`), porque viene del
   `x-tenant`, que viene del JWT, que viene de `master.tenants.slug`.
   **La carpeta lleva guión** (`modules/overrides/nutri-laura/`). Es la
   trampa más fácil de pisar.
2. **`tenant_modules.uiOverride` NO se usa.** Ver §4. Escribirlo en BD no
   activa nada.
3. El `eslint-disable` de `react-hooks/static-components` es obligatorio y es
   un falso positivo: son componentes de servidor, se renderizan una vez por
   petición, no hay remontaje posible.

---

## 1. De dónde sale el `x-tenant`

`middleware.js:262`, desde el payload de un JWT **ya verificado**:

```js
const payload = await jwtVerify(token, ACCESS_SECRET);
headers.set("x-user-id",   payload.payload.userId);
headers.set("x-user-role", payload.payload.role);
headers.set("x-tenant",    payload.payload.tenantSlug);
```

Implicación para testear un override: **no se puede falsear con una cabecera**.
Hace falta una cookie `access_token` firmada con `JWT_SECRET`. Ver
`docs/base/tenant-resolver.md §5`.

---

## 2. Inventario de páginas con override

| Página | Componente base | Overrides registrados |
| --- | --- | --- |
| `app/(dashboard)/leads/page.jsx` | `modules/leads/LeadsModule.jsx` | **8**: quality_energy, retorika, aumenta, sandbox, abarcaia, demo, spain_enzymes, nutri_laura |
| `app/(dashboard)/clientes/[id]/page.jsx` | `modules/default/ClientDetailModule.jsx` | **1**: nutri_laura |
| `app/(dashboard)/formacion/page.jsx` | `modules/training/FormacionOverview.jsx` | **1**: aumenta |
| `app/(dashboard)/citas/page.jsx` | `modules/default/CitasModule.jsx` | 0 (mapa vacío a propósito) |
| `app/(dashboard)/formularios/page.jsx` | `modules/formularios/FormulariosModule.jsx` | 0 |
| `app/(dashboard)/soporte/page.jsx` | `modules/support/SupportModule.jsx` | 0 |
| `app/(dashboard)/nutricion/alimentos/page.jsx` | ⚠️ `overrides/nutri-laura/NutricionFoodsModule.jsx` | — |
| `app/(dashboard)/nutricion/recetas/page.jsx` | ⚠️ `overrides/nutri-laura/NutricionRecetasModule.jsx` | — |
| `app/(dashboard)/nutricion/plantillas/page.jsx` | ⚠️ `overrides/nutri-laura/NutricionPlantillasModule.jsx` | — |
| `app/(dashboard)/nutricion/asignados/page.jsx` | ⚠️ `overrides/nutri-laura/NutricionAsignadosModule.jsx` | — |

**Las otras 67 páginas del dashboard no tienen override ninguno**: renderizan
su componente directamente.

⚠️ Las 4 de Nutrición usan el override de nutri-laura **como fallback por
defecto**: ese módulo no tiene base. Ver §5.

---

## 3. Dónde vive cada cosa

```
modules/
├── default/            ← base de páginas que NO tienen carpeta propia
│   ├── CitasModule.jsx
│   ├── ClientDetailModule.jsx
│   └── Course*.jsx
├── leads/              ← base del módulo Leads
├── training/           ← base de Formación
├── support/ formularios/ outreach/ analytics/ config/ cuestionarios/ documents/
└── overrides/
    ├── aumenta/            LeadsModule, FormacionOverview
    ├── nutri-laura/        17 ficheros (leads, ficha de cliente, todo nutrición)
    ├── demo/ retorika/ quality-energy/ spain-enzymes/ abarcaia/ sandbox/
```

**No hay regla que diga cuándo un base va en `modules/default/` y cuándo en
`modules/{modulo}/`.** Es histórico. Al añadir uno nuevo, mira el vecino.

---

## 4. ⚠️ `tenant_modules.uiOverride` está muerto

La columna existe, los scripts de seed la escriben, `app/admin/page.jsx` y
`scripts/inspect-tenant-modules.js` la muestran — y **ningún código de la
aplicación la lee jamás**.

Prueba: en BD local, `nutri_laura` tiene
`training → uiOverride = "nutri-laura/FormacionOverview"`. Ese fichero **no
existe** y `app/(dashboard)/formacion/page.jsx` solo mapea `aumenta`.
Formación de Laura funciona porque la columna no hace nada.

**Consecuencias prácticas:**

- Para activar un override hay que **editar el mapa de la página**. Tocar la
  BD no sirve.
- El panel de admin puede enseñar overrides que no están activos.
- BD y código pueden divergir en silencio, y hoy ya divergen.

Está en `docs/refactor-base-override/backlog.md` como **H1**.

---

## 5. ⚠️ Nutrición no tiene base

Las 4 páginas de `/nutricion/*` importan el override de nutri-laura como
fallback por defecto. Hoy no da problemas porque solo `nutri_laura` tiene el
módulo, pero un segundo cliente de nutrición heredaría su UI y sus textos.

**Antes de crear un override de Nutrición hay que extraer un base.** Backlog
**H3**.

---

## 6. Cómo añadir un override (receta)

1. **Crear la carpeta con GUIÓN**: `modules/overrides/{slug-con-guion}/`.
2. **Copiar el base entero** dentro. Ajustar imports relativos: al bajar un
   nivel, `../../../lib/…` pasa a `../../../../lib/…`.
3. **Registrar en el mapa de la página**, con la clave en **underscore**:
   ```jsx
   import AumentaClientesModule from "../../../modules/overrides/aumenta/ClientesModule.jsx";
   const UI_OVERRIDES = { aumenta: AumentaClientesModule };
   ```
4. **No tocar `tenant_modules.uiOverride`** — no hace nada (§4). Si lo
   escribes por consistencia, que apunte a un fichero que exista.
5. **Comprobar que los demás tenants siguen igual**: el `|| DefaultXModule`
   es lo que los protege. Si te cargas el fallback, se caen todos.

### Errores frecuentes

| Error | Síntoma |
| --- | --- |
| Clave con guión (`nutri-laura`) | El override no se aplica nunca, sin aviso. Cae al base. |
| Carpeta con underscore | `Module not found` en build. |
| Olvidar el `eslint-disable` | Falla el lint de `npm run build`. |
| Quitar el `|| DefaultX` | Pantalla en blanco para todos los demás tenants. |

---

## 7. Otros mecanismos de personalización (no confundir)

| Mecanismo | Dónde | Qué cambia |
| --- | --- | --- |
| `UI_OVERRIDES` | mapa por página | El **componente** entero. |
| `TENANT_TITLE_OVERRIDES` | mapa por página | Solo el `<title>` (`aumenta: "Interesados"`, `nutri_laura: "Agenda"`). |
| `TENANT_LABEL_OVERRIDES` | `components/layout/Sidebar.jsx` | Rótulo en el menú. |
| `lib/clients/vocabulario.js` | por **módulos**, no por slug | «Clientes» vs «Pacientes». |
| `lib/clients/formularioAlta.js` | por **módulos** | Qué campos pide el alta. |
| `brand` en `tenant.settings` | JSONB en BD | Colores y logo (`var(--color-primary)`). |
| `featureFlags` / `logicOverrides` | `tenant_modules` (JSONB) | Comportamiento. **Estos SÍ se leen**, vía `hasFeatureFlag()` / `getLogicOverride()`. |

Nota: de la fila `tenant_modules`, `featureFlags` y `logicOverrides`
funcionan; `uiOverride` no. Lo lógico sería que fueran los tres igual.

**Preferencia del proyecto**: personalizar **por módulos** antes que por slug.
Un centro nuevo con los mismos módulos sale bien de fábrica, sin tocar código
(CLAUDE.md, decisión del 01/08/2026).
