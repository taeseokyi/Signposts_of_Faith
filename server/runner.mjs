// claude CLI 를 비대화형으로 돌립니다. 세 가지 쓰임이 있습니다.
//   run(prompt)        content.md 초안을 JSON 스키마로 받기
//   runJson(prompt)    임의의 JSON 스키마로 받기 (노트 사진에서 그 날짜 부분 찾기)
//   stream(prompt)     대화 한 턴. --resume 으로 세션을 이어 가고, 글자가 나오는 대로 콜백으로 흘려 줍니다
//
// --bare 는 쓰지 않습니다. bare 모드는 구독 로그인(OAuth)을 읽지 않고
// ANTHROPIC_API_KEY 를 요구하기 때문에, 구독으로 돌리려면 일반 -p 모드여야 합니다.
//
// 작업 폴더는 저장소 루트입니다. CLI 가 WORKFLOW.md, template/, 날짜 폴더의 대화와 사진을
// Read 도구로 직접 읽습니다. 쓰기 도구는 주지 않으므로 저장소를 고치지는 못합니다.

import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

import { run, splitCommand } from "./exec.mjs";
import { DRAFT_SCHEMA } from "./prompt.mjs";

export class ClaudeRunner {
  constructor({ bin = "claude", model, timeoutMs = 20 * 60 * 1000, cwd }) {
    this.bin = bin;
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.cwd = cwd;
  }

  baseArgs({ maxTurns }) {
    const args = [
      // 문서와 사진을 읽어야 하므로 Read 만 허용합니다.
      "--tools",
      "Read",
      "--allowedTools",
      "Read",
      // 사람이 답할 수 없는 자리이므로 물어보지 않게 합니다.
      "--permission-prompts",
      "none",
      "--max-turns",
      String(maxTurns),
    ];
    if (this.model) args.push("--model", this.model);
    return args;
  }

  buildArgs(prompt, { schema = DRAFT_SCHEMA, maxTurns = 40 } = {}) {
    // 읽을 파일이 여럿(WORKFLOW, 템플릿, 본보기, 대화, 사진)이라 턴을 넉넉히 둡니다.
    return ["-p", prompt, "--output-format", "json", "--json-schema", JSON.stringify(schema), ...this.baseArgs({ maxTurns })];
  }

  /** JSON 스키마대로 답을 받습니다. @returns {Promise<{output: object, costUsd: number|null, raw: object}>} */
  async runJson(prompt, { schema, maxTurns = 40, logPath } = {}) {
    const args = this.buildArgs(prompt, { schema, maxTurns });
    const { stdout, stderr, code } = await run(this.bin, args, { cwd: this.cwd, timeoutMs: this.timeoutMs });

    if (logPath) {
      await writeFile(
        logPath,
        `$ ${this.bin} ${this.buildArgs("<prompt>", { schema, maxTurns }).join(" ")}\n\n` +
          `--- prompt ---\n${prompt}\n\n` +
          `--- exit ${code} ---\n\n--- stdout ---\n${stdout}\n\n--- stderr ---\n${stderr}\n`,
        "utf8"
      ).catch(() => {});
    }

    if (code !== 0) {
      throw new Error(`claude CLI가 코드 ${code}로 끝났습니다.\n${(stderr || stdout).slice(0, 600)}`);
    }

    let payload;
    try {
      payload = JSON.parse(stdout);
    } catch {
      throw new Error(`claude 출력이 JSON이 아닙니다.\n${stdout.slice(0, 600)}`);
    }
    if (payload.is_error) {
      throw new Error(`claude가 오류로 끝났습니다: ${String(payload.result ?? "").slice(0, 600)}`);
    }

    // --json-schema 를 쓰면 structured_output 에 들어옵니다. 형식을 못 맞추면 그 필드가 없습니다.
    if (!payload.structured_output || typeof payload.structured_output !== "object") {
      throw new Error(`구조화된 답을 받지 못했습니다.\n${String(payload.result ?? "").slice(0, 600)}`);
    }
    return {
      output: payload.structured_output,
      costUsd: typeof payload.total_cost_usd === "number" ? payload.total_cost_usd : null,
      raw: payload,
    };
  }

