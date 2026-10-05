import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const publicDirectory = join(projectRoot, 'public');
const expectedIcons = [
  { fileName: 'icon-192.png', size: 192 },
  { fileName: 'icon-512.png', size: 512 },
  { fileName: 'icon-512-maskable.png', size: 512 },
];
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

for (const { fileName, size } of expectedIcons) {
  const filePath = join(publicDirectory, fileName);
  const png = await readFile(filePath);
  const hasSignature = png.subarray(0, pngSignature.length).equals(pngSignature);
  const hasHeader = png.length >= 26 && png.toString('ascii', 12, 16) === 'IHDR';
  const width = hasHeader ? png.readUInt32BE(16) : 0;
  const height = hasHeader ? png.readUInt32BE(20) : 0;
  const bitDepth = hasHeader ? png[24] : 0;
  const colorType = hasHeader ? png[25] : 0;

  if (!hasSignature || !hasHeader || width !== size || height !== size || bitDepth !== 8 || colorType !== 6) {
    throw new Error(`${fileName} is not a valid ${size}x${size} RGBA PNG`);
  }
}

console.log(`Verified ${expectedIcons.length} PWA PNG icons`);
