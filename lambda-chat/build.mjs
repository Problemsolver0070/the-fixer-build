// lambda-chat/build.mjs
// Bundles the Lambda handler + shared src/lib modules into a single file.

import { build } from "esbuild";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

await build({
  entryPoints: [resolve(__dirname, "src/handler.ts")],
  bundle: true,
  outfile: resolve(__dirname, "dist/index.mjs"),
  format: "esm",
  platform: "node",
  target: "node20",
  sourcemap: true,

  // Mark Node.js built-ins and AWS Lambda runtime as external
  external: [
    "aws-sdk",
    "awslambda",   // AWS Lambda streaming runtime global
  ],

  // Resolve the @/ path alias used by the shared modules
  alias: {
    "@": resolve(projectRoot, "src"),
  },

  // Banner to declare the awslambda global (provided by Lambda runtime)
  banner: {
    js: "/* Bundled by esbuild — do not edit */",
  },

  // Log build results
  logLevel: "info",
});

console.log("Lambda build complete: lambda-chat/dist/index.mjs");
