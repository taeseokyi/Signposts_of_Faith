// 「신앙의 이정표」 도우미 화면. 같은 서버(server/server.mjs)가 이 파일과 API 를 함께 냅니다.
// 토큰은 이 브라우저의 localStorage 에만 둡니다.

const $ = (id) => document.getElementById(id);
const SITE_URL = "https://taeseokyi.github.io/Signposts_of_Faith/";
const state = { token: "", date: null, day: null, poll: null, chatting: false, scrapping: false, crop: null, autoModal: null, autoModalDismissed: null, busy: null, lastJobs: {}, readingsAsked: false };

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

// ---------- 작업이 끝났을 때 알리기 ----------

/** 발행·초안 단추를 누를 때 한 번 묻습니다 (사용자 조작 안에서만 물을 수 있습니다). */
function askNotifyPermission() {
  try {
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
  } catch {
    /* 지원하지 않는 브라우저 */
  }
}

/** 작업 결과를 한 줄 제목과 설명으로. */
function jobOutcome(date, job) {
  const publish = job.mode === "publish";
  const name = labelOf(date);
  if (job.status === "hold") return { title: `${name} 멈춤 · 확인이 필요합니다`, body: job.holdReason ?? "", kind: "warn" };
  if (job.status === "error") return { title: `${name} ${publish ? "발행하지 못했습니다" : "초안을 만들지 못했습니다"}`, body: job.error ?? "", kind: "bad" };
  if (!publish) return { title: `${name} 초안을 만들었습니다`, body: job.title ?? "", kind: "ok" };
  if (job.publish?.pushed) return { title: `${name} 발행 완료`, body: "", kind: "ok" };
  if (job.publish) return { title: `${name} 커밋만 됐습니다`, body: job.publish.pushError ?? "push 가 안 됐습니다.", kind: "warn" };
  return { title: `${name} content.md 까지 만들었습니다`, body: "발행 전에 멈추기를 골라 두었습니다.", kind: "warn" };
}

/** 작업이 막 끝난 것을 보면 화면 안 알림과 기기 알림을 함께 냅니다. */
function announceJobDone(date, job) {
  const o = jobOutcome(date, job);
  toast(o.title, 8000);
  try {
    navigator.vibrate?.([150, 80, 150]);
  } catch {
    /* 무시 */
  }
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const opts = { body: o.body, tag: `job-${date}`, icon: "icons/icon-192.png", data: { date } };
    if (navigator.serviceWorker?.controller) navigator.serviceWorker.ready.then((reg) => reg.showNotification(o.title, opts)).catch(() => new Notification(o.title, opts));
    else new Notification(o.title, opts);
  } catch {
    /* 알림을 못 내도 화면 안 알림은 이미 냈습니다 */
  }
}

/** 날짜마다 마지막으로 본 작업 상태를 기억하고, 바뀌었는지·막 끝났는지를 돌려줍니다. */
function jobChange(date, job) {
  const prev = state.lastJobs[date];
  const now = job ? job.status : null;
  state.lastJobs[date] = now;
  const wasRunning = prev === "running" || prev === "queued";
  return { changed: prev !== undefined && prev !== now, finished: wasRunning && Boolean(job) && !jobRunning(job) };
}

/** 작업이 끝난 것을 처음 본 쪽이 부릅니다. 알리고, 그 날짜가 열려 있으면 결과 창을 다시 엽니다. */
function onJobFinished(date, job) {
  announceJobDone(date, job);
  if (state.date === date && job.mode === "publish") {
    state.autoModal = job.startedAt ?? "";
    state.autoModalDismissed = null;
  }
}

