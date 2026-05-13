import { spawn } from "node:child_process";
import { parseArgs } from "node:util";

const args = process.argv.slice(2);

const { values } = parseArgs({
  args,
  allowPositionals: false,
  options: {
    help: { type: "boolean", short: "h" },
    "force-build": { type: "boolean" },
    targets: { type: "string", multiple: true },
    target: { type: "string", multiple: true, short: "t" },
    "targets-file": { type: "string", multiple: true },
  },
});

function printHelp() {
  console.log(`Build local generated preview assets.

Usage:
  npm run catalog:build
  npm run catalog:build -- --force-build
  npm run catalog:build -- --targets public/glb/raspberry_pi_5.glb
  npm run catalog:build -- --targets-file /tmp/changed-steps.txt

Options:
  --force-build             Accepted for compatibility; selected GLB/PNG assets are rebuilt
  --targets, --target, -t   Comma-separated or repeatable target files to build
  --targets-file            Read target files from a newline-delimited list
`);
}

function runNodeScript(scriptPath, scriptArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...scriptArgs], {
      cwd: process.cwd(),
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${scriptPath} exited with code ${code}`));
    });
  });
}

if (values.help) {
  printHelp();
  process.exit(0);
}

try {
  await runNodeScript("scripts/export-assets.mjs", args);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
