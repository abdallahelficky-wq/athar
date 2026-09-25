#!/usr/bin/env python3
"""Generate Android adaptive launcher icon (foreground/background/monochrome per
density) plus legacy fallback icons, from assets/brand/athar-logo-square.png.

The source file is the FULL logo (mark + Arabic/English wordmark) on a flat
cream background, 1254x1254, no alpha. This script:
  1. Crops out just the graphic mark (the wordmark would be illegible at
     launcher-icon sizes and would get clipped by adaptive-icon masks anyway).
  2. Makes the crop's background transparent (soft edge, color-distance based).
  3. Saves a reusable master (assets/brand/generated/athar-mark-transparent.png).
  4. Renders adaptive-icon foreground/background/monochrome layers at all five
     density buckets, sized/centered so the mark sits inside the 66dp safe zone
     of the 108dp adaptive-icon canvas (i.e. never clipped by any launcher mask
     shape).
  5. Renders legacy (API<26 fallback) ic_launcher.png (square) and
     ic_launcher_round.png (circle-masked) at all five density buckets, by
     flattening the same background+foreground composite.
"""
from pathlib import Path

from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parents[2]
SRC = REPO / "assets/brand/athar-logo-square.png"
MASTER_OUT = REPO / "assets/brand/generated/athar-mark-transparent.png"
RES = REPO / "android/app/src/main/res"

# لون خلفية الشعار المصدر نفسه (كريمي فاتح) — نفس الخلفية المستخدَمة في أيقونات الويب (favicon/PWA)
BG_COLOR = (250, 249, 247, 255)

# حدود الرمز (بلا النص) داخل الصورة المصدر 1254x1254 — محسوبة برمجياً (راجع سجل الجلسة): أول/آخر
# صف فيه محتوى غير الخلفية قبل أكبر فجوة أفقية تفصل الرمز عن النص أسفله.
MARK_BOX = (441, 190, 830, 801)  # (left, top, right, bottom), نصف-مفتوح
MARK_MARGIN = 12  # هامش صغير حول الحدود المحسوبة لتفادي قصّ حواف مضادة للتعرّج (anti-aliasing)

# نصف قطر الحدّ الأدنى (المنطقة الآمنة) لأي أيقونة تكيّفية أندرويد: دائرة قطرها 66dp داخل لوحة
# 108dp — أي محتوى داخلها لا يُقصّ بأي قناع (دائرة/مربّع مدوّر/قطرة...) يستخدمه أي مُطلِق شاشة.
SAFE_ZONE_FRACTION = 66 / 108

DENSITIES_ADAPTIVE = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
DENSITIES_LEGACY = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}

SUPER = 4  # عامل تكبير أثناء الرسم قبل التصغير للحجم النهائي (لحواف أنعم من أي رسم مباشر بحجم صغير)


def build_transparent_mark() -> Image.Image:
    """يقصّ الرمز من الصورة المصدر ويجعل خلفيته شفّافة (حافة ناعمة، لا حادة)."""
    img = Image.open(SRC).convert("RGB")
    left, top, right, bottom = MARK_BOX
    left = max(0, left - MARK_MARGIN)
    top = max(0, top - MARK_MARGIN)
    right = min(img.width, right + MARK_MARGIN)
    bottom = min(img.height, bottom + MARK_MARGIN)
    crop = img.crop((left, top, right, bottom))

    rgba = crop.convert("RGBA")
    pixels = rgba.load()
    bg = BG_COLOR[:3]
    LOW, HIGH = 12, 40  # عتبة لومينانس-مسافة لتحويل تدريجي (حافة ناعمة) بدل قصّ حادّ
    for y in range(rgba.height):
        for x in range(rgba.width):
            r, g, b, a = pixels[x, y]
            dist = abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2])
            if dist <= LOW:
                alpha = 0
            elif dist >= HIGH:
                alpha = 255
            else:
                alpha = int((dist - LOW) / (HIGH - LOW) * 255)
            pixels[x, y] = (r, g, b, alpha)
    return rgba


