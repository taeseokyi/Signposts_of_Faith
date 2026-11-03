// 굿뉴스 매일미사(주교회의)에서 그날의 전례일과 독서·복음 본문을 가져옵니다.
//   https://maria.catholic.or.kr/mi_pr/missa/missa.asp?missaid=&gomonth=YYYY-MM-DD
// 평일은 제1독서·복음, 주일과 대축일은 제2독서가 더 있습니다. 한 날에 미사가 여럿이면(위령의 날 등) 첫 미사를 가져옵니다.

const MISSA_URL = "https://maria.catholic.or.kr/mi_pr/missa/missa.asp";
const KINDS = ["제1독서", "제2독서", "복음"];

export async function fetchReadings(date, { timeoutMs = 20000 } = {}) {
  const url = `${MISSA_URL}?missaid=&gomonth=${date}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let html;
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "Mozilla/5.0 (Signposts helper)" } });
    if (!res.ok) throw new Error(`굿뉴스 응답 ${res.status}`);
    html = await res.text();
  } finally {
    clearTimeout(timer);
  }
  const parsed = parseMissa(html, date);
  if (!parsed.readings.length) throw new Error("굿뉴스 페이지에서 독서·복음을 찾지 못했습니다. 페이지 구조가 바뀌었을 수 있습니다.");
  return { ...parsed, date, source: url, fetchedAt: new Date().toISOString() };
}

/** 페이지 HTML 에서 전례일과 독서·복음을 뽑습니다. */
export function parseMissa(html, date) {
  // 달력 목록에서 이 날짜의 첫 항목: <li class=" active "> … (<span class="daycolor">녹</span>)연중 제31주간 화요일
  // 달력 목록에서 이 날짜의 첫 링크: <a href="?…&gomonth=2026-11-03&…"> (<span class="daycolor">녹</span>)연중 제31주간 화요일
  let title = "";
  let color = "";
  const m = new RegExp(`gomonth=${date}&[^>]*>[\\s\\S]{0,400}?class="daycolor">([^<]*)<\\/span>\\)\\s*([^<]+)`).exec(html);
  if (m) {
    color = m[1].trim();
    title = m[2].replace(/\s+/g, " ").trim();
  }

  const heads = [...html.matchAll(/<h3 class="bd_tit[^"]*">([\s\S]*?)<\/h3>/g)].map((m) => ({ pos: m.index, name: stripTags(m[1]).trim() }));
  const readings = [];
  heads.forEach((h, i) => {
    if (!KINDS.includes(h.name)) return;
    const end = i + 1 < heads.length ? heads[i + 1].pos : html.length;
    const block = html.slice(h.pos, end);
    const body = /<div class="board_layout[^"]*">([\s\S]*?)<\/div>/.exec(block);
    const text = cleanText(body ? body[1] : block);
    if (!text) return;
    readings.push({ kind: h.name, ...describe(h.name, text), text });
  });
  return { title, color, readings };
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, "");
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** 본문 HTML 을 줄글로. 끝의 전례 지시문(<강론 후 잠시 묵상한다.> <신경> 등)은 뗍니다. */
function cleanText(inner) {
  let t = inner.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n");
  t = decodeEntities(stripTags(t));
  const lines = t
    .split("\n")
    .map((l) => l.replace(/[ \t\r ]+/g, " ").trim())
    .filter(Boolean);
  // 마지막 응답(◎ …) 뒤에 오는 <…> 지시문 줄은 뺀다
  const last = lines.map((l) => l.startsWith("◎")).lastIndexOf(true);
  const kept = last >= 0 ? lines.slice(0, last + 1).concat(lines.slice(last + 1).filter((l) => !/^<.*>$/.test(l))) : lines;
  return kept.join("\n").trim();
}

/** "▥ 사도 바오로의 필리피서 말씀입니다.2,5-11" → { book: "필리피서", chapter: "2,5-11", ref: "필리피서 2,5-11" } */
function describe(kind, text) {
  const lines = text.split("\n");
  const heading = (lines.find((l) => /^<.*>$/.test(l)) ?? "").replace(/^<|>$/g, "").trim();
  const src = lines.find((l) => /^[▥✠]/.test(l)) ?? "";
  let book = "";
  let chapter = "";
  let m;
  if ((m = /^✠\s*(.+?)가 전한 거룩한 복음입니다\.?\s*([\d,\-.;]+)/.exec(src))) {
    book = m[1].trim();
    chapter = m[2];
  } else if ((m = /^▥\s*(.+?)\s*말씀입니다\.?\s*([\d,\-.;]+)/.exec(src))) {
    book = m[1]
      .replace(/^(사도 )?바오로의\s+/, "")
      .replace(/^사도\s+\S+의\s+/, "")
      .replace(/^성\s+/, "")
      .replace(/의$/, "")
      .trim();
    chapter = m[2];
  }
  const ref = book && chapter ? `${book} ${chapter}` : src.replace(/^[▥✠]\s*/, "");
  return { heading, book, chapter, ref };
}

/** 한 줄 요약: "연중 제31주간 화요일 · 제1독서 필리피서 2,5-11 · 복음 루카 14,15-24" */
export function readingsSummary(r) {
  if (!r) return "";
  const parts = [];
  if (r.title) parts.push(r.title);
  for (const x of r.readings) parts.push(`${x.kind} ${x.ref}`);
  for (const x of r.extra ?? []) parts.push(`더한 말씀 ${x.ref}`);
  return parts.join(" · ");
}

/** 대화 첫 마디와 대화.md 에 넣을 말씀 본문 블록. 사용자가 더한 구절(extra)도 뒤에 붙습니다. */
export function readingsBlock(r) {
  if (!r) return "";
  const parts = [];
  if (r.title) parts.push(`전례일: ${r.title}`);
  for (const x of r.readings) parts.push(`${x.kind} (${x.ref})\n${x.text}`);
  for (const x of r.extra ?? []) parts.push(`더한 말씀 (${x.ref}) — 묵상하다 떠올라 사용자가 더한 구절\n${x.text}`);
  return parts.join("\n\n");
}
