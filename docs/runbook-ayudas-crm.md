# Runbook — botones de ayuda (?) por toda la aplicación

Trabajo repetitivo y largo (76 pantallas + overrides), así que el estado vive
**aquí** y no en la cabeza de nadie: cada sesión abre este fichero, coge la
siguiente pantalla sin marcar, la hace y la marca. Así la número 60 recibe la
misma atención que la número 3.

**Componente:** `components/ui/HelpTooltip.jsx`. Ya existía, no hay que tocarlo.

```jsx
import HelpTooltip from "…/components/ui/HelpTooltip.jsx";

<HelpTooltip title="Lo que sea" placement="bottom">
  Texto en cristiano.
</HelpTooltip>
```

---

## Qué es una ayuda BUENA aquí

La regla, aprendida en las primeras pantallas: **si el texto se puede deducir
leyendo el rótulo, sobra**. Los «?» de los estados del embudo (Nuevo,
Contactado, Descartado) se pusieron y se quitaron el mismo día por eso.

Una ayuda merece existir cuando:

- **Dos cosas se llaman igual y no son lo mismo.** «Lista de espera» en Citas
  (solicitudes con hora, con dinero retenido) y en Clientes (gente esperando
  plaza, sin fecha). Este es el caso más valioso de todos.
- **El número no se comporta como se espera.** «Fichas a completar» no baja a
  cero sola porque hay huecos que son correctos: hay que decir que existe
  «Está bien así» y qué hace.
- **Un botón cambia según el caso.** «Convertir en cliente» vs «Ya tiene
  plaza»: sale uno u otro según tenga ficha, y desde fuera no se adivina.
- **Hay dinero de por medio y el estado no es obvio.** Retenido ≠ cobrado.
- **La pantalla no se puede terminar** y hay que decirlo, o se abandona.

Y NO cuando solo describe el widget («aquí puedes filtrar por estado»).

**Tono**: para quien USA el CRM, no para quien lo programa. Nada de nombres de
columna, endpoints ni «entidad». Si el vocabulario cambia por tenant, usar
`vocab.singular` y no «cliente» a fuego — en nutri_laura la pantalla de
Clientes se llama «Pacientes».

**Dónde va el «?»**: FUERA de botones que hacen algo. Dentro de una pestaña,
pulsarlo cambiaría el filtro además de abrir la ayuda.

**Overrides**: la mayoría heredan la pantalla base y se arreglan solos al tocar
la base. Solo se revisan los que divergen de verdad (los embudos de leads de
`nutri-laura` y `aumenta`). Se miran AL FINAL de cada módulo, no antes.

---

## Método por pantalla

1. Abrirla y preguntarse: **¿qué me sorprendería la primera vez?**
2. Si no hay nada, **marcarla como «no necesita»** y seguir. Es una respuesta
   válida y la más común.
3. Si lo hay: cabecera (para qué sirve la pantalla) + los puntos concretos.
4. `npx eslint` del fichero.
5. Marcar aquí.

Al terminar cada módulo: `npm run build`, commit, push y deploy.

---

## Estado

Leyenda: `[x]` hecho · `[-]` mirada, no necesita · `[ ]` pendiente

### Clientes — HECHO (05/08/2026)
- [x] `clientes` — cabecera. Los «?» de los estados se quitaron a propósito
- [x] `clientes/lista-espera` — qué es, y que NO es la de Citas; los dos botones
- [x] `clientes/urgentes` — los dos bloques, y «Está bien así»
- [x] `clientes/[id]` — la ficha, entera:
      · Acceso al portal por meses (se abren según el cobro de ESE mes; abrir a
        mano no registra cobro)
      · Contrato (es de la FAMILIA, no de cada paciente)
      · Padres y tutores (sin ellos nadie puede firmar; con dos, hacen falta las
        dos firmas)
      · Módulos asignados (no dan permisos, y se guardan al momento)

**Clientes queda cerrado.**

### Citas — EMPEZADO (05/08/2026)
- [x] `citas` — la pestaña Lista de espera (retenido ≠ cobrado)
- [x] `citas/tipos` — cabecera. Los campos ya tienen ayuda en línea
- [x] `citas/disponibilidad` — la trampa real: los horarios se ponen en DOS
      sitios (aquí el del centro, y «Mi horario» el de cada profesional)
- [-] `citas/sin-profesional` — ya tiene subtítulo que lo explica y lo distingue
      de la lista de espera de admisión. No necesita
- [-] `mi-horario` — «Horario de trabajo semanal» se explica solo. No necesita
- [x] Configuración → Citas: las CUATRO puertas. La ayuda del CONJUNTO va en la
      primera (identidad): el orden en que actúan y que hay que encenderlas de
      una en una comprobando entre medias. Cada tarjeta ya se explicaba sola;
      lo que faltaba era cómo se relacionan

**Citas queda cerrado.**

### Facturación — el más denso, el siguiente
- [ ] `facturacion` · `facturacion/resumen`
- [ ] `facturacion/facturas` · `facturacion/recurrentes`
- [x] `facturacion/cobros` — emitir no es cobrar, y la morosidad vive DENTRO de
      esta pantalla (facturas vencidas sin cobro), no en una lista aparte
- [ ] `facturacion/presupuestos` (+ `[id]`)
- [ ] `facturacion/costes` · `facturacion/proveedores`
- [x] `facturacion/arqueo` — un cierre es la FOTO de ese día: la diferencia se
      guarda tal cual y no se recalcula aunque luego corrijas un cobro
- [x] `facturacion/cumplimiento` — Verifactu y Factura-e son DOS obligaciones
      distintas que suenan igual; esta pantalla no emite nada, solo informa
- [ ] `facturacion/analitica` (+ `clientes`, `empleados`, `iva`, `socios`)
- [ ] `facturacion/configuracion`

### Equipo
- [ ] `equipo` · `equipo/bandeja` · `equipo/actividad`
- [ ] `equipo/desempeno-config` · `equipo/mi-desempeno`
- [ ] `equipo/direccion` · `equipo/productividad` · `equipo/ocupacion`
- [ ] `equipo/incidencias`

### Clínica y Pacientes
- [ ] `clinica` · `clinica/informes` · `clinica/talleres`
- [ ] `clinica/coordinaciones` · `clinica/estadisticas`
- [ ] `pacientes` · `pacientes/[id]` · `pacientes/[id]/sesiones/nueva`

### Nutrición
- [ ] `nutricion/alimentos` · `nutricion/recetas`
- [ ] `nutricion/plantillas` · `nutricion/asignados`

### Comercial
- [ ] `leads` · `leads/estadisticas` · `comercial/leads`
- [ ] `formularios` · `outreach` (+ `[id]`, `configuracion`)
- [ ] `analiticas` · `referidos`

### Formación — YA LA TIENE
- [-] `formacion` y sus hijas: de aquí salió el patrón

### Resto
- [ ] `documentos` · `soporte` · `inventario` · `calendario`
- [ ] `pedidos` (+ `[id]`, `configuracion`)
- [ ] `proyectos` (+ `[id]`, `[id]/board`)
- [ ] `cuestionarios` · `configuracion`

### Overrides — al final
- [ ] `nutri-laura/LeadsModule` — embudo nutricional, diverge
- [ ] `aumenta/LeadsModule` — «Interesados», diverge
- [ ] El resto: comprobar que heredan y no tocar
