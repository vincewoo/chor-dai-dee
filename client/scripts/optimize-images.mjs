// Recompresses the logo and PWA icons.
//
// The source art is flat-colour logo work exported as full 32-bit RGBA PNG, which
// is far larger than it needs to be: the logo was 466 KB and icon-512 was 478 KB,
// and every one of them is precached by the service worker. Palette quantisation
// (for the icons, which must stay PNG for manifest compatibility) and WebP (for
// the logo, which is only ever an <img> in our own markup) cut that dramatically
// with no visible difference at the sizes these are displayed at.
//
// Run with: npm run optimize-images
import sharp from 'sharp';
import { readdir, stat, rename, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = path.join(root, 'public', 'icons');
const logoPng = path.join(root, 'src', 'assets', 'chor-dai-dee-logo.png');
const logoWebp = path.join(root, 'src', 'assets', 'chor-dai-dee-logo.webp');

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

const sizeOf = async (file) => (await stat(file)).size;

let before = 0;
let after = 0;

// The largest place the logo renders is Lobby's `w-64` (256 px), so 512 keeps a
// 2x pixel ratio with room to spare.
async function optimizeLogo() {
  if (!existsSync(logoPng)) {
    console.log('logo: source PNG not found, skipping');
    return;
  }
  const originalSize = await sizeOf(logoPng);

  await sharp(logoPng)
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, effort: 6 })
    .toFile(logoWebp);

  const newSize = await sizeOf(logoWebp);
  before += originalSize;
  after += newSize;
  console.log(
    `logo  chor-dai-dee-logo.png -> .webp  ${kb(originalSize)} -> ${kb(newSize)} ` +
    `(-${(100 * (1 - newSize / originalSize)).toFixed(0)}%)`
  );

  // The PNG is no longer referenced once imports are switched to the WebP.
  await unlink(logoPng);
}

// Icons stay PNG: the web app manifest is the consumer and PNG is the only format
// every install surface reliably accepts.
async function optimizeIcons() {
  const files = (await readdir(iconsDir)).filter((f) => f.endsWith('.png'));

  for (const file of files.sort()) {
    const full = path.join(iconsDir, file);
    const originalSize = await sizeOf(full);
    const tmp = `${full}.tmp`;

    await sharp(full)
      .png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 })
      .toFile(tmp);

    const newSize = await sizeOf(tmp);
    if (newSize < originalSize) {
      await rename(tmp, full);
      before += originalSize;
      after += newSize;
      console.log(
        `icon  ${file.padEnd(28)} ${kb(originalSize)} -> ${kb(newSize)} ` +
        `(-${(100 * (1 - newSize / originalSize)).toFixed(0)}%)`
      );
    } else {
      await unlink(tmp);
      before += originalSize;
      after += originalSize;
      console.log(`icon  ${file.padEnd(28)} ${kb(originalSize)} (already optimal)`);
    }
  }
}

await optimizeLogo();
await optimizeIcons();

console.log(`\ntotal ${kb(before)} -> ${kb(after)} (-${(100 * (1 - after / before)).toFixed(0)}%)`);
