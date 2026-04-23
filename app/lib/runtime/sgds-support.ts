import type { WebContainer } from '@webcontainer/api';
import sgdsCssRaw from '@govtechsg/sgds/css/sgds.css?raw';
import bootstrapIconsCssRaw from 'bootstrap-icons/font/bootstrap-icons.css?raw';
import bootstrapIconsWoffUrl from 'bootstrap-icons/font/fonts/bootstrap-icons.woff?url';
import bootstrapIconsWoff2Url from 'bootstrap-icons/font/fonts/bootstrap-icons.woff2?url';
import bootstrapBundleRaw from 'bootstrap/dist/js/bootstrap.bundle.min.js?raw';

export const SGDS_ASSET_PATHS = {
  sgdsCss: '/vendor/sgds/sgds.css',
  bootstrapIconsCss: '/vendor/bootstrap-icons/bootstrap-icons.css',
  bootstrapBundleJs: '/vendor/bootstrap/bootstrap.bundle.min.js',
} as const;

export interface SgdsAssetFile {
  path: string;
  content: string;
}

const SGDS_VENDOR_FILES = [
  'vendor/sgds/sgds.css',
  'vendor/bootstrap-icons/bootstrap-icons.css',
  'vendor/bootstrap/bootstrap.bundle.min.js',
] as const;

let sgdsAssetFilesPromise: Promise<SgdsAssetFile[]> | undefined;

