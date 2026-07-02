#!/usr/bin/env python3
"""RED HORIZON asset post-processor — pure-Python PNG codec + sprite ops. Zero deps.

Pipeline per sprite: decode -> (chroma key) -> trim -> box-downscale (alpha-weighted)
-> alpha snap -> median-cut quantize (optional dither) -> 1px dark outline -> encode.

Usage:
  python3 png_tool.py batch [--spec asset_spec.json] [--only name1,name2]
  python3 png_tool.py info <file.png>
  python3 png_tool.py process <in.png> <out.png> --type unit --size 30
"""
import sys, os, json, zlib, struct, argparse

# ---------------- PNG decode ----------------

SIG = b'\x89PNG\r\n\x1a\n'

def png_read(path):
    data = open(path, 'rb').read()
    if data[:8] != SIG:
        raise ValueError(f'{path}: not a PNG')
    pos = 8
    ihdr = None; plte = b''; trns = b''; idat = []
    while pos < len(data):
        ln = struct.unpack('>I', data[pos:pos+4])[0]
        typ = data[pos+4:pos+8]
        chunk = data[pos+8:pos+8+ln]
        pos += 12 + ln
        if typ == b'IHDR': ihdr = struct.unpack('>IIBBBBB', chunk)
        elif typ == b'PLTE': plte = chunk
        elif typ == b'tRNS': trns = chunk
        elif typ == b'IDAT': idat.append(chunk)
        elif typ == b'IEND': break
    w, h, depth, ctype, comp, filt, interlace = ihdr
    if interlace != 0:
        raise ValueError('Adam7 interlace not supported')
    raw = zlib.decompress(b''.join(idat))

    # channels per pixel
    nch = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ctype]
    if depth == 8:
        bpp = nch
        stride = w * nch
    elif depth == 16:
        bpp = nch * 2
        stride = w * nch * 2
    elif ctype == 3 and depth in (1, 2, 4):
        bpp = 1
        stride = (w * depth + 7) // 8
    else:
        raise ValueError(f'unsupported depth {depth} ctype {ctype}')

    # unfilter
    out = bytearray(h * stride)
    prior = bytearray(stride)
    p = 0
    for y in range(h):
        f = raw[p]; p += 1
        line = bytearray(raw[p:p+stride]); p += stride
        if f == 1:  # Sub
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i-bpp]) & 0xFF
        elif f == 2:  # Up
            for i in range(stride):
                line[i] = (line[i] + prior[i]) & 0xFF
        elif f == 3:  # Average
            for i in range(stride):
                a = line[i-bpp] if i >= bpp else 0
                line[i] = (line[i] + ((a + prior[i]) >> 1)) & 0xFF
        elif f == 4:  # Paeth
            for i in range(stride):
                a = line[i-bpp] if i >= bpp else 0
                b = prior[i]
                c = prior[i-bpp] if i >= bpp else 0
                pp = a + b - c
                pa, pb, pc = abs(pp-a), abs(pp-b), abs(pp-c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        out[y*stride:(y+1)*stride] = line
        prior = line

    # to RGBA8
    px = bytearray(w * h * 4)
    if depth == 16:
        # take high bytes
        b8 = bytearray(w * h * nch)
        for i in range(w * h * nch):
            b8[i] = out[i*2]
        out = b8
    if ctype == 6:
        px[:] = out[:w*h*4]
    elif ctype == 2:
        for i in range(w*h):
            px[i*4:i*4+3] = out[i*3:i*3+3]; px[i*4+3] = 255
    elif ctype == 0:
        for i in range(w*h):
            g = out[i]; px[i*4] = g; px[i*4+1] = g; px[i*4+2] = g; px[i*4+3] = 255
    elif ctype == 4:
        for i in range(w*h):
            g = out[i*2]; px[i*4] = g; px[i*4+1] = g; px[i*4+2] = g; px[i*4+3] = out[i*2+1]
    elif ctype == 3:
        # unpack indices
        idxs = bytearray(w*h)
        if depth == 8:
            for y in range(h):
                idxs[y*w:(y+1)*w] = out[y*stride:y*stride+w]
        else:
            mask = (1 << depth) - 1
            per = 8 // depth
            for y in range(h):
                row = out[y*stride:(y+1)*stride]
                for x in range(w):
                    byte = row[x // per]
                    shift = 8 - depth * (x % per + 1)
                    idxs[y*w+x] = (byte >> shift) & mask
        for i in range(w*h):
            j = idxs[i] * 3
            px[i*4] = plte[j]; px[i*4+1] = plte[j+1]; px[i*4+2] = plte[j+2]
            px[i*4+3] = trns[idxs[i]] if idxs[i] < len(trns) else 255
    return w, h, px

# ---------------- PNG encode ----------------

def png_write(path, w, h, px):
    stride = w * 4
    raw = bytearray()
    prior = bytearray(stride)
    for y in range(h):
        line = px[y*stride:(y+1)*stride]
        # Paeth filter every row (decent compression, simple)
        f = bytearray(stride)
        for i in range(stride):
            a = line[i-4] if i >= 4 else 0
            b = prior[i]
            c = prior[i-4] if i >= 4 else 0
            pp = a + b - c
            pa, pb, pc = abs(pp-a), abs(pp-b), abs(pp-c)
            pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
            f[i] = (line[i] - pr) & 0xFF
        raw.append(4)
        raw += f
        prior = line
    comp = zlib.compress(bytes(raw), 9)
    def chunk(typ, data):
        c = struct.pack('>I', len(data)) + typ + data
        return c + struct.pack('>I', zlib.crc32(typ + data) & 0xFFFFFFFF)
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
    with open(path, 'wb') as fp:
        fp.write(SIG + chunk(b'IHDR', ihdr) + chunk(b'IDAT', comp) + chunk(b'IEND', b''))

# ---------------- ops ----------------

def key_magenta(w, h, px):
    for i in range(w*h):
        r, g, b = px[i*4], px[i*4+1], px[i*4+2]
        d = ((r-255)**2 + g*g*2 + (b-255)**2) ** 0.5
        if d < 110: px[i*4+3] = 0
        elif d < 200:
            a = int((d-110)/90*255)
            px[i*4+3] = min(px[i*4+3], a)
    # despill
    for i in range(w*h):
        if px[i*4+3] == 0: continue
        r, g, b = px[i*4], px[i*4+1], px[i*4+2]
        ex = (r + b)//2 - g
        if ex > 0:
            px[i*4] = max(0, r - ex*7//10)
            px[i*4+2] = max(0, b - ex*7//10)
            px[i*4+1] = min(255, g + ex*15//100)
    return w, h, px

def trim(w, h, px, thresh=8):
    minx, miny, maxx, maxy = w, h, -1, -1
    for y in range(h):
        row = y*w
        for x in range(w):
            if px[(row+x)*4+3] > thresh:
                if x < minx: minx = x
                if x > maxx: maxx = x
                if y < miny: miny = y
                if y > maxy: maxy = y
    if maxx < 0: return w, h, px  # fully transparent
    nw, nh = maxx-minx+1, maxy-miny+1
    out = bytearray(nw*nh*4)
    for y in range(nh):
        src = ((y+miny)*w + minx)*4
        out[y*nw*4:(y+1)*nw*4] = px[src:src+nw*4]
    return nw, nh, out

def scale_box(w, h, px, nw, nh):
    """Alpha-weighted box downscale (also handles mild upscale)."""
    out = bytearray(nw*nh*4)
    xr = w / nw; yr = h / nh
    for oy in range(nh):
        sy0 = oy*yr; sy1 = (oy+1)*yr
        iy0 = int(sy0); iy1 = min(h, int(sy1) + (1 if sy1 > int(sy1) else 0))
        for ox in range(nw):
            sx0 = ox*xr; sx1 = (ox+1)*xr
            ix0 = int(sx0); ix1 = min(w, int(sx1) + (1 if sx1 > int(sx1) else 0))
            ar = ag = ab = aa = tw = 0.0
            for yy in range(iy0, iy1):
                wy = min(sy1, yy+1) - max(sy0, yy)
                if wy <= 0: continue
                base = yy*w
                for xx in range(ix0, ix1):
                    wx = min(sx1, xx+1) - max(sx0, xx)
                    if wx <= 0: continue
                    wgt = wx*wy
                    j = (base+xx)*4
                    a = px[j+3]/255.0
                    ar += px[j]*a*wgt; ag += px[j+1]*a*wgt; ab += px[j+2]*a*wgt
                    aa += a*wgt; tw += wgt
            o = (oy*nw+ox)*4
            if aa > 1e-6:
                out[o] = min(255, int(ar/aa + .5)); out[o+1] = min(255, int(ag/aa + .5))
                out[o+2] = min(255, int(ab/aa + .5)); out[o+3] = min(255, int(aa/tw*255 + .5))
    return nw, nh, out

def alpha_snap(w, h, px, thresh=96):
    for i in range(w*h):
        px[i*4+3] = 0 if px[i*4+3] < thresh else 255
    return w, h, px

def quantize(w, h, px, ncolors, dither=False):
    pts = []
    for i in range(w*h):
        if px[i*4+3] > 0:
            pts.append((px[i*4], px[i*4+1], px[i*4+2]))
    if not pts: return w, h, px
    boxes = [pts]
    while len(boxes) < ncolors:
        # split box with largest range*count
        best, bi = -1, -1
        for k, b in enumerate(boxes):
            if len(b) < 2: continue
            rng = max(max(c) - min(c) for c in zip(*b))
            score = rng * (len(b) ** 0.5)
            if score > best: best, bi = score, k
        if bi < 0: break
        b = boxes.pop(bi)
        chans = list(zip(*b))
        ch = max(range(3), key=lambda c: max(chans[c]) - min(chans[c]))
        b.sort(key=lambda p: p[ch])
        mid = len(b)//2
        boxes += [b[:mid], b[mid:]]
    pal = []
    for b in boxes:
        n = len(b)
        pal.append((sum(p[0] for p in b)//n, sum(p[1] for p in b)//n, sum(p[2] for p in b)//n))
    def nearest(r, g, b):
        bi, bd = 0, 1 << 30
        for k, (pr, pg, pb) in enumerate(pal):
            d = (r-pr)*(r-pr) + (g-pg)*(g-pg) + (b-pb)*(b-pb)
            if d < bd: bd, bi = d, k
        return pal[bi]
    if dither:
        # Floyd-Steinberg on a float copy
        buf = [float(v) for v in px]
        for y in range(h):
            for x in range(w):
                i = (y*w+x)*4
                if px[i+3] == 0: continue
                r = min(255, max(0, buf[i])); g = min(255, max(0, buf[i+1])); b = min(255, max(0, buf[i+2]))
                nr, ng, nb = nearest(int(r), int(g), int(b))
                px[i], px[i+1], px[i+2] = nr, ng, nb
                er, eg, eb = r-nr, g-ng, b-nb
                for dx, dy, wgt in ((1,0,7/16),(-1,1,3/16),(0,1,5/16),(1,1,1/16)):
                    xx, yy = x+dx, y+dy
                    if 0 <= xx < w and 0 <= yy < h:
                        j = (yy*w+xx)*4
                        buf[j] += er*wgt; buf[j+1] += eg*wgt; buf[j+2] += eb*wgt
    else:
        cache = {}
        for i in range(w*h):
            if px[i*4+3] == 0: continue
            key = (px[i*4] >> 2, px[i*4+1] >> 2, px[i*4+2] >> 2)
            c = cache.get(key)
            if c is None:
                c = nearest(px[i*4], px[i*4+1], px[i*4+2])
                cache[key] = c
            px[i*4], px[i*4+1], px[i*4+2] = c
    return w, h, px

def pad(w, h, px, n):
    nw, nh = w + 2*n, h + 2*n
    out = bytearray(nw*nh*4)
    for y in range(h):
        out[((y+n)*nw+n)*4:((y+n)*nw+n+w)*4] = px[y*w*4:(y+1)*w*4]
    return nw, nh, out

def outline(w, h, px, color=(16, 20, 26)):
    src = bytes(px)
    for y in range(h):
        for x in range(w):
            i = (y*w+x)*4
            if src[i+3] != 0: continue
            near = False
            if x > 0 and src[i-4+3] > 0: near = True
            elif x < w-1 and src[i+4+3] > 0: near = True
            elif y > 0 and src[i-w*4+3] > 0: near = True
            elif y < h-1 and src[i+w*4+3] > 0: near = True
            if near:
                px[i], px[i+1], px[i+2], px[i+3] = color[0], color[1], color[2], 255
    return w, h, px

# ---------------- process types ----------------

def process(inp, outp, ptype, opts):
    w, h, px = png_read(inp)
    if opts.get('key'):
        w, h, px = key_magenta(w, h, px)
    if ptype in ('unit', 'building', 'prop'):
        w, h, px = trim(w, h, px)
        size = opts.get('size', 32)
        if w >= h:
            nw, nh = size, max(1, round(h * size / w))
        else:
            nh, nw = size, max(1, round(w * size / h))
        w, h, px = scale_box(w, h, px, nw, nh)
        if ptype == 'building':
            # keep soft baked shadow; just clear near-transparent haze
            for i in range(w*h):
                if px[i*4+3] < 24: px[i*4+3] = 0
        else:
            w, h, px = alpha_snap(w, h, px, opts.get('alphasnap', 150))
        w, h, px = trim(w, h, px)
        q = opts.get('quantize', {'unit': 48, 'building': 64, 'prop': 32}[ptype])
        w, h, px = quantize(w, h, px, q)
        if opts.get('outline', ptype != 'building'):
            w, h, px = pad(w, h, px, 1)
            w, h, px = outline(w, h, px)
    elif ptype == 'cameo':
        tw, th = opts.get('w', 100), opts.get('h', 86)
        # center-crop to target aspect, then scale
        want = tw / th
        have = w / h
        if have > want:
            cw = int(h * want)
            x0 = (w - cw) // 2
            out = bytearray(cw * h * 4)
            for y in range(h):
                out[y*cw*4:(y+1)*cw*4] = px[(y*w+x0)*4:(y*w+x0+cw)*4]
            w, px = cw, out
        elif have < want:
            ch = int(w / want)
            y0 = (h - ch) // 2
            px = px[y0*w*4:(y0+ch)*w*4]
            h = ch
        w, h, px = scale_box(w, h, px, tw, th)
        for i in range(tw*th):
            px[i*4+3] = 255
        w, h, px = quantize(w, h, px, opts.get('quantize', 128))
    elif ptype == 'terrain':
        size = opts.get('size', 128)
        w, h, px = scale_box(w, h, px, size, size)
        for i in range(size*size):
            px[i*4+3] = 255
        w, h, px = quantize(w, h, px, opts.get('quantize', 28))
    elif ptype == 'title':
        tw = opts.get('width', 1440)
        th = round(h * tw / w)
        w, h, px = scale_box(w, h, px, tw, th)
        for i in range(w*h):
            px[i*4+3] = 255
        if opts.get('quantize'):
            w, h, px = quantize(w, h, px, opts['quantize'], dither=opts.get('dither', False))
    else:
        raise ValueError(f'unknown type {ptype}')
    png_write(outp, w, h, px)
    return w, h

# ---------------- batch ----------------

def batch(spec_path, only=None):
    here = os.path.dirname(os.path.abspath(spec_path))
    spec = json.load(open(spec_path))
    raw_dir = os.path.normpath(os.path.join(here, spec.get('raw_dir', '../assets/raw')))
    out_dir = os.path.normpath(os.path.join(here, spec.get('out_dir', '../assets/img')))
    os.makedirs(out_dir, exist_ok=True)
    sprites_path = os.path.normpath(os.path.join(here, spec.get('sprites_json', '../assets/sprites.json')))
    sprites = {}
    if os.path.exists(sprites_path):
        sprites = json.load(open(sprites_path))
    for name, e in spec['assets'].items():
        if only and name not in only: continue
        proc = e.get('process')
        if not proc: continue
        inp = os.path.join(raw_dir, name + '.png')
        if not os.path.exists(inp):
            print(f'  MISSING raw {name}', file=sys.stderr)
            continue
        outp = os.path.join(out_dir, name + '.png')
        ptype = proc.get('type', 'unit')
        w, h = process(inp, outp, ptype, proc)
        entry = {'file': f'assets/img/{name}.png', 'w': w, 'h': h,
                 'pivot': e.get('pivot', [0.5, 0.5])}
        if 'meta' in e: entry['meta'] = e['meta']
        sprites[name] = entry
        print(f'  processed {name} -> {w}x{h}')
    json.dump(sprites, open(sprites_path, 'w'), indent=1, ensure_ascii=False)
    print(f'sprites.json updated ({len(sprites)} entries)')

def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    b = sub.add_parser('batch')
    b.add_argument('--spec', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'asset_spec.json'))
    b.add_argument('--only', default=None)
    i = sub.add_parser('info')
    i.add_argument('file')
    p = sub.add_parser('process')
    p.add_argument('inp'); p.add_argument('outp')
    p.add_argument('--type', default='unit'); p.add_argument('--size', type=int, default=32)
    p.add_argument('--quantize', type=int); p.add_argument('--key', action='store_true')
    p.add_argument('--no-outline', action='store_true')
    a = ap.parse_args()
    if a.cmd == 'info':
        w, h, px = png_read(a.file)
        na = sum(1 for k in range(w*h) if px[k*4+3] == 0)
        print(f'{a.file}: {w}x{h} transparent_px={na} ({na*100//(w*h)}%)')
    elif a.cmd == 'process':
        opts = {'size': a.size, 'key': a.key, 'outline': not a.no_outline}
        if a.quantize: opts['quantize'] = a.quantize
        w, h = process(a.inp, a.outp, a.type, opts)
        print(f'{a.outp}: {w}x{h}')
    elif a.cmd == 'batch':
        batch(a.spec, a.only.split(',') if a.only else None)

if __name__ == '__main__':
    main()
