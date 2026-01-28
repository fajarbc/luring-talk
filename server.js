import express from 'express';
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 8080;
const HTTP_PORT = 8081;

// SSL Certificate Configuration
// You must generate these files using openssl (see README.md)
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
} catch (e) {
  console.error('\n❌ CRITICAL ERROR: SSL Certificates (key.pem, cert.pem) not found.');
  console.error('   getUserMedia requires HTTPS. The server cannot start without SSL.');
  console.error('   Please run the openssl command found in README.md\n');
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

// Serve static files from the build directory
app.use(express.static(path.join(__dirname, 'dist')));

// Handle SPA routing - return index.html for all non-static requests
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Start HTTPS Server
https.createServer(options, app).listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 LuringTalk Server Running!`);
  console.log(`   ----------------------------------------`);
  console.log(`   Local:   https://localhost:${PORT}`);
  console.log(`   Network: https://<YOUR_IP_ADDRESS>:${PORT}`);
  console.log(`   ----------------------------------------`);
  console.log(`   Note: You will see a security warning in the browser`);
  console.log(`   because the certificate is self-signed. This is expected.`);
  console.log(`   Click "Advanced" -> "Proceed to..." to access the app.\n`);
});