import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, '..');
const errors = [];

async function readProjectFile(relativePath) {
  try {
    return await readFile(path.join(projectDirectory, relativePath), 'utf8');
  } catch (error) {
    errors.push(`Missing ${relativePath}: ${error.message}`);
    return '';
  }
}

function requireText(fileName, content, expected, description) {
  if (!content.includes(expected)) {
    errors.push(`${fileName} ${description}`);
  }
}

function forbidPattern(fileName, content, pattern, description) {
  if (pattern.test(content)) {
    errors.push(`${fileName} ${description}`);
  }
}

const files = Object.fromEntries(
  await Promise.all(
    [
      'index.html',
      'src/index.css',
      'src/index.tsx',
      'vite.config.ts',
      'package.json',
      'package-lock.json',
    ].map(async (fileName) => [fileName, await readProjectFile(fileName)]),
  ),
);

requireText('src/index.css', files['src/index.css'], '@import "tailwindcss";', 'must import Tailwind through the build-time CSS entry point.');
requireText('src/index.tsx', files['src/index.tsx'], "import './index.css';", 'must import the build-time CSS entry point.');
requireText('vite.config.ts', files['vite.config.ts'], "from '@tailwindcss/vite';", 'must load the Tailwind Vite plugin.');
requireText('vite.config.ts', files['vite.config.ts'], 'tailwindcss()', 'must enable the Tailwind Vite plugin.');

forbidPattern('index.html', files['index.html'], /cdn\.tailwindcss\.com/i, 'must not reference the Tailwind Play CDN.');
forbidPattern('index.html', files['index.html'], /<script[^>]*tailwind/i, 'must not load Tailwind through a runtime script.');
forbidPattern('index.html', files['index.html'], /tailwind\.config/i, 'must not define a runtime Tailwind configuration.');

try {
  const packageJson = JSON.parse(files['package.json']);
  const lockJson = JSON.parse(files['package-lock.json']);
  const lockRoot = lockJson.packages?.[''];

  for (const section of ['dependencies', 'devDependencies']) {
    for (const [name, version] of Object.entries(packageJson[section] ?? {})) {
      if (lockRoot?.[section]?.[name] !== version) {
        errors.push(`package-lock.json root ${section}.${name} is not synchronized with package.json.`);
      }
    }
  }

  requireText('package.json', JSON.stringify(packageJson), '"@tailwindcss/vite"', 'must declare @tailwindcss/vite.');
  requireText('package.json', JSON.stringify(packageJson), '"tailwindcss"', 'must declare tailwindcss.');
} catch (error) {
  errors.push(`Could not parse package metadata: ${error.message}`);
}

if (errors.length > 0) {
  console.error('Offline Tailwind verification failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Offline Tailwind verification passed.');
