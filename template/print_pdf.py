"""묵상 데이터 → 인쇄용 PDF (WORKFLOW.md 4.2).

표지와 본문을 각각 HTML로 만들고, 설치된 Edge(또는 Chrome)를 헤드리스로 돌려
PDF로 찍은 뒤 PyMuPDF로 합친다. 따로 찍는 이유는 본문 쪽 번호를 1부터 매기고
표지에는 여백과 쪽 번호를 두지 않기 위해서다.

본문 마크업(sections_html)은 웹사이트(website.py)도 같이 쓴다.
"""
import html
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from content import NOTE_CAPTION, date_label, inline, lines_html

HERE = Path(__file__).resolve().parent

BROWSER_CANDIDATES = [
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    os.path.expandvars(r'%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe'),
]
BROWSER_COMMANDS = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'msedge']


def find_browser():
    env = os.environ.get('SIGNPOSTS_BROWSER')
    for path in ([env] if env else []) + BROWSER_CANDIDATES:
        if path and Path(path).is_file():
            return path
    for name in BROWSER_COMMANDS:  # Linux (GitHub Actions)
        if shutil.which(name):
            return shutil.which(name)
    raise RuntimeError('Edge나 Chrome을 찾지 못했습니다. SIGNPOSTS_BROWSER 환경 변수에 경로를 지정하세요.')


def _document(data, body):
    c = data['colors']
    css = (HERE / 'print.css').read_text(encoding='utf-8')
    variables = (f":root{{--accent:{c['accent']};--gold:{c['gold']};--ink:{c['ink']};"
                 f"--sub:{c['sub']};--line:{c['line']};--quote-bg:{c['quote_bg']};}}")
    title = html.escape(f"신앙의 이정표 - {data['meta']['부제']}")
    return (f'<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>{title}</title>'
            f'<style>{variables}\n{css}</style></head><body>{body}</body></html>')


def cover_html(data):
    meta = data['meta']
    body = (
        '<div class="cover"><div class="frame"><div class="frame-inner">'
        f'<div class="day">{inline(meta["전례일"])}</div>'
        '<div class="cross">†</div>'
        '<div class="title">신앙의 이정표</div>'
        f'<div class="sub">{inline(meta["표지부제"])}</div>'
        f'<div class="readings">{"<br>".join(inline(r) for r in meta["독서"])}</div>'
        f'<div class="date">{date_label(data)}</div>'
        '</div></div></div>'
    )
    return _document(data, body)


def _head(eyebrow, title):
    return (f'<p class="eyebrow">{eyebrow}</p><h2 class="section-title">{inline(title)}</h2>'
            '<div class="divider"></div>')


def body_html(data):
    return _document(data, sections_html(data))  # 노트 사진은 웹사이트에만 싣는다


