#!/usr/bin/env python3
"""
Extract non-text elements (images, charts, graphs, tables) from book pages.

Uses:
- PyMuPDF (fitz) for PDF image extraction (fast, no ML needed)
- PaddleOCR PP-DocLayoutV3 for layout analysis (optional, for complex pages)
- Pillow for image compression to WebP
- boto3/botocore for Cloudflare R2 upload

Requirements:
    pip install pymupdf paddleocr pillow boto3

Usage:
    python tools/extract-images.py --book modern-indian-history
    python tools/extract-images.py --all --dry-run
    python tools/extract-images.py --book pmf-ias-modern-indian-history --pages 1-50
"""

import os
import sys
import json
import argparse
import hashlib
import io
import re
from pathlib import Path
from datetime import datetime
from urllib.parse import quote

try:
    import dotenv
    dotenv.load_dotenv()
except ImportError:
    pass

# Try to import dependencies
try:
    import fitz  # PyMuPDF
    HAS_PYMUPDF = True
except ImportError:
    HAS_PYMUPDF = False

try:
    from paddleocr import LayoutDetection
    HAS_PADDLEOCR = True
except ImportError:
    HAS_PADDLEOCR = False

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

# Configuration
BASE = r'C:\Users\Vulgaris\Documents\iCloudDrive\UPSC E-books'
NCERT_BASE = r'C:\Users\Vulgaris\Documents\iCloudDrive\UPSC all ncerts EPub'
PROJECT_ROOT = Path(__file__).parent.parent
OUTPUT_DIR = PROJECT_ROOT / 'content'
REPORT_DIR = PROJECT_ROOT / 'docs'

# R2 Configuration (from .env)
R2_ACCOUNT_ID = os.getenv('R2_ACCOUNT_ID', '66d1f273ad2f74c2b6120e0824872054')
R2_BUCKET = os.getenv('R2_BUCKET', 'upsc-books')
R2_ACCESS_KEY = os.getenv('R2_ACCESS_KEY_ID', '')
R2_SECRET_KEY = os.getenv('R2_SECRET_ACCESS_KEY', '')
R2_ENDPOINT = f'https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com'

# Image optimization
WEBP_QUALITY = 80
MAX_WIDTH = 1200
MAX_HEIGHT = 1600
MIN_SIZE_BYTES = 1024  # Skip tiny images

