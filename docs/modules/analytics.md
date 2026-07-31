# Módulo Analíticas (`analytics`)

Visitas de la web del cliente, medidas con **Cloudflare Web Analytics**.
Estado: **implementado** (2026-07-31). Tenant de referencia: `spain_enzymes`.

---

## Qué es y qué NO es

Cloudflare Web Analytics mide **sin cookies y sin identificar a nadie**. Todo lo
que entrega este módulo es **agregado**:

- ✅ «esta semana han entrado 340 visitas: 120 de Alemania, 60 de Italia»
- ✅ «las visitas de Alemania caen sobre todo en /leather-line»
- ❌ «qué empresa alemana entró el martes» — **imposible por diseño**

Esa frontera es la razón de que no haga falta banner de consentimiento, y hay
que sostenerla también en la interfaz: la pantalla no habla de «visitantes» en
singular ni ofrece abrir el detalle de una visita. Si algún día se quiere
identificar empresas por IP, eso es otro producto (Leadfeeder, Albacross…), de
pago y con sus propias implicaciones de RGPD — **no** es una evolución de esto.

El único puente con el CRM es por **país y sobre totales**: el panel enseña, al
lado de las visitas, cuántos leads llegaron de cada país en el mismo periodo.
El país del lead es el que la persona **elige en el formulario** de la web
(`customFields.pais`), no uno deducido de su conexión. Son dos mediciones
distintas: sirven para comparar («entran muchas visitas de Italia pero no
escribe nadie»), no para cuadrar cifras.

---

## Piezas

| Fichero | Qué hace |
| --- | --- |
| `lib/analytics/cloudflareConfig.js` | Resuelve las credenciales del tenant (patrón BYOK, como `lib/ai/anthropicKey.js`) |
| `lib/analytics/cloudflareRum.js` | Cliente de la GraphQL Analytics API de Cloudflare (dataset RUM) |
| `app/api/analiticas/route.js` | `GET /api/analiticas?dias=7\|30\|90`, gateado por `hasModule("analytics")` |
| `app/(dashboard)/analiticas/page.jsx` | Página; lee el rol y lo baja como booleano |
| `modules/analytics/AnaliticasModule.jsx` | Toda la interfaz (KPIs, mapa, serie, listas) |
| `modules/analytics/worldMap.js` | **Generado**: contornos de países en SVG |
| `scripts/check-cloudflare-analytics.js` | Diagnóstico de solo lectura desde consola |

No hay modelos ni tablas: **el módulo no guarda nada**. Los datos viven en
Cloudflare y se leen en cada consulta (con 5 minutos de caché en memoria, ver
`lib/tenant/tenantCache.js`). Por eso `enable-module.js` no tiene migraciones
que ejecutar para este módulo.

---

## Credenciales (por tenant)

Se configuran en **Configuración → Integraciones → «Cloudflare (visitas de la
web)»**, con las instrucciones paso a paso dentro de la propia tarjeta.

| Campo en `settings.integrations` | Secreto | Para qué |
| --- | --- | --- |
| `cloudflareApiToken` | **sí** (cifrado con `secretBox`) | Token de API de solo lectura |
| `cloudflareAccountId` | no | Identificador de cuenta (sale en la URL del panel) |
| `cloudflareSiteTag` | no | Sitio concreto. Vacío = todos los de la cuenta |

El token necesita **un solo permiso**, tal y como lo llama Cloudflare en su
pantalla de tokens personalizados: `Cuenta` · `Account Analytics` · `Leer`
(comprobado en el panel el 2026-07-31 — el desplegable del medio solo ofrece
esa opción al escribir «Analytics»). No puede tocar DNS, dominios ni nada más.

> **El token no se pide ni se pega nunca por chat ni por correo** (regla 14 de
> CLAUDE.md). Lo crea el cliente o el administrador en Cloudflare y lo pega
> directamente en la pantalla de Configuración, que lo cifra en reposo.
> Si un token se ha visto en un canal no seguro, se revoca en Cloudflare y se
> crea otro.

---

## Alta en un tenant

```bash
docker exec crm-salamandra-app-1 node scripts/enable-module.js <slug> analytics --force
```

`--force` es necesario **la primera vez**: `analytics` no está en
`MODULE_KEYS` ni en el mapa de migraciones, así que `enable-module.js` lo trata
como clave desconocida (protección contra typos). A partir de que un tenant lo
tenga, ya aparece como conocido y el `--force` sobra.

Después, comprobar la conexión:

```bash
docker exec crm-salamandra-app-1 node scripts/check-cloudflare-analytics.js <slug> 30
```

---

## El mapa

`modules/analytics/worldMap.js` está **generado**, no se edita a mano. Son 174
países proyectados en equirectangular sobre un viewBox de 1000×386, recortado a
latitudes −56…83 para quitar la Antártida y el Ártico vacío. La clave es el
código ISO alpha-2, que es lo que devuelve Cloudflare en la dimensión de país.

Origen: **Natural Earth 1:110m** vía `world-atlas` (dominio público) + tabla
ISO-3166. Se convirtió una sola vez con un script de un solo uso que decodifica
el TopoJSON y proyecta los contornos; el resultado se commiteó. **El CRM no
descarga nada en tiempo de ejecución y no se añadió ninguna dependencia** — que
es justo el motivo de hacerlo así: meter una librería de gráficos o de mapas
obliga a un deploy completo con reinstalación de dependencias (ver `deploy.sh`).

Por el mismo motivo, los gráficos (serie temporal y barras) son SVG escrito a
mano dentro del módulo.

Para regenerarlo, el script vive en el historial de la conversación del
2026-07-31; lo esencial es: descargar `world-atlas@2/countries-110m.json`,
acumular los arcos delta del TopoJSON, proyectar con
`x = (lon+180)/360·W`, `y = (83−lat)/139·H`, redondear a un decimal y descartar
anillos de menos de 0,7 px.

---

## Detalles que conviene saber

- **Escala de color por raíz cuadrada.** Con un país dominante —lo normal en una
  web con mercado local— una escala lineal deja el resto del mapa
  indistinguible del fondo, y esos países pequeños son justo la información
  interesante.
- **Sin guard de demo.** El endpoint es de solo lectura, no escribe en `master`,
  no gasta IA y no manda correos. El tenant `demo` no tiene credenciales de
  Cloudflare, así que ve el estado «sin configurar», que es exactamente lo que
  debe ver un visitante anónimo.
- **Los errores de Cloudflare se enseñan tal cual.** `CloudflareAnalyticsError`
  extiende `AppError` a propósito, porque `handleRouteError` solo conserva el
  mensaje de los `AppError`. «Cloudflare rechazó el token» es accionable;
  «Error interno del servidor» no.
- **Los filtros van interpolados en la consulta GraphQL**, no como variables:
  los nombres de los tipos de entrada de Cloudflare varían según el ámbito y
  declararlos mal rompe la consulta entera. Es seguro porque los tres valores
  que entran (id de cuenta, id de sitio, fechas) se validan con expresión
  regular antes — hex de 32 y `YYYY-MM-DD`.
- **Caché de 5 minutos** por tenant y rango. Cloudflare limita la frecuencia de
  llamadas y estos datos se agregan por día: no tiene sentido consultarlos en
  cada repintado.
