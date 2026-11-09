import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream,existsSync,mkdirSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { Readable } from 'node:stream';
import worker from '../dist/server/index.js';
import { localDatabase } from './local-db.js';
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
mkdirSync('.trip-data',{recursive:true,mode:0o700});
const DB = localDatabase('.trip-data/trip.sqlite');
const env={...process.env,DB};

const root = resolve('public');
const portFlag = process.argv.indexOf('--port');
const port = Number(portFlag < 0 ? process.env.PORT || 3000 : process.argv[portFlag + 1]);
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.webp':'image/webp','.png':'image/png','.mp4':'video/mp4','.ttf':'font/ttf'};
const ASSETS = {async fetch(request) {
  const url = new URL(request.url);
  const pathname = decodeURIComponent(url.pathname);
  const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!path.startsWith(root + sep)) return new Response('404', {status:404});
  try {
    const info = await stat(path);
    if (!info.isFile()) return new Response('404', {status:404});
    const headers = {'Content-Type':types[extname(path)] || 'text/plain','Accept-Ranges':'bytes','Content-Length':String(info.size)};
    if (request.method === 'HEAD') return new Response(null, {headers});
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('Range') || '');
    if (!range) return new Response(await readFile(path), {headers});
    const start = Number(range[1]);
    const end = range[2] ? Math.min(info.size - 1, Number(range[2])) : info.size - 1;
    if (start > end) return new Response(null, {status:416,headers:{'Content-Range':'bytes */' + info.size}});
    headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + info.size;
    headers['Content-Length'] = String(end - start + 1);
    return new Response(Readable.toWeb(createReadStream(path, {start, end})), {headers,status:206});
  } catch { return new Response('404', {status:404}); }
}};
createServer(async (incoming, outgoing) => {
  try {
    const origin = 'http://' + incoming.headers.host;
    const headers = new Headers(incoming.headers);
    headers.set('CF-Connecting-IP',incoming.socket.remoteAddress || 'local');
    const request = new Request(new URL(incoming.url, origin), {
      method:incoming.method, headers,
      ...(['GET','HEAD'].includes(incoming.method) ? {} : {body:Readable.toWeb(incoming), duplex:'half'})
    });
    const response = await worker.fetch(request, {...env,ASSETS});
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body).pipe(outgoing);
    else outgoing.end();
  } catch { outgoing.writeHead(500).end(); }
}).listen(port, '127.0.0.1');
