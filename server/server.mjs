// 노트북에서 돌리는 「신앙의 이정표」 도우미 백엔드.
//
// 폰이나 노트북 브라우저에서 app/ 화면을 열어 대화 원문과 노트 사진을 보내면,
// claude CLI 가 WORKFLOW.md 기준으로 content.md 초안을 만들고, 검토한 뒤 git 으로 발행합니다.
//
//   node server/server.mjs
//
// 환경변수 (.env.local 에 적습니다)
//   SIGNPOSTS_TOKEN  접근 토큰 (필수). 화면의 설정에 같은 값을 넣습니다.
//   PORT             기본 8788
//   REPO_DIR         저장소 루트. 기본은 이 파일의 상위 폴더
//   DATA_DIR         초안과 작업 상태를 두는 곳. 기본 server/data
//   CLAUDE_BIN       기본 claude. Windows 에서는 "wsl -d Ubuntu -e /home/<사용자>/.local/bin/claude"
//   CLAUDE_MODEL     예: opus / sonnet (생략하면 CLI 기본값)
//   PYTHON_BIN       기본 python (Windows) / python3
//   GIT_BIN          기본 git
//   MAX_UPLOAD_MB    한 번에 받는 최대 용량, 기본 200
//   TLS              기본 on. 자체 서명 인증서로 https. off 로 두면 http
//   CERT_DIR         인증서 보관 위치, 기본 server/certs
//   TLS_HOSTS        인증서에 추가로 넣을 IP/호스트명 (쉼표 구분)

import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";

import { Days, DAY_RE, subtitleOf } from "./days.mjs";
import { ClaudeRunner } from "./runner.mjs";
import { buildDraftPrompt, RECORD_EXAMPLE_FALLBACK } from "./prompt.mjs";
import { git, python } from "./exec.mjs";
import { prepareTls } from "./tls.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(process.env.REPO_DIR || join(HERE, ".."));
const APP_DIR = join(HERE, "..", "app");
const DATA_DIR = resolve(process.env.DATA_DIR || join(HERE, "data"));
const PREVIEW_DIR = join(DATA_DIR, "_site");
const PORT = Number(process.env.PORT) || 8788;
const TOKEN = process.env.SIGNPOSTS_TOKEN || "";
const USE_TLS = !/^(0|off|false|no)$/i.test(process.env.TLS ?? "");
const CERT_DIR = resolve(process.env.CERT_DIR || join(HERE, "certs"));
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 200;
const MAX_UPLOAD = MAX_UPLOAD_MB * 1024 * 1024;
const MAX_ATTEMPTS = 3; // 초안 검사에서 [오류]가 나면 고쳐 달라고 다시 시키는 횟수 (처음 포함)
const COOKIE = "sp_token";
const SITE_URL = "https://taeseokyi.github.io/Signposts_of_Faith/";
const RECORD_MARKER = "### (다음 기록은 여기에 이어서)";

if (!TOKEN) {
  console.error(
    "SIGNPOSTS_TOKEN 이 비어 있습니다. 아무나 저장소에 쓰고 push 할 수 있으므로 시작하지 않습니다.\n" +
      "예:  SIGNPOSTS_TOKEN=$(openssl rand -hex 16) node server/server.mjs"
  );
  process.exit(1);
}

const days = new Days(REPO, DATA_DIR);
const runner = new ClaudeRunner({
  bin: process.env.CLAUDE_BIN || "claude",
  model: process.env.CLAUDE_MODEL || undefined,
  cwd: REPO,
});

// ---------- 초안 작업 큐 (한 번에 하나) ----------

const queue = [];
let working = false;

function enqueue(date) {
  if (!queue.includes(date)) queue.push(date);
  drain();
}

async function drain() {
  if (working) return;
  const date = queue.shift();
  if (!date) return;
  working = true;
  try {
    await makeDraft(date);
  } catch (error) {
    console.error(`[${date}] 초안 실패:`, error.message);
    const job = (await days.job(date)) ?? {};
    await days.saveJob(date, { ...job, status: "error", error: error.message, finishedAt: new Date().toISOString() }).catch(() => {});
  } finally {
    working = false;
    drain();
  }
}

