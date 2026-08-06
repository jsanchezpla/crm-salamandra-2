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

### Facturación — HECHO (06/08/2026)

**20 ayudas en 17 pantallas**, ninguna con más de dos. Salieron 44 en la primera
pasada y se quitaron 24: el error no fue el contenido —varias están verificadas
contra el endpoint— sino el volumen. Con tres o cuatro globos en una pantalla se
dejan de abrir todos, incluido el bueno. Lo que más se repitió: «los importes van
sin IVA», escrito SIETE veces, y «un cobro sin factura no suma aquí», CUATRO.
Cada una tenía razón en su pantalla; la densidad solo se ve mirando el módulo
entero, así que conviene contar los `<HelpTooltip>` del módulo antes de darlo por
cerrado.

Dos cosas que NO se pueden repetir en los módulos que quedan: una tarjeta que era
un `<Link>` se convirtió en `<div>` con un ancla encima para hacerle hueco a un
globo, y en otra pantalla se inventó una barra gris que no era ni filtro ni
leyenda, solo percha. **Si hay que tocar el marcado para colocar una ayuda, la
ayuda va en otro sitio o no va.**

Y una de tono: una ayuda decía «mientras no haya sociedad, cada socio factura por
su cuenta». Eso es la situación de Salamandra escrita dentro del producto de un
cliente. No presuponer nunca forma jurídica, tamaño ni cómo tributa quien lee.

- [x] `facturacion` — el periodo solo mueve Facturado y Cobrado; los presupuestos
      y «Acción requerida» son la foto de hoy, y por eso la conversión del embudo
      se lee como pésima sin serlo
- [x] `facturacion/resumen` — «Cobrado» va por fecha de EMISIÓN de la factura, así
      que nunca cuadra con el total de la pantalla Cobros
- [x] `facturacion/facturas` — emitida no es cobrada, «Vencida» se pone sola, y al
      emitir se consume número de serie y ya no hay marcha atrás
- [x] `facturacion/recurrentes` — sin globo: lo suyo (que la fecha de próxima
      emisión NO avanza al facturar) se dijo dentro de la banda ámbar que ya
      estaba, que es donde la gente mira
- [x] `facturacion/cobros` — emitir no es cobrar, y la morosidad vive DENTRO de
      esta pantalla (facturas vencidas sin cobro), no en una lista aparte
- [x] `facturacion/presupuestos` (+ `[id]`) — «Convertir en factura» crea un
      BORRADOR que hay que emitir aparte, y al convertirlo el presupuesto queda
      bloqueado
- [x] `facturacion/costes` · `facturacion/proveedores` — proveedor es la MISMA
      ficha para Gastos y para el almacén, y darlo de baja lo borra de verdad si
      no tiene gastos
- [x] `facturacion/arqueo` — un cierre es la FOTO de ese día: la diferencia se
      guarda tal cual y no se recalcula aunque luego corrijas un cobro
- [x] `facturacion/cumplimiento` — Verifactu y Factura-e son DOS obligaciones
      distintas que suenan igual; esta pantalla no emite nada, solo informa
- [x] `facturacion/analitica` (+ `clientes`, `empleados`, `iva`, `socios`) — el
      trimestre del IVA es el EN CURSO, no el cerrado: no es lo que se declara
- [x] `facturacion/configuracion` — los datos fiscales se escriben desde DOS
      pantallas llamadas «Configuración», y cambiar una serie provoca un 422 que
      no se anuncia en ningún sitio

### Equipo
- [ ] `equipo` · `equipo/bandeja` · `equipo/actividad`
- [ ] `equipo/desempeno-config` · `equipo/mi-desempeno`
- [ ] `equipo/direccion` · `equipo/productividad` · `equipo/ocupacion`
- [ ] `equipo/incidencias`

### Clínica y Pacientes — HECHO (06/08/2026)

**8 ayudas en 7 pantallas.** Salieron 10 y se quitaron 2: bastante mejor que
Facturación (44 → 20) porque el criterio se dio calibrado de entrada, con el
listón puesto en NO escribir. Lo que más ayudó: decirle a cada agente que «esta
pantalla no necesita ninguna» es la respuesta correcta la mayoría de las veces.

Se repitió el error de la percha, así que vigílalo en los módulos que quedan: un
«?» se plantó en un `<th>` vacío, el de la columna de botones. Un interrogante
sin palabra al lado no se cuelga de un rótulo, **se convierte** en el rótulo —
es la misma falta que la barra gris inventada de Facturación. Reparado y movido
al h1.

- [x] `clinica` — SIN ayuda a propósito: la que había era un cajón de sastre
      colgado del título explicando tres indicadores a la vez
- [x] `clinica/informes` — «Entrega» es la fecha COMPROMETIDA, no la del envío,
      y es opcional: sin ella un informe no cuenta nunca como vencido, por
      antiguo que sea
- [x] `clinica/talleres` — «Retirar» es irreversible y hace dos cosas distintas:
      borra si no se apuntó nadie, oculta si hay historial. Y el nombre se queda
      ocupado, así que el taller de septiembre no se puede volver a crear
- [x] `clinica/coordinaciones` · `clinica/estadisticas`
- [x] `pacientes` · `pacientes/[id]` (2: la ficha es la más densa del módulo) ·
      `pacientes/[id]/sesiones/nueva`

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
