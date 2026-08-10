#!/usr/bin/env python3
"""
Parse NCERT EPUBs and generate a JSON manifest for the UPSCbooks import pipeline.
Each EPUB = one chapter. Organized by subject > series (book) > chapter.
"""
import os, re, json, zipfile, sys
from html.parser import HTMLParser

BASE = r'C:\Users\Vulgaris\Documents\iCloudDrive\UPSC all ncerts EPub'
# Only the 6 subjects the user specified
SUBJECTS = ['Psychology', 'Social science', 'Economics', 'Geography', 'History all', 'Political science']

# Subject display names and colors
SUBJECT_META = {
    'Psychology':          {'display': 'Psychology',          'color': '#6B4C9A'},
    'Social science':      {'display': 'Social Science',      'color': '#2E7D32'},
    'Economics':           {'display': 'Economics',           'color': '#E65100'},
    'Geography':           {'display': 'Geography',           'color': '#1565C0'},
    'History all':         {'display': 'History',             'color': '#8B2500'},
    'Political science':   {'display': 'Political Science',   'color': '#4A148C'},
}

class XHTMLTextExtractor(HTMLParser):
    """Extract plain text from XHTML, preserving paragraph breaks."""
    def __init__(self):
        super().__init__()
        self.paragraphs = []
        self.current = []
        self.in_p = False
        self.in_body = False
        self.skip_tags = {'style', 'script', 'head'}
        self.skip_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.skip_tags:
            self.skip_depth += 1
        if tag in ('p', 'div', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li'):
            if self.current:
                text = ' '.join(''.join(self.current).split())
                if text:
                    self.paragraphs.append(text)
                self.current = []
        if tag == 'body':
            self.in_body = True

    def handle_endtag(self, tag):
        if tag in self.skip_tags and self.skip_depth > 0:
            self.skip_depth -= 1
        if tag in ('p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li'):
            text = ' '.join(''.join(self.current).split())
            if text:
                self.paragraphs.append(text)
            self.current = []

    def handle_data(self, data):
        if self.skip_depth > 0:
            return
        self.current.append(data)

    def get_text(self):
        if self.current:
            text = ' '.join(''.join(self.current).split())
            if text:
                self.paragraphs.append(text)
        return self.paragraphs


def extract_epub_text(epub_path):
    """Extract text paragraphs from an EPUB file."""
    try:
        with zipfile.ZipFile(epub_path) as z:
            # Find XHTML content files
            xhtml_files = [n for n in z.namelist()
                          if n.endswith(('.xhtml', '.html', '.htm'))
                          and 'Text/' in n
                          and not n.lower().startswith('toc')]

            if not xhtml_files:
                # Fallback: try all xhtml files
                xhtml_files = [n for n in z.namelist()
                              if n.endswith(('.xhtml', '.html', '.htm'))
                              and not n.lower().startswith('toc')]

            all_paragraphs = []
            for xf in sorted(xhtml_files):
                try:
                    with z.open(xf) as f:
                        content = f.read().decode('utf-8', errors='replace')
                    parser = XHTMLTextExtractor()
                    parser.feed(content)
                    paras = parser.get_text()
                    all_paragraphs.extend(paras)
                except Exception:
                    continue

            return all_paragraphs
    except Exception as e:
        print(f'  ERROR parsing {epub_path}: {e}', file=sys.stderr)
        return []


def make_chapter_json(paragraphs):
    """Convert text paragraphs to UPSCbooks section/block JSON format."""
    if not paragraphs:
        return json.dumps([{
            'id': 'intro',
            'num': 1,
            'title': 'Content',
            'blocks': [{'kind': 'para', 'runs': [{'text': 'Content not available.', 'bold': False, 'italic': False}]}]
        }])

    sections = []
    sec_num = 1
    blocks = []

    for para in paragraphs:
        # Skip very short strings (page numbers, headers, etc.)
        if len(para.strip()) < 3:
            continue
        # Detect if paragraph is a heading (short, no period, starts with number or is all caps)
        is_heading = (
            len(para) < 80 and
            not para.endswith('.') and
            not para.endswith(',') and
            (
                re.match(r'^\d+[\.\)]\s', para) or
                (para.isupper() and len(para) < 60) or
                re.match(r'^Chapter\s', para, re.I) or
                re.match(r'^Unit\s', para, re.I)
            )
        )
        if is_heading:
            # Start new section
            if blocks:
                sections.append({
                    'id': f'sec-{sec_num}',
                    'num': sec_num,
                    'title': sections[-1]['title'] if sections else 'Content',
                    'blocks': blocks
                })
                sec_num += 1
                blocks = []
            # Clean heading
            title = re.sub(r'^\d+[\.\)]\s*', '', para).strip()
            if not title:
                title = para
            blocks.append({
                'kind': 'subhead',
                'runs': [{'text': title, 'bold': True, 'italic': False}]
            })
        else:
            # Regular paragraph
            blocks.append({
                'kind': 'para',
                'runs': [{'text': para, 'bold': False, 'italic': False}]
            })

    # Final section
    if blocks:
        sections.append({
            'id': f'sec-{sec_num}',
            'num': sec_num,
            'title': 'Content',
            'blocks': blocks
        })

    if not sections:
        sections.append({
            'id': 'sec-1',
            'num': 1,
            'title': 'Content',
            'blocks': [{'kind': 'para', 'runs': [{'text': 'Content not available.', 'bold': False, 'italic': False}]}]
        })

    return json.dumps(sections)


def slugify(text):
    """Create URL-safe slug from text."""
    s = text.lower().strip()
    s = re.sub(r'[^\w\s-]', '', s)
    s = re.sub(r'[\s_]+', '-', s)
    s = re.sub(r'-+', '-', s).strip('-')
    return s


def main():
    books = []  # {slug, title, author, description, color, category, subject, chapters: [{number, title, sections_json}]}

    for subject_dir in SUBJECTS:
        subject_path = os.path.join(BASE, subject_dir)
        if not os.path.isdir(subject_path):
            print(f'SKIP: {subject_dir} not found', file=sys.stderr)
            continue

        meta = SUBJECT_META.get(subject_dir, {'display': subject_dir, 'color': '#333333'})
        print(f'\n=== {meta["display"]} ===')

        for series_name in sorted(os.listdir(subject_path)):
            series_path = os.path.join(subject_path, series_name)
            if not os.path.isdir(series_path):
                continue

            epub_files = sorted(
                [f for f in os.listdir(series_path) if f.endswith('.epub')],
                key=lambda f: int(re.search(r'(\d+)', f).group(1)) if re.search(r'(\d+)', f) else 0
            )

            if not epub_files:
                continue

            book_slug = slugify(series_name)
            # Ensure unique slug
            existing_slugs = {b['slug'] for b in books}
            if book_slug in existing_slugs:
                book_slug = f'{book_slug}-{slugify(subject_dir)}'
            existing_slugs.add(book_slug)

            chapters = []
            for i, epub_file in enumerate(epub_files, 1):
                epub_path = os.path.join(series_path, epub_file)
                print(f'  [{i}/{len(epub_files)}] {epub_file}...', end=' ', flush=True)

                paragraphs = extract_epub_text(epub_path)
                sections_json = make_chapter_json(paragraphs)

                # Derive chapter title from first paragraph or filename
                ch_title = f'Chapter {i}'
                if paragraphs:
                    # Use first meaningful paragraph as title hint
                    first = paragraphs[0][:80]
                    if len(first) > 10:
                        ch_title = first

                chapters.append({
                    'number': i,
                    'title': ch_title,
                    'sections_json': sections_json
                })
                print(f'{len(paragraphs)} paras, {len(sections_json)} bytes')

            books.append({
                'slug': book_slug,
                'title': series_name,
                'author': 'NCERT',
                'description': f'{meta["display"]} textbook by NCERT — {series_name}',
                'color': meta['color'],
                'category': 'ncert',
                'subject': meta['display'],
                'chapter_count': len(chapters),
                'chapters': chapters
            })
            print(f'  => {series_name}: {len(chapters)} chapters')
            incremental_save(books)

    # Write manifest
    out_path = os.path.join(BASE, '..', 'upscbooks', 'data', 'ncert-manifest.json')
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(books, f, indent=1, ensure_ascii=False)

    total_chapters = sum(b['chapter_count'] for b in books)
    print(f'\n=== DONE: {len(books)} books, {total_chapters} chapters ===')
    print(f'Written to: {out_path}')


def incremental_save(books):
    """Save manifest after each subject."""
    out_path = os.path.join(BASE, '..', 'upscbooks', 'data', 'ncert-manifest.json')
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(books, f, indent=1, ensure_ascii=False)
    total = sum(b['chapter_count'] for b in books)
    print(f'  [saved] {len(books)} books, {total} chapters so far')


if __name__ == '__main__':
    main()
