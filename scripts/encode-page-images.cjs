// Asset encoding only: keep the existing artwork, crop and pixel dimensions.
// Maintenance: npm install --no-save --package-lock=false sharp@0.35.5
// Then: node scripts/encode-page-images.cjs
const sharp = require('sharp');
const { readFile, writeFile, mkdir } = require('node:fs/promises');
const { resolve } = require('node:path');
const { createHash } = require('node:crypto');

const root = resolve(__dirname, '..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

(async () => {
  const images = [];
  await mkdir(resolve(root, 'assets/page-images'), { recursive: true });
  for (const name of ['logo', 'banner', 'patent-hero-robot']) {
    const source = `assets/${name}.png`;
    const file = `assets/page-images/${name}.webp`;
    const input = await readFile(resolve(root, source));
    const output = await sharp(input).webp({ quality: 82, effort: 6 }).toBuffer();
    const { width, height } = await sharp(output).metadata();
    await writeFile(resolve(root, file), output);
    images.push({ source, source_sha256: sha256(input), file, sha256: sha256(output),
      width, height, bytes: output.length });
  }
  await writeFile(resolve(root, 'assets/page-images/manifest.json'),
    JSON.stringify({ encoder: `sharp ${sharp.versions.sharp}`, quality: 82, effort: 6, images }, null, 2) + '\n');
  console.log('Encoded existing page artwork without resizing. Run scripts/render-static-pages.mjs next.');
})().catch(error => { console.error(error); process.exitCode = 1; });
