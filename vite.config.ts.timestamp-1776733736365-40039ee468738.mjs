// vite.config.ts
import { cloudflareDevProxyVitePlugin as remixCloudflareDevProxy, vitePlugin as remixVitePlugin } from "file:///C:/Users/User/Documents/GitHub/bolt.diy/node_modules/.pnpm/@remix-run+dev@2.16.8_@remix-run+react@2.16.8_react-dom@18.3.1_react@18.3.1__react@18.3.1_typ_uozynh2jdinnz6binv6akofmd4/node_modules/@remix-run/dev/dist/index.js";
import UnoCSS from "file:///C:/Users/User/Documents/GitHub/bolt.diy/node_modules/.pnpm/unocss@0.61.9_postcss@8.5.6_rollup@4.45.1_vite@5.4.19_@types+node@24.1.0_sass-embedded@1.89.2_/node_modules/unocss/dist/vite.mjs";
import { defineConfig } from "file:///C:/Users/User/Documents/GitHub/bolt.diy/node_modules/.pnpm/vite@5.4.19_@types+node@24.1.0_sass-embedded@1.89.2/node_modules/vite/dist/node/index.js";
import { nodePolyfills } from "file:///C:/Users/User/Documents/GitHub/bolt.diy/node_modules/.pnpm/vite-plugin-node-polyfills@0.22.0_rollup@4.45.1_vite@5.4.19_@types+node@24.1.0_sass-embedded@1.89.2_/node_modules/vite-plugin-node-polyfills/dist/index.js";
import { optimizeCssModules } from "file:///C:/Users/User/Documents/GitHub/bolt.diy/node_modules/.pnpm/vite-plugin-optimize-css-modules@1.2.0_vite@5.4.19_@types+node@24.1.0_sass-embedded@1.89.2_/node_modules/vite-plugin-optimize-css-modules/dist/index.mjs";
import tsconfigPaths from "file:///C:/Users/User/Documents/GitHub/bolt.diy/node_modules/.pnpm/vite-tsconfig-paths@4.3.2_typescript@5.8.3_vite@5.4.19_@types+node@24.1.0_sass-embedded@1.89.2_/node_modules/vite-tsconfig-paths/dist/index.mjs";
import * as dotenv from "file:///C:/Users/User/Documents/GitHub/bolt.diy/node_modules/.pnpm/dotenv@16.6.1/node_modules/dotenv/lib/main.js";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });
dotenv.config();
var vite_config_default = defineConfig((config2) => {
  return {
    define: {
      "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV)
    },
    build: {
      target: "esnext"
    },
    plugins: [
      nodePolyfills({
        include: ["buffer", "process", "util", "stream"],
        globals: {
          Buffer: true,
          process: true,
          global: true
        },
        protocolImports: true,
        exclude: ["child_process", "fs", "path"]
      }),
      {
        name: "buffer-polyfill",
        transform(code, id) {
          if (id.includes("env.mjs")) {
            return {
              code: `import { Buffer } from 'buffer';
${code}`,
              map: null
            };
          }
          return null;
        }
      },
      config2.mode !== "test" && remixCloudflareDevProxy(),
      remixVitePlugin({
        future: {
          v3_fetcherPersist: true,
          v3_relativeSplatPath: true,
          v3_throwAbortReason: true,
          v3_lazyRouteDiscovery: true
        }
      }),
      UnoCSS(),
      tsconfigPaths(),
      chrome129IssuePlugin(),
      config2.mode === "production" && optimizeCssModules({ apply: "build" })
    ],
    envPrefix: [
      "VITE_",
      "OPENAI_LIKE_API_BASE_URL",
      "OPENAI_LIKE_API_MODELS",
      "OLLAMA_API_BASE_URL",
      "LMSTUDIO_API_BASE_URL",
      "TOGETHER_API_BASE_URL",
      "LLM_PROVIDER",
      "LLM_MODEL",
      "LLM_BASE_URL",
      "LLM_API_KEY"
    ],
    css: {
      preprocessorOptions: {
        scss: {
          api: "modern-compiler"
        }
      }
    },
    test: {
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/cypress/**",
        "**/.{idea,git,cache,output,temp}/**",
        "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*",
        "**/tests/preview/**"
        // Exclude preview tests that require Playwright
      ]
    },
    optimizeDeps: {
      // GrapeJS and its CJS deps (backbone, underscore) are incompatible with
      // Vite's dep pre-bundler. Exclude them so they're served directly from
      // node_modules/grapesjs/dist/grapes.mjs via native ESM.
      exclude: ["grapesjs", "backbone", "underscore", "backbone-undo"]
    },
    ssr: {
      // Keep GrapeJS out of the SSR bundle — it's browser-only, loaded
      // dynamically via import('grapesjs') inside useEffect.
      external: ["grapesjs"]
    },
    server: {
      allowedHosts: true
    }
  };
});
function chrome129IssuePlugin() {
  return {
    name: "chrome129IssuePlugin",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const raw = req.headers["user-agent"]?.match(/Chrom(e|ium)\/([0-9]+)\./);
        if (raw) {
          const version = parseInt(raw[2], 10);
          if (version === 129) {
            res.setHeader("content-type", "text/html");
            res.end(
              '<body><h1>Please use Chrome Canary for testing.</h1><p>Chrome 129 has an issue with JavaScript modules & Vite local development, see <a href="https://github.com/stackblitz/bolt.new/issues/86#issuecomment-2395519258">for more information.</a></p><p><b>Note:</b> This only impacts <u>local development</u>. `pnpm run build` and `pnpm run start` will work fine in this browser.</p></body>'
            );
            return;
          }
        }
        next();
      });
    }
  };
}
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxVc2VyXFxcXERvY3VtZW50c1xcXFxHaXRIdWJcXFxcYm9sdC5kaXlcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkM6XFxcXFVzZXJzXFxcXFVzZXJcXFxcRG9jdW1lbnRzXFxcXEdpdEh1YlxcXFxib2x0LmRpeVxcXFx2aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vQzovVXNlcnMvVXNlci9Eb2N1bWVudHMvR2l0SHViL2JvbHQuZGl5L3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgY2xvdWRmbGFyZURldlByb3h5Vml0ZVBsdWdpbiBhcyByZW1peENsb3VkZmxhcmVEZXZQcm94eSwgdml0ZVBsdWdpbiBhcyByZW1peFZpdGVQbHVnaW4gfSBmcm9tICdAcmVtaXgtcnVuL2Rldic7XG5pbXBvcnQgVW5vQ1NTIGZyb20gJ3Vub2Nzcy92aXRlJztcbmltcG9ydCB7IGRlZmluZUNvbmZpZywgdHlwZSBWaXRlRGV2U2VydmVyIH0gZnJvbSAndml0ZSc7XG5pbXBvcnQgeyBub2RlUG9seWZpbGxzIH0gZnJvbSAndml0ZS1wbHVnaW4tbm9kZS1wb2x5ZmlsbHMnO1xuaW1wb3J0IHsgb3B0aW1pemVDc3NNb2R1bGVzIH0gZnJvbSAndml0ZS1wbHVnaW4tb3B0aW1pemUtY3NzLW1vZHVsZXMnO1xuaW1wb3J0IHRzY29uZmlnUGF0aHMgZnJvbSAndml0ZS10c2NvbmZpZy1wYXRocyc7XG5pbXBvcnQgKiBhcyBkb3RlbnYgZnJvbSAnZG90ZW52JztcblxuLy8gTG9hZCBlbnZpcm9ubWVudCB2YXJpYWJsZXMgZnJvbSBtdWx0aXBsZSBmaWxlc1xuZG90ZW52LmNvbmZpZyh7IHBhdGg6ICcuZW52LmxvY2FsJyB9KTtcbmRvdGVudi5jb25maWcoeyBwYXRoOiAnLmVudicgfSk7XG5kb3RlbnYuY29uZmlnKCk7XG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZygoY29uZmlnKSA9PiB7XG4gIHJldHVybiB7XG4gICAgZGVmaW5lOiB7XG4gICAgICAncHJvY2Vzcy5lbnYuTk9ERV9FTlYnOiBKU09OLnN0cmluZ2lmeShwcm9jZXNzLmVudi5OT0RFX0VOViksXG4gICAgfSxcbiAgICBidWlsZDoge1xuICAgICAgdGFyZ2V0OiAnZXNuZXh0JyxcbiAgICB9LFxuICAgIHBsdWdpbnM6IFtcbiAgICAgIG5vZGVQb2x5ZmlsbHMoe1xuICAgICAgICBpbmNsdWRlOiBbJ2J1ZmZlcicsICdwcm9jZXNzJywgJ3V0aWwnLCAnc3RyZWFtJ10sXG4gICAgICAgIGdsb2JhbHM6IHtcbiAgICAgICAgICBCdWZmZXI6IHRydWUsXG4gICAgICAgICAgcHJvY2VzczogdHJ1ZSxcbiAgICAgICAgICBnbG9iYWw6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgIHByb3RvY29sSW1wb3J0czogdHJ1ZSxcbiAgICAgICAgZXhjbHVkZTogWydjaGlsZF9wcm9jZXNzJywgJ2ZzJywgJ3BhdGgnXSxcbiAgICAgIH0pLFxuICAgICAge1xuICAgICAgICBuYW1lOiAnYnVmZmVyLXBvbHlmaWxsJyxcbiAgICAgICAgdHJhbnNmb3JtKGNvZGUsIGlkKSB7XG4gICAgICAgICAgaWYgKGlkLmluY2x1ZGVzKCdlbnYubWpzJykpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgIGNvZGU6IGBpbXBvcnQgeyBCdWZmZXIgfSBmcm9tICdidWZmZXInO1xcbiR7Y29kZX1gLFxuICAgICAgICAgICAgICBtYXA6IG51bGwsXG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH1cblxuICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGNvbmZpZy5tb2RlICE9PSAndGVzdCcgJiYgcmVtaXhDbG91ZGZsYXJlRGV2UHJveHkoKSxcbiAgICAgIHJlbWl4Vml0ZVBsdWdpbih7XG4gICAgICAgIGZ1dHVyZToge1xuICAgICAgICAgIHYzX2ZldGNoZXJQZXJzaXN0OiB0cnVlLFxuICAgICAgICAgIHYzX3JlbGF0aXZlU3BsYXRQYXRoOiB0cnVlLFxuICAgICAgICAgIHYzX3Rocm93QWJvcnRSZWFzb246IHRydWUsXG4gICAgICAgICAgdjNfbGF6eVJvdXRlRGlzY292ZXJ5OiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgfSksXG4gICAgICBVbm9DU1MoKSxcbiAgICAgIHRzY29uZmlnUGF0aHMoKSxcbiAgICAgIGNocm9tZTEyOUlzc3VlUGx1Z2luKCksXG4gICAgICBjb25maWcubW9kZSA9PT0gJ3Byb2R1Y3Rpb24nICYmIG9wdGltaXplQ3NzTW9kdWxlcyh7IGFwcGx5OiAnYnVpbGQnIH0pLFxuICAgIF0sXG4gICAgZW52UHJlZml4OiBbXG4gICAgICAnVklURV8nLFxuICAgICAgJ09QRU5BSV9MSUtFX0FQSV9CQVNFX1VSTCcsXG4gICAgICAnT1BFTkFJX0xJS0VfQVBJX01PREVMUycsXG4gICAgICAnT0xMQU1BX0FQSV9CQVNFX1VSTCcsXG4gICAgICAnTE1TVFVESU9fQVBJX0JBU0VfVVJMJyxcbiAgICAgICdUT0dFVEhFUl9BUElfQkFTRV9VUkwnLFxuICAgICAgJ0xMTV9QUk9WSURFUicsXG4gICAgICAnTExNX01PREVMJyxcbiAgICAgICdMTE1fQkFTRV9VUkwnLFxuICAgICAgJ0xMTV9BUElfS0VZJyxcbiAgICBdLFxuICAgIGNzczoge1xuICAgICAgcHJlcHJvY2Vzc29yT3B0aW9uczoge1xuICAgICAgICBzY3NzOiB7XG4gICAgICAgICAgYXBpOiAnbW9kZXJuLWNvbXBpbGVyJyxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgICB0ZXN0OiB7XG4gICAgICBleGNsdWRlOiBbXG4gICAgICAgICcqKi9ub2RlX21vZHVsZXMvKionLFxuICAgICAgICAnKiovZGlzdC8qKicsXG4gICAgICAgICcqKi9jeXByZXNzLyoqJyxcbiAgICAgICAgJyoqLy57aWRlYSxnaXQsY2FjaGUsb3V0cHV0LHRlbXB9LyoqJyxcbiAgICAgICAgJyoqL3trYXJtYSxyb2xsdXAsd2VicGFjayx2aXRlLHZpdGVzdCxqZXN0LGF2YSxiYWJlbCxueWMsY3lwcmVzcyx0c3VwLGJ1aWxkfS5jb25maWcuKicsXG4gICAgICAgICcqKi90ZXN0cy9wcmV2aWV3LyoqJywgLy8gRXhjbHVkZSBwcmV2aWV3IHRlc3RzIHRoYXQgcmVxdWlyZSBQbGF5d3JpZ2h0XG4gICAgICBdLFxuICAgIH0sXG4gICAgb3B0aW1pemVEZXBzOiB7XG4gICAgICAvLyBHcmFwZUpTIGFuZCBpdHMgQ0pTIGRlcHMgKGJhY2tib25lLCB1bmRlcnNjb3JlKSBhcmUgaW5jb21wYXRpYmxlIHdpdGhcbiAgICAgIC8vIFZpdGUncyBkZXAgcHJlLWJ1bmRsZXIuIEV4Y2x1ZGUgdGhlbSBzbyB0aGV5J3JlIHNlcnZlZCBkaXJlY3RseSBmcm9tXG4gICAgICAvLyBub2RlX21vZHVsZXMvZ3JhcGVzanMvZGlzdC9ncmFwZXMubWpzIHZpYSBuYXRpdmUgRVNNLlxuICAgICAgZXhjbHVkZTogWydncmFwZXNqcycsICdiYWNrYm9uZScsICd1bmRlcnNjb3JlJywgJ2JhY2tib25lLXVuZG8nXSxcbiAgICB9LFxuICAgIHNzcjoge1xuICAgICAgLy8gS2VlcCBHcmFwZUpTIG91dCBvZiB0aGUgU1NSIGJ1bmRsZSBcdTIwMTQgaXQncyBicm93c2VyLW9ubHksIGxvYWRlZFxuICAgICAgLy8gZHluYW1pY2FsbHkgdmlhIGltcG9ydCgnZ3JhcGVzanMnKSBpbnNpZGUgdXNlRWZmZWN0LlxuICAgICAgZXh0ZXJuYWw6IFsnZ3JhcGVzanMnXSxcbiAgICB9LFxuICAgIHNlcnZlcjoge1xuICAgICAgYWxsb3dlZEhvc3RzOiB0cnVlLFxuICAgIH0sXG4gIH07XG59KTtcblxuZnVuY3Rpb24gY2hyb21lMTI5SXNzdWVQbHVnaW4oKSB7XG4gIHJldHVybiB7XG4gICAgbmFtZTogJ2Nocm9tZTEyOUlzc3VlUGx1Z2luJyxcbiAgICBjb25maWd1cmVTZXJ2ZXIoc2VydmVyOiBWaXRlRGV2U2VydmVyKSB7XG4gICAgICBzZXJ2ZXIubWlkZGxld2FyZXMudXNlKChyZXEsIHJlcywgbmV4dCkgPT4ge1xuICAgICAgICBjb25zdCByYXcgPSByZXEuaGVhZGVyc1sndXNlci1hZ2VudCddPy5tYXRjaCgvQ2hyb20oZXxpdW0pXFwvKFswLTldKylcXC4vKTtcblxuICAgICAgICBpZiAocmF3KSB7XG4gICAgICAgICAgY29uc3QgdmVyc2lvbiA9IHBhcnNlSW50KHJhd1syXSwgMTApO1xuXG4gICAgICAgICAgaWYgKHZlcnNpb24gPT09IDEyOSkge1xuICAgICAgICAgICAgcmVzLnNldEhlYWRlcignY29udGVudC10eXBlJywgJ3RleHQvaHRtbCcpO1xuICAgICAgICAgICAgcmVzLmVuZChcbiAgICAgICAgICAgICAgJzxib2R5PjxoMT5QbGVhc2UgdXNlIENocm9tZSBDYW5hcnkgZm9yIHRlc3RpbmcuPC9oMT48cD5DaHJvbWUgMTI5IGhhcyBhbiBpc3N1ZSB3aXRoIEphdmFTY3JpcHQgbW9kdWxlcyAmIFZpdGUgbG9jYWwgZGV2ZWxvcG1lbnQsIHNlZSA8YSBocmVmPVwiaHR0cHM6Ly9naXRodWIuY29tL3N0YWNrYmxpdHovYm9sdC5uZXcvaXNzdWVzLzg2I2lzc3VlY29tbWVudC0yMzk1NTE5MjU4XCI+Zm9yIG1vcmUgaW5mb3JtYXRpb24uPC9hPjwvcD48cD48Yj5Ob3RlOjwvYj4gVGhpcyBvbmx5IGltcGFjdHMgPHU+bG9jYWwgZGV2ZWxvcG1lbnQ8L3U+LiBgcG5wbSBydW4gYnVpbGRgIGFuZCBgcG5wbSBydW4gc3RhcnRgIHdpbGwgd29yayBmaW5lIGluIHRoaXMgYnJvd3Nlci48L3A+PC9ib2R5PicsXG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgbmV4dCgpO1xuICAgICAgfSk7XG4gICAgfSxcbiAgfTtcbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBbVQsU0FBUyxnQ0FBZ0MseUJBQXlCLGNBQWMsdUJBQXVCO0FBQzFaLE9BQU8sWUFBWTtBQUNuQixTQUFTLG9CQUF3QztBQUNqRCxTQUFTLHFCQUFxQjtBQUM5QixTQUFTLDBCQUEwQjtBQUNuQyxPQUFPLG1CQUFtQjtBQUMxQixZQUFZLFlBQVk7QUFHakIsY0FBTyxFQUFFLE1BQU0sYUFBYSxDQUFDO0FBQzdCLGNBQU8sRUFBRSxNQUFNLE9BQU8sQ0FBQztBQUN2QixjQUFPO0FBRWQsSUFBTyxzQkFBUSxhQUFhLENBQUNBLFlBQVc7QUFDdEMsU0FBTztBQUFBLElBQ0wsUUFBUTtBQUFBLE1BQ04sd0JBQXdCLEtBQUssVUFBVSxRQUFRLElBQUksUUFBUTtBQUFBLElBQzdEO0FBQUEsSUFDQSxPQUFPO0FBQUEsTUFDTCxRQUFRO0FBQUEsSUFDVjtBQUFBLElBQ0EsU0FBUztBQUFBLE1BQ1AsY0FBYztBQUFBLFFBQ1osU0FBUyxDQUFDLFVBQVUsV0FBVyxRQUFRLFFBQVE7QUFBQSxRQUMvQyxTQUFTO0FBQUEsVUFDUCxRQUFRO0FBQUEsVUFDUixTQUFTO0FBQUEsVUFDVCxRQUFRO0FBQUEsUUFDVjtBQUFBLFFBQ0EsaUJBQWlCO0FBQUEsUUFDakIsU0FBUyxDQUFDLGlCQUFpQixNQUFNLE1BQU07QUFBQSxNQUN6QyxDQUFDO0FBQUEsTUFDRDtBQUFBLFFBQ0UsTUFBTTtBQUFBLFFBQ04sVUFBVSxNQUFNLElBQUk7QUFDbEIsY0FBSSxHQUFHLFNBQVMsU0FBUyxHQUFHO0FBQzFCLG1CQUFPO0FBQUEsY0FDTCxNQUFNO0FBQUEsRUFBcUMsSUFBSTtBQUFBLGNBQy9DLEtBQUs7QUFBQSxZQUNQO0FBQUEsVUFDRjtBQUVBLGlCQUFPO0FBQUEsUUFDVDtBQUFBLE1BQ0Y7QUFBQSxNQUNBQSxRQUFPLFNBQVMsVUFBVSx3QkFBd0I7QUFBQSxNQUNsRCxnQkFBZ0I7QUFBQSxRQUNkLFFBQVE7QUFBQSxVQUNOLG1CQUFtQjtBQUFBLFVBQ25CLHNCQUFzQjtBQUFBLFVBQ3RCLHFCQUFxQjtBQUFBLFVBQ3JCLHVCQUF1QjtBQUFBLFFBQ3pCO0FBQUEsTUFDRixDQUFDO0FBQUEsTUFDRCxPQUFPO0FBQUEsTUFDUCxjQUFjO0FBQUEsTUFDZCxxQkFBcUI7QUFBQSxNQUNyQkEsUUFBTyxTQUFTLGdCQUFnQixtQkFBbUIsRUFBRSxPQUFPLFFBQVEsQ0FBQztBQUFBLElBQ3ZFO0FBQUEsSUFDQSxXQUFXO0FBQUEsTUFDVDtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLElBQ0Y7QUFBQSxJQUNBLEtBQUs7QUFBQSxNQUNILHFCQUFxQjtBQUFBLFFBQ25CLE1BQU07QUFBQSxVQUNKLEtBQUs7QUFBQSxRQUNQO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFBQSxJQUNBLE1BQU07QUFBQSxNQUNKLFNBQVM7QUFBQSxRQUNQO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQTtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQUEsSUFDQSxjQUFjO0FBQUE7QUFBQTtBQUFBO0FBQUEsTUFJWixTQUFTLENBQUMsWUFBWSxZQUFZLGNBQWMsZUFBZTtBQUFBLElBQ2pFO0FBQUEsSUFDQSxLQUFLO0FBQUE7QUFBQTtBQUFBLE1BR0gsVUFBVSxDQUFDLFVBQVU7QUFBQSxJQUN2QjtBQUFBLElBQ0EsUUFBUTtBQUFBLE1BQ04sY0FBYztBQUFBLElBQ2hCO0FBQUEsRUFDRjtBQUNGLENBQUM7QUFFRCxTQUFTLHVCQUF1QjtBQUM5QixTQUFPO0FBQUEsSUFDTCxNQUFNO0FBQUEsSUFDTixnQkFBZ0IsUUFBdUI7QUFDckMsYUFBTyxZQUFZLElBQUksQ0FBQyxLQUFLLEtBQUssU0FBUztBQUN6QyxjQUFNLE1BQU0sSUFBSSxRQUFRLFlBQVksR0FBRyxNQUFNLDBCQUEwQjtBQUV2RSxZQUFJLEtBQUs7QUFDUCxnQkFBTSxVQUFVLFNBQVMsSUFBSSxDQUFDLEdBQUcsRUFBRTtBQUVuQyxjQUFJLFlBQVksS0FBSztBQUNuQixnQkFBSSxVQUFVLGdCQUFnQixXQUFXO0FBQ3pDLGdCQUFJO0FBQUEsY0FDRjtBQUFBLFlBQ0Y7QUFFQTtBQUFBLFVBQ0Y7QUFBQSxRQUNGO0FBRUEsYUFBSztBQUFBLE1BQ1AsQ0FBQztBQUFBLElBQ0g7QUFBQSxFQUNGO0FBQ0Y7IiwKICAibmFtZXMiOiBbImNvbmZpZyJdCn0K
