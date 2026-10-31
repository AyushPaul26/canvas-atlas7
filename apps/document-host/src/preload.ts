import {ipcRenderer} from 'electron';
// No filesystem, authentication, network, or general app IPC is exposed.
ipcRenderer.once('document:port', event => {
  if (event.ports.length === 1) window.postMessage({type: 'canvas-atlas:document-port'}, '*', event.ports);
});
