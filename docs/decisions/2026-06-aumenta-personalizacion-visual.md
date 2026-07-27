# Personalización visual y módulos nuevos para Aumenta (junio 2026)

> Decisiones arquitectónicas cerradas durante el sprint preparatorio
> de la demo del **9 de junio de 2026** con el equipo de Aumenta.

## Contexto

Aumenta es centro multidisciplinar de desarrollo infantil (TEA, TDAH,
lectoescritura, lenguaje, regulación emocional). Ya existían los
módulos `clients`, `team`, `leads` activos en producción. Este sprint
añadió 3 módulos nuevos (`pacientes`, `clinica`, `training`) y una
serie de refinamientos cross-cutting al CRM para soportar
personalización visual por tenant.

Toda la maqueta es **visual** (datos dummy hardcoded). Sin endpoints
CRUD, sin IA real, sin grabación. La funcionalidad real se
desarrollará en sprints posteriores tras la reunión con el cliente.

## 1. Módulos nuevos

| Módulo | Ámbito | Doc |
| --- | --- | --- |
| `pacientes` | Pediátrico independiente de `clients`. Solo Aumenta. | [`docs/modules/pacientes.md`](../modules/pacientes.md) |
| `clinica` | Sesiones, coordinaciones, informes, desempeño. Solo Aumenta. | [`docs/modules/clinica.md`](../modules/clinica.md) |
| `training` | Activación B2C con override sin cuestionarios. | [`docs/modules/training.md`](../modules/training.md) (sección "Activación en Aumenta") |

**No están en `ALL_MODULES`** (`scripts/db-sync.js`). Cada uno se
gestiona manualmente vía `master.tenant_modules`. Si en el futuro
otro cliente los necesita, se añaden al array global.

## 2. `patients` ≠ `clients`

Tablas independientes. Las FKs del módulo Clínica apuntan a
`patients` (no a `clients`). Migración correctiva en
`scripts/migrate-pacientes-sprint-1.js`. Detalle completo en
[`docs/modules/pacientes.md`](../modules/pacientes.md).

## 3. El CRM no graba audio

Decisión explícita: el flujo de "Nueva sesión" en Pacientes es
**subir un archivo de audio**, no grabarlo desde el navegador. La
terapeuta graba con su móvil con cualquier app de notas de voz, y
sube el archivo al CRM. La pantalla
`/pacientes/[id]/sesiones/nueva` simula este flujo con 4 estados:
`IDLE` → `UPLOADED` → `PROCESSING` → `STRUCTURED`.

Motivación: simplificar el ámbito del producto y delegar la
grabación al dispositivo. Si un futuro sprint quiere ofrecer
grabación en navegador (Web Speech API), sería una funcionalidad
opcional, no la principal.

## 4. Rename "Leads" → "Interesados" solo para Aumenta

Cara al cliente, en Aumenta no se habla de "leads" sino de
"interesados". **El backend y la BD siguen llamándose `leads`**:
`moduleKey`, endpoints `/api/leads/*`, tabla `leads`, modelo `Lead`,
variables JS — todo intacto.

Cambios visibles afectados:

- **`modules/overrides/aumenta/LeadsModule.jsx`**: H1, empty states,
  botón "Atender", placeholder textarea.
- **`components/layout/Sidebar.jsx`**: sistema de label overrides
  (ver siguiente sección).
- **`app/(dashboard)/leads/page.jsx`**: `generateMetadata` dinámica
  para el título de pestaña.

## 5. Sistema de label overrides en sidebar

`components/layout/Sidebar.jsx` define un mapa estático:

```js
const TENANT_LABEL_OVERRIDES = {
  aumenta: { leads: "Interesados" },
};
```

En el render: `labelOverrides[item.key] ?? item.label`. **Solo cambia
el texto visible**. El `key` (= `moduleKey`) y el `href` no se
tocan. Si en el futuro Aumenta quiere otro rename (ej. "Equipo" →
"Personal"), basta con añadir una entrada al mapa.

## 6. `generateMetadata` dinámico para `/leads`

```js
const TENANT_TITLE_OVERRIDES = { aumenta: "Interesados" };

export async function generateMetadata() {
  const headersList = await headers();
  const slug = headersList.get("x-tenant");
  return { title: TENANT_TITLE_OVERRIDES[slug] ?? "Leads" };
}
```

El título de pestaña del navegador se rige por el `x-tenant`. Este
patrón es **replicable a cualquier ruta** que necesite título
distinto por tenant.

