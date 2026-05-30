import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

function collectTrackedTestFiles() {
  const result = spawnSync("git", [
    "ls-files",
    "--",
    "src/**/*.test.ts",
  ], {
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    throw new Error("Unable to list Git-tracked test files.");
  }

  return result.stdout
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((file) => resolve(file));
}

const explicitTestFiles = process.argv
  .slice(2)
  .map((file) => resolve(file));
const testFiles = (
  explicitTestFiles.length > 0
    ? explicitTestFiles
    : collectTrackedTestFiles()
).sort();

if (testFiles.length === 0) {
  console.log("No test files found under src; skipping.");
  process.exit(0);
}

const args = [
  "-r",
  "ts-node/register",
  "-r",
  "tsconfig-paths/register",
  "--test",
  "--test-concurrency=1",
  ...testFiles,
];

const result = spawnSync(process.execPath, args, {
  stdio: "inherit",
});

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);
