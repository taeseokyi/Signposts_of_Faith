// 날짜 폴더(YYYY-MM-DD/)를 다룹니다. 저장소 작업 폴더 자체가 자료 보관소입니다.
//
//   <저장소>/2026-10-24/
//     대화.md               Claude 와 나눈 대화 원문 (git 제외)
//     노트/photo-1.jpg      묵상 노트 사진 원본 (git 제외)
//     note-2026-10-24.jpg   공개용 노트 사진 (커밋됨)
//     content.md            그날의 글 (커밋됨)
//   <저장소>/server/data/2026-10-24/
//     chat.json             화면에서 claude 와 주고받은 대화 (세션 ID, 메시지). 대화.md 는 여기서 만든다
//     scrap.json            노트 사진에서 그 날짜 부분을 찾은 결과 (자를 영역 제안)
//     readings.json         굿뉴스 매일미사에서 가져온 그날의 전례일과 독서·복음 본문
//     job.json              초안 작업 상태
//     draft.md              claude 가 낸 초안
//     record.md             WORKFLOW.md 8장에 붙일 기록
//     claude-N.log          CLI 원본 출력

import { mkdir, readFile, writeFile, readdir, rm, stat, copyFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { readingsBlock } from "./readings.mjs";

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const IMAGE_RE = /\.(jpe?g|png|webp|heic)$/i;
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic" };

async function exists(p) {
  return stat(p).then(() => true, () => false);
}

async function readText(p) {
  try {
    return await readFile(p, "utf8");
  } catch {
    return null;
  }
}

export class Days {
  constructor(repo, dataDir) {
    this.repo = repo;
    this.data = dataDir;
  }

  dir(date) {
    return join(this.repo, date);
  }

  notesDir(date) {
    return join(this.dir(date), "노트");
  }

  stateDir(date) {
    return join(this.data, date);
  }

  conversationPath(date) {
    return join(this.dir(date), "대화.md");
  }

  contentPath(date) {
    return join(this.dir(date), "content.md");
  }

  draftPath(date) {
    return join(this.stateDir(date), "draft.md");
  }

  recordPath(date) {
    return join(this.stateDir(date), "record.md");
  }

  chatPath(date) {
    return join(this.stateDir(date), "chat.json");
  }

  scrapPath(date) {
    return join(this.stateDir(date), "scrap.json");
  }

  readingsPath(date) {
    return join(this.stateDir(date), "readings.json");
  }

  async readings(date) {
    const raw = await readText(this.readingsPath(date));
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async saveReadings(date, readings) {
    await mkdir(this.stateDir(date), { recursive: true });
    await writeFile(this.readingsPath(date), JSON.stringify(readings, null, 2), "utf8");
    // 대화.md 첫머리의 말씀 절도 맞춘다
    const chat = await this.chat(date);
    if (chat.messages.length) await this.writeConversation(date, conversationMarkdown(date, chat.messages, readings));
    return readings;
  }

  /** 묵상하다 떠오른 구절을 그날 말씀에 더합니다. 같은 장절이 이미 있으면 그대로 둡니다. */
  async addExtra(date, passage) {
    const r = (await this.readings(date)) ?? { date, title: "", color: "", readings: [] };
    const extra = r.extra ?? [];
    if (!extra.some((x) => x.ref === passage.ref)) extra.push({ ...passage, addedAt: new Date().toISOString() });
    return this.saveReadings(date, { ...r, extra });
  }

  async removeExtra(date, ref) {
    const r = await this.readings(date);
    if (!r) return null;
    return this.saveReadings(date, { ...r, extra: (r.extra ?? []).filter((x) => x.ref !== ref) });
  }

  async list() {
    const entries = await readdir(this.repo, { withFileTypes: true }).catch(() => []);
    const dates = entries.filter((e) => e.isDirectory() && DAY_RE.test(e.name)).map((e) => e.name);
    const out = [];
    for (const date of dates.sort().reverse()) out.push(await this.summary(date));
    return out;
  }

  async create(date) {
    await mkdir(this.notesDir(date), { recursive: true });
    await mkdir(this.stateDir(date), { recursive: true });
    return this.summary(date);
  }

  async exists(date) {
    return exists(this.dir(date));
  }

  async summary(date) {
    const job = await this.job(date);
    const content = await readText(this.contentPath(date));
    const chat = await this.chat(date);
    return {
      date,
      hasConversation: await exists(this.conversationPath(date)),
      chatTurns: chat.messages.filter((m) => m.role === "user").length,
      milestones: content ? countMilestones(content) : null,
      noteCount: (await this.notePhotos(date)).length,
      publicPhotos: await this.publicPhotos(date),
      hasContent: content != null,
      subtitle: content ? subtitleOf(content) : null,
      hasDraft: await exists(this.draftPath(date)),
      job: job && {
        status: job.status,
        mode: job.mode,
        extend: Boolean(job.extend),
        extendFrom: job.extendFrom ?? null,
        attempts: job.attempts,
        error: job.error,
        hold: job.hold,
        holdReason: job.holdReason,
        title: job.title,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        publish: job.publish && { commit: job.publish.commit, pushed: job.publish.pushed, pushError: job.publish.pushError, url: job.publish.url },
      },
    };
  }

  async detail(date) {
    const base = await this.summary(date);
    return {
      ...base,
      conversation: (await readText(this.conversationPath(date))) ?? "",
      chat: await this.chat(date),
      scrap: await this.scrap(date),
      content: (await readText(this.contentPath(date))) ?? "",
      notes: await this.notePhotos(date),
      draft: (await readText(this.draftPath(date))) ?? "",
      draftMilestones: await readText(this.draftPath(date)).then((d) => (d ? countMilestones(d) : null)),
      record: (await readText(this.recordPath(date))) ?? "",
      readings: await this.readings(date),
      job: await this.job(date),
    };
  }

  // ---------- 대화 ----------

  async writeConversation(date, text) {
    await mkdir(this.dir(date), { recursive: true });
    const clean = String(text).replace(/\r\n/g, "\n").trim();
    if (!clean) {
      await rm(this.conversationPath(date), { force: true });
      return false;
    }
    await writeFile(this.conversationPath(date), clean + "\n", "utf8");
    return true;
  }

  // ---------- 화면 안 대화 ----------

  /** @returns {Promise<{sessionId: string|null, messages: {role: "user"|"assistant", text: string, at: string}[], costUsd: number}>} */
  async chat(date) {
    const raw = await readText(this.chatPath(date));
    try {
      const c = raw ? JSON.parse(raw) : null;
      return { sessionId: c?.sessionId ?? null, messages: Array.isArray(c?.messages) ? c.messages : [], costUsd: Number(c?.costUsd) || 0 };
    } catch {
      return { sessionId: null, messages: [], costUsd: 0 };
    }
  }

  /** 대화를 저장하고, 같은 내용으로 대화.md 를 다시 씁니다 (초안 단계가 읽는 파일). */
  async saveChat(date, chat) {
    await mkdir(this.stateDir(date), { recursive: true });
    await writeFile(this.chatPath(date), JSON.stringify(chat, null, 2), "utf8");
    await this.writeConversation(date, conversationMarkdown(date, chat.messages, await this.readings(date)));
    return chat;
  }

  async clearChat(date) {
    await rm(this.chatPath(date), { force: true });
    await rm(this.conversationPath(date), { force: true });
  }

  // ---------- 노트 사진에서 그 날짜 부분 찾기 ----------

  async scrap(date) {
    const raw = await readText(this.scrapPath(date));
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async saveScrap(date, scrap) {
    await mkdir(this.stateDir(date), { recursive: true });
    await writeFile(this.scrapPath(date), JSON.stringify(scrap, null, 2), "utf8");
    return scrap;
  }

  // ---------- 사진 ----------

  async notePhotos(date) {
    const names = await readdir(this.notesDir(date)).catch(() => []);
    return names.filter((n) => IMAGE_RE.test(n)).sort(naturalCompare);
  }

  async publicPhotos(date) {
    const names = await readdir(this.dir(date)).catch(() => []);
    return names.filter((n) => n.startsWith("note-") && IMAGE_RE.test(n)).sort(naturalCompare);
  }

  /**
   * 사진을 저장합니다.
   *   kind "note"   → 노트/photo-N.ext  (원본 보관, git 제외)
   *   kind "public" → note-YYYY-MM-DD.jpg 또는 note-YYYY-MM-DD-N.jpg (웹사이트에 실림)
   */
  async addPhoto(date, { kind, mediaType, buffer }) {
    const ext = EXT[mediaType] ?? "jpg";
    if (kind === "public") {
      await mkdir(this.dir(date), { recursive: true });
      const have = await this.publicPhotos(date);
      let name = `note-${date}.${ext}`;
      if (have.length) {
        // 두 장째부터는 -1, -2 … 를 붙입니다. 첫 장이 번호 없이 있으면 그것을 -1 로 바꿉니다.
        const first = have.find((n) => n === `note-${date}.jpg` || n === `note-${date}.${ext}`);
        if (first) {
          const firstExt = first.split(".").pop();
          await rename(join(this.dir(date), first), join(this.dir(date), `note-${date}-1.${firstExt}`));
        }
        const nums = (await this.publicPhotos(date))
          .map((n) => Number((/-(\d+)\.\w+$/.exec(n) || [])[1]) || 0);
        name = `note-${date}-${Math.max(0, ...nums) + 1}.${ext}`;
      }
      await writeFile(join(this.dir(date), name), buffer);
      await this.syncPhotoLine(date);
      return name;
    }
    await mkdir(this.notesDir(date), { recursive: true });
    const have = await this.notePhotos(date);
    const nums = have.map((n) => Number((/^photo-(\d+)\./.exec(n) || [])[1]) || 0);
    const name = `photo-${Math.max(0, ...nums) + 1}.${ext}`;
    await writeFile(join(this.notesDir(date), name), buffer);
    return name;
  }

  photoPath(date, name) {
    if (!/^[\w.-]+$/.test(name) || !IMAGE_RE.test(name)) return null;
    return name.startsWith("note-") ? join(this.dir(date), name) : join(this.notesDir(date), name);
  }

  async removePhoto(date, name) {
    const p = this.photoPath(date, name);
    if (!p) return false;
    await rm(p, { force: true });
    if (name.startsWith("note-")) await this.syncPhotoLine(date);
    return true;
  }

  /** content.md 머리말의 "노트사진:" 줄을 지금 있는 공개용 사진 목록으로 맞춥니다 (줄이 있을 때만). */
  async syncPhotoLine(date) {
    const text = await readText(this.contentPath(date));
    if (text == null || !/^노트사진:/m.test(text)) return;
    const names = await this.publicPhotos(date);
    const updated = text.replace(/^노트사진:.*$/m, `노트사진: ${names.join(", ")}`);
    if (updated !== text) await writeFile(this.contentPath(date), updated, "utf8");
  }

  // ---------- 초안 작업 ----------

  async job(date) {
    const raw = await readText(join(this.stateDir(date), "job.json"));
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async saveJob(date, job) {
    await mkdir(this.stateDir(date), { recursive: true });
    await writeFile(join(this.stateDir(date), "job.json"), JSON.stringify(job, null, 2), "utf8");
    return job;
  }

  async saveDraft(date, { content_md, record_md }) {
    await mkdir(this.stateDir(date), { recursive: true });
    await writeFile(this.draftPath(date), content_md, "utf8");
    await writeFile(this.recordPath(date), record_md ? record_md + "\n" : "", "utf8");
  }

  logPath(date, attempt) {
    return join(this.stateDir(date), `claude-${attempt}.log`);
  }

  /** 초안을 content.md 로 올립니다. 이미 있던 content.md 는 server/data 에 남겨 둡니다. */
  async applyDraft(date) {
    const draft = await readText(this.draftPath(date));
    if (draft == null) throw new Error("초안이 없습니다.");
    await this.backupContent(date);
    await writeFile(this.contentPath(date), draft, "utf8");
    await this.syncPhotoLine(date); // 초안 뒤에 사진을 잘랐어도 머리말이 지금 사진 목록과 맞게
    return (await readText(this.contentPath(date))) ?? draft;
  }

  async writeContent(date, text) {
    await mkdir(this.dir(date), { recursive: true });
    await this.backupContent(date);
    const clean = String(text).replace(/\r\n/g, "\n").trimEnd() + "\n";
    await writeFile(this.contentPath(date), clean, "utf8");
    return clean;
  }

  async backupContent(date) {
    if (!(await exists(this.contentPath(date)))) return;
    await mkdir(this.stateDir(date), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await copyFile(this.contentPath(date), join(this.stateDir(date), `content.${stamp}.md`));
  }

  /** 본보기로 쓸, 가장 최근에 완성된 다른 날의 content.md (저장소 기준 상대 경로). */
  async examplePath(exceptDate) {
    const entries = await readdir(this.repo, { withFileTypes: true }).catch(() => []);
    const dates = entries
      .filter((e) => e.isDirectory() && DAY_RE.test(e.name) && e.name !== exceptDate)
      .map((e) => e.name)
      .sort()
      .reverse();
    for (const d of dates) {
      if (await exists(this.contentPath(d))) return `${d}/content.md`;
    }
    return null;
  }
}

/** 화면 안 대화를 대화.md 형식으로. 사용자 차례는 "## 나", claude 차례는 "## Claude". 말씀이 있으면 첫머리에 "## 말씀" 절. */
export function conversationMarkdown(date, messages, readings = null) {
  const parts = [`# ${date} 묵상 대화 (노트북 도우미에서 claude 와 나눔)`];
  if (readings?.readings?.length) parts.push(`## 말씀 (굿뉴스 매일미사에서 가져옴)\n\n${readingsBlock(readings)}`);
  for (const m of messages) {
    parts.push(`## ${m.role === "user" ? "나" : "Claude"}\n\n${String(m.text).trim()}`);
  }
  return parts.join("\n\n") + "\n";
}

/** content.md 의 이정표 수: "# 이정표" 절 안의 "## " 제목 수. 물음 하나가 이정표 하나다. */
export function countMilestones(contentMd) {
  let inSection = false;
  let n = 0;
  for (const line of String(contentMd).split(/\r?\n/)) {
    if (/^# /.test(line)) inSection = line.includes("이정표");
    else if (inSection && /^## /.test(line)) n++;
  }
  return n;
}

/** "# 이정표" 절의 "## " 제목들. 대화에서 claude 에게 글에 이미 있는 물음을 알릴 때 씁니다. */
export function milestoneTitles(contentMd) {
  let inSection = false;
  const out = [];
  for (const line of String(contentMd).split(/\r?\n/)) {
    if (/^# /.test(line)) inSection = line.includes("이정표");
    else if (inSection && /^## /.test(line)) out.push(line.slice(3).trim());
  }
  return out;
}

export function subtitleOf(contentMd) {
  const m = /^부제\s*:\s*(.+)$/m.exec(contentMd);
  return m ? m[1].trim() : null;
}

function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true });
}
