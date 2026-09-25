"""Minimal Markdown → HTML for this one document.

Enough for headings, tables, lists, code fences, bold, inline code and rules —
which is all the PRD uses. A dependency for a single render is not worth it.
"""
import html, re, sys

src = open(sys.argv[1]).read()
out, in_code, in_table, in_list = [], False, False, False

def inline(t: str) -> str:
    t = html.escape(t)
    t = re.sub(r'`([^`]+)`', r'<code>\1</code>', t)
    t = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', t)
    t = re.sub(r'(?<!\*)\*([^*]+)\*(?!\*)', r'<em>\1</em>', t)
    return t

def finish(text: str) -> str:
    return re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', text)

def close_blocks():
    global in_table, in_list
    if in_table: out.append('</tbody></table>'); in_table = False
    if in_list: out.append('</ul>'); in_list = False

for line in src.split('\n'):
    if line.startswith('```'):
        close_blocks()
        out.append('<pre><code>' if not in_code else '</code></pre>')
        in_code = not in_code
        continue
    if in_code:
        out.append(html.escape(line))
        continue

    if line.startswith('|'):
        cells = [c.strip() for c in line.strip('|').split('|')]
        if all(set(c) <= set('-: ') for c in cells):
            continue
        if not in_table:
            close_blocks()
            out.append('<table><thead><tr>' + ''.join(f'<th>{inline(c)}</th>' for c in cells) + '</tr></thead><tbody>')
            in_table = True
        else:
            out.append('<tr>' + ''.join(f'<td>{inline(c)}</td>' for c in cells) + '</tr>')
        continue

    m = re.match(r'^(#{1,6}) (.+)', line)
    if m:
        close_blocks()
        n = len(m.group(1))
        out.append(f'<h{n}>{inline(m.group(2))}</h{n}>')
        continue

    if line.strip() == '---':
        close_blocks(); out.append('<hr>'); continue

    m = re.match(r'^(\d+)\. (.+)', line) or re.match(r'^[-*] (.+)', line)
    if m:
        if in_table: close_blocks()
        if not in_list: out.append('<ul>'); in_list = True
        out.append(f'<li>{inline(m.group(len(m.groups())))}</li>')
        continue

    if not line.strip():
        close_blocks(); continue

    if in_list:
        out[-1] = out[-1][:-5] + ' ' + inline(line.strip()) + '</li>'
        continue
    close_blocks()
    # A blank line ends a paragraph; a newline inside one is just wrapping.
    if out and out[-1].startswith('<p>') and out[-1].endswith('</p>'):
        out[-1] = out[-1][:-4] + ' ' + inline(line.strip()) + '</p>'
    else:
        out.append(f'<p>{inline(line)}</p>')

close_blocks()
if in_code: out.append('</code></pre>')
# Emphasis that wrapped across a source line is only joinable now.
out = [finish(o) if o.startswith('<p>') else o for o in out]

CSS = """
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; }
body { font: 10.5pt/1.55 -apple-system, 'Segoe UI', system-ui, sans-serif; color: #1b1917; max-width: 100%; margin: 0; }
h1 { font-size: 24pt; line-height: 1.1; letter-spacing: -0.02em; margin: 0 0 4pt; font-weight: 600; }
h2 { font-size: 15pt; line-height: 1.2; letter-spacing: -0.015em; margin: 22pt 0 6pt; font-weight: 600;
     padding-bottom: 4pt; border-bottom: 1px solid #e6e1da; break-after: avoid; }
h3 { font-size: 11.5pt; margin: 14pt 0 4pt; font-weight: 600; break-after: avoid; }
p { margin: 0 0 7pt; }
ul { margin: 0 0 8pt; padding-left: 16pt; }
li { margin-bottom: 3pt; }
strong { font-weight: 600; }
code { font: 9pt ui-monospace, 'SF Mono', Menlo, monospace; background: #f4f1ec; padding: 1px 4px; border-radius: 3px; }
pre { background: #f8f6f2; border: 1px solid #e6e1da; border-radius: 6px; padding: 9pt 11pt; overflow: hidden;
      break-inside: avoid; margin: 0 0 9pt; }
pre code { background: none; padding: 0; font-size: 8.5pt; line-height: 1.5; }
table { width: 100%; border-collapse: collapse; margin: 0 0 11pt; font-size: 9pt; break-inside: avoid; }
th { text-align: left; font-weight: 600; padding: 5pt 7pt; border-bottom: 1.5px solid #d9d3ca;
     background: #faf8f5; vertical-align: top; }
td { padding: 5pt 7pt; border-bottom: 1px solid #eeeae4; vertical-align: top; }
tr:last-child td { border-bottom: none; }
hr { border: 0; border-top: 1px solid #e6e1da; margin: 18pt 0; }
h1 + p { color: #6b6560; font-size: 11pt; }
"""
open(sys.argv[2], 'w').write(
    f'<!doctype html><meta charset="utf-8"><title>Knowledge Network — PRD</title>'
    f'<style>{CSS}</style>' + '\n'.join(out)
)
print('wrote', sys.argv[2])
