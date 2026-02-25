/**
 * Analytics API for tracking page views of deployed applications.
 *
 * POST /api/analytics?app=<name>&path=<path>&sid=<sessionId>
 *   Records a page view event. Returns 204.
 *   CORS: allow all origins so the deployed fly.dev app can POST back.
 *
 * GET /api/analytics?app=<name>
 *   Returns aggregated analytics data as JSON.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('api.analytics');

/*
 * In-memory store as fallback (and primary store for serverless-style runtimes)
 * For Node.js runtime, we also persist to a temp file
 */
const inMemoryStore = new Map<string, PageViewEvent[]>();

interface PageViewEvent {
  ts: string; // ISO timestamp
  path: string;
  sid: string; // session id
}

/** CORS headers to allow the deployed fly.dev app to POST back */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function getDataFilePath(appName: string): Promise<string> {
  return import('node:os').then(({ tmpdir }) =>
    import('node:path').then(({ join }) =>
      join(tmpdir(), 'bolt-analytics', `${appName.replace(/[^a-z0-9-]/gi, '_')}.json`),
    ),
  );
}

async function readEvents(appName: string): Promise<PageViewEvent[]> {
  // Try memory first
  if (inMemoryStore.has(appName)) {
    return inMemoryStore.get(appName)!;
  }

  try {
    const { readFile } = await import('node:fs/promises');
    const filePath = await getDataFilePath(appName);
    const data = await readFile(filePath, 'utf-8');
    const events = JSON.parse(data) as PageViewEvent[];
    inMemoryStore.set(appName, events);

    return events;
  } catch {
    return [];
  }
}

async function appendEvent(appName: string, event: PageViewEvent): Promise<void> {
  const events = await readEvents(appName);
  events.push(event);
  inMemoryStore.set(appName, events);

  // Persist to disk when running in Node.js
  try {
    const { writeFile, mkdir } = await import('node:fs/promises');
    const filePath = await getDataFilePath(appName);
    const dir = filePath.substring(0, filePath.lastIndexOf('/'));
    await mkdir(dir.replace(/\\/g, '/'), { recursive: true });
    await writeFile(filePath, JSON.stringify(events), 'utf-8');
  } catch {
    // Disk persistence not available (edge runtime) — memory-only is fine
  }
}

function aggregateEvents(events: PageViewEvent[]) {
  const totalViews = events.length;
  const uniqueSessions = new Set(events.map((e) => e.sid)).size;

  // Top pages
  const pageCounts = new Map<string, number>();

  for (const e of events) {
    pageCounts.set(e.path, (pageCounts.get(e.path) || 0) + 1);
  }

  const topPages = Array.from(pageCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([path, views]) => ({ path, views }));

  // Views by hour (last 24 hours)
  const now = Date.now();
  const hourBuckets = new Map<string, number>();

  for (let i = 23; i >= 0; i--) {
    const d = new Date(now - i * 3600000);
    d.setMinutes(0, 0, 0);
    hourBuckets.set(d.toISOString(), 0);
  }

  for (const e of events) {
    const d = new Date(e.ts);
    d.setMinutes(0, 0, 0);

    const key = d.toISOString();

    if (hourBuckets.has(key)) {
      hourBuckets.set(key, (hourBuckets.get(key) || 0) + 1);
    }
  }

  const viewsByHour = Array.from(hourBuckets.entries()).map(([hour, views]) => ({ hour, views }));

  // Views by day (last 7 days)
  const dayBuckets = new Map<string, number>();

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now - i * 86400000);
    d.setHours(0, 0, 0, 0);
    dayBuckets.set(d.toISOString().slice(0, 10), 0);
  }

  for (const e of events) {
    const key = e.ts.slice(0, 10);

    if (dayBuckets.has(key)) {
      dayBuckets.set(key, (dayBuckets.get(key) || 0) + 1);
    }
  }

  const viewsByDay = Array.from(dayBuckets.entries()).map(([day, views]) => ({ day, views }));

  return { totalViews, uniqueSessions, topPages, viewsByHour, viewsByDay };
}

/** Handle CORS preflight */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const appName = url.searchParams.get('app');

  if (!appName) {
    return new Response(JSON.stringify({ error: 'Missing app parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  try {
    const events = await readEvents(appName);
    const data = aggregateEvents(events);

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  } catch (error) {
    logger.error('Failed to read analytics:', error);
    return new Response(JSON.stringify({ error: 'Failed to read analytics' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }
}

/** Record a page view event */
export async function action({ request }: ActionFunctionArgs) {
  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS },
    });
  }

  const url = new URL(request.url);
  const appName = url.searchParams.get('app');
  const pagePath = url.searchParams.get('path') || '/';
  const sid = url.searchParams.get('sid') || 'unknown';

  if (!appName) {
    return new Response(JSON.stringify({ error: 'Missing app parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  try {
    const event: PageViewEvent = {
      ts: new Date().toISOString(),
      path: pagePath,
      sid,
    };
    await appendEvent(appName, event);

    return new Response(null, { status: 204, headers: CORS_HEADERS });
  } catch (error) {
    logger.error('Failed to record analytics event:', error);
    return new Response(JSON.stringify({ error: 'Failed to record event' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }
}