  /**
   * content.md 초안.
   * @returns {Promise<{draft: {content_md: string, record_md: string, review: string[], hold: boolean, holdReason: string}, costUsd: number|null}>}
   */
  async run(prompt, { logPath } = {}) {
    const { output: s, costUsd } = await this.runJson(prompt, { schema: DRAFT_SCHEMA, maxTurns: 40, logPath });
    if (typeof s.content_md !== "string" || !s.content_md.trim()) {
      throw new Error("구조화된 초안을 받지 못했습니다 (content_md 가 비어 있습니다).");
    }
    return {
      draft: {
        content_md: s.content_md.replace(/\r\n/g, "\n").trimEnd() + "\n",
        record_md: String(s.record_md ?? "").replace(/\r\n/g, "\n").trim(),
        review: Array.isArray(s.review) ? s.review.map((r) => String(r).trim()).filter(Boolean) : [],
        hold: Boolean(s.hold),
        holdReason: String(s.hold_reason ?? "").trim(),
      },
      costUsd,
    };
  }

  /**
   * 대화 한 턴. stream-json 으로 받아 글자가 나오는 대로 onDelta 를 부릅니다.
   *   resume 이 있으면 그 세션을 이어 갑니다 (CLI 가 처음 기록한 시스템 프롬프트를 그대로 다시 씁니다).
   *   systemPrompt 는 첫 턴에만 뜻이 있습니다.
   * @returns {Promise<{text: string, sessionId: string|null, costUsd: number|null}>}
   */
  stream(prompt, { systemPrompt, resume, maxTurns = 12, onDelta, onStatus, timeoutMs = 15 * 60 * 1000 } = {}) {
    const args = ["-p", prompt, "--output-format", "stream-json", "--verbose", "--include-partial-messages", ...this.baseArgs({ maxTurns })];
    if (resume) args.push("--resume", resume);
    else if (systemPrompt) args.push("--system-prompt", systemPrompt);

    const { command, prefix } = splitCommand(this.bin);
    return new Promise((resolve, reject) => {
      const child = spawn(command, [...prefix, ...args], {
        cwd: this.cwd,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      const blocks = []; // 텍스트 블록마다 모읍니다 (도구를 쓰면 블록이 여럿일 수 있습니다)
      let current = -1;
      let result = null;
      let stderr = "";
      let buf = "";
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGTERM");
        reject(new Error(`claude 가 ${Math.round(timeoutMs / 1000)}초 안에 답하지 않았습니다.`));
      }, timeoutMs);

      const handle = (line) => {
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          return;
        }
        if (ev.type === "stream_event") {
          const e = ev.event;
          if (e?.type === "content_block_start") {
            if (e.content_block?.type === "text") {
              current = blocks.push("") - 1;
            } else if (e.content_block?.type === "tool_use") {
              current = -1;
              onStatus?.(e.content_block.name === "Read" ? "파일을 읽는 중…" : `${e.content_block.name} 도구를 쓰는 중…`);
            }
          } else if (e?.type === "content_block_delta" && e.delta?.type === "text_delta" && current >= 0) {
            blocks[current] += e.delta.text;
            onDelta?.(e.delta.text);
          } else if (e?.type === "content_block_stop") {
            current = -1;
          }
        } else if (ev.type === "result") {
          result = ev;
        }
      };

      child.stdout.on("data", (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (line) handle(line);
        }
      });
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err.code === "ENOENT" ? new Error(`${command} 명령을 찾지 못했습니다. .env.local 의 CLAUDE_BIN 을 확인해 주세요.`) : err);
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (buf.trim()) handle(buf.trim());
        if (code !== 0) {
          reject(new Error(`claude CLI가 코드 ${code}로 끝났습니다.\n${(stderr || "").slice(0, 600)}`));
          return;
        }
        if (result?.is_error) {
          reject(new Error(`claude가 오류로 끝났습니다: ${String(result.result ?? "").slice(0, 600)}`));
          return;
        }
        const text = blocks.map((b) => b.trim()).filter(Boolean).join("\n\n") || String(result?.result ?? "").trim();
        resolve({
          text,
          sessionId: result?.session_id ?? null,
          costUsd: typeof result?.total_cost_usd === "number" ? result.total_cost_usd : null,
        });
      });
    });
  }
}
