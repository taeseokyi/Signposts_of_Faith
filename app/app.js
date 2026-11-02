// 「신앙의 이정표」 도우미 화면. 같은 서버(server/server.mjs)가 이 파일과 API 를 함께 냅니다.
// 토큰은 이 브라우저의 localStorage 에만 둡니다.

const $ = (id) => document.getElementById(id);
const SITE_URL = "https://taeseokyi.github.io/Signposts_of_Faith/";
const state = { token: "", date: null, day: null, poll: null };

// ---------- 저장 ----------

function load() {
  try {
    state.token = localStorage.getItem("sp.token") || "";
  } catch {
    state.token = "";
  }
}
function saveToken(t) {
  state.token = t;
  try {
    localStorage.setItem("sp.token", t);
  } catch {
    /* 비공개 창 등 */
  }
}

// ---------- 서버 ----------

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function api(path, { method = "GET", body, timeoutMs = 60000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(path, {
      method,
      signal: controller.signal,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(state.token ? { authorization: `Bearer ${state.token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    clearTimeout(timer);
    throw new ApiError(e.name === "AbortError" ? "노트북이 제때 답하지 않습니다." : "노트북에 연결하지 못했습니다. 서버가 켜져 있는지 확인하세요.", 0);
  }
  clearTimeout(timer);
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* 본문 없음 */
  }
  if (res.status === 401) throw new ApiError("토큰이 맞지 않습니다. ⚙ 설정에서 확인하세요.", 401, data);
  if (!res.ok) throw new ApiError(data?.error ?? `서버 오류 (${res.status})`, res.status, data);
  return data;
}

async function connect() {
  const conn = $("conn");
  conn.className = "conn";
  try {
    const h = await api("/api/health");
    if (!h.authorized) throw new ApiError("토큰이 맞지 않습니다.", 401);
    // 쿠키도 심어 두면 <img> 와 미리보기 페이지가 헤더 없이도 열립니다.
    await api("/api/login", { method: "POST", body: { token: state.token } });
    conn.className = "conn ok";
    return true;
  } catch (e) {
    conn.className = "conn bad";
    if (e.status === 401 || !state.token) showSettings(e.message);
    else toast(e.message);
    return false;
  }
}

// ---------- 화면 공통 ----------

let toastTimer = null;
function toast(msg, ms = 3200) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

function show(view) {
  for (const id of ["view-settings", "view-days", "view-day"]) $(id).hidden = id !== view;
  $("btn-back").hidden = view !== "view-day";
  window.scrollTo(0, 0);
}

function showSettings(msg = "") {
  $("token").value = state.token;
  $("settings-msg").textContent = msg;
  show("view-settings");
}

function busy(btn, on) {
  btn.disabled = on;
}

function setBadge(id, text, cls = "") {
  const b = $(id);
  b.textContent = text;
  b.className = `badge ${cls}`;
}

function renderProblems(ul, problems) {
  ul.innerHTML = "";
  for (const [level, msg] of problems ?? []) {
    const li = document.createElement("li");
    li.className = level;
    li.textContent = `[${level}] ${msg}`;
    ul.appendChild(li);
  }
}

// ---------- 날짜 목록 ----------

async function loadDays() {
  const { days } = await api("/api/days");
  const ul = $("days");
  ul.innerHTML = "";
  if (!days.length) {
    ul.innerHTML = '<li class="sub">아직 날짜 폴더가 없습니다.</li>';
    return;
  }
  for (const d of days) {
    const li = document.createElement("li");
    const tags = [];
    if (d.hasConversation) tags.push(["대화", ""]);
    if (d.noteCount) tags.push([`노트 ${d.noteCount}장`, ""]);
    if (d.publicPhotos.length) tags.push([`공개 ${d.publicPhotos.length}장`, ""]);
    if (d.job?.status === "running" || d.job?.status === "queued") tags.push(["초안 작성 중", "run"]);
    else if (d.job?.status === "error") tags.push(["초안 실패", "bad"]);
    else if (d.hasDraft) tags.push(["초안", ""]);
    if (d.hasContent) tags.push(["content.md", "ok"]);
    li.innerHTML =
      `<span class="date">${d.date}</span>` +
      tags.map(([t, c]) => `<span class="tag ${c}">${t}</span>`).join("") +
      (d.hasContent ? `<a class="go" href="${SITE_URL}${d.date}/" target="_blank" rel="noopener" title="웹사이트에서 보기">사이트 ↗</a>` : "") +
      (d.subtitle ? `<span class="sub">${escapeHtml(d.subtitle)}</span>` : "");
    li.addEventListener("click", (e) => {
      if (e.target.closest("a")) return; // 사이트 링크는 그대로 열리게
      openDay(d.date);
    });
    ul.appendChild(li);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

async function newDay() {
  const date = $("new-date").value;
  if (!date) return toast("날짜를 고르세요.");
  busy($("btn-new-day"), true);
  try {
    await api("/api/days", { method: "POST", body: { date } });
    await openDay(date);
  } catch (e) {
    toast(e.message);
  } finally {
    busy($("btn-new-day"), false);
  }
}

// ---------- 날짜 하나 ----------

async function openDay(date) {
  state.date = date;
  $("title").innerHTML = `${date} <small>신앙의 이정표</small>`;
  show("view-day");
  await refreshDay();
}

async function refreshDay() {
  const { day } = await api(`/api/days/${state.date}`);
  state.day = day;
  renderDay(day);
  // 초안을 만드는 중이면 몇 초마다 다시 봅니다.
  clearTimeout(state.poll);
  if (day.job && (day.job.status === "running" || day.job.status === "queued")) {
    state.poll = setTimeout(refreshDay, 4000);
  }
}

function renderDay(day) {
  // 1. 대화
  if (document.activeElement !== $("conversation")) $("conversation").value = day.conversation;
  setBadge("b-conv", day.hasConversation ? "저장됨" : "없음", day.hasConversation ? "ok" : "");

  // 2. 사진
  setBadge("b-notes", `원본 ${day.notes.length} · 공개 ${day.publicPhotos.length}`, day.notes.length ? "ok" : "");
  const thumbs = $("thumbs");
  thumbs.innerHTML = "";
  for (const [kind, names] of [["원본", day.notes], ["공개", day.publicPhotos]]) {
    for (const name of names) {
      const div = document.createElement("div");
      div.className = "thumb";
      div.innerHTML =
        `<img src="/api/days/${day.date}/photos/${encodeURIComponent(name)}" alt="${name}" loading="lazy">` +
        `<span class="kind">${kind}</span><button class="del" title="지우기">×</button><div class="name">${name}</div>`;
      div.querySelector(".del").addEventListener("click", () => deletePhoto(name));
      thumbs.appendChild(div);
    }
  }

  // 3. 초안
  const job = day.job;
  const draftBtn = $("btn-draft");
  if (job?.status === "running" || job?.status === "queued") {
    setBadge("b-draft", job.status === "queued" ? "대기 중" : `작성 중 (${job.attempts}차)`, "warn");
    $("draft-msg").textContent = "claude 가 읽고 쓰는 중입니다. 화면을 닫아도 노트북에서 계속됩니다.";
    draftBtn.disabled = true;
  } else {
    draftBtn.disabled = false;
    if (job?.status === "error") {
      setBadge("b-draft", "실패", "bad");
      $("draft-msg").textContent = job.error ?? "";
    } else if (job?.status === "done") {
      const errors = (job.problems ?? []).filter(([l]) => l === "오류").length;
      setBadge("b-draft", errors ? `초안 (오류 ${errors})` : "초안 완료", errors ? "warn" : "ok");
      $("draft-msg").textContent = (job.title ? `제목: ${job.title}` : "") + (job.costUsd ? ` · 약 $${job.costUsd.toFixed(2)}` : "");
    } else {
      setBadge("b-draft", "아직", "");
      $("draft-msg").textContent = "";
    }
  }
  if (document.activeElement !== $("instructions") && job?.instructions != null && !$("instructions").value) {
    $("instructions").value = job.instructions;
  }
  const hasDraft = Boolean(day.draft);
  $("draft-result").hidden = !hasDraft;
  if (hasDraft) {
    const ul = $("review");
    ul.innerHTML = "";
    for (const r of job?.review ?? []) {
      const li = document.createElement("li");
      li.textContent = r;
      ul.appendChild(li);
    }
    renderProblems($("draft-problems"), job?.problems);
    $("draft-text").textContent = day.draft;
    $("record-text").textContent = day.record || "(없음)";
  }

  // 4. content.md
  if (document.activeElement !== $("content")) $("content").value = day.content;
  setBadge("b-content", day.hasContent ? "있음" : "없음", day.hasContent ? "ok" : "");
  if (day.hasContent && !$("content-problems").children.length) checkContent().catch(() => {});

  // 5. 발행
  $("commit-msg").placeholder = `${day.date} 묵상: ${day.subtitle ?? "부제"}`;
  $("link-day").href = `${SITE_URL}${day.date}/`;
}

async function saveConversation() {
  busy($("btn-save-conv"), true);
  try {
    const r = await api(`/api/days/${state.date}/conversation`, { method: "PUT", body: { text: $("conversation").value } });
    $("conv-msg").textContent = r.hasConversation ? "저장했습니다." : "비어 있어 대화 파일을 지웠습니다.";
    await refreshDay();
  } catch (e) {
    toast(e.message);
  } finally {
    busy($("btn-save-conv"), false);
  }
}

// ---------- 사진 ----------

function readAsBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** 공개용: 가로 1400px 로 줄인 JPEG. 캔버스를 거치므로 촬영 정보(EXIF, 위치)가 모두 지워집니다. */
async function shrinkToWidth(file, width = 1400) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, width / bitmap.width);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
}

async function uploadPhotos(fileList, kind) {
  const files = [...fileList].filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic)$/i.test(f.name));
  if (!files.length) return toast("이미지 파일만 올릴 수 있습니다.");
  $("photo-msg").textContent = `${files.length}장 올리는 중…`;
  try {
    const photos = [];
    for (const f of files) {
      if (kind === "public") {
        const blob = await shrinkToWidth(f);
        photos.push({ kind, mediaType: "image/jpeg", base64: await readAsBase64(blob) });
      } else {
        // 원본은 손대지 않고 그대로 보관합니다.
        const type = ["image/jpeg", "image/png", "image/webp", "image/heic"].includes(f.type) ? f.type : "image/jpeg";
        photos.push({ kind, mediaType: type, base64: await readAsBase64(f) });
      }
    }
    const r = await api(`/api/days/${state.date}/photos`, { method: "POST", body: { photos }, timeoutMs: 5 * 60 * 1000 });
    $("photo-msg").textContent = `저장: ${r.saved.map((s) => s.name).join(", ")}`;
    await refreshDay();
  } catch (e) {
    $("photo-msg").textContent = "";
    toast(e.message);
  }
}

async function deletePhoto(name) {
  if (!confirm(`${name} 을 지울까요?`)) return;
  try {
    await api(`/api/days/${state.date}/photos/${encodeURIComponent(name)}`, { method: "DELETE" });
    await refreshDay();
  } catch (e) {
    toast(e.message);
  }
}

// ---------- 초안 ----------

async function makeDraft() {
  busy($("btn-draft"), true);
  try {
    await api(`/api/days/${state.date}/draft`, { method: "POST", body: { instructions: $("instructions").value } });
    toast("초안을 만들기 시작했습니다.");
    await refreshDay();
  } catch (e) {
    toast(e.message);
    busy($("btn-draft"), false);
  }
}

async function applyDraft() {
  if (state.day?.hasContent && !confirm("이미 content.md 가 있습니다. 사본을 남기고 초안으로 덮어쓸까요?")) return;
  busy($("btn-apply"), true);
  try {
    const r = await api(`/api/days/${state.date}/draft/apply`, { method: "POST", body: {} });
    $("content").value = r.content;
    renderProblems($("content-problems"), r.check.problems);
    toast("content.md 로 올렸습니다. 4단계에서 다듬으세요.");
    await refreshDay();
    $("content").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    toast(e.message);
  } finally {
    busy($("btn-apply"), false);
  }
}

// ---------- content.md ----------

async function saveContent() {
  busy($("btn-save-content"), true);
  try {
    const r = await api(`/api/days/${state.date}/content`, { method: "PUT", body: { text: $("content").value } });
    renderProblems($("content-problems"), r.check.problems);
    $("content-msg").textContent = r.check.ok ? `저장했습니다. 제목: ${r.check.title}` : "저장했지만 [오류]가 있습니다. 고친 뒤 다시 저장하세요.";
    await refreshDay();
  } catch (e) {
    toast(e.message);
  } finally {
    busy($("btn-save-content"), false);
  }
}

async function checkContent() {
  const { check } = await api(`/api/days/${state.date}/check`);
  renderProblems($("content-problems"), check.problems);
  if (check.title) $("content-msg").textContent = `제목: ${check.title} (${check.title.length}자)`;
}

async function makePreview() {
  busy($("btn-preview"), true);
  $("content-msg").textContent = "웹사이트를 만드는 중… (PDF 없이)";
  try {
    await api("/api/preview", { method: "POST", body: {}, timeoutMs: 5 * 60 * 1000 });
    const a = $("preview-link");
    a.href = `/preview/${state.date}/`;
    a.hidden = false;
    $("content-msg").textContent = "미리보기를 만들었습니다. [오류]가 있는 날은 사이트에서 빠집니다.";
  } catch (e) {
    $("content-msg").textContent = "";
    toast(e.message);
  } finally {
    busy($("btn-preview"), false);
  }
}

// ---------- 발행 ----------

async function gitStatus() {
  busy($("btn-git"), true);
  try {
    const s = await api("/api/git");
    const lines = [`브랜치 ${s.branch}`, `push 안 된 커밋 ${s.ahead}개` + (s.behind ? ` · 원격이 ${s.behind}개 앞섬 (먼저 pull 하세요)` : "")];
    for (const c of s.changes) lines.push(`${c.code.padEnd(2)} ${c.path}`);
    if (!s.changes.length) lines.push("(바뀐 파일 없음)");
    $("git-status").textContent = lines.join("\n");
  } catch (e) {
    $("git-status").textContent = e.message;
  } finally {
    busy($("btn-git"), false);
  }
}

async function publish() {
  if (!state.day?.hasContent) return toast("content.md 가 아직 없습니다.");
  if (!confirm(`${state.date} 를 커밋하고 GitHub 에 push 합니다. 공개 저장소이고 웹사이트에 바로 실립니다. 계속할까요?`)) return;
  busy($("btn-publish"), true);
  $("publish-msg").textContent = "커밋하고 push 하는 중…";
  try {
    const r = await api(`/api/days/${state.date}/publish`, { method: "POST", body: { message: $("commit-msg").value }, timeoutMs: 5 * 60 * 1000 });
    const out = $("publish-result");
    out.hidden = false;
    out.innerHTML =
      `커밋 <code>${escapeHtml(r.commit)}</code> (${r.files.length}개 파일)<br>` +
      (r.pushed
        ? `push 완료. 몇 분 뒤 <a href="${r.url}" target="_blank" rel="noopener">${r.url}</a> 에 실립니다.`
        : `<span style="color:var(--bad)">push 되지 않았습니다:</span> ${escapeHtml(r.pushError ?? "")}<br>노트북에서 <code>git push</code> 를 직접 해 주세요.`);
    $("publish-msg").textContent = "";
    await gitStatus();
  } catch (e) {
    $("publish-msg").textContent = "";
    if (e.data?.problems) renderProblems($("content-problems"), e.data.problems);
    toast(e.message, 6000);
  } finally {
    busy($("btn-publish"), false);
  }
}

// ---------- 시작 ----------

function wire() {
  $("btn-settings").addEventListener("click", () => showSettings());
  $("btn-cancel-settings").addEventListener("click", () => show(state.date ? "view-day" : "view-days"));
  $("btn-save-settings").addEventListener("click", async () => {
    saveToken($("token").value.trim());
    if (await connect()) {
      show("view-days");
      loadDays().catch((e) => toast(e.message));
    }
  });
  $("btn-back").addEventListener("click", () => {
    clearTimeout(state.poll);
    state.date = null;
    $("title").innerHTML = "신앙의 이정표 <small>도우미</small>";
    show("view-days");
    loadDays().catch((e) => toast(e.message));
  });
  $("btn-refresh-days").addEventListener("click", () => loadDays().catch((e) => toast(e.message)));
  $("btn-new-day").addEventListener("click", newDay);
  $("btn-save-conv").addEventListener("click", saveConversation);
  $("file-note").addEventListener("change", (e) => uploadPhotos(e.target.files, "note").then(() => (e.target.value = "")));
  $("file-public").addEventListener("change", (e) => uploadPhotos(e.target.files, "public").then(() => (e.target.value = "")));
  $("btn-draft").addEventListener("click", makeDraft);
  $("btn-apply").addEventListener("click", applyDraft);
  $("btn-save-content").addEventListener("click", saveContent);
  $("btn-preview").addEventListener("click", makePreview);
  $("btn-git").addEventListener("click", gitStatus);
  $("btn-publish").addEventListener("click", publish);

  const today = new Date();
  $("new-date").value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

async function main() {
  load();
  wire();
  if (!state.token) {
    showSettings("처음입니다. 노트북 .env.local 의 SIGNPOSTS_TOKEN 을 넣으세요.");
    return;
  }
  show("view-days");
  if (await connect()) {
    const back = /^#(\d{4}-\d{2}-\d{2})$/.exec(location.hash);
    if (back) openDay(back[1]).catch((e) => toast(e.message));
    else loadDays().catch((e) => toast(e.message));
  }
}

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

// 크롬이 "설치할 수 있다"고 알려 오면 머리글에 설치 버튼을 보입니다. (바탕화면·시작 메뉴 바로가기와 아이콘이 생깁니다)
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  $("btn-install").hidden = false;
});
$("btn-install").addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => {});
  installPrompt = null;
  $("btn-install").hidden = true;
});
window.addEventListener("appinstalled", () => {
  $("btn-install").hidden = true;
  toast("앱으로 설치했습니다.");
});

main();
