import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const publicDirectory = join(projectRoot, 'public');
const sourceIcon = join(publicDirectory, 'icon.svg');
const icons = [
  { fileName: 'icon-192.png', size: 192 },
  { fileName: 'icon-512.png', size: 512 },
  { fileName: 'icon-512-maskable.png', size: 512 },
];

const svg = await readFile(sourceIcon, 'utf8');

await mkdir(publicDirectory, { recursive: true });
for (const { fileName, size } of icons) {
  const renderer = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
  });
  await writeFile(join(publicDirectory, fileName), renderer.render().asPng());
}

console.log(`Generated ${icons.length} PWA icons from ${sourceIcon}`);
