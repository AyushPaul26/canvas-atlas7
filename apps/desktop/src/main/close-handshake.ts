import type { BrowserWindow } from 'electron'
import type { TutorEvent } from '@living-canvas/protocol'

/** Give the trusted renderer one bounded opportunity to checkpoint its actual
 * visible/heard progress. A broken renderer cannot trap the user in the app. */
export function installCloseHandshake(window: BrowserWindow, notify: (event: TutorEvent) => void) {
  let closing = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const finalize = () => { timer = undefined; if (!window.isDestroyed()) window.destroy() }
  const onClose = (event: Electron.Event) => {
    event.preventDefault()
    if (closing) return
    closing = true; timer = setTimeout(finalize, 2500); notify({ type: 'closing' })
  }
  window.on('close', onClose)
  return {
    acknowledge() { if (closing && timer) { clearTimeout(timer); timer = setTimeout(finalize, 0) } },
    dispose() { if (timer) clearTimeout(timer); timer = undefined; window.removeListener('close', onClose) },
  }
}