async function recordExample() {
  // WORKFLOW.md 8장에서 가장 최근 날짜 기록 블록을 본보기로 떼어 옵니다.
  const text = await readFile(join(REPO, "WORKFLOW.md"), "utf8").catch(() => "");
  const blocks = text.split(/\n(?=### \d{4}-\d{2}-\d{2} · )/);
  const last = blocks.filter((b) => /^### \d{4}-\d{2}-\d{2} · /.test(b)).pop();
  if (!last) return RECORD_EXAMPLE_FALLBACK;
  return last.split(/\n(?=### )/)[0].trim();
}

async function checkDraft(date) {
  // 초안은 server/data/<date>/draft.md 에 있고, 노트사진은 날짜 폴더에서 찾아야 하므로 --as 를 씁니다.
  return checkFile(`server/data/${date}/draft.md`, date);
}

async function checkFile(relPath, date) {
  const r = await python(["check", relPath, "--as", date, "--json"], { cwd: REPO });
  const line = r.stdout.trim().split("\n").pop() ?? "";
  try {
    return JSON.parse(line);
  } catch {
    throw new Error(`content.md 검사(python)를 돌리지 못했습니다.\n${(r.stderr || r.stdout).trim().slice(0, 600)}`);
  }
}

async function makeDraft(date) {
  let job = (await days.job(date)) ?? {};
  job = await days.saveJob(date, {
    ...job,
    status: "running",
    attempts: 0,
    error: null,
    problems: [],
    review: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
  });

  const notes = await days.notePhotos(date);
  const base = {
    date,
    conversationPath: job.hasConversation ? `${date}/대화.md` : null,
    photoPaths: notes.map((n) => `${date}/노트/${n}`),
    publicPhotos: await days.publicPhotos(date),
    examplePath: await days.examplePath(date),
    instructions: job.instructions ?? "",
    recordExample: await recordExample(),
  };

  let retry = null;
  let costTotal = 0;
  let check = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    job = await days.saveJob(date, { ...job, attempts: attempt });
    const prompt = buildDraftPrompt({ ...base, retry });
    const { draft, costUsd } = await runner.run(prompt, { logPath: days.logPath(date, attempt) });
    if (costUsd) costTotal += costUsd;
    await days.saveDraft(date, draft);
    check = await checkDraft(date);
    job = await days.saveJob(date, { ...job, review: draft.review, problems: check.problems, title: check.title });
    const errors = check.problems.filter(([level]) => level === "오류").map(([, m]) => m);
    console.log(`[${date}] 초안 ${attempt}차 · 이정표 ${check.milestones}개 · 오류 ${errors.length} · 주의 ${check.problems.length - errors.length}`);
    if (!errors.length) break;
    retry = { problems: errors, draft: draft.content_md };
  }

  await days.saveJob(date, {
    ...job,
    status: "done",
    costUsd: costTotal || null,
    finishedAt: new Date().toISOString(),
  });
}

// ---------- 미리보기 (웹사이트 빌드) ----------

let previewing = null;
async function buildPreview() {
  if (previewing) return previewing;
  previewing = (async () => {
    const r = await python(["site", "--no-pdf", "--out", "server/data/_site"], { cwd: REPO, timeoutMs: 5 * 60 * 1000 });
    if (r.code !== 0) throw new Error(`웹사이트 빌드 실패\n${(r.stderr || r.stdout).trim().slice(0, 800)}`);
    return r.stdout;
  })().finally(() => (previewing = null));
  return previewing;
}

// ---------- 발행 (git) ----------

async function appendRecord(date) {
  const record = (await readFile(days.recordPath(date), "utf8").catch(() => "")).trim();
  if (!record) return false;
  const path = join(REPO, "WORKFLOW.md");
  const text = await readFile(path, "utf8");
  if (text.includes(`### ${date} ·`) || text.includes(`### ${date} `)) return false; // 이미 기록돼 있다
  if (!text.includes(RECORD_MARKER)) return false;
  await writeFile(path, text.replace(RECORD_MARKER, `${record}\n\n${RECORD_MARKER}`), "utf8");
  return true;
}

async function publish(date, { message, push = true, withRecord = true } = {}) {
  const check = await checkFile(`${date}/content.md`, date);
  if (!check.ok) {
    const err = new Error("content.md 에 [오류]가 있어 발행하지 않습니다.");
    err.status = 409;
    err.problems = check.problems;
    throw err;
  }
  const subtitle = subtitleOf(await readFile(days.contentPath(date), "utf8")) ?? "";
  const files = [`${date}/content.md`, ...(await days.publicPhotos(date)).map((n) => `${date}/${n}`)];
  if (withRecord && (await appendRecord(date))) files.push("WORKFLOW.md");

  await git(["add", "--", ...files], { cwd: REPO });
  const staged = (await git(["diff", "--cached", "--name-only"], { cwd: REPO })).trim();
  if (!staged) {
    const err = new Error("바뀐 것이 없어 커밋하지 않습니다. (이미 발행됐거나 내용이 같습니다)");
    err.status = 409;
    throw err;
  }
  const msg = (message || "").trim() || `${date} 묵상: ${subtitle}`;
  await git(["commit", "-m", msg], { cwd: REPO });
  const head = (await git(["log", "-1", "--format=%h %s"], { cwd: REPO })).trim();
  let pushed = false;
  let pushError = null;
  if (push) {
    try {
      await git(["push"], { cwd: REPO });
      pushed = true;
    } catch (e) {
      pushError = e.message;
    }
  }
  return { commit: head, files: staged.split("\n"), pushed, pushError, url: `${SITE_URL}${date}/` };
}

async function gitStatus() {
  const out = await git(["status", "--porcelain=v1", "-b", "--untracked-files=all"], { cwd: REPO });
  const [branchLine, ...rest] = out.split("\n");
  const ahead = Number((/ahead (\d+)/.exec(branchLine) || [])[1]) || 0;
  const behind = Number((/behind (\d+)/.exec(branchLine) || [])[1]) || 0;
  const changes = rest.filter(Boolean).map((l) => ({ code: l.slice(0, 2).trim(), path: l.slice(3) }));
  return { branch: branchLine.replace(/^## /, ""), ahead, behind, changes };
}

// ---------- HTTP ----------

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type,authorization",
  "access-control-max-age": "86400",
  "access-control-allow-private-network": "true",
};

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic" };

function send(res, status, body, extra = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS, ...extra });
  res.end(JSON.stringify(body));
}

function sameToken(given) {
  const a = Buffer.from(String(given ?? ""));
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieToken(req) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]*)`).exec(req.headers.cookie ?? "");
  return m ? decodeURIComponent(m[1]) : "";
}

function authorized(req) {
  const header = req.headers.authorization ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  return sameToken(bearer) || sameToken(cookieToken(req));
}

function cookieHeader(secure) {
  return `${COOKIE}=${encodeURIComponent(TOKEN)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${secure ? "; Secure" : ""}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_UPLOAD) {
        reject(Object.assign(new Error(`업로드 용량이 너무 큽니다 (${MAX_UPLOAD_MB}MB 초과).`), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req) {
  try {
    return JSON.parse((await readBody(req)).toString("utf8") || "{}");
  } catch (error) {
    if (error.status) throw error;
    throw Object.assign(new Error("보낸 내용을 읽지 못했습니다 (JSON 형식이 아닙니다)."), { status: 400 });
  }
}

async function serveStatic(res, root, rel, { cache = "no-cache" } = {}) {
  const clean = normalize(decodeURIComponent(rel)).replace(/^([/\\])+/, "");
  let file = join(root, clean);
  if (!file.startsWith(root)) return false;
  let info = await stat(file).catch(() => null);
  if (info?.isDirectory()) {
    file = join(file, "index.html");
    info = await stat(file).catch(() => null);
  }
  if (!info?.isFile()) return false;
  const body = await readFile(file);
  res.writeHead(200, { "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream", "cache-control": cache, ...CORS });
  res.end(body);
  return true;
}

const tls = USE_TLS ? await prepareTls(CERT_DIR, { extraHosts: process.env.TLS_HOSTS || "" }) : null;
const SCHEME = tls ? "https" : "http";

const handler = async (req, res) => {
  const url = new URL(req.url, `${SCHEME}://localhost:${PORT}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  try {
    // 화면(app/) — 토큰 없이도 내려 줍니다. 자료는 모두 /api 뒤에 있습니다.
    if (req.method === "GET" && !path.startsWith("/api") && !path.startsWith("/preview")) {
      if (path === "/ca.crt") {
        if (!tls) {
          send(res, 404, { error: "이 서버는 http 로 떠 있어 인증서가 없습니다." });
          return;
        }
        res.writeHead(200, { "content-type": "application/x-x509-ca-cert", "content-disposition": 'attachment; filename="signposts-ca.crt"', "cache-control": "no-store", ...CORS });
        res.end(tls.caPem);
        return;
      }
      if (await serveStatic(res, APP_DIR, path === "/" ? "index.html" : path)) return;
      send(res, 404, { error: "없는 주소입니다." });
      return;
    }

    if (path === "/api/health") {
      send(res, 200, { ok: true, authorized: authorized(req), repo: REPO, tls: Boolean(tls) });
      return;
    }

    // 토큰을 쿠키로도 심어, <img> 와 미리보기 페이지처럼 헤더를 못 붙이는 요청도 통과하게 합니다.
    if (req.method === "POST" && path === "/api/login") {
      const body = await readJson(req);
      if (!sameToken(body.token)) {
        send(res, 401, { error: "토큰이 맞지 않습니다." });
        return;
      }
      send(res, 200, { ok: true }, { "set-cookie": cookieHeader(Boolean(tls)) });
      return;
    }

    // 미리보기 페이지를 주소로 열 때는 ?t=토큰 으로 쿠키를 심고 깨끗한 주소로 보냅니다.
    if (path.startsWith("/preview") && url.searchParams.has("t")) {
      if (!sameToken(url.searchParams.get("t"))) {
        send(res, 401, { error: "토큰이 맞지 않습니다." });
        return;
      }
      res.writeHead(302, { location: url.pathname, "set-cookie": cookieHeader(Boolean(tls)), "cache-control": "no-store" });
      res.end();
      return;
    }

    if (!authorized(req)) {
      send(res, 401, { error: "토큰이 맞지 않습니다." });
      return;
    }

    if (req.method === "GET" && path.startsWith("/preview")) {
      if (await serveStatic(res, PREVIEW_DIR, path.slice("/preview".length) || "index.html", { cache: "no-store" })) return;
      send(res, 404, { error: "미리보기가 아직 없습니다. 먼저 '미리보기 만들기'를 누르세요." });
      return;
    }

    if (req.method === "GET" && path === "/api/days") {
      send(res, 200, { days: await days.list(), working, queue: [...queue] });
      return;
    }

    if (req.method === "POST" && path === "/api/days") {
      const body = await readJson(req);
      if (!DAY_RE.test(body.date ?? "")) {
        send(res, 400, { error: "date 는 YYYY-MM-DD 형식이어야 합니다." });
        return;
      }
      send(res, 201, { day: await days.create(body.date) });
      return;
    }

    if (req.method === "GET" && path === "/api/git") {
      send(res, 200, await gitStatus());
      return;
    }

    if (req.method === "POST" && path === "/api/preview") {
      const log = await buildPreview();
      send(res, 200, { ok: true, log, url: "/preview/" });
      return;
    }

    const m = /^\/api\/days\/(\d{4}-\d{2}-\d{2})(?:\/([\w-]+))?(?:\/(.+))?$/.exec(path);
    if (!m) {
      send(res, 404, { error: "없는 주소입니다." });
      return;
    }
    const [, date, part, rest] = m;
    if (!(await days.exists(date)) && !(req.method === "PUT" || req.method === "POST")) {
      send(res, 404, { error: `${date} 폴더가 없습니다.` });
      return;
    }

    if (!part && req.method === "GET") {
      send(res, 200, { day: await days.detail(date) });
      return;
    }

    if (part === "conversation" && req.method === "PUT") {
      const body = await readJson(req);
      const saved = await days.writeConversation(date, body.text ?? "");
      send(res, 200, { ok: true, hasConversation: saved });
      return;
    }

    if (part === "photos" && req.method === "POST") {
      if (Number(req.headers["content-length"]) > MAX_UPLOAD) {
        send(res, 413, { error: `업로드 용량이 너무 큽니다 (${MAX_UPLOAD_MB}MB 초과). 사진을 나눠서 보내 주세요.` });
        return;
      }
      const body = await readJson(req);
      if (!Array.isArray(body.photos) || !body.photos.length) {
        send(res, 400, { error: "photos 배열이 비어 있습니다." });
        return;
      }
      const saved = [];
      for (const p of body.photos) {
        if (typeof p?.base64 !== "string" || !p.base64) {
          send(res, 400, { error: "사진 데이터(base64)가 비어 있습니다." });
          return;
        }
        const kind = p.kind === "public" ? "public" : "note";
        const mediaType = EXT[p.mediaType] ? p.mediaType : "image/jpeg";
        saved.push({ kind, name: await days.addPhoto(date, { kind, mediaType, buffer: Buffer.from(p.base64, "base64") }) });
      }
      send(res, 201, { saved, day: await days.summary(date) });
      return;
    }

    if (part === "photos" && rest && req.method === "GET") {
      const file = days.photoPath(date, decodeURIComponent(rest));
      const info = file && (await stat(file).catch(() => null));
      if (!info?.isFile()) {
        send(res, 404, { error: "사진을 찾지 못했습니다." });
        return;
      }
      res.writeHead(200, { "content-type": TYPES[extname(file).toLowerCase()] ?? "image/jpeg", "cache-control": "private, max-age=3600", ...CORS });
      res.end(await readFile(file));
      return;
    }

    if (part === "photos" && rest && req.method === "DELETE") {
      const ok = await days.removePhoto(date, decodeURIComponent(rest));
      send(res, ok ? 200 : 400, ok ? { ok: true } : { error: "지울 수 없는 이름입니다." });
      return;
    }

    if (part === "draft" && !rest && req.method === "POST") {
      const body = await readJson(req);
      const current = await days.job(date);
      if (current && (current.status === "queued" || current.status === "running")) {
        send(res, 409, { error: "이미 초안을 만드는 중입니다." });
        return;
      }
      const summary = await days.summary(date);
      if (!summary.hasConversation && !summary.noteCount) {
        send(res, 400, { error: "대화 원문이나 노트 사진 가운데 하나는 있어야 초안을 만들 수 있습니다." });
        return;
      }
      await days.saveJob(date, {
        status: "queued",
        instructions: String(body.instructions ?? ""),
        hasConversation: summary.hasConversation,
        attempts: 0,
        problems: [],
        review: [],
        error: null,
        createdAt: new Date().toISOString(),
      });
      enqueue(date);
      send(res, 202, { ok: true, queued: queue.length + (working ? 1 : 0) });
      return;
    }

    if (part === "draft" && rest === "apply" && req.method === "POST") {
      const content = await days.applyDraft(date);
      const check = await checkFile(`${date}/content.md`, date);
      send(res, 200, { ok: true, content, check });
      return;
    }

    if (part === "content" && req.method === "PUT") {
      const body = await readJson(req);
      if (typeof body.text !== "string" || !body.text.trim()) {
        send(res, 400, { error: "text 가 비어 있습니다." });
        return;
      }
      const content = await days.writeContent(date, body.text);
      const check = await checkFile(`${date}/content.md`, date);
      send(res, 200, { ok: true, content, check });
      return;
    }

    if (part === "check" && req.method === "GET") {
      const info = await stat(days.contentPath(date)).catch(() => null);
      if (!info) {
        send(res, 404, { error: "content.md 가 아직 없습니다." });
        return;
      }
      send(res, 200, { check: await checkFile(`${date}/content.md`, date) });
      return;
    }

    if (part === "publish" && req.method === "POST") {
      const body = await readJson(req);
      try {
        const result = await publish(date, { message: body.message, push: body.push !== false, withRecord: body.record !== false });
        console.log(`[${date}] 발행 · ${result.commit}${result.pushed ? " · push 완료" : " · push 안 됨"}`);
        send(res, 200, result);
      } catch (error) {
        send(res, error.status ?? 500, { error: error.message, problems: error.problems });
      }
      return;
    }

    send(res, 404, { error: "없는 주소입니다." });
  } catch (error) {
    console.error(error);
    send(res, error.status ?? 500, { error: error.message });
  }
};

const server = tls ? createHttpsServer({ key: tls.key, cert: tls.cert }, handler) : createHttpServer(handler);

server.listen(PORT, "0.0.0.0", async () => {
  // 서버가 꺼졌다 켜지면 큐는 사라집니다. 끝나지 않은 작업을 다시 줄 세웁니다.
  for (const d of await days.list()) {
    if (d.job && (d.job.status === "queued" || d.job.status === "running")) enqueue(d.date);
  }
  console.log(`신앙의 이정표 도우미 백엔드가 떴습니다.`);
  console.log(`  주소     ${SCHEME}://localhost:${PORT}`);
  console.log(`  저장소   ${REPO}`);
  console.log(`  초안     ${DATA_DIR}`);
  console.log(`  claude   ${process.env.CLAUDE_BIN || "claude"}`);
  if (tls) {
    const lan = tls.hosts.ips.filter((ip) => ip !== "127.0.0.1");
    console.log(`\n자체 서명 인증서로 https 를 제공합니다. (인증서 ${CERT_DIR})`);
    console.log(`  폰에서 열 주소: ${lan.map((ip) => `https://${ip}:${PORT}/`).join("  ")}`);
    console.log(`  처음 한 번 https://<주소>:${PORT}/ca.crt 를 받아 루트 인증서로 설치하세요.` + (tls.caCreated ? " (루트 인증서를 새로 만들었습니다)" : ""));
  } else {
    console.log(`\nhttp 로 떠 있습니다. 같은 Wi-Fi 안에서 http://<노트북IP>:${PORT}/ 로 엽니다. (홈 화면 설치는 https 에서만 됩니다)`);
  }
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log("\n종료합니다.");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
