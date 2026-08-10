#!/usr/bin/env python3
"""
Parse UPSC standard books (PDF via PyMuPDF, EPUB via zipfile) into the
UPSCbooks chapter/section JSON manifest format.

Output: one JSON file per book in <upscbooks>/data/ebooks/<slug>.json
"""
import os, re, json, sys, zipfile
from html.parser import HTMLParser

BASE = r'C:\Users\Vulgaris\Documents\iCloudDrive\UPSC E-books'
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'ebooks')

# Book definitions -----------------------------------------------------------
# color, category 'textbook', subject
BOOKS = [
    {
        'slug': 'environment-shankar-ias',
        'title': 'Environment',
        'author': 'Shankar IAS Academy',
        'description': 'Shankar IAS Environment — the complete, chapter-by-chapter Environment & Ecology textbook for UPSC.',
        'color': '#1B5E20',
        'subject': 'Environment',
        'src': os.path.join(BASE, r'1. Foundation\Standard books & PYQs\Std. books\Environment (Shankar IAS Academy) (Z-Library).pdf'),
        'type': 'pdf',
    },
    {
        'slug': 'indian-economy-vivek-singh',
        'title': 'Indian Economy',
        'author': 'Vivek Singh (7th Edition)',
        'description': 'Indian Economy by Vivek Singh (7th Edition) — complete coverage for the UPSC Economy paper.',
        'color': '#00695C',
        'subject': 'Economy',
        'src': os.path.join(BASE, r'1. Foundation\Standard books & PYQs\Std. books\Indian Economy - Vivek Singh [7th Edition].pdf'),
        'type': 'pdf',
    },
    {
        'slug': 'pmf-ias-environment',
        'title': 'PMF IAS Environment (3rd Edition)',
        'author': 'PMF IAS',
        'description': 'PMF IAS Environment Third Edition — comprehensive Environment & Ecology notes for UPSC.',
        'color': '#2E7D32',
        'subject': 'Environment',
        'src': os.path.join(BASE, r'1. Foundation\Standard books & PYQs\PMF IAS\PMFIAS-Environment-Third-Edition.pdf'),
        'type': 'pdf',
    },
    {
        'slug': 'pmf-ias-modern-indian-history',
        'title': 'PMF IAS Modern Indian History',
        'author': 'PMF IAS',
        'description': 'PMF IAS Modern Indian History — complete crash course notes for the UPSC Modern India section.',
        'color': '#8B2500',
        'subject': 'History',
        'src': os.path.join(BASE, r'1. Foundation\Standard books & PYQs\PMF IAS\PMFIAS-Modern-Indian-History.pdf'),
        'type': 'pdf',
        # This PDF's embedded TOC has broken page numbers (all point to p1) and
        # the chapters continue un-numbered for the early ones. Curated list of
        # (start_pdf_page, title) detected by scanning heading pages.
        'pdf_chapters': [
            (33, 'Decline of the Mughal Empire'),
            (53, 'Rise and Fall of Regional Powers'),
            (87, 'Indian Society in the Eighteenth Century'),
            (94, 'Beginning of European Settlement in India'),
            (131, 'British Conquest of India'),
            (170, 'British Expansion Beyond Indian Frontiers'),
            (192, 'Role of Governors-General in the Consolidation and Expansion of British Paramountcy'),
            (206, 'British Administration in India – I (1765-1858)'),
            (229, 'Social and Cultural Policy of British'),
            (240, 'Spread of English Education'),
            (266, 'Land Revenue Policy of British'),
            (281, 'British Economic Policies and Their Impacts'),
            (313, 'Tribal and Peasant Movements – I'),
            (343, 'The Revolt of 1857'),
            (371, 'Socio-Religious Reform Movements – I'),
            (415, 'British Administration in India – II (1858-1947)'),
            (439, 'Indian Nationalism and Indian National Congress'),
            (454, 'Moderate Nationalism (1885-1905)'),
            (474, 'Nationalist Movement 1905-1918'),
            (536, "Gandhi's Formative Years and Early Activism"),
            (552, 'Non-cooperation and Khilafat Movements'),
            (576, 'The Nationalist Movement (1922-29)'),
            (598, 'Simon Commission to Poorna Swaraj'),
            (614, 'Civil Disobedience Movement (1930-34)'),
            (639, 'Nationalist Movement (1934-39)'),
            (664, 'Growth of Left'),
            (684, 'National Movement During the Second World War'),
            (715, 'Post-War Struggle'),
            (731, 'Freedom With Partition'),
            (750, 'Popular Struggle in the Princely States'),
            (759, 'Socio-Religious Reform Movements – II'),
            (776, 'Tribal and Peasant Movements – II'),
            (793, 'National Movement and the Working Class'),
            (801, 'Development of Indian Press under the British Rule'),
            (814, 'Governors-General and Viceroys of India'),
            (829, 'Congress Sessions'),
            (837, 'Great Personalities and Unsung Heroes'),
        ],
    },
    {
        'slug': 'indias-struggle-for-independence',
        'title': "India's Struggle for Independence",
        'author': 'Bipan Chandra et al.',
        'description': "India's Struggle for Independence by Bipan Chandra — the classic account of India's freedom movement, chapter-by-chapter.",
        'color': '#7B1E1E',
        'subject': 'History',
        'src': os.path.join(BASE, r'3. Mains\Indias Struggle for Independence (Chandra, Bipan) (Z-Library).epub'),
        'type': 'epub',
    },
]
# NOTE: Lexicon Ethics (Std. books) is a pure textless scan (0/333 pages) and
# is skipped — no OCR available on this machine.

