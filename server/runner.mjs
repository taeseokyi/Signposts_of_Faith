// claude CLI 를 비대화형으로 돌려 content.md 초안을 받아옵니다.
//
// --bare 는 쓰지 않습니다. bare 모드는 구독 로그인(OAuth)을 읽지 않고
// ANTHROPIC_API_KEY 를 요구하기 때문에, 구독으로 돌리려면 일반 -p 모드여야 합니다.
//
// 작업 폴더는 저장소 루트입니다. CLI 가 WORKFLOW.md, template/, 날짜 폴더의 대화와 사진을
// Read 도구로 직접 읽습니다. 쓰기 도구는 주지 않으므로 저장소를 고치지는 못합니다.

import { writeFile } from "node:fs/promises";

import { run } from "./exec.mjs";
import { DRAFT_SCHEMA } from "./prompt.mjs";

export class ClaudeRunner {
  constructor({ bin = "claude", model, timeoutMs = 20 * 60 * 1000, cwd }) {
    this.bin = bin;
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.cwd = cwd;
  }

  buildArgs(prompt) {
    const args = [
      "-p",
      prompt,
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(DRAFT_SCHEMA),
      // 문서와 사진을 읽어야 하므로 Read 만 허용합니다.
      "--tools",
      "Read",
      "--allowedTools",
      "Read",
      // 사람이 답할 수 없는 자리이므로 물어보지 않게 합니다.
      "--permission-prompts",
      "none",
      // 읽을 파일이 여럿(WORKFLOW, 템플릿, 본보기, 대화, 사진)이라 넉넉히 둡니다.
      "--max-turns",
      "40",
    ];
    if (this.model) args.push("--model", this.model);
    return args;
  }

  /**
   * @returns {Promise<{draft: {content_md: string, record_md: string, review: string[]}, costUsd: number|null}>}
   */
  async run(prompt, { logPath } = {}) {
    const args = this.buildArgs(prompt);
    const { stdout, stderr, code } = await run(this.bin, args, { cwd: this.cwd, timeoutMs: this.timeoutMs });

    if (logPath) {
      await writeFile(
        logPath,
        `$ ${this.bin} ${this.buildArgs("<prompt>").join(" ")}\n\n` +
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
    const s = payload.structured_output;
    if (!s || typeof s.content_md !== "string" || !s.content_md.trim()) {
      throw new Error(`구조화된 초안을 받지 못했습니다.\n${String(payload.result ?? "").slice(0, 600)}`);
    }

    return {
      draft: {
        content_md: s.content_md.replace(/\r\n/g, "\n").trimEnd() + "\n",
        record_md: String(s.record_md ?? "").replace(/\r\n/g, "\n").trim(),
        review: Array.isArray(s.review) ? s.review.map((r) => String(r).trim()).filter(Boolean) : [],
      },
      costUsd: typeof payload.total_cost_usd === "number" ? payload.total_cost_usd : null,
    };
  }
}
