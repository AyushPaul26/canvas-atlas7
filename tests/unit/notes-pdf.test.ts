import {EventEmitter} from 'node:events';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {StudyNotesDocument} from '@living-canvas/protocol';

const mocked=vi.hoisted(()=>({windows:[] as any[],partitions:[] as any[],load:undefined as undefined|(()=>Promise<void>),print:undefined as undefined|(()=>Promise<Buffer>)}));
vi.mock('electron',async()=>{
  const {EventEmitter}=await import('node:events');
  class Window extends EventEmitter{
    destroyed=false;options:any;shown=false;
    webContents=Object.assign(new EventEmitter(),{setWindowOpenHandler:vi.fn(),executeJavaScript:vi.fn(async()=>true),printToPDF:vi.fn(async()=>mocked.print?mocked.print():Buffer.from('%PDF-fixture')),isDestroyed:()=>this.destroyed});
    constructor(options:any){super();this.options=options;mocked.windows.push(this);}
    loadURL=vi.fn(async()=>mocked.load?.());loadFile=vi.fn(async()=>mocked.load?.());
    destroy=vi.fn(()=>{if(this.destroyed)return;this.destroyed=true;this.emit('closed');});
    isDestroyed=()=>this.destroyed;show=vi.fn(()=>{this.shown=true;});focus=vi.fn();restore=vi.fn();isMinimized=()=>false;setTitle=vi.fn();
  }
  return {BrowserWindow:Window,session:{fromPartition:vi.fn(()=>{const partition={setPermissionRequestHandler:vi.fn(),setPermissionCheckHandler:vi.fn(),webRequest:{onBeforeRequest:vi.fn(),onHeadersReceived:vi.fn()},on:vi.fn()};mocked.partitions.push(partition);return partition;})}};
});
import {NotesPdfService} from '../../apps/desktop/src/main/notes/notes-pdf';
const document=():StudyNotesDocument=>({version:1,id:'a2cc0341-36fe-4ec7-9ae8-e2e36c71ad46',sessionId:'lesson',topic:'Gravity',createdAt:'2026-10-31T10:30:00.000Z',coverageHash:'a'.repeat(64),studiedSteps:1,content:{title:'Gravity notes',overview:'Mass attracts mass.',sections:[{title:'Attraction',evidenceIds:['heard'],explanation:'Attraction acts between masses.',keyPoints:[],definitions:[],equations:[],examples:[]}],recap:['Mass attracts mass.'],reviewQuestions:[]},visuals:[],modelMetadata:{providerId:'chatgpt',requestedModel:'fixture',completedAt:'2026-10-31T10:30:00.000Z'}});
const parent=()=>Object.assign(new EventEmitter(),{isDestroyed:()=>false});

beforeEach(()=>{mocked.windows=[];mocked.partitions=[];mocked.load=undefined;mocked.print=undefined;});
afterEach(()=>vi.useRealTimers());
describe('isolated notes PDF lifecycle',()=>{
  it('opens an immutable copy of verified PDF bytes without rereading a mutable filesystem path',async()=>{
    const service=new NotesPdfService({parent:parent() as any}),bytes=Buffer.from('%PDF-1.7\n% verified fixture\n%%EOF\n'),expected=Buffer.from(bytes);
    const opening=service.openBytes(bytes,'Verified notes');bytes.fill(0);await opening;
    const preview=mocked.windows[0],url=preview.loadURL.mock.calls[0][0] as string;
    expect(url).toMatch(/^data:application\/pdf;base64,/);expect(Buffer.from(url.split(',')[1],'base64')).toEqual(expected);expect(preview.loadFile).not.toHaveBeenCalled();
    const block=mocked.partitions[0].webRequest.onBeforeRequest.mock.calls[0][0],callback=vi.fn();
    block({url:'file:///C:/notes/changed.pdf'},callback);expect(callback).toHaveBeenLastCalledWith({cancel:true});
    block({url:'data:application/pdf;base64,dW5yZXZpZXdlZA=='},callback);expect(callback).toHaveBeenLastCalledWith({cancel:true});service.dispose();
  });
  it('prints A4 with backgrounds and page numbers in a hidden sandbox, then destroys the print window',async()=>{
    const service=new NotesPdfService({parent:parent() as any});
    const output=await service.render(document(),new AbortController().signal);
    expect(output.toString()).toBe('%PDF-fixture');const window=mocked.windows[0];
    expect(window.options).toMatchObject({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,nodeIntegrationInWorker:false,webviewTag:false,webSecurity:true}});
    expect(window.loadURL.mock.calls[0][0]).toMatch(/^data:text\/html/);
    expect(window.webContents.printToPDF).toHaveBeenCalledWith(expect.objectContaining({pageSize:'A4',printBackground:true,displayHeaderFooter:true,footerTemplate:expect.stringContaining('pageNumber')}));
    expect(window.destroy).toHaveBeenCalled();expect(mocked.partitions[0].setPermissionCheckHandler.mock.calls[0][0]()).toBe(false);
    const block=mocked.partitions[0].webRequest.onBeforeRequest.mock.calls[0][0],response=vi.fn();
    block({url:'https://evil.invalid/'},response);expect(response).toHaveBeenLastCalledWith({cancel:true});
    block({url:'file:///C:/private/other.txt'},response);expect(response).toHaveBeenLastCalledWith({cancel:true});service.dispose();
  });
  it('cancels stalled loading/printing promptly even if Electron ignores the abort',async()=>{
    for(const stage of ['load','print'] as const){
      const service=new NotesPdfService({parent:parent() as any});
      if(stage==='load')mocked.load=()=>new Promise<void>(()=>{});else mocked.print=()=>new Promise<Buffer>(()=>{});
      const controller=new AbortController(),pending=service.render(document(),controller.signal),check=expect(pending).rejects.toMatchObject({name:'AbortError'});
      await vi.waitFor(()=>expect(mocked.windows.at(-1)).toBeDefined());
      if(stage==='print')await vi.waitFor(()=>expect(mocked.windows.at(-1).webContents.printToPDF).toHaveBeenCalled());
      controller.abort();await check;expect(mocked.windows.at(-1).destroyed).toBe(true);service.dispose();mocked.load=undefined;mocked.print=undefined;
    }
  });
  it('bounds a renderer that never starts and never leaks its raw error',async()=>{
    vi.useFakeTimers();mocked.load=()=>new Promise(()=>{});const service=new NotesPdfService({parent:parent() as any,timeoutMs:20});
    const pending=service.render(document(),new AbortController().signal),check=expect(pending).rejects.toThrow(/timed out/i);await vi.advanceTimersByTimeAsync(21);await check;expect(mocked.windows[0].destroyed).toBe(true);service.dispose();
    mocked.load=async()=>{throw new Error('C:\\private\\sensitive-name');};const other=new NotesPdfService({parent:parent() as any});await expect(other.render(document(),new AbortController().signal)).rejects.toThrow(/^(?!.*sensitive-name).*PDF/i);other.dispose();
  });
  it('closes preview and print windows when the parent closes, rejects later work and prevents navigation',async()=>{
    const main=parent(),service=new NotesPdfService({parent:main as any});
    await service.open('C:\\notes\\registered.pdf','Gravity notes');const preview=mocked.windows[0];
    expect(preview.options.webPreferences).toMatchObject({plugins:true,sandbox:true,nodeIntegration:false});expect(preview.show).toHaveBeenCalled();
    const block=mocked.partitions[0].webRequest.onBeforeRequest.mock.calls[0][0],callback=vi.fn();
    block({url:'file:///C:/notes/other.pdf'},callback);expect(callback).toHaveBeenLastCalledWith({cancel:true});
    block({url:'https://evil.invalid/'},callback);expect(callback).toHaveBeenLastCalledWith({cancel:true});
    const prevented=vi.fn();preview.webContents.emit('will-navigate',{preventDefault:prevented},'https://evil.invalid/');expect(prevented).toHaveBeenCalled();
    main.emit('closed');expect(preview.destroyed).toBe(true);await expect(service.render(document(),new AbortController().signal)).rejects.toThrow(/closed/i);
  });
  it('rejects non-PDF/relative preview locations, reuses a registered open window and rejects invalid PDF output',async()=>{
    const service=new NotesPdfService({parent:parent() as any});
    await expect(service.open('https://evil.invalid/file.pdf','Notes')).rejects.toThrow(/PDF/i);await expect(service.open('relative.pdf','Notes')).rejects.toThrow(/PDF/i);
    await service.open('C:\\notes\\registered.pdf','Notes');await service.open('C:\\notes\\registered.pdf','Notes');expect(mocked.windows).toHaveLength(1);expect(mocked.windows[0].focus).toHaveBeenCalled();
    mocked.print=async()=>Buffer.from('not PDF');await expect(service.render(document(),new AbortController().signal)).rejects.toThrow(/PDF/i);service.dispose();
  });
});
