#!/usr/bin/env python3
"""Extract cover images from NCERT EPUBs and upload to R2."""
import os
import sys
import json
import zipfile
import io
import re
from pathlib import Path
from datetime import datetime

try:
    from PIL import Image
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False

try:
    import boto3
    HAS_BOTO3 = True
except ImportError:
    HAS_BOTO3 = False

BASE = r'C:\Users\Vulgaris\Documents\iCloudDrive\UPSC all ncerts EPub'
PROJECT_ROOT = Path(__file__).parent.parent
COVERS_DIR = PROJECT_ROOT / 'covers'
DOCS_DIR = PROJECT_ROOT / 'docs'

# Load .env
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

# Books missing covers (from database)
MISSING_BOOKS = [
    'economics',
    'economics-indian-economic-development',
    'economics-introductory-macro-economics',
    'economics-introductory-micro-economics',
    'economics-statistics-for-economics',
    'economy-undestanding-economic-development',
    'geography-fundamentals-of-human-geography',
    'geography-fundamentals-of-physical-geography',
    'geography-india-physical-environment',
    'geography-our-environment',
    'geography-our-habitat',
    'geography-practical-work-in-geography-1',
    'geography-practical-work-in-geography-2',
    'geography-resource-and-development',
    'history-india-and-the-contemporary-world-2',
    'history-themes-in-world-history',
    'our-past-3-part-1',
    'people',
    'political-science-contemporary-world-politics',
    'political-science-democratic-politics-1',
    'political-science-democratic-politics-2',
    'political-science-indian-constituition-at-work',
    'political-science-political-theory',
    'political-science-politics-in-india-since-independence',
    'social-and-political-life-std-6',
    'social-science-social-and-political-life',
    'social-science-social-and-political-life-3',
    'sociology-indian-society',
    'sociology-introducing-sociology',
    'sociology-social-change-and-development-in-india',
    'sociology-understanding-society',
]

TITLE_MAP = {
    'economics': 'Economics',
    'economics-indian-economic-development': 'Economics (Indian Economic Development)',
    'economics-introductory-macro-economics': 'Economics (Introductory Macro Economics)',
    'economics-introductory-micro-economics': 'Economics (Introductory Micro Economics)',
    'economics-statistics-for-economics': 'Economics (Statistics For Economics)',
    'economy-undestanding-economic-development': 'Economy (Undestanding Economic Development)',
    'geography-fundamentals-of-human-geography': 'Geography (Fundamentals of Human Geography)',
    'geography-fundamentals-of-physical-geography': 'Geography (Fundamentals of Physical Geography)',
    'geography-india-physical-environment': 'Geography (India Physical Environment)',
    'geography-our-environment': 'Geography (Our Environment)',
    'geography-our-habitat': 'Geography (Our Habitat)',
    'geography-practical-work-in-geography-1': 'Geography (Practical Work in Geography 1)',
    'geography-practical-work-in-geography-2': 'Geography (Practical Work in Geography 2)',
    'geography-resource-and-development': 'Geography (Resource and Development)',
    'history-india-and-the-contemporary-world-2': 'History (India and the contemporary world 2)',
    'history-themes-in-world-history': 'History (Themes in World History)',
    'our-past-3-part-1': 'Our past 3 part 1',
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


def find_epub(slug):
    """Find the first EPUB for a given book slug."""
    # Convert slug to search terms
    search_terms = slug.replace('-', ' ').lower()
    words = search_terms.split()
    
    # Search for directories matching the book name
    best_match = None
    best_score = 0
    
    for root, dirs, files in os.walk(BASE):
        for d in dirs:
            d_lower = d.lower()
            # Count how many words from the slug appear in the directory name
            score = sum(1 for w in words if w in d_lower)
            # Accept single-word matches too
            if score > best_score:
                best_score = score
                best_match = os.path.join(root, d)
    
    if best_match:
        # Find first EPUB in this directory
        for f in os.listdir(best_match):
            if f.lower().endswith('.epub'):
                return os.path.join(best_match, f)
        
        # If no EPUB found, check subdirectories (e.g., Economics/Economics/)
        for sub_root, sub_dirs, sub_files in os.walk(best_match):
            for f in sub_files:
                if f.lower().endswith('.epub'):
                    return os.path.join(sub_root, f)
    return None


def extract_cover(epub_path):
    """Extract cover image from EPUB."""
    try:
        with zipfile.ZipFile(epub_path, 'r') as zf:
            names = zf.namelist()
            
            # Look for cover images
            cover_names = ['cover', 'cover-image', 'final cover']
            for name in names:
                basename = os.path.basename(name).lower()
                if any(c in basename for c in cover_names):
                    if name.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
                        return zf.read(name), os.path.splitext(name)[1].lower()
            
            # Fallback: first image in OEBPS/Images/
            img_names = [n for n in names if n.startswith('OEBPS/Images/') and n.lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))]
            if img_names:
                return zf.read(img_names[0]), os.path.splitext(img_names[0])[1].lower()
            
            # Fallback: any image
            img_names = [n for n in names if n.lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))]
            if img_names:
                return zf.read(img_names[0]), os.path.splitext(img_names[0])[1].lower()
    except Exception as e:
        print(f"  Error extracting cover: {e}")
    return None, None


