"""content.md 를 읽어 묵상 데이터(dict)로 바꾼다.

형식은 content_template.md 에 설명되어 있다. 게시판용 HTML과 인쇄용 PDF는
모두 여기서 만든 데이터 하나에서 나온다.
"""
import datetime
import re
from pathlib import Path

# 4.1 공통 색상
COLORS = {
    'gold': '#a88a4f',
    'ink': '#2a2622',
    'sub': '#6b625a',
    'line': '#d9d1c3',
    'quote_bg': '#f6f3ec',
}

# 전례 시기 → 강조색
SEASON_ACCENT = {
    '연중': '#5a6b3a',
    '대림': '#5b3f6b',
    '사순': '#5b3f6b',
    '성탄': '#a88a4f',
    '부활': '#a88a4f',
    '성령강림': '#8a2f2f',
    '순교자': '#8a2f2f',
}

SITE_URL = 'https://taeseokyi.github.io/Signposts_of_Faith/'
NOTE_CAPTION = '이 글의 원본인 손글씨 묵상 노트입니다. 개인적인 내용은 가렸습니다.'

WEEKDAYS = '월화수목금토일'
KOREAN_COUNT = ['', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열']

# 섹션 제목 → 종류. 이정표 섹션은 "이정표"가 들어간 제목이면 된다.
SECTION_KINDS = {
    '여는 말씀': 'prologue',
    '나의 묵상 흐름': 'flow',
    '한 줄로 기억하기': 'oneline',
    '다시 펼쳐 볼 때의 물음': 'reflection',
    '근거': 'references',
}
SECTION_ORDER = (
    ('prologue', '여는 말씀'),
    ('milestones', '이정표'),
    ('flow', '나의 묵상 흐름'),
    ('oneline', '한 줄로 기억하기'),
    ('reflection', '다시 펼쳐 볼 때의 물음'),
    ('references', '근거'),
)

FIELD_RE = re.compile(r'^(물음|기억|한 줄|흐름)\s*:\s*(.*)$')
VERSE_REF_RE = re.compile(r'^(—|--)\s*(.+)$')


class ContentError(Exception):
    pass


def parse_front_matter(text):
    if not text.startswith('---\n'):
        raise ContentError('맨 위에 --- 로 시작하는 머리말이 없습니다.')
    end = text.find('\n---\n', 4)
    if end < 0:
        raise ContentError('머리말을 닫는 --- 가 없습니다.')
    meta, key = {}, None
    for line in text[4:end].split('\n'):
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        if line.startswith((' ', '\t')) and line.strip().startswith('- '):
            if key is None:
                raise ContentError(f'머리말 목록 항목의 키가 없습니다: {line}')
            if not isinstance(meta[key], list):
                meta[key] = []
            meta[key].append(line.strip()[2:].strip())
            continue
        if ':' not in line:
            raise ContentError(f'머리말 줄은 "키: 값" 형식이어야 합니다: {line}')
        key, value = line.split(':', 1)
        key, value = key.strip(), value.strip()
        meta[key] = value
    return meta, text[end + 5:]


def split_blocks(lines):
    """빈 줄로 나뉜 블록. 제목(##)과 필드(물음: 등) 줄은 항상 따로 선다."""
    blocks, cur, kind = [], [], None

    def close():
        nonlocal cur, kind
        if cur:
            blocks.append((kind, cur))
        cur, kind = [], None

    for raw in lines:
        line = raw.rstrip()
        if not line.strip():
            close()
            continue
        if line.startswith('## '):
            close()
            blocks.append(('h2', [line[3:].strip()]))
            continue
        m = FIELD_RE.match(line)
        if m:
            close()
            blocks.append(('field', [m.group(1), m.group(2).strip()]))
            continue
        if line.startswith('>'):
            this, line = 'verse', line[1:].strip()
        elif line == '-' or line.startswith('- '):
            this, line = 'list', line[1:].strip()
        elif kind == 'list' and line.startswith('  '):
            cur[-1] += ' ' + line.strip()  # 목록 항목의 이어지는 줄
            continue
        else:
            this = 'para'
        if kind and kind != this:
            close()
        kind = this
        cur.append(line)
    close()
    return blocks


def parse_verse(lines):
    text, ref = [], ''
    for line in lines:
        m = VERSE_REF_RE.match(line)
        if m:
            ref = m.group(2).strip()
        else:
            text.append(line)
    return {'lines': text, 'ref': ref}


def parse(path):
    path = Path(path)
    text = path.read_text(encoding='utf-8-sig').replace('\r\n', '\n')
    meta, body = parse_front_matter(text)
    problems = []  # (수준, 내용): 수준은 '오류' 또는 '주의'

    for key in ('날짜', '전례일', '전례시기', '부제', '복음장절', '독서'):
        if not meta.get(key):
            problems.append(('오류', f'머리말의 "{key}" 항목이 비어 있습니다.'))
    try:
        date = datetime.date.fromisoformat(meta.get('날짜', ''))
    except ValueError:
        raise ContentError(f'날짜는 YYYY-MM-DD 형식이어야 합니다: {meta.get("날짜")!r}')
    if isinstance(meta.get('독서'), str):
        meta['독서'] = [meta['독서']]
    season = meta.get('전례시기', '연중')
    if season not in SEASON_ACCENT:
        problems.append(('오류', f'전례시기 "{season}"를 모릅니다. 가능한 값: {", ".join(SEASON_ACCENT)}'))
        season = '연중'
    meta.setdefault('표지부제', '말씀을 따라 걸은 하루의 묵상')

    # 손글씨 노트 사진: 원저작임을 보여 주려고 공개 글에 함께 싣는다 (날짜 폴더 안의 파일, 쉼표로 여러 장)
    notes = []
    for name in [n.strip() for n in meta.get('노트사진', '').split(',') if n.strip()]:
        if (path.parent / name).is_file():
            notes.append({'file': name, 'path': path.parent / name})
        else:
            problems.append(('오류', f'노트사진 파일이 없습니다: {path.parent.name}/{name}'))

    data = {
        'meta': meta,
        'date': date,
        'weekday': WEEKDAYS[date.weekday()],
        'colors': dict(COLORS, accent=SEASON_ACCENT[season]),
        'prologue': {'verses': [], 'paras': []},
        'milestones_title': '',
        'milestones': [],
        'flow': {'steps': [], 'paras': []},
        'oneline': {'paras': []},
        'reflection': {'intro': [], 'questions': [], 'paras': []},
        'references': [],
        'notes': notes,
        'problems': problems,
    }

    # 섹션(#)으로 나눈다
    sections, heading, buf = [], None, []
    for line in body.split('\n'):
        if line.startswith('# '):
            if heading is not None:
                sections.append((heading, buf))
            heading, buf = line[2:].strip(), []
        elif heading is not None:
            buf.append(line)
        elif line.strip():
            problems.append(('주의', f'첫 섹션(#) 앞의 내용은 무시됩니다: {line[:30]}'))
    if heading is not None:
        sections.append((heading, buf))

    handlers = {
        'prologue': _section_prologue,
        'milestones': _section_milestones,
        'flow': _section_flow,
        'oneline': _section_oneline,
        'reflection': _section_reflection,
        'references': _section_references,
    }
    seen = set()
    for heading, lines in sections:
        kind = 'milestones' if '이정표' in heading else SECTION_KINDS.get(heading)
        if kind is None:
            names = ', '.join(name for _, name in SECTION_ORDER)
            problems.append(('오류', f'알 수 없는 섹션 "# {heading}". 쓸 수 있는 제목: {names}'))
            continue
        seen.add(kind)
        handlers[kind](data, heading, split_blocks(lines))

    for kind, name in SECTION_ORDER:
        if kind not in seen:
            problems.append(('오류', f'"# {name}" 섹션이 없습니다.'))

    n = len(data['milestones'])
    if n and not data['milestones_title']:
        count = KOREAN_COUNT[n] if n < len(KOREAN_COUNT) else str(n)
        data['milestones_title'] = f'{count} 개의 이정표'
    if n and not 3 <= n <= 8:
        problems.append(('주의', f'이정표가 {n}개입니다. (3장 분량 기준: 3~8개)'))
    return data


def _section_prologue(data, heading, blocks):
    for kind, lines in blocks:
        if kind == 'verse':
            data['prologue']['verses'].append(parse_verse(lines))
        elif kind == 'para':
            data['prologue']['paras'].append(lines)
        else:
            data['problems'].append(('주의', f'여는 말씀에서 쓰지 않는 줄: {lines[-1][:30]}'))
    verses = data['prologue']['verses']
    if not 2 <= len(verses) <= 3:
        data['problems'].append(('주의', f'여는 말씀의 성경 구절이 {len(verses)}개입니다. (3장: 2~3개)'))
    for v in verses:
        if not v['ref']:
            data['problems'].append(('오류', f'성경 구절에 장절 줄(> — 루카 12,42)이 없습니다: {v["lines"][0][:30]}'))


def _section_milestones(data, heading, blocks):
    # "# 이정표" 라고만 쓰면 개수에 맞춰 "여덟 개의 이정표" 로 만든다
    data['milestones_title'] = '' if heading == '이정표' else heading
    cur = None
    for kind, lines in blocks:
        if kind == 'h2':
            cur = {'title': lines[0], 'question': '', 'paras': [], 'remember': '', 'oneline': ''}
            data['milestones'].append(cur)
            continue
        if cur is None:
            data['problems'].append(('주의', f'이정표 제목(##) 앞의 내용은 무시됩니다: {lines[-1][:30]}'))
            continue
        if kind == 'field':
            key, value = lines
            target = {'물음': 'question', '기억': 'remember', '한 줄': 'oneline'}.get(key)
            if target is None:
                data['problems'].append(('주의', f'이정표 안에서 쓰지 않는 필드 "{key}:"'))
            else:
                cur[target] = value
        elif kind == 'para':
            cur['paras'].append(lines)
        else:
            data['problems'].append(('주의', f'이정표 "{cur["title"]}"에서 쓰지 않는 줄: {lines[0][:30]}'))
    for i, m in enumerate(data['milestones'], 1):
        for key, name in (('question', '물음'), ('remember', '기억'), ('oneline', '한 줄')):
            if not m[key]:
                data['problems'].append(('오류', f'이정표 {i} "{m["title"]}"에 "{name}:"이 없습니다.'))
        if not m['paras']:
            data['problems'].append(('오류', f'이정표 {i} "{m["title"]}"에 본문이 없습니다.'))


def _section_flow(data, heading, blocks):
    for kind, lines in blocks:
        if kind == 'field' and lines[0] == '흐름':
            data['flow']['steps'] = [s.strip() for s in re.split(r'→|->', lines[1]) if s.strip()]
        elif kind == 'para':
            data['flow']['paras'].append(lines)
        else:
            data['problems'].append(('주의', f'나의 묵상 흐름에서 쓰지 않는 줄: {lines[-1][:30]}'))
    if not data['flow']['steps']:
        data['problems'].append(('오류', '나의 묵상 흐름에 "흐름: 초대 → 만남 → …" 줄이 없습니다.'))


def _section_oneline(data, heading, blocks):
    for kind, lines in blocks:
        if kind == 'para':
            data['oneline']['paras'].append(lines)
        else:
            data['problems'].append(('주의', '한 줄로 기억하기의 문장은 각 이정표의 "한 줄:"에 씁니다. 이 섹션에는 맺음말만 둡니다.'))


def _section_reflection(data, heading, blocks):
    r = data['reflection']
    for kind, lines in blocks:
        if kind == 'list':
            r['questions'].extend(lines)
        elif kind == 'para':
            (r['paras'] if r['questions'] else r['intro']).append(lines)
        else:
            data['problems'].append(('주의', f'다시 펼쳐 볼 때의 물음에서 쓰지 않는 줄: {lines[-1][:30]}'))
    if not 3 <= len(r['questions']) <= 4:
        data['problems'].append(('주의', f'성찰 물음이 {len(r["questions"])}개입니다. (3장: 3~4개)'))


def _section_references(data, heading, blocks):
    cur = None
    for kind, lines in blocks:
        if kind == 'h2':
            cur = {'title': lines[0], 'items': []}
            data['references'].append(cur)
        elif kind == 'list' and cur is not None:
            cur['items'].extend(item for item in lines if item)
        else:
            data['problems'].append(('주의', f'근거에서는 "## 분류" 아래 "- 항목"만 씁니다: {lines[-1][:30]}'))


def title_of(data):
    """게시글 제목. 6장 규칙: [MM.DD.요일] 신앙의 이정표 - 부제 (복음 장절)"""
    d, m = data['date'], data['meta']
    return f"[{d.month:02d}.{d.day:02d}.{data['weekday']}] 신앙의 이정표 - {m['부제']} ({m['복음장절']})"


def pdf_name_of(data):
    """PDF 파일명. 5장 규칙: YYYY-MM-DD_신앙의_이정표_부제.pdf"""
    subtitle = re.sub(r'\s+', '_', data['meta']['부제'].strip())
    subtitle = re.sub(r'[\\/:*?"<>|]', '', subtitle)
    return f"{data['date'].isoformat()}_신앙의_이정표_{subtitle}.pdf"


def date_label(data):
    d = data['date']
    return f'{d.year}년 {d.month}월 {d.day}일'


def inline(text):
    """본문 안의 **굵게**, *기울임* 만 지원한다. 나머지는 HTML 이스케이프."""
    import html
    out = html.escape(text, quote=False)
    out = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', out)
    return re.sub(r'\*(.+?)\*', r'<i>\1</i>', out)


def lines_html(lines):
    """한 문단 안의 줄바꿈은 그대로 살린다."""
    return '<br>'.join(inline(line) for line in lines)
