// Preload registers timers only. Never do network/SQLite work before Astro starts.
export function scheduleBackups({
  env = process.env,
  setTimeout: timeout = setTimeout,
  setInterval: interval = setInterval,
  load = () => import("./backup-database.mjs"),
  log = console.error,
} = {}) {
  if (
    env.EMDASH_BACKUPS_ENABLED !== "true" ||
    !env.FLY_MACHINE_ID ||
    env.FLY_MACHINE_ID !== env.PRIMARY_MACHINE_ID ||
    env.EMDASH_READ_ONLY !== "false"
  )
    return null;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { runBackup } = await load();
      await runBackup({ env, onlyIfDue: true });
    } catch (error) {
      // Do not log SDK errors/objects that could carry credentials or request details.
      log(JSON.stringify({ event: "backup-failed", error: error.name }));
    } finally {
      running = false;
    }
  };
  const first = timeout(tick, 5 * 60 * 1000);
  const hourly = interval(tick, 60 * 60 * 1000);
  first.unref();
  hourly.unref();
  return { first, hourly, tick };
}

scheduleBackups();
