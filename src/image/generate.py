#!/usr/bin/env python3
"""
Tech Post Image Generator
Generates 1080x1080 Instagram images matching the reference style:
- Dark/black background
- Large bold white + electric blue text
- Brand watermark (NVHOTECH) top right
- Slide number top right
- Factual tech headline
- Subtext paragraph
- "SWIPE FOR MORE" on cover slide

Usage:
  python3 generate.py --title "FEATURES APPLE REMOVED" --subtitle "The headphone jack was removed in 2016..." --brand NVHOTECH --slide 1 --total 5 --output /tmp/slide1.jpg
  python3 generate.py --json '{"title":"...","subtitle":"..."}' --output /tmp/out.jpg
"""

import sys
import os
import json
import argparse
import textwrap
from PIL import Image, ImageDraw, ImageFont, ImageFilter

# ── Colors (matching reference) ───────────────────────────────
BG_COLOR       = (8, 8, 12)          # near-black
ACCENT_BLUE    = (30, 144, 255)       # electric blue
WHITE          = (255, 255, 255)
LIGHT_GRAY     = (200, 205, 218)  # brighter for body/subtitle on dark bg
SUBTITLE_BAND  = (14, 14, 22)     # panel behind subtitle for contrast
DARK_OVERLAY   = (0, 0, 0, 180)
BRAND_COLOR    = (255, 255, 255)

SIZE = (1080, 1080)


def get_font(size, bold=False):
    """Try to load a system font. Falls back to default if not found."""
    bold_candidates = [
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/Library/Fonts/Arial Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/truetype/ubuntu/Ubuntu-B.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
    ]
    regular_candidates = [
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/Library/Fonts/Arial.ttf",
        "/usr/share/fonts/truetype/ubuntu/Ubuntu-R.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
    ]
    candidates = bold_candidates if bold else regular_candidates
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except:
                pass
    # PIL default (no styling, last resort)
    return ImageFont.load_default()


def draw_text_wrapped(draw, text, x, y, max_width, font, fill, line_spacing=1.15, y_max=None,
                      stroke_width=0, stroke_fill=None):
    """Draw wrapped text; optional stroke for legibility. Returns final y."""
    words = text.split()
    lines = []
    current = ""
    for word in words:
        test = (current + " " + word).strip()
        bbox = draw.textbbox((0, 0), test, font=font)
        if bbox[2] - bbox[0] <= max_width:
            current = test
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)

    kw = {}
    if stroke_width:
        kw["stroke_width"] = stroke_width
        kw["stroke_fill"] = stroke_fill or (0, 0, 0)

    cur_y = y
    for line in lines:
        if y_max is not None and cur_y > y_max:
            break
        draw.text((x, cur_y), line, font=font, fill=fill, **kw)
        bbox = draw.textbbox((0, 0), line, font=font)
        line_h = bbox[3] - bbox[1]
        cur_y += int(line_h * line_spacing)

    return cur_y


