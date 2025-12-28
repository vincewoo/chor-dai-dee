import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const svgPath = path.join(__dirname, 'public', 'app-icon.svg');
const iconsDir = path.join(__dirname, 'public', 'icons');

// Ensure icons directory exists
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

async function generateIcons() {
  console.log('Generating PWA icons...');

  for (const size of sizes) {
    const outputPath = path.join(iconsDir, `icon-${size}x${size}.png`);

    await sharp(svgPath)
      .resize(size, size)
      .png()
      .toFile(outputPath);

    console.log(`✓ Generated ${size}x${size} icon`);
  }

  // Generate maskable icons (with safe zone padding)
  const maskableSizes = [192, 512];
  for (const size of maskableSizes) {
    const outputPath = path.join(iconsDir, `icon-${size}x${size}-maskable.png`);

    // For maskable icons, we need to add padding (20% safe zone)
    const paddedSize = Math.floor(size * 0.8);
    const padding = Math.floor((size - paddedSize) / 2);

    await sharp(svgPath)
      .resize(paddedSize, paddedSize)
      .extend({
        top: padding,
        bottom: padding,
        left: padding,
        right: padding,
        background: { r: 30, g: 41, b: 59, alpha: 1 } // #1e293b
      })
      .png()
      .toFile(outputPath);

    console.log(`✓ Generated ${size}x${size} maskable icon`);
  }

  console.log('All icons generated successfully!');
}

generateIcons().catch(console.error);
