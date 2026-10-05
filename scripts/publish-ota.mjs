import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

// Publishes the frontend as a signed OTA bundle to surge.sh.
//
// Every channel is its own surge project (see OTA_SURGE_DOMAIN_TEMPLATE), because
// a surge deploy replaces the whole site — this way a development deploy never
// wipes the main channel. The app reads `https://<domain>/latest.json`
// (see `plugins.hotswap.endpoint` in src-tauri/tauri.conf.json).

const DEFAULT_DOMAIN_TEMPLATE = "freegrind-ota-{channel}.surge.sh";

function parseCliArgs(argv) {
  let channelOverride;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      console.log("Usage: bun run ota -- [-main|-development|--channel <name>]");
      console.log("  -main          Publish to the main OTA channel");
      console.log("  -development   Publish to the development OTA channel");
      console.log("  --channel      Publish to a custom OTA channel");
      console.log();
      console.log("Required env (.env.local): SURGE_LOGIN, SURGE_TOKEN,");
      console.log("  HOTSWAP_PRIVATE_KEY or HOTSWAP_PRIVATE_KEY_PATH");
      console.log("Optional env: HOTSWAP_PRIVATE_KEY_PASSWORD, OTA_NOTES, OTA_MANDATORY,");
      console.log("  OTA_MIN_BINARY_VERSION, OTA_SKIP_BUILD, OTA_SURGE_DOMAIN_TEMPLATE");
      process.exit(0);
    }

    if (arg === "-main") {
      channelOverride = "main";
      continue;
    }

    if (arg === "-development") {
      channelOverride = "development";
      continue;
    }
  }

  const channelFlagIndex = argv.findIndex((arg) => arg === "--channel");
  if (channelFlagIndex !== -1) {
    const value = argv[channelFlagIndex + 1];
    if (!value) {
      throw new Error("--channel requires a value");
    }
    channelOverride = value;
  }

  return { channelOverride };
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex < 1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

const { channelOverride } = parseCliArgs(process.argv.slice(2));

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit" });
}

const otaChannel = channelOverride || process.env.OTA_CHANNEL || "development";
if (!/^[a-z0-9-]{1,40}$/.test(otaChannel)) {
  throw new Error(`Invalid OTA channel "${otaChannel}" (must be a valid hostname label)`);
}

requireEnv("SURGE_LOGIN");
requireEnv("SURGE_TOKEN");

const domainTemplate = process.env.OTA_SURGE_DOMAIN_TEMPLATE || DEFAULT_DOMAIN_TEMPLATE;
const domain = domainTemplate.replace("{channel}", otaChannel);

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const appVersion = pkg.version;
// Unix seconds: monotonic across deploys and well above the sequences the old
// backend handed out, so already-installed clients still see this as newer.
const sequence = Math.floor(Date.now() / 1000);
const otaVersion = `${appVersion}-ota.${otaChannel}.${sequence}`;
const minBinaryVersion = process.env.OTA_MIN_BINARY_VERSION || appVersion;
const notes = process.env.OTA_NOTES || `OTA ${otaChannel} ${new Date().toISOString()}`;
const mandatory = process.env.OTA_MANDATORY === "true";

let keyValue = process.env.HOTSWAP_PRIVATE_KEY?.trim();
const keyPath = process.env.HOTSWAP_PRIVATE_KEY_PATH;
if (!keyValue && keyPath && existsSync(path.resolve(keyPath))) {
  keyValue = readFileSync(path.resolve(keyPath), "utf8").trim();
}
if (!keyValue) {
  throw new Error(
    "HOTSWAP private key not found. Set HOTSWAP_PRIVATE_KEY or HOTSWAP_PRIVATE_KEY_PATH.",
  );
}
const keyPassword = process.env.HOTSWAP_PRIVATE_KEY_PASSWORD ?? "";

console.log(`Publishing OTA channel=${otaChannel} version=${otaVersion} -> https://${domain}`);

if (process.env.OTA_SKIP_BUILD !== "true") {
  run("bun", ["run", "build"]);
}
run("tar", ["-czf", "frontend.tar.gz", "-C", "dist", "."]);
run("bunx", ["tauri", "signer", "sign", "frontend.tar.gz", "-k", keyValue, "-p", keyPassword]);
const signature = readFileSync("frontend.tar.gz.sig", "utf8").trim();

// Bundle file name carries the sequence so a client that fetched the previous
// manifest never downloads a mismatched bundle mid-deploy from a CDN edge cache.
const bundleName = `frontend-${sequence}.tar.gz`;
const bundleUrl = `https://${domain}/${bundleName}`;
const siteDir = path.resolve(".ota-surge");

rmSync(siteDir, { recursive: true, force: true });
mkdirSync(siteDir, { recursive: true });
copyFileSync("frontend.tar.gz", path.join(siteDir, bundleName));

const manifest = {
  version: otaVersion,
  sequence,
  url: bundleUrl,
  signature,
  min_binary_version: minBinaryVersion,
  notes,
  pub_date: new Date().toISOString(),
  mandatory,
  bundle_size: statSync("frontend.tar.gz").size,
};
writeFileSync(path.join(siteDir, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

try {
  run("bunx", ["surge", siteDir, domain]);
} finally {
  rmSync(siteDir, { recursive: true, force: true });
}

console.log("OTA published successfully:");
console.log(JSON.stringify({ channel: otaChannel, version: otaVersion, sequence, bundle_url: bundleUrl }, null, 2));

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `ota_version=${otaVersion}\nota_sequence=${sequence}\nota_bundle_url=${bundleUrl}\n`,
  );
}
