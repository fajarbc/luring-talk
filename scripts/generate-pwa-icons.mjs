import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const publicDirectory = join(projectRoot, 'public');
const icons = [
  { fileName: 'icon-192.png', size: 192, maskable: false },
  { fileName: 'icon-512.png', size: 512, maskable: false },
  { fileName: 'icon-512-maskable.png', size: 512, maskable: true },
];

const background = [10, 10, 10];
const cyan = [0, 240, 255];
const magenta = [255, 0, 153];
const green = [57, 255, 20];

const clamp = (value) => Math.max(0, Math.min(1, value));

function blendPixel(pixels, size, x, y, color, alpha) {
  if (x < 0 || y < 0 || x >= size || y >= size || alpha <= 0) return;

  const index = (y * size + x) * 4;
  const inverse = 1 - alpha;
  pixels[index] = Math.round(pixels[index] * inverse + color[0] * alpha);
  pixels[index + 1] = Math.round(pixels[index + 1] * inverse + color[1] * alpha);
  pixels[index + 2] = Math.round(pixels[index + 2] * inverse + color[2] * alpha);
  pixels[index + 3] = 255;
}

function pointToSegmentDistance(x, y, startX, startY, endX, endY) {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  const projection = lengthSquared === 0
    ? 0
    : clamp(((x - startX) * deltaX + (y - startY) * deltaY) / lengthSquared);
  const closestX = startX + projection * deltaX;
  const closestY = startY + projection * deltaY;
  return Math.hypot(x - closestX, y - closestY);
}

function drawCircle(pixels, size, centerX, centerY, radius, strokeWidth, color, alpha = 1) {
  const padding = strokeWidth / 2 + 1;
  const minX = Math.max(0, Math.floor(centerX - radius - padding));
  const maxX = Math.min(size - 1, Math.ceil(centerX + radius + padding));
  const minY = Math.max(0, Math.floor(centerY - radius - padding));
  const maxY = Math.min(size - 1, Math.ceil(centerY + radius + padding));
  const halfStroke = strokeWidth / 2;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distance = Math.abs(Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY) - radius);
      const coverage = clamp(halfStroke + 0.75 - distance);
      blendPixel(pixels, size, x, y, color, alpha * coverage);
    }
  }
}

function drawLine(pixels, size, startX, startY, endX, endY, strokeWidth, color) {
  const padding = strokeWidth / 2 + 1;
  const minX = Math.max(0, Math.floor(Math.min(startX, endX) - padding));
  const maxX = Math.min(size - 1, Math.ceil(Math.max(startX, endX) + padding));
  const minY = Math.max(0, Math.floor(Math.min(startY, endY) - padding));
  const maxY = Math.min(size - 1, Math.ceil(Math.max(startY, endY) + padding));
  const halfStroke = strokeWidth / 2;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distance = pointToSegmentDistance(x + 0.5, y + 0.5, startX, startY, endX, endY);
      const coverage = clamp(halfStroke + 0.75 - distance);
      blendPixel(pixels, size, x, y, color, coverage);
    }
  }
}

function encodeChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;

  const stride = size * 4;
  const scanlines = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (stride + 1);
    scanlines[rowStart] = 0;
    pixels.copy(scanlines, rowStart + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    encodeChunk('IHDR', header),
    encodeChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    encodeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function renderIcon(size, maskable) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = background[0];
    pixels[index + 1] = background[1];
    pixels[index + 2] = background[2];
    pixels[index + 3] = 255;
  }

  const scale = size / 512;
  const center = size / 2;
  const outerRadius = (maskable ? 190 : 200) * scale;
  drawCircle(pixels, size, center, center, 180 * scale, 20 * scale, cyan);
  drawCircle(pixels, size, center, center, 140 * scale, 15 * scale, magenta, 0.8);
  drawLine(pixels, size, center, 160 * scale, center, 352 * scale, 20 * scale, green);
  drawLine(pixels, size, 160 * scale, center, 352 * scale, center, 20 * scale, green);
  drawCircle(pixels, size, center, center, outerRadius, 4 * scale, cyan, 0.3);

  return encodePng(size, pixels);
}

await mkdir(publicDirectory, { recursive: true });
for (const icon of icons) {
  await writeFile(join(publicDirectory, icon.fileName), renderIcon(icon.size, icon.maskable));
}

console.log(`Generated ${icons.length} PWA icons in ${publicDirectory}`);
