import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { syntheticPdf } from '../fixtures/documents/synthetic';

test('native study-material import extracts and displays real PDF pages locally, then survives restart', async () => {
  test.setTimeout(90000);
  const scratch = join(process.cwd(), '.test-tmp'); await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, 'document-desktop-'));
  const text = 'Double distance: one quarter force.';
  const formula = 'F = G m1 m2 / r^2.';
  const pdf = join(directory, 'gravity.pdf'); await writeFile(pdf, syntheticPdf([formula, text, ''], false, [1]));
  const executablePath = process.env.LIVING_CANVAS_PACKAGED_EXE;
  const launch = () => electron.launch({ executablePath, args: executablePath ? [] : [join(process.cwd(), 'apps/desktop/out/main/app.js')], env: { ...process.env, LIVING_CANVAS_USER_DATA: join(directory, 'profile') } });
  let app: ElectronApplication | undefined;
  const diagnostics: string[] = [];
  try {
    app = await launch(); app.on('window', window => { window.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') diagnostics.push(message.text()); }); window.on('pageerror', error => diagnostics.push(error.message)); }); let page = await app.firstWindow();
    await expect(page.getByRole('button', { name: 'Canvas Atlas home' })).toBeVisible();
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, pdf);
    const imported = await page.evaluate(() => (window as any).livingCanvas.importStudyMaterial({ jobId: 'e2e-import' }));
    expect(imported).toHaveLength(1);
    expect(imported[0], JSON.stringify({ imported, diagnostics })).toMatchObject({ status: 'partial', coverage: 2 / 3 });
    const ref = { documentId: imported[0].id, extractionVersion: imported[0].extractionVersion, sectionId: imported[0].pages[1].sectionIds[0], page: 2, start: 0, end: text.length };
    const excerpt = await page.evaluate(ref => (window as any).livingCanvas.getSourceExcerpt(ref), ref);
    expect(excerpt.text).toBe(text);
    const preview = await page.evaluate(ref => (window as any).livingCanvas.getSourcePreview(ref), ref);
    expect(preview.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(preview.page).toBe(2);
    const formulaRef = { ...ref, sectionId: imported[0].pages[0].sectionIds[0], page: 1, end: formula.length };
    expect((await page.evaluate(ref => (window as any).livingCanvas.getSourceExcerpt(ref), formulaRef)).text).toBe(formula);
    const figure = await page.evaluate(async ref => {
      const preview = await (window as any).livingCanvas.getSourcePreview(ref);
      const image = new Image(); image.src = preview.dataUrl; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let blue = 0; for (let index = 0; index < pixels.length; index += 4) if (pixels[index + 2] > 150 && pixels[index] < 100 && pixels[index + 1] < 120) blue++;
      return { width: image.width, height: image.height, blue };
    }, formulaRef);
    expect(figure.blue).toBeGreaterThan(100);
    expect(await page.evaluate(() => ({ require: typeof (globalThis as any).require, process: typeof (globalThis as any).process }))).toEqual({ require: 'undefined', process: 'undefined' });
    await app.close(); app = await launch(); page = await app.firstWindow();
    await expect(page.getByRole('button', { name: 'Canvas Atlas home' })).toBeVisible();
    expect((await page.evaluate(() => (window as any).livingCanvas.getDocuments()))[0].id).toBe(imported[0].id);
    expect((await page.evaluate(ref => (window as any).livingCanvas.getSourceExcerpt(ref), ref)).text).toBe(text);
    const reopenedPreview = await page.evaluate(ref => (window as any).livingCanvas.getSourcePreview(ref), ref);
    expect(reopenedPreview).toMatchObject({ page: 2, dataUrl: expect.stringMatching(/^data:image\/png;base64,/) });
  } finally { await app?.close().catch(() => {}); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
});
