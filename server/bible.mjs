// 굿뉴스 성경(주교회의 『성경』)에서 장절로 본문을 가져옵니다.
//   https://maria.catholic.or.kr/bible/read/bible_read.asp?m=<1|2>&n=<책 번호>&p=<장>
// 책 번호는 101(창세기)부터 173(요한 묵시록)까지. 절은 <td class="num_color">번호</td><td class="al tt">본문</td> 쌍입니다.
//
// 장절 쓰는 법 (어느 것이든 됩니다): "요한 15,5-8", "요한 15:5", "요한복음 15장 5절", "1코린 13,4-7", "코린토 1서 13,4", "시편 23", "사무엘기 상권 3,10"

const READ_URL = "https://maria.catholic.or.kr/bible/read/bible_read.asp";

// [약칭, 책 번호, 긴 이름]. 약칭은 굿뉴스·매일미사가 쓰는 것입니다.
const BOOKS = [
  ["창세", 101, "창세기"], ["탈출", 102, "탈출기"], ["레위", 103, "레위기"], ["민수", 104, "민수기"], ["신명", 105, "신명기"],
  ["여호", 106, "여호수아기"], ["판관", 107, "판관기"], ["룻", 108, "룻기"], ["1사무", 109, "사무엘기 상권"], ["2사무", 110, "사무엘기 하권"],
  ["1열왕", 111, "열왕기 상권"], ["2열왕", 112, "열왕기 하권"], ["1역대", 113, "역대기 상권"], ["2역대", 114, "역대기 하권"],
  ["에즈", 115, "에즈라기"], ["느헤", 116, "느헤미야기"], ["토빗", 117, "토빗기"], ["유딧", 118, "유딧기"], ["에스", 119, "에스테르기"],
  ["1마카", 120, "마카베오기 상권"], ["2마카", 121, "마카베오기 하권"], ["욥", 122, "욥기"], ["시편", 123, "시편"], ["잠언", 124, "잠언"],
  ["코헬", 125, "코헬렛"], ["아가", 126, "아가"], ["지혜", 127, "지혜서"], ["집회", 128, "집회서"], ["이사", 129, "이사야서"],
  ["예레", 130, "예레미야서"], ["애가", 131, "애가"], ["바룩", 132, "바룩서"], ["에제", 133, "에제키엘서"], ["다니", 134, "다니엘서"],
  ["호세", 135, "호세아서"], ["요엘", 136, "요엘서"], ["아모", 137, "아모스서"], ["오바", 138, "오바드야서"], ["요나", 139, "요나서"],
  ["미카", 140, "미카서"], ["나훔", 141, "나훔서"], ["하바", 142, "하바쿡서"], ["스바", 143, "스바니야서"], ["하까", 144, "하까이서"],
  ["즈카", 145, "즈카르야서"], ["말라", 146, "말라키서"],
  ["마태", 147, "마태오 복음서"], ["마르", 148, "마르코 복음서"], ["루카", 149, "루카 복음서"], ["요한", 150, "요한 복음서"],
  ["사도", 151, "사도행전"], ["로마", 152, "로마서"], ["1코린", 153, "코린토 1서"], ["2코린", 154, "코린토 2서"], ["갈라", 155, "갈라티아서"],
  ["에페", 156, "에페소서"], ["필리", 157, "필리피서"], ["콜로", 158, "콜로새서"], ["1테살", 159, "테살로니카 1서"], ["2테살", 160, "테살로니카 2서"],
  ["1티모", 161, "티모테오 1서"], ["2티모", 162, "티모테오 2서"], ["티토", 163, "티토서"], ["필레", 164, "필레몬서"], ["히브", 165, "히브리서"],
  ["야고", 166, "야고보서"], ["1베드", 167, "베드로 1서"], ["2베드", 168, "베드로 2서"], ["1요한", 169, "요한 1서"], ["2요한", 170, "요한 2서"],
  ["3요한", 171, "요한 3서"], ["유다", 172, "유다서"], ["묵시", 173, "요한 묵시록"],
];
const BY_ABBR = new Map(BOOKS.map(([abbr, n, name]) => [abbr, { abbr, n, name }]));

/** 화면의 책 고르기 목록: 구약(101~146)과 신약(147~173). */
export function bookList() {
  return BOOKS.map(([abbr, n, name]) => ({ abbr, n, name, testament: n >= 147 ? "신약" : "구약" }));
}

