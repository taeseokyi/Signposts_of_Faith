// 「신앙의 이정표」 도우미 화면. 같은 서버(server/server.mjs)가 이 파일과 API 를 함께 냅니다.
// 토큰은 이 브라우저의 localStorage 에만 둡니다.

const $ = (id) => document.getElementById(id);
const SITE_URL = "https://taeseokyi.github.io/Signposts_of_Faith/";
const state = { token: "", date: null, day: null, poll: null, chatting: false, scrapping: false, crop: null };

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
    if (d.job?.status === "running" || d.job?.status === "queued") tags.push([d.job.mode === "publish" ? "발행 작업 중" : "초안 작성 중", "run"]);
    else if (d.job?.status === "error") tags.push([d.job.mode === "publish" ? "발행 실패" : "초안 실패", "bad"]);
    else if (d.job?.status === "hold") tags.push(["확인 필요", "run"]);
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
  closeCrop();
  $("photo-msg").textContent = "";
  $("chat-msg").textContent = "";
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
  // 0. 한 번에 발행
  renderAuto(day);

  // 1. 대화
  const turns = day.chatTurns ?? 0;
  if (!state.chatting) renderChat(day.chat?.messages ?? []);
  if (document.activeElement !== $("conversation")) $("conversation").value = turns ? "" : day.conversation;
  $("paste-box").open = !turns && day.hasConversation;
  setBadge("b-conv", turns ? `물음 ${turns}개` : day.hasConversation ? "붙여 넣음" : "없음", day.hasConversation ? "ok" : "");
  if (day.chat?.costUsd) $("chat-msg").textContent = `지금까지 약 $${day.chat.costUsd.toFixed(2)}`;

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
        (sc ? `<span class="tag ${sc.has_day ? "ok" : "no"}" title="${escapeHtml(sc.evidence ?? "")}">${sc.has_day ? "이 날짜 ✓" : "다른 날"}</span>` : "") +
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
    draftBtn.disabled = false;
    if (job?.status === "error") {
      setBadge("b-draft", "실패", "bad");
      $("draft-msg").textContent = job.error ?? "";
    } else if (job?.status === "done" || job?.status === "hold") {
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

// ---------- 한 번에 발행 ----------

const STEP_ICON = { wait: "○", run: "◐", ok: "●", skip: "–", fail: "✕", hold: "■" };

function renderAuto(day) {
  const job = day.job;
  const ready = $("ready");
  const items = [
    [day.hasConversation, day.chatTurns ? `대화 (물음 ${day.chatTurns}개)` : day.hasConversation ? "대화 (붙여 넣음)" : "대화 없음 — 노트만으로 물음을 세웁니다"],
    [day.notes.length > 0, day.notes.length ? `노트 사진 원본 ${day.notes.length}장` : "노트 사진 없음"],
    [day.publicPhotos.length > 0, day.publicPhotos.length ? `공개용 ${day.publicPhotos.length}장 (있으면 자르기 단계는 건너뜀)` : "공개용 사진은 발행할 때 자릅니다"],
    [day.hasContent, day.hasContent ? "content.md 있음 — 다시 누르면 초안을 새로 써서 덮어씁니다 (손으로 고친 것은 사본에만 남음). 고친 글을 다시 올리려면 4단계에서 저장하고 5단계로 발행하세요" : "content.md 아직 없음"],
  ];
  ready.innerHTML = items.map(([ok, text]) => `<li class="${ok ? "ok" : "no"}">${escapeHtml(text)}</li>`).join("");

  const running = job && (job.status === "running" || job.status === "queued");
  const canRun = (day.hasConversation || day.notes.length) && !running && !state.chatting;
  $("btn-run").disabled = !canRun;
  if (document.activeElement !== $("stop-before-publish") && job?.stopBeforePublish != null && !running) {
    $("stop-before-publish").checked = Boolean(job.stopBeforePublish);
  }

  const steps = $("steps");
  steps.innerHTML = "";
  if (job?.mode === "publish" && Array.isArray(job.steps)) {
    for (const st of job.steps) {
      const li = document.createElement("li");
      li.className = st.status;
      li.innerHTML = `${STEP_ICON[st.status] ?? "○"} ${escapeHtml(st.label)}` + (st.detail ? `<br><span class="d">${escapeHtml(st.detail)}</span>` : "");
      steps.appendChild(li);
    }
  }

  const msg = $("auto-msg");
  if (!job || job.mode !== "publish") {
    setBadge("b-auto", running ? "초안 작업 중" : "", running ? "warn" : "");
    msg.textContent = "";
  } else if (running) {
    setBadge("b-auto", job.status === "queued" ? "대기 중" : "진행 중", "warn");
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
      ? `커밋 <code>${escapeHtml(job.publish.commit)}</code> · 몇 분 뒤 <a href="${job.publish.url}" target="_blank" rel="noopener">${job.publish.url}</a> 에 실립니다.` +
        (job.costUsd ? ` · 약 $${job.costUsd.toFixed(2)}` : "")
      : `커밋은 됐지만 push 가 안 됐습니다: ${escapeHtml(job.publish.pushError ?? "")} — 5단계에서 git 상태를 보고 노트북에서 push 하세요.`;
  } else {
    setBadge("b-auto", "", "");
    msg.textContent = "";
  }
}

async function runAuto() {
  if (!state.day) return;
  const stop = $("stop-before-publish").checked;
  const what = stop ? "사진 자르기 → 초안 → content.md 까지 만들고 발행 앞에서 멈춥니다." : "사진 자르기 → 초안 → content.md → 커밋과 push 까지 한 번에 합니다. 공개 저장소이고 웹사이트에 바로 실립니다.";
  const again = state.day.hasContent ? "\n\n이미 content.md 가 있는 날입니다. 초안을 새로 써서 덮어쓰며, 손으로 고친 내용은 사본에만 남습니다. 고친 글을 그대로 올리려면 취소하고 5단계 발행을 쓰세요." : "";
  if (!confirm(`${state.date}: ${what}${again}\n\n시작할까요?`)) return;
  busy($("btn-run"), true);
  try {
    await api(`/api/days/${state.date}/run`, { method: "POST", body: { instructions: $("instructions").value, stopBeforePublish: stop } });
    toast("시작했습니다. 몇 분 걸립니다.");
    await refreshDay();
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

function renderChat(messages) {
  const log = $("chat-log");
  log.innerHTML = "";
  for (const m of messages) log.appendChild(chatBubble(m.role, m.text));
  log.scrollTop = log.scrollHeight;
}

const CHAT_TEMPLATE = `오늘 독서와 복음으로 묵상하려고 해. 답변에 대한 근거는 항상 마지막에 정리해 줘.
교과서적인 설명보다 내 삶의 물음에 답해 주고, 족쇄처럼 무거워지지 않게 해 줘.
정리한 내용은 「신앙의 이정표」로 만들어 웹사이트에 올릴 거야.

전례일: 
독서: (장절과 본문)
복음: (장절과 본문)

첫 번째 물음: `;

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
        bubble.textContent = acc;
        log.scrollTop = log.scrollHeight;
      } else if (ev.status) {
        bubble.innerHTML = (acc ? renderMarkdown(acc) : "") + `<span class="status">${escapeHtml(ev.status)}</span>`;
      } else if (ev.done) {
        acc = ev.text || acc;
        if (ev.costUsd) $("chat-msg").textContent = `이번 답 약 $${ev.costUsd.toFixed(2)}`;
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
  if (!confirm("이 날짜의 대화를 모두 지울까요? 대화.md 도 함께 지워집니다.")) return;
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
  $("btn-chat-send").addEventListener("click", sendChat);
  $("chat-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) sendChat();
  });
  $("btn-chat-template").addEventListener("click", () => {
    const input = $("chat-input");
    if (input.value.trim() && !confirm("적던 내용을 지우고 시작 틀을 넣을까요?")) return;
    input.value = CHAT_TEMPLATE;
    input.focus();
    input.setSelectionRange(input.value.indexOf("전례일: ") + 5, input.value.indexOf("전례일: ") + 5);
  });
  $("btn-chat-clear").addEventListener("click", clearChat);
  $("btn-scrap").addEventListener("click", scrapPhotos);
  for (const k of CROP_KEYS) $(`crop-${k}`).addEventListener("input", drawCropBox);
  $("btn-crop-save").addEventListener("click", saveCrop);
  $("btn-crop-all").addEventListener("click", () => setCropValues({ top: 0, bottom: 1, left: 0, right: 1 }));
  $("btn-crop-close").addEventListener("click", closeCrop);
  $("file-note").addEventListener("change", (e) => uploadPhotos(e.target.files, "note").then(() => (e.target.value = "")));
  $("file-public").addEventListener("change", (e) => uploadPhotos(e.target.files, "public").then(() => (e.target.value = "")));
  $("btn-draft").addEventListener("click", makeDraft);
  $("btn-run").addEventListener("click", runAuto);
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
