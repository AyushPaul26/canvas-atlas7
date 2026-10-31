import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

async function fixture() {
  const root=join(process.cwd(),'.test-tmp');await mkdir(root,{recursive:true});const directory=await mkdtemp(join(root,'visual-journey-'));
  const app=await electron.launch({args:[join(process.cwd(),'tests/fixtures/learning-shell.mjs')],env:{...process.env,ATLAS_FIXTURE_ROOT:directory}});
  const page=await app.firstWindow();await expect(page.getByRole('button',{name:'Canvas Atlas home'})).toBeVisible();
  return {app,page,directory};
}
const stats=(app:ElectronApplication)=>app.evaluate(()=>(globalThis as any).__atlasFixture.stats);
test('gravitation roadmap gates teaching, cues follow real PCM playback, and replay does not advance twice',async()=>{
  test.setTimeout(60000);const {app,page,directory}=await fixture();
  try{
    await page.getByRole('button',{name:/Start learning/}).click();
    await page.getByLabel('What would you like to learn today?').fill('Teach me gravitation');
    await page.getByRole('button',{name:'Create roadmap'}).click();
    await expect(page.getByRole('region',{name:'Learning roadmap'})).toBeVisible();
    expect((await stats(app)).starts).toBe(0);
    await page.getByRole('button',{name:'Start Teaching'}).first().click();
    await page.getByRole('button',{name:'Pause teaching'}).click();
    const paused=await stats(app);await page.waitForTimeout(250);
    expect((await stats(app)).complete).toBe(paused.complete);
    await page.getByRole('button',{name:'Resume teaching'}).click();
    await expect.poll(async()=>(await stats(app)).complete,{timeout:15000}).toBe(1);
    await expect(page.getByText('What happens to force when distance doubles?',{exact:true})).toBeVisible();
    await page.screenshot({path:join(process.cwd(),'.test-tmp/visual-companion/teaching-desktop.png'),fullPage:true});
    await page.getByRole('button',{name:'Replay',exact:true}).click();
    await expect(page.getByRole('group',{name:'Teaching playback'}).getByText('Teaching step heard')).toBeVisible({timeout:15000});
    expect((await stats(app)).complete).toBe(1);expect((await stats(app)).starts).toBe(1);
    await page.getByLabel('Ask your teacher a question').fill('Could you show a simpler explanation?');
    await page.getByRole('button',{name:'Send question'}).click();
    await expect.poll(async()=>(await stats(app)).starts,{timeout:15000}).toBeGreaterThan(1);
    await page.setViewportSize({width:1050,height:760});
    await expect(page.getByRole('group',{name:'Teaching playback'})).toBeVisible();
    await page.screenshot({path:join(process.cwd(),'.test-tmp/visual-companion/teaching-compact.png'),fullPage:true});
  }finally{await app.close();await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
});
test('audio failure leaves the actual lesson incomplete and exposes retry',async()=>{
  const {app,page,directory}=await fixture();
  try{
    await app.evaluate(()=>{(globalThis as any).__atlasFixture.failAudio=true;});
    await page.getByRole('button',{name:/Start learning/}).click();await page.getByLabel('What would you like to learn today?').fill('Gravity');
    await page.getByRole('button',{name:'Create roadmap'}).click();await page.getByRole('button',{name:'Start Teaching'}).first().click();
    await expect(page.getByRole('button',{name:'Retry teaching'})).toBeVisible();expect((await stats(app)).complete).toBe(0);
  }finally{await app.close();await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
});
