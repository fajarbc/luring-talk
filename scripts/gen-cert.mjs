import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const templatePath = path.join(repoRoot, 'openssl.conf');
const generatedConfigPath = path.join(repoRoot, '.openssl.generated.conf');
const keyPath = path.join(repoRoot, 'key.pem');
const certPath = path.join(repoRoot, 'cert.pem');

const getLanIPv4Addresses = () => {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const networkInterface of Object.values(interfaces)) {
    for (const address of networkInterface ?? []) {
      if (address.family === 'IPv4' && !address.internal) {
        addresses.push(address.address);
      }
    }
  }

  return Array.from(new Set(addresses));
};

const buildAltNames = (lanIPs) => {
  const entries = [
    'DNS.1 = localhost',
    'DNS.2 = *.local',
    'IP.1 = 127.0.0.1',
    ...lanIPs.map((ip, index) => `IP.${index + 2} = ${ip}`),
  ];

  return entries.join('\n');
};

const cleanupGeneratedConfig = () => {
  if (fs.existsSync(generatedConfigPath)) {
    fs.rmSync(generatedConfigPath);
  }
};

const lanIPs = getLanIPv4Addresses();
const opensslTemplate = fs.readFileSync(templatePath, 'utf8');
const resolvedConfig = opensslTemplate.replace('__ALT_NAMES__', buildAltNames(lanIPs));

fs.writeFileSync(generatedConfigPath, resolvedConfig, 'utf8');

console.log('🔐 Generating self-signed development certificate...');
console.log(`   SAN hosts: localhost, 127.0.0.1${lanIPs.length ? `, ${lanIPs.join(', ')}` : ''}`);

const result = spawnSync(
  'openssl',
  [
    'req',
    '-nodes',
    '-new',
    '-x509',
    '-keyout',
    keyPath,
    '-out',
    certPath,
    '-days',
    '365',
    '-config',
    generatedConfigPath,
    '-extensions',
    'v3_req',
  ],
  {
    cwd: repoRoot,
    stdio: 'inherit',
  },
);

cleanupGeneratedConfig();

if (result.error) {
  if (result.error.code === 'ENOENT') {
    console.error('\n❌ OpenSSL is not installed or not available on PATH.');
    console.error('   Install OpenSSL (or use mkcert), then rerun `npm run cert`.');
    console.error('   On Windows, Git Bash or WSL is the easiest way to get OpenSSL.\n');
  } else {
    console.error(`\n❌ Failed to run OpenSSL: ${result.error.message}\n`);
  }

  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`\n✅ Wrote ${path.basename(keyPath)} and ${path.basename(certPath)}.`);
console.log('   These files stay local because `*.pem` is gitignored.\n');
