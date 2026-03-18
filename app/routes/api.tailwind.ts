import { type LoaderFunctionArgs } from '@remix-run/cloudflare';

export async function loader({ request: _request }: LoaderFunctionArgs) {
  try {
    const response = await fetch('https://cdn.tailwindcss.com');
    const text = await response.text();

    return new Response(text, {
      headers: {
        'Content-Type': 'application/javascript',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=31536000',
      },
    });
  } catch (error) {
    return new Response(
      'console.error("[API] Failed to load Tailwind CDN via proxy", ' + JSON.stringify(error) + ');',
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
