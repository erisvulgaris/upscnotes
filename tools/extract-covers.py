#!/usr/bin/env python3
"""Extract first-page covers from all book PDFs/EPUBs and replace existing covers."""
import os
import sys
import json
import zipfile
import io
import sqlite3
from pathlib import Path
from datetime import datetime

try:
    from PIL import Image
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False

try:
    import fitz
    HAS_PYMUPDF = True
except ImportError:
    HAS_PYMUPDF = False

try:
    import boto3
    HAS_BOTO3 = True
except ImportError:
    HAS_BOTO3 = False

BASE = r'C:\Users\Vulgaris\Documents\iCloudDrive\UPSC E-books'
NCERT_BASE = r'C:\Users\Vulgaris\Documents\iCloudDrive\UPSC all ncerts EPub'
PROJECT_ROOT = Path(__file__).parent.parent
COVERS_DIR = PROJECT_ROOT / 'covers'
DB_PATH = PROJECT_ROOT / 'data' / 'upscbooks.db'

env_path = PROJECT_ROOT / '.env'
if env_path.exists():
    with open(env_path, 'r') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, _, value = line.partition('=')
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

R2_ACCOUNT_ID = os.getenv('R2_ACCOUNT_ID', '66d1f273ad2f74c2b6120e0824872054')
R2_BUCKET = os.getenv('R2_BUCKET', 'upsc-books')
R2_ACCESS_KEY = os.getenv('R2_ACCESS_KEY_ID', '')
R2_SECRET_KEY = os.getenv('R2_SECRET_ACCESS_KEY', '')
R2_ENDPOINT = f'https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com'

BOOKS = {
    'environment-shankar-ias': os.path.join(BASE, r'1. Foundation\Standard books & PYQs\Std. books\Environment (Shankar IAS Academy) (Z-Library).pdf'),
    'indian-economy-vivek-singh': os.path.join(BASE, r'1. Foundation\Standard books & PYQs\Std. books\Indian Economy - Vivek Singh [7th Edition].pdf'),
    'pmf-ias-environment': os.path.join(BASE, r'1. Foundation\Standard books & PYQs\PMF IAS\PMFIAS-Environment-Third-Edition.pdf'),
    'pmf-ias-modern-indian-history': os.path.join(BASE, r'1. Foundation\Standard books & PYQs\PMF IAS\PMFIAS-Modern-Indian-History.pdf'),
    'indias-struggle-for-independence': os.path.join(BASE, r'3. Mains\Indias Struggle for Independence (Chandra, Bipan) (Z-Library).epub'),
    'spectrum-modern-india': os.path.join(BASE, r'1. Foundation\Standard books & PYQs\Std. books\Spectrum.pdf'),
    'indian-polity': os.path.join(BASE, r'1. Foundation\Standard books & PYQs\Std. books\laxmikant7thEdition_Optimizer.pdf'),
}

