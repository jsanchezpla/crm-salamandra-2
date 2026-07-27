#!/usr/bin/env node
/**
 * Hook SessionStart — aviso de sincronización con GitHub.
 *
 * Somos dos tocando `master` a la vez y `master` ES producción, así que empezar
 * a editar sobre una copia vieja es el error caro: el otro ya ha subido cosas,
 * tú escribes encima sin saberlo y el choque aparece al hacer push (o peor, al
 * desplegar). Esto hace `git fetch` al arrancar la sesión y avisa ANTES de que
 * se toque una sola línea.
 *
 * No modifica nada: solo mira. Si no hay red o faltan credenciales, lo dice y
 * sigue — un hook que revienta no puede bloquear el arranque.
 */

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// El repo se deduce de dónde vive ESTE fichero (.claude/hooks/ → raíz), no del
// cwd: la sesión puede arrancar en la carpeta padre y entonces el cwd no es el
// repo.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const git = (args, timeout = 15000) =>
  execFileSync('git', ['-C', REPO, ...args], {
    encoding: 'utf8',
    timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
    // GIT_TERMINAL_PROMPT=0: sin credenciales cacheadas, git falla al momento en
    // vez de quedarse esperando un usuario/contraseña que nadie va a teclear.
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
  }).trim()

function report() {
  const avisos = []

  let fetchOk = true
  try {
    git(['fetch', 'origin', 'master', '--quiet'], 25000)
  } catch {
    fetchOk = false
  }

  // origin/master...HEAD → "detrás  delante"
  const [behind, ahead] = git(['rev-list', '--left-right', '--count', 'origin/master...HEAD'])
    .split(/\s+/)
    .map(Number)

  if (behind > 0) {
    const quien = git(['log', '--format=%an', `-${Math.min(behind, 5)}`, 'origin/master'])
      .split('\n')
      .filter((n, i, a) => a.indexOf(n) === i)
      .join(', ')
    avisos.push(
      `AVISO: tu master va ${behind} commit(s) POR DETRÁS de GitHub (ha subido: ${quien}). ` +
        `Antes de editar nada: git pull --rebase origin master`,
    )
  }
  if (ahead > 0) {
    avisos.push(`Tienes ${ahead} commit(s) hechos y SIN SUBIR a GitHub.`)
  }
  if (git(['status', '--porcelain']).length > 0) {
    avisos.push('Hay cambios en el disco sin commitear.')
  }
  if (!fetchOk) {
    avisos.push('(No se pudo consultar GitHub — sin red o sin credenciales; el dato puede estar viejo.)')
  }

  return avisos.length ? avisos.join(' ') : 'Sincronizado con GitHub: nada pendiente ni por bajar.'
}

try {
  const mensaje = report()
  process.stdout.write(
    JSON.stringify({
      systemMessage: `[git] ${mensaje}`,
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext:
          `Estado de git al arrancar la sesión (repo CRM, master compartido con Jorge): ${mensaje}` +
          (mensaje.startsWith('AVISO')
            ? ' Avisa al usuario de esto y haz el pull --rebase antes de editar ficheros.'
            : ''),
      },
    }),
  )
} catch {
  // Sin git, repo raro o cualquier otro fallo: callar y no estorbar el arranque.
}
