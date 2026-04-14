import { createRequestHandler, installGlobals } from '@remix-run/node';
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import mime from 'mime';
import * as build from './build/server/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mode = process.env.NODE_ENV || 'production';
const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 5173);
const buildClientDir = path.resolve(__dirname, 'build', 'client');
const publicDir = path.resolve(__dirname, 'public');

installGlobals({
  nativeFetch: Boolean(build.future?.v3_singleFetch),
});

const handleRequest = createRequestHandler(build, mode);

function createLoadContext() {
  return {
    cloudflare: {
      env: process.env,
      ctx: {
        waitUntil() {},
        passThroughOnException() {},
      },
    },
  };
}

function toWebRequest(req, res) {
  const origin = `http://${req.headers.host || `${host}:${port}`}`;
  const url = new URL(req.url || '/', origin);
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  const controller = new AbortController();
  res.on('close', () => controller.abort());

  const init = {
    method: req.method,
    headers,
    signal: controller.signal,
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = Readable.toWeb(req);
    init.duplex = 'half';
  }

  return new Request(url, init);
}

function setResponseHeaders(res, response) {
  const setCookie = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];

  for (const [key, value] of response.headers.entries()) {
    if (key.toLowerCase() === 'set-cookie') {
      continue;
    }

    res.setHeader(key, value);
  }

  if (setCookie.length > 0) {
    res.setHeader('Set-Cookie', setCookie);
  }
}

function resolveStaticPath(baseDir, pathname) {
  const relativePath = pathname.replace(/^\/+/, '');

  if (!relativePath) {
    return null;
  }

  const resolved = path.resolve(baseDir, relativePath);

  if (!resolved.startsWith(baseDir)) {
    return null;
  }

  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    return null;
  }

  return resolved;
}

function tryServeStatic(req, res) {
  if (!req.url || (req.method !== 'GET' && req.method !== 'HEAD')) {
    return false;
  }

  const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
  const candidates = [resolveStaticPath(buildClientDir, url.pathname), resolveStaticPath(publicDir, url.pathname)];
  const filePath = candidates.find(Boolean);

  if (!filePath) {
    return false;
  }

  const type = mime.getType(filePath) || 'application/octet-stream';
  const isImmutableAsset = filePath.startsWith(path.join(buildClientDir, 'assets'));
  const cacheControl = isImmutableAsset ? 'public, max-age=31536000, immutable' : 'public, max-age=3600';

  res.statusCode = 200;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', cacheControl);

  if (req.method === 'HEAD') {
    res.end();
    return true;
  }

  createReadStream(filePath).pipe(res);
  return true;
}

const server = createServer(async (req, res) => {
  try {
    if (tryServeStatic(req, res)) {
      return;
    }

    const request = toWebRequest(req, res);
    const response = await handleRequest(request, createLoadContext());

    res.statusCode = response.status;
    setResponseHeaders(res, response);

    if (!response.body || req.method === 'HEAD') {
      res.end();
      return;
    }

    const bodyBuffer = Buffer.from(await response.arrayBuffer());
    res.end(bodyBuffer);
  } catch (error) {
    console.error('[node-server] request failed', error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Internal Server Error');
  }
});

server.listen(port, host, () => {
  console.log(`[node-server] listening on http://${host}:${port}`);
});