/** "코린토 1서", "사무엘기 상권", "요한복음", "묵시록", "1요한" 같은 이름을 책으로. 못 찾으면 null. */
export function findBook(raw) {
  let s = String(raw).replace(/\s+/g, "");
  let num = "";
  let m;
  if ((m = /^([1-3])(.+)$/.exec(s))) [num, s] = [m[1], m[2]]; // 1코린, 2사무
  if ((m = /^(.+?)제?([1-3])서$/.exec(s))) [num, s] = [m[2], m[1]]; // 코린토 1서
  if ((m = /^(.+?)(상|하)권?$/.exec(s))) [num, s] = [m[2] === "상" ? "1" : "2", m[1]]; // 사무엘기 상권
  if ((m = /^(.+?)(첫째|둘째|셋째)$/.exec(s))) [num, s] = [{ 첫째: "1", 둘째: "2", 셋째: "3" }[m[2]], m[1]];
  s = s.replace(/^(요한)?묵시록$/, "묵시").replace(/복음서?$/, "").replace(/행전$/, "").replace(/(기|서)$/, "");
  for (const len of [2, 1]) {
    const hit = BY_ABBR.get(num + s.slice(0, len));
    if (hit) return hit;
  }
  return null;
}

/**
 * 장절 문자열을 풉니다. @returns {{book, chapter:number, verses:number[]|null, ref:string}|null}
 *   verses 가 null 이면 장 전체.
 */
export function parseRef(input) {
  const s = String(input).trim().replace(/\s+/g, " ");
  // 책 이름: 숫자(1~3)로 시작할 수 있고, 한글로 끝난다. 그 뒤가 장절.
  const m = /^([1-3]?\s?[가-힣]+(?:\s[가-힣]+)*?(?:\s?[1-3]서)?)\s*(\d+)\s*(?:[,:장]\s*|$)(.*)$/.exec(s);
  if (!m) return null;
  const book = findBook(m[1]);
  if (!book) return null;
  const chapter = Number(m[2]);
  const spec = m[3].replace(/절/g, "").replace(/\s+/g, "").replace(/[–—~]/g, "-");
  let verses = null;
  if (spec) {
    verses = [];
    for (const part of spec.split(/[.;]/).filter(Boolean)) {
      const r = /^(\d+)(?:-(\d+))?$/.exec(part);
      if (!r) return null;
      const a = Number(r[1]);
      const b = r[2] ? Number(r[2]) : a;
      if (b < a || b - a > 200) return null;
      for (let v = a; v <= b; v++) verses.push(v);
    }
    if (!verses.length) return null;
  }
  return { book, chapter, verses, ref: `${book.abbr} ${chapter}${verses ? "," + compact(verses) : ""}` };
}

/** [5,6,7,9] → "5-7.9" */
function compact(verses) {
  const out = [];
  let start = verses[0];
  let prev = verses[0];
  for (const v of verses.slice(1).concat([null])) {
    if (v === prev + 1) {
      prev = v;
      continue;
    }
    out.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = prev = v;
  }
  return out.join(".");
}

/** 한 장의 절들을 가져옵니다. @returns {Promise<{n:number,text:string}[]>} */
export async function fetchChapter(book, chapter, { timeoutMs = 20000 } = {}) {
  const url = `${READ_URL}?m=${book.n >= 147 ? 2 : 1}&n=${book.n}&p=${chapter}`;
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
  return parseChapter(html);
}

export function parseChapter(html) {
  const out = [];
  const re = /<td class="num_color"[^>]*>\s*<span[^>]*>\s*(\d+)\s*<\/span>\s*<\/td>\s*<td class="al tt"[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/g;
  let m;
  while ((m = re.exec(html))) {
    const text = m[2].replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
    if (text) out.push({ n: Number(m[1]), text });
  }
  return out;
}

/**
 * 장절로 본문을. @returns {Promise<{ref, book, chapter, verses:{n,text}[], text}>}
 *   text 는 "5 나는 포도나무요 … 6 …" 처럼 절 번호를 앞에 둔 줄글.
 */
export async function fetchPassage(input) {
  const p = parseRef(input);
  if (!p) throw Object.assign(new Error(`장절을 알아보지 못했습니다: "${input}" — 예: 요한 15,5-8 · 시편 23,1-4 · 코린토 1서 13,4`), { status: 400 });
  const all = await fetchChapter(p.book, p.chapter);
  if (!all.length) throw new Error(`${p.book.name} ${p.chapter}장을 굿뉴스에서 읽지 못했습니다. 장이 없거나 페이지 구조가 바뀌었을 수 있습니다.`);
  const verses = p.verses ? all.filter((v) => p.verses.includes(v.n)) : all;
  if (!verses.length) throw Object.assign(new Error(`${p.book.name} ${p.chapter}장에 ${compact(p.verses)}절이 없습니다 (${all.length}절까지).`), { status: 400 });
  return {
    ref: p.ref,
    book: p.book.abbr,
    bookName: p.book.name,
    chapter: p.chapter,
    verses,
    text: verses.map((v) => `${v.n} ${v.text}`).join("\n"),
    source: `${READ_URL}?m=${p.book.n >= 147 ? 2 : 1}&n=${p.book.n}&p=${p.chapter}`,
  };
}
