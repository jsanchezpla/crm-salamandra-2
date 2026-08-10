# Refactor base/override — carpeta de trabajo

Traza del refactor arquitectural que da a cada tenant un override propio de
los módulos que usa. Todo lo que genera el loop vive aquí.

## Ficheros

| Fichero | Qué es |
| --- | --- |
| `f0-diagnostico.md` | **Empieza por aquí.** Mecanismo real de overrides, matriz tenant × módulo, coste medido y riesgos. |
| `plan.md` | Tabla de las 40 iteraciones + las dos opciones de continuación. Pendiente de aprobación. |
| `state.json` | Estado del loop. Lo lee un Claude futuro para retomar. |
| `bugs.md` | Bugs que salen del testing de cada iteración. |
| `backlog.md` | Lo detectado en base que NO se toca (regla 5 del runbook). |
| `iterations/` | Un log por iteración completada. |

## Fases

`F0 diagnóstico` → `F1 documentar base` → `F2 loop overrides` → `F3 checkpoints`
→ `F4 retomar` → `F5 cierre`

**Estado hoy: F0 completa, esperando aprobación del `plan.md`.**

## Reglas que aplica el loop

1. No se toca `modules/default/**`, `models/tenant/**`, endpoints base,
   migraciones, `docker-compose.yml`, `nginx.conf`, `.env*` ni scripts de
   deploy. Ante la duda: al backlog y seguir.
2. **No se commitea nunca.** Jorge revisa el working tree y commitea él.
   (Confirmado por Jorge el 2026-08-07: "todo en local".)
3. Bug crítico de seguridad en base → apuntar, **parar el loop**, avisar.
   No arreglar sin autorización.
4. Tras cada iteración, testing completo. Si falla dos veces seguidas, el
   loop para y el detalle va a `bugs.md`.

## Retomar en una sesión nueva

Leer, en este orden: `state.json` → los 3 últimos logs de `iterations/` →
`bugs.md`. Continuar desde `current_iteration`.
