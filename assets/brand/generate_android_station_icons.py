#!/usr/bin/env python3
"""Generate the launcher icon of the station worker app (android-station/), from the same
Athar mark master as the POS app (assets/brand/generated/athar-mark-transparent.png, produced by
generate_android_icons.py — this script never touches the POS app's resources).

How it differs from the POS icon, so a worker can tell the two apart on a home screen:
  - Inverted palette: the POS icon is the navy+copper mark on a light cream background; this one
    puts the mark on a solid brand-navy background, with the mark's navy parts recoloured cream
    (copper kept), so the silhouette stays identical but the tile reads dark instead of light.
  - A fuel-pump badge (cream pump on a copper disc) at the lower-right of the safe zone.

Outputs (all under android-station/app/src/main/res):
  - adaptive foreground/background/monochrome layers per density (mipmap-*/ic_launcher_*.png)
  - legacy (API<26) ic_launcher.png / ic_launcher_round.png per density
With --preview PATH it instead renders a comparison sheet (POS vs station, circle + squircle
masks, at launcher sizes) and writes nothing else.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parents[2]
MARK = REPO / "assets/brand/generated/athar-mark-transparent.png"
RES = REPO / "android-station/app/src/main/res"
POS_RES = REPO / "android/app/src/main/res"

NAVY = (28, 32, 62, 255)       # قريب من كحلي الرمز نفسه — خلفية الأيقونة
CREAM = (250, 249, 247, 255)   # نفس كريمي خلفية أيقونة نقطة البيع — لون أجزاء الرمز الكحلية هنا
COPPER = (196, 98, 40, 255)    # قريب من نحاسي الرمز — قرص شارة المضخة

SAFE_ZONE_FRACTION = 66 / 108
MARK_FRACTION = 0.90           # الرمز أصغر قليلاً من المنطقة الآمنة ليتّسع للشارة دون تداخل مزعج
DENSITIES_ADAPTIVE = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
DENSITIES_LEGACY = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
SUPER = 4


def recolor_mark(mark: Image.Image) -> Image.Image:
    """أجزاء الرمز الداكنة (الكحلية) تصبح كريمية، والنحاسية تبقى كما هي — نفس الشكل والألفا تماماً."""
    out = mark.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            # داكن = مجموع قنوات منخفض؛ النحاسي أحمره مرتفع بوضوح
            if r < 110 and g < 110:
                px[x, y] = (CREAM[0], CREAM[1], CREAM[2], a)
    return out


def draw_pump(draw: ImageDraw.ImageDraw, cx: float, cy: float, size: float, color, window_color=COPPER):
    """مضخة وقود مبسّطة (جسم + نافذة + خرطوم + فوهة) داخل مربع ضلعه size حول (cx, cy)."""
    s = size
    x0, y0 = cx - s * 0.42, cy - s * 0.42
    body = (x0, y0, x0 + s * 0.52, y0 + s * 0.86)
    draw.rounded_rectangle(body, radius=s * 0.07, fill=color)
    win = (x0 + s * 0.09, y0 + s * 0.10, x0 + s * 0.43, y0 + s * 0.34)
    draw.rounded_rectangle(win, radius=s * 0.03, fill=window_color)
    base = (x0 - s * 0.06, y0 + s * 0.80, x0 + s * 0.58, y0 + s * 0.90)
    draw.rounded_rectangle(base, radius=s * 0.03, fill=color)
    w = max(1, round(s * 0.07))
    hx = x0 + s * 0.52
    draw.line([(hx, y0 + s * 0.22), (hx + s * 0.20, y0 + s * 0.22), (hx + s * 0.20, y0 + s * 0.62),
               (hx + s * 0.08, y0 + s * 0.62)], fill=color, width=w, joint="curve")
    draw.rounded_rectangle((hx + s * 0.14, y0 + s * 0.10, hx + s * 0.28, y0 + s * 0.26), radius=s * 0.03, fill=color)


def paste_centered(canvas: Image.Image, art: Image.Image, box_px: float, dx: float = 0, dy: float = 0):
    scale = box_px / max(art.width, art.height)
    resized = art.resize((max(1, round(art.width * scale)), max(1, round(art.height * scale))), Image.LANCZOS)
    x = round((canvas.width - resized.width) / 2 + dx)
    y = round((canvas.height - resized.height) / 2 + dy)
    canvas.alpha_composite(resized, (x, y))


def badge_geometry(px: int):
    """قرص الشارة أسفل-يمين الرمز، محصور بالكامل (مع حافته) داخل دائرة المنطقة الآمنة 66dp:
    بُعد المركز عن الوسط + نصف قطر الحافة <= نصف قطر المنطقة الآمنة، فلا يُقصّ بأي قناع."""
    safe = px * SAFE_ZONE_FRACTION
    r = safe * 0.155
    offset = safe * 0.225  # لكل محور ← بُعد قُطري ≈ 0.318 × safe؛ + حافة 1.12r ≈ 0.174 × safe = 0.492 < 0.5
    return px / 2 + offset, px / 2 + offset, r


def make_foreground(mark: Image.Image, px: int, with_badge: bool = True, mono: bool = False) -> Image.Image:
    sp = px * SUPER
    canvas = Image.new("RGBA", (sp, sp), (0, 0, 0, 0))
    safe = sp * SAFE_ZONE_FRACTION
    art = mark
    if mono:
        art = Image.new("RGBA", mark.size, (0, 0, 0, 0))
        art.paste(Image.new("RGBA", mark.size, (0, 0, 0, 255)), (0, 0), mark.getchannel("A"))
    paste_centered(canvas, art, safe * MARK_FRACTION, dx=-safe * 0.04, dy=-safe * 0.04)
    if with_badge:
        d = ImageDraw.Draw(canvas)
        cx, cy, r = badge_geometry(sp)
        if mono:
            # الطبقة الأحادية: قرص مصمت مع مضخة مفرّغة (شفّافة) — النظام يلوّن الباقي
            d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(0, 0, 0, 255))
            hole = Image.new("L", (sp, sp), 0)
            draw_pump(ImageDraw.Draw(hole), cx, cy, r * 1.25, 255, window_color=0)  # النافذة تبقى مصمتة داخل المضخة المفرّغة
            a = canvas.getchannel("A")
            a.paste(0, (0, 0), hole)
            canvas.putalpha(a)
        else:
            ring = r * 1.12
            d.ellipse((cx - ring, cy - ring, cx + ring, cy + ring), fill=NAVY)  # حافة تفصل الشارة عن الرمز
            d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=COPPER)
            draw_pump(d, cx, cy, r * 1.25, CREAM)
    return canvas.resize((px, px), Image.LANCZOS)


def make_background(px: int) -> Image.Image:
    return Image.new("RGBA", (px, px), NAVY)


def flatten(fg: Image.Image, bg_color, px: int, shape: str | None) -> Image.Image:
    tile = Image.new("RGBA", (px, px), bg_color)
    tile.alpha_composite(fg.resize((px, px), Image.LANCZOS))
    if shape:
        mask = Image.new("L", (px * SUPER, px * SUPER), 0)
        md = ImageDraw.Draw(mask)
        if shape == "circle":
            md.ellipse((0, 0, px * SUPER - 1, px * SUPER - 1), fill=255)
        else:
            md.rounded_rectangle((0, 0, px * SUPER - 1, px * SUPER - 1), radius=px * SUPER * 0.23, fill=255)
        tile.putalpha(mask.resize((px, px), Image.LANCZOS))
    return tile


def write_resources(mark: Image.Image):
    for dens, px in DENSITIES_ADAPTIVE.items():
        d = RES / f"mipmap-{dens}"
        d.mkdir(parents=True, exist_ok=True)
        make_foreground(mark, px).save(d / "ic_launcher_foreground.png")
        make_background(px).save(d / "ic_launcher_background.png")
        make_foreground(MARK_IMG, px, mono=True).save(d / "ic_launcher_monochrome.png")
    for dens, px in DENSITIES_LEGACY.items():
        d = RES / f"mipmap-{dens}"
        # الاحتياط القديم: يُقصّ نفس لوحة 108dp إلى 72dp المرئية كما يفعل النظام مع التكيّفية
        full = make_foreground(mark, round(px * 108 / 72))
        off = (full.width - px) // 2
        fg = full.crop((off, off, off + px, off + px))
        flatten(fg, NAVY, px, None).save(d / "ic_launcher.png")
        flatten(fg, NAVY, px, "circle").save(d / "ic_launcher_round.png")


def preview(path: Path, station_mark: Image.Image):
    """ورقة مقارنة: صفّ لكل حجم عرض، وأعمدة POS/محطة بقناعَي دائرة ومربّع مدوّر، على خلفية شاشة رئيسية."""
    pos_fg = Image.open(POS_RES / "mipmap-xxxhdpi/ic_launcher_foreground.png").convert("RGBA")
    pos_bg = Image.open(POS_RES / "mipmap-xxxhdpi/ic_launcher_background.png").convert("RGBA").getpixel((0, 0))
    variants = [
        ("POS (current)", pos_fg, pos_bg),
        ("Station A: inverted only", make_foreground(station_mark, 432, with_badge=False), NAVY),
        ("Station B: inverted + pump badge", make_foreground(station_mark, 432), NAVY),
    ]
    sizes = [192, 96, 48]
    pad, label_h = 24, 28
    col_w = 2 * (192 + pad) + pad
    sheet = Image.new("RGBA", (pad + len(variants) * col_w, label_h + len(sizes) * (192 + pad) + pad), (96, 110, 130, 255))
    d = ImageDraw.Draw(sheet)
    for ci, (label, fg, bg) in enumerate(variants):
        x0 = pad + ci * col_w
        d.text((x0, 8), label, fill=(255, 255, 255, 255))
        for ri, s in enumerate(sizes):
            y = label_h + ri * (192 + pad)
            # يُقصّ 72/108 المرئي من اللوحة التكيّفية كما يفعل المُطلِق
            full = fg.resize((round(s * 108 / 72),) * 2, Image.LANCZOS)
            off = (full.width - s) // 2
            vis = full.crop((off, off, off + s, off + s))
            sheet.alpha_composite(flatten(vis, bg, s, "circle"), (x0, y))
            sheet.alpha_composite(flatten(vis, bg, s, "squircle"), (x0 + 192 + pad, y))
    sheet.save(path)


# الرمز الرئيسي مربّع 1024 بحشوة شفّافة حوله — يُقصّ إلى حدوده الفعلية أولاً حتى يُقاس الرمز نفسه
# (لا الحشوة) مقابل المنطقة الآمنة، وإلا ظهر أصغر بكثير من رمز أيقونة نقطة البيع.
_raw = Image.open(MARK).convert("RGBA")
MARK_IMG = _raw.crop(_raw.getchannel("A").getbbox())

if __name__ == "__main__":
    station = recolor_mark(MARK_IMG)
    if len(sys.argv) == 3 and sys.argv[1] == "--preview":
        preview(Path(sys.argv[2]), station)
    else:
        write_resources(station)
