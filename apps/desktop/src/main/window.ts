import {BrowserWindow,session} from 'electron';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PRODUCT_NAME} from './identity';

export function createMainWindow(options:{preloadPath:string;rendererPath:string;devUrl?:string;show?:boolean;deferLoad?:boolean}):BrowserWindow {
  const window=new BrowserWindow({width:1440,height:940,minWidth:1000,minHeight:680,show:options.show??true,title:PRODUCT_NAME,backgroundColor:'#F5F7FA',autoHideMenuBar:true,
    webPreferences:{preload:options.preloadPath,contextIsolation:true,sandbox:true,nodeIntegration:false,nodeIntegrationInWorker:false,webviewTag:false,webSecurity:true,allowRunningInsecureContent:false,partition:'persist:living-canvas-ui'}});
  const rendererRoot=resolve(options.rendererPath);const trusted=(url:string)=>{
    try{if(options.devUrl)return new URL(url).origin===new URL(options.devUrl).origin;
      const parsed=new URL(url);return parsed.protocol==='file:'&&(resolve(fileURLToPath(parsed))===join(rendererRoot,'index.html'));}catch{return false;}
  };
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(!trusted(url))event.preventDefault();});
  window.webContents.on('will-redirect',(event)=>event.preventDefault());
  window.webContents.on('will-attach-webview',event=>event.preventDefault());
  const uiSession=session.fromPartition('persist:living-canvas-ui');
  uiSession.setPermissionRequestHandler((contents,permission,callback,details)=>callback(contents===window.webContents&&permission==='media'&&trusted(contents.getURL())&&'mediaTypes' in details&&!details.mediaTypes?.includes('video')));
  uiSession.setPermissionCheckHandler((contents,permission,_origin,details)=>contents===window.webContents&&permission==='media'&&trusted(contents.getURL())&&details.mediaType==='audio');
  uiSession.webRequest.onBeforeRequest((details,callback)=>{
    let allowed=false;
    try{const url=new URL(details.url);
      if(url.protocol==='file:'){const path=resolve(fileURLToPath(url));allowed=path===rendererRoot||path.startsWith(rendererRoot+sep);}
      else if(url.protocol==='blob:'||url.protocol==='data:')allowed=true;
      else if(options.devUrl){const origin=new URL(options.devUrl);allowed=url.hostname===origin.hostname&&url.port===origin.port&&['http:','ws:'].includes(url.protocol);}
    }catch{/* Reject malformed locations. */}
    callback({cancel:!allowed});
  });
  uiSession.webRequest.onHeadersReceived((details,callback)=>{
    const dev=!!options.devUrl;
    callback({responseHeaders:{...details.responseHeaders,'Content-Security-Policy':[
      `default-src 'self'; script-src 'self'${dev?" 'unsafe-eval'":''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; worker-src 'self' blob:; connect-src ${dev?`${new URL(options.devUrl!).origin} ws://${new URL(options.devUrl!).host}`:"'none'"}; object-src 'none'; base-uri 'none'; frame-src 'none'`,
    ]}});
  });
  if(!options.deferLoad){if(options.devUrl)void window.loadURL(options.devUrl);else void window.loadFile(join(rendererRoot,'index.html'));}
  return window;
}
