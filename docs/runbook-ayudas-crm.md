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

### Equipo — HECHO (06/08/2026)

**8 ayudas en 9 pantallas: exactamente una por pantalla, y salió así a la
primera**, sin pasada de poda. Es la prueba de que el problema de Facturación no
era el módulo sino empezar sin criterio: aquí se dio calibrado en el encargo.

Lo propio de este módulo: mide a personas con nombre y apellidos. La regla que
funcionó fue decir QUÉ cuenta cada número y qué deja fuera, y prohibir
expresamente interpretarlo («si baja del 70% conviene revisar»). El CRM enseña
datos; valorar a alguien es de quien dirige.

- [x] `equipo` — marcar «Inactivo» y guardar BORRA el usuario del CRM, no es un
      cambio de etiqueta. El botón «Desactivar» sí avisaba; este otro camino al
      mismo sitio, no
- [-] `equipo/bandeja` — se explica sola, cada contador lleva su frase debajo
- [x] `equipo/actividad` — solo se registra lo que CAMBIA algo: consultar una
      ficha o leer un informe no dejan rastro, así que un día vacío no significa
      que esa persona no trabajara
- [x] `equipo/desempeno-config` — el efecto de guardar es asimétrico: los pesos
      cuentan de aquí en adelante, pero los umbrales del semáforo son
      retroactivos y repintan meses ya evaluados
- [x] `equipo/mi-desempeno` · `equipo/direccion` · `equipo/productividad` ·
      `equipo/ocupacion` · `equipo/incidencias`

⚠️ **Fallo encontrado de paso, sin arreglar** (no es una ayuda, es un bug): la
cabecera «{total} miembros · {inactivos} inactivos» de `equipo` cuenta sobre la
página ya filtrada, y como el filtro por defecto excluye a los inactivos,
imprime «0 inactivos» siempre. El endpoint ya devuelve el total bueno y la
pantalla lo ignora.

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

### Nutrición — HECHO (06/08/2026)

**2 ayudas en 4 pantallas.** Cada agente acertó por separado —una por pantalla,
ninguna en Menús— pero las TRES contestaban a la misma pregunta: «lo que edito
aquí, ¿llega a lo ya entregado?». Nadie podía verlo desde su pantalla; lo vio el
crítico. Es el arranque exacto del fallo de Facturación, cazado a tiempo.

Se quitó la del Recetario porque además CHOCABA con la de Alimentos: una decía
que los ingredientes se copian a la pauta y la otra que los números se leen en
vivo. Las dos son ciertas —se congela la cantidad, no las macros/100 g— y justo
por eso juntas confunden más de lo que aclaran.

- [x] `nutricion/alimentos` — corregir un valor cambia las pautas YA entregadas
      y el PDF que se descargue después: es el único eslabón que no se congela
- [-] `nutricion/recetas` — la tenía, se quitó por repetir y por chocar
- [-] `nutricion/plantillas` — asignar COPIA, no enlaza, así que el peligro que
      se sospechaba no existe; y lo que sí sorprende ya está escrito en tres
      avisos visibles de la propia pantalla
- [x] `nutricion/asignados` (Pautas)

⚠️ **Para el producto, no para el runbook**: el comportamiento de una receta está
PARTIDO y no se adivina. Al añadirla a una pauta se congelan nombre e
ingredientes, pero los pasos y la foto se leen siempre en vivo. Corregir una
cantidad mal puesta NO le llega a quien ya tiene la pauta —ni con «Re-aplicar
menú origen», que recopia los snapshots viejos—, y reescribir los pasos sí le
reescribe pautas de hace meses. Merece una decisión de producto, no un globo.

### Comercial — HECHO (06/08/2026)

**7 ayudas en 9 pantallas**, y dos pantallas se quedaron a cero por motivos que
merecen leerse.

- [-] `leads` — SIN ayuda, y no por poco: el fichero de la ruta es un server
      component de 57 líneas que reparte a OCHO overrides por tenant, sin un
      solo rótulo donde colgar nada. Y el módulo base `modules/leads` hoy no lo
      renderiza NADIE: los ocho tenants con `leads` están todos en el mapa de
      overrides. Escribir ahí es escribir para cero usuarios.
- [x] `leads/estadisticas` — la fila de cifras de arriba MEZCLA los dos
      orígenes: «Entradas» suma profesionales y comerciales, pero las otras
      tres solo cuentan profesionales. La ayuda se renderiza solo si el tenant
      tiene las dos puertas: sin la segunda no hay nada que distinguir
- [-] `comercial/leads` — CÓDIGO HUÉRFANO (ver abajo)
- [x] `formularios` · `outreach` (+ `[id]`, `configuracion`)
- [x] `analiticas` · `referidos`

⚠️ **Tres cosas encontradas de paso, ninguna arreglada** (son bugs o limpieza,
no globos, y taparlas con una ayuda sería justo lo contrario de lo que toca):

1. **Los contadores de etapa del embudo mienten** en el override de aumenta y
   sandbox. El total sale del servidor, pero el desglose por etapa se calcula
   sobre las 200 filas traídas; y al pulsar una etapa se re-consulta filtrando,
   con lo que las demás tarjetas caen a cero.
2. **`/comercial/leads` no se puede alcanzar.** Ningún enlace del repo apunta
   ahí; el único enlace a `/comercial` va a una ruta que no existe (404), y el
   moduleKey `sales` solo lo siembra el tenant de pruebas — la reconstrucción
   de la demo lo excluye a propósito por «duplicar a leads». Dentro tiene los
   textos de una campaña de Retorika escritos a mano y firmados. Es un resto de
   algo terminado: se borra, no se documenta.