def paste_centered_scaled(canvas: Image.Image, art: Image.Image, safe_px: float):
    """يُلصِق art في وسط canvas، مُصغَّراً حتى يبقى بُعده الأكبر مساوياً safe_px بالضبط."""
    scale = safe_px / max(art.width, art.height)
    new_size = (max(1, round(art.width * scale)), max(1, round(art.height * scale)))
    resized = art.resize(new_size, Image.LANCZOS)
    x = (canvas.width - resized.width) // 2
    y = (canvas.height - resized.height) // 2
    canvas.alpha_composite(resized, (x, y))


def make_foreground(mark: Image.Image, canvas_px: int) -> Image.Image:
    super_px = canvas_px * SUPER
    canvas = Image.new("RGBA", (super_px, super_px), (0, 0, 0, 0))
    safe_px = super_px * SAFE_ZONE_FRACTION
    paste_centered_scaled(canvas, mark, safe_px)
    return canvas.resize((canvas_px, canvas_px), Image.LANCZOS)


def make_background(canvas_px: int) -> Image.Image:
    return Image.new("RGBA", (canvas_px, canvas_px), BG_COLOR)


def make_monochrome(mark: Image.Image, canvas_px: int) -> Image.Image:
    """طبقة أحادية اللون لأيقونات أندرويد 13+ المُموضَعة (Themed icons) — نفس شكل/ألفا الرمز
    (بما فيها الفجوة الداخلية الفعلية في التصميم)، مملوءة بلون واحد فقط؛ النظام يُلوِّنها لاحقاً."""
    silhouette = Image.new("RGBA", mark.size, (0, 0, 0, 0))
    alpha = mark.getchannel("A")
    black = Image.new("RGBA", mark.size, (0, 0, 0, 255))
    silhouette.paste(black, (0, 0), alpha)
    super_px = canvas_px * SUPER
    canvas = Image.new("RGBA", (super_px, super_px), (0, 0, 0, 0))
    safe_px = super_px * SAFE_ZONE_FRACTION
    paste_centered_scaled(canvas, silhouette, safe_px)
    return canvas.resize((canvas_px, canvas_px), Image.LANCZOS)


def make_legacy(mark: Image.Image, canvas_px: int, round_mask: bool) -> Image.Image:
    """أيقونة الاحتياط القديمة (ما قبل أندرويد 8) — دمج خلفية+مقدّمة مسطّح، بلا شفافية طبقات."""
    super_px = canvas_px * SUPER
    canvas = Image.new("RGBA", (super_px, super_px), BG_COLOR)
    safe_px = super_px * SAFE_ZONE_FRACTION
    paste_centered_scaled(canvas, mark, safe_px)
    flat = canvas.resize((canvas_px, canvas_px), Image.LANCZOS)
    if round_mask:
        mask = Image.new("L", (canvas_px, canvas_px), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, canvas_px - 1, canvas_px - 1), fill=255)
        flat.putalpha(mask)
    return flat


def main():
    mark = build_transparent_mark()
    MASTER_OUT.parent.mkdir(parents=True, exist_ok=True)
    # نسخة رئيسية مربّعة كبيرة (1024) بهامش آمن، للاستخدام أو المراجعة المستقبلية
    master_canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    paste_centered_scaled(master_canvas, mark, 1024 * SAFE_ZONE_FRACTION)
    master_canvas.save(MASTER_OUT)
    print(f"wrote {MASTER_OUT} ({master_canvas.size})")

    for density, px in DENSITIES_ADAPTIVE.items():
        d = RES / f"mipmap-{density}"
        d.mkdir(parents=True, exist_ok=True)
        make_foreground(mark, px).save(d / "ic_launcher_foreground.png")
        make_background(px).save(d / "ic_launcher_background.png")
        make_monochrome(mark, px).save(d / "ic_launcher_monochrome.png")
        print(f"wrote mipmap-{density} adaptive layers @ {px}px")

    for density, px in DENSITIES_LEGACY.items():
        d = RES / f"mipmap-{density}"
        d.mkdir(parents=True, exist_ok=True)
        make_legacy(mark, px, round_mask=False).save(d / "ic_launcher.png")
        make_legacy(mark, px, round_mask=True).save(d / "ic_launcher_round.png")
        print(f"wrote mipmap-{density} legacy icons @ {px}px")


if __name__ == "__main__":
    main()