NCERT_BOOKS = {
    'economics': 'Economics',
    'economics-indian-economic-development': 'Economics (Indian Economic Development)',
    'economics-introductory-macro-economics': 'Economics (Introductory Macro Economics)',
    'economics-introductory-micro-economics': 'Economics (Introductory Micro Economics)',
    'economics-statistics-for-economics': 'Economics (Statistics For Economics)',
    'economy-undestanding-economic-development': 'Economy (Undestanding Economic Development)',
    'geography-contemporary-india-1': 'Geography (Contemporary India 1)',
    'geography-contemporary-india-2': 'Geography (Contemporary India 2)',
    'geography-fundamentals-of-human-geography': 'Geography (Fundamentals of Human Geography)',
    'geography-fundamentals-of-physical-geography': 'Geography (Fundamentals of Physical Geography)',
    'geography-india-physical-environment': 'Geography (India Physical Environment)',
    'geography-our-environment': 'Geography (Our Environment)',
    'geography-our-habitat': 'Geography (Our Habitat)',
    'geography-practical-work-in-geography-1': 'Geography (Practical Work in Geography 1)',
    'geography-practical-work-in-geography-2': 'Geography (Practical Work in Geography 2)',
    'geography-resource-and-development': 'Geography (Resource and Development)',
    'history-india-and-contemporary-world': 'History (India and Contemporary World)',
    'history-india-and-the-contemporary-world-2': 'History (India and the contemporary world 2)',
    'history-our-past-1': 'History (Our Past 1)',
    'history-our-past-2': 'History (Our Past 2)',
    'history-themes-in-indian-history-1-2-3': 'History (Themes in Indian History 1, 2, 3 )',
    'history-themes-in-world-history': 'History (Themes in World History)',
    'our-past-3-part-1': 'Our past 3 part 1',
    'our-past-3-part-2': 'Our past 3 part 2',
    'people': 'People',
    'political-science-contemporary-world-politics': 'Political Science (Contemporary World Politics)',
    'political-science-democratic-politics-1': 'Political Science (Democratic Politics 1)',
    'political-science-democratic-politics-2': 'Political Science (Democratic Politics 2)',
    'political-science-indian-constituition-at-work': 'Political Science (Indian Constituition at Work)',
    'political-science-political-theory': 'Political Science (Political Theory)',
    'political-science-politics-in-india-since-independence': 'Political Science (Politics in India Since Independence)',
    'social-and-political-life-std-6': 'Social and political life std 6',
    'social-science-social-and-political-life': 'Social Science (Social and Political Life)',
    'social-science-social-and-political-life-3': 'Social Science (Social and Political Life 3)',
    'sociology-indian-society': 'Sociology (Indian Society)',
    'sociology-introducing-sociology': 'Sociology (Introducing Sociology)',
    'sociology-social-change-and-development-in-india': 'Sociology (Social change and Development in India)',
    'sociology-understanding-society': 'Sociology (Understanding Society)',
}


def find_ncert_source(slug):
    if not os.path.exists(NCERT_BASE):
        return None
    search_terms = slug.replace('-', ' ').lower()
    words = search_terms.split()
    best_match = None
    best_score = 0
    for root, dirs, files in os.walk(NCERT_BASE):
        for d in dirs:
            d_lower = d.lower()
            score = sum(1 for w in words if w in d_lower)
            if score > best_score:
                best_score = score
                best_match = os.path.join(root, d)
    if best_match:
        for f in os.listdir(best_match):
            if f.lower().endswith('.epub'):
                return os.path.join(best_match, f)
        for sub_root, sub_dirs, sub_files in os.walk(best_match):
            for f in sub_files:
                if f.lower().endswith('.epub'):
                    return os.path.join(sub_root, f)
    return None


def get_source(slug):
    if slug in BOOKS:
        return BOOKS[slug], 'pdf' if BOOKS[slug].endswith('.pdf') else 'epub'
    if slug in NCERT_BOOKS:
        src = find_ncert_source(slug)
        if src:
            return src, 'epub'
    return None, None


def extract_pdf_cover(pdf_path):
    if not HAS_PYMUPDF:
        return None
    try:
        doc = fitz.open(pdf_path)
        if len(doc) == 0:
            return None
        page = doc[0]
        pix = page.get_pixmap(dpi=150)
        img_data = pix.tobytes('png')
        doc.close()
        return img_data
    except Exception as e:
        error_str = str(e)
        if 'no objects found' in error_str or 'Failed to open file' in error_str:
            print(f"  PDF cover error: File may be an iCloudDrive placeholder. Right-click in Explorer and select 'Always keep on this device' to download locally.")
        else:
            print(f"  PDF cover error: {e}")
        return None


