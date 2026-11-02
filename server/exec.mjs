// 바깥 명령(python, git, claude)을 돌리는 공용 도우미.
//
// 명령은 "wsl -d Ubuntu -e /home/me/.local/bin/claude" 처럼 앞에 붙는 인자를 함께 적을 수 있습니다.
// 모든 명령은 저장소 루트를 작업 폴더로 돌리고, 파일 경로는 저장소 기준 상대 경로로 넘깁니다.
// 그래서 Windows 의 node 가 wsl 경유로 부를 때도 경로를 바꿔 줄 필요가 없습니다
// (wsl.exe 는 현재 Windows 폴더를 /mnt/c/... 로 옮겨 시작합니다).

import { spawn } from "node:child_process";
import { platform } from "node:os";

export function splitCommand(text) {
  const [command, ...prefix] = String(text).trim().split(/\s+/);
  return { command, prefix };
}

/**
 * @returns {Promise<{stdout: string, stderr: string, code: number|null}>}
 */
export function run(bin, args, { cwd, timeoutMs = 2 * 60 * 1000, env } = {}) {
  const { command, prefix } = splitCommand(bin);
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...prefix, ...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`${command} 가 ${Math.round(timeoutMs / 1000)}초 안에 끝나지 않았습니다.`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        err.code === "ENOENT"
          ? new Error(`${command} 명령을 찾지 못했습니다. .env.local 의 *_BIN 설정을 확인해 주세요.`)
          : err
      );
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}

export const DEFAULT_PYTHON = platform() === "win32" ? "python" : "python3";

/** python template/build.py … 를 돌립니다. */
export async function python(args, { cwd, bin = process.env.PYTHON_BIN || DEFAULT_PYTHON, timeoutMs } = {}) {
  return run(bin, ["template/build.py", ...args], { cwd, timeoutMs, env: { PYTHONIOENCODING: "utf-8" } });
}

/** 저장소 루트에서 git 을 돌립니다. 실패하면 stderr 를 담은 오류를 던집니다. */
export async function git(args, { cwd, bin = process.env.GIT_BIN || "git", timeoutMs = 3 * 60 * 1000 } = {}) {
  const r = await run(bin, args, { cwd, timeoutMs, env: { GIT_TERMINAL_PROMPT: "0", LANG: "C.UTF-8" } });
  if (r.code !== 0) {
    throw new Error(`git ${args[0]} 실패 (코드 ${r.code})\n${(r.stderr || r.stdout).trim().slice(0, 800)}`);
  }
  return r.stdout;
}
