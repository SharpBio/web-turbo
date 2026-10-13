# -*- coding: utf-8 -*-
"""生成插件图标：紫青渐变圆底 + 白色双三角（快进符号）。仅用标准库。"""
import zlib, struct, os

OUT = os.path.join(os.path.dirname(__file__), "..", "icons")
os.makedirs(OUT, exist_ok=True)

SS = 4  # 超采样倍数


def lerp(a, b, t):
    return a + (b - a) * t


def bg_color(u, v):
    """左上紫 -> 右下青 的对角渐变"""
    t = (u + v) / 2.0
    r = int(lerp(0x7C, 0x06, t))
    g = int(lerp(0x3A, 0xB6, t))
    b = int(lerp(0xED, 0xD4, t))
    return r, g, b


def in_tri(px, py, tri):
    (x1, y1), (x2, y2), (x3, y3) = tri
    d = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3)
    if abs(d) < 1e-12:
        return False
    a = ((y2 - y3) * (px - x3) + (x3 - x2) * (py - y3)) / d
    b = ((y3 - y1) * (px - x3) + (x1 - x3) * (py - y3)) / d
    c = 1 - a - b
    return a >= -0.002 and b >= -0.002 and c >= -0.002


TRIS = [
    ((0.20, 0.26), (0.20, 0.74), (0.52, 0.50)),
    ((0.46, 0.26), (0.46, 0.74), (0.80, 0.50)),
]


def render(size):
    buf = bytearray()
    for y in range(size):
        buf.append(0)  # filter type 0
        row = bytearray()
        for x in range(size):
            ar = ag = ab = 0
            for sy in range(SS):
                for sx in range(SS):
                    u = (x + (sx + 0.5) / SS) / size
                    v = (y + (sy + 0.5) / SS) / size
                    # 圆形底
                    du, dv = u - 0.5, v - 0.5
                    inside = (du * du + dv * dv) <= 0.235
                    if inside:
                        r, g, b = bg_color(u, v)
                        a = 255
                    else:
                        r = g = b = 0
                        a = 0
                    # 前景三角（白色）
                    for tri in TRIS:
                        if in_tri(u, v, tri):
                            r, g, b = 255, 255, 255
                            a = 255
                    ar += r
                    ag += g
                    ab += b
                    if a == 0:
                        pass
            n = SS * SS
            row += bytes((ar // n, ag // n, ab // n, 255))
        # 重新计算 alpha：圆外的像素设透明
        for i in range(size):
            pass
        buf += row
    return bytes(buf)


def render2(size):
    """逐像素 4x 超采样，正确处理 alpha。"""
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            ar = ag = ab = aa = 0
            for sy in range(SS):
                for sx in range(SS):
                    u = (x + (sx + 0.5) / SS) / size
                    v = (y + (sy + 0.5) / SS) / size
                    du, dv = u - 0.5, v - 0.5
                    if (du * du + dv * dv) <= 0.237:
                        r, g, b = bg_color(u, v)
                        alpha = 255
                        for tri in TRIS:
                            if in_tri(u, v, tri):
                                r, g, b = 255, 255, 255
                                break
                    else:
                        r = g = b = 0
                        alpha = 0
                    ar += r
                    ag += g
                    ab += b
                    aa += alpha
            n = SS * SS
            row += bytes((ar // n, ag // n, ab // n, aa // n))
        rows.append(bytes(row))
    raw = b"".join(b"\x00" + r for r in rows)
    return raw


def png_bytes(size):
    raw = render2(size)

    def chunk(typ, data):
        c = struct.pack(">I", len(data)) + typ + data
        return c + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b""))


for s in (16, 32, 48, 128):
    p = os.path.abspath(os.path.join(OUT, f"icon{s}.png"))
    with open(p, "wb") as f:
        f.write(png_bytes(s))
    print("wrote", p)
