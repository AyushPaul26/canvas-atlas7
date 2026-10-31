import type {BrowserWindow,Session} from 'electron';
import {createHash,randomUUID} from 'node:crypto';
import {extname,isAbsolute,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {NOTES_LIMITS,type StudyNotesDocument} from '@living-canvas/protocol';
import {renderNotesHtml} from './notes-html';

const pdfExtension='mhjfbmdgcfjbbpaeojofohoefgiehjai';
const closed=()=>new Error('The notes PDF service has closed. Reopen Canvas Atlas to try again.');
const footer='<div style="font-family:Arial,sans-serif;font-size:8px;color:#667185;width:100%;padding:0 38px;display:flex;justify-content:space-between"><span>Canvas Atlas · Presented lesson notes</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>';

function allowPreviewResource(url:string,documentUrl:string):boolean{
  try{
    const parsed=new URL(url);
    parsed.hash='';if(parsed.href===documentUrl)return true;
    return parsed.protocol==='chrome-extension:'&&parsed.hostname===pdfExtension||parsed.protocol==='chrome:'&&['pdf-viewer','resources'].includes(parsed.hostname)||parsed.protocol==='blob:'||url==='about:blank';
  }catch{return false;}
}
function isolate(partition:Session,allowed:(url:string)=>boolean){
  partition.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  partition.setPermissionCheckHandler(()=>false);
  partition.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!allowed(details.url)}));
}
function restrict(window:BrowserWindow,allowed:(url:string)=>boolean){
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(!allowed(url))event.preventDefault();});
  window.webContents.on('will-redirect',event=>event.preventDefault());
  window.webContents.on('will-attach-webview',event=>event.preventDefault());
}

