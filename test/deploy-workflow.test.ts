import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";

const workflow = parse(readFileSync(".github/workflows/push.yaml", "utf8"));
const script = workflow.jobs.docker.steps.find(
  (step: { name?: string }) => step.name === "Deploy primary, then replicas",
).run;
const bash = process.env
  .PATH!.split(delimiter)
  .map((path) => join(path, "bash"))
  .find(existsSync)!;

function deploy(primary: string, replicas: string, failPrimary = false) {
  const root = mkdtempSync(join(tmpdir(), "site-deploy-test-"));
  try {
    const bin = join(root, "bin");
    mkdirSync(bin);
    const log = join(root, "calls");
    // No real nix/Fly executable is reachable by the workflow under test.
    writeFileSync(
      join(bin, "nix"),
      `#!${process.execPath}
import { appendFileSync } from "node:fs";
appendFileSync(process.env.LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
if (process.env.FAIL_PRIMARY === "true") process.exit(1);
`,
      { mode: 0o700 },
    );
    const path = join(root, "deploy.bash");
    writeFileSync(path, `set -e\n${script}`);
    const result = spawnSync(bash, [path], {
      encoding: "utf8",
      env: {
        PATH: bin,
        LOG: log,
        FAIL_PRIMARY: String(failPrimary),
        PRIMARY_MACHINE_ID: primary,
        REPLICA_MACHINE_IDS: replicas,
        DEPLOY_IMAGE: "ghcr.io/ovyerus/site@sha256:fixture",
      },
    });
    const calls = existsSync(log)
      ? readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line))
      : [];
    return { ...result, calls };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("deployment workflow", () => {
  test("deploys main pushes and keeps manual dispatch available", () => {
    expect(workflow.on).toEqual({
      push: { branches: ["main"] },
      workflow_dispatch: null,
    });
    expect(workflow.jobs.docker.if).toBe("github.ref == 'refs/heads/main'");
  });
  test("serializes deployments without cancelling a running rollout", () => {
    expect(workflow.jobs.docker.concurrency).toEqual({
      group: "site-production",
      "cancel-in-progress": false,
    });
  });
  test("does not update replicas if the primary deployment fails", () => {
    const result = deploy("a1", "b2,c3", true);
    expect(result.status).not.toBe(0);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]).toEqual(
      expect.arrayContaining(["--only-machines", "a1"]),
    );
  });
  test("shell syntax is valid", () => {
    execFileSync(bash, ["-n"], { input: script });
  });
  test.each([
    ["", "b2,c3"],
    ["a1", ""],
    ["a1", "b2"],
    ["a1", "b2,b2"],
    ["a1", "a1,c3"],
    ["a1", "b2,c3,d4"],
  ])(
    "rejects unsafe target selection (%s / %s) without invoking deployment",
    (primary, replicas) => {
      const result = deploy(primary, replicas);
      expect(result.status).not.toBe(0);
      expect(result.calls).toEqual([]);
    },
  );
  test("deploys exactly the primary, then two explicit replicas with one digest", () => {
    const result = deploy("a1", "b2,c3");
    expect(result.status, result.stderr).toBe(0);
    expect(result.calls).toHaveLength(2);
    expect(result.calls[0]).toEqual([
      "develop",
      "--command",
      "fly",
      "deploy",
      "--image",
      "ghcr.io/ovyerus/site@sha256:fixture",
      "--only-machines",
      "a1",
      "--strategy",
      "rolling",
      "--update-only",
      "--ha=false",
    ]);
    expect(result.calls[1]).toEqual([
      "develop",
      "--command",
      "fly",
      "deploy",
      "--image",
      "ghcr.io/ovyerus/site@sha256:fixture",
      "--only-machines",
      "b2,c3",
      "--strategy",
      "rolling",
      "--update-only",
      "--ha=false",
    ]);
  });
});
