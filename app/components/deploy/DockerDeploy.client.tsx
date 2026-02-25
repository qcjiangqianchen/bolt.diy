import { toast } from 'react-toastify';
import { useStore } from '@nanostores/react';
import { workbenchStore } from '~/lib/stores/workbench';
import { webcontainer } from '~/lib/webcontainer';
import { path } from '~/utils/path';
import { useState } from 'react';
import { chatId } from '~/lib/persistence/useChatHistory';

interface ProjectDetection {
  type: 'node' | 'static' | 'python' | 'unknown';
  hasPackageJson: boolean;
  hasBuildScript: boolean;
  buildCommand: string;
  startCommand: string;
  buildOutputDir: string;
  nodeVersion: string;
  packageManager: 'npm' | 'yarn' | 'pnpm';

  // Whether the actual lock file exists in the project
  hasNpmLock: boolean;
  hasYarnLock: boolean;
  hasPnpmLock: boolean;
}

/**
 * Detects the project type and build configuration from the collected files.
 */
function detectProject(files: Record<string, string>): ProjectDetection {
  const result: ProjectDetection = {
    type: 'unknown',
    hasPackageJson: false,
    hasBuildScript: false,
    buildCommand: '',
    startCommand: '',
    buildOutputDir: 'dist',
    nodeVersion: '20',
    packageManager: 'npm',
    hasNpmLock: false,
    hasYarnLock: false,
    hasPnpmLock: false,
  };

  // Check for package.json (Node.js project)
  if (files['package.json']) {
    result.type = 'node';
    result.hasPackageJson = true;

    try {
      const pkg = JSON.parse(files['package.json']);

      // Detect build command
      if (pkg.scripts?.build) {
        result.hasBuildScript = true;
        result.buildCommand = 'npm run build';
      }

      // Detect start command
      if (pkg.scripts?.start) {
        result.startCommand = 'npm run start';
      } else if (pkg.scripts?.serve) {
        result.startCommand = 'npm run serve';
      } else if (pkg.scripts?.preview) {
        result.startCommand = 'npm run preview';
      } else if (pkg.main) {
        result.startCommand = `node ${pkg.main}`;
      } else {
        result.startCommand = 'node index.js';
      }

      // Detect build output directory from common frameworks
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      if (deps.next) {
        result.buildOutputDir = '.next';
        result.startCommand = 'npm run start';
      } else if (deps.nuxt || deps.nuxt3) {
        result.buildOutputDir = '.output';
      } else if (deps['@remix-run/react'] || deps.remix) {
        result.buildOutputDir = 'build';
      } else if (deps.vite || deps['@vitejs/plugin-react']) {
        result.buildOutputDir = 'dist';
      } else if (deps['react-scripts']) {
        result.buildOutputDir = 'build';
      }

      // Detect Node.js version from engines
      if (pkg.engines?.node) {
        const match = pkg.engines.node.match(/(\d+)/);

        if (match) {
          result.nodeVersion = match[1];
        }
      }
    } catch {
      // Ignore parse errors, use defaults
    }

    // Detect package manager and whether the lock file actually exists
    if (files['pnpm-lock.yaml']) {
      result.packageManager = 'pnpm';
      result.hasPnpmLock = true;
    } else if (files['yarn.lock']) {
      result.packageManager = 'yarn';
      result.hasYarnLock = true;
    } else if (files['package-lock.json']) {
      result.hasNpmLock = true;
    }
  }

  // Check for Python project
  if (files['requirements.txt'] || files['pyproject.toml'] || files['setup.py']) {
    result.type = 'python';
    result.startCommand = files['main.py'] ? 'python main.py' : 'python app.py';
  }

  // Check for static site (HTML files, no package.json)
  if (result.type === 'unknown' && files['index.html']) {
    result.type = 'static';
    result.startCommand = '';
    result.buildOutputDir = '.';
  }

  return result;
}

/**
 * Generates a Dockerfile based on the detected project type.
 */