# Book registry with source paths
BOOKS = {
    'environment-shankar-ias': {
        'title': 'Environment',
        'author': 'Shankar IAS Academy',
        'src': os.path.join(BASE, r'1. Foundation\Standard books & PYQs\Std. books\Environment (Shankar IAS Academy) (Z-Library).pdf'),
        'type': 'pdf',
        'subject': 'Environment',
        'pages': 400
    },
    'indian-economy-vivek-singh': {
        'title': 'Indian Economy',
        'author': 'Vivek Singh (7th Edition)',
        'src': os.path.join(BASE, r'1. Foundation\Standard books & PYQs\Std. books\Indian Economy - Vivek Singh [7th Edition].pdf'),
        'type': 'pdf',
        'subject': 'Economy',
        'pages': 500
    },
    'pmf-ias-environment': {
        'title': 'PMF IAS Environment (3rd Edition)',
        'author': 'PMF IAS',
        'src': os.path.join(BASE, r'1. Foundation\Standard books & PYQs\PMF IAS\PMFIAS-Environment-Third-Edition.pdf'),
        'type': 'pdf',
        'subject': 'Environment',
        'pages': 300
    },
    'pmf-ias-modern-indian-history': {
        'title': 'PMF IAS Modern Indian History',
        'author': 'PMF IAS',
        'src': os.path.join(BASE, r'1. Foundation\Standard books & PYQs\PMF IAS\PMFIAS-Modern-Indian-History.pdf'),
        'type': 'pdf',
        'subject': 'History',
        'pages': 829
    },
    'indias-struggle-for-independence': {
        'title': "India's Struggle for Independence",
        'author': 'Bipan Chandra et al.',
        'src': os.path.join(BASE, r'3. Mains\Indias Struggle for Independence (Chandra, Bipan) (Z-Library).epub'),
        'type': 'epub',
        'subject': 'History',
        'pages': 500
    },
    'spectrum-modern-india': {
        'title': 'A Brief History of Modern India',
        'author': 'Rajiv Ahir',
        'src': os.path.join(BASE, r'1. Foundation\Standard books & PYQs\Std. books\Spectrum.pdf'),
        'type': 'pdf',
        'subject': 'History',
        'pages': 400
    },
    'modern-indian-history': {
        'title': 'Modern Indian History',
        'author': 'Himanshu Khatri',
        'src': None,
        'type': 'custom',
        'subject': 'History',
        'pages': 47
    },
    'indian-polity': {
        'title': 'Indian Polity',
        'author': 'M. Laxmikanth',
        'src': os.path.join(BASE, r'1. Foundation\Standard books & PYQs\Std. books\laxmikant7thEdition_Optimizer.pdf'),
        'type': 'pdf',
        'subject': 'Polity',
        'pages': 700
    }
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


class ImageExtractor:
    """Extract non-text elements from book pages."""
    
    def __init__(self, book_slug, dry_run=False):
        self.book_slug = book_slug
        self.dry_run = dry_run
        
        if book_slug in BOOKS:
            self.book_meta = BOOKS[book_slug]
        elif book_slug in NCERT_BOOKS:
            self.book_meta = {
                'title': NCERT_BOOKS[book_slug],
                'src': self._find_ncert_source(book_slug),
                'type': 'epub',
                'subject': 'NCERT',
                'pages': 200
            }
        else:
            raise ValueError(f"Unknown book: {book_slug}")
        
        self.book_dir = OUTPUT_DIR / book_slug
        self.images_dir = self.book_dir / 'images'
        self.images_dir.mkdir(parents=True, exist_ok=True)
        
        # Stats
        self.pages_processed = 0
        self.images_extracted = 0
        self.tables_extracted = 0
        self.figures_extracted = 0
        self.errors = []
        
        # R2 client
        self.s3_client = None
        if HAS_BOTO3 and not dry_run and R2_ACCESS_KEY:
            self._init_r2_client()
    
    def log(self, msg):
        print(f"[{self.book_slug}] {msg}")
    
    def _init_r2_client(self):
        """Initialize R2 S3-compatible client."""
        try:
            self.s3_client = boto3.client(
                's3',
                endpoint_url=R2_ENDPOINT,
                aws_access_key_id=R2_ACCESS_KEY,
                aws_secret_access_key=R2_SECRET_KEY,
                region_name='auto'
            )
            self.log("R2 client initialized")
        except Exception as e:
            self.log(f"R2 init failed: {e}")
            self.s3_client = None
    
    def _find_ncert_source(self, slug):
        """Find NCERT EPUB file for a given book slug."""
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
    
    def open_source(self):
        """Open PDF/EPUB source file."""
        src = self.book_meta.get('src')
        if not src or not os.path.exists(src):
            self.log(f"Source not found: {src}")
            return None
        
        book_type = self.book_meta.get('type', 'pdf')
        
        if book_type == 'pdf' and HAS_PYMUPDF:
            try:
                doc = fitz.open(src)
                self.log(f"Opened PDF: {len(doc)} pages")
                return doc
            except Exception as e:
                self.log(f"Failed to open PDF: {e}")
        elif book_type == 'epub':
            # EPUBs are ZIP archives - extract images directly
            self.log(f"EPUB source: {src}")
            return None
        
        return None
    
    def extract_from_pdf(self, doc, page_range=None):
        """
        Extract images from PDF using PyMuPDF.
        This is the primary fast path - no ML needed.
        """
        if not HAS_PYMUPDF:
            self.log("PyMuPDF not available")
            return []
        
        extracted = []
        total_pages = len(doc)
        
        # Determine page range
        start = 1
        end = total_pages
        if page_range:
            match = re.match(r'(\d+)-(\d+)', page_range)
            if match:
                start = int(match.group(1))
                end = int(match.group(2))
        
        self.log(f"Extracting images from pages {start}-{end}")
        
        for page_num in range(start - 1, min(end, total_pages)):
            try:
                page = doc[page_num]
                page_number = page_num + 1
                
                # Get images on this page
                img_list = page.get_images(full=True)
                
                if img_list:
                    self.log(f"Page {page_number}: {len(img_list)} images found")
                
                for img_index, img in enumerate(img_list):
                    try:
                        # Extract image
                        xref = img[0]
                        base_image = doc.extract_image(xref)
                        image_bytes = base_image["image"]
                        image_ext = base_image["ext"]
                        
                        # Skip tiny images
                        if len(image_bytes) < MIN_SIZE_BYTES:
                            continue
                        
                        # Convert to WebP if needed
                        if HAS_PILLOW and image_ext != 'webp':
                            try:
                                pil_img = Image.open(io.BytesIO(image_bytes))
                                
                                # Skip very small images
                                if pil_img.width < 50 or pil_img.height < 50:
                                    continue
                                
                                # Resize if needed
                                if pil_img.width > MAX_WIDTH or pil_img.height > MAX_HEIGHT:
                                    pil_img.thumbnail(
                                        (MAX_WIDTH, MAX_HEIGHT),
                                        Image.Resampling.LANCZOS
                                    )
                                
                                # Convert to WebP
                                output = io.BytesIO()
                                pil_img.save(output, format='WEBP', quality=WEBP_QUALITY)
                                image_bytes = output.getvalue()
                                image_ext = 'webp'
                            except Exception as e:
                                self.log(f"  Image {img_index} conversion failed: {e}")
                                continue
                        
                        # Save locally
                        filename = f"p{page_number:03d}_img{img_index:02d}.{image_ext}"
                        local_path = self.images_dir / filename
                        
                        with open(local_path, 'wb') as f:
                            f.write(image_bytes)
                        
                        # Upload to R2
                        r2_key = f"content/{self.book_slug}/images/{filename}"
                        if self.s3_client:
                            self._upload_to_r2(local_path, r2_key)
                        
                        extracted.append({
                            'page': page_number,
                            'filename': filename,
                            'r2_key': r2_key,
                            'size': len(image_bytes),
                            'format': image_ext
                        })
                        
                        self.images_extracted += 1
                        
                    except Exception as e:
                        self.log(f"  Error extracting image {img_index}: {e}")
                        continue
                
                self.pages_processed += 1
                
            except Exception as e:
                self.log(f"Error processing page {page_num + 1}: {e}")
                continue
        
        return extracted
    
    def extract_from_epub(self, page_range=None):
        """
        Extract images from EPUB (ZIP) archive.
        """
        import zipfile
        
        src = self.book_meta.get('src')
        if not src or not os.path.exists(src):
            return []
        
        extracted = []
        
        try:
            with zipfile.ZipFile(src, 'r') as zf:
                # Find all image files in EPUB
                image_files = [f for f in zf.namelist() 
                              if f.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'))]
                
                self.log(f"Found {len(image_files)} images in EPUB")
                
                for img_file in image_files:
                    try:
                        # Extract image
                        img_data = zf.read(img_file)
                        
                        if len(img_data) < MIN_SIZE_BYTES:
                            continue
                        
                        # Convert to WebP if needed
                        if HAS_PILLOW and not img_file.lower().endswith('.webp'):
                            try:
                                pil_img = Image.open(io.BytesIO(img_data))
                                
                                if pil_img.width < 50 or pil_img.height < 50:
                                    continue
                                
                                if pil_img.width > MAX_WIDTH or pil_img.height > MAX_HEIGHT:
                                    pil_img.thumbnail(
                                        (MAX_WIDTH, MAX_HEIGHT),
                                        Image.Resampling.LANCZOS
                                    )
                                
                                output = io.BytesIO()
                                pil_img.save(output, format='WEBP', quality=WEBP_QUALITY)
                                img_data = output.getvalue()
                                img_ext = 'webp'
                            except Exception as e:
                                self.log(f"  Conversion failed for {img_file}: {e}")
                                continue
                        else:
                            img_ext = Path(img_file).suffix.lstrip('.')
                        
                        # Generate filename
                        chapter_match = re.search(r'ch(\d+)', img_file, re.IGNORECASE)
                        chapter_num = int(chapter_match.group(1)) if chapter_match else 0
                        filename = f"ch{chapter_num:02d}_{Path(img_file).stem}.{img_ext}"
                        
                        local_path = self.images_dir / filename
                        with open(local_path, 'wb') as f:
                            f.write(img_data)
                        
                        r2_key = f"content/{self.book_slug}/images/{filename}"
                        if self.s3_client:
                            self._upload_to_r2(local_path, r2_key)
                        
                        extracted.append({
                            'source': img_file,
                            'filename': filename,
                            'r2_key': r2_key,
                            'size': len(img_data),
                            'format': img_ext
                        })
                        
                        self.images_extracted += 1
                        
                    except Exception as e:
                        self.log(f"Error extracting {img_file}: {e}")
                        continue
                        
        except Exception as e:
            self.log(f"Failed to open EPUB: {e}")
            return extracted
        
        return extracted
    
    def _upload_to_r2(self, local_path, r2_key):
        """Upload file to Cloudflare R2."""
        if not self.s3_client or self.dry_run:
            return False
        
        try:
            self.s3_client.upload_file(
                str(local_path),
                R2_BUCKET,
                r2_key,
                ExtraArgs={'ContentType': f'image/{local_path.suffix.lstrip(".")}'}
            )
            return True
        except Exception as e:
            self.log(f"R2 upload failed: {e}")
            return False
    
    def process_book(self, page_range=None):
        """Process book and extract images."""
        self.log(f"Starting extraction for {self.book_slug}")
        
        book_type = self.book_meta.get('type', 'pdf')
        
        if book_type == 'custom':
            self.log("Custom content book - skipping PDF extraction")
            self.log("Images should already be in content/<slug>/images/")
            return True
        elif book_type == 'pdf':
            doc = self.open_source()
            if doc:
                extracted = self.extract_from_pdf(doc, page_range)
                doc.close()
            else:
                self.log("Cannot process PDF without PyMuPDF")
                return False
        elif book_type == 'epub':
            extracted = self.extract_from_epub(page_range)
        else:
            self.log(f"Unsupported book type: {book_type}")
            return False
        
        self.log(f"Extracted {len(extracted)} images")
        return True
    
    def generate_report(self):
        """Generate processing report."""
        report = {
            'book_slug': self.book_slug,
            'book_title': self.book_meta.get('title', ''),
            'pages_processed': self.pages_processed,
            'images_extracted': self.images_extracted,
            'tables_extracted': self.tables_extracted,
            'figures_extracted': self.figures_extracted,
            'output_dir': str(self.images_dir),
            'timestamp': datetime.now().isoformat(),
            'status': 'completed',
            'dry_run': self.dry_run,
            'errors': self.errors
        }
        
        # Save report
        REPORT_DIR.mkdir(exist_ok=True)
        report_path = REPORT_DIR / f'{self.book_slug}_images.json'
        with open(report_path, 'w') as f:
            json.dump(report, f, indent=2)
        
        self.log(f"Report saved to {report_path}")
        return report


def main():
    parser = argparse.ArgumentParser(description='Extract images from book pages')
    parser.add_argument('--book', action='append', help='Book slug to process')
    parser.add_argument('--all', action='store_true', help='Process all books')
    parser.add_argument('--ncert', action='store_true', help='Process NCERT books')
    parser.add_argument('--pages', help='Page range (e.g., 1-50)')
    parser.add_argument('--dry-run', action='store_true', help='Dry run without R2 upload')
    
    args = parser.parse_args()
    
    # Check dependencies
    if not HAS_PYMUPDF:
        print("ERROR: PyMuPDF not installed. Run: pip install pymupdf")
        sys.exit(1)
    
    if not HAS_PILLOW:
        print("ERROR: Pillow not installed. Run: pip install pillow")
        sys.exit(1)
    
    # Determine which books to process
    if args.all:
        books = list(BOOKS.keys())
    elif args.ncert:
        books = list(NCERT_BOOKS.keys())
    elif args.book:
        books = args.book
    else:
        parser.print_help()
        sys.exit(1)
    
    # Process each book
    reports = []
    for book_slug in books:
        try:
            extractor = ImageExtractor(book_slug, dry_run=args.dry_run)
            success = extractor.process_book(page_range=args.pages)
            
            if success:
                report = extractor.generate_report()
                reports.append(report)
                print(f"\n[OK] {book_slug}: {report['images_extracted']} images extracted")
            else:
                print(f"\n[FAIL] {book_slug}: Failed")
        except Exception as e:
            print(f"\n[FAIL] {book_slug}: Error - {e}")
    
    # Summary
    if reports:
        print("\n" + "="*60)
        print("EXTRACTION SUMMARY")
        print("="*60)
        for r in reports:
            print(f"{r['book_slug']:40s} {r['images_extracted']:5d} images")
        print("="*60)
        print(f"Total: {sum(r['images_extracted'] for r in reports)} images extracted")


if __name__ == '__main__':
    main()
