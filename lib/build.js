import os from "os";
import path from "path";

import { mkdirp, remove } from "fs-extra";
import { progress, spawn } from "./spawn.js";
import { copyFile } from "./copy-file.js";
import { hostArch, hostPlatform } from "./system.js";
import { log } from "./log.js";
import patchesJson from "../patches/patches.json";
import { tempPath } from "./temp-path.js";
import thresholds from "./thresholds.js";

let buildPath;
if (process.env.GITHUB_TOKEN) {
  buildPath = path.join(__dirname, "..", "precompile");
} else {
  buildPath = tempPath();
}

const configFlags = [
  "--experimental-enable-pointer-compression",
  "--without-inspector",
  "--without-node-snapshot",
  "--without-dtrace",
  "--without-etw",
  "--without-npm",
  "--without-intl",
];

const nodePath = path.join(buildPath, "node");
const patchesPath = path.resolve(__dirname, "../patches");
const nodeRepo = "https://github.com/nodejs/node";

async function gitClone(nodeVersion) {
  log.info("Cloning Node.js repository from GitHub...");
  const args = [
    "clone",
    "-b",
    nodeVersion,
    "--depth",
    "1",
    "--single-branch",
    "--bare",
    "--progress",
    nodeRepo,
    "node/.git",
  ];
  const promise = spawn("git", args, { cwd: buildPath });
  progress(promise, thresholds("clone"));
  await promise;
}

async function gitResetHard(nodeVersion) {
  log.info(`Checking out ${nodeVersion}`);
  const patches = patchesJson[nodeVersion];
  const commit = patches.commit || nodeVersion;
  const args = ["--work-tree", ".", "reset", "--hard", commit];
  await spawn("git", args, { cwd: nodePath });
}

async function applyPatches(nodeVersion) {
  log.info("Applying patches");
  let patches = patchesJson[nodeVersion];
  patches = patches.patches || patches;
  if (patches.sameAs) patches = patchesJson[patches.sameAs];
  for (const patch of patches) {
    const patchPath = path.join(patchesPath, patch);
    const args = ["-p1", "-i", patchPath];
    await spawn("patch", args, { cwd: nodePath });
  }
}

async function compileOnWindows(nodeVersion, targetArch) {
  const args = ["/c", "vcbuild.bat", targetArch, "vs2019", "ltcg"];

  await spawn("cmd", args, {
    cwd: nodePath,
    env: { ...process.env, config_flags: configFlags.join(" ") },
    stdio: "inherit",
  });

  return path.join(nodePath, "out/Release/node.exe");
}

async function compileOnUnix(nodeVersion, targetArch) {
  const args = [...configFlags];

  args.push(
    "--dest-cpu",
    {
      x64: "x64",
      armv6: "arm",
      armv7: "arm",
      arm64: "arm64",
      ppc64: "ppc64",
      s390x: "s390x",
    }[targetArch]
  );

  if (hostArch !== targetArch) {
    log.info("Cross compiling!");
    args.push("--cross-compiling");
  }

  if (hostPlatform === "linux" || hostPlatform === "linuxstatic") {
    args.push("--enable-lto");
  }

  if (hostPlatform === "linuxstatic") {
    args.push("--fully-static");
  } else if (hostPlatform !== "macos") {
    args.push("--partly-static");
  }

  // TODO same for windows?
  await spawn("./configure", args, { cwd: nodePath });

  await spawn(
    hostPlatform === "freebsd" ? "gmake" : "make",
    [`-j${os.cpus().length}`],
    {
      cwd: nodePath,
      stdio: "inherit",
    }
  );

  const output = path.join(nodePath, "out/Release/node");

  if (hostArch === targetArch) {
    await spawn("strip", [output]);
  }

  return output;
}

async function compile(nodeVersion, targetArch) {
  log.info("Compiling Node.js from sources...");
  const win = hostPlatform === "win";
  if (win) return await compileOnWindows(nodeVersion, targetArch);
  return await compileOnUnix(nodeVersion, targetArch);
}

export default async function build(nodeVersion, targetArch, local) {
  await remove(buildPath);
  await mkdirp(buildPath);
  await gitClone(nodeVersion);
  await gitResetHard(nodeVersion);
  await applyPatches(nodeVersion);
  const output = await compile(nodeVersion, targetArch);
  await mkdirp(path.dirname(local));
  await copyFile(output, local);
  await remove(buildPath);
}
