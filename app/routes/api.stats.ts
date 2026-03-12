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

const logger = createScopedLogger('api.stats');

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

const ANALYTICS_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, ngrok-skip-browser-warning, Accept, X-Requested-With',
  'Access-Control-Max-Age': '86400',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Timing-Allow-Origin': '*',
};

function getCorsHeaders(_request: Request) {
  return ANALYTICS_CORS_HEADERS;
}

async function getDataFilePath(appName: string): Promise<string> {
  const os = await import('node:os');
  const path = await import('node:path');

  return path.join(os.tmpdir(), 'bolt-analytics', `${appName.replace(/[^a-z0-9-]/gi, '_')}.json`);
}

async function readEvents(appName: string): Promise<PageViewEvent[]> {
  // Use memory cache for performance
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
    const path = await import('node:path');
    const filePath = await getDataFilePath(appName);
    const dir = path.dirname(filePath);
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, JSON.stringify(events), 'utf-8');

    // Clear memory store so next read forces a fresh disk capture
    inMemoryStore.delete(appName);
    console.log(`[Analytics] Persisted event for ${appName} to ${filePath}`);
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

/** Handle stats fetching or record a view via image beacon */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  console.log(`[Analytics] Request received: ${request.method} ${url.pathname}${url.search}`);

  const corsHeaders = getCorsHeaders(request);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const appName = url.searchParams.get('app');

  if (!appName) {
    return new Response(JSON.stringify({ error: 'Missing app parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  // Check if this is a tracking request (beacon)
  const isBeacon = url.searchParams.has('path') || url.searchParams.has('sid');

  if (isBeacon) {
    const pagePath = url.searchParams.get('path') || '/';
    const sid = url.searchParams.get('sid') || 'unknown-' + Math.random().toString(36).slice(2, 7);

    try {
      const event: PageViewEvent = {
        ts: new Date().toISOString(),
        path: pagePath,
        sid,
      };
      await appendEvent(appName, event);

      console.log(`[Analytics] Beacon received: app=${appName}, path=${pagePath}, sid=${sid}`);

      // Return a 1x1 transparent GIF
      return new Response(
        Uint8Array.from([
          0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00, 0x00,
          0x00, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
          0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
        ]),
        {
          status: 200,
          headers: {
            'Content-Type': 'image/gif',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Access-Control-Allow-Origin': '*',
            'Cross-Origin-Resource-Policy': 'cross-origin',
            'Timing-Allow-Origin': '*',
          },
        },
      );
    } catch {
      // Fall through to error response
    }
  }

  try {
    const events = await readEvents(appName);
    const data = aggregateEvents(events);

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (error) {
    logger.error('Failed to read analytics:', error);
    return new Response(JSON.stringify({ error: 'Failed to read analytics' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}

/** Record a page view event */
export async function action({ request }: ActionFunctionArgs) {
  const corsHeaders = getCorsHeaders(request);

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  const url = new URL(request.url);
  const appName = url.searchParams.get('app');
  const pagePath = url.searchParams.get('path') || '/';
  const sid = url.searchParams.get('sid') || 'unknown';

  console.log(`[Analytics] Data received: app=${appName}, path=${pagePath}`);

  if (!appName) {
    return new Response(JSON.stringify({ error: 'Missing app parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  try {
    const event: PageViewEvent = {
      ts: new Date().toISOString(),
      path: pagePath,
      sid,
    };
    await appendEvent(appName, event);

    return new Response(null, { status: 204, headers: corsHeaders });
  } catch (error) {
    logger.error('Failed to record analytics event:', error);
    return new Response(JSON.stringify({ error: 'Failed to record event' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