def sections_html(data, note_src=None):
    """여는 말씀부터 근거까지의 본문 마크업. 인쇄용 PDF와 웹사이트가 같이 쓴다.

    note_src(note) 는 노트 사진의 주소를 돌려준다. 웹사이트만 넘기고, PDF는 사진을 싣지 않는다.
    """
    out = []

    out.append('<section class="section prologue">' + _head('PROLOGUE', '여는 말씀'))
    for v in data['prologue']['verses']:
        out.append(f'<div class="verse">{lines_html(v["lines"])}<p class="ref">{inline(v["ref"])}</p></div>')
    out += [f'<p class="note">{lines_html(lines)}</p>' for lines in data['prologue']['paras']]
    out.append('</section>')

    out.append('<section class="section milestones">' + _head('MILESTONES', data['milestones_title']))
    for i, m in enumerate(data['milestones'], 1):
        paras = ''.join(f'<p>{lines_html(lines)}</p>' for lines in m['paras'])
        out.append(
            f'<div class="milestone"><div class="no">{i}</div><div class="body">'
            f'<h3>{inline(m["title"])}</h3>'
            f'<p class="question">물음 · {inline(m["question"])}</p>'
            f'<div class="text">{paras}</div>'
            f'<div class="remember">{inline(m["remember"])}</div>'
            '</div></div>'
        )
    out.append('</section>')

    out.append('<section class="section flow-oneline">' + _head('MY FLOW', '나의 묵상 흐름'))
    steps = '<span class="arrow">→</span>'.join(f'<span class="step">{inline(s)}</span>' for s in data['flow']['steps'])
    out.append(f'<div class="flow-steps">{steps}</div>')
    out += [f'<p class="flow-note">{lines_html(lines)}</p>' for lines in data['flow']['paras']]
    out.append('<div class="oneline-head">' + _head('IN ONE LINE', '한 줄로 기억하기') + '</div>')
    rows = ''.join(f'<tr><td class="n">{i}</td><td>{inline(m["oneline"])}</td></tr>'
                   for i, m in enumerate(data['milestones'], 1))
    out.append(f'<table class="oneline-list">{rows}</table>')
    out += [f'<p class="oneline-close">{lines_html(lines)}</p>' for lines in data['oneline']['paras']]
    out.append('</section>')

    r = data['reflection']
    out.append('<section class="section reflection">' + _head('REFLECTION', '다시 펼쳐 볼 때의 물음'))
    out += [f'<p class="intro">{lines_html(lines)}</p>' for lines in r['intro']]
    for q in r['questions']:
        out.append(f'<div class="question-block"><p class="q">{inline(q)}</p>'
                   + '<div class="write-line"></div>' * 3 + '</div>')
    out += [f'<p class="closing">{lines_html(lines)}</p>' for lines in r['paras']]
    out.append('</section>')

    if data['notes'] and note_src:
        out.append('<section class="section notebook">' + _head('NOTEBOOK', '묵상 노트'))
        for note in data['notes']:
            src = html.escape(note_src(note))
            out.append(f'<figure class="note-photo"><a href="{src}"><img src="{src}" alt="손글씨 묵상 노트"></a></figure>')
        out.append(f'<p class="note-caption">{NOTE_CAPTION}</p></section>')

    out.append('<section class="section references">' + _head('REFERENCES', '근거'))
    for group in data['references']:
        items = ''.join(f'<li>{inline(item)}</li>' for item in group['items'])
        out.append(f'<h4>{inline(group["title"])}</h4><ul>{items}</ul>')
    out.append('</section>')

    return ''.join(out)


def html_to_pdf(browser, html_path, pdf_path, profile_dir):
    cmd = [
        browser,
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--no-pdf-header-footer',
        f'--user-data-dir={profile_dir}',
        f'--print-to-pdf={pdf_path}',
    ]
    if sys.platform != 'win32':  # GitHub Actions(Ubuntu)에서는 샌드박스를 쓸 수 없다
        cmd += ['--no-sandbox', '--disable-dev-shm-usage']
    cmd.append(Path(html_path).as_uri())
    subprocess.run(cmd, check=True, timeout=120, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not Path(pdf_path).is_file():
        raise RuntimeError(f'PDF가 만들어지지 않았습니다: {html_path}')


def build(data, out_pdf, keep_html_dir=None):
    """PDF를 만들고 (전체 쪽수, 본문 쪽수)를 돌려준다."""
    import pymupdf

    browser = find_browser()
    with tempfile.TemporaryDirectory(prefix='signposts_') as tmp:
        tmp = Path(tmp)
        (tmp / 'cover.html').write_text(cover_html(data), encoding='utf-8')
        (tmp / 'body.html').write_text(body_html(data), encoding='utf-8')
        profile = tmp / 'profile'
        html_to_pdf(browser, tmp / 'cover.html', tmp / 'cover.pdf', profile)
        html_to_pdf(browser, tmp / 'body.html', tmp / 'body.pdf', profile)

        doc = pymupdf.open(tmp / 'cover.pdf')
        if doc.page_count > 1:  # 표지는 한 쪽만
            doc.delete_pages(range(1, doc.page_count))
        body = pymupdf.open(tmp / 'body.pdf')
        body_pages = body.page_count
        doc.insert_pdf(body)
        doc.set_metadata({'title': f"신앙의 이정표 - {data['meta']['부제']}", 'subject': data['meta']['전례일']})
        merged = tmp / 'merged.pdf'  # 한글 경로를 피해 임시 폴더에서 저장한 뒤 옮긴다
        doc.save(merged, garbage=3, deflate=True)
        total = doc.page_count
        doc.close()
        body.close()
        shutil.move(str(merged), str(out_pdf))
        if keep_html_dir:
            for name in ('cover.html', 'body.html'):
                shutil.copy(tmp / name, Path(keep_html_dir) / f'print_{name}')
    return total, body_pages