def convert_to_webp(img_data, ext):
    """Convert image to WebP."""
    if not HAS_PILLOW:
        return img_data if ext == 'webp' else None
    
    try:
        pil_img = Image.open(io.BytesIO(img_data))
        if pil_img.width < 50 or pil_img.height < 50:
            return None
        
        # Resize to reasonable dimensions
        if pil_img.width > 800 or pil_img.height > 1200:
            pil_img.thumbnail((800, 1200), Image.Resampling.LANCZOS)
        
        output = io.BytesIO()
        pil_img.save(output, format='WEBP', quality=85)
        return output.getvalue()
    except Exception as e:
        print(f"  Conversion error: {e}")
        return None


def upload_to_r2(local_path, r2_key):
    """Upload file to R2."""
    if not HAS_BOTO3 or not R2_ACCESS_KEY:
        return False
    
    try:
        s3 = boto3.client(
            's3',
            endpoint_url=R2_ENDPOINT,
            aws_access_key_id=R2_ACCESS_KEY,
            aws_secret_access_key=R2_SECRET_KEY,
            region_name='auto',
        )
        s3.upload_file(
            str(local_path),
            R2_BUCKET,
            r2_key,
            ExtraArgs={'ContentType': 'image/webp'}
        )
        return True
    except Exception as e:
        print(f"  R2 upload error: {e}")
        return False


def main():
    if not HAS_PILLOW:
        print("ERROR: Pillow not installed")
        sys.exit(1)
    
    COVERS_DIR.mkdir(parents=True, exist_ok=True)
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    
    provenance = {}
    success_count = 0
    
    for slug in MISSING_BOOKS:
        print(f"\n[{slug}] Processing...")
        
        # Find EPUB
        epub_path = find_epub(slug)
        if not epub_path:
            print(f"  No EPUB found")
            continue
        
        print(f"  EPUB: {epub_path}")
        
        # Extract cover
        img_data, ext = extract_cover(epub_path)
        if not img_data:
            print(f"  No cover image found")
            continue
        
        # Convert to WebP
        webp_data = convert_to_webp(img_data, ext)
        if not webp_data:
            print(f"  Failed to convert to WebP")
            continue
        
        # Save locally
        cover_filename = f"{slug}.webp"
        cover_path = COVERS_DIR / cover_filename
        with open(cover_path, 'wb') as f:
            f.write(webp_data)
        print(f"  Saved: {cover_path} ({len(webp_data)} bytes)")
        
        # Upload to R2
        r2_key = f"content/{slug}/images/cover.webp"
        uploaded = upload_to_r2(cover_path, r2_key)
        print(f"  R2: {'Uploaded' if uploaded else 'Skipped (no R2 creds)'}")
        
        provenance[slug] = {
            'title': TITLE_MAP.get(slug, slug),
            'file': cover_filename,
            'bytes': len(webp_data),
            'found': True,
            'confidence': 1,
            'source': 'epub',
            'epub': epub_path,
            'fetchedAt': datetime.now().isoformat(),
        }
        
        success_count += 1
    
    # Update provenance.json
    prov_path = COVERS_DIR / 'provenance.json'
    existing = {}
    if prov_path.exists():
        with open(prov_path, 'r') as f:
            existing = json.load(f)
    
    existing.update(provenance)
    with open(prov_path, 'w') as f:
        json.dump(existing, f, indent=2)
    
    print(f"\n{'='*60}")
    print(f"COVER EXTRACTION COMPLETE")
    print(f"{'='*60}")
    print(f"Successfully processed: {success_count}/{len(MISSING_BOOKS)} books")
    print(f"Provenance updated: {prov_path}")


if __name__ == '__main__':
    main()
