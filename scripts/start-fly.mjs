import { spawn } from "node:child_process";
import { accessSync, constants, statfsSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { delimiter, dirname, join, resolve } from "node:path";

const script = fileURLToPath(import.meta.url);
const siteRoot = dirname(dirname(script));
const FUSE_MAGIC = 0x65735546;

export function requireLitefsMount(statfs = statfsSync) {
  if (statfs("/litefs").type !== FUSE_MAGIC)
    throw new Error(
      "/litefs is not a FUSE mount; refusing unreplicated database access",
    );
}

export function flyRole(env) {
  const {
    FLY_MACHINE_ID: machine,
    PRIMARY_MACHINE_ID: primary,
    FLY_APP_NAME: app,
  } = env;
  if (!machine || !/^[a-z0-9]+$/.test(machine))
    throw new Error("FLY_MACHINE_ID is required");
  if (!primary || !/^[a-z0-9]+$/.test(primary))
    throw new Error(
      "PRIMARY_MACHINE_ID is required (fixed Sydney writer; no automatic failover)",
    );
  if (!app || !/^[a-z0-9-]+$/.test(app))
    throw new Error("FLY_APP_NAME is required");
  return {
    primary: machine === primary,
    primaryMachineId: primary,
    primaryHostname: `${primary}.vm.${app}.internal`,
  };
}

export function litefsConfig(role) {
  return `fuse:
  dir: /litefs
data:
  dir: /data/litefs
http:
  addr: '[::]:20202'
proxy:
  addr: '[::]:8080'
  target: '127.0.0.1:8081'
  db: emdash.db
  max-lag: 10s
  always-forward: ['/_emdash', '/_emdash/*']
lease:
  type: static
  hostname: '${role.primaryMachineId}'
  advertise-url: 'http://${role.primaryHostname}:20202'
  candidate: ${role.primary}
`;
}

// Keep only LiteFS and the serving Node process resident. An idle Node
// supervisor costs ~11 MiB on the 256 MiB Fly VM; exec also delivers signals
// directly to the process that owns shutdown. Resolve PATH before execve,
// which (unlike spawn) does not search it.
export function executablePath(command, env, cwd = siteRoot) {
  const candidates = command.includes("/")
    ? [resolve(cwd, command)]
    : (env.PATH ?? "")
        .split(delimiter)
        .map((dir) => resolve(cwd, dir, command));
  for (const path of candidates) {
    try {
      accessSync(path, constants.X_OK);
      if (statSync(path).isFile()) return path;
    } catch {
      /* Try the next PATH entry. */
    }
  }
  throw new Error(`Executable not found or not executable: ${command}`);
}

export function replaceProcess(command, args, env) {
  const executable = executablePath(command, env);
  process.chdir(siteRoot);
  process.execve(executable, [command, ...args], env);
}

function child(command, args, env) {
  return new Promise((resolve, reject) => {
    const subprocess = spawn(command, args, {
      cwd: siteRoot,
      env,
      stdio: "inherit",
    });
    const handlers = ["SIGTERM", "SIGINT"].map((signal) => {
      const handler = () => subprocess.kill(signal);
      process.on(signal, handler);
      return [signal, handler];
    });
    const cleanup = () => {
      for (const [signal, handler] of handlers) process.off(signal, handler);
    };
    subprocess.on("error", (error) => {
      cleanup();
      reject(error);
    });
    subprocess.on("exit", (code, signal) => {
      cleanup();
      resolve(
        code ?? (signal ? 128 + ({ SIGINT: 2, SIGTERM: 15 }[signal] ?? 1) : 1),
      );
    });
  });
}

export async function start(env = process.env, mode = process.argv[2]) {
  const role = flyRole(env);
  const runtime = {
    ...env,
    EMDASH_READ_ONLY: role.primary ? "false" : "true",
    EMDASH_DATABASE_URL: "file:/litefs/emdash.db",
    EMDASH_MIGRATIONS_MODE: "check",
    EMDASH_STORAGE: "s3",
    EMDASH_SESSION_PATH: "/data/sessions",
    HOST: "127.0.0.1",
    PORT: "8081",
    NODE_ENV: "production",
  };
  if (mode === "--serve") {
    requireLitefsMount();
    if (role.primary) {
      const prepared = await child(
        process.execPath,
        [
          join(siteRoot, "scripts/prepare-database.mjs"),
          ...(env.EMDASH_BOOTSTRAP === "true" ? ["--bootstrap"] : []),
        ],
        runtime,
      );
      if (prepared !== 0) return prepared;
    }
    return replaceProcess(
      process.execPath,
      [join(siteRoot, "dist/server/entry.mjs")],
      runtime,
    );
  }
  if (mode !== undefined && mode !== "--bootstrap")
    throw new Error(`Unknown start-fly argument: ${mode}`);
  if (mode === "--bootstrap" && !role.primary)
    throw new Error("Only fixed primary can bootstrap");
  await mkdir("/data/litefs", { recursive: true });
  await mkdir("/litefs", { recursive: true });
  await writeFile("/tmp/litefs.yml", litefsConfig(role), { mode: 0o600 });
  return replaceProcess(
    env.LITEFS_BIN ?? "litefs",
    [
      "mount",
      "-config",
      "/tmp/litefs.yml",
      "--",
      process.execPath,
      ...(mode === "--bootstrap"
        ? [join(siteRoot, "scripts/prepare-database.mjs"), "--bootstrap"]
        : [script, "--serve"]),
    ],
    runtime,
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) ===
    fileURLToPath(new URL(`file://${process.argv[1]}`))
) {
  try {
    process.exitCode = await start();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
