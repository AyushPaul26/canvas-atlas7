import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PlaybackCheckpoint, SceneEntity, TeachingBeat } from '@living-canvas/protocol';

const description = 'Two masses attract. Increasing their separation reduces the gravitational force.';
const narration = 'Objects with mass attract each other. Double the distance and the force falls to one quarter.';
type FixtureState = {
  spatial?: boolean;
  stats: { starts: number; complete: number; continues: number; audioRequests: string[] };
  accepted: Record<string, TeachingBeat>;
  checkpoints: Record<string, PlaybackCheckpoint>;
  sessions: { scene: SceneEntity[] }[];
};
type GraphicsProbe = {
  requests: number; blocked: number; contexts: number; drawCalls: number;
  version?: string; renderer?: string; contextLostEvents: { trusted: boolean }[];
};
const state = (app: ElectronApplication) => app.evaluate(() => (globalThis as typeof globalThis & { __atlasFixture: FixtureState }).__atlasFixture);
const probe = (page: Page) => page.evaluate(() => (window as typeof window & { __atlasGraphicsProbe: GraphicsProbe }).__atlasGraphicsProbe);

async function open(unavailable = false) {
  const root = join(process.cwd(), '.test-tmp'); await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'spatial-stage-'));
  const app = await electron.launch({ args: [join(process.cwd(), 'tests/fixtures/learning-shell.mjs')], env: { ...process.env, ATLAS_FIXTURE_ROOT: directory } });
  const page = await app.firstWindow();
  const consoleErrors: string[] = [], pageErrors: string[] = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  // Reload runs this before application code. Wrappers forward to native APIs;
  // no Three, canvas, geometry, audio, or presentation implementation is mocked.
  await page.addInitScript(({ unavailable }) => {
    const result: GraphicsProbe = { requests: 0, blocked: 0, contexts: 0, drawCalls: 0, contextLostEvents: [] };
    (window as typeof window & { __atlasGraphicsProbe: GraphicsProbe }).__atlasGraphicsProbe = result;
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...args: any[]) {
      const spatial = kind === 'webgl2' || kind === 'webgl' || kind === 'experimental-webgl';
      if (spatial) { result.requests++; if (unavailable) { result.blocked++; return null; } }
      const context = Reflect.apply(getContext, this, [kind, ...args]);
      if (spatial && context) {
        result.contexts++;
        result.version = context.getParameter(context.VERSION);
        result.renderer = context.getParameter(context.RENDERER);
      }
      return context;
    } as typeof getContext;
    // Count actual graphics submissions, rather than treating canvas presence as
    // proof that the production WebGL renderer drew geometry.
    if (typeof WebGL2RenderingContext !== 'undefined') {
      for (const method of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced'] as const) {
        const original = WebGL2RenderingContext.prototype[method];
        (WebGL2RenderingContext.prototype as any)[method] = function (...args: any[]) {
          result.drawCalls++; return Reflect.apply(original, this, args);
        };
      }
    }
    window.addEventListener('webglcontextlost', event => result.contextLostEvents.push({ trusted: event.isTrusted }), true);
  }, { unavailable });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Canvas Atlas home' })).toBeVisible();
  await app.evaluate(() => { (globalThis as typeof globalThis & { __atlasFixture: FixtureState }).__atlasFixture.spatial = true; });
  return { app, page, directory, consoleErrors, pageErrors };
}

async function close(app: ElectronApplication, directory: string) {
  const page = app.windows()[0];
  if (page && !page.isClosed()) {
    // Exercise the renderer save/readyToClose handshake before disconnecting
    // Playwright's inspector, avoiding Electron's debugger shutdown deadlock.
    await Promise.all([
      page.waitForEvent('close', { timeout: 15000 }),
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close()),
    ]);
  }
  await app.close();
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

async function start(page: Page) {
  await page.getByRole('button', { name: /Start learning/ }).click();
  await page.getByLabel('What would you like to learn today?').fill('Show gravitation in space');
  await page.getByRole('button', { name: 'Create roadmap' }).click();
  await page.getByRole('button', { name: 'Start Teaching' }).first().click();
}

