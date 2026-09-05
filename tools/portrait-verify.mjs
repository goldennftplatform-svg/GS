// Run with localhost:3000 serving the game: node tools/portrait-verify.mjs
// Requires puppeteer-core and Edge; screenshots go outside the workspace.
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const executablePath = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
const parent = process.env.TEMP;
assert(parent && existsSync(parent), 'An existing TEMP directory is required');
const output = join(parent, 'opencode', 'skullbond-portraits');
mkdirSync(output, { recursive: true });
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const [width, height] of [[1440, 900], [390, 844], [320, 740]]) {
    await page.setViewport({ width, height });
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
    await page.evaluate(() => document.fonts.ready);
    assert(await page.$eval('.boot-art', image => image.complete && image.naturalWidth === 816));
    await page.screenshot({ path: join(output, `${width}-boot.png`) });
    await page.click('#toSelectBtn');
    await page.waitForSelector('#selectScreen:not(.hidden)');
    await page.waitForSelector('.agent-card');
    const portraits = await page.evaluate(async () => {
      const { AGENTS } = await import('/js/roster.js');
      const results = [];
      for (const [index, agent] of AGENTS.entries()) {
        document.querySelectorAll('.agent-card')[index].click();
        const image = new Image();
        image.src = agent.portrait;
        await image.decode();
        const thumb = document.querySelectorAll('.thumb')[index];
        results.push({
          name: agent.name, kit: agent.kit,
          ratio: image.naturalWidth / image.naturalHeight,
          framed: getComputedStyle(thumb).backgroundSize === 'contain',
          unfiltered: getComputedStyle(thumb).filter === 'none',
          dossier: document.querySelector('#dossierArt').style.backgroundImage.includes(agent.portrait),
        });
      }
      document.querySelector('.agent-card').click();
      return results;
    });
    assert.equal(portraits.length, 6);
    for (const portrait of portraits) {
      assert.equal(portrait.kit, 'RAY GUN');
      assert.equal(portrait.ratio, 0.75);
      assert(portrait.framed && portrait.unfiltered && portrait.dossier, portrait.name);
    }
    const overflow = await page.evaluate(() => ['boot', 'selectScreen'].map(id => {
      const element = document.getElementById(id);
      return element.scrollWidth > element.clientWidth;
    }));
    assert(!overflow.some(Boolean), `Horizontal overflow at ${width}px`);
    await page.screenshot({ path: join(output, `${width}-select.png`) });
    await page.$eval('#dossier', element => element.scrollIntoView());
    await page.screenshot({ path: join(output, `${width}-dossier.png`) });
    console.log(`${width}x${height}: six portraits decoded, correctly mapped, contained, unfiltered; RAY GUN kits; no horizontal overflow`);
  }
  assert.deepEqual(errors, [], 'Browser page errors');
  console.log(`Screenshots: ${output}`);
} finally {
  await browser.close();
}
