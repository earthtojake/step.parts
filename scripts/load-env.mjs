import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const initialEnvKeys = new Set(Object.keys(process.env));

function parseEnvValue(rawValue) {
  const value = rawValue.trim();
  const quote = value[0];
  if ((quote === "\"" || quote === "'") && value[value.length - 1] === quote) {
    const unquoted = value.slice(1, -1);
    if (quote === "\"") {
      return unquoted.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\"/g, "\"");
    }

    return unquoted;
  }

  return value;
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const normalized = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
    const separatorIndex = normalized.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = normalized.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || initialEnvKeys.has(key)) {
      continue;
    }

    process.env[key] = parseEnvValue(normalized.slice(separatorIndex + 1));
  }
}

const mode = process.env.NODE_ENV;
const envFiles = [
  ".env",
  mode ? `.env.${mode}` : null,
  ".env.local",
  mode ? `.env.${mode}.local` : null,
].filter(Boolean);

for (const envFile of envFiles) {
  loadEnvFile(path.join(process.cwd(), envFile));
}
