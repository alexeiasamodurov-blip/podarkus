import { build } from 'esbuild';
import { readFile, mkdir } from 'node:fs/promises';

const config = JSON.parse(await readFile('auth-config.json', 'utf8'));
if (!['apiKey', 'authDomain', 'projectId', 'appId'].every(key => typeof config[key] === 'string' && config[key].trim())) {
  throw new Error('Firebase project is not connected. Fill the public web app configuration before building or publishing.');
}
await mkdir('assets', { recursive: true });
await build({
  entryPoints: ['src/auth.js'], bundle: true, minify: true,
  format: 'iife', target: ['es2020'], outfile: 'assets/auth.js',
  legalComments: 'eof', define: { 'PODARKUS_FIREBASE_CONFIG': JSON.stringify(config) }
});
const ai = JSON.parse(await readFile('ai-config.json', 'utf8'));
if (!/^https:\/\/podarkus-ai\.[a-z0-9-]+\.workers\.dev$/.test(ai.endpoint)) throw Error('Set the deployed Podarkus AI HTTPS endpoint before publishing');
await build({ entryPoints: ['src/ai.js'], bundle: true, minify: true, format: 'iife', target: ['es2020'], outfile: 'assets/ai.js',
  define: { PODARKUS_AI_ENDPOINT: JSON.stringify(ai.endpoint) }
});
