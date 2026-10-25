import fsLite from "unstorage/drivers/fs-lite";

// Only the primary handles session-bearing requests. Keep sessions off the
// immutable Nix store; a manual failover requires signing in again.
export default function sessionDriver() {
  return fsLite({ base: process.env.EMDASH_SESSION_PATH ?? "./data/sessions" });
}