## 7. `Kpi.emerald` tintado con `--color-primary`

`app/(dashboard)/facturacion/_components/Kpi.jsx`. El variant
`emerald` ya no usa `bg-emerald-50` (#ECFDF5 verde fluo), que
chocaba con paletas no verdes. Ahora usa el `primaryColor` del
tenant con `color-mix`:

```css
background: color-mix(in srgb, var(--color-primary) 8%, white);
borderColor: color-mix(in srgb, var(--color-primary) 18%, white);
color: var(--color-primary);
```

Resultados:

- **Aumenta** (`#563EA6` morado): card morado pastel con texto morado.
- **Demo** (`#1B3A2D` verde oscuro): card verde oscuro pastel.
- Cualquier tenant nuevo hereda automáticamente.

Solo se usa para "Margen Bruto" en `/facturacion`. Si en el futuro se
quisiera aplicar a más KPIs "positivos", basta con pasar
`variant="emerald"`.

## 8. Override `aumenta/FormacionOverview` (sin empresas ni cuestionarios)

Detalle en
[`docs/modules/training.md`](../modules/training.md) sección
"Activación en Aumenta". Resumen: B2C puro, 3 KPIs y 3 secciones en
vez de 4 y 5.

## 9. H1 landing Clínica: "Área clínica"

Pequeño detalle de copy. La landing del módulo `clinica` no muestra
"Hola, Beatriz" (probado inicialmente con saludo personalizado al
admin) sino "Área clínica" — más institucional, menos dependiente
del nombre del usuario logueado.

## 10. Mini-link de vuelta en las páginas internas

Cada página interna lleva arriba un mini-link discreto para volver a su
landing; las landings no lo llevan (son el destino).

> **Actualizado 2026-07-27:** cuando se escribió esta decisión, las cinco
> pantallas de gestión de equipo vivían en `/clinica/*` y todas volvían a
> Clínica. Tras el traslado a `/equipo/*` el destino cambia según dónde viva
> cada una:
> - `/clinica/informes` → **"← Volver a Clínica"** (`/clinica`).
> - `/equipo/{mi-desempeno, direccion, productividad, incidencias, bandeja}` →
>   **"← Volver a Equipo"** (`/equipo`).
>
> La regla que se decidió aquí sigue valiendo: el mini-link apunta a la landing
> del área a la que pertenece la pantalla, no a la carpeta donde vivió antes.

## 11. Datos dummy honestos

KPIs del listado de Pacientes calculados desde el array `PATIENTS`
(no hardcoded inventados). Evita incoherencias visuales del tipo
"42 pacientes activos · 6 visibles".

Diego Martín es el único paciente con datos completos. Los otros 5
son placeholders explícitos: la ficha existe pero los tabs muestran
"Sin sesiones registradas en esta demo".

## Coherencia entre módulos

> **Histórico:** lo que sigue describe la MAQUETA de junio de 2026. Desde el
> sprint de backend real, esas pantallas leen datos de verdad de la API y los
> nombres de abajo (Diego Martín, Lorena Vázquez…) ya no existen en producción.
> Se conserva porque documenta las decisiones de diseño que se tomaron entonces.

Los datos dummy de Pacientes están alineados con los de Clínica:

- Diego Martín es el paciente del informe largo en
  `/clinica/informes`.
- Lorena Vázquez es la terapeuta protagonista de
  `/equipo/mi-desempeno` (87/100) y la terapeuta principal de
  Diego.
- El array `THERAPISTS` se define en
  `app/(dashboard)/clinica/_components/dummyData.js` y se
  **re-exporta** desde el de Pacientes. Editar terapeutas: un único
  fichero.

## Orden de ejecución en producción

Cuando se despliegue todo a producción:

```bash
ssh tu-vps
cd /opt/crm-salamandra
git pull
./deploy.sh                                                          # build + restart
docker exec -it crm-salamandra-app-1 node scripts/migrate-clinica-sprint-1.js
docker exec -it crm-salamandra-app-1 node scripts/migrate-pacientes-sprint-1.js   # DESPUÉS de clinica
docker exec -it crm-salamandra-app-1 node scripts/add-training-module-aumenta.js  # independiente
```

`migrate-pacientes-sprint-1.js` hace `ALTER TABLE` sobre las tablas
creadas por `migrate-clinica-sprint-1.js`. Invertir el orden falla
silenciosamente (la fase C salta las tablas que no existen).