function stripSourceMapReferences(content: string) {
  return content
    .replace(/\/\*# sourceMappingURL=.*?\*\//g, '')
    .replace(/\/\/# sourceMappingURL=.*$/gm, '')
    .trimEnd();
}

async function fetchAssetAsBase64(url: string): Promise<string> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to load SGDS asset: ${url}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

async function getBootstrapIconsCss() {
  try {
    const [woff2, woff] = await Promise.all([
      fetchAssetAsBase64(bootstrapIconsWoff2Url),
      fetchAssetAsBase64(bootstrapIconsWoffUrl),
    ]);

    return bootstrapIconsCssRaw
      .replace(
        /url\("\.\/fonts\/bootstrap-icons\.woff2\?[^"]*"\)\s+format\("woff2"\)/,
        `url("data:font/woff2;base64,${woff2}") format("woff2")`,
      )
      .replace(
        /url\("\.\/fonts\/bootstrap-icons\.woff\?[^"]*"\)\s+format\("woff"\)/,
        `url("data:font/woff;base64,${woff}") format("woff")`,
      );
  } catch {
    return bootstrapIconsCssRaw;
  }
}

export async function getSgdsAssetFiles(): Promise<SgdsAssetFile[]> {
  sgdsAssetFilesPromise ??= (async () => [
    {
      path: SGDS_VENDOR_FILES[0],
      content: stripSourceMapReferences(sgdsCssRaw),
    },
    {
      path: SGDS_VENDOR_FILES[1],
      content: stripSourceMapReferences(await getBootstrapIconsCss()),
    },
    {
      path: SGDS_VENDOR_FILES[2],
      content: stripSourceMapReferences(bootstrapBundleRaw),
    },
  ])();

  return sgdsAssetFilesPromise;
}

export function hasSgdsSignal(content: string) {
  return (
    /@govtechsg\/sgds/i.test(content) ||
    /designsystem\.tech\.gov\.sg/i.test(content) ||
    /sgds(?:\.min)?\.css/i.test(content) ||
    /\bclass\s*=\s*["'][^"']*\bsgds\b/i.test(content) ||
    /sgds-(masthead|navbar|footer|accordion|breadcrumb|btn|card|table|form|alert)/i.test(content)
  );
}

function includesAsset(content: string, assetPath: string) {
  return content.includes(assetPath) || content.includes(assetPath.replace(/^\//, './'));
}

function removeLocalAssetIntegrity(content: string) {
  return content.replace(
    /<(link|script)\b[^>]*(?:\/vendor\/sgds|\/vendor\/bootstrap-icons|\/vendor\/bootstrap)[^>]*>/gi,
    (tag) => tag.replace(/\s+(?:integrity|crossorigin)=["'][^"']*["']/gi, ''),
  );
}

function normalizeAssetReferences(content: string) {
  return removeLocalAssetIntegrity(
    content
      .replace(
        /https?:\/\/cdn\.jsdelivr\.net\/npm\/@govtechsg\/sgds@[^"']+\/css\/sgds(?:\.min)?\.css/gi,
        SGDS_ASSET_PATHS.sgdsCss,
      )
      .replace(
        /https?:\/\/cdn\.jsdelivr\.net\/npm\/bootstrap-icons@[^"']+\/font\/bootstrap-icons(?:\.min)?\.css/gi,
        SGDS_ASSET_PATHS.bootstrapIconsCss,
      )
      .replace(
        /https?:\/\/cdn\.jsdelivr\.net\/npm\/bootstrap@[^"']+\/dist\/js\/bootstrap\.bundle(?:\.min)?\.js/gi,
        SGDS_ASSET_PATHS.bootstrapBundleJs,
      )
      .replace(/\.\/vendor\/sgds\/sgds\.css/g, SGDS_ASSET_PATHS.sgdsCss)
      .replace(/\.\/vendor\/bootstrap-icons\/bootstrap-icons\.css/g, SGDS_ASSET_PATHS.bootstrapIconsCss)
      .replace(/\.\/vendor\/bootstrap\/bootstrap\.bundle\.min\.js/g, SGDS_ASSET_PATHS.bootstrapBundleJs),
  );
}

function injectBeforeClosingTag(content: string, closingTag: RegExp, injection: string) {
  if (closingTag.test(content)) {
    return content.replace(closingTag, `${injection}\n$&`);
  }

  return `${injection}\n${content}`;
}

export function normalizeSgdsHtml(content: string) {
  let normalized = normalizeAssetReferences(content);

  if (!hasSgdsSignal(normalized)) {
    return normalized;
  }

  const headLinks = [
    includesAsset(normalized, SGDS_ASSET_PATHS.sgdsCss)
      ? ''
      : `  <link rel="stylesheet" href="${SGDS_ASSET_PATHS.sgdsCss}">`,
    includesAsset(normalized, SGDS_ASSET_PATHS.bootstrapIconsCss)
      ? ''
      : `  <link rel="stylesheet" href="${SGDS_ASSET_PATHS.bootstrapIconsCss}">`,
  ]
    .filter(Boolean)
    .join('\n');

  if (headLinks) {
    normalized = injectBeforeClosingTag(normalized, /<\/head>/i, headLinks);
  }

  if (!includesAsset(normalized, SGDS_ASSET_PATHS.bootstrapBundleJs)) {
    normalized = injectBeforeClosingTag(
      normalized,
      /<\/body>/i,
      `  <script src="${SGDS_ASSET_PATHS.bootstrapBundleJs}"></script>`,
    );
  }

  return normalized;
}

export async function ensureSgdsAssetsInWebContainer(webcontainer: WebContainer) {
  const assets = await getSgdsAssetFiles();

  await Promise.all(
    assets.map(async (asset) => {
      const folder = asset.path.split('/').slice(0, -1).join('/');

      if (folder) {
        await webcontainer.fs.mkdir(folder, { recursive: true });
      }

      await webcontainer.fs.writeFile(asset.path, asset.content);
    }),
  );
}

export async function prepareSgdsHtmlFile(webcontainer: WebContainer, filePath: string, content: string) {
  if (!/\.html?$/i.test(filePath)) {
    return content;
  }

  const normalized = normalizeSgdsHtml(content);

  if (hasSgdsSignal(normalized)) {
    await ensureSgdsAssetsInWebContainer(webcontainer);
  }

  return normalized;
}
