import { type ActionFunctionArgs, json } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('api.deploy-docker');

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const body = await request.json<{
      action: 'package' | 'build';
      imageName: string;
      files: Record<string, string>;
    }>();

    const { action: deployAction, imageName, files } = body;

    if (!imageName || !files) {
      return json({ error: 'Missing imageName or files' }, { status: 400 });
    }

    if (deployAction === 'package') {
      return handlePackage(imageName, files);
    } else if (deployAction === 'build') {
      return handleBuild(imageName, files);
    }

    return json({ error: 'Invalid action. Use "package" or "build".' }, { status: 400 });
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
          rm(buildDir, { recursive: true, force: true }).catch(() => {});
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
