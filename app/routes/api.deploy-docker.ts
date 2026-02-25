import { type ActionFunctionArgs, json } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('api.deploy-docker');

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const body = await request.json<{
      action: 'package' | 'build' | 'fly-deploy';
      imageName: string;
      files: Record<string, string>;
      flyAppName?: string;
      flyRegion?: string;
      boltUrl?: string;
    }>();

    const { action: deployAction, imageName, files } = body;

    if (!imageName || !files) {
      return json({ error: 'Missing imageName or files' }, { status: 400 });
    }

    if (deployAction === 'package') {
      return handlePackage(imageName, files);
    } else if (deployAction === 'build') {
      return handleBuild(imageName, files);
    } else if (deployAction === 'fly-deploy') {
      const flyAppName = body.flyAppName || imageName.replace(/[/:]/g, '-');
      const flyRegion = body.flyRegion || 'iad';
      const boltUrl = body.boltUrl;

      return handleFlyDeploy(imageName, files, flyAppName, flyRegion, boltUrl);
    }

    return json({ error: 'Invalid action. Use "package", "build", or "fly-deploy".' }, { status: 400 });
  } catch (error) {
    logger.error('Deploy docker error:', error);
    return json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 });
  }
}

/**
 * Packages all project files into a tar.gz archive for download.
 * This creates an in-memory tar archive without needing Docker installed.
 */
async function handlePackage(imageName: string, files: Record<string, string>): Promise<Response> {
  try {
    /*
     * Build a tar archive in memory
     * Each file entry in a tar: 512-byte header + file content padded to 512-byte boundary
     */
    const entries: Uint8Array[] = [];
    const encoder = new TextEncoder();

    for (const [filePath, content] of Object.entries(files)) {
      const fileData = encoder.encode(content);
      const header = createTarHeader(filePath, fileData.length);
      entries.push(header);
      entries.push(fileData);

      // Pad to 512-byte boundary
      const padding = 512 - (fileData.length % 512);

      if (padding < 512) {
        entries.push(new Uint8Array(padding));
      }
    }

    // End-of-archive marker: two 512-byte blocks of zeros
    entries.push(new Uint8Array(1024));

    // Concatenate all entries
    const totalLength = entries.reduce((sum, e) => sum + e.length, 0);
    const tarBuffer = new Uint8Array(totalLength);
    let offset = 0;

    for (const entry of entries) {
      tarBuffer.set(entry, offset);
      offset += entry.length;
    }

    // Compress with gzip using CompressionStream (available in modern runtimes)
    const compressedStream = new Blob([tarBuffer]).stream().pipeThrough(new CompressionStream('gzip'));

    const compressedBlob = await new Response(compressedStream).blob();

    const safeName = imageName.replace(/[/:]/g, '-');

    return new Response(compressedBlob, {
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="${safeName}-docker-package.tar.gz"`,
      },
    });
  } catch (error) {
    logger.error('Package creation failed:', error);
    return new Response(JSON.stringify({ error: 'Failed to create package' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Builds a Docker image on the server.
 * Requires Docker to be installed on the host running bolt.diy.
 * Streams build output back to the client.
 */
async function handleBuild(imageName: string, files: Record<string, string>): Promise<Response> {
  /*
   * Server-side Docker build: we write files to a temp directory,
   * run `docker build`, and stream logs back to the client.
   *
   * In Cloudflare Workers / edge environments, subprocess execution
   * is not available. This endpoint is designed for self-hosted / on-prem
   * deployments where Node.js + Docker are available.
   */
  try {
    // Dynamically import Node.js modules (only available in Node.js runtime)
    const { writeFile, mkdir, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { spawn } = await import('node:child_process');
    const { tmpdir } = await import('node:os');

    const buildDir = join(tmpdir(), `bolt-docker-build-${Date.now()}`);
    await mkdir(buildDir, { recursive: true });

    // Write all files to the temp directory
    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = join(buildDir, filePath);
      const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));

      if (dir !== buildDir) {
        await mkdir(dir, { recursive: true });
      }

      await writeFile(fullPath, content, 'utf-8');
    }

    // Build the Docker image, streaming output
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();

        const dockerBuild = spawn('docker', ['build', '-t', imageName, '.'], {
          cwd: buildDir,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        dockerBuild.stdout.on('data', (data: Buffer) => {
          controller.enqueue(encoder.encode(data.toString()));
        });

        dockerBuild.stderr.on('data', (data: Buffer) => {
          controller.enqueue(encoder.encode(data.toString()));
        });

        dockerBuild.on('close', async (code: number | null) => {
          if (code === 0) {
            controller.enqueue(encoder.encode(`\n✓ Image "${imageName}" built successfully.\n`));
            controller.enqueue(encoder.encode(`\nTo run: docker run -p 3000:3000 ${imageName}\n`));
            controller.enqueue(
              encoder.encode(`To save: docker save ${imageName} -o ${imageName.replace(/[/:]/g, '-')}.tar\n`),
            );
          } else {
            controller.enqueue(encoder.encode(`\n✗ Build failed with exit code ${code}\n`));
          }

          // Clean up temp directory
          try {
            await rm(buildDir, { recursive: true, force: true });
          } catch {
            // Ignore cleanup errors
          }

          controller.close();
        });

        dockerBuild.on('error', (err: Error) => {
          controller.enqueue(encoder.encode(`\nERROR: ${err.message}\nMake sure Docker is installed and running.\n`));

          // Clean up temp directory
          rm(buildDir, { recursive: true, force: true }).catch(() => {
            /* ignore cleanup errors */
          });
          controller.close();
        });
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    logger.error('Docker build failed:', error);

    const message =
      error instanceof Error && error.message.includes('Cannot find module')
        ? 'Docker build requires a Node.js runtime environment. This feature is not available in edge/serverless deployments.'
        : error instanceof Error
          ? error.message
          : 'Docker build failed';

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Creates a POSIX tar header (USTAR format) for a single file entry.
 */
function createTarHeader(fileName: string, fileSize: number): Uint8Array {
  const header = new Uint8Array(512);
  const encoder = new TextEncoder();

  // File name (100 bytes)
  const nameBytes = encoder.encode(fileName);
  header.set(nameBytes.slice(0, 100), 0);

  // File mode (8 bytes) - 0644
  header.set(encoder.encode('0000644\0'), 100);

  // Owner ID (8 bytes)
  header.set(encoder.encode('0001000\0'), 108);

  // Group ID (8 bytes)
  header.set(encoder.encode('0001000\0'), 116);

  // File size in octal (12 bytes)
  const sizeOctal = fileSize.toString(8).padStart(11, '0') + '\0';
  header.set(encoder.encode(sizeOctal), 124);

  // Modification time (12 bytes)
  const mtime =
    Math.floor(Date.now() / 1000)
      .toString(8)
      .padStart(11, '0') + '\0';
  header.set(encoder.encode(mtime), 136);

  // Initialize checksum field with spaces (8 bytes at offset 148)
  header.set(encoder.encode('        '), 148);

  // Type flag: '0' = normal file
  header[156] = 0x30;

  // USTAR indicator
  header.set(encoder.encode('ustar\0'), 257);

  // USTAR version
  header.set(encoder.encode('00'), 263);

  // Calculate checksum
  let checksum = 0;

  for (let i = 0; i < 512; i++) {
    checksum += header[i];
  }

  const checksumOctal = checksum.toString(8).padStart(6, '0') + '\0 ';
  header.set(encoder.encode(checksumOctal), 148);

  return header;
}

/**
 * Generates a fly.toml configuration for Fly.io deployment.
 */
function generateFlyToml(appName: string, port: number): string {
  return `# See https://fly.io/docs/reference/configuration/ for information about how to use this file.

app = "${appName}"
primary_region = "iad"

[build]

# Ensure the app binds on 0.0.0.0 so Fly's load balancer can reach it.
# Many frameworks (Vite, Next.js, etc.) default to 127.0.0.1 in production.
[env]
  HOST = "0.0.0.0"
  PORT = "${port}"

[http_service]
  internal_port = ${port}
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0
  processes = ["app"]

[[vm]]
  memory = "256mb"
  cpu_kind = "shared"
  cpus = 1
`;
}

/**
 * Detects the internal port from the Dockerfile EXPOSE directive.
 */
function detectPortFromDockerfile(dockerfile: string): number {
  const match = dockerfile.match(/EXPOSE\s+(\d+)/);
  return match ? parseInt(match[1], 10) : 3000;
}

/**
 * Deploys the application to Fly.io using flyctl.
 * Pipeline: write files to temp dir → generate fly.toml → `fly deploy`
 * Requires flyctl to be installed on the host.
 * Streams deployment output back to the client.
 */
async function handleFlyDeploy(
  imageName: string,
  files: Record<string, string>,
  flyAppName: string,
  flyRegion: string,
  boltUrl?: string,
): Promise<Response> {
  try {
    const { writeFile, mkdir, rm } = await import('node:fs/promises');
    const { join, dirname } = await import('node:path');
    const { spawn, execSync } = await import('node:child_process');
    const { tmpdir } = await import('node:os');

    // Verify flyctl is available
    try {
      execSync('flyctl version', { stdio: 'pipe' });
    } catch {
      return new Response(
        JSON.stringify({
          error: 'flyctl is not installed or not in PATH. Install it from https://fly.io/docs/flyctl/install/',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const buildDir = join(tmpdir(), `bolt-fly-deploy-${Date.now()}`);
    await mkdir(buildDir, { recursive: true });

    // Detect port from Dockerfile
    const dockerfile = files.Dockerfile || '';
    const port = detectPortFromDockerfile(dockerfile);

    logger.info(`Detected port from Dockerfile: ${port}`);
    logger.info(`Dockerfile starts with: ${dockerfile.substring(0, 200)}`);

    // Generate fly.toml if not already present
    if (!files['fly.toml']) {
      files['fly.toml'] = generateFlyToml(flyAppName, port);
    }

    /*
     * Inject analytics tracker into index.html using the bolt.diy origin URL
     * boltUrl comes from window.location.origin in the browser — no configuration needed
     */
    if (boltUrl && files['index.html']) {
      const trackerScript = `<script>(function(){var _boltApp=${JSON.stringify(flyAppName)},_boltUrl=${JSON.stringify(boltUrl.replace(/\/$/, ''))};function _boltTrack(p){try{fetch(_boltUrl+'/api/analytics?app='+encodeURIComponent(_boltApp)+'&path='+encodeURIComponent(p||'/')+'&sid='+(sessionStorage._boltSid||(sessionStorage._boltSid=Math.random().toString(36).slice(2))),{method:'POST',keepalive:true}).catch(function(){});}catch(e){}}if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',function(){_boltTrack(location.pathname);});}else{_boltTrack(location.pathname);}var _hp=history.pushState;history.pushState=function(){_hp.apply(this,arguments);_boltTrack(location.pathname);};window.addEventListener('popstate',function(){_boltTrack(location.pathname);});}());</script>`;
      files['index.html'] = files['index.html'].replace('</body>', trackerScript + '</body>');

      if (!files['index.html'].includes(trackerScript)) {
        // Fallback: inject before </html> if no </body>
        files['index.html'] = files['index.html'].replace('</html>', trackerScript + '</html>');
      }

      logger.info(`Analytics tracker injected for app: ${flyAppName} → ${boltUrl}`);
    }

    // Write all files to the temp directory
    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = join(buildDir, filePath);
      const dir = dirname(fullPath);

      if (dir && dir !== buildDir) {
        await mkdir(dir, { recursive: true });
      }

      await writeFile(fullPath, content, 'utf-8');
    }

    // Stream the deployment: first try to create the app, then deploy
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        const log = (msg: string) => controller.enqueue(encoder.encode(msg));

        try {
          // Step 1: Try to create the Fly app (ignore if it already exists)
          log(`[1/3] Creating Fly.io app "${flyAppName}" in region "${flyRegion}"...\n`);
          log(`       Detected internal port: ${port}\n`);

          await new Promise<void>((resolve) => {
            const createApp = spawn('flyctl', ['apps', 'create', flyAppName, '--org', 'personal', '-y'], {
              cwd: buildDir,
              stdio: ['ignore', 'pipe', 'pipe'],
              shell: true,
            });

            createApp.stdout.on('data', (data: Buffer) => log(data.toString()));
            createApp.stderr.on('data', (data: Buffer) => {
              const msg = data.toString();

              // "already exists" is fine - not an error
              if (!msg.includes('already exists')) {
                log(msg);
              } else {
                log(`App "${flyAppName}" already exists, reusing it.\n`);
              }
            });
            createApp.on('close', () => resolve());
            createApp.on('error', () => resolve());
          });

          // Step 2: Deploy using flyctl deploy (builds Docker image remotely on Fly builders)
          log(`\n[2/3] Deploying to Fly.io (this builds the Docker image on Fly's remote builders)...\n`);
          log(`       Using Dockerfile from project.\n\n`);

          let deployOutput = '';

          await new Promise<void>((resolve, reject) => {
            const deploy = spawn(
              'flyctl',
              ['deploy', '.', '--app', flyAppName, '--primary-region', flyRegion, '--remote-only', '--ha=false', '-y'],
              {
                cwd: buildDir,
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: true,
              },
            );

            deploy.stdout.on('data', (data: Buffer) => {
              const text = data.toString();
              deployOutput += text;
              log(text);
            });

            deploy.stderr.on('data', (data: Buffer) => {
              const text = data.toString();
              deployOutput += text;
              log(text);
            });

            deploy.on('close', (code: number | null) => {
              /*
               * flyctl can exit 0 even when it just prints usage help.
               * Verify the output contains actual deployment indicators.
               */
              const actuallyDeployed =
                deployOutput.includes('has been deployed') ||
                deployOutput.includes('deployed successfully') ||
                deployOutput.includes('Machines are starting') ||
                deployOutput.includes('Visit your newly deployed app');

              if (code === 0 && actuallyDeployed) {
                resolve();
              } else if (code === 0 && !actuallyDeployed) {
                reject(new Error('flyctl exited but deployment did not complete. Check the log above for details.'));
              } else {
                reject(new Error(`flyctl deploy exited with code ${code}`));
              }
            });

            deploy.on('error', (err: Error) => reject(err));
          });

          // Step 3: Get the app URL
          log(`\n[3/3] Deployment complete!\n`);
          log(`\n✓ App deployed successfully to Fly.io\n`);
          log(`  URL: https://${flyAppName}.fly.dev\n`);
          log(`  Dashboard: https://fly.io/apps/${flyAppName}\n`);
          log(`\n  To check status: flyctl status --app ${flyAppName}\n`);
          log(`  To view logs:    flyctl logs --app ${flyAppName}\n`);
        } catch (err) {
          log(`\n✗ Deployment failed: ${err instanceof Error ? err.message : 'Unknown error'}\n`);
          log(`\nTroubleshooting:\n`);
          log(`  1. Run "flyctl auth login" to ensure you're authenticated\n`);
          log(`  2. Run "flyctl apps list" to check your apps\n`);
          log(`  3. Check your Dockerfile for build errors\n`);
        } finally {
          // Clean up temp directory
          try {
            await rm(buildDir, { recursive: true, force: true });
          } catch {
            // Ignore cleanup errors
          }

          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    logger.error('Fly.io deploy failed:', error);

    const message =
      error instanceof Error && error.message.includes('Cannot find module')
        ? 'Fly.io deploy requires a Node.js runtime. This feature is not available in edge/serverless deployments.'
        : error instanceof Error
          ? error.message
          : 'Fly.io deployment failed';

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
