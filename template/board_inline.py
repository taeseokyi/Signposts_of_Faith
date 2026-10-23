"""묵상 데이터 → 게시판용 HTML (WORKFLOW.md 4.3).

굿뉴스 게시판(SmartEditor 2)은 인라인 style 만 남기므로, 모든 꾸밈을 각 태그의
style 속성에 직접 쓰고 레이아웃은 표로 짠다. 사이트가 휴대폰에서 30%로 축소돼
열리므로 글자는 인쇄본보다 크게 잡는다 (본문 17px, 가장 작은 글자 14px).
"""
import re
from html.parser import HTMLParser

from content import date_label, inline, lines_html

FONT = "font-family:'Noto Serif KR','Nanum Myeongjo','나눔명조','Batang','바탕',serif;"

# 글자 크기 (px). 4.3: 본문 16~17, 보조 14 이상
SIZE = {
    'body': 17,
    'small': 15,
    'min': 14,
    'eyebrow': 14,
    'section': 24,
    'milestone_no': 30,
    'milestone_title': 20,
    'cover_title': 34,
}

ALLOWED_TAGS = {'div', 'table', 'tbody', 'tr', 'td', 'p', 'span', 'ul', 'li', 'br', 'b', 'strong', 'i', 'img'}
LENGTH_CHECKED = 36000  # 이 길이까지 올라가는 것을 확인했다 (2026-10-21 글)

EYEBROWS = {
    'prologue': 'PROLOGUE',
    'milestones': 'MILESTONES',
    'flow': 'MY FLOW',
    'oneline': 'IN ONE LINE',
    'reflection': 'REFLECTION',
    'references': 'REFERENCES',
}


def _style(**kw):
    return ';'.join(f"{k.replace('_', '-')}:{v}" for k, v in kw.items()) + ';'


def render(data):
    c = data['colors']

    def base(color=None):
        return FONT + f"color:{color or c['ink']};"

    text = base()

    def p(content, size, color=None, **extra):
        extra.setdefault('margin', '0 0 14px')
        extra.setdefault('line_height', '1.9')
        return f'<p style="{base(color)}{_style(font_size=f"{size}px", **extra)}">{content}</p>'

    def section_head(kind, title):
        return (
            p(EYEBROWS[kind], SIZE['eyebrow'], c['gold'], text_align='center', margin='48px 0 6px', letter_spacing='4px')
            + p(inline(title), SIZE['section'], c['ink'], text_align='center', margin='0', font_weight='bold', letter_spacing='2px', line_height='1.5')
            + f'<p style="text-align:center;margin:12px 0 26px;"><span style="display:inline-block;width:48px;border-top:1px solid {c["gold"]};"></span></p>'
        )

    def table(cells, **extra):
        extra.setdefault('margin', '0 0 14px')
        return f'<table style="{_style(width="100%", border_collapse="collapse", **extra)}"><tbody>{cells}</tbody></table>'

    out = []
    meta = data['meta']

    # 표지: 금색 이중 테두리
    cover = (
        p(inline(meta['전례일']), SIZE['min'], c['gold'], text_align='center', margin='0 0 22px', letter_spacing='4px')
        + p('†', 24, c['gold'], text_align='center', margin='0 0 14px')
        + p('신앙의 이정표', SIZE['cover_title'], c['ink'], text_align='center', margin='0 0 14px', font_weight='bold', letter_spacing='6px', line_height='1.4')
        + p(inline(meta['표지부제']), SIZE['small'], c['sub'], text_align='center', margin='0 0 30px', letter_spacing='2px')
        + p('<br>'.join(inline(r) for r in meta['독서']), SIZE['body'], c['accent'], text_align='center', margin='0')
        + p(date_label(data), SIZE['min'], c['sub'], text_align='center', margin='26px 0 0', letter_spacing='2px')
    )
    inner = table(f'<tr><td style="{text}{_style(border=f"1px solid {c["gold"]}", padding="48px 20px", text_align="center")}">{cover}</td></tr>', margin='0')
    out.append(table(f'<tr><td style="{_style(border=f"1px solid {c["gold"]}", padding="6px")}">{inner}</td></tr>', margin='0 0 20px'))

    # 여는 말씀
    out.append(section_head('prologue', '여는 말씀'))
    for v in data['prologue']['verses']:
        ref = p(inline(v['ref']), SIZE['min'], c['sub'], text_align='right', margin='8px 0 0', line_height='1.5')
        cell = (f'<td style="{text}{_style(background=c["quote_bg"], border_left=f"3px solid {c["accent"]}", padding="18px 20px", font_size=f"{SIZE["body"]}px", line_height="1.9")}">'
                f'{lines_html(v["lines"])}{ref}</td>')
        out.append(table(f'<tr>{cell}</tr>'))
    for lines in data['prologue']['paras']:
        out.append(p(lines_html(lines), SIZE['small'], c['sub'], text_align='center', margin='26px 0 0'))

    # 이정표
    out.append(section_head('milestones', data['milestones_title']))
    for i, m in enumerate(data['milestones'], 1):
        body = (
            p(inline(m['title']), SIZE['milestone_title'], c['ink'], font_weight='bold', margin='2px 0 8px', line_height='1.5')
            + p('물음 · ' + inline(m['question']), SIZE['small'], c['sub'], margin='0 0 16px', line_height='1.7')
            + ''.join(p(lines_html(lines), SIZE['body'], c['ink'], margin='0 0 14px') for lines in m['paras'])
            + table(f'<tr><td style="{base(c["accent"])}{_style(border_left=f"3px solid {c["gold"]}", padding="4px 0 4px 16px", font_size=f"{SIZE["body"]}px", line_height="1.8")}">{inline(m["remember"])}</td></tr>', margin='6px 0 0')
        )
        row = (f'<tr><td style="{base(c["accent"])}{_style(width="48px", vertical_align="top", font_size=f"{SIZE["milestone_no"]}px", line_height="1.2", padding="0 8px 0 0")}">{i}</td>'
               f'<td style="{text}{_style(vertical_align="top", padding="0")}">{body}</td></tr>')
        out.append(table(row, margin='0 0 40px'))

    # 나의 묵상 흐름
    out.append(section_head('flow', '나의 묵상 흐름'))
    cells = []
    for k, step in enumerate(data['flow']['steps']):
        if k:
            cells.append(f'<td style="{base(c["gold"])}{_style(font_size=f"{SIZE["min"]}px", padding="0 2px", text_align="center")}">→</td>')
        cells.append(f'<td style="{base(c["accent"])}{_style(border=f"1px solid {c["gold"]}", padding="8px 6px", font_size=f"{SIZE["small"]}px", text_align="center", line_height="1.4")}">{inline(step)}</td>')
    out.append(table(f'<tr>{"".join(cells)}</tr>', margin='0 0 22px'))
    for lines in data['flow']['paras']:
        out.append(p(lines_html(lines), SIZE['body'], c['ink'], text_align='center'))

    # 한 줄로 기억하기
    out.append(section_head('oneline', '한 줄로 기억하기'))
    rows = ''.join(
        f'<tr><td style="{base(c["gold"])}{_style(width="32px", vertical_align="top", font_size=f"{SIZE["small"]}px", padding="10px 0", border_bottom=f"1px solid {c["line"]}")}">{i}</td>'
        f'<td style="{text}{_style(font_size=f"{SIZE["body"]}px", line_height="1.7", padding="10px 0", border_bottom=f"1px solid {c["line"]}")}">{inline(m["oneline"])}</td></tr>'
        for i, m in enumerate(data['milestones'], 1)
    )
    out.append(table(rows, margin='0 0 22px'))
    for lines in data['oneline']['paras']:
        out.append(p(lines_html(lines), SIZE['small'], c['sub'], text_align='center'))

    # 다시 펼쳐 볼 때의 물음
    r = data['reflection']
    out.append(section_head('reflection', '다시 펼쳐 볼 때의 물음'))
    for lines in r['intro']:
        out.append(p(lines_html(lines), SIZE['small'], c['sub'], text_align='center', margin='0 0 22px'))
    rows = ''.join(
        f'<tr><td style="{text}{_style(font_size=f"{SIZE["body"]}px", line_height="1.8", padding="14px 4px", border_bottom=f"1px solid {c["line"]}")}">{inline(q)}</td></tr>'
        for q in r['questions']
    )
    out.append(table(rows, margin='0 0 28px'))
    for lines in r['paras']:
        out.append(p(lines_html(lines), SIZE['small'], c['sub'], text_align='center'))

    # 근거
    out.append(section_head('references', '근거'))
    for group in data['references']:
        out.append(p(inline(group['title']), SIZE['small'], c['accent'], font_weight='bold', margin='22px 0 6px'))
        items = ''.join(
            f'<li style="{base(c["sub"])}{_style(font_size=f"{SIZE["min"]}px", line_height="1.8", margin="0 0 4px")}">{inline(item)}</li>'
            for item in group['items']
        )
        out.append(f'<ul style="{_style(margin="0", padding_left="20px")}">{items}</ul>')

    return f'<div style="{text}max-width:720px;margin:0 auto;">{"".join(out)}</div>'


