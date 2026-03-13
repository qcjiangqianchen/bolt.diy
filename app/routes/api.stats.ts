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

const logger = createScopedLogger('api.telemetry');

// Compatibility hint for the browser to allow cross-origin hits
const TELEMETRY_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, ngrok-skip-browser-warning, Accept, X-Requested-With',
  'Access-Control-Max-Age': '86400',
  'Cross-Origin-Resource-Policy': 'cross-origin', // CRITICAL for COEP pages
  'Timing-Allow-Origin': '*',
};

interface PageViewEvent {
  ts: string; // ISO timestamp
  path: string;
  sid: string; // session id
}

const inMemoryStore = new Map<string, PageViewEvent[]>();

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

  return readEventsFromDisk(appName);
}

async function readEventsFromDisk(appName: string): Promise<PageViewEvent[]> {
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
    const { writeFile } = await import('node:fs/promises');
    const filePath = await getDataFilePath(appName);

    await writeFile(filePath, JSON.stringify(events), 'utf-8');
    console.log(`[Telemetry] Persisted hit for ${appName}. Total: ${events.length}`);
  } catch (error: any) {
    console.error(`[Telemetry] DISK ERROR for ${appName}:`, error.message || error);

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

/** Handle stats fetching or record a view via no-cors POST beacon */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const corsHeaders = TELEMETRY_HEADERS;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const appName = url.searchParams.get('_ta') || url.searchParams.get('app');

  if (!appName) {
    return new Response(JSON.stringify({ error: 'Missing app parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  // Handle Dashboard GET Data request
  try {
    const forceRefresh = url.searchParams.has('t') || url.searchParams.has('_cb');
    const events = forceRefresh ? await readEventsFromDisk(appName) : await readEvents(appName);
    const data = aggregateEvents(events);

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-Telemetry-Status': 'ready',
      },
    });
  } catch (error) {
    logger.error('Failed to read telemetry:', error);
    return new Response(JSON.stringify({ error: 'Failed to read telemetry' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}

/** Record a page view event via POST (robust against CORS/COEP) */
export async function action({ request }: ActionFunctionArgs) {
  const corsHeaders = TELEMETRY_HEADERS;

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(request.url);
  const appName = url.searchParams.get('_ta') || url.searchParams.get('app');
  const pagePath = url.searchParams.get('_tp') || url.searchParams.get('path') || '/';
  const sid = url.searchParams.get('_ts') || url.searchParams.get('sid') || 'unknown';

  if (!appName) {
    return new Response(null, { status: 204, headers: corsHeaders }); // Silent fail for beacons
  }

  try {
    console.log(`[Telemetry] Incoming Hit Detected! App: ${appName} Path: ${pagePath}`);

    const event: PageViewEvent = {
      ts: new Date().toISOString(),
      path: pagePath,
      sid: sid.slice(0, 32),
    };

    await appendEvent(appName, event);

    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  } catch (error: any) {
    console.error(`[Telemetry] Hit Failed to Persist:`, error.message);
    return new Response(null, { status: 204, headers: corsHeaders });
  }
}