3. **Las etiquetas de etapa se contradicen**: `modules/leads/LeadsModule.jsx`
   dice «Cualificado / Ganado / Perdido» donde `lib/leads/stages.js`, que es la
   fuente única, dice «En seguimiento / Convertido / Descartado».

### Formación — YA LA TIENE
- [-] `formacion` y sus hijas: de aquí salió el patrón

### Resto — HECHO (06/08/2026)

**7 ayudas en 12 pantallas.** Las mejores salieron de leer endpoints, no
pantallas:

- [x] `documentos` — «Compartidos» no es lo que sube el equipo aquí: es el
      archivo central del CRM. Ahí caen también los adjuntos de las fichas y lo
      que suben las familias desde el portal, y borrar uno lo borra de su ficha
      y del portal a la vez, sin papelera
- [x] `soporte` — el aviso de SLA vencido cuenta TODOS los tickets abiertos,
      ignorando la pestaña y los filtros; y el reloj no se para mientras esperas
      al cliente, así que un ticket ya contestado acaba sumando ahí
- [x] `inventario` — «valorado en» es lo que costaría reponer al precio de
      compra: lo que no tenga precio puesto suma cero, y solo cuenta lo que
      estás viendo
- [x] `calendario` · `pedidos` (+ `[id]`, `configuracion`) ·
      `proyectos` (+ `[id]`, `[id]/board`)
- [-] `cuestionarios` · `configuracion` — ya tenían las suyas de antes

Nota de método que se confirmó aquí: cuando el fichero de la ruta es un
envoltorio sin rótulos (soporte, documentos), la ayuda va al componente que
pinta de verdad la pantalla, no se inventa marcado en el envoltorio.

### Overrides — HECHO (06/08/2026). **RUNBOOK COMPLETO.**

- [x] `nutri-laura/LeadsModule` — «Convertir a paciente» crea la ficha y cambia
      la etapa en dos pasos; si el segundo falla no avisa de nada y la ficha ya
      está creada, así que volver a pulsar la duplica
- [x] `aumenta/LeadsModule` — la lista enseña 200 y no hay forma de seguir
      bajando: al interesado nº 201 solo se llega buscándolo
- [x] `abarcaia/ReferidosModule` — el único del resto que divergía de verdad
- [-] Los demás heredan: son la misma tabla con otros rótulos

---

## Cierre — qué salió de todo esto (06/08/2026)

**53 ayudas en unas 76 pantallas.** Módulo a módulo: Facturación 20 (de 44 —
hubo que quitar 24), Clínica y Pacientes 8, Equipo 8, Comercial 7, Resto 7,
Nutrición 2, Overrides 6, más las de Clientes y Citas del día anterior.

**Lo que hizo la diferencia** fue poner el listón en NO escribir. Facturación se
hizo sin criterio y salió al triple de densidad; en cuanto se dijo por delante
que «esta pantalla no necesita ninguna» es la respuesta correcta la mayoría de
las veces, la cosa se ordenó sola: Equipo salió a una por pantalla y a la
primera, sin poda.

**El fallo que se repitió tres veces** fue la percha: cambiar el marcado para
hacerle hueco a un globo. Un `<Link>` degradado a `<div>`, una barra gris
inventada que no era ni filtro ni leyenda, y un «?» plantado en una cabecera
vacía — que no se cuelga de un rótulo, SE CONVIERTE en el rótulo. Si vuelve a
hacerse este trabajo en otro sitio, esa es la regla que hay que dar primero.

**Y lo que ningún agente ve solo**: la densidad y la repetición. En Nutrición
las tres ayudas contestaban a la misma pregunta y dos se contradecían en
apariencia; en Facturación «los importes van sin IVA» llegó a estar escrito
siete veces. Hace falta alguien que mire el módulo entero al final.

### Bugs encontrados de paso, NINGUNO arreglado

Salieron de leer endpoints para escribir las ayudas. Están sin tocar a propósito
— son de producto, no de documentación:

1. `equipo` — la cabecera cuenta los inactivos sobre la página ya filtrada, y
   como el filtro por defecto los excluye, **siempre dice «0 inactivos»**.
2. **Contadores por etapa del embudo**, en los tres overrides (aumenta,
   nutri-laura, sandbox): se calculan sobre las 200 filas traídas, no sobre el
   total. Y al filtrar por una etapa, las demás caen a cero — en aumenta hasta
   el «X en total» de la cabecera se contagia.
3. `nutri-laura` — «Convertir a paciente» son dos peticiones sin transacción:
   si la segunda falla, la ficha queda creada, el lead sin vincular y **no se
   dice nada**. El guard de idempotencia no protege ese caso. Además la primera
   no exige rol admin y la segunda sí, así que un usuario normal crea fichas y
   se come un 403 en silencio en cada intento.
4. `nutri-laura` — marcar «Colaboración activa» a mano esconde el botón de
   convertir sin haber creado ficha: esa persona se queda sin ficha y sin forma
   de crearla desde ahí.
5. `nutri-laura` — la columna «Empresa» sale vacía siempre (nadie escribe ese
   campo) y «Propuesta» enseña la respuesta a otra pregunta.
6. `/comercial/leads` es **código al que no se llega**: ningún enlace apunta
   ahí, el único enlace a `/comercial` da 404 y nadie tiene el moduleKey. Lleva
   dentro los textos de una campaña de Retorika escritos a mano.
7. Las etiquetas de etapa del módulo base **contradicen** a `lib/leads/stages.js`,
   que es la fuente única.
8. **Receta partida** (nutrición): al asignarla se congelan nombre e
   ingredientes pero los pasos y la foto se leen en vivo. Corregir una cantidad
   no llega a quien ya tiene la pauta — ni con «Re-aplicar menú origen» — y
   reescribir los pasos sí le cambia pautas de hace meses.