def draw_gradient_bg(img):
    """Draw a dark gradient background with subtle vignette."""
    draw = ImageDraw.Draw(img)
    # Base dark fill
    draw.rectangle([0, 0, SIZE[0], SIZE[1]], fill=BG_COLOR)

    # Subtle blue glow in bottom-left corner
    overlay = Image.new('RGBA', SIZE, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for r in range(400, 0, -20):
        alpha = int(15 * (1 - r / 400))
        od.ellipse([-r//2, SIZE[1] - r//2, r, SIZE[1] + r//2],
                   fill=(30, 80, 200, alpha))
    img.paste(Image.alpha_composite(img.convert('RGBA'), overlay).convert('RGB'))

    return img


def draw_top_bar(draw, brand, slide_num, total_slides):
    """Draw top brand bar and slide number."""
    # Top separator line
    draw.rectangle([60, 72, SIZE[0] - 60, 74], fill=ACCENT_BLUE)

    # Brand name (left)
    brand_font = get_font(28, bold=True)
    draw.text((60, 85), brand.upper(), font=brand_font, fill=BRAND_COLOR)

    # Slide number (right)
    if total_slides and total_slides > 1:
        slide_font = get_font(28, bold=True)
        slide_text = f"{slide_num}/{total_slides}"
        bbox = draw.textbbox((0, 0), slide_text, font=slide_font)
        w = bbox[2] - bbox[0]
        draw.text((SIZE[0] - 60 - w, 85), slide_text, font=slide_font, fill=LIGHT_GRAY)


def draw_bottom_bar(draw, is_cover=False):
    """Draw bottom divider + swipe prompt on cover."""
    draw.rectangle([60, SIZE[1] - 74, SIZE[0] - 60, SIZE[1] - 72], fill=ACCENT_BLUE)

    if is_cover:
        swipe_font = get_font(26, bold=True)
        swipe_text = "SWIPE FOR MORE ▶"
        bbox = draw.textbbox((0, 0), swipe_text, font=swipe_font)
        w = bbox[2] - bbox[0]
        draw.text(((SIZE[0] - w) // 2, SIZE[1] - 60), swipe_text, font=swipe_font, fill=LIGHT_GRAY)


def generate_cover_slide(title, subtitle, brand="NVHOTECH", slide_num=1, total_slides=1, topic_label="TECHNOLOGY"):
    """
    Cover slide: large title split into white/blue words, subtitle below.
    Typography tuned for small-screen readability (stroke + contrast).
    """
    img = Image.new('RGB', SIZE, BG_COLOR)
    img = draw_gradient_bg(img)
    draw = ImageDraw.Draw(img)

    draw_top_bar(draw, brand, slide_num, total_slides)

    # Topic label (center, small caps)
    topic_font = get_font(30, bold=True)
    topic_text = f"— {topic_label} —"
    topic_bbox = draw.textbbox((0, 0), topic_text, font=topic_font)
    tw = topic_bbox[2] - topic_bbox[0]
    tx = (SIZE[0] - tw) // 2
    draw.text((tx, 160), topic_text, font=topic_font, fill=ACCENT_BLUE,
              stroke_width=1, stroke_fill=(0, 0, 0))

    words = title.upper().split()
    # Keep headline from overflowing: cap words, pick font size that fits above subtitle band
    if len(words) > 14:
        words = words[:14] + ["…"]

    CONTENT_FLOOR = SIZE[1] - 195  # room for subtitle + bottom bar
    lines = []
    title_font = None
    for title_size in (100, 88, 76, 66, 58):
        title_font = get_font(title_size, bold=True)
        lines = []
        line = []
        for i, word in enumerate(words):
            line.append(word)
            if len(line) >= 3 or i == len(words) - 1:
                lines.append(" ".join(line))
                line = []
        if len(lines) > 6:
            lines = lines[:6]
        h = 0
        for lt in lines:
            bb = draw.textbbox((0, 0), lt, font=title_font)
            h += (bb[3] - bb[1]) + 14
        if 220 + h < CONTENT_FLOOR - 100:
            break

    start_y = 220
    for i, line_text in enumerate(lines):
        color = WHITE if i % 2 == 0 else ACCENT_BLUE
        stroke_fill = (0, 8, 20) if color == WHITE else (0, 20, 40)
        bbox = draw.textbbox((0, 0), line_text, font=title_font)
        lw = bbox[2] - bbox[0]
        lh = bbox[3] - bbox[1]
        draw.text(
            ((SIZE[0] - lw) // 2, start_y),
            line_text,
            font=title_font,
            fill=color,
            stroke_width=3,
            stroke_fill=stroke_fill,
        )
        start_y += lh + 14

    rule_y = start_y + 18
    draw.rectangle([60, rule_y, SIZE[0] - 60, rule_y + 3], fill=ACCENT_BLUE)

    # Dark band behind subtitle so gray/white body text stays readable
    band_top = rule_y + 14
    band_bottom = SIZE[1] - 82
    draw.rectangle([48, band_top, SIZE[0] - 48, band_bottom], fill=SUBTITLE_BAND)

    sub_font = get_font(40, bold=True)
    draw_text_wrapped(
        draw,
        subtitle,
        68,
        band_top + 16,
        SIZE[0] - 136,
        sub_font,
        fill=LIGHT_GRAY,
        line_spacing=1.35,
        y_max=band_bottom - 8,
        stroke_width=2,
        stroke_fill=(0, 0, 0),
    )

    draw_bottom_bar(draw, is_cover=True)
    return img


def generate_fact_slide(headline, body_text, brand="NVHOTECH", slide_num=2, total_slides=5, year_label=None):
    """
    Fact slide: year/category label top-center, large keyword, body text.
    Matches style: "THE HEADPHONE JACK" with body paragraph below.
    """
    img = Image.new('RGB', SIZE, BG_COLOR)
    img = draw_gradient_bg(img)
    draw = ImageDraw.Draw(img)

    draw_top_bar(draw, brand, slide_num, total_slides)

    y = 160

    # Year/category label
    if year_label:
        label_font = get_font(36, bold=True)
        label_bbox = draw.textbbox((0, 0), year_label.upper(), font=label_font)
        lw = label_bbox[2] - label_bbox[0]
        draw.text(
            ((SIZE[0] - lw) // 2, y),
            year_label.upper(),
            font=label_font,
            fill=LIGHT_GRAY,
            stroke_width=2,
            stroke_fill=(0, 0, 0),
        )
        y += 60

    # THE prefix in white (small)
    prefix_font = get_font(64, bold=True)
    prefix_words = headline.upper().split()

    if len(prefix_words) >= 2 and prefix_words[0] in ("THE", "HOW", "WHY", "WHEN"):
        prefix = prefix_words[0]
        main_kw = " ".join(prefix_words[1:])
        prefix_bbox = draw.textbbox((0, 0), prefix, font=prefix_font)
        pw = prefix_bbox[2] - prefix_bbox[0]
        draw.text(
            ((SIZE[0] - pw) // 2, y),
            prefix,
            font=prefix_font,
            fill=WHITE,
            stroke_width=2,
            stroke_fill=(0, 8, 20),
        )
        y += (prefix_bbox[3] - prefix_bbox[1]) + 8
    else:
        main_kw = headline.upper()

    # Main keyword — very large, electric blue
    kw_font = get_font(110, bold=True)
    kw_words = main_kw.split()
    kw_lines = []
    kline = []
    for w in kw_words:
        kline.append(w)
        if len(kline) >= 2:
            kw_lines.append(" ".join(kline))
            kline = []
    if kline:
        kw_lines.append(" ".join(kline))

    for kl in kw_lines:
        bbox = draw.textbbox((0, 0), kl, font=kw_font)
        lw = bbox[2] - bbox[0]
        lh = bbox[3] - bbox[1]
        draw.text(
            ((SIZE[0] - lw) // 2, y),
            kl,
            font=kw_font,
            fill=ACCENT_BLUE,
            stroke_width=3,
            stroke_fill=(0, 20, 45),
        )
        y += lh + 6

    # Divider
    y += 20
    draw.rectangle([60, y, SIZE[0] - 60, y + 2], fill=ACCENT_BLUE)
    y += 24

    # Body text — white, centered, stroked for small-screen readability
    body_font = get_font(34, bold=True)
    draw_text_wrapped(
        draw,
        body_text.upper(),
        60,
        y,
        SIZE[0] - 120,
        body_font,
        fill=WHITE,
        line_spacing=1.5,
        y_max=SIZE[1] - 88,
        stroke_width=2,
        stroke_fill=(0, 0, 0),
    )

    draw_bottom_bar(draw)
    return img


def generate_cta_slide(brand='NVHOTECH', handle='nvhotech', tagline='DAILY TECH UPDATES', slide_num=5, total_slides=5):
    """
    Slide 5: Follow CTA — bold call-to-action to follow the page.
    Dark bg, large @ handle, tagline, animated-feel blue ring accent.
    """
    img = Image.new('RGB', SIZE, BG_COLOR)
    img = draw_gradient_bg(img)
    draw = ImageDraw.Draw(img)

    draw_top_bar(draw, brand, slide_num, total_slides)

    # ── Blue decorative ring behind the handle ────────────────
    cx, cy = SIZE[0] // 2, SIZE[1] // 2 - 40
    for r, alpha_val in [(320, 18), (280, 30), (240, 50), (200, 25)]:
        ring_overlay = Image.new('RGBA', SIZE, (0, 0, 0, 0))
        rd = ImageDraw.Draw(ring_overlay)
        rd.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(30, 144, 255, alpha_val), width=6)
        img = Image.alpha_composite(img.convert('RGBA'), ring_overlay).convert('RGB')
        draw = ImageDraw.Draw(img)

    # ── "FOLLOW FOR MORE" top label ───────────────────────────
    label_font = get_font(34, bold=True)
    label_text = 'FOLLOW FOR MORE'
    lb = draw.textbbox((0, 0), label_text, font=label_font)
    lw = lb[2] - lb[0]
    draw.text(((SIZE[0] - lw) // 2, 190), label_text, font=label_font, fill=LIGHT_GRAY,
              stroke_width=1, stroke_fill=(0, 0, 0))

    # ── @ handle — very large, electric blue ─────────────────
    handle_font = get_font(110, bold=True)
    handle_text = f'@{handle}'
    hb = draw.textbbox((0, 0), handle_text, font=handle_font)
    hw = hb[2] - hb[0]
    hh = hb[3] - hb[1]
    hy = cy - hh // 2
    draw.text(((SIZE[0] - hw) // 2, hy), handle_text, font=handle_font,
              fill=ACCENT_BLUE, stroke_width=4, stroke_fill=(0, 20, 45))

    # ── Divider ───────────────────────────────────────────────
    div_y = hy + hh + 28
    draw.rectangle([120, div_y, SIZE[0] - 120, div_y + 3], fill=ACCENT_BLUE)

    # ── Tagline ───────────────────────────────────────────────
    tag_font = get_font(40, bold=True)
    tag_text = tagline.upper()
    tb = draw.textbbox((0, 0), tag_text, font=tag_font)
    tw = tb[2] - tb[0]
    draw.text(((SIZE[0] - tw) // 2, div_y + 22), tag_text, font=tag_font, fill=WHITE,
              stroke_width=2, stroke_fill=(0, 0, 0))

    # ── "Turn on post notifications 🔔" small line ────────────
    notif_font = get_font(28, bold=False)
    notif_text = 'Turn on post notifications \U0001f514'
    nb = draw.textbbox((0, 0), notif_text, font=notif_font)
    nw = nb[2] - nb[0]
    draw.text(((SIZE[0] - nw) // 2, div_y + 90), notif_text, font=notif_font, fill=LIGHT_GRAY)

    draw_bottom_bar(draw, is_cover=False)
    return img


def generate_hybrid_slide(
    bg_image_path,
    title,
    subtitle='',
    brand='NVHOTECH',
    slide_num=1,
    total_slides=1,
    topic_label='TECHNOLOGY',
):
    """
    Hybrid slide: AI-generated photo fills top ~55%, bold text panel bottom ~45%.
    Exactly matches the reference style (iPhone home button slide, etc.)

    bg_image_path: path to DALL-E/Imagen generated background (any size, will be cropped to 1080x1080)
    title: main headline — e.g. "THE HOME BUTTON"
    subtitle: body fact text shown below divider
    """
    # ── Step 1: Load + crop background to 1080×1080 ──────────────
    try:
        bg = Image.open(bg_image_path).convert('RGB')
    except Exception:
        # Fallback: solid dark bg if image load fails
        bg = Image.new('RGB', SIZE, BG_COLOR)

    # Smart crop: centre-crop to square, then resize
    bw, bh = bg.size
    crop_size = min(bw, bh)
    left = (bw - crop_size) // 2
    top = (bh - crop_size) // 2
    bg = bg.crop((left, top, left + crop_size, top + crop_size))
    bg = bg.resize(SIZE, Image.LANCZOS)

    # ── Step 2: Dark gradient overlay on bottom 50% ──────────────
    # Creates the smooth photo→dark-panel transition seen in the reference
    overlay = Image.new('RGBA', SIZE, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)

    TEXT_PANEL_TOP = int(SIZE[1] * 0.48)   # where text area starts
    GRADIENT_START = int(SIZE[1] * 0.35)   # where fade begins

    # Gradient band: transparent → semi-dark
    steps = TEXT_PANEL_TOP - GRADIENT_START
    for i in range(steps):
        alpha = int(180 * (i / steps))
        y_pos = GRADIENT_START + i
        od.rectangle([0, y_pos, SIZE[0], y_pos + 1], fill=(0, 0, 0, alpha))

    # Solid dark panel below TEXT_PANEL_TOP
    od.rectangle([0, TEXT_PANEL_TOP, SIZE[0], SIZE[1]], fill=(8, 8, 12, 245))

    result = Image.alpha_composite(bg.convert('RGBA'), overlay).convert('RGB')
    draw = ImageDraw.Draw(result)

    # ── Step 3: Top bar (brand + slide number) ────────────────────
    draw_top_bar(draw, brand, slide_num, total_slides)

    # ── Step 4: Title text — large, white/blue alternating lines ──
    words = title.upper().split()
    if len(words) > 10:
        words = words[:10]

    # Pick font size that fits the panel width
    title_font = None
    lines = []
    for title_size in (96, 84, 72, 62, 52):
        title_font = get_font(title_size, bold=True)
        lines = []
        line = []
        for i, word in enumerate(words):
            line.append(word)
            if len(line) >= 3 or i == len(words) - 1:
                lines.append(' '.join(line))
                line = []
        # Check all lines fit width
        fits = all(
            (draw.textbbox((0, 0), l, font=title_font)[2] - draw.textbbox((0, 0), l, font=title_font)[0]) < SIZE[0] - 80
            for l in lines
        )
        if fits and len(lines) <= 4:
            break

    # Calculate total title block height
    line_heights = []
    for l in lines:
        bb = draw.textbbox((0, 0), l, font=title_font)
        line_heights.append(bb[3] - bb[1])

    title_block_h = sum(line_heights) + 12 * (len(lines) - 1)
    panel_center = TEXT_PANEL_TOP + int((SIZE[1] - TEXT_PANEL_TOP) * 0.28)
    title_y = panel_center - title_block_h // 2

    for i, line_text in enumerate(lines):
        color = WHITE if i % 2 == 0 else ACCENT_BLUE
        stroke_fill = (0, 8, 20) if color == WHITE else (0, 20, 40)
        bb = draw.textbbox((0, 0), line_text, font=title_font)
        lw = bb[2] - bb[0]
        draw.text(
            ((SIZE[0] - lw) // 2, title_y),
            line_text,
            font=title_font,
            fill=color,
            stroke_width=3,
            stroke_fill=stroke_fill,
        )
        title_y += line_heights[i] + 12

    # ── Step 5: Divider line ──────────────────────────────────────
    divider_y = title_y + 14
    draw.rectangle([60, divider_y, SIZE[0] - 60, divider_y + 3], fill=ACCENT_BLUE)

    # ── Step 6: Subtitle / body text ─────────────────────────────
    if subtitle:
        sub_font = get_font(34, bold=True)
        draw_text_wrapped(
            draw,
            subtitle.upper(),
            60,
            divider_y + 18,
            SIZE[0] - 120,
            sub_font,
            fill=WHITE,
            line_spacing=1.45,
            y_max=SIZE[1] - 82,
            stroke_width=2,
            stroke_fill=(0, 0, 0),
        )

    # ── Step 7: Bottom bar ────────────────────────────────────────
    draw_bottom_bar(draw, is_cover=(slide_num == 1))

    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--json', help='JSON string with all params')
    parser.add_argument('--type', default='cover', choices=['cover', 'fact', 'hybrid', 'cta'])
    parser.add_argument('--bg', default=None, help='Path to AI background image (hybrid mode)')
    parser.add_argument('--title', default='')
    parser.add_argument('--subtitle', default='')
    parser.add_argument('--headline', default='')
    parser.add_argument('--body', default='')
    parser.add_argument('--brand', default='NVHOTECH')
    parser.add_argument('--label', default='TECHNOLOGY')
    parser.add_argument('--year', default=None)
    parser.add_argument('--slide', type=int, default=1)
    parser.add_argument('--total', type=int, default=1)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()

    if args.json:
        data = json.loads(args.json)
        slide_type = data.get('type', 'cover')
        if slide_type == 'cta':
            img = generate_cta_slide(
                brand=data.get('brand', 'NVHOTECH'),
                handle=data.get('handle', 'nvhotech'),
                tagline=data.get('tagline', 'DAILY TECH UPDATES'),
                slide_num=data.get('slide', 5),
                total_slides=data.get('total', 5),
            )
        elif slide_type == 'hybrid':
            img = generate_hybrid_slide(
                bg_image_path=data.get('bg', ''),
                title=data.get('title', ''),
                subtitle=data.get('subtitle', ''),
                brand=data.get('brand', 'NVHOTECH'),
                slide_num=data.get('slide', 1),
                total_slides=data.get('total', 1),
                topic_label=data.get('label', 'TECHNOLOGY'),
            )
        elif slide_type == 'cover':
            img = generate_cover_slide(
                title=data.get('title', ''),
                subtitle=data.get('subtitle', ''),
                brand=data.get('brand', 'NVHOTECH'),
                slide_num=data.get('slide', 1),
                total_slides=data.get('total', 1),
                topic_label=data.get('label', 'TECHNOLOGY'),
            )
        else:
            img = generate_fact_slide(
                headline=data.get('headline', ''),
                body_text=data.get('body', ''),
                brand=data.get('brand', 'NVHOTECH'),
                slide_num=data.get('slide', 2),
                total_slides=data.get('total', 5),
                year_label=data.get('year'),
            )
    else:
        if args.type == 'cta':
            img = generate_cta_slide(
                brand=args.brand,
                handle=getattr(args, 'handle', 'nvhotech'),
                tagline=getattr(args, 'tagline', 'DAILY TECH UPDATES'),
                slide_num=args.slide,
                total_slides=args.total,
            )
        elif args.type == 'hybrid':
            img = generate_hybrid_slide(
                bg_image_path=args.bg or '',
                title=args.title,
                subtitle=args.subtitle,
                brand=args.brand,
                slide_num=args.slide,
                total_slides=args.total,
                topic_label=args.label,
            )
        elif args.type == 'cover':
            img = generate_cover_slide(
                title=args.title,
                subtitle=args.subtitle,
                brand=args.brand,
                slide_num=args.slide,
                total_slides=args.total,
                topic_label=args.label,
            )
        else:
            img = generate_fact_slide(
                headline=args.headline,
                body_text=args.body,
                brand=args.brand,
                slide_num=args.slide,
                total_slides=args.total,
                year_label=args.year,
            )

    img.save(args.output, 'JPEG', quality=95)
    print(f"SAVED:{args.output}")


if __name__ == '__main__':
    main()