def preview_page(fragment, title):
    """board.html 을 브라우저에서 미리 보기 위한 문서. 게시판 본문 폭(720px)에 맞춘다."""
    return (
        '<!doctype html><html lang="ko"><head><meta charset="utf-8">'
        f'<title>{title}</title>'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '</head><body style="margin:0;background:#ffffff;">'
        '<div style="max-width:720px;margin:24px auto;padding:0 16px;">'
        f'{fragment}</div></body></html>'
    )


class _Checker(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.classes, self.sizes = set(), 0, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag)
        for name, value in attrs:
            if name == 'class':
                self.classes += 1
            if name == 'style' and value:
                self.sizes += [int(s) for s in re.findall(r'font-size:(\d+)px', value)]


def check(fragment, title):
    """4.3 제약과 6장 제목 길이를 검사한다. [(수준, 내용)] 을 돌려준다."""
    problems = []
    ch = _Checker()
    ch.feed(fragment)
    extra = ch.tags - ALLOWED_TAGS
    if extra:
        problems.append(('오류', f'게시판에서 확인되지 않은 태그: {", ".join(sorted(extra))}'))
    if ch.classes:
        problems.append(('오류', f'class 속성 {ch.classes}개 (게시판에서 제거됨)'))
    if re.search(r'<style|<script|<link', fragment, re.I):
        problems.append(('오류', '<style>/<script>/<link> 는 게시판에서 제거됨'))
    small = sorted({s for s in ch.sizes if s < SIZE['min']})
    if small:
        problems.append(('오류', f'{SIZE["min"]}px보다 작은 글자: {small}'))
    if len(fragment) > LENGTH_CHECKED:
        problems.append(('주의', f'본문 {len(fragment):,}자. {LENGTH_CHECKED:,}자까지만 확인됨'))
    if len(title) > 55:
        problems.append(('오류', f'제목 {len(title)}자. 게시판 제목은 최대 55자'))
    return problems
