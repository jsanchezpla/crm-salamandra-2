# La semana de cada terapeuta, y por qué coordinar no es un departamento

**09/09/2026 · AV-0078 de Aumenta (Araceli) · `clinica` + `team_avanzado`**

## De qué queja nace

> «Por el momento, no nos salen lo que deberíamos ir haciendo a la semana:
> registros, informes, planes de intervención... Especialmente las personas que
> revisamos el trabajo de las compis (Daniela y Araceli), estaría guay que
> pudiéramos ver todas estas estadísticas, con el fin de poder dar el feedback a
> las compis, en especial, las más nuevas.»

Rodrigo lo decidió el mismo día: «Araceli y Daniela pueden ver el trabajo de los
demás porque son coordinadoras».

## Lo primero que se descubrió: el permiso ya estaba resuelto

La tarea del Registro proponía crear un departamento «coordinación» que abriera
las pantallas de seguimiento. **No hacía falta.** El 02/09/2026 (AV-0022) ya se
había creado `lib/clinica/coordinadoras.js` con `veTodoElEquipo` y la lista
`settings.clinica.coordinadoras`, editable desde Configuración → Módulos. Y en
producción esa lista tiene **exactamente dos ids**: dos fichas activas, con
login, rol `user` (no admin), «Responsable» de Logopedia y de Pedagogía. Araceli
y Daniela.

O sea que desde hace una semana ya podían entrar en Equipo → Bandeja de trabajo
y cambiar de persona con el desplegable. **Lo que hacía parecer que no
funcionaba es que la Bandeja salía casi vacía**: sus tres secciones eran
informes —y en toda la base de Aumenta hay **2** informes clínicos—,
incidencias, y las citas de HOY.

Así que el trabajo no era abrir permisos. Era que hubiera algo dentro.

**Y el departamento habría sido un error activo**: `department` es el
departamento REAL de la ficha y lo usan los selectores de equipo. Ponerle
«Coordinación» a Araceli la habría sacado de Logopedia.

## Lo que se ha construido

Los **registros sin escribir de los últimos 7 días**: las citas que ya han
pasado, con paciente, confirmadas o completadas, y cuyo registro de sesión no
está. Más las que están empezadas y en borrador, que es otro trabajo distinto.

Y `?vista=equipo`, que da esos mismos recuentos de las 19 personas en una tabla.
Es lo que Araceli pidió de verdad: poder mirar el lunes sin ir picando quince
nombres en un desplegable.

## La decisión técnica que sostiene la lista: los DOS caminos

Una sesión clínica guarda de qué cita es (`booking_id`) desde el 01/09/2026, y
antes no podía. En Aumenta solo **231 de 23.342** sesiones lo tienen.

Medido el 09/09/2026, ventana de 7 días:

| | |
| --- | --- |
| Citas pasadas con paciente | 274 |
| «Sin registro» con la regla ingenua (solo `booking_id`) | **82** |
| «Sin registro» de verdad (los dos caminos) | **36** |
| En borrador | 2 |
| Personas con algo pendiente | 11 (máximo 8 cada una) |

Más del doble de falsos. Y una lista de tareas que reclama cosas ya hechas se
deja de mirar a la segunda semana: habría sido peor que no tenerla.

El segundo camino busca una sesión suelta del **mismo paciente**, el **mismo día
de Madrid**, sin cita asignada, que no sea de taller, y de la **misma
profesional o sin firmar** (los 4.297 registros viejos importados no tienen
autor).

⚠️ **No se reutiliza `sesionDeLaCita`** de `prepararSesion.js`, aunque cruce los
mismos datos. Aquella contesta a «¿en qué nota clínica voy a ESCRIBIR?», y ahí
la duda tiene que caer al revés —crear una sesión nueva antes que escribir
encima de una firmada por otra—. Aquí la duda cae del lado de no dar la lata a
quien ya escribió lo suyo. Son dos preguntas distintas, y mezclarlas haría que
arreglar una estropeara la otra.

## Lo que se decidió NO hacer, y por qué

**No se abren Desempeño ni Dirección.** No es cautela: es que no dicen nada y
enseñan dinero. En producción `performance_metrics` tiene **0 filas** e
`incentive_items` **0**: nadie ha evaluado a nadie nunca. Y lo que pintan cuando
hay datos es el ranking con el incentivo propuesto y aprobado en euros por
persona — material de nómina, no «el trabajo de las compis». El panel de
cumplimiento de planes está a cero por construcción: los 67 planes de Aumenta
tienen `report_schedule` a `{0, 0}`, los 67 iguales, así que el endpoint
devuelve `cumplimiento: null` para todo el mundo.

**No se abre Productividad todavía.** Es el único de los tres que enseña trabajo
(horas directas) y no dinero, pero los 19 miembros del equipo tienen
`weekly_direct_hours` a NULL, así que el porcentaje saldría N/D para todos. Y
sacarlo en el menú obligaría a que `/api/auth/me` hiciera una consulta más al
schema del tenant en cada carga del shell. La vista de equipo de la Bandeja da
lo que se pidió sin pagar eso.

**No hay lista de «planes de intervención por hacer».** Se buscó y no existe
como trabajo semanal: de los 482 pacientes activos sin plan, **1** tiene fecha
de alta en los últimos 30 días y 8 en los últimos 90. Y `patients.created_at` no
sirve de ancla, porque **1.174 de los 1.192** pacientes se crearon el mismo día:
el de la migración. Por cualquier definición razonable la lista es 482 —un
contador que no baja nunca— o está vacía. Antes de construirla hay que
preguntarle a Araceli qué entiende ella por «planes por hacer».

**No se cierra el permiso con `canSwitch`.** La línea real es `!therapistId ||
veTodoElEquipo(...)`, o sea que quien no tiene ficha de equipo también lo tiene
a `true`. Hoy en Aumenta no muerde (los 16 usuarios de rol `user` tienen ficha),
pero abrir por ahí la tabla de trabajo de las 19 personas se convertiría en un
agujero el día que den de alta a alguien de recepción con `team_avanzado`. La
vista de equipo se pregunta aparte, con la ficha propia, antes de que
`therapistId` pueda pasar a ser la de otra persona.

## Cómo se comprueba

```
node --test scripts/_smoke-lo-mio.mjs
```

Y en producción, la RATIO en vez de una cifra —que no caduca cada lunes—: la
regla doble tiene que dar **entre 2 y 3 veces menos** que la regla de solo
`booking_id`. El 09/09/2026 daba 2,3 en 7 días y 2,9 en 30.
