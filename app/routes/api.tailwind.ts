import { type LoaderFunctionArgs } from '@remix-run/cloudflare';

const TAILWIND_HEADERS = {
  'Content-Type': 'application/javascript',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=31536000',
};

/**
 * Serves the Tailwind CSS standalone build.
 *
 * Priority order:
 *   1. Bundled local file (public/tailwind-cdn.js) — works offline / on NGINE
 *   2. CDN proxy fallback — for environments where the local file is missing
 */
export async function loader({ request: _request }: LoaderFunctionArgs) {
  // 1. Try serving from the bundled local file (offline / NGINE compatible)
  try {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');

    const localPath = join(process.cwd(), 'public', 'tailwind-cdn.js');
    const text = await readFile(localPath, 'utf-8');

    return new Response(text, { headers: TAILWIND_HEADERS });
  } catch {
    // Local file not found — fall through to CDN proxy
  }

  // 2. Fallback: proxy from CDN (requires internet access)
  try {
    const response = await fetch('https://cdn.tailwindcss.com');
    const text = await response.text();

    return new Response(text, { headers: TAILWIND_HEADERS });
  } catch (error) {
    return new Response(
      'console.error("[API] Failed to load Tailwind — neither local bundle nor CDN available", ' +
        JSON.stringify(error) +
        ');',
      {
        status: 500,
        headers: {
          'Content-Type': 'application/javascript',
          'Cross-Origin-Resource-Policy': 'cross-origin',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  }
}
