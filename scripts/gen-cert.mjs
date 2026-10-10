import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const keyPath = path.join(repoRoot, 'key.pem');
const certPath = path.join(repoRoot, 'cert.pem');

function detectOpenSsl() {
  const candidates = process.platform === 'win32'
    ? ['openssl.exe', 'openssl']
    : ['openssl'];

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['version'], { stdio: 'ignore' });
    if (result.status === 0) {
      return candidate;
    }
  }

  return null;
}

function isIpv4Address(entry) {
  return entry?.family === 'IPv4' || entry?.family === 4;
}

function getLanIpv4Addresses() {
  const interfaces = os.networkInterfaces();
  const addresses = new Set(['127.0.0.1']);

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (isIpv4Address(entry) && !entry.internal && entry.address) {
        addresses.add(entry.address);
      }
    }
  }

  return Array.from(addresses).sort();
}

function buildOpenSslConfig(addresses) {
  const altNames = [
    'DNS.1 = localhost',
    'DNS.2 = *.local',
    ...addresses.map((address, index) => `IP.${index + 1} = ${address}`),
  ].join('\n');

  return `[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_req
prompt = no

[req_distinguished_name]
C = US
ST = State
L = City
O = LuringTalk
CN = localhost

[v3_req]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
${altNames}
`;
}

const openssl = detectOpenSsl();

if (!openssl) {
  console.error('\n❌ OpenSSL was not found on this machine.');
  console.error('   Install OpenSSL (or use Git Bash on Windows if it already provides openssl.exe),');
  console.error('   then rerun `npm run cert`.');
  console.error('   If you want a nicer trust flow for local development, see the README note about mkcert.\n');
  process.exit(1);
}

const addresses = getLanIpv4Addresses();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luring-talk-cert-'));
const configPath = path.join(tempDir, 'openssl.conf');

fs.writeFileSync(configPath, buildOpenSslConfig(addresses), 'utf8');

const result = spawnSync(
  openssl,
  [
    'req',
    '-x509',
    '-nodes',
    '-newkey',
    'rsa:2048',
    '-sha256',
    '-days',
    '365',
    '-keyout',
    keyPath,
    '-out',
    certPath,
    '-config',
    configPath,
    '-extensions',
    'v3_req',
  ],
  { stdio: 'inherit' },
);

fs.rmSync(tempDir, { recursive: true, force: true });

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log('\n✅ Generated local development TLS files:');
console.log(`   - ${path.relative(repoRoot, keyPath)}`);
console.log(`   - ${path.relative(repoRoot, certPath)}`);
console.log('   SAN entries: localhost, *.local, and these IPv4 addresses:');
for (const address of addresses) {
  console.log(`   - ${address}`);
}
console.log('\nNext steps: npm run build && npm start\n');
