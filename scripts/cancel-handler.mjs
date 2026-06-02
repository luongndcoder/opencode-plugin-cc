import * as nodeFs from 'node:fs'
import { dirname } from 'node:path'

/**
 * Factory for cancellation handler.
 * Installs SIGINT/SIGTERM listeners that abort the in-flight task, clean PID file, emit trace, and exit.
 *
 * @param {object} deps
 * @param {string} deps.pidFile - path to PID file (created on install, removed on uninstall/signal)
 * @param {AbortController} deps.abortController - signaled on cancel; bridge.invoke listens
 * @param {(entry: object) => void} deps.onTrace - trace sink (records cancel event)
 * @param {NodeJS.Process} [deps.proc=process] - process object (DI for test)
 * @param {typeof import('node:fs')} [deps.fs=nodeFs] - fs module (DI for test)
 */
export function createCancelHandler({
  pidFile,
  abortController,
  onTrace,
  proc = process,
  fs = nodeFs,
}) {
  let installed = false

  function handler(signal) {
    onTrace({ event: 'cancel', signal, ts: Date.now() })
    try {
      abortController.abort()
    } catch {
      // ignore - already aborted
    }
    try {
      fs.unlinkSync(pidFile)
    } catch {
      // ignore - already removed
    }
    const exitCode = signal === 'SIGINT' ? 130 : 143
    proc.exit(exitCode)
  }

  return {
    install() {
      if (installed) return
      fs.mkdirSync(dirname(pidFile), { recursive: true })
      fs.writeFileSync(pidFile, String(proc.pid))
      proc.on('SIGINT', handler)
      proc.on('SIGTERM', handler)
      installed = true
    },

    uninstall() {
      if (!installed) return
      proc.off('SIGINT', handler)
      proc.off('SIGTERM', handler)
      try {
        fs.unlinkSync(pidFile)
      } catch {
        // ignore
      }
      installed = false
    },

    _triggerForTest(signal) {
      handler(signal)
    },

    _isInstalled() {
      return installed
    },
  }
}
