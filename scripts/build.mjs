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
