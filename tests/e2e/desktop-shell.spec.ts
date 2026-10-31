import {test,expect,_electron as electron,type ElectronApplication} from '@playwright/test';
import {join} from 'node:path';
import {mkdtempSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
test('desktop loads local UI with an isolated renderer and retains offline sessions',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'living-canvas-e2e-'));
  const launch=()=>electron.launch({args:[join(process.cwd(),'apps/desktop/out/main/app.js')],env:{...process.env,LIVING_CANVAS_USER_DATA:directory}});
  let app:ElectronApplication|undefined;
  try {
    app=await launch();let window=await app.firstWindow();
    await expect(window).toHaveTitle('Canvas Atlas');
    expect(await app.evaluate(({app})=>app.getName())).toBe('Canvas Atlas');
    await expect(window.getByRole('button',{name:'Canvas Atlas home'})).toBeVisible();
    expect(await window.evaluate(()=>({require:typeof (globalThis as any).require,process:typeof (globalThis as any).process}))).toEqual({require:'undefined',process:'undefined'});
    const lesson=await window.evaluate(()=>(window as any).livingCanvas.createSession('offline geometry'));
    const location=window.url();await window.evaluate(()=>{globalThis.location.href='https://example.com';});
    // Electron correctly cancels this navigation; Playwright still waits on its
    // abandoned navigation target for URL/locator assertions. Inspect the document.
    await expect.poll(()=>window.evaluate(()=>globalThis.location.href)).toBe(location);
    expect(await window.evaluate(()=>Boolean(document.querySelector('[aria-label="Canvas Atlas home"]')?.getBoundingClientRect().height))).toBe(true);
    await app.close();app=await launch();window=await app.firstWindow();
    await expect(window.getByRole('button',{name:'Canvas Atlas home'})).toBeVisible();
    await window.context().setOffline(true);
    expect(await window.evaluate(id=>(window as any).livingCanvas.loadSession(id),lesson.id)).toMatchObject({topic:'offline geometry'});
    await app.close();app=undefined;
  }finally{await app?.close().catch(()=>{});await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
});
