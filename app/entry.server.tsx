import type { AppLoadContext } from '@remix-run/cloudflare';
import { RemixServer } from '@remix-run/react';
import { isbot } from 'isbot';
import ReactDOMServer from 'react-dom/server';
import { renderHeadToString } from 'remix-island';
import { Head } from './root';
import { themeStore } from '~/lib/stores/theme';

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: any,
  _loadContext: AppLoadContext,
) {
  try {
    const head = renderHeadToString({ request, remixContext, Head });
    const markup = ReactDOMServer.renderToString(<RemixServer context={remixContext} url={request.url} />);
    const html = `<!DOCTYPE html><html lang="en" data-theme="${themeStore.value}"><head>${head}</head><body><div id="root" class="w-full h-full">${markup}</div></body></html>`;

    if (isbot(request.headers.get('user-agent') || '')) {
      responseHeaders.set('X-Bot-Rendered', 'true');
    }

    responseHeaders.set('Content-Type', 'text/html');
    responseHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp');
    responseHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');

    return new Response(html, {
      headers: responseHeaders,
      status: responseStatusCode,
    });
  } catch (error) {
    console.error(error);
    responseStatusCode = 500;
  }

  responseHeaders.set('Content-Type', 'text/html');
  responseHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp');
  responseHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');

  return new Response('Internal Server Error', {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}
