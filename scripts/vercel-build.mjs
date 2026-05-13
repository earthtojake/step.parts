import { spawn } from "node:child_process";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function main() {
  await run("npm", ["run", "build"]);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