# ---------------------------------------------------------------------------

class XHTMLTextExtractor(HTMLParser):
    """Extract plain text from XHTML, preserving paragraph breaks."""
    def __init__(self):
        super().__init__()
        self.paragraphs = []
        self.current = []
        self.skip_depth = 0
        self.skip_tags = {'style', 'script', 'head'}

    def handle_starttag(self, tag, attrs):
        if tag in self.skip_tags:
            self.skip_depth += 1
        if tag in ('p', 'div', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li'):
            self.flush()

    def handle_endtag(self, tag):
        if tag in self.skip_tags and self.skip_depth > 0:
            self.skip_depth -= 1
        if tag in ('p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li'):
            self.flush()

    def flush(self):
        text = ' '.join(''.join(self.current).split())
        if text:
            self.paragraphs.append(text)
        self.current = []

    def handle_data(self, data):
        if self.skip_depth > 0:
            return
        self.current.append(data)

    def get_text(self):
        self.flush()
        return self.paragraphs


def extract_epub_text(epub_path, chapter_files):
    """Extract paragraph text from specific xhtml files in an EPUB."""
    all_paras = []
    try:
        with zipfile.ZipFile(epub_path) as z:
            for xf in chapter_files:
                try:
                    content = z.read(xf).decode('utf-8', errors='replace')
                except Exception:
                    continue
                parser = XHTMLTextExtractor()
                parser.feed(content)
                all_paras.extend(parser.get_text())
    except Exception as e:
        print(f'  ERROR EPUB {epub_path}: {e}', file=sys.stderr)
    return all_paras


def epub_chapter_plan(epub_path):
    """Return list of (title, [xhtml files]) using toc.ncx chapter boundaries."""
    plan = []
    with zipfile.ZipFile(epub_path) as z:
        names = z.namelist()
        ncx = next((n for n in names if n.endswith('.ncx')), None)
        if not ncx:
            return plan
        data = z.read(ncx).decode('utf-8', 'replace')
        # navPoints: capture label + src
        navs = re.findall(r'<text>(.*?)</text>.*?src="([^"]+)"', data, re.S)
        # Only chapter-like entries (numbered, or known sections). Everything
        # between chapter files belongs to the preceding chapter.
        trailing = {'footnotes', 'bibliography', 'notes', 'index', 'notes and references', 'glossary', 'acknowledgements'}
        chapters = []
        seen_nums = set()
        for label, src in navs:
            label = label.strip()
            m = re.match(r'^(\d+)\.', label)
            if m:
                num = int(m.group(1))
                if num in seen_nums:   # repeated after Footnotes/Index section
                    break
                seen_nums.add(num)
                chapters.append({'label': label, 'src': src})
            elif label.lower() in trailing:
                break
        # sort xhtml files in reading order
        def sort_key(n):
            m = re.search(r'(\d+)\.(?:xhtml|html|htm)$', n)
            return int(m.group(1)) if m else 0
        all_xhtml = sorted([n for n in names if n.endswith(('.xhtml', '.html', '.htm')) and 'toc' not in n.lower()], key=sort_key)

        # Map each chapter to its file index; consecutive chapters bound ranges.
        for i, ch in enumerate(chapters):
            target = ch['src'].split('#')[0]
            # normalize: src may be 'text/part0007.html' relative to ebook root
            files = []
            try:
                start = all_xhtml.index(target)
            except ValueError:
                # try basename match
                base = target.split('/')[-1]
                start = next((j for j, n in enumerate(all_xhtml) if n.split('/')[-1] == base), None)
            if start is None:
                continue
            end = len(all_xhtml)
            if i + 1 < len(chapters):
                try:
                    nxt = chapters[i + 1]['src'].split('#')[0]
                    end = all_xhtml.index(nxt) if nxt in all_xhtml else (all_xhtml.index(next((n for n in all_xhtml if n.split('/')[-1] == nxt.split('/')[-1]), nxt)) + 1 if nxt.split('/')[-1] != nxt else len(all_xhtml))
                except (ValueError, StopIteration):
                    end = len(all_xhtml)
            files = all_xhtml[start:end]
            plan.append((ch['label'], files))
    return plan


HEADER_STOPS = [
    'SHANKAR IAS ACADEMY', 'ENVIRONMENT', 'PMF IAS MIH', 'PMF IAS Environment',
    'Indian Economy',
]


def clean_pdf_paragraph(text):
    """Normalize pdf-extracted block text into a clean paragraph string."""
    lines = [ln.replace('\xad', '-').strip() for ln in text.splitlines()]
    # drop header/footer-only blocks
    joined = ' '.join(l for l in lines if l)
    # Drop pure-page-number lines
    lines = [ln for ln in lines if not re.fullmatch(r'[\d\s\.\-]+', ln)]
    # merge hyphenated line breaks: trailing '-' joins with next word
    out_lines = []
    buffer = ''
    for ln in lines:
        if not ln:
            continue
        if buffer:
            buffer += ' ' + ln
        else:
            buffer = ln
        if len(buffer) > 200:
            out_lines.append(buffer)
            buffer = ''
    if buffer:
        out_lines.append(buffer)
    joined = ' '.join(out_lines)
    joined = re.sub(r'\s+', ' ', joined).strip()
    joined = re.sub(r'-\s?', '-', joined) if not re.search(r'\b[a-z]-[a-z]\b', joined.lower()) else joined
    return joined


def extract_pdf_chapter(doc, start_pg, end_pg):
    """Extract paragraph list from a PDF page range (0-based inclusive start, exclusive end)."""
    paras = []
    import fitz
    for pgi in range(start_pg, end_pg):
        if pgi >= doc.page_count:
            break
        page = doc[pgi]
        blocks = page.get_text('blocks')
        for b in blocks:
            x0, y0, x1, y1, text, bn, bt = b
            if bt != 0:
                continue
            t = text.strip()
            # Exclude running headers/footers: short text containing the
            # book's brand/recurring words, or a bare page number.
            is_page_num = re.fullmatch(r'[\d\s\-\.\u00ad]{1,8}', t) is not None
            if is_page_num:
                continue
            if len(t) < 70 and any(stp.lower() in t.lower() for stp in HEADER_STOPS):
                continue
            para = clean_pdf_paragraph(t)
            # Skip repeated copyright/boilerplate lines and pure noise
            low = para.lower()
            if 'all rights reserved' in low or 'without permission in writing' in low:
                continue
            if para in ('Ö', '•', '□', '', '', ''):
                continue
            if len(para) >= 3:
                paras.append(para)
    return paras


def slugify(text):
    s = text.lower().strip()
    s = re.sub(r'[^\w\s-]', '', s)
    s = re.sub(r'[\s_]+', '-', s)
    s = re.sub(r'-+', '-', s).strip('-')
    return s


def make_chapter_json(paragraphs):
    """Convert paragraphs to UPSCbooks section/block JSON (param style)."""
    if not paragraphs:
        return json.dumps([{
            'id': 'intro', 'num': 1, 'title': 'Content',
            'blocks': [{'kind': 'para', 'runs': [{'text': 'Content not available.', 'bold': False, 'italic': False}]}]
        }])
    sections = []
    sec_num = 1
    blocks = []
    for para in paragraphs:
        if len(para.strip()) < 3:
            continue
        is_heading = (
            len(para) < 90 and
            not para.endswith('.') and
            not para.endswith(',') and
            not para.endswith(';') and
            (
                re.match(r'^\d+[\.\)]\s', para) or
                re.match(r'^Chapter\s', para, re.I) or
                re.match(r'^Unit\s', para, re.I) or
                (len(para) < 55 and any(kw in para.lower() for kw in ['introduction', 'features', 'importance', 'conclusion', 'types', 'causes', 'effects', 'measures', 'classification', 'objectives', 'components']))
            )
        )
        if is_heading:
            if blocks:
                sections.append({'id': f'sec-{sec_num}', 'num': sec_num, 'title': 'Content', 'blocks': blocks})
                sec_num += 1
                blocks = []
            title = re.sub(r'^\d+[\.\)]\s*', '', para).strip()
            blocks.append({'kind': 'subhead', 'runs': [{'text': title, 'bold': True, 'italic': False}]})
        else:
            blocks.append({'kind': 'para', 'runs': [{'text': para, 'bold': False, 'italic': False}]})
    if blocks:
        sections.append({'id': f'sec-{sec_num}', 'num': sec_num, 'title': 'Content', 'blocks': blocks})
    if not sections:
        sections.append({'id': 'sec-1', 'num': 1, 'title': 'Content',
                         'blocks': [{'kind': 'para', 'runs': [{'text': 'Content not available.', 'bold': False, 'italic': False}]}]})
    return json.dumps(sections)


# --- PDF chapter page detection ---
def pdf_chapters_from_toc(doc, skip_front_pages=0):
    """Return list of (title, start_pg, end_pg) using lvl1 TOC entries."""
    toc = doc.get_toc()
    lvl1 = [e for e in toc if e[0] == 1]
    chapters = []
    for i, e in enumerate(lvl1):
        title = e[1].strip()
        start = e[2] - 1  # TOC pages are 1-based -> 0-based
        end = (lvl1[i + 1][2] - 1) if i + 1 < len(lvl1) else doc.page_count
        chapters.append((title, start, end))
    return chapters


def find_chapter_start_pages(doc, titles):
    """For PDFs with broken TOC page numbers, find each chapter's start page
    by scanning for the title text (heading-sized) on pages beyond the TOC."""
    starts = []
    for title in titles:
        key = re.sub(r'^\d+[\.\-]\s*', '', title).strip()[:40]
        found = None
        for pgi in range(4, doc.page_count):
            page = doc[pgi]
            txt = page.get_text()
            if key.lower() in txt.lower():
                # confirm it's a heading: appears near top of page and short
                first_lines = [l.strip().lower() for l in txt.splitlines()[:6] if l.strip()]
                if any(key.lower().startswith(fl[:25]) or fl.startswith(key.lower()[:25]) for fl in first_lines):
                    found = pgi
                    break
        if found is None:
            # looser: whole-doc contains but page near previous start
            found = starts[-1] + 1 if starts else 4
        starts.append(found)
    # dedupe & ensure monotonic
    cleaned = []
    last = 0
    for s in starts:
        if s <= last:
            s = last + 1
        cleaned.append(s)
        last = s
    return cleaned


def main():
    import fitz
    os.makedirs(OUT_DIR, exist_ok=True)
    for book in BOOKS:
        print(f'\n===== {book["title"]} =====')
        src = book['src']
        if not os.path.exists(src):
            print(f'  SKIP missing: {src}')
            continue
        chapters_plan = []
        if book['type'] == 'pdf':
            doc = fitz.open(src)
            if book.get('pdf_chapters'):
                # Curated chapter map (PDFs whose TOC is unusable)
                starts = book['pdf_chapters']
                chapters_plan = []
                for i, (st, tl) in enumerate(starts):
                    end = starts[i + 1][0] if i + 1 < len(starts) else doc.page_count
                    chapters_plan.append((tl, st, end))
                print(f'  pages={doc.page_count}, curated chapters={len(chapters_plan)}')
            else:
                toc_chapters = pdf_chapters_from_toc(doc)
                usable = [c for c in toc_chapters if c[1] > 1]
                # Drop front matter
                front = {'title', 'copyright', 'contents', 'index', 'preface', 'acknowledgements', 'front cover', 'back cover'}
                usable = [c for c in usable if c[0].strip().lower() not in front]
                print(f'  pages={doc.page_count}, toc_lvl1={len(toc_chapters)}, usable={len(usable)}')
                chapters_plan = usable
        elif book['type'] == 'epub':
            plan = epub_chapter_plan(src)
            # Dedupe chapters pointing at the same start file (footnotes repeat
            # the chapter list). Keep first occurrence only.
            seen_src = set()
            chapters_plan = []
            for label, files in plan:
                ch_src = files[0] if files else ''
                if ch_src in seen_src:
                    continue
                seen_src.add(ch_src)
                chapters_plan.append((label, files))
            print(f'  epub chapters (deduped): {len(chapters_plan)}')
        else:
            continue

        seen_titles = set()
        chapters = []
        for idx, entry in enumerate(chapters_plan, 1):
            if book['type'] == 'pdf':
                title, start, end = entry
                title = re.sub(r'^\d+\s*[\.\-]*\s*', '', title).strip()
                paras = extract_pdf_chapter(doc, start, end)
            else:
                label, files = entry
                title = re.sub(r'\s+', ' ', label).strip()
                title = re.sub(r'^\d+\s*[\.\)\-]*\s*', '', title).strip()
                paras = extract_epub_text(src, files)

            # skip heavily-duplicated titles (shouldn't happen but be safe)
            if title.lower() in seen_titles:
                title = f'{title}'
            seen_titles.add(title.lower())

            section_json = make_chapter_json(paras)
            chapters.append({'number': idx, 'title': title, 'sections_json': section_json})
            print(f'  ch{idx}: {title[:60]} — {len(paras)} paras, {len(section_json)} bytes')

        manifest = {
            'slug': book['slug'],
            'title': book['title'],
            'author': book['author'],
            'description': book['description'],
            'color': book['color'],
            'category': 'textbook',
            'subject': book['subject'],
            'chapter_count': len(chapters),
            'chapters': chapters,
        }
        out_path = os.path.join(OUT_DIR, book['slug'] + '.json')
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(manifest, f, ensure_ascii=False)
        print(f'  => saved {out_path} ({len(chapters)} chapters)')
        if book['type'] == 'pdf':
            doc.close()

    print('\n=== ALL DONE ===')


if __name__ == '__main__':
    main()