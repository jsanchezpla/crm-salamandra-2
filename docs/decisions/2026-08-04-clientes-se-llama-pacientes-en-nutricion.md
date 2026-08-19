# Clientes se llama «Pacientes» en la consulta de nutrición (regla por módulos, con condición negativa)

**Fecha:** 04/08/2026 · **Quién:** Jorge · **Módulos:** clients, nutricion,
pacientes, clinica · **Lo que quedó en `CLAUDE.md`:** la regla en la sección
de módulos y el ejemplo del peldaño 1 de la escalera (#16).

## Qué se decidió

`lib/clients/vocabulario.js` decide el rótulo del módulo `clients` y lo dicen
igual el sidebar, la pantalla `/clientes`, la portada y el `<title>` del
navegador: **Pacientes** donde el cliente ES el paciente (tiene `nutricion` y
NO tiene `pacientes` ni `clinica`), **Clientes** en el resto. Por MÓDULOS, no
por slug, igual que el formulario de alta.

## La condición negativa es lo importante

En un centro clínico el cliente es la familia que paga y los pacientes son los
hijos, que ya tienen su tabla y su propia entrada de menú. Sin la condición
negativa, Aumenta y demo tendrían **dos «Pacientes» distintos en el mismo
sidebar**. En el momento de escribirse solo cumplía `nutri_laura`; desde el
13/08/2026 también `demo_nutricion`.

## Renombrados que salieron de ahí

En el módulo Nutrición (y por tanto en todos los que lo tienen): «Recetas» →
**Recetario** y «Pacientes» → **Pautas** (el submenú de `/nutricion/asignados`,
que ya no podía llamarse igual que el módulo de arriba). Y las pestañas de la
ficha de nutri_laura pasan a **Datos · Historia clínica · Documentos · Sesiones
· Pautas**. Todo son rótulos: ni rutas, ni claves, ni endpoints, ni tablas se
han movido, y por dentro las pantallas de nutrición siguen hablando de «plan»
y «menú».

## Cómo se aplica hoy

Es el **peldaño 1 de la regla #16**: cuando lo único que cambia es cómo se
llama algo, la regla va por MÓDULOS en un `vocabulario.js`, no por slug ni en
una pantalla propia. `TENANT_TITLE_OVERRIDES` (por slug) queda solo para lo que
es de verdad de un cliente («Interesados» en Aumenta).
