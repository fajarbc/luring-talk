import express from 'express';
import https from 'https';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, 'dist');
const indexPath = path.join(distDir, 'index.html');

function normalizeBasePath(value) {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === '/') {
    return '/';
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  let withoutTrailingSlash = withLeadingSlash;
  while (withoutTrailingSlash.endsWith('/')) {
    withoutTrailingSlash = withoutTrailingSlash.slice(0, -1);
  }
  return `${withoutTrailingSlash}/`;
}

function detectBasePath() {
  if (process.env.VITE_BASE) {
    return normalizeBasePath(process.env.VITE_BASE);
  }

  try {
    const indexHtml = fs.readFileSync(indexPath, 'utf8');
    const assetAttribute = indexHtml.match(/(?:href|src)="[^"]*(?:manifest[.]json|icon[.]svg)"/)?.[0];
    const assetUrl = assetAttribute?.match(/"([^"]+)"/)?.[1];
    const assetBase = assetUrl?.slice(0, assetUrl.lastIndexOf('/') + 1);
    return normalizeBasePath(assetBase);
  } catch {
    return '/';
  }
}

function getLocalIPv4Addresses() {
  const addresses = [];

  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      const isIPv4 = entry.family === 'IPv4' || entry.family === 4;
      if (!isIPv4 || entry.internal || entry.address === '0.0.0.0') {
        continue;
      }

      if (!addresses.includes(entry.address)) {
        addresses.push(entry.address);
      }
    }
  }

  return addresses;
}

const basePath = detectBasePath();
const baseMountPath = basePath === '/' ? '/' : basePath.slice(0, -1);

const app = express();
const PORT = 8080;
const HTTP_PORT = 8081;

// SSL Certificate Configuration
const keyPath = path.join(__dirname, 'key.pem');
const certPath = path.join(__dirname, 'cert.pem');

let options = {};

try {
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    options = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    };
  } else {
    throw new Error('Certificates not found');
  }
} catch {
  console.error('\n❌ CRITICAL ERROR: SSL certificates (key.pem, cert.pem) are missing.');
  console.error('   Camera access requires HTTPS, so the server cannot start without them.');
  console.error('   Run `npm run cert` to generate fresh local development certificates.');
  console.error('   See README.md for mkcert and Windows notes.\n');
  process.exit(1);
}

// Redirect HTTP to HTTPS
const httpApp = express();
httpApp.use((req, res) => {
  // Redirect to the same host but on the HTTPS port
  const host = req.headers.host.split(':')[0];
  res.redirect(`https://${host}:${PORT}${req.url}`);
});

http.createServer(httpApp).listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`📡 HTTP Listener running on port ${HTTP_PORT} (Redirects to HTTPS)`);
});

app.get('/api/ip', (_req, res) => {
  res.json({ addresses: getLocalIPv4Addresses() });
});

// Serve the build at both its configured base and the root so local HTTPS works
// after either a normal build or a GitHub Pages build.
const staticFiles = express.static(distDir);
app.use(staticFiles);
if (baseMountPath !== '/') {
  app.use(baseMountPath, staticFiles);
}

// Handle SPA routing - return index.html for all non-static requests
app.get('*', (req, res) => {
  res.sendFile(indexPath);
});

// Start HTTPS Server
https.createServer(options, app).listen(PORT, '0.0.0.0', () => {
  const appPath = basePath === '/' ? '' : basePath;
  const networkAddresses = getLocalIPv4Addresses();

  console.log('\n🚀 LuringTalk Server Running!');
  console.log('   ----------------------------------------');
  console.log(`   Local:   https://localhost:${PORT}${appPath}`);
  if (networkAddresses.length) {
    networkAddresses.forEach((address, index) => {
      const label = index === 0 ? 'Network:' : '         ';
      console.log(`   ${label} https://${address}:${PORT}${appPath}`);
    });
  } else {
    console.log('   Network: No non-internal IPv4 addresses found');
  }
  console.log('   ----------------------------------------');
  console.log('   Note: You will see a security warning in the browser');
  console.log('   because the certificate is self-signed. This is expected.');
  console.log('   Click "Advanced" -> "Proceed to..." to access the app.\n');
});
