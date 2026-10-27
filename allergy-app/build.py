"""나눠진 HTML 파일들을 하나로 합쳐 한 파일 버전을 만든다.

    python3 build.py              -> dist/Index.html (전체 + 데모)
    python3 build.py OUT 파일...  -> OUT 에 지정한 파일만 넣어 합침 (단계별 확인용)
"""
import os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ALL = ['Style', 'Register', 'Staff', 'Admin', 'Meal', 'Plan', 'Pdf', 'Demo']


def build(out, parts):
    src = open(os.path.join(HERE, 'Index.html'), encoding='utf-8').read()

    def inc(m):
        name = m.group(1)
        if name not in parts:
            return ''
        return open(os.path.join(HERE, name + '.html'), encoding='utf-8').read()

    html = re.sub(r"<\?!= include\('(\w+)'\); \?>", inc, src)
    os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
    open(out, 'w', encoding='utf-8').write(html)
    return html


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'dist', 'Index.html')
    parts = sys.argv[2:] or ALL
    html = build(out, parts)
    print(out, html.count('\n') + 1, 'lines')