def extract_epub_cover(epub_path):
    if not zipfile.is_zipfile(epub_path):
        return None
    try:
        with zipfile.ZipFile(epub_path, 'r') as zf:
            names = zf.namelist()
            cover_names = ['cover', 'cover-image', 'final cover']
            for name in names:
                basename = os.path.basename(name).lower()
                if any(c in basename for c in cover_names):
                    if name.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
                        return zf.read(name)
            img_names = [n for n in names if n.startswith('OEBPS/Images/') and n.lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))]
            if img_names:
                return zf.read(img_names[0])
            img_names = [n for n in names if n.lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))]
            if img_names:
                return zf.read(img_names[0])
    except Exception as e:
        print(f"  EPUB cover error: {e}")
    return None


def convert_to_jpg(img_data):
    if not HAS_PILLOW or not img_data:
        return None
    try:
        pil_img = Image.open(io.BytesIO(img_data))
        if pil_img.mode in ('RGBA', 'P'):
            background = Image.new('RGB', pil_img.size, (255, 255, 255))
            if pil_img.mode == 'P':
                pil_img = pil_img.convert('RGBA')
            background.paste(pil_img, mask=pil_img.split()[-1] if pil_img.mode in ('RGBA', 'P') else None)
            pil_img = background
        elif pil_img.mode != 'RGB':
            pil_img = pil_img.convert('RGB')
        output = io.BytesIO()
        pil_img.save(output, format='JPEG', quality=90)
        return output.getvalue()
    except Exception as e:
        print(f"  JPG conversion error: {e}")
        return None


def upload_to_r2(local_path, r2_key):
    if not HAS_BOTO3:
        return False
    try:
        s3 = boto3.client('s3', endpoint_url=R2_ENDPOINT, aws_access_key_id=R2_ACCESS_KEY, aws_secret_access_key=R2_SECRET_KEY)
        s3.upload_file(str(local_path), R2_BUCKET, r2_key, ExtraArgs={'ContentType': 'image/jpeg'})
        return True
    except Exception as e:
        print(f"  R2 upload error: {e}")
        return False


def upload_bytes_to_r2(data, r2_key):
    if not HAS_BOTO3:
        return False
    try:
        s3 = boto3.client('s3', endpoint_url=R2_ENDPOINT, aws_access_key_id=R2_ACCESS_KEY, aws_secret_access_key=R2_SECRET_KEY)
        s3.put_object(Bucket=R2_BUCKET, Key=r2_key, Body=data, ContentType='image/jpeg')
        return True
    except Exception as e:
        print(f"  R2 bytes upload error: {e}")
        return False


def main():
    COVERS_DIR.mkdir(parents=True, exist_ok=True)
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    all_books = {**BOOKS, **{slug: 'epub' for slug in NCERT_BOOKS}}
    processed = 0
    succeeded = 0
    failed = 0
    
    for slug, source_info in all_books.items():
        if slug == 'modern-indian-history':
            continue
        processed += 1
        
        src, book_type = get_source(slug)
        if not src or not os.path.exists(src):
            print(f"[{slug}] Source not found, skipping")
            failed += 1
            continue
        
        print(f"[{slug}] Extracting cover from {src}...")
        
        if book_type == 'pdf':
            img_data = extract_pdf_cover(src)
        else:
            img_data = extract_epub_cover(src)
        
        if not img_data:
            print(f"  No cover image extracted")
            failed += 1
            continue
        
        jpg_data = convert_to_jpg(img_data)
        if not jpg_data:
            print(f"  JPG conversion failed")
            failed += 1
            continue
        
        cover_path = COVERS_DIR / f"{slug}.jpg"
        with open(cover_path, 'wb') as f:
            f.write(jpg_data)
        
        r2_key = f"covers/{slug}.jpg"
        if upload_bytes_to_r2(jpg_data, r2_key):
            print(f"  Uploaded to R2: {r2_key}")
        else:
            print(f"  R2 upload skipped/failed")
        
        cursor.execute('UPDATE books SET cover = ? WHERE slug = ?', ('jpg', slug))
        succeeded += 1
        print(f"  Done: {len(jpg_data)} bytes")
    
    conn.commit()
    conn.close()
    
    print(f"\nProcessed: {processed}, Succeeded: {succeeded}, Failed: {failed}")


if __name__ == '__main__':
    main()