function generateDockerfile(detection: ProjectDetection): string {
  switch (detection.type) {
    case 'node': {
      /*
       * Only copy the lockfile when it actually exists in the project.
       * Fall back from `npm ci` (requires lockfile) to `npm install` when absent.
       */
      const hasLockfile =
        detection.packageManager === 'pnpm'
          ? detection.hasPnpmLock
          : detection.packageManager === 'yarn'
            ? detection.hasYarnLock
            : detection.hasNpmLock;

      const installCmd =
        detection.packageManager === 'pnpm'
          ? hasLockfile
            ? 'corepack enable && pnpm install --frozen-lockfile'
            : 'corepack enable && pnpm install'
          : detection.packageManager === 'yarn'
            ? hasLockfile
              ? 'yarn install --frozen-lockfile'
              : 'yarn install'
            : hasLockfile
              ? 'npm ci'
              : 'npm install';

      const copyLockfile = !hasLockfile
        ? '' // no lockfile — skip COPY entirely
        : detection.packageManager === 'pnpm'
          ? 'COPY pnpm-lock.yaml ./'
          : detection.packageManager === 'yarn'
            ? 'COPY yarn.lock ./'
            : 'COPY package-lock.json ./';

      if (detection.hasBuildScript) {
        return `# ---- Build Stage ----
FROM node:${detection.nodeVersion}-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package.json ./
${copyLockfile ? copyLockfile + '\n' : ''}
# Install dependencies
RUN ${installCmd}

# Copy source code
COPY . .

# Build the application
RUN ${detection.buildCommand}

# ---- Production Stage ----
FROM node:${detection.nodeVersion}-alpine AS production

WORKDIR /app

ENV NODE_ENV=production
# Bind to all interfaces so Fly.io / Docker can reach the app
ENV HOST=0.0.0.0
ENV PORT=3000

# Copy dependency manifests
COPY package.json ./
${copyLockfile ? copyLockfile + '\n' : ''}
# Install production-only dependencies
RUN ${installCmd} --production

# Copy built artifacts from builder
COPY --from=builder /app/${detection.buildOutputDir} ./${detection.buildOutputDir}

# Expose default port
EXPOSE 3000

# Start the application
CMD ["sh", "-c", "${detection.startCommand}"]
`;
      }

      // No build step — simple Node.js server
      return `FROM node:${detection.nodeVersion}-alpine

WORKDIR /app

ENV NODE_ENV=production
# Bind to all interfaces so Fly.io / Docker can reach the app
ENV HOST=0.0.0.0
ENV PORT=3000

# Copy dependency manifests
COPY package.json ./
${copyLockfile ? copyLockfile + '\n' : ''}
# Install dependencies
RUN ${installCmd}

# Copy source code
COPY . .

# Expose default port
EXPOSE 3000

CMD ["sh", "-c", "${detection.startCommand}"]
`;
    }

    case 'python':
      return `FROM python:3.12-slim

WORKDIR /app

# Copy requirements
COPY requirements.txt ./

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY . .

# Expose default port
EXPOSE 8000

CMD ["sh", "-c", "${detection.startCommand}"]
`;

    case 'static':
      return `FROM nginx:alpine

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy static files
COPY . /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
`;

    default:
      return `FROM node:20-alpine

WORKDIR /app

COPY . .

EXPOSE 3000

CMD ["node", "index.js"]
`;
  }
}

/**
 * Generates a docker-compose.yml based on the detected project type.
 */
function generateDockerCompose(imageName: string, detection: ProjectDetection): string {
  const port = detection.type === 'static' ? '80' : detection.type === 'python' ? '8000' : '3000';

  return `version: "3.8"

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    image: ${imageName}
    container_name: ${imageName.replace(/[/:]/g, '-')}
    ports:
      - "${port}:${port}"
    environment:
      - NODE_ENV=production
    restart: unless-stopped
`;
}

/**
 * Generates a .dockerignore file.
 */
function generateDockerIgnore(): string {
  return `node_modules
.git
.gitignore
.env
.env.*
*.log
npm-debug.log*
.DS_Store
coverage
.cache
.next
dist
build
.output
Thumbs.db
`;
}

/**
 * Generates an nginx.conf for static sites.
 */
function generateNginxConf(): string {
  return `server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
}
`;
}

export function useDockerDeploy() {
  const [isDeploying, setIsDeploying] = useState(false);
  const currentChatId = useStore(chatId);

  const handleDockerDeploy = async () => {
    if (!currentChatId) {
      toast.error('No active chat found');
      return false;
    }

    try {
      setIsDeploying(true);

      const artifact = workbenchStore.firstArtifact;

      if (!artifact) {
        throw new Error('No active project found');
      }

      /*
       * Skip running `npm run build` in WebContainer.
       * The Dockerfile already contains the build step — Docker (or Fly's remote
       * builders) will compile the app during `docker build`. We only need to
       * collect the source files here.
       */

      // Get all project files from WebContainer
      const container = await webcontainer;

      async function getAllFiles(dirPath: string, basePath: string = ''): Promise<Record<string, string>> {
        const files: Record<string, string> = {};
        const entries = await container.fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

          // Skip non-deployable directories
          if (
            entry.isDirectory() &&
            (entry.name === 'node_modules' ||
              entry.name === '.git' ||
              entry.name === '.cache' ||
              entry.name === '.next')
          ) {
            continue;
          }

          if (entry.isFile()) {
            if (entry.name.endsWith('.DS_Store') || entry.name.endsWith('.log') || entry.name.startsWith('.env')) {
              continue;
            }

            try {
              const content = await container.fs.readFile(fullPath, 'utf-8');
              files[relativePath] = content;
            } catch (error) {
              console.warn(`Could not read file ${fullPath}:`, error);
              continue;
            }
          } else if (entry.isDirectory()) {
            const subFiles = await getAllFiles(fullPath, relativePath);
            Object.assign(files, subFiles);
          }
        }

        return files;
      }

      const fileContents = await getAllFiles('/');

      // Detect project type and generate Docker artifacts
      const detection = detectProject(fileContents);
      const dockerfile = generateDockerfile(detection);
      const projectName = (artifact.title || 'bolt-project').replace(/\s+/g, '-').toLowerCase();
      const dockerCompose = generateDockerCompose(projectName, detection);
      const dockerIgnore = generateDockerIgnore();

      // Add Docker files to the collected files
      fileContents.Dockerfile = dockerfile;
      fileContents['docker-compose.yml'] = dockerCompose;
      fileContents['.dockerignore'] = dockerIgnore;

      // Add nginx.conf for static sites
      if (detection.type === 'static') {
        fileContents['nginx.conf'] = generateNginxConf();
      }

      return {
        success: true,
        files: fileContents,
        projectName,
        detection,
        dockerfile,
        dockerCompose,
      };
    } catch (err) {
      console.error('Docker deploy error:', err);
      toast.error(err instanceof Error ? err.message : 'Docker deployment preparation failed');

      return false;
    } finally {
      setIsDeploying(false);
    }
  };

  return {
    isDeploying,
    handleDockerDeploy,
  };
}