export class NotesPdfService{
  private disposed=false;
  private windows=new Set<BrowserWindow>();
  private previews=new Map<string,BrowserWindow>();
  private readonly onParentClosed=()=>this.dispose();
  constructor(private options:{parent:BrowserWindow;timeoutMs?:number}){options.parent.once('closed',this.onParentClosed);}
  private available(){if(this.disposed||this.options.parent.isDestroyed())throw closed();}
  private track(window:BrowserWindow){this.windows.add(window);window.once('closed',()=>{this.windows.delete(window);for(const [key,preview] of this.previews)if(preview===window)this.previews.delete(key);});return window;}
  private async runWindow<T>(window:BrowserWindow,work:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
    this.available();signal?.throwIfAborted();
    let rejectStopped!:(error:unknown)=>void;
    const stopped=new Promise<never>((_resolve,reject)=>{rejectStopped=reject;});
    const abort=()=>rejectStopped(signal?.reason??new DOMException('PDF generation cancelled.','AbortError'));
    const ended=()=>rejectStopped(closed());
    const crashed=()=>rejectStopped(new Error('The notes PDF renderer stopped. Try creating the PDF again.'));
    const timer=setTimeout(()=>rejectStopped(new Error('Creating the notes PDF timed out. Please try again.')),this.options.timeoutMs??30000);
    window.once('closed',ended);window.webContents.once('render-process-gone',crashed);signal?.addEventListener('abort',abort,{once:true});
    try{signal?.throwIfAborted();return await Promise.race([Promise.resolve().then(work),stopped]);}
    finally{clearTimeout(timer);window.removeListener('closed',ended);window.webContents.removeListener('render-process-gone',crashed);signal?.removeEventListener('abort',abort);}
  }
  async render(document:StudyNotesDocument,signal:AbortSignal):Promise<Buffer>{
    this.available();signal.throwIfAborted();
    const html=renderNotesHtml(document);
    const {BrowserWindow,session}=await import('electron');this.available();signal.throwIfAborted();
    const partition=session.fromPartition(`notes-print-${randomUUID()}`,{cache:false});
    isolate(partition,url=>url.startsWith('data:'));
    const window=this.track(new BrowserWindow({parent:this.options.parent,show:false,width:900,height:1200,backgroundColor:'#FFFFFF',autoHideMenuBar:true,webPreferences:{session:partition,sandbox:true,contextIsolation:true,nodeIntegration:false,nodeIntegrationInWorker:false,webviewTag:false,webSecurity:true,allowRunningInsecureContent:false,backgroundThrottling:false}}));
    restrict(window,()=>false);
    try{
      return await this.runWindow(window,async()=>{
        await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);signal.throwIfAborted();this.available();
        await window.webContents.executeJavaScript('document.fonts.ready.then(() => { void document.body.offsetHeight; return true; })');signal.throwIfAborted();
        const pdf=await window.webContents.printToPDF({pageSize:'A4',printBackground:true,preferCSSPageSize:true,displayHeaderFooter:true,headerTemplate:'<div></div>',footerTemplate:footer,margins:{top:.55,bottom:.65,left:.55,right:.55},generateTaggedPDF:true});
        signal.throwIfAborted();this.available();
        if(!Buffer.isBuffer(pdf)||pdf.length>NOTES_LIMITS.pdfBytes||pdf.subarray(0,5).toString()!=='%PDF-')throw new Error('The notes PDF output was invalid or exceeded the allowed size.');
        return pdf;
      },signal);
    }catch(error){
      if(signal.aborted)throw signal.reason;
      if(error instanceof Error&&/^(?:The notes PDF|Creating the notes PDF)/.test(error.message))throw error;
      // eslint-disable-next-line preserve-caught-error -- Electron causes can include private local paths; only a fixed diagnostic leaves this service.
      throw new Error('The notes PDF could not be created. Please try again.');
    }finally{if(!window.isDestroyed())window.destroy();}
  }
  async open(path:string,title:string):Promise<void>{
    this.available();if(!isAbsolute(path)||extname(path).toLowerCase()!=='.pdf')throw new Error('Open only a saved notes PDF from this lesson.');
    const fullPath=resolve(path);return this.preview(fullPath,pathToFileURL(fullPath).href,title,window=>window.loadFile(fullPath));
  }
  async openBytes(input:Uint8Array,title:string):Promise<void>{
    this.available();
    if(!(input instanceof Uint8Array)||input.byteLength<16||input.byteLength>NOTES_LIMITS.pdfBytes)throw new Error('Open only a valid bounded notes PDF.');
    // Copy before the first await: later cache/file/caller changes cannot change
    // the approved document handed to Chromium's built-in PDF viewer.
    const bytes=Buffer.from(input);
    if(bytes.subarray(0,5).toString('ascii')!=='%PDF-'||!bytes.subarray(-1024).toString('latin1').includes('%%EOF'))throw new Error('Open only a valid bounded notes PDF.');
    const key=`bytes:${createHash('sha256').update(bytes).digest('hex')}`,url=`data:application/pdf;base64,${bytes.toString('base64')}`;
    return this.preview(key,url,title,window=>window.loadURL(url));
  }
  private async preview(key:string,documentUrl:string,title:string,load:(window:BrowserWindow)=>Promise<void>):Promise<void>{
    const existing=this.previews.get(key);
    if(existing&&!existing.isDestroyed()){if(existing.isMinimized())existing.restore();existing.show();existing.focus();return;}
    const {BrowserWindow,session}=await import('electron');this.available();
    const partition=session.fromPartition(`notes-preview-${randomUUID()}`,{cache:false});
    isolate(partition,url=>allowPreviewResource(url,documentUrl));
    partition.on('will-download',(event,item)=>{let url='';try{url=item.getURL();}catch{/* Deny unidentifiable downloads. */}if(!allowPreviewResource(url,documentUrl))event.preventDefault();});
    const window=this.track(new BrowserWindow({parent:this.options.parent,show:false,width:1040,height:900,minWidth:680,minHeight:500,title:`${title.slice(0,240)} · Canvas Atlas notes`,backgroundColor:'#F5F7FA',autoHideMenuBar:true,webPreferences:{session:partition,plugins:true,sandbox:true,contextIsolation:true,nodeIntegration:false,nodeIntegrationInWorker:false,webviewTag:false,webSecurity:true,allowRunningInsecureContent:false}}));
    restrict(window,url=>allowPreviewResource(url,documentUrl));window.webContents.on('page-title-updated',event=>event.preventDefault());
    this.previews.set(key,window);
    try{await this.runWindow(window,()=>load(window));this.available();window.show();window.focus();}
    catch{if(!window.isDestroyed())window.destroy();throw new Error('The saved notes PDF could not be opened. Try Save PDF to open a portable copy.');}
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.options.parent.removeListener('closed',this.onParentClosed);for(const window of this.windows)if(!window.isDestroyed())window.destroy();this.windows.clear();this.previews.clear();}
}
