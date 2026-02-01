const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, 'dist', 'index.html');
const base = '/luring-talk/';

console.log('Fixing paths in:', indexPath);

if (fs.existsSync(indexPath)) {
  let html = fs.readFileSync(indexPath, 'utf-8');
  console.log('Before: contains /assets/', html.includes('/assets/'));
  
  html = html.replace(/href="\/(?!luring-talk)/g, `href="${base}`)
             .replace(/src="\/(?!luring-talk)/g, `src="${base}`);
  
  console.log('After: contains /luring-talk/assets', html.includes('/luring-talk/assets'));
  fs.writeFileSync(indexPath, html);
  console.log('✓ Paths fixed successfully');
} else {
  console.error('ERROR: dist/index.html not found');
  process.exit(1);
}