async function verifyDiagramLayout(page: Page, tag: string) {
  const evidence = join(process.cwd(), '.test-tmp/visual-companion'); await mkdir(evidence, { recursive:true });
  const results = [];
  for (const [width, height] of [[1050,760],[1440,940]]) {
    await page.setViewportSize({ width,height });
    await page.waitForFunction(() => {
      const stage=document.querySelector('.canvas-stage'),canvas=stage?.querySelector('canvas');
      if(!stage||!canvas)return false;
      const a=stage.getBoundingClientRect(),b=canvas.getBoundingClientRect();
      return Math.abs(a.width-b.width)<1.1&&Math.abs(a.height-b.height)<1.1;
    },undefined,{timeout:10000});
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const geometry=await page.evaluate(() => {
      const stage=document.querySelector('.canvas-stage')!,canvas=stage.querySelector('canvas') as HTMLCanvasElement;
      const rect=(element:Element)=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
      const canvasBox=rect(canvas),stageBox=rect(stage),body=rect(document.querySelector('.lesson-body')!),footer=rect(document.querySelector('.lesson-bottom')!);
      const toolbar=rect(stage.querySelector('.canvas-toolbar')!),equationElement=stage.querySelector('.equations-layer .katex') as HTMLElement;
      const pixels=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;
      const masses=[{name:'first mass',rgb:[119,117,231]},{name:'second mass',rgb:[195,233,215]}].map(color=>{
        let left=canvas.width,top=canvas.height,right=0,bottom=0,count=0;
        for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
          const i=(y*canvas.width+x)*4;
          if(pixels[i+3]>200&&color.rgb.every((value,index)=>Math.abs(pixels[i+index]-value)<10)){count++;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
        }
        if(!count)return {name:color.name,count,box:null,unobscured:false};
        const box={x:canvasBox.x+left*canvasBox.width/canvas.width,y:canvasBox.y+top*canvasBox.height/canvas.height,right:canvasBox.x+right*canvasBox.width/canvas.width,bottom:canvasBox.y+bottom*canvasBox.height/canvas.height};
        const hit=document.elementFromPoint((box.x+box.right)/2,(box.y+box.bottom)/2);
        return {name:color.name,count,box,unobscured:Boolean(hit?.closest('.canvas-stage'))&&!hit?.closest('.canvas-toolbar')};
      });
      const equation=rect(equationElement),hit=document.elementFromPoint(equation.x+equation.width/2,equation.y+equation.height/2);
      return {viewport:{width:innerWidth,height:innerHeight},stage:stageBox,body,footer,question:rect(document.querySelector('#lesson-question')!),masses,equation:{...equation,fontSize:parseFloat(getComputedStyle(equationElement.parentElement!).fontSize),unobscured:Boolean(hit?.closest('.canvas-stage'))&&!hit?.closest('.canvas-toolbar'),overlapsToolbar:equation.x<toolbar.right&&equation.right>toolbar.x&&equation.y<toolbar.bottom&&equation.bottom>toolbar.y}};
    });
    results.push(geometry);
    await page.screenshot({path:join(evidence,`${tag}-${width}.png`)});
    await writeFile(join(evidence,`${tag}-geometry.json`),JSON.stringify(results,null,2));
    expect(geometry.stage.height).toBeGreaterThanOrEqual(200);
    expect(geometry.stage.y).toBeGreaterThanOrEqual(geometry.body.y-1);
    expect(geometry.stage.bottom).toBeLessThanOrEqual(Math.min(geometry.body.bottom,geometry.footer.y)+1);
    expect(geometry.question.bottom).toBeLessThanOrEqual(height+1);
    for(const mass of geometry.masses){
      expect(mass.count,`${mass.name} must have real rendered fill pixels`).toBeGreaterThan(100);
      expect(mass.unobscured,`${mass.name} must be unobscured`).toBe(true);
      expect(mass.box!.x).toBeGreaterThanOrEqual(geometry.stage.x);
      expect(mass.box!.right).toBeLessThanOrEqual(geometry.stage.right);
      expect(mass.box!.y).toBeGreaterThanOrEqual(geometry.stage.y);
      expect(mass.box!.bottom).toBeLessThanOrEqual(geometry.stage.bottom);
    }
    expect(geometry.equation.fontSize).toBeGreaterThanOrEqual(12);
    expect(geometry.equation.unobscured).toBe(true);expect(geometry.equation.overlapsToolbar).toBe(false);
    await page.getByLabel('Ask your teacher a question').fill('A draft question about distance');
    await expect(page.getByLabel('Ask your teacher a question')).toHaveValue('A draft question about distance');
    await page.getByLabel('Ask your teacher a question').clear();
  }
  await writeFile(join(evidence,`${tag}-geometry.json`),JSON.stringify(results,null,2));
}

async function verifySpatialControls(page: Page) {
  await page.getByRole('button',{name:'Pause teaching'}).click();
  for(const [width,height] of [[1050,760],[1440,940]]){
    await page.setViewportSize({width,height});
    const geometry=await page.evaluate(()=>{
      const rect=(element:Element)=>{const r=element.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,height:r.height};};
      const spatial=document.querySelector('[role="img"] canvas')!,body=document.querySelector('.lesson-body')!;
      const a=rect(spatial),b=rect(body),top=Math.max(a.y,b.y),bottom=Math.min(a.bottom,b.bottom);
      const hit=document.elementFromPoint((a.x+a.right)/2,(top+bottom)/2);
      return{spatial:a,visibleHeight:bottom-top,unobscured:hit===spatial,question:rect(document.querySelector('#lesson-question')!)};
    });
    expect(geometry.visibleHeight).toBeGreaterThanOrEqual(150);expect(geometry.unobscured).toBe(true);
    expect(geometry.question.bottom).toBeLessThanOrEqual(height+1);
    const resume=await page.getByRole('button',{name:'Resume teaching'}).boundingBox();expect(resume!.y+resume!.height).toBeLessThanOrEqual(height);
    await page.getByLabel('Ask your teacher a question').fill('Can you explain this spatial view?');
    await expect(page.getByLabel('Ask your teacher a question')).toHaveValue('Can you explain this spatial view?');
    await page.getByLabel('Ask your teacher a question').clear();
    await page.screenshot({path:join(process.cwd(),`.test-tmp/visual-companion/layout-spatial-${width}.png`)});
  }
  await page.getByRole('button',{name:'Resume teaching'}).click();
}

async function completeFromDiagram(app: ElectronApplication, page: Page) {
  await expect(page.locator('.visual-stage .konvajs-content canvas').first()).toBeVisible();
  await page.getByRole('button', { name: 'Resume teaching' }).click();
  await expect.poll(async () => (await state(app)).stats.complete, { timeout: 15000 }).toBe(1);
  const completed = await state(app), checkpoint = completed.checkpoints['session-1'];
  expect(checkpoint.completedChunkIds).toEqual(['attraction', 'distance']);
  expect(checkpoint.receipt).toMatchObject({ audioResult: 'completed', visualComplete: true, completedChunkIds: ['attraction', 'distance'] });
  expect(completed.stats.audioRequests).toEqual(expect.arrayContaining(['Objects with mass attract each other. ', 'Double the distance and the force falls to one quarter.']));
  expect(checkpoint.visibleScene.find(entity => entity.id === 'mass-b')?.x).toBe(760);
  expect(completed.stats.starts).toBe(1); expect(completed.stats.continues).toBe(0);
  await page.getByRole('button', { name: 'Toggle conversation' }).click();
  await expect(page.getByRole('complementary', { name: 'Lesson conversation' }).getByText(narration, { exact: true })).toBeVisible();
  await expect(page.getByText('What happens to force when distance doubles?', { exact: true })).toBeVisible();
}

test('production Three renderer draws native WebGL geometry and recovers context loss without false completion', async () => {
  // Includes native graphics recovery, replay, and pixel/occlusion checks at two sizes.
  test.setTimeout(90000);
  const fixture = await open(), { app, page, directory, consoleErrors, pageErrors } = fixture;
  try {
    await start(page);
    const spatial = page.getByRole('img', { name: description });
    await expect.poll(async () => await spatial.locator('canvas').count() ? 'webgl' : await page.getByRole('status').filter({ hasText: `Showing the diagram. ${description}` }).count() ? 'fallback' : 'pending').not.toBe('pending');
    const graphics = await probe(page);
    // A machine without WebGL cannot verify the real-graphics path. The separate
    // forced-unavailable case below still verifies production fallback behavior.
    test.skip(graphics.requests > 0 && graphics.contexts === 0, 'Native WebGL is unavailable on this Electron host.');
    await expect(spatial.locator('canvas')).toBeVisible();
    expect(graphics.version).toContain('WebGL 2'); expect(graphics.drawCalls).toBeGreaterThan(0);
    await expect(page.getByText('First mass · Second mass · Attraction', { exact: true })).toBeVisible();
    expect(Object.values((await state(app)).accepted)[0].spatialScene?.nodes.map(node => node.kind)).toEqual(['sphere', 'box', 'arrow']);
    expect((await state(app)).stats.complete).toBe(0);
    await verifySpatialControls(page);
    const lostBy = await spatial.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext('webgl2'); if (!context) throw new Error('Expected a native WebGL2 context');
      const extension = context.getExtension('WEBGL_lose_context');
      if (extension) { extension.loseContext(); return 'WEBGL_lose_context'; }
      canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })); return 'webglcontextlost event';
    });
    await expect(page.getByRole('status').filter({ hasText: `Showing the diagram. ${description}` })).toBeVisible();
    await expect(spatial).toHaveCount(0);
    await page.getByRole('button', { name: 'Pause teaching' }).click();
    const paused = await state(app);
    expect(paused.stats.complete).toBe(0); expect(paused.checkpoints['session-1'].receipt).toBeUndefined();
    await page.waitForTimeout(250); expect((await state(app)).stats.complete).toBe(0);
    const afterLoss = await probe(page);
    expect(afterLoss.contextLostEvents.length).toBeGreaterThan(0);
    if (lostBy === 'WEBGL_lose_context') expect(afterLoss.contextLostEvents.some(event => event.trusted)).toBe(true);
    await completeFromDiagram(app, page);
    await verifyDiagramLayout(page,'layout-context-loss');
    await page.getByRole('button', { name: 'Replay', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Teaching playback' }).getByText('Teaching step heard')).toBeVisible({ timeout: 15000 });
    expect((await state(app)).stats.complete).toBe(1);
    expect(consoleErrors).toEqual([]); expect(pageErrors).toEqual([]);
    const evidence = join(process.cwd(), '.test-tmp/visual-companion'); await mkdir(evidence, { recursive: true });
    await page.locator('.visual-stage .konvajs-content canvas').first().screenshot({ path: join(evidence, 'spatial-context-loss-diagram.png') });
    await page.screenshot({ path: join(evidence, 'spatial-context-loss-fallback.png'), fullPage: true });
    await writeFile(join(evidence, 'spatial-context-loss.json'), JSON.stringify({ graphics, afterLoss, lostBy, consoleErrors, pageErrors }, null, 2));
  } finally { await close(app, directory); }
});

test('WebGL unavailable before mount still presents the real 2D diagram and completes only after PCM', async () => {
  test.setTimeout(60000);
  const { app, page, directory, consoleErrors, pageErrors } = await open(true);
  try {
    await start(page);
    await expect(page.getByRole('status').filter({ hasText: `Showing the diagram. ${description}` })).toBeVisible();
    await expect(page.getByRole('img', { name: description })).toHaveCount(0);
    await page.getByRole('button', { name: 'Pause teaching' }).click();
    const graphics = await probe(page), paused = await state(app);
    expect(graphics.requests).toBeGreaterThan(0); expect(graphics.blocked).toBe(graphics.requests);
    expect(graphics.contexts).toBe(0); expect(graphics.drawCalls).toBe(0);
    expect(paused.stats.complete).toBe(0); expect(paused.checkpoints['session-1'].receipt).toBeUndefined();
    await page.waitForTimeout(250); expect((await state(app)).stats.complete).toBe(0);
    await completeFromDiagram(app, page);
    await verifyDiagramLayout(page,'layout-unavailable');
    // Three emits this expected diagnostic when its native context constructor
    // fails. Any unrelated renderer error or uncaught exception fails the test.
    expect(consoleErrors.filter(message => message !== 'THREE.WebGLRenderer: THREE.WebGLRenderer: Error creating WebGL context.')).toEqual([]);
    expect(pageErrors).toEqual([]);
    const evidence = join(process.cwd(), '.test-tmp/visual-companion'); await mkdir(evidence, { recursive: true });
    await page.locator('.visual-stage .konvajs-content canvas').first().screenshot({ path: join(evidence, 'spatial-unavailable-diagram.png') });
    await page.screenshot({ path: join(evidence, 'spatial-unavailable-fallback.png'), fullPage: true });
    await writeFile(join(evidence, 'spatial-unavailable.json'), JSON.stringify({ graphics, consoleErrors, pageErrors }, null, 2));
  } finally { await close(app, directory); }
});
