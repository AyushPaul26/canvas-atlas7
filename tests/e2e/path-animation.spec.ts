import {test,expect,_electron as electron,type ElectronApplication,type Page} from '@playwright/test';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';

const stats=(app:ElectronApplication)=>app.evaluate(()=>(globalThis as any).__atlasFixture.stats);
const pausedState=(app:ElectronApplication)=>app.evaluate(()=>{
  const checkpoint=(globalThis as any).__atlasFixture.checkpoints['session-1'];
  return checkpoint?{cursor:checkpoint.cursor,entity:checkpoint.visibleScene.find((entity:any)=>entity.id==='mass-b')}:null;
});
async function movingMass(page:Page){
  return page.locator('.canvas-stage .konvajs-content canvas').first().evaluate(canvas=>{
    const target=canvas as HTMLCanvasElement,context=target.getContext('2d')!,pixels=context.getImageData(0,0,target.width,target.height).data;
    let sumX=0,sumY=0,count=0,referenceX=0,referenceY=0,referenceCount=0,left=target.width,right=0;
    for(let index=0;index<pixels.length;index+=4){
      const point=index/4,x=point%target.width,y=Math.floor(point/target.width);
      if(Math.abs(pixels[index]-195)<4&&Math.abs(pixels[index+1]-233)<4&&Math.abs(pixels[index+2]-215)<4&&pixels[index+3]>250){sumX+=x;sumY+=y;count++;}
      if(Math.abs(pixels[index]-119)<4&&Math.abs(pixels[index+1]-117)<4&&Math.abs(pixels[index+2]-231)<4&&pixels[index+3]>250){referenceX+=x;referenceY+=y;referenceCount++;left=Math.min(left,x);right=Math.max(right,x);}
    }
    const bounds=target.getBoundingClientRect();
    return {x:bounds.left+(sumX/Math.max(1,count))*bounds.width/target.width,y:bounds.top+(sumY/Math.max(1,count))*bounds.height/target.height,count,relativeX:(sumX/Math.max(1,count)-referenceX/Math.max(1,referenceCount))/Math.max(1,right-left),relativePixelX:(sumX/Math.max(1,count)-referenceX/Math.max(1,referenceCount))*bounds.width/target.width,relativeY:(sumY/Math.max(1,count)-referenceY/Math.max(1,referenceCount))*bounds.height/target.height};
  });
}
test('a real rendered path follows PCM, freezes on Pause, resumes and replays without another model call',async()=>{
  test.setTimeout(60000);
  const root=resolve('.test-tmp/path-animation');await mkdir(root,{recursive:true});const directory=await mkdtemp(join(root,'native-'));
  const app=await electron.launch({args:[join(process.cwd(),'tests/fixtures/learning-shell.mjs')],env:{...process.env,ATLAS_FIXTURE_ROOT:directory}});
  try{
    await app.evaluate(()=>{(globalThis as any).__atlasFixture.motionPath=true;});
    const page=await app.firstWindow();await page.getByRole('button',{name:/Start learning/}).click();
    await page.getByLabel('What would you like to learn today?').fill('See a moving body follow a path');await page.getByRole('button',{name:'Create roadmap'}).click();
    await page.getByRole('button',{name:'Start Teaching'}).first().click();
    await expect.poll(async()=>(await movingMass(page)).count).toBeGreaterThan(20);
    const initial=await movingMass(page);
    // The original fixture tween changes only x. This y change proves that the
    // actual Konva-rendered object follows the new multi-segment path.
    await expect.poll(async()=>(await movingMass(page)).relativeY,{timeout:10000,intervals:[40]}).toBeLessThan(initial.relativeY-14);
    await page.getByRole('button',{name:'Pause teaching'}).click();await page.getByRole('button',{name:'Resume teaching'}).waitFor();
    // Resume is labeled immediately, before the async pause drains its final
    // accepted frame and persists the checkpoint. Wait for that actual boundary
    // and flush the compositor before sampling a frozen-pose baseline.
    await expect.poll(async()=>(await pausedState(app))?.cursor.chunkId).toBe('distance');
    const savedPause=await pausedState(app);await page.screenshot({path:join(root,'paused.png')});const paused=await movingMass(page);
    await page.waitForTimeout(250);const held=await movingMass(page),savedHeld=await pausedState(app);
    await writeFile(join(root,'freeze-measurement.json'),JSON.stringify({paused,held,savedPause,savedHeld},null,2));
    expect(savedHeld).toEqual(savedPause);
    expect(Math.hypot(held.relativePixelX-paused.relativePixelX,held.relativeY-paused.relativeY)).toBeLessThan(1);expect((await stats(app)).complete).toBe(0);
    await page.getByRole('button',{name:'Resume teaching'}).click();
    await expect.poll(async()=>{const position=await movingMass(page);return Math.hypot(position.x-paused.x,position.y-paused.y);},{intervals:[40]}).toBeGreaterThan(8);
    await page.screenshot({path:join(root,'moving.png')});await expect.poll(async()=>(await stats(app)).complete,{timeout:15000}).toBe(1);
    await page.getByRole('button',{name:'Replay',exact:true}).click();
    // The understanding-check rail may resize the board after completion. Use
    // its stationary reference mass to compare the same logical initial pose.
    await expect.poll(async()=>{const position=await movingMass(page);return Math.max(Math.abs(position.relativeX-initial.relativeX)/.15,Math.abs(position.relativeY)/2);},{intervals:[40]}).toBeLessThan(1);
    await expect.poll(async()=>(await movingMass(page)).relativeY,{timeout:10000,intervals:[40]}).toBeLessThan(initial.relativeY-14);
    await expect(page.getByRole('group',{name:'Teaching playback'}).getByText('Teaching step heard')).toBeVisible({timeout:15000});
    expect((await stats(app)).complete).toBe(1);expect((await stats(app)).starts).toBe(1);
  }finally{
    await app.close();const target=resolve(directory);if(target.startsWith(root+sep))await rm(target,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
});
