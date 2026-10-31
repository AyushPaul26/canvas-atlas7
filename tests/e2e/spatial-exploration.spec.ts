import {test,expect,_electron as electron,type ElectronApplication,type Page} from '@playwright/test';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';

const description='Two masses attract. Increasing their separation reduces the gravitational force.';
const studyState=(app:ElectronApplication)=>app.evaluate(()=>{
  const fixture=(globalThis as any).__atlasFixture;
  return {starts:fixture.stats.starts,complete:fixture.stats.complete,checkpoint:fixture.checkpoints['session-1'],spatial:Object.values(fixture.accepted).map((beat:any)=>beat.spatialScene)};
});
const labelPose=(page:Page)=>page.locator('.spatial-view-label[data-node-id="spatial-target"]').evaluate(element=>{const width=element.closest('.spatial-view-viewport')!.clientWidth,height=element.closest('.spatial-view-viewport')!.clientHeight,x=parseFloat((element as HTMLElement).style.left),y=parseFloat((element as HTMLElement).style.top);return {x,y,normalizedX:(x-width/2)/height,normalizedY:(y-height/2)/height,hidden:(element as HTMLElement).hidden};});
async function start(reduced:boolean){
  const root=resolve('.test-tmp/visual-refinement');await mkdir(root,{recursive:true});const directory=await mkdtemp(join(root,'spatial-'));
  const app=await electron.launch({args:[join(process.cwd(),'tests/fixtures/learning-shell.mjs')],env:{...process.env,ATLAS_FIXTURE_ROOT:directory}});
  try{
    const page=await app.firstWindow();await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});
    await page.addInitScript(()=>{
      (window as any).__atlasSpatialProof={draws:0,contexts:0};
      const getContext=HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,kind:string,...args:any[]){const result=Reflect.apply(getContext,this,[kind,...args]);if((kind==='webgl2'||kind==='webgl')&&result)(window as any).__atlasSpatialProof.contexts++;return result;} as typeof getContext;
      for(const method of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced'] as const){const original=WebGL2RenderingContext.prototype[method];(WebGL2RenderingContext.prototype as any)[method]=function(...args:any[]){(window as any).__atlasSpatialProof.draws++;return Reflect.apply(original,this,args);};}
    });
    await page.reload();await app.evaluate(()=>{(globalThis as any).__atlasFixture.spatial=true;});
    await page.getByRole('button',{name:/Start learning/}).click();await page.getByLabel('What would you like to learn today?').fill('Explore a 3D model of gravitation');
    await page.getByRole('button',{name:'Create roadmap'}).click();await page.getByRole('button',{name:'Start Teaching'}).first().click();
    await expect(page.getByRole('img',{name:description}).locator('canvas')).toBeVisible();
    return {app,page,root,directory};
  }catch(error){await app.close();throw error;}
}
async function close(app:ElectronApplication,directory:string,root:string){
  const page=app.windows()[0];if(page&&!page.isClosed())await Promise.all([page.waitForEvent('close',{timeout:15000}),app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]?.close())]);
  await app.close();const target=resolve(directory);if(target.startsWith(root+sep))await rm(target,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
test('native 3D exploration rotates actual graphics only while paused and preserves accepted lesson state',async()=>{
  test.setTimeout(60000);const {app,page,root,directory}=await start(false);
  try{
    const rotate=page.getByRole('button',{name:'Rotate view left'});await expect(rotate).toBeDisabled();
    await expect(page.getByText('Pause teaching to rotate and zoom.')).toBeVisible();
    await expect.poll(()=>page.evaluate(()=>(window as any).__atlasSpatialProof.draws)).toBeGreaterThan(0);
    await page.getByRole('button',{name:'Pause teaching'}).press('Enter');await expect(rotate).toBeEnabled();
    const before=await studyState(app),canvas=page.getByRole('img',{name:description}).locator('canvas');
    await canvas.scrollIntoViewIfNeeded();const image=await canvas.screenshot(),teacher=await labelPose(page);expect(teacher.hidden).toBe(false);
    const layoutFrames=await canvas.evaluate(async element=>{
      const frames:Array<{diagram:number;stage:number;canvas:number}>=[];
      for(let frame=0;frame<8;frame++){
        await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
        frames.push({diagram:element.closest('.math-explorer-diagram')!.getBoundingClientRect().width,stage:element.closest('.visual-stage')!.getBoundingClientRect().width,canvas:element.getBoundingClientRect().width});
      }return frames;
    });
    await writeFile(join(root,'spatial-width-stability.json'),JSON.stringify(layoutFrames,null,2));
    for(const frame of layoutFrames){expect(frame.stage).toBeLessThanOrEqual(frame.diagram+.1);expect(frame.canvas).toBeLessThanOrEqual(frame.stage+.1);}
    expect(Math.max(...layoutFrames.map(frame=>frame.stage))-Math.min(...layoutFrames.map(frame=>frame.stage))).toBeLessThan(.25);
    expect(Math.max(...layoutFrames.map(frame=>frame.canvas))-Math.min(...layoutFrames.map(frame=>frame.canvas))).toBeLessThan(.25);
    const surface=await canvas.evaluate(element=>{const viewport=element.getBoundingClientRect(),card=element.closest('.spatial-view-card')!.getBoundingClientRect(),body=element.closest('.lesson-body')!.getBoundingClientRect();return {height:viewport.height,cardHeight:card.height,visibleHeight:Math.min(viewport.bottom,card.bottom,body.bottom)-Math.max(viewport.top,card.top,body.top)};});
    expect(surface.height).toBeGreaterThanOrEqual(200);expect(surface.cardHeight).toBeGreaterThan(surface.height);expect(surface.visibleHeight).toBeGreaterThanOrEqual(150);
    const box=await canvas.boundingBox();
    await page.mouse.move(box!.x+box!.width*.5,box!.y+box!.height*.45);await page.mouse.down();await page.mouse.move(box!.x+box!.width*.65,box!.y+box!.height*.55,{steps:6});await page.mouse.up();
    await expect.poll(async()=>{const point=await labelPose(page);return Math.hypot(point.x-teacher.x,point.y-teacher.y);}).toBeGreaterThan(5);
    expect((await canvas.screenshot()).equals(image)).toBe(false);const dragged=await labelPose(page);
    await page.getByRole('group',{name:'3D exploration'}).focus();await page.keyboard.press('ArrowUp');
    await expect.poll(async()=>{const point=await labelPose(page);return Math.hypot(point.x-dragged.x,point.y-dragged.y);}).toBeGreaterThan(2);
    await page.screenshot({path:join(root,'spatial-explored.png')});expect(await studyState(app)).toEqual(before);
    await page.getByRole('button',{name:'Reset 3D view'}).click();const reset=await labelPose(page);expect(reset.normalizedX).toBeCloseTo(teacher.normalizedX,4);expect(reset.normalizedY).toBeCloseTo(teacher.normalizedY,4);
    await rotate.click();await page.getByRole('button',{name:'Resume teaching'}).press('Enter');await expect(rotate).toBeDisabled();
    await expect.poll(async()=>{const point=await labelPose(page);return Math.hypot(point.normalizedX-teacher.normalizedX,point.normalizedY-teacher.normalizedY);}).toBeLessThan(.001);
    await writeFile(join(root,'spatial-interaction-proof.json'),JSON.stringify({teacher,dragged,reset,surface,graphics:await page.evaluate(()=>(window as any).__atlasSpatialProof)},null,2));
  }finally{await close(app,directory,root);}
});
test('native reduced-motion camera input remains direct and compact playback/questions stay reachable',async()=>{
  test.setTimeout(60000);const {app,page,root,directory}=await start(true);
  try{
    await page.getByRole('button',{name:'Pause teaching'}).press('Enter');await expect(page.getByRole('button',{name:'Rotate view right'})).toBeEnabled();
    const hint=page.getByText('Drag to rotate · Scroll to zoom · Arrow keys also work.');await expect(hint).toHaveCSS('opacity','1');
    expect(await hint.evaluate(element=>element.getAnimations().some(animation=>animation.playState==='running'))).toBe(false);
    await page.getByRole('group',{name:'3D exploration'}).focus();await page.keyboard.press('ArrowRight');const moved=await labelPose(page);await page.waitForTimeout(200);expect(await labelPose(page)).toEqual(moved);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]?.setSize(1000,680));
    await expect.poll(()=>page.evaluate(()=>innerWidth)).toBeLessThanOrEqual(1000);
    const layout=await page.evaluate(()=>{const rect=(element:Element)=>{const bounds=element.getBoundingClientRect();return {top:bounds.top,bottom:bounds.bottom};};return {height:innerHeight,question:rect(document.querySelector('#lesson-question')!),footer:rect(document.querySelector('.lesson-bottom')!)};});
    expect(layout.question.bottom).toBeLessThanOrEqual(layout.height);expect(layout.footer.bottom).toBeLessThanOrEqual(layout.height);
    await expect(page.getByRole('button',{name:'Resume teaching'})).toBeVisible();await page.screenshot({path:join(root,'spatial-compact-reduced.png')});
    await writeFile(join(root,'spatial-compact-layout.json'),JSON.stringify(layout,null,2));
  }finally{await close(app,directory,root);}
});