// 어느 화면에 있든 작업이 도는 동안 몇 초마다 목록을 물어, 끝나면 알리고 보고 있는 화면을 새로 그립니다.
let watchTimer = null;
let watching = false; // 한 번에 하나만 돌게 (겹쳐 부르면 그냥 돌아감)
async function watchJobs() {
  if (watching || !state.token) return;
  watching = true;
  clearTimeout(watchTimer);
  watchTimer = null;
  let running = false;
  try {
    const { days, busy = null } = await api("/api/days");
    let listChanged = false;
    let finishedOpenDay = false;
    for (const d of days) {
      const c = jobChange(d.date, d.job);
      if (c.changed) listChanged = true;
      if (c.finished) {
        onJobFinished(d.date, d.job);
        if (state.date === d.date) finishedOpenDay = true;
      }
      if (jobRunning(d.job)) running = true;
    }
    if (listChanged && !$("view-days").hidden) loadDays().catch(() => {});
    const busyChanged = busy !== state.busy;
    state.busy = busy;
    // 열어 둔 날짜가 끝났거나, 다른 날짜의 작업이 시작·종료돼 단추 잠금이 바뀌면 그 화면을 새로 그립니다.
    // 열어 둔 날짜가 스스로 작업 중이면 refreshDay 가 4초마다 묻고 있으니 여기서는 건드리지 않습니다 (서로 부르는 고리 방지).
    const openDayPolling = state.day && jobRunning(state.day.job);
    if (state.date && (finishedOpenDay || (busyChanged && !openDayPolling))) refreshDay().catch(() => {});
  } catch {
    running = Object.values(state.lastJobs).some((st) => st === "running" || st === "queued");
  } finally {
    watching = false;
  }
  if (running) watchTimer = setTimeout(watchJobs, 8000);
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
  if (!$("view-day").hidden) return; // 그 사이 날짜를 열었음
  const ul = $("days");
  ul.innerHTML = "";
  // 끝난 작업의 알림과 목록 갱신은 watchJobs 가 맡습니다. 여기서는 상태만 기억해 둡니다.
  for (const d of days) {
    if (jobChange(d.date, d.job).finished) onJobFinished(d.date, d.job);
  }
  if (days.some((d) => jobRunning(d.job)) && !watching && !watchTimer) watchJobs();
  if (!days.length) {
    ul.innerHTML = '<li class="sub">아직 날짜 폴더가 없습니다.</li>';
    return;
  }
  for (const d of days) {
    const li = document.createElement("li");
    const tags = [];
    if (d.hasConversation) tags.push(["대화", ""]);
    if (d.noteCount) tags.push([`원본 ${d.noteCount}장`, ""]);
    if (d.publicPhotos.length) tags.push([`사진 ${d.publicPhotos.length}장`, ""]);
    if (d.job?.status === "running" || d.job?.status === "queued") tags.push([d.job.mode === "publish" ? "발행 작업 중" : "초안 작성 중", "running"]);
    else if (d.job?.status === "error") tags.push([d.job.mode === "publish" ? "발행 실패" : "초안 실패", "bad"]);
    else if (d.job?.status === "hold") tags.push(["확인 필요", "run"]);
    else if (d.hasDraft) tags.push(["초안", ""]);
    if (d.hasContent) tags.push(["content.md", "ok"]);
    li.innerHTML =
      `<span class="date">${d.label ?? d.date}</span>` +
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

/** 폴더 이름 → 사람에게 보이는 이름. "2026-11-03-2" → "2026-11-03 (2)" (서버 labelOf 와 같은 규칙) */
function labelOf(id) {
  const m = /^(\d{4}-\d{2}-\d{2})(?:-(\d+))?$/.exec(String(id));
  return m ? (m[2] ? `${m[1]} (${m[2]})` : m[1]) : String(id);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

async function newDay(another = false) {
  const date = $("new-date").value;
  if (!date) return toast("날짜를 고르세요.");
  const btn = $(another ? "btn-another-day" : "btn-new-day");
  busy(btn, true);
  try {
    const { day } = await api("/api/days", { method: "POST", body: { date, another } });
    await openDay(day.date);
  } catch (e) {
    toast(e.message);
  } finally {
    busy(btn, false);
  }
}

// ---------- 날짜 하나 ----------

async function openDay(date) {
  state.date = date;
  state.autoModal = null;
  state.autoModalDismissed = null;
  state.readingsAsked = false;
  state.extendTouched = false;
  loadBooks().catch(() => {});
  closeCrop();
  $("photo-msg").textContent = "";
  $("chat-msg").textContent = "";
  // 전에 열었던 날짜의 말씀이 새 날짜 화면에 남지 않도록 비운다 (그날 말씀은 refreshDay 가 다시 그린다)
  $("readings-list").innerHTML = "";
  $("readings-title").textContent = "말씀을 불러오는 중…";
  $("readings-msg").textContent = "";
  state.board = null;
  $("board-result").hidden = true;
  $("board-msg").textContent = "";
  $("title").innerHTML = `${date.length > 10 ? `${date.slice(0, 10)} <small>(${date.slice(11)})</small>` : date} <small>신앙의 이정표</small>`;
  // 주소에 날짜를 남겨, 폰이 화면을 다시 불러와도(앱 갱신, 탭 복귀) 같은 날짜와 진행 창으로 돌아온다
  if (location.hash !== `#${date}`) history.replaceState(null, "", `#${date}`);
  show("view-day");
  await refreshDay();
}

function jobRunning(job) {
  return Boolean(job && (job.status === "running" || job.status === "queued"));
}

function pollLater(ms) {
  clearTimeout(state.poll);
  state.poll = setTimeout(() => refreshDay().catch(() => {}), ms);
}

async function refreshDay() {
  clearTimeout(state.poll);
  const date = state.date;
  let day;
  let busy = null;
  try {
    ({ day, busy = null } = await api(`/api/days/${date}`));
  } catch (e) {
    // 폰 화면이 꺼졌다 켜지는 사이에 요청이 끊겨도 작업 중이었으면 조금 뒤 다시 묻습니다.
    if (state.date === date && jobRunning(state.day?.job)) pollLater(8000);
    throw e;
  }
  if (state.date !== date) return; // 그 사이 다른 화면으로 나갔음
  state.day = day;
  state.busy = busy; // 지금 작업 중인 날짜 (다른 날짜일 수 있음)
  if (jobChange(date, day.job).finished) onJobFinished(date, day.job);
  renderDay(day);
  if (jobRunning(day.job) && !watching && !watchTimer) watchJobs();
  // 작업 중이면 몇 초마다 다시 봅니다. 다른 날짜의 작업이 도는 동안도 끝나면 단추를 풀어야 하니 느리게 봅니다.
  if (jobRunning(day.job)) pollLater(4000);
  else if (busy && busy !== date) pollLater(8000);
}

/** 다른 날짜의 작업이 도는 중이면 그 날짜를, 아니면 null. */
function busyElsewhere() {
  return state.busy && state.busy !== state.date ? state.busy : null;
}

function renderDay(day) {
  // 0. 한 번에 발행
  renderAuto(day);

  // 1. 대화 — 그날 말씀이 아직 없으면 굿뉴스에서 한 번 가져옵니다
  if (day.readings) renderReadings(day.readings);
  else if (!state.readingsAsked) {
    state.readingsAsked = true;
    loadReadings().catch(() => {});
  }
  const turns = day.chatTurns ?? 0;
  if (!state.chatting) renderChat(day.chat?.messages ?? []);
  if (document.activeElement !== $("conversation")) {
    $("conversation").value = day.conversation ?? "";
    renderConvCount();
  }
  $("paste-box").open = Boolean((day.conversation ?? "").trim());
  // 물음 하나가 이정표 하나. 개수는 글(content.md)이 있을 때 그 안의 이정표 수로 보이고, 없으면 개수를 보이지 않는다.
  const count = day.hasContent && day.milestones ? `이정표 ${day.milestones}개` : "";
  setBadge("b-conv", count || (turns ? "대화 있음" : day.hasConversation ? "붙여 넣음" : "없음"), day.hasConversation ? "ok" : "");

  // 2. 사진
  setBadge("b-notes", `원본 ${day.notes.length} · 공개 ${day.publicPhotos.length}`, day.notes.length ? "ok" : "");
  const thumbs = $("thumbs");
  thumbs.innerHTML = "";
  const scrapOf = (name) => (day.scrap?.photos ?? []).find((p) => p.file === name) ?? null;
  for (const [kind, names] of [["원본", day.notes], ["공개", day.publicPhotos]]) {
    for (const name of names) {
      const div = document.createElement("div");
      div.className = "thumb";
      const sc = kind === "원본" ? scrapOf(name) : null;
      div.innerHTML =
        `<img src="/api/days/${day.date}/photos/${encodeURIComponent(name)}" alt="${name}" loading="lazy">` +
        `<span class="kind">${kind}</span><button class="del" title="지우기">×</button>` +
        (sc ? `<span class="tag ${sc.has_day ? "ok" : "no"}" title="${escapeHtml(sc.evidence ?? "")}">${sc.has_day ? `이 날짜 ✓${sc.order ? ` ${sc.order}번째` : ""}` : "다른 날"}</span>` : "") +
        (kind === "원본" ? `<button class="cut" title="이 날짜 부분을 잘라 공개용으로">자르기</button>` : "") +
        `<div class="name">${name}</div>`;
      div.querySelector(".del").addEventListener("click", () => deletePhoto(name));
      div.querySelector(".cut")?.addEventListener("click", () => openCrop(name, sc));
      thumbs.appendChild(div);
    }
  }
  $("btn-scrap").disabled = !day.notes.length || state.scrapping;
  if (day.scrap?.summary && !state.scrapping && !$("photo-msg").textContent) $("photo-msg").textContent = day.scrap.summary;

  // 3. 초안
  const job = day.job;
  const draftBtn = $("btn-draft");
  if (job?.status === "running" || job?.status === "queued") {
    setBadge("b-draft", job.status === "queued" ? "대기 중" : `작성 중 (${job.attempts}차)`, "warn");
    $("draft-msg").textContent = "claude 가 읽고 쓰는 중입니다. 화면을 닫아도 노트북에서 계속됩니다.";
    draftBtn.disabled = true;
  } else {
    draftBtn.disabled = Boolean(busyElsewhere());
    if (job?.status === "error") {
      setBadge("b-draft", "실패", "bad");
      $("draft-msg").textContent = job.error ?? "";
    } else if (job?.status === "done" || job?.status === "hold") {
      const errors = (job.problems ?? []).filter(([l]) => l === "오류").length;
      setBadge("b-draft", errors ? `초안 (오류 ${errors})` : job.extend ? "덧붙인 초안" : "초안 완료", errors ? "warn" : "ok");
      const grew = job.extend && job.extendFrom != null && day.draftMilestones != null ? `이정표 ${job.extendFrom}개 → ${day.draftMilestones}개` : "";
      $("draft-msg").textContent = [job.title ? `제목: ${job.title}` : "", grew].filter(Boolean).join(" · ");
    } else {
      setBadge("b-draft", extendChecked() ? "추가 모드" : "아직", "");
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
  $("commit-msg").placeholder = `${labelOf(day.date)} 묵상: ${day.subtitle ?? "부제"}`;
  $("link-day").href = `${SITE_URL}${day.date}/`;
}

/** 붙여 넣은 글의 분량. 폰에서 붙여 넣기가 잘렸는지 바로 알 수 있게 글자 수와 "## 나" 같은 차례 수를 보입니다. */
function renderConvCount() {
  const text = $("conversation").value;
  if (!text.trim()) {
    $("conv-count").textContent = "";
    return;
  }
  const turns = (text.match(/^##\s*나\b/gm) ?? []).length;
  $("conv-count").textContent = `${text.length.toLocaleString("ko-KR")}자` + (turns ? ` · 물음 ${turns}개` : "") + " (길이 제한 없음)";
}

/** 파일(.txt/.md)에 담긴 대화를 읽어 붙여 넣기 칸에 넣고 바로 저장합니다. 긴 대화를 폰에서 붙여 넣기 어려울 때 씁니다. */
async function loadConversationFile(file) {
  if (!file) return;
  const text = await file.text();
  $("conversation").value = text;
  renderConvCount();
  await saveConversation();
}

async function saveConversation() {
  busy($("btn-save-conv"), true);
  try {
    const text = $("conversation").value;
    const r = await api(`/api/days/${state.date}/conversation`, { method: "PUT", body: { text } });
    $("conv-msg").textContent = r.hasConversation ? `저장했습니다 (${text.trim().length.toLocaleString("ko-KR")}자).` : "비어 있어 대화 파일을 지웠습니다.";
    await refreshDay();
  } catch (e) {
    toast(e.message);
  } finally {
    busy($("btn-save-conv"), false);
  }
}

// ---------- 한 번에 발행 ----------

const STEP_ICON = { wait: "○", run: "◐", ok: "●", skip: "–", fail: "✕", hold: "■" };

function renderSteps(ol, job, big) {
  ol.innerHTML = "";
  if (job?.mode !== "publish" || !Array.isArray(job.steps)) return;
  for (const st of job.steps) {
    const li = document.createElement("li");
    li.className = st.status;
    const icon = STEP_ICON[st.status] ?? "○";
    const text = st.key === "publish" && st.status === "ok" ? "완료" : st.detail;
    const detail = text ? `<span class="d">${escapeHtml(text)}</span>` : "";
    li.innerHTML = big
      ? `<span class="i">${icon}</span><span class="t">${escapeHtml(st.label)}${detail}</span>`
      : `${icon} ${escapeHtml(st.label)}` + (detail ? `<br>${detail}` : "");
    ol.appendChild(li);
  }
}

/** 기초자료로 발행이 도는 동안 화면을 덮는 진행 창. 끝나면 결과를 보여 주고, 닫기를 누를 때까지 남습니다. */
function renderAutoModal(job) {
  const modal = $("auto-modal");
  if (job?.mode !== "publish") {
    modal.hidden = true;
    return;
  }
  // 작업마다 startedAt 이 다르므로 그것으로 '이 작업의 창을 닫았는지'를 기억합니다.
  const key = job.startedAt ?? "";
  const running = jobRunning(job);
  if (running && state.autoModalDismissed !== key) state.autoModal = key;
  if (state.autoModal !== key) {
    modal.hidden = true;
    return;
  }
  const title = $("auto-modal-title");
  const msg = $("auto-modal-msg");
  renderSteps($("auto-modal-steps"), job, true);
  $("auto-modal-back").hidden = !running;
  $("auto-modal-close").textContent = running ? "창 닫기 (작업은 계속)" : "닫기";
  if (running) {
    title.textContent = job.status === "queued" ? "기초자료로 발행을 기다리는 중" : "기초자료로 발행하는 중";
    title.className = "running";
    $("auto-modal-sub").hidden = false;
    msg.textContent = "";
  } else {
    $("auto-modal-sub").hidden = true;
    if (job.status === "hold") {
      title.textContent = "멈춤 · 확인이 필요합니다";
      title.className = "warn";
      msg.textContent = job.holdReason ?? "";
    } else if (job.status === "error") {
      title.textContent = "발행하지 못했습니다";
      title.className = "bad";
      msg.textContent = job.error ?? "";
    } else if (job.status === "done" && job.publish?.pushed) {
      title.textContent = "발행 완료";
      title.className = "ok";
      msg.innerHTML = publishedNote(job);
    } else if (job.status === "done") {
      title.textContent = job.publish ? "커밋만 됐습니다" : "content.md 까지 만들었습니다";
      title.className = "warn";
      msg.textContent = job.publish ? `push 가 안 됐습니다: ${job.publish.pushError ?? ""}` : "발행 전에 멈추기를 골라 두었습니다. 4단계에서 보고 5단계로 발행하세요.";
    } else {
      modal.hidden = true;
      return;
    }
  }
  modal.hidden = false;
}

function closeAutoModal() {
  state.autoModalDismissed = state.autoModal;
  state.autoModal = null;
  $("auto-modal").hidden = true;
}

/** 추가 모드 체크박스 (한 번에 발행과 3단계에 하나씩, 같은 값). 글이 있는 날은 기본으로 켜 둔다. */
function renderExtend(day) {
  const job = day.job;
  const running = jobRunning(job);
  for (const id of ["extend-auto-label", "extend-draft-label"]) $(id).hidden = !day.hasContent;
  // 글이 있는 날은 켜 둔다 (덮어쓰기보다 덧붙이기가 안전). 작업이 도는 동안은 그 작업의 값을 보인다.
  if (running) setExtend(Boolean(job.extend));
  else if (!state.extendTouched) setExtend(Boolean(day.hasContent));
  $("extend-auto").disabled = running;
  $("extend-draft").disabled = running;
  const on = extendChecked();
  $("btn-run").textContent = on ? "추가 모드로 발행" : "기초자료로 발행";
  $("btn-draft").textContent = on ? "추가 모드로 초안 만들기" : "초안 만들기";
}

function extendChecked() {
  return Boolean(state.day?.hasContent) && $("extend-auto").checked;
}

function setExtend(value) {
  $("extend-auto").checked = value;
  $("extend-draft").checked = value;
}

/** 발행 뒤 안내: 웹사이트 링크만. (완료는 배지와 단계에 보인다) */
function publishedNote(job) {
  return `<a href="${job.publish.url}" target="_blank" rel="noopener">웹사이트의 이 날 ↗</a>`;
}

function renderAuto(day) {
  const job = day.job;
  renderExtend(day);
  const extend = extendChecked();
  const ready = $("ready");
  const items = [
    [day.hasConversation, day.chatTurns ? "대화 있음" : day.hasConversation ? "대화 (붙여 넣음)" : "대화 없음 — 노트만으로 물음을 세웁니다"],
    [day.notes.length > 0, day.notes.length ? `노트 사진 원본 ${day.notes.length}장` : "노트 사진 없음"],
    [day.publicPhotos.length > 0, day.publicPhotos.length ? `공개용 ${day.publicPhotos.length}장 (있으면 자르기 단계는 건너뜀)` : "공개용 사진은 발행할 때 자릅니다"],
    ...(freshNotes(day).length ? [[true, `새로 올린 노트 사진 ${freshNotes(day).length}장 — 발행할 때 이 날짜 부분을 찾아 공개용으로 더합니다`]] : []),
    ...(day.readings?.extra?.length
      ? [[true, (day.seq ?? 1) > 1 ? `이 글의 말씀 ${day.readings.extra.map((x) => x.ref).join(", ")}` : `더한 말씀 ${day.readings.extra.map((x) => x.ref).join(", ")} — 발행하면 여는 말씀에 들어갑니다`]]
      : (day.seq ?? 1) > 1 ? [[false, "말씀 없음 — 1단계에서 말씀을 더하세요 (둘째 글은 미사 독서를 가져오지 않습니다)"]] : []),
    [day.hasContent, !day.hasContent
      ? "content.md 아직 없음"
      : extend
        ? `content.md 있음 (이정표 ${day.milestones ?? 0}개) — 추가 모드: 있는 글은 그대로 두고, 대화의 새 물음과 노트의 새 내용만 여는 말씀·이정표·흐름·한 줄·다시 펼쳐 볼 물음·근거에 더합니다`
        : "content.md 있음 — 추가 모드를 끄면 초안을 새로 써서 덮어씁니다 (손으로 고친 것은 사본에만 남음). 고친 글을 다시 올리려면 4단계에서 저장하고 5단계로 발행하세요"],
  ];
  ready.innerHTML = items.map(([ok, text]) => `<li class="${ok ? "ok" : "no"}">${escapeHtml(text)}</li>`).join("");

  const running = jobRunning(job);
  const elsewhere = busyElsewhere();
  const canRun = (day.hasConversation || day.notes.length) && !running && !state.chatting && !elsewhere;
  $("btn-run").disabled = !canRun;
  $("stop-before-publish").disabled = Boolean(running);
  if (document.activeElement !== $("stop-before-publish") && job?.stopBeforePublish != null && !running) {
    $("stop-before-publish").checked = Boolean(job.stopBeforePublish);
  }

  renderSteps($("steps"), job, false);
  renderAutoModal(job);

  const msg = $("auto-msg");
  if (elsewhere && !running) {
    setBadge("b-auto", `${elsewhere} 작업 중`, "warn");
    msg.textContent = `${elsewhere} 의 작업이 진행 중입니다. 노트북의 claude 는 한 번에 하나만 돌리므로 끝난 뒤 시작할 수 있습니다.`;
  } else if (!job || job.mode !== "publish") {
    setBadge("b-auto", running ? "초안 작업 중" : extend ? "추가 모드" : "", running ? "warn" : "");
    msg.textContent = "";
  } else if (running) {
    setBadge("b-auto", job.status === "queued" ? "대기 중" : "발행 중", "warn");
    msg.textContent = "노트북에서 이어서 합니다. 화면을 닫아도 됩니다.";
  } else if (job.status === "hold") {
    setBadge("b-auto", "멈춤 · 확인 필요", "warn");
    msg.textContent = job.holdReason ?? "";
  } else if (job.status === "error") {
    setBadge("b-auto", "실패", "bad");
    msg.textContent = job.error ?? "";
  } else if (job.status === "done" && job.publish) {
    setBadge("b-auto", job.publish.pushed ? "발행 완료" : "커밋만 됨", job.publish.pushed ? "ok" : "warn");
    msg.innerHTML = job.publish.pushed
      ? publishedNote(job)
      : `커밋은 됐지만 push 가 안 됐습니다: ${escapeHtml(job.publish.pushError ?? "")} — 5단계에서 git 상태를 보고 노트북에서 push 하세요.`;
  } else {
    setBadge("b-auto", extend ? "추가 모드" : "", "");
    msg.textContent = "";
  }
}

async function runAuto() {
  if (!state.day) return;
  const stop = $("stop-before-publish").checked;
  const extend = extendChecked();
  const what = stop ? "사진 자르기 → 초안 → content.md 까지 만들고 발행 앞에서 멈춥니다." : "사진 자르기 → 초안 → content.md → 커밋과 push 까지 한 번에 합니다. 공개 저장소이고 웹사이트에 바로 실립니다.";
  const again = !state.day.hasContent
    ? ""
    : extend
      ? `\n\n있는 글(이정표 ${state.day.milestones ?? 0}개)은 그대로 두고 새 물음·노트만 덧붙입니다.`
      : "\n\n이미 content.md 가 있는 날입니다. 초안을 새로 써서 덮어쓰며, 손으로 고친 내용은 사본에만 남습니다. 고친 글을 그대로 올리려면 취소하고 5단계 발행을 쓰세요.";
  if (!confirm(`${labelOf(state.date)}: ${what}${again}\n\n시작할까요?`)) return;
  askNotifyPermission();
  busy($("btn-run"), true);
  try {
    await api(`/api/days/${state.date}/run`, { method: "POST", body: { instructions: $("instructions").value, stopBeforePublish: stop, extend } });
    state.autoModal = null;
    state.autoModalDismissed = null;
    await refreshDay();
    watchJobs();
  } catch (e) {
    toast(e.message, 6000);
    busy($("btn-run"), false);
  }
}

// ---------- 1단계: 묵상 대화 ----------

/** 아주 작은 마크다운: 소제목, 목록, 인용, 굵게·기울임·코드. claude 답을 읽기 좋게 보이는 데만 씁니다. */
function inlineMd(s) {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1<i>$2</i>");
}

function renderMarkdown(src) {
  const out = [];
  let para = [];
  let list = null;
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inlineMd).join("<br>")}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${i}</li>`).join("")}</${list.tag}>`);
    list = null;
  };
  for (const raw of String(src).replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    if ((m = /^#{1,6}\s+(.*)$/.exec(line))) {
      flushPara();
      flushList();
      out.push(`<h4>${inlineMd(m[1])}</h4>`);
    } else if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flushPara();
      flushList();
      out.push("<hr>");
    } else if ((m = /^\s*>\s?(.*)$/.exec(line))) {
      flushPara();
      flushList();
      const last = out[out.length - 1];
      if (last && last.startsWith("<blockquote>")) out[out.length - 1] = last.replace(/<\/blockquote>$/, `<br>${inlineMd(m[1])}</blockquote>`);
      else out.push(`<blockquote>${inlineMd(m[1])}</blockquote>`);
    } else if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) {
      flushPara();
      if (!list || list.tag !== "ul") {
        flushList();
        list = { tag: "ul", items: [] };
      }
      list.items.push(inlineMd(m[1]));
    } else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
      flushPara();
      if (!list || list.tag !== "ol") {
        flushList();
        list = { tag: "ol", items: [] };
      }
      list.items.push(inlineMd(m[1]));
    } else if (list && /^\s{2,}/.test(raw)) {
      list.items[list.items.length - 1] += `<br>${inlineMd(line.trim())}`;
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return out.join("");
}

function chatBubble(role, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  if (role === "user") div.textContent = text;
  else div.innerHTML = renderMarkdown(text);
  return div;
}

// ---------- 그날 말씀 (굿뉴스 매일미사) ----------

const LITURGY_COLORS = { 녹: "#3f8f4a", 백: "#f2efe6", 자: "#6b3d8f", 홍: "#b3303a", 장: "#e2a0a0", 흑: "#333" };

function renderReadings(r) {
  const title = $("readings-title");
  const list = $("readings-list");
  list.innerHTML = "";
  if (!r) {
    title.textContent = "말씀을 아직 불러오지 않았습니다.";
    $("btn-readings").hidden = false;
    $("chat-hint-auto").hidden = false;
    $("chat-hint-manual").hidden = true;
    return;
  }
  const manual = Boolean(r.manual) && !r.readings?.length; // 같은 날 하나 더: 미사 독서 없이 직접 더한 말씀만
  $("btn-readings").hidden = manual;
  $("chat-hint-auto").hidden = manual;
  $("chat-hint-manual").hidden = !manual;
  const dot = r.color ? `<span class="color" style="background:${LITURGY_COLORS[r.color] ?? "transparent"}" title="${escapeHtml(r.color)}"></span>` : "";
  title.innerHTML = manual ? "같은 날 하나 더 — 말씀은 아래에서 직접 더합니다" : `${dot}${escapeHtml(r.title || "전례일 모름")}`;
  for (const x of r.readings ?? []) {
    const d = document.createElement("details");
    d.innerHTML =
      `<summary>${escapeHtml(x.kind)} <span class="ref">${escapeHtml(x.ref)}</span>` +
      (x.heading ? ` <span class="heading">— ${escapeHtml(x.heading)}</span>` : "") +
      `</summary><div class="text">${escapeHtml(x.text)}</div>`;
    list.appendChild(d);
  }
  // 묵상하다 떠올라 더한 구절. 대화와 초안에도 "더한 말씀"으로 들어갑니다.
  for (const x of r.extra ?? []) {
    const d = document.createElement("details");
    d.className = "extra";
    d.innerHTML =
      `<summary>더한 말씀 <span class="ref">${escapeHtml(x.ref)}</span>` +
      (x.bookName ? ` <span class="heading">— ${escapeHtml(x.bookName)}</span>` : "") +
      `<button class="remove" type="button" title="이 구절 빼기" aria-label="이 구절 빼기">×</button></summary><div class="text">${escapeHtml(x.text)}</div>`;
    d.querySelector(".remove").addEventListener("click", (e) => {
      e.preventDefault();
      removeExtra(x.ref).catch((err) => toast(err.message));
    });
    list.appendChild(d);
  }
}

/** 책 고르기 목록을 서버에서 한 번 받아 채웁니다 (구약·신약 묶음). */
async function loadBooks() {
  const sel = $("extra-book");
  if (sel.options.length > 1) return;
  try {
    const { books } = await api("/api/bible/books");
    for (const testament of ["구약", "신약"]) {
      const g = document.createElement("optgroup");
      g.label = testament;
      for (const b of books.filter((x) => x.testament === testament)) {
        const o = document.createElement("option");
        o.value = b.abbr;
        o.textContent = b.name;
        g.appendChild(o);
      }
      sel.appendChild(g);
    }
  } catch {
    // 목록이 없어도 오른쪽 칸에 책 이름까지 적으면 됩니다
  }
}

/** 책을 고르고 장절을 적어(또는 책 이름까지 적어) 굿뉴스 성경에서 가져와 그날 말씀에 더합니다. */
async function addExtra() {
  const input = $("extra-ref");
  const book = $("extra-book").value;
  const typed = input.value.trim();
  if (!typed) {
    input.focus();
    return;
  }
  // 책을 골랐고 장절만 적었으면 붙입니다. 책 이름까지 적었으면(한글로 시작) 그대로 보냅니다.
  if (!book && /^\d/.test(typed)) {
    $("readings-msg").textContent = "책을 먼저 고르세요. (또는 '요한 15,5-8' 처럼 책 이름까지 적으세요)";
    $("extra-book").focus();
    return;
  }
  const ref = book && /^\d/.test(typed) ? `${book} ${typed}` : typed;
  const date = state.date;
  busy($("btn-extra"), true);
  $("readings-msg").textContent = "굿뉴스 성경에서 가져오는 중…";
  try {
    const { readings, added } = await api(`/api/days/${date}/readings/extra`, { method: "POST", body: { ref }, timeoutMs: 40000 });
    if (state.date !== date) return;
    if (state.day) state.day.readings = readings;
    renderReadings(readings);
    input.value = "";
    $("readings-msg").textContent = "";
    toast(`${added} 을(를) 더했습니다. 대화에서 바로 물어도 되고, 발행하면 여는 말씀에 들어갑니다.`, 5000);
  } catch (e) {
    if (state.date !== date) return;
    $("readings-msg").textContent = e.message;
  } finally {
    busy($("btn-extra"), false);
  }
}

async function removeExtra(ref) {
  const date = state.date;
  const { readings } = await api(`/api/days/${date}/readings/extra/${encodeURIComponent(ref)}`, { method: "DELETE" });
  if (state.date !== date) return;
  if (state.day) state.day.readings = readings;
  renderReadings(readings);
}

/** 공개용 사진을 만든 뒤에 새로 올린 원본 (이 날짜 부분을 아직 찾지 않은 것). 서버의 freshNotes 와 같은 기준. */
function freshNotes(day) {
  const seen = day.scrap?.photos ?? [];
  if (!day.publicPhotos.length || !seen.length) return [];
  return day.notes.filter((n) => !seen.some((p) => p.file === n));
}

/** 서버에 그날 말씀을 청합니다 (한 번 가져오면 서버가 간직하고, refresh 면 다시 가져옵니다). */
async function loadReadings(refresh = false) {
  const date = state.date;
  $("readings-msg").textContent = "";
  $("readings-title").textContent = refresh ? "다시 불러오는 중…" : "말씀을 불러오는 중…";
  if (!refresh) $("readings-list").innerHTML = ""; // 다시 불러올 때는 있던 말씀을 그대로 두고, 처음 불러올 때는 비운 채 기다린다
  busy($("btn-readings"), true);
  try {
    const { readings } = await api(`/api/days/${date}/readings${refresh ? "?refresh=1" : ""}`, { timeoutMs: 40000 });
    if (state.date !== date) return;
    if (state.day) state.day.readings = readings;
    renderReadings(readings);
  } catch (e) {
    if (state.date !== date) return;
    renderReadings(null);
    $("readings-msg").textContent = `${e.message} — 전처럼 본문을 물음과 함께 붙여 넣어도 됩니다.`;
  } finally {
    busy($("btn-readings"), false);
  }
}

function renderChat(messages) {
  const log = $("chat-log");
  log.innerHTML = "";
  for (const m of messages) log.appendChild(chatBubble(m.role, m.text));
  log.scrollTop = log.scrollHeight;
}


async function sendChat() {
  const input = $("chat-input");
  const text = input.value.trim();
  if (!text) return toast("보낼 말을 적으세요.");
  if (state.chatting) return;
  state.chatting = true;
  busy($("btn-chat-send"), true);
  const log = $("chat-log");
  log.appendChild(chatBubble("user", text));
  const bubble = document.createElement("div");
  bubble.className = "msg assistant thinking";
  bubble.innerHTML = '<span class="status">claude 가 읽고 생각하는 중</span>';
  log.appendChild(bubble);
  log.scrollTop = log.scrollHeight;
  input.value = "";
  let acc = "";
  let error = null;
  try {
    const res = await fetch(`/api/days/${state.date}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(state.token ? { authorization: `Bearer ${state.token}` } : {}) },
      body: JSON.stringify({ text }),
    });
    if (!res.ok || !res.body) {
      let data = null;
      try {
        data = await res.json();
      } catch {
        /* 본문 없음 */
      }
      throw new Error(data?.error ?? (res.status === 401 ? "토큰이 맞지 않습니다. ⚙ 설정에서 확인하세요." : `서버 오류 (${res.status})`));
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    // 조각이 올 때마다 다시 그리지 않고 한 프레임에 한 번만 마크다운으로 그립니다.
    let paintQueued = false;
    const paint = () => {
      paintQueued = false;
      bubble.innerHTML = renderMarkdown(acc);
      log.scrollTop = log.scrollHeight;
    };
    const handle = (line) => {
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      if (ev.delta) {
        acc += ev.delta;
        bubble.classList.add("thinking");
        if (!paintQueued) {
          paintQueued = true;
          requestAnimationFrame(paint);
        }
      } else if (ev.status) {
        bubble.innerHTML = (acc ? renderMarkdown(acc) : "") + `<span class="status">${escapeHtml(ev.status)}</span>`;
      } else if (ev.done) {
        acc = ev.text || acc;
      } else if (ev.error) {
        error = ev.error;
      }
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) handle(line);
      }
    }
    if (buf.trim()) handle(buf.trim());
  } catch (e) {
    error = e.message;
  }
  bubble.classList.remove("thinking");
  if (error) {
    bubble.innerHTML = `<span style="color:var(--bad)">${escapeHtml(error)}</span>`;
    input.value = text; // 다시 보낼 수 있게 돌려 둡니다
    toast(error, 6000);
  } else {
    bubble.innerHTML = renderMarkdown(acc);
  }
  log.scrollTop = log.scrollHeight;
  state.chatting = false;
  busy($("btn-chat-send"), false);
  if (!error) refreshDay().catch(() => {});
}

async function clearChat() {
  if (!confirm("이 날짜의 화면 대화를 모두 지울까요? 붙여 넣은 대화는 남습니다.")) return;
  try {
    await api(`/api/days/${state.date}/chat`, { method: "DELETE" });
    renderChat([]);
    $("chat-msg").textContent = "";
    await refreshDay();
  } catch (e) {
    toast(e.message);
  }
}

// ---------- 2단계: 사진에서 이 날짜 부분 찾기 · 자르기 ----------

async function scrapPhotos() {
  if (state.scrapping) return;
  state.scrapping = true;
  busy($("btn-scrap"), true);
  $("photo-msg").textContent = "claude 가 노트 사진을 보는 중… (사진 수에 따라 1~3분)";
  try {
    const { scrap } = await api(`/api/days/${state.date}/scrap`, { method: "POST", body: {}, timeoutMs: 15 * 60 * 1000 });
    const hits = scrap.photos.filter((p) => p.has_day);
    $("photo-msg").textContent = scrap.summary || (hits.length ? `${hits.length}장에 이 날짜가 있습니다.` : "이 날짜의 부분을 찾지 못했습니다.");
    state.scrapping = false;
    await refreshDay();
    const first = hits.find((p) => p.crop);
    if (first) openCrop(first.file, first);
    else if (!hits.length) toast("이 날짜로 보이는 사진이 없습니다. 날짜가 맞는지, 사진이 그날 것인지 확인하세요.", 6000);
  } catch (e) {
    $("photo-msg").textContent = "";
    toast(e.message, 6000);
  } finally {
    state.scrapping = false;
    busy($("btn-scrap"), false);
  }
}

const CROP_KEYS = ["top", "bottom", "left", "right"];

function cropValues() {
  const v = {};
  for (const k of CROP_KEYS) v[k] = Number($(`crop-${k}`).value) / 100;
  return v;
}

function setCropValues(c) {
  for (const k of CROP_KEYS) $(`crop-${k}`).value = Math.round((c[k] ?? (k === "top" || k === "left" ? 0 : 1)) * 100);
  drawCropBox();
}

function drawCropBox() {
  // 슬라이더끼리 겹치지 않게 최소 간격을 둡니다.
  const t = $("crop-top"), b = $("crop-bottom"), l = $("crop-left"), r = $("crop-right");
  if (Number(t.value) > Number(b.value) - 3) t.value = Number(b.value) - 3;
  if (Number(l.value) > Number(r.value) - 3) l.value = Number(r.value) - 3;
  const c = cropValues();
  const box = $("crop-box");
  box.style.top = `${c.top * 100}%`;
  box.style.left = `${c.left * 100}%`;
  box.style.height = `${(c.bottom - c.top) * 100}%`;
  box.style.width = `${(c.right - c.left) * 100}%`;
}

function openCrop(name, scrap) {
  state.crop = { name };
  const ed = $("crop-editor");
  ed.hidden = false;
  $("crop-title").textContent = `${name} 자르기`;
  $("crop-evidence").textContent = scrap
    ? (scrap.has_day ? `claude 의 제안: ${scrap.evidence ?? ""}` : `claude 는 이 사진에 이 날짜가 없다고 봤습니다 (${scrap.evidence ?? ""}). 그래도 자를 수 있습니다.`) +
      (scrap.private ? ` · 조심: ${scrap.private}` : "") +
      (scrap.other_days?.length ? ` · 다른 날짜도 보임: ${scrap.other_days.join(", ")}` : "")
    : "슬라이더로 이 날짜 부분만 남기세요. 개인적인 줄은 밖으로 빼고, 촬영 시각 표시는 남겨도 됩니다.";
  $("crop-img").src = `/api/days/${state.date}/photos/${encodeURIComponent(name)}`;
  setCropValues(scrap?.crop ?? {});
  ed.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeCrop() {
  state.crop = null;
  $("crop-editor").hidden = true;
  $("crop-img").removeAttribute("src");
}

/** 원본에서 영역을 잘라 가로 1400px JPEG 로 만들어 공개용으로 올립니다. 캔버스를 거치므로 촬영 정보는 지워집니다. */
async function saveCrop() {
  if (!state.crop) return;
  const { name } = state.crop;
  busy($("btn-crop-save"), true);
  $("photo-msg").textContent = "자르는 중…";
  try {
    const res = await fetch(`/api/days/${state.date}/photos/${encodeURIComponent(name)}`, {
      headers: state.token ? { authorization: `Bearer ${state.token}` } : {},
    });
    if (!res.ok) throw new Error("원본 사진을 받지 못했습니다.");
    const bitmap = await createImageBitmap(await res.blob());
    const c = cropValues();
    const sx = Math.round(bitmap.width * c.left);
    const sy = Math.round(bitmap.height * c.top);
    const sw = Math.max(1, Math.round(bitmap.width * (c.right - c.left)));
    const sh = Math.max(1, Math.round(bitmap.height * (c.bottom - c.top)));
    const scale = Math.min(1, 1400 / sw);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(sh * scale);
    canvas.getContext("2d").drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    const r = await api(`/api/days/${state.date}/photos`, {
      method: "POST",
      body: { photos: [{ kind: "public", mediaType: "image/jpeg", base64: await readAsBase64(blob) }] },
      timeoutMs: 5 * 60 * 1000,
    });
    $("photo-msg").textContent = `공개용으로 저장: ${r.saved.map((s) => s.name).join(", ")} (${canvas.width}×${canvas.height})`;
    closeCrop();
    await refreshDay();
  } catch (e) {
    $("photo-msg").textContent = "";
    toast(e.message, 6000);
  } finally {
    busy($("btn-crop-save"), false);
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
  askNotifyPermission();
  busy($("btn-draft"), true);
  try {
    const extend = extendChecked();
    await api(`/api/days/${state.date}/draft`, { method: "POST", body: { instructions: $("instructions").value, extend } });
    toast(extend ? "추가 모드로 초안을 만들기 시작했습니다." : "초안을 만들기 시작했습니다.");
    await refreshDay();
    watchJobs();
  } catch (e) {
    toast(e.message);
    busy($("btn-draft"), false);
  }
}

async function applyDraft() {
  const q = state.day?.job?.extend ? "있는 글에 덧붙인 초안입니다. 앞 글은 사본으로 남기고 이것으로 바꿀까요?" : "이미 content.md 가 있습니다. 사본을 남기고 초안으로 덮어쓸까요?";
  if (state.day?.hasContent && !confirm(q)) return;
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
    $("content-msg").textContent = "미리보기를 만들었습니다. [오류]가 있으면 웹사이트에 올리지 않습니다.";
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
  if (!confirm(`${labelOf(state.date)} 를 커밋하고 GitHub 에 push 합니다. 공개 저장소이고 웹사이트에 바로 실립니다. 계속할까요?`)) return;
  busy($("btn-publish"), true);
  $("publish-msg").textContent = "발행 중…";
  try {
    const r = await api(`/api/days/${state.date}/publish`, { method: "POST", body: { message: $("commit-msg").value }, timeoutMs: 5 * 60 * 1000 });
    const out = $("publish-result");
    out.hidden = false;
    out.innerHTML =
      (r.pushed
        ? `완료 · <a href="${r.url}" target="_blank" rel="noopener">웹사이트의 이 날 ↗</a>`
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

// ---------- 굿뉴스 게시판용 HTML ----------

/** 서버가 python template/build.py <날짜> --board 를 돌려 만든 본문·제목·태그를 받아 복사할 수 있게 보입니다. */
async function makeBoard() {
  if (!state.day?.hasContent) return toast("content.md 가 아직 없습니다.");
  const date = state.date;
  busy($("btn-board"), true);
  $("board-msg").textContent = "만드는 중…";
  try {
    const r = await api(`/api/days/${date}/board`, { method: "POST", body: {}, timeoutMs: 2 * 60 * 1000 });
    if (state.date !== date) return;
    state.board = r;
    $("board-title").textContent = r.title;
    $("board-title-len").textContent = `(${r.title.length}자, 최대 55자)`;
    $("board-tags").textContent = r.tags;
    $("board-html").value = r.html;
    $("board-preview-link").href = r.preview;
    $("board-result").hidden = false;
    $("board-msg").textContent = `본문 ${r.chars.toLocaleString()}자`;
  } catch (e) {
    $("board-msg").textContent = "";
    toast(e.message, 8000);
  } finally {
    busy($("btn-board"), false);
  }
}

/** 클립보드에 넣습니다. 폰 브라우저가 막으면 숨은 글상자를 선택해 복사 명령을 씁니다. */
async function copyText(text, what) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = $("board-html");
    const keep = ta.value;
    ta.value = text;
    ta.closest("details").open = true;
    ta.focus();
    ta.select();
    const ok = document.execCommand && document.execCommand("copy");
    ta.value = keep;
    if (!ok) return toast(`${what}을(를) 복사하지 못했습니다. 아래 글상자에서 길게 눌러 전체 선택해 복사하세요.`, 6000);
  }
  toast(`${what}을(를) 복사했습니다.`);
}

/** 폴더 지우기. 발행한 글이면 서버가 커밋에서도 빼고 push 해 웹사이트에서 내립니다. */
async function removeDay() {
  const date = state.date;
  const label = labelOf(date);
  const q = state.day?.hasContent
    ? `${label} 폴더를 지웁니다. 글(content.md)과 사진, 대화, 초안이 모두 지워지고, 발행한 글이면 웹사이트와 8장 기록에서도 내립니다 (commit + push).\n\n정말 지울까요?`
    : `${label} 폴더를 지웁니다. 노트 사진, 대화, 초안이 모두 지워집니다.\n\n정말 지울까요?`;
  if (!confirm(q)) return;
  busy($("btn-remove-day"), true);
  $("remove-msg").textContent = "지우는 중…";
  try {
    const r = await api(`/api/days/${date}`, { method: "DELETE", timeoutMs: 5 * 60 * 1000 });
    if (!r.published) toast(`${label} 폴더를 지웠습니다.`, 4000);
    else if (r.pushed) toast(`${label} 폴더를 지우고 웹사이트에서도 내렸습니다. 몇 분 안에 사이트에서 사라집니다.`, 6000);
    else toast(`${label} 폴더를 지웠지만 push 가 안 됐습니다: ${r.pushError ?? ""} — 노트북에서 git push 를 해 주세요.`, 8000);
    $("btn-back").click();
  } catch (e) {
    toast(e.message, 6000);
  } finally {
    $("remove-msg").textContent = "";
    busy($("btn-remove-day"), false);
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
    closeAutoModal();
    state.date = null;
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    $("title").innerHTML = "신앙의 이정표 <small>도우미</small>";
    show("view-days");
    loadDays().catch((e) => toast(e.message));
  });
  $("btn-refresh-days").addEventListener("click", () => loadDays().catch((e) => toast(e.message)));
  $("btn-new-day").addEventListener("click", () => newDay(false));
  $("btn-another-day").addEventListener("click", () => newDay(true));
  $("btn-save-conv").addEventListener("click", saveConversation);
  $("conversation").addEventListener("input", renderConvCount);
  $("file-conv").addEventListener("change", (e) => {
    loadConversationFile(e.target.files?.[0]).catch((err) => toast(err.message));
    e.target.value = "";
  });
  $("btn-chat-send").addEventListener("click", sendChat);
  $("chat-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) sendChat();
  });
  $("btn-readings").addEventListener("click", () => loadReadings(true));
  $("btn-chat-clear").addEventListener("click", clearChat);
  $("btn-scrap").addEventListener("click", scrapPhotos);
  for (const k of CROP_KEYS) $(`crop-${k}`).addEventListener("input", drawCropBox);
  $("btn-crop-save").addEventListener("click", saveCrop);
  $("btn-crop-all").addEventListener("click", () => setCropValues({ top: 0, bottom: 1, left: 0, right: 1 }));
  $("btn-crop-close").addEventListener("click", closeCrop);
  $("file-note").addEventListener("change", (e) => uploadPhotos(e.target.files, "note").then(() => (e.target.value = "")));
  $("file-camera").addEventListener("change", (e) => uploadPhotos(e.target.files, "note").then(() => (e.target.value = "")));
  $("file-public").addEventListener("change", (e) => uploadPhotos(e.target.files, "public").then(() => (e.target.value = "")));
  $("btn-draft").addEventListener("click", makeDraft);
  $("btn-run").addEventListener("click", runAuto);
  $("btn-extra").addEventListener("click", addExtra);
  $("extra-ref").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addExtra();
    }
  });
  for (const id of ["extend-auto", "extend-draft"]) {
    $(id).addEventListener("change", (e) => {
      state.extendTouched = true;
      setExtend(e.target.checked);
      if (state.day) renderAuto(state.day);
    });
  }
  $("auto-modal-close").addEventListener("click", closeAutoModal);
  $("auto-modal-back").addEventListener("click", () => $("btn-back").click());
  $("btn-apply").addEventListener("click", applyDraft);
  $("btn-save-content").addEventListener("click", saveContent);
  $("btn-preview").addEventListener("click", makePreview);
  $("btn-git").addEventListener("click", gitStatus);
  $("btn-publish").addEventListener("click", publish);
  $("btn-remove-day").addEventListener("click", () => removeDay().catch((e) => toast(e.message)));
  $("btn-board").addEventListener("click", () => makeBoard().catch((e) => toast(e.message)));
  $("btn-board-copy").addEventListener("click", () => copyText(state.board?.html ?? "", "본문"));
  $("btn-board-copy-title").addEventListener("click", () => copyText(state.board?.title ?? "", "제목"));
  $("btn-board-copy-tags").addEventListener("click", () => copyText(state.board?.tags ?? "", "태그"));

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
    const back = /^#(\d{4}-\d{2}-\d{2}(?:-\d+)?)$/.exec(location.hash); // 같은 날 둘째 글(-2)도 돌아온다
    if (back) openDay(back[1]).catch((e) => toast(e.message));
    else loadDays().catch((e) => toast(e.message));
    watchJobs();
  }
}

// 폰 화면을 다시 켜거나 앱으로 돌아오면 열어 둔 날짜의 상태를 새로 묻습니다.
function refreshOnReturn(e) {
  if (e?.type === "pageshow" && !e.persisted) return; // 처음 열릴 때는 main() 이 이미 읽는다
  if (document.visibilityState !== "visible" || !state.token) return;
  if (state.date) refreshDay().catch(() => {});
  else if (!$("view-days").hidden) loadDays().catch(() => {});
  watchJobs();
}
document.addEventListener("visibilitychange", refreshOnReturn);
window.addEventListener("pageshow", refreshOnReturn);
window.addEventListener("online", refreshOnReturn);

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
