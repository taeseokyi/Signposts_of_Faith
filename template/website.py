"""날짜 폴더의 content.md 들 → 웹사이트 (WORKFLOW.md 5장 "웹사이트").

    python template/build.py site            _site/ 에 만든다 (인쇄용 PDF 포함)
    python template/build.py site --no-pdf   PDF 없이 빠르게

GitHub Actions가 main에 push될 때마다 이것을 돌려 배포한다.
모든 링크는 상대 경로라서 어느 주소 아래에 올려도 동작한다.
"""
import html
import re
import shutil
from pathlib import Path

import content
import print_pdf
from content import date_label, inline, lines_html

HERE = Path(__file__).resolve().parent
DAY_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
MARKER = '.signposts-site'  # 이 표시가 있는 폴더만 지우고 다시 만든다

SITE_TITLE = '신앙의 이정표'
SITE_SUB = '말씀을 따라 걸은 하루의 묵상'
SITE_ABOUT = ('매일 미사의 독서와 복음을 붙들고 묻고 답한 것을 이정표로 정리합니다. '
              '이 글들은 AI와 나눈 대화에서 나왔으며, 정리와 결론은 묵상 노트에 적은 나의 말을 중심으로 합니다.')
FONT_LINK = ('<link rel="preconnect" href="https://fonts.googleapis.com">'
             '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
             '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;700&display=swap">')
UNPUBLISHED = {'아니오', '아니요', 'no', 'false', '비공개'}


def collect(root, log=print):
    """공개할 묵상들을 날짜 내림차순으로 모은다."""
    entries = []
    for folder in sorted(Path(root).iterdir()):
        source = folder / 'content.md'
        if not (folder.is_dir() and DAY_RE.match(folder.name) and source.is_file()):
            continue
        try:
            data = content.parse(source)
        except content.ContentError as e:
            log(f'  [건너뜀] {folder.name}: {e}')
            continue
        if data['meta'].get('공개', '예').strip().lower() in UNPUBLISHED:
            log(f'  [건너뜀] {folder.name}: 공개: 아니오')
            continue
        errors = [m for level, m in data['problems'] if level == '오류']
        if errors:
            log(f'  [건너뜀] {folder.name}: content.md 오류 {len(errors)}개 — {errors[0]}')
            continue
        entries.append(data)
    return sorted(entries, key=lambda d: d['date'], reverse=True)


def _variables(c):
    return (f":root{{--accent:{c['accent']};--gold:{c['gold']};--ink:{c['ink']};"
            f"--sub:{c['sub']};--line:{c['line']};--quote-bg:{c['quote_bg']};}}")


def _page(title, description, css_href, colors, body, og_type='website'):
    t, d = html.escape(title), html.escape(description)
    return (
        '<!doctype html><html lang="ko"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f'<title>{t}</title><meta name="description" content="{d}">'
        f'<meta property="og:title" content="{t}"><meta property="og:description" content="{d}">'
        f'<meta property="og:type" content="{og_type}"><meta property="og:locale" content="ko_KR">'
        f'{FONT_LINK}<link rel="stylesheet" href="{css_href}">'
        f'<style>{_variables(colors)}</style></head><body>{body}</body></html>'
    )


def _plain(text):
    return re.sub(r'\*+', '', text)


def _day_label(data):
    d = data['date']
    return f"{d.year}. {d.month}. {d.day}. ({data['weekday']})"


