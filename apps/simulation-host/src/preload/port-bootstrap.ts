import { ipcRenderer } from 'electron'

// This preload deliberately exposes no Electron, filesystem, auth, or generic IPC.
// Only the main process can provide this single, scoped MessagePort.
ipcRenderer.once('sandbox:port', event => {
  if (event.ports.length === 1) window.postMessage({ type: 'living-canvas:sandbox-port' }, '*', event.ports)
})
