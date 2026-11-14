"""把设计稿裁成扩展图标：按内容居中裁方、四角切圆、导出 512 和 128。

源图放 design/icon-source.png（不随包发布），改图后重跑一次即可。
"""
import os
import statistics

from PIL import Image, ImageChops, ImageDraw

SOURCE = "design/icon-source.png"
SIZE = 512
RADIUS = 112
PADDING = 0.06


def background_of(img):
    w, h = img.size
    corners = [img.getpixel((4, 4)), img.getpixel((w - 5, 4)), img.getpixel((4, h - 5)), img.getpixel((w - 5, h - 5))]
    return tuple(int(statistics.median(c[i] for c in corners)) for i in range(3))


img = Image.open(SOURCE).convert("RGB")
w, h = img.size
bg = Image.new("RGB", img.size, background_of(img))

# 找出内容范围
diff = ImageChops.difference(img, bg).convert("L")
bbox = diff.point(lambda v: 255 if v > 16 else 0).getbbox()
if not bbox:
    raise SystemExit("源图里找不到内容")

x0, y0, x1, y1 = bbox
side = int(max(x1 - x0, y1 - y0) * (1 + PADDING * 2))
side = min(side, w, h)
cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
left = max(0, min(w - side, cx - side // 2))
top = max(0, min(h - side, cy - side // 2))

icon = img.crop((left, top, left + side, top + side)).resize((SIZE, SIZE), Image.LANCZOS)

# 四角切圆，外面透明
mask = Image.new("L", (SIZE, SIZE), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=RADIUS, fill=255)
out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
out.paste(icon, (0, 0), mask)

os.makedirs("assets", exist_ok=True)
out.save("assets/icon.png", optimize=True)
out.resize((128, 128), Image.LANCZOS).save("assets/icon-128.png", optimize=True)
print("crop", (left, top, side), "-> assets/icon.png")