def day_page(data, newer, older, pdf_href):
    meta = data['meta']
    hero = (
        '<header class="hero"><div class="hero-inner">'
        f'<p class="day">{inline(meta["전례일"])}</p>'
        '<p class="cross">†</p>'
        f'<p class="site-name">{SITE_TITLE}</p>'
        f'<h1>{inline(meta["부제"])}</h1>'
        f'<p class="readings">{"<br>".join(inline(r) for r in meta["독서"])}</p>'
        f'<p class="date">{date_label(data)}</p>'
        '</div></header>'
    )
    actions = []
    if pdf_href:
        download = html.escape(content.pdf_name_of(data))
        actions.append(f'<a class="button" href="{pdf_href}" download="{download}">인쇄용 PDF 내려받기</a>')
    if meta.get('게시주소'):
        actions.append(f'<a class="button" href="{html.escape(meta["게시주소"])}" rel="noopener">굿뉴스 게시글</a>')

    def nav(entry, label, cls):
        if entry is None:
            return f'<span class="{cls}"></span>'
        return (f'<a class="{cls}" href="../{entry["date"].isoformat()}/">'
                f'<small>{label}</small>{inline(entry["meta"]["부제"])}</a>')

    foot = (
        '<footer class="day-foot">'
        + (f'<div class="actions">{"".join(actions)}</div>' if actions else '')
        + f'<nav class="pager">{nav(older, "← 이전 묵상", "older")}{nav(newer, "다음 묵상 →", "newer")}</nav>'
        + '<p class="back"><a href="../">모든 묵상 보기</a></p>'
        + '</footer>'
    )
    body = (
        '<div class="wrap">'
        f'<nav class="topnav"><a href="../">← {SITE_TITLE}</a></nav>'
        f'{hero}<main>{print_pdf.sections_html(data)}</main>{foot}'
        f'<p class="site-foot">{html.escape(SITE_ABOUT)}</p>'
        '</div>'
    )
    paras = data['prologue']['paras']
    description = ' '.join(_plain(line) for line in paras[0]) if paras else meta['전례일']
    title = f"{_plain(meta['부제'])} · {SITE_TITLE} ({_day_label(data)})"
    return _page(title, description, '../assets/site.css', data['colors'], body, og_type='article')


def index_page(entries):
    items = []
    for data in entries:
        meta = data['meta']
        items.append(
            f'<li class="entry"><a href="{data["date"].isoformat()}/">'
            f'<span class="date">{_day_label(data)} · {inline(meta["전례일"])}</span>'
            f'<span class="title">{inline(meta["부제"])}</span>'
            f'<span class="meta">{inline(meta["복음장절"])} · 이정표 {len(data["milestones"])}개</span>'
            f'<span class="line">{inline(data["milestones"][0]["oneline"]) if data["milestones"] else ""}</span>'
            '</a></li>'
        )
    body = (
        '<div class="wrap">'
        '<header class="hero"><div class="hero-inner">'
        '<p class="cross">†</p>'
        f'<h1 class="site-title">{SITE_TITLE}</h1>'
        f'<p class="readings">{SITE_SUB}</p>'
        '</div></header>'
        f'<p class="about">{html.escape(SITE_ABOUT)}</p>'
        f'<ul class="entries">{"".join(items) or "<li class=entry>아직 공개된 묵상이 없습니다.</li>"}</ul>'
        '</div>'
    )
    colors = entries[0]['colors'] if entries else dict(content.COLORS, accent=content.SEASON_ACCENT['연중'])
    return _page(f'{SITE_TITLE} — {SITE_SUB}', SITE_ABOUT, 'assets/site.css', colors, body)


def build_site(root, out, with_pdf=True, log=print):
    root, out = Path(root), Path(out)
    if out.exists():
        if not (out / MARKER).exists():
            raise RuntimeError(f'{out} 는 사이트 빌드 폴더가 아니라서 지우지 않습니다. 다른 경로를 지정하세요.')
        shutil.rmtree(out)
    (out / 'assets').mkdir(parents=True)
    (out / MARKER).write_text('', encoding='utf-8')
    (out / '.nojekyll').write_text('', encoding='utf-8')  # GitHub Pages가 파일을 그대로 내보내게 한다
    shutil.copy(HERE / 'web.css', out / 'assets' / 'site.css')

    entries = collect(root, log)
    for i, data in enumerate(entries):
        day = data['date'].isoformat()
        folder = out / day
        folder.mkdir()
        pdf_href = None
        if with_pdf:
            pdf = folder / f'signposts-{day}.pdf'
            total, _ = print_pdf.build(data, pdf)
            pdf_href = pdf.name
            log(f'  {day}: PDF {total}쪽')
        newer = entries[i - 1] if i > 0 else None
        older = entries[i + 1] if i + 1 < len(entries) else None
        (folder / 'index.html').write_text(day_page(data, newer, older, pdf_href), encoding='utf-8')
        log(f'  {day}: {data["meta"]["부제"]}')
    (out / 'index.html').write_text(index_page(entries), encoding='utf-8')
    return entries
