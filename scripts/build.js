import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/server', { recursive: true });
mkdirSync('dist/.openai', { recursive: true });
cpSync('public', 'dist/client', { recursive: true });
cpSync('.openai/hosting.json', 'dist/.openai/hosting.json');
cpSync('worker', 'dist/server', { recursive: true });
cpSync('public/catalog.js', 'dist/server/catalog.js');
cpSync('public/plan.js', 'dist/server/plan.js');

writeFileSync('dist/server/admin-page.js','export const adminPage = '+JSON.stringify(readFileSync('private/admin.html','utf8'))+';\n');
