/**
 * GBMem-Menu 256M – Application Logic
 *
 * Serves both the Builder (builder.html) and the Extractor (extract.html).
 * Page is detected via <body id="builder|extractor">.
 * Shared constants, utilities and logging live at the top; page-specific
 * logic is separated into clearly labelled sections.
 */
"use strict";

const PAGE = document.body.id;            // 'builder' | 'extractor'


/* --- Constants --- */

const BANK_SIZE      = 0x4000;
const BANK_PAIR_SIZE = BANK_SIZE * 2;
const TILE_PX        = 8;
const TILE_BYTES     = 16;
const MENU_SIZE      = 0x20000;
const FLASH_SIZE     = 0x2000000;        // 32 MiB

/* SRAM geometry ------------------------------------------------ */
const SRAM_BLOCK            = 0x200000;  // Every 2 MiB flash block maps to two SRAM slots
const SRAM_SLOT_SIZE        = 0x4000;    // 16 KiB payload per SRAM slot
const SRAM_SLOT_PAIR_STRIDE = 0x8000;    // 32 KiB SRAM page stride
const SRAM_SLOT_ODD_OFFSET  = 0x6000;    // Odd slots are mapped to the back of the page
const SRAM_NUM_SLOTS        = 32;
const SRAM_TOTAL_SIZE       = (SRAM_NUM_SLOTS / 2) * SRAM_SLOT_PAIR_STRIDE;

/* Mapper type bytes -------------------------------------------- */
const MBC1_TYPES      = new Set([0x01, 0x02, 0x03]);
const MBC2_TYPES      = new Set([0x05, 0x06]);
const MBC3_TYPES      = new Set([0x10, 0x13]);
const MBC1_BLOCK_SIZE = 0x80000;
const SRAM_SIZES      = { 0: 0, 1: 0, 2: 0x2000, 3: 0x8000, 4: 0x20000, 5: 0x10000 };
const V7002_MBC1_ADVANCE_MODE   = 0x04;
const V7002_LAST_SRAM_BANK_MODE = 0x20;
const V7002_NO_SRAM_MODE        = 0x40;
const LAST_SRAM_BANK_MODE_ALLOWED_BLOCKS = new Set([0, 1, 2, 3, 8, 9, 10, 11]);

/* News-ticker layout ------------------------------------------- */
const NEWS_BANK_OFFSET = 0xC000;
const NEWS_DATA_OFFSET = 0x40;
const NEWS_H_TILES     = 2;
const NEWS_MAX_WIDTH   = 4080;

/* Background layout -------------------------------------------- */
const BG_SCREEN_W            = 20;
const BG_SCREEN_H            = 18;
const BG_TOTAL_TILES         = BG_SCREEN_W * BG_SCREEN_H;
const BG_MAX_PALETTES        = 6;
const BG_PALETTES_SIZE       = BG_MAX_PALETTES * 8;
const BG_TILES_SIZE          = BG_TOTAL_TILES * TILE_BYTES;
const BG_MAP_SIZE            = BG_TOTAL_TILES;
const BG_PALETTES_OFFSET     = 0x8890;
const BG_CGB_TILES_OFFSET    = 0x88C0;
const BG_CGB_TILEMAP_OFFSET  = 0x9F40;
const BG_CGB_ATTRMAP_OFFSET  = 0xA0A8;
const BG_DMG_TILES_OFFSET    = 0xA210;
const BG_DMG_TILEMAP_OFFSET  = 0xB890;
const BG_VRAM_SLOTS_CGB_ADDR = 0x8002;
const BG_VRAM_SLOTS_DMG_ADDR = 0x8003;
const DMG_BGP_ADDR           = 0x8004;  /* bank2_header[4]: DMG palette */
const BG_MAX_NONFONT_TILES   = 92;      /* 0-31 + 192-255 - 4 page-indicator tiles */
const BG_MAX_UNIQUE_TILES    = 256 - 4; /* 4 page-indicator tiles */
const BG_FONT_ROW_FROM       = 3;
const BG_FONT_ROW_TO         = 13;
const BG_FONT_COLUMN_FROM    = 2;
const BG_FONT_COLUMN_TO      = 18;

/* Game-database offsets ---------------------------------------- */
const GAMEDB_BANK4_BASE     = 0x10000;
const GAMEDB_HEADER_SIZE    = 0x10;
const GAMEDB_SLOT_SIZE      = 0x160;
const GAMEDB_TITLE_SIZE     = 54;
const GAMEDB_TIMESTAMP_SIZE = 18;
const GAMEDB_SLOTS_PER_BANK = 43;
const GAMEDB_GAMES_PER_BANK = 40;
const GAMEDB_GFX_TILES      = 16;
const GAMEDB_TS_OFFSET      = 0x13F;  /* timestamp field offset within a slot */

/* Timestamp-compensation block --------------------------------- */
const TS_COMP_ADDR = 0x1FEFF;    /* ROM address of the compensation data */
const TS_COMP_SIZE = 257;        /* bytes in the compensation block */

/* Accepted file extensions ------------------------------------- */
const ROM_EXTS = ['.gb', '.gbc', '.sgb'];

/* CRC32 of the original NP GB-Memory menu ROM (first 96 KiB) ------------ */
const MENU_CRC32_EXPECTED = 0x1E626995;
const MENU_CRC32_RANGE    = 0x18000;

/* Human-readable mapper names ---------------------------------- */
const MAPPER_NAMES = {
  0x00: 'ROM',   0x01: 'MBC1', 0x02: 'MBC1', 0x03: 'MBC1',
  0x06: 'MBC2',  0x10: 'MBC3', 0x13: 'MBC3',
  0x19: 'MBC5',  0x1A: 'MBC5', 0x1B: 'MBC5', 0x1C: 'MBC5', 0x1E: 'MBC5',
  0x20: 'MBC6',  0x22: 'MBC7',
  0x0B: 'MMM01', 0x0D: 'MMM01',
  0xFC: 'GBD',   0xFD: 'TAMA5', 0xFE: 'HuC-3', 0xFF: 'HuC-1',
};

/* Maximum ROM size per mapper ---------------------------------- */
const MAPPER_MAX_SIZE = {
  MBC1: 0x100000,
  MBC2: 0x080000,
  MBC3: 0x400000,
  MBC5: 0x800000,
};

/* Mappers known to work on the 256M cart ----------------------- */
const SUPPORTED_MAPPERS = new Set(['ROM', 'MBC1', 'MBC2', 'MBC3', 'MBC5']);

/* ROM CRC32 values known to be potentially unsupported ---------- */
const UNSUPPORTED_CRC32 = new Set([
  '509A6B73', '005AD4B7', '06CC1E9D', 'AF2B426E', 'B2EEDD36', 'AD376905',
  '562C8F7F', 'B1A8DFD0', '55300D0A', '7D1D8FDC', '6DBAA5E8',
  'D549E074', '19EB4516'
]);

const ADVANCE_MODE_TITLE = 'CHINESE FIGHTER';


/* --- Low-Level Utilities --- */

/* --- CRC32 --- */

const crc32Table = new Uint32Array(256);
(function buildCrc32Table() {
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crc32Table[n] = c;
  }
})();

/** Calculate CRC32 over a sub-range of a Uint8Array. */
function crc32(buf, start = 0, end) {
  if (end === undefined) end = buf.length;
  let c = 0xFFFFFFFF;
  for (let i = start; i < end; i++) c = crc32Table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** Return a readable message for unknown thrown values. */
function errorMessage(err) {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

/* --- Base64 helpers --- */

/** Decode a base64 string into a Uint8Array. */
function b64ToUint8Array(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

/** Decode a base64-encoded PNG into an ImageData object. */
async function imageDataFromB64Png(b64) {
  const arr = b64ToUint8Array(b64);
  const blob = new Blob([arr], { type: 'image/png' });

  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(blob);
    try {
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      const ctx = require2dContext(c);
      ctx.drawImage(bmp, 0, 0);
      return ctx.getImageData(0, 0, c.width, c.height);
    } finally {
      if (typeof bmp.close === 'function') bmp.close();
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImageFromUrl(url);
    return getImageData(img);
  } finally {
    URL.revokeObjectURL(url);
  }
}


/* --- BPS Patching --- */

/**
 * Apply a BPS patch to a source ROM and return the target ROM.
 * Throws on bad magic, size mismatch or CRC failure.
 */
function applyBpsPatch(patchBuf, sourceBuf) {
  if (patchBuf.length < 16) throw new Error('BPS: patch too small');
  if (patchBuf[0] !== 0x42 || patchBuf[1] !== 0x50 || patchBuf[2] !== 0x53 || patchBuf[3] !== 0x31) {
    throw new Error('BPS: bad magic');
  }

  const end = patchBuf.length - 12;
  let pos = 4;

  function readVarint() {
    let value = 0, shift = 1;
    for (let i = 0; i < 10; i++) {
      if (pos >= end) throw new Error('BPS: truncated varint');
      const byte = patchBuf[pos++];
      value += (byte & 0x7F) * shift;
      if (byte & 0x80) return value;
      if (shift > 0x10000000) throw new Error('BPS: varint overflow');
      shift <<= 7;
      value += shift;
    }
    throw new Error('BPS: malformed varint');
  }

  const sourceSize = readVarint();
  const targetSize = readVarint();
  const metaLen    = readVarint();
  if (pos + metaLen > end) throw new Error('BPS: metadata exceeds patch size');
  pos += metaLen;

  if (sourceBuf.length !== sourceSize) {
    throw new Error(`BPS: source size mismatch (${sourceBuf.length} != ${sourceSize})`);
  }

  const expectedCrc =
    patchBuf[patchBuf.length - 12]       |
    (patchBuf[patchBuf.length - 11] << 8) |
    (patchBuf[patchBuf.length - 10] << 16) |
    (patchBuf[patchBuf.length - 9]  << 24);

  if (crc32(sourceBuf) !== (expectedCrc >>> 0)) {
    log('warn', 'BPS: source CRC mismatch - patching anyway');
  }

  const target = new Uint8Array(targetSize);
  let outPos = 0, srcRel = 0, tgtRel = 0;

  while (pos < end) {
    const command = readVarint();
    const action  = command & 3;
    const length  = (command >> 2) + 1;
    if (outPos + length > target.length) throw new Error('BPS: output overrun');

    if (action === 0) {
      /* SourceRead */
      if (outPos + length > sourceBuf.length) throw new Error('BPS: source read overrun');
      target.set(sourceBuf.subarray(outPos, outPos + length), outPos);
    } else if (action === 1) {
      /* TargetRead */
      if (pos + length > end) throw new Error('BPS: target read overrun');
      target.set(patchBuf.subarray(pos, pos + length), outPos);
      pos += length;
    } else if (action === 2) {
      /* SourceCopy */
      const offset = readVarint();
      srcRel += (offset & 1 ? -1 : 1) * (offset >> 1);
      if (srcRel < 0 || srcRel + length > sourceBuf.length) throw new Error('BPS: source copy out of range');
      for (let i = 0; i < length; i++) target[outPos + i] = sourceBuf[srcRel + i];
      srcRel += length;
    } else {
      /* TargetCopy */
      const offset = readVarint();
      tgtRel += (offset & 1 ? -1 : 1) * (offset >> 1);
      if (tgtRel < 0 || tgtRel >= outPos) throw new Error('BPS: target copy out of range');
      for (let i = 0; i < length; i++) target[outPos + i] = target[tgtRel + i];
      tgtRel += length;
    }
    outPos += length;
  }

  if (outPos !== target.length) throw new Error('BPS: output size mismatch');
  return target;
}


/* --- 2BPP Tile Encoding --- */

/** Map an 8-bit gray value to one of the four Game Boy shade indices (0-3). */
function quantizeToShade(v) {
  if (v >= 192) return 0;   // white
  if (v >= 128) return 1;   // light
  if (v >= 64)  return 2;   // dark
  return 3;                 // black
}

/** Compute a shade index from RGBA pixel data at the given byte offset. */
function shadeFromRgba(d, idx) {
  return quantizeToShade(Math.round((d[idx] + d[idx + 1] + d[idx + 2]) / 3));
}

/** Fast string key from a Uint8Array (avoids .join(',') overhead). */
function tileKey(data) { return String.fromCharCode.apply(null, data); }

/** Encode an 8×8 tile (64 shade values, 0-3) into 16 bytes of 2BPP data. */
function encode2bpp(pixels) {
  const data = new Uint8Array(16);
  for (let row = 0; row < 8; row++) {
    let lo = 0, hi = 0;
    for (let col = 0; col < 8; col++) {
      const shade = pixels[row * 8 + col];
      if (shade & 1) lo |= 0x80 >> col;
      if (shade & 2) hi |= 0x80 >> col;
    }
    data[row * 2]     = lo;
    data[row * 2 + 1] = hi;
  }
  return data;
}


/* --- Image Helpers --- */

/** Get a 2D canvas context or throw a descriptive error. */
function require2dContext(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context is unavailable');
  return ctx;
}

/** Load binary image data into an HTMLImageElement via an object-URL. */
function loadImage(buf, mime) {
  const blob = new Blob([buf], { type: mime || 'image/png' });
  const url  = URL.createObjectURL(blob);
  return loadImageFromUrl(url).finally(() => URL.revokeObjectURL(url));
}

/** Load an image from a relative URL (used for default background previews). */
function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img  = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image: ' + url));
    img.src = url;
  });
}

/** Draw an image onto an off-screen canvas and return its ImageData. */
function getImageData(img) {
  const c = document.createElement('canvas');
  c.width  = img.width;
  c.height = img.height;
  const ctx = require2dContext(c);
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height);
}

/** Return the file extension (incl. leading dot) in lower-case. */
function getFileExtension(name) {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return '';
  return name.slice(dot).toLowerCase();
}

/** Return the CSS class for a platform badge. */
function platformBadgeClass(platform) {
  return platform === 'CGB!' ? 'plat-cgb-only'
       : platform === 'CGB'  ? 'plat-cgb'
       : platform === 'SGB'  ? 'plat-sgb' : 'plat-dmg';
}

/** Convert an ImageData to an off-screen canvas. */
function imageDataToCanvas(imgData) {
  const c = document.createElement('canvas');
  c.width = imgData.width; c.height = imgData.height;
  require2dContext(c).putImageData(imgData, 0, 0);
  return c;
}

/** Threshold an ImageData to pure black/white in-place. */
function thresholdBW(imgData) {
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = (d[i] + d[i + 1] + d[i + 2]) / 3 >= 128 ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
}

/** RGBA pixel index for an 8×8 tile at grid position (ty, tx). */
function tilePixelIdx(ty, tx, y, x, w) {
  return ((ty * 8 + y) * w + tx * 8 + x) * 4;
}

/** Quantize a luminance value to one of 4 Game Boy grayscale shades. */
function grayQuantize(v, lo, hi) {
  const mid = (lo + hi) >> 1;
  if (v >= hi)  return 255;
  if (v >= mid) return 181;
  if (v >= lo)  return 104;
  return 0;
}

/** BT.601 luminance from RGB. */
function luminance(r, g, b) {
  return Math.round(r * 0.299 + g * 0.587 + b * 0.114);
}


/* --- Color Helpers (RGB555 / CGB) --- */

/** Convert 8-bit RGB to 15-bit BGR555 (Game Boy Color format). */
function rgbToBgr555(r, g, b) {
  return (Math.round(r * 31 / 255)) |
         (Math.round(g * 31 / 255) << 5) |
         (Math.round(b * 31 / 255) << 10);
}

function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF];
}

/** Decode a processBgCgb() result back into a 160×144 ImageData.
 *  Shows exactly what the ROM hardware would display (incl. BGR555 quantisation). */
function decodeBgCgbToImageData({ palBytes, rawTiles, attrmap }) {
  /* Decode BGR555 palettes to RGB arrays */
  const pals = [];
  for (let p = 0; p < BG_MAX_PALETTES; p++) {
    const entries = [];
    for (let e = 0; e < 4; e++) {
      const off = p * 8 + e * 2;
      const bgr = palBytes[off] | (palBytes[off + 1] << 8);
      const r5 = bgr & 0x1F, g5 = (bgr >> 5) & 0x1F, b5 = (bgr >> 10) & 0x1F;
      entries.push([Math.round(r5 * 255 / 31), Math.round(g5 * 255 / 31), Math.round(b5 * 255 / 31)]);
    }
    pals.push(entries);
  }
  /* Decode tiles */
  const out = new ImageData(160, 144);
  const d = out.data;
  for (let ty = 0; ty < BG_SCREEN_H; ty++) {
    for (let tx = 0; tx < BG_SCREEN_W; tx++) {
      const ti = ty * BG_SCREEN_W + tx;
      const pal = pals[attrmap[ti]] || pals[0];
      const tOff = ti * TILE_BYTES;
      for (let y = 0; y < 8; y++) {
        const lo = rawTiles[tOff + y * 2];
        const hi = rawTiles[tOff + y * 2 + 1];
        for (let x = 0; x < 8; x++) {
          const bit = 7 - x;
          const shade = (((hi >> bit) & 1) << 1) | ((lo >> bit) & 1);
          const [r, g, b] = pal[shade];
          const pi = ((ty * 8 + y) * 160 + tx * 8 + x) * 4;
          d[pi] = r; d[pi + 1] = g; d[pi + 2] = b; d[pi + 3] = 255;
        }
      }
    }
  }
  return out;
}


/* --- CGB Background Processing --- */

/** Extract the RGB pixel data for a single 8×8 tile at grid position (tx, ty). */
function extractTileRgb(imgData, tx, ty) {
  const w = imgData.width, d = imgData.data;
  const result = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const idx = tilePixelIdx(ty, tx, y, x, w);
      result.push([d[idx], d[idx + 1], d[idx + 2]]);
    }
  }
  return result;
}

function colorKey(r, g, b) { return (r << 16) | (g << 8) | b; }
function isWhite(r, g, b) { return r === 255 && g === 255 && b === 255; }
function isBlack(r, g, b) { return r === 0   && g === 0   && b === 0; }

/** Return the set of non-BW colour keys present in one tile (max 2). */
function getColorPair(tilePixels) {
  const colors = new Set();
  for (const px of tilePixels) {
    if (!isWhite(px[0], px[1], px[2]) && !isBlack(px[0], px[1], px[2])) colors.add(colorKey(px[0], px[1], px[2]));
  }
  if (colors.size > 2) throw new Error(`Tile has more than 2 custom colors (found ${colors.size})`);
  return colors;
}

/**
 * Build up to BG_MAX_PALETTES CGB palettes from the colour pairs of all
 * tiles.  Each palette holds white (entry 0), black (entry 3) and up to
 * 2 custom colours (entries 1-2).  Uses greedy bin-packing to fully
 * utilise all 6 available palettes (up to 12 unique custom colours).
 */
function buildBgPalettes(allPairs) {
  /* Collect unique non-empty colour sets, sorted largest-first for packing. */
  const seen = new Set();
  const required = [];
  for (const p of allPairs) {
    if (p.size === 0) continue;
    const key = [...p].sort().join(',');
    if (!seen.has(key)) { seen.add(key); required.push(p); }
  }
  required.sort((a, b) => b.size - a.size || [...a].sort().join(',').localeCompare([...b].sort().join(',')));

  /* Greedy bin-packing: try to fit each colour set into an existing palette. */
  const paletteSets = [];
  for (const cs of required) {
    let placed = false;
    for (const ps of paletteSets) {
      const merged = new Set([...ps, ...cs]);
      if (merged.size <= 2) {
        for (const c of cs) ps.add(c);
        placed = true;
        break;
      }
    }
    if (!placed) paletteSets.push(new Set(cs));
  }

  if (paletteSets.length > BG_MAX_PALETTES) {
    throw new Error(`Image needs ${paletteSets.length} palettes (max ${BG_MAX_PALETTES})`);
  }

  /* Build palette arrays: each has up to 2 BGR555 custom colours. */
  const uniquePairs = [];
  const palettes = [];
  for (const ps of paletteSets) {
    const colors = [...ps].sort();
    uniquePairs.push(new Set(colors));
    const c1k = colors[0];
    const c1r = (c1k >> 16) & 0xFF, c1g = (c1k >> 8) & 0xFF, c1b = c1k & 0xFF;
    const c2k = colors.length > 1 ? colors[1] : 0;
    const c2r = (c2k >> 16) & 0xFF, c2g = (c2k >> 8) & 0xFF, c2b = c2k & 0xFF;
    palettes.push([
      rgbToBgr555(c1r, c1g, c1b),
      colors.length > 1 ? rgbToBgr555(c2r, c2g, c2b) : 0,
    ]);
  }
  while (palettes.length < BG_MAX_PALETTES) palettes.push([0, 0]);
  while (uniquePairs.length < BG_MAX_PALETTES) uniquePairs.push(new Set());

  return { palettes, uniquePairs };
}

/** Find which palette index covers the given colour pair. */
function assignBgPalette(pair, uniquePairs) {
  if (pair.size === 0) return 0;
  for (let i = 0; i < uniquePairs.length; i++) {
    const up = uniquePairs[i];
    let match = true;
    for (const c of pair) if (!up.has(c)) { match = false; break; }
    if (match) return i;
  }
  throw new Error('Color pair not covered by any palette');
}

/** Encode one CGB tile to 2BPP using the assigned palette. */
function encodeCgbTile(tilePixels, palIdx, uniquePairs) {
  const colorMap = new Map();
  colorMap.set(colorKey(255, 255, 255), 0);
  colorMap.set(colorKey(0, 0, 0), 3);
  if (palIdx < uniquePairs.length) {
    const pairColors = [...uniquePairs[palIdx]].sort();
    for (let si = 0; si < pairColors.length; si++) colorMap.set(pairColors[si], si + 1);
  }
  const shades = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    const px = tilePixels[i];
    const k  = colorKey(px[0], px[1], px[2]);
    shades[i] = colorMap.has(k) ? colorMap.get(k) : 0;
  }
  return encode2bpp(shades);
}

/**
 * Assign VRAM tile-slot indices to all 20×18 screen positions.
 * Positions inside the font area (rows 3-12, cols 2-17) get fixed slots.
 * Remaining tiles are de-duplicated and packed into slots 0-31 and 192+.
 */
function buildBgSlotAssignment(allTileData) {
  const positionSlot = new Map();
  let fontSlot = 32;
  for (let ty = BG_FONT_ROW_FROM; ty < BG_FONT_ROW_TO; ty++) {
    for (let tx = BG_FONT_COLUMN_FROM; tx < BG_FONT_COLUMN_TO; tx++) {
      positionSlot.set(ty * BG_SCREEN_W + tx, fontSlot++);
    }
  }

  const seen = new Map();
  let nextLow = 0, nextHigh = 192;
  for (let ty = 0; ty < BG_SCREEN_H; ty++) {
    for (let tx = 0; tx < BG_SCREEN_W; tx++) {
      const key = ty * BG_SCREEN_W + tx;
      if (positionSlot.has(key)) continue;
      const tileFp = tileKey(allTileData[key]);
      if (!seen.has(tileFp)) {
        if (nextLow < 32) seen.set(tileFp, nextLow++);
        else if (nextHigh <= 251) seen.set(tileFp, nextHigh++);
        else throw new Error(`Image needs more than ${BG_MAX_NONFONT_TILES} unique background tiles`);
      }
      positionSlot.set(key, seen.get(tileFp));
    }
  }

  let nVramSlots = 0;
  for (const v of positionSlot.values()) if (v >= nVramSlots) nVramSlots = v + 1;

  const tilemap = new Uint8Array(BG_TOTAL_TILES);
  for (let ty = 0; ty < BG_SCREEN_H; ty++) {
    for (let tx = 0; tx < BG_SCREEN_W; tx++) {
      tilemap[ty * BG_SCREEN_W + tx] = (positionSlot.get(ty * BG_SCREEN_W + tx) + 0x80) & 0xFF;
    }
  }
  return { tilemap, nVramSlots };
}

/**
 * Ensure the image fits the Game Boy screen (160×144).
 * Larger images are center-cropped; smaller ones are padded with black.
 */
function ensureScreenSize(imgData) {
  /* Downscale larger images using nearest-neighbour */
  if (imgData.width > 160 || imgData.height > 144) {
    const src = new Uint8ClampedArray(imgData.data);
    const sw = imgData.width, sh = imgData.height;
    const dst = new Uint8ClampedArray(160 * 144 * 4);
    for (let dy = 0; dy < 144; dy++) {
      const sy = Math.floor(dy * sh / 144);
      for (let dx = 0; dx < 160; dx++) {
        const sx = Math.floor(dx * sw / 160);
        const si = (sy * sw + sx) * 4;
        const di = (dy * 160 + dx) * 4;
        dst[di] = src[si]; dst[di + 1] = src[si + 1];
        dst[di + 2] = src[si + 2]; dst[di + 3] = src[si + 3];
      }
    }
    imgData = new ImageData(dst, 160, 144);
  }

  if (imgData.width === 160 && imgData.height === 144) return imgData;

  /* Pad with black */
  const c = document.createElement('canvas'); c.width = 160; c.height = 144;
  const ctx = require2dContext(c);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 160, 144);
  ctx.drawImage(imageDataToCanvas(imgData), 0, 0);
  return ctx.getImageData(0, 0, 160, 144);
}

/** Process a full-colour background for CGB. */
function processBgCgb(imgData) {
  imgData = ensureScreenSize(imgData);

  const allTilePixels = [];
  const allPairs      = [];
  for (let ty = 0; ty < BG_SCREEN_H; ty++) {
    for (let tx = 0; tx < BG_SCREEN_W; tx++) {
      const pixels = extractTileRgb(imgData, tx, ty);
      allTilePixels.push(pixels);
      allPairs.push(getColorPair(pixels));
    }
  }

  const { palettes, uniquePairs } = buildBgPalettes(allPairs);
  const palIndices   = allPairs.map(p => assignBgPalette(p, uniquePairs));
  const allTileData  = allTilePixels.map((px, i) => encodeCgbTile(px, palIndices[i], uniquePairs));
  const { tilemap, nVramSlots } = buildBgSlotAssignment(allTileData);

  const rawTiles = new Uint8Array(BG_TILES_SIZE);
  for (let i = 0; i < allTileData.length; i++) rawTiles.set(allTileData[i], i * TILE_BYTES);

  const c0 = hexToRgb(state.cgbColor0);
  const c3 = hexToRgb(state.cgbColor3);
  const bgr0 = rgbToBgr555(c0[0], c0[1], c0[2]);
  const bgr3 = rgbToBgr555(c3[0], c3[1], c3[2]);
  const palBytes = new Uint8Array(BG_PALETTES_SIZE);
  for (let i = 0; i < BG_MAX_PALETTES; i++) {
    const off = i * 8;
    palBytes[off]     = bgr0 & 0xFF;
    palBytes[off + 1] = (bgr0 >> 8) & 0xFF;
    palBytes[off + 2] = palettes[i][0] & 0xFF;
    palBytes[off + 3] = (palettes[i][0] >> 8) & 0xFF;
    palBytes[off + 4] = palettes[i][1] & 0xFF;
    palBytes[off + 5] = (palettes[i][1] >> 8) & 0xFF;
    palBytes[off + 6] = bgr3 & 0xFF;
    palBytes[off + 7] = (bgr3 >> 8) & 0xFF;
  }

  const attrmap = new Uint8Array(BG_MAP_SIZE);
  for (let i = 0; i < BG_TOTAL_TILES; i++) attrmap[i] = palIndices[i];

  return { palBytes, rawTiles, tilemap, attrmap, nVramSlots };
}

function averageColor(imgData) {
  const d = imgData.data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const pr = d[i], pg = d[i + 1], pb = d[i + 2];
    if (pr === 0 && pg === 0 && pb === 0) continue;
    if (pr === 255 && pg === 255 && pb === 255) continue;
    r += pr; g += pg; b += pb; n++;
  }
  if (n === 0) return [128, 128, 128];
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

function lightenColor(rgb, amount) {
  return rgb.map(c => Math.min(255, Math.round(c + (255 - c) * (amount || 0.4))));
}

/** Process a CGB background as colorized grayscale: same pipeline as DMG, plus CGB palette. */
function processBgCgbGrayscale(imgData) {
  const sized = ensureScreenSize(imgData);
  const w = sized.width, h = sized.height;
  const px = new Uint8ClampedArray(sized.data);

  /* Quantize to 4 gray levels using CGB thresholds (same as DMG approach) */
  for (let i = 0; i < px.length; i += 4) {
    const lum = luminance(px[i], px[i + 1], px[i + 2]);
    px[i] = px[i + 1] = px[i + 2] = grayQuantize(lum, state.cgbThresholdLow, state.cgbThresholdHigh);
  }

  /* Merge similar tiles if unique count exceeds VRAM limit */
  const tilesReduced = mergeGrayTiles(px, w);

  /* Encode tiles using the standard DMG pipeline */
  const quantized = new ImageData(px, w, h);
  const dmgResult = processBgDmg(quantized);

  /* Build palette: shade0=Primary1, shade1=Secondary1, shade2=Secondary2, shade3=Primary2 */
  const c0rgb = hexToRgb(state.cgbColor0);
  const c1rgb = hexToRgb(state.cgbSecondary1);
  const c2rgb = hexToRgb(state.cgbSecondary2);
  const c3rgb = hexToRgb(state.cgbColor3);
  const bgr = [c0rgb, c1rgb, c2rgb, c3rgb].map(c => rgbToBgr555(c[0], c[1], c[2]));

  const palBytes = new Uint8Array(BG_PALETTES_SIZE);
  for (let i = 0; i < BG_MAX_PALETTES; i++) {
    const off = i * 8;
    for (let s = 0; s < 4; s++) {
      palBytes[off + s * 2]     = bgr[s] & 0xFF;
      palBytes[off + s * 2 + 1] = (bgr[s] >> 8) & 0xFF;
    }
  }

  /* All tiles use palette 0 */
  const attrmap = new Uint8Array(BG_MAP_SIZE);

  return { palBytes, rawTiles: dmgResult.rawTiles, tilemap: dmgResult.tilemap, attrmap, nVramSlots: dmgResult.nVramSlots, tilesReduced };
}

/** Process a grayscale background for DMG. */
function processBgDmg(imgData) {
  imgData = ensureScreenSize(imgData);

  const d = imgData.data, w = imgData.width;
  const allTileData = [];

  for (let ty = 0; ty < BG_SCREEN_H; ty++) {
    for (let tx = 0; tx < BG_SCREEN_W; tx++) {
      const shades = new Uint8Array(64);
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          shades[y * 8 + x] = shadeFromRgba(d, tilePixelIdx(ty, tx, y, x, w));
        }
      }
      allTileData.push(encode2bpp(shades));
    }
  }

  const { tilemap, nVramSlots } = buildBgSlotAssignment(allTileData);

  const rawTiles = new Uint8Array(BG_TILES_SIZE);
  for (let i = 0; i < allTileData.length; i++) rawTiles.set(allTileData[i], i * TILE_BYTES);

  return { rawTiles, tilemap, nVramSlots };
}


/* --- News Ticker Processing --- */

/**
 * Render a text string to a 16 px-tall ImageData using the FusionPixel12px font.
 * Anti-aliasing is removed by thresholding to pure black/white.
 */
function renderNewsText(text) {
  const h       = NEWS_H_TILES * TILE_PX;
  const fontStr = "12px 'FusionPixel12px', sans-serif";

  /* Measure text width */
  const c   = document.createElement('canvas');
  const ctx = require2dContext(c);
  ctx.font  = fontStr;
  const tw  = Math.min(Math.max(Math.ceil(ctx.measureText(text).width) + 4, 64), NEWS_MAX_WIDTH);

  /* Draw text */
  c.width = tw; c.height = h;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, tw, h);
  ctx.font      = fontStr;
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'bottom';
  ctx.imageSmoothingEnabled = false;
  ctx.fillText(text, 0, h);

  /* Threshold to B/W */
  const img = ctx.getImageData(0, 0, tw, h);
  thresholdBW(img);
  return img;
}

/**
 * Prepare an uploaded (or rendered) news image:
 *   1. Validate / pad height to 16 px
 *   2. Pad width to multiple of 16 with black
 *   3. Extend to NEWS_MAX_WIDTH with white (end marker)
 */
function prepareNewsImage(imgData) {
  const targetH = NEWS_H_TILES * TILE_PX;
  let w = imgData.width, h = imgData.height;

  if (h > targetH) throw new Error(`News image too tall: ${h}px (max ${targetH}px)`);
  if (w > NEWS_MAX_WIDTH) w = NEWS_MAX_WIDTH;

  /* Compute padded content width (multiple of 16, min 64, leave last 2 columns white) */
  let paddedW = Math.min(Math.ceil(Math.max(w, 64) / 16) * 16, NEWS_MAX_WIDTH - 2 * TILE_PX);

  /* Single canvas: black fill for content area, white fill for end marker */
  const c = document.createElement('canvas');
  c.width = NEWS_MAX_WIDTH; c.height = targetH;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, NEWS_MAX_WIDTH, targetH);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, paddedW, targetH);
  /* Clip source to paddedW so the last tile column stays white */
  const srcW = Math.min(imgData.width, paddedW);
  ctx.drawImage(imageDataToCanvas(imgData), 0, 0, srcW, imgData.height, 0, targetH - h, srcW, h);
  return ctx.getImageData(0, 0, NEWS_MAX_WIDTH, targetH);
}

/** Convert an image to 2BPP tiles in column-major order (for news ticker). */
function imageToTilesColumnMajor(imgData) {
  const d = imgData.data, w = imgData.width, h = imgData.height;
  const cols = w / TILE_PX, rows = h / TILE_PX;
  const out = [];
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      const shades = new Uint8Array(64);
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          shades[y * 8 + x] = shadeFromRgba(d, tilePixelIdx(row, col, y, x, w));
        }
      }
      out.push(encode2bpp(shades));
    }
  }
  return out;
}


/* --- Title Graphics Rendering --- */

/**
 * Render a game-title string into 16 tiles (128×8) of 2BPP data using
 * the GBMEM font.  Anti-aliasing is thresholded to pure B/W first.
 */
async function renderTitleImage(title) {
  await document.fonts.load("8px 'GBMEM'");

  const w = GAMEDB_GFX_TILES * TILE_PX, h = TILE_PX;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = require2dContext(c);

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.font = "8px 'GBMEM', sans-serif";
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';
  ctx.imageSmoothingEnabled = false;
  ctx.fillText(title, 0, 0);

  /* Threshold to B/W */
  const raw = ctx.getImageData(0, 0, w, h);
  thresholdBW(raw);

  /* Encode each 8×8 tile */
  const d = raw.data;
  const shades = [];
  for (let tx = 0; tx < GAMEDB_GFX_TILES; tx++) {
    const tile = new Uint8Array(64);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        tile[y * 8 + x] = shadeFromRgba(d, tilePixelIdx(0, tx, y, x, w));
      }
    }
    shades.push(encode2bpp(tile));
  }

  const result = new Uint8Array(256);
  for (let i = 0; i < shades.length; i++) result.set(shades[i], i * 16);
  return result;
}


/* --- ROM Utilities --- */

/** Read the ROM title from the cartridge header. */
function readCartTitle(data) {
  if (!data || data.length < 0x144) return '';
  let out = '';
  for (let i = 0x134; i < 0x144; i++) {
    const b = data[i];
    if (!b) break;
    out += String.fromCharCode(b);
  }
  return out.replace(/\s+$/, '');
}

/** Detect the target platform from the ROM header bytes. */
function detectPlatform(data) {
  if (data.length < 0x150) return 'DMG';
  const cgbFlag = data[0x143];
  if (cgbFlag === 0xC0) return 'CGB!';
  if (cgbFlag === 0x80) return 'CGB';
  if (data[0x14B] === 0x33 && data[0x146] === 0x03) return 'SGB';
  return 'DMG';
}

/** Round up to the next power of two. */
function nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p; }

/** Human-readable mapper name from the cartridge-type byte. */
function mapperName(ct) { return MAPPER_NAMES[ct] || 'Unknown'; }

/** Mapper label for builder UI/logs; patched games show original mapper as MBCx→5. */
function gameMapperLabel(game) {
  if (game?.mapperPatch) {
    const original = mapperName(game.originalCartType ?? game?.rom?.cartType);
    return `${original}→5`;
  }
  return mapperName(game?.rom?.cartType);
}

/**
 * Compute 256M register flags for a given mapper/SRAM combination.
 * These go into the v7002 register byte (bit layout per NP firmware):
 *   bit 2 (0x04) — MBC1 Advance Mode
 *   bit 5 (0x20) — Last SRAM Bank Mode
 *   bit 6 (0x40) — No SRAM Mode
 */
function v7002Flags(cartType, sramSize, romSize, cartTitle, sramSlot) {
  let flags = 0;
  const isMbc123 = MBC1_TYPES.has(cartType) || MBC2_TYPES.has(cartType) || MBC3_TYPES.has(cartType);
  const hasBackAlignedSramSlot =
    sramSlot !== undefined && sramSlot !== null && sramSlot >= 0 &&
    (sramSlot % 2) === 1 && canUseLastSramBankModeForSlot(sramSlot);
  if (isMbc123 && sramSize > 0 && sramSize < SRAM_SLOT_SIZE * 2 && hasBackAlignedSramSlot) {
    flags |= V7002_LAST_SRAM_BANK_MODE;
  }
  if (isAdvanceModeGameLike({ cartType, size: romSize, cartTitle })
      && sramSlot !== undefined && sramSlot !== null && sramSlot >= 0
      && LAST_SRAM_BANK_MODE_ALLOWED_BLOCKS.has(sramBlockIndexForSlot(sramSlot))) {
    flags |= V7002_MBC1_ADVANCE_MODE;
  }
  if (sramSize <= 0)            flags |= V7002_NO_SRAM_MODE;
  return flags;
}

function sramSlotOffset(slotIdx) {
  const page = Math.floor(slotIdx / 2) * SRAM_SLOT_PAIR_STRIDE;
  return page + (slotIdx % 2 ? SRAM_SLOT_ODD_OFFSET : 0);
}

function sramDataChunkOffset(startSlot, chunkIndex, chunkCount) {
  if (chunkCount > 1) {
    const base = Math.floor(startSlot / 2) * SRAM_SLOT_PAIR_STRIDE;
    return base + chunkIndex * SRAM_SLOT_SIZE;
  }
  return sramSlotOffset(startSlot + chunkIndex);
}

function sramBlockIndexForSlot(slotIdx) {
  return Math.floor(slotIdx / 2);
}

function canUseLastSramBankModeForSlot(slotIdx) {
  if (slotIdx === undefined || slotIdx === null || slotIdx < 0 || slotIdx >= SRAM_NUM_SLOTS) return false;
  return LAST_SRAM_BANK_MODE_ALLOWED_BLOCKS.has(sramBlockIndexForSlot(slotIdx));
}

function sramChunkLength(startSlot, chunkIndex, chunkCount, totalBytes, bufferLength = SRAM_TOTAL_SIZE) {
  const srcOff = chunkIndex * SRAM_SLOT_SIZE;
  const maxBytes = totalBytes ?? (chunkCount * SRAM_SLOT_SIZE);
  if (srcOff >= maxBytes) return 0;
  const dstOff = sramDataChunkOffset(startSlot, chunkIndex, chunkCount);
  if (dstOff < 0 || dstOff >= bufferLength) return 0;
  return Math.max(0, Math.min(
    SRAM_SLOT_SIZE,
    maxBytes - srcOff,
    bufferLength - dstOff,
  ));
}

function isPatchedMbc123ToMbc5(gameLike) {
  const cartType = gameLike?.cartType ?? gameLike?.rom?.cartType;
  if (!gameLike?.mapperPatch || cartType !== 0x19) return false;
  return MBC1_TYPES.has(gameLike.originalCartType)
      || MBC2_TYPES.has(gameLike.originalCartType)
      || MBC3_TYPES.has(gameLike.originalCartType);
}

function isMbc5CartType(gameLike) {
  const cartType = gameLike?.cartType ?? gameLike?.rom?.cartType;
  return mapperName(cartType) === 'MBC5';
}

function isAdvanceModeGameLike(gameLike) {
  const cartType = gameLike?.cartType ?? gameLike?.rom?.cartType;
  const romSize = gameLike?.size ?? gameLike?.rom?.size ?? 0;
  const title = String(gameLike?.cartTitle ?? gameLike?.rom?.cartTitle ?? '').trim().toUpperCase();
  return MBC1_TYPES.has(cartType) && romSize === 0x100000 && title === ADVANCE_MODE_TITLE;
}

function canUseOddSingleSramSlot(gameLike, slotIdx = null) {
  if (isMbc5CartType(gameLike)) return false;
  if (slotIdx === undefined || slotIdx === null) return true;
  if ((slotIdx % 2) === 0) return true;
  const cartType = gameLike?.cartType ?? gameLike?.rom?.cartType;
  const isMbc123 = MBC1_TYPES.has(cartType) || MBC2_TYPES.has(cartType) || MBC3_TYPES.has(cartType);
  if (!isMbc123) return true;
  return canUseLastSramBankModeForSlot(slotIdx);
}

function requiredSramSlots(romSize, sramSize, gameLike) {
  let slots = sramSize > 0x2000 ? 2 : 1;
  if (romSize > 0x400000) slots = Math.max(slots, 8);
  else if (romSize > 0x200000) slots = Math.max(slots, 4);
  if (isPatchedMbc123ToMbc5(gameLike)) slots = Math.max(slots, 2);
  return slots;
}

function isAutoSramSelection(gameLike) {
  return gameLike?.forceSramSlot === null || gameLike?.forceSramSlot === undefined;
}

function sramShareKey(startSlot, slotCount) {
  return `${startSlot}:${slotCount}`;
}

/**
 * Prepare flash data: for MBC1 ROMs >512 KiB the banks are reversed
 * (block-flip) to match the mapper wiring.
 */
function prepareFlashData(romData, romSize, cartType) {
  if (MBC1_TYPES.has(cartType) && romSize > MBC1_BLOCK_SIZE) {
    const out     = new Uint8Array(romData.length);
    const nBlocks = romSize / MBC1_BLOCK_SIZE;
    for (let i = 0; i < nBlocks; i++) {
      const src = i * MBC1_BLOCK_SIZE;
      const dst = (nBlocks - 1 - i) * MBC1_BLOCK_SIZE;
      out.set(romData.subarray(src, src + MBC1_BLOCK_SIZE), dst);
    }
    return out;
  }
  return romData;
}

function shouldRestoreMbc1BlockOrder(gameLike) {
  const romSize = gameLike?.romSize ?? gameLike?.size ?? gameLike?.rom?.size ?? 0;
  if (romSize <= MBC1_BLOCK_SIZE) return false;
  const cartType = gameLike?.cartType ?? gameLike?.rom?.cartType;
  const hasAdvanceModeFlag = ((gameLike?.v7002 ?? 0) & V7002_MBC1_ADVANCE_MODE) !== 0;
  return MBC1_TYPES.has(cartType) || hasAdvanceModeFlag;
}

function restoreExtractedRomData(romData, gameLike) {
  if (!shouldRestoreMbc1BlockOrder(gameLike)) return romData;
  const romSize = gameLike?.romSize ?? gameLike?.size ?? gameLike?.rom?.size ?? romData.length;
  // MBC1 512 KiB+ images are block-flipped in flash; undo that for extracted files.
  return prepareFlashData(romData, romSize, 0x01);
}

/** Pre-validate a game ROM; returns an error reason or null. */
function validateGame(romInfo) {
  const mapper  = mapperName(romInfo.cartType);
  const maxSize = MAPPER_MAX_SIZE[mapper];
  if (maxSize && romInfo.size > maxSize) return 'ROM too big for mapper';
  return null;
}


/* --- Natural Sort (for file-name ordering) --- */

function natSortKey(fname) {
  const stem  = fname.replace(/\.[^.]+$/, '');
  const parts = stem.toLowerCase().split(/(\d+)/);
  return parts.map(p => /^\d+$/.test(p) ? p.padStart(20, '0') : p).join('');
}


/* --- Core Placement Algorithm & Flash Packing --- */

/**
 * Core placement algorithm – single source of truth for both
 * the UI simulation and the actual flash build.
 *
 * @param {Array} entries – [{idx, size, cartType, sramSize, forceNoSram, forceSramSlot}, ...]
 * @returns {Array} entries enriched with { offset, sramSlot, skipReason, warnReason }
 *
 * Placement strategy:
 *   - Admit games in list order so earlier entries have higher priority.
 *   - Recompute all auto SRAM placements from scratch on every run.
 *   - Search SRAM block/slot assignments while avoiding odd single-slot
 *     placements until they are actually needed.
 *   - Pack non-SRAM games into the remaining flash after SRAM-constrained
 *     games have been placed.
 */
function computePlacements(entries) {
  let exactPackUsed = false;
  const blockSpan = n => n > 2 ? n / 2 : 1;

  /* Sorted-interval helpers; occ = [{s,e},...] kept ascending by s. */
  const insertOcc = (occ, s, size) => {
    let i = 0;
    while (i < occ.length && occ[i].s < s) i++;
    occ.splice(i, 0, { s, e: s + size });
  };
  const isFree = (occ, s, size) => {
    const e = s + size;
    for (const r of occ) {
      if (r.e <= s) continue;
      if (r.s >= e) break;
      return false;
    }
    return true;
  };
  const cloneOcc = occ => occ.map(r => ({ ...r })).sort((a, b) => a.s - b.s);

  const alignedStarts = (rs, re, size) => {
    const out = [];
    const limit = Math.min(re, FLASH_SIZE);
    let pos = Math.max(rs, MENU_SIZE);
    if (pos % size) pos += size - (pos % size);
    for (; pos + size <= limit; pos += size) out.push(pos);
    return out;
  };

  /* Greedy first-fit pack: largest games first, tie-break by idx. */
  const greedyPack = (games, rs, re, seed) => {
    const occ = cloneOcc(seed);
    const placements = new Map();
    for (const g of [...games].sort((a, b) => b.size - a.size || a.idx - b.idx)) {
      const pos = alignedStarts(rs, re, g.size).find(p => isFree(occ, p, g.size));
      if (pos === undefined) return null;
      insertOcc(occ, pos, g.size);
      placements.set(g.idx, pos);
    }
    return { placements, occupied: occ };
  };

  /* Exact DFS rescue (bank-bitmask + memoised dead-ends). */
  const exactPack = (games, rs, re, seed) => {
    const baseBank = (rs / BANK_SIZE) | 0;
    const maskFor = (bs, bc) => ((1n << BigInt(bc)) - 1n) << BigInt(bs);
    const items = games.map(g => ({
      g,
      cands: alignedStarts(rs, re, g.size).map(p => ({
        pos: p,
        mask: maskFor(((p / BANK_SIZE) | 0) - baseBank, (g.size / BANK_SIZE) | 0),
      })),
    })).sort((a, b) => a.cands.length - b.cands.length || b.g.size - a.g.size || a.g.idx - b.g.idx);

    if (items.some(it => it.cands.length === 0)) return null;
    let width = 1;
    for (const it of items) if ((width *= it.cands.length) > 50000) return null;

    let initMask = 0n;
    for (const r of seed) initMask |= maskFor(((r.s / BANK_SIZE) | 0) - baseBank, ((r.e - r.s) / BANK_SIZE) | 0);

    const failed = new Set();
    const dfs = (i, mask) => {
      if (i >= items.length) return new Map();
      const key = `${i}:${mask}`;
      if (failed.has(key)) return null;
      for (const c of items[i].cands) {
        if (mask & c.mask) continue;
        const rest = dfs(i + 1, mask | c.mask);
        if (rest) { rest.set(items[i].g.idx, c.pos); return rest; }
      }
      failed.add(key);
      return null;
    };
    return dfs(0, initMask);
  };

  const packRegion = (games, rs, re, seed) => {
    const greedy = greedyPack(games, rs, re, seed);
    if (greedy) return greedy;
    if (games.length > 12) return null;
    const exact = exactPack(games, rs, re, seed);
    if (!exact) return null;
    exactPackUsed = true;
    const occ = cloneOcc(seed);
    for (const g of games) insertOcc(occ, exact.get(g.idx), g.size);
    return { placements: exact, occupied: occ };
  };

  /* Pre-process: validate, classify, compute SRAM requirements. */
  const maxGames = GAMEDB_GAMES_PER_BANK * 4;
  const work = entries.map((g, i) => {
    const w = { ...g, idx: g.idx ?? i, offset: undefined, sramSlot: undefined, warnReason: undefined };
    w._hasSram = (w.sramSize || 0) > 0 && !w.forceNoSram;
    w._reqSramSlots = w._hasSram ? requiredSramSlots(w.size, w.sramSize || 0, w) : 0;
    if (i >= maxGames && !w.skipReason) w.skipReason = 'exceeds max ROM count';
    if (!w.skipReason) w.skipReason = validateGame({ cartType: w.cartType, size: w.size }) || undefined;
    if (!w.skipReason && w._hasSram && w.forceSramSlot != null) {
      const f = w.forceSramSlot, n = f + 1;
      if (f < 0 || f >= SRAM_NUM_SLOTS) w.skipReason = `invalid SRAM slot #${n}`;
      else if (w._reqSramSlots > 1 && (f & 1)) w.skipReason = `SRAM slot #${n}: invalid start`;
      else if (w._reqSramSlots === 1 && (f & 1) && !canUseOddSingleSramSlot(w, f)) w.skipReason = `SRAM slot #${n}: unsupported odd-slot mode`;
    }
    if (w.sramSize > SRAM_SLOT_SIZE * 2) w.warnReason = 'SRAM > 32 KiB (truncated)';
    return w;
  });

  /* Build SRAM groups. Manually-forced games sharing (slot, slotCount) merge. */
  const manual = new Map();
  const sramGroups = [];
  for (const g of work) {
    if (g.skipReason || !g._hasSram) continue;
    const reqSlots = g._reqSramSlots;
    if (g.forceSramSlot != null) {
      const k = sramShareKey(g.forceSramSlot, reqSlots);
      let grp = manual.get(k);
      if (!grp) {
        grp = { key: `manual:${k}`, games: [], reqSlots, blockSpan: blockSpan(reqSlots),
                fixedStartSlot: g.forceSramSlot, auto: false, minIdx: g.idx, totalSize: 0 };
        manual.set(k, grp);
        sramGroups.push(grp);
      }
      grp.games.push(g);
      grp.totalSize += g.size;
      grp.minIdx = Math.min(grp.minIdx, g.idx);
    } else {
      sramGroups.push({ key: `auto:${g.idx}`, games: [g], reqSlots, blockSpan: blockSpan(reqSlots),
                       fixedStartSlot: null, auto: true, minIdx: g.idx, totalSize: g.size });
    }
  }
  sramGroups.sort((a, b) => {
    const am = a.fixedStartSlot != null, bm = b.fixedStartSlot != null;
    if (am !== bm) return am ? -1 : 1;
    return (b.blockSpan - a.blockSpan) || (b.reqSlots - a.reqSlots)
        || (b.totalSize - a.totalSize) || (a.minIdx - b.minIdx);
  });

  /* Slot starts to try for one group. Even slots first, odd singles only if allowed. */
  const candidateStarts = (group, used) => {
    if (group.fixedStartSlot != null) return [group.fixedStartSlot];
    const req = group.reqSlots;
    const needsAdvance = group.auto && group.games.some(isAdvanceModeGameLike);
    const allowOddSingles = req === 1 && group.games.every(canUseOddSingleSramSlot);
    const order = [];
    for (let s = 0; s < SRAM_NUM_SLOTS; s += 2) order.push(s);
    if (allowOddSingles) for (let s = 1; s < SRAM_NUM_SLOTS; s += 2) order.push(s);

    const out = [];
    for (const s of order) {
      const end = s + req - 1;
      if (end >= SRAM_NUM_SLOTS) continue;
      if (req > 1 && (s & 1)) continue;
      if (req === 1 && (s & 1) && !group.games.every(g => canUseOddSingleSramSlot(g, s))) continue;
      const startBlock = s >> 1;
      if (group.blockSpan > 1 && startBlock % group.blockSpan) continue;
      if (needsAdvance && !LAST_SRAM_BANK_MODE_ALLOWED_BLOCKS.has(startBlock)) continue;
      let blocked = false;
      for (let k = s; k <= end; k++) if (used[k]) { blocked = true; break; }
      if (!blocked) out.push(s);
    }
    return out;
  };

  /* Place SRAM groups (consume slots + flash regions). */
  const usedSlots = new Array(SRAM_NUM_SLOTS).fill(null);
  const blockStates = Array.from({ length: FLASH_SIZE / SRAM_BLOCK }, () => ({ occupied: [] }));
  const occupied = [];

  for (const group of sramGroups) {
    let placed = false;
    for (const s of candidateStarts(group, usedSlots)) {
      const startBlock = s >> 1;
      const endBlock = (s + group.reqSlots - 1) >> 1;
      const sharable = group.blockSpan === 1 && group.reqSlots === 1 ? blockStates[startBlock] : null;
      const packed = packRegion(group.games, startBlock * SRAM_BLOCK, (endBlock + 1) * SRAM_BLOCK,
                                sharable ? sharable.occupied : []);
      if (!packed) continue;

      for (let k = s; k < s + group.reqSlots; k++) usedSlots[k] = group.key;
      if (sharable) sharable.occupied = packed.occupied;
      for (const g of group.games) {
        g.offset = packed.placements.get(g.idx);
        g.sramSlot = s;
        insertOcc(occupied, g.offset, g.size);
      }
      placed = true;
      break;
    }
    if (!placed) {
      const reason = group.fixedStartSlot != null
        ? `SRAM slot #${group.fixedStartSlot + 1}: no free space`
        : 'exceeds max SRAM slots';
      for (const g of group.games) g.skipReason = reason;
    }
  }

  /* Fill remaining flash with non-SRAM games (small-first, first-fit). */
  const noSram = work.filter(g => !g.skipReason && !g._hasSram)
                     .sort((a, b) => a.size - b.size || a.idx - b.idx);
  for (const g of noSram) {
    const pos = alignedStarts(MENU_SIZE, FLASH_SIZE, g.size).find(p => isFree(occupied, p, g.size));
    if (pos === undefined) { g.skipReason = "Can't fit in flash"; continue; }
    g.offset = pos;
    insertOcc(occupied, pos, g.size);
  }

  /* Sync results back to caller's entries and score. */
  let placed = 0, sramSkipped = 0, skipped = 0, oddAutoSingleSlot = 0;
  for (let i = 0; i < entries.length; i++) {
    const w = work[i], e = entries[i];
    e.offset = w.offset; e.sramSlot = w.sramSlot;
    e.skipReason = w.skipReason; e.warnReason = w.warnReason;
    if (w.offset !== undefined) {
      placed++;
      if (w._hasSram && isAutoSramSelection(w) && w._reqSramSlots === 1
          && w.sramSlot != null && (w.sramSlot & 1)) oddAutoSingleSlot++;
    } else if (w.skipReason) {
      skipped++;
      if (w._hasSram && w.skipReason === 'exceeds max SRAM slots') sramSkipped++;
    }
  }

  entries.placementMeta = {
    strategy: 'greedy-sram-first',
    rescueUsed: exactPackUsed,
    score: { placed, sramSkipped, skipped, oddAutoSingleSlot },
    accepted: placed,
    searchExhausted: false,
  };
  return entries;
}

/**
 * Pack all game ROMs into a 32 MiB flash image.
 * Uses computePlacements() for the placement algorithm, then writes flash data.
 * Returns { flash, outSize, regs, skipped, warnings, placementMeta }.
 */
function packRoms(games) {
  const flash = new Uint8Array(FLASH_SIZE);
  flash.fill(0xFF);

  /* Build uniform entries for the shared placement algorithm */
  const entries = games.map((g, i) => ({
    idx: i, size: g.rom?.size || 0, cartType: g.rom?.cartType,
    cartTitle: g.rom?.cartTitle || '',
    crc32: g.crc32,
    originalCartType: g.originalCartType,
    sramSize: g.rom?.sramSize || 0, forceNoSram: g.forceNoSram,
    forceSramSlot: g.forceSramSlot,
    skipReason: g.rom ? undefined : 'no ROM data',
    offset: undefined, sramSlot: undefined, warnReason: undefined,
    /* back-references for flash writing & regs */
    rom: g.rom, title: g.title, index: g.index, mapperPatch: g.mapperPatch,
  }));

  computePlacements(entries);

  /* Write placed ROMs into the flash image */
  for (const g of entries) {
    if (g.offset === undefined || !g.rom) continue;
    
    /* Apply mapper patch if available */
    let romData = g.rom.data;
    if (g.mapperPatch) {
      try {
        const patchBuf = b64ToUint8Array(g.mapperPatch);
        romData = new Uint8Array(applyBpsPatch(patchBuf, g.rom.data));
      } catch (e) {
        log('warn', `  Failed to apply mapper patch to ${g.title}: ${e.message}`);
      }
    }
    
    const flashData = prepareFlashData(romData, g.size, g.cartType);
    flash.set(flashData.subarray(0, g.size), g.offset);
  }

  /* Compute mapper registers for each placed game */
  const regs = {};
  for (const g of entries) {
    if (g.offset === undefined) continue;
    const cgbFlag       = g.rom.data.length > 0x143 ? g.rom.data[0x143] : 0;
    const bankNum       = Math.floor(g.offset / BANK_PAIR_SIZE);
    const effectiveSram = g.forceNoSram ? 0 : g.sramSize;
    regs[g.index] = {
      v7000: bankNum & 0xFF,
      v7001: (256 - g.size / BANK_PAIR_SIZE) & 0xFF,
      v7002: ((bankNum >> 8) & 0x03) | v7002Flags(g.cartType, effectiveSram, g.size, g.cartTitle, g.sramSlot),
      cgbFlag,
      flashOffset: g.offset,
      sramSlot: g.sramSlot,
    };
  }

  /* Final output size (rounded to next power-of-two) */
  let last = MENU_SIZE;
  for (const g of entries) if (g.offset !== undefined) last = Math.max(last, g.offset + g.size);
  const outSize = Math.max(nextPow2(last), MENU_SIZE * 2);

  const skipped  = [];
  const warnings = [];
  for (const g of entries) {
    if (g.offset === undefined && g.skipReason) skipped.push([g.title, g.skipReason]);
    if (g.warnReason) warnings.push([g.title, g.warnReason]);
  }

  const placementMeta = entries.placementMeta || null;

  return { flash, outSize, regs, skipped, warnings, placementMeta };
}


/* --- Placement Simulation (uses shared algorithm) --- */

/**
 * Run a placement simulation without allocating 32 MiB.
 * Calls the same computePlacements() used by packRoms() so the
 * UI preview is guaranteed to match the final build output.
 *
 * Returns { [gameIndex]: { offset, v7000, v7001, v7002, sramSlot, skip } }
 */
function simulatePlacements() {
  const entries = state.games.map((g, i) => ({
    idx: i, size: g.rom.size, cartType: g.rom.cartType,
    cartTitle: g.rom.cartTitle || '',
    crc32: g.crc32,
    originalCartType: g.originalCartType,
    mapperPatch: g.mapperPatch,
    sramSize: g.rom.sramSize, forceNoSram: g.forceNoSram,
    forceSramSlot: g.forceSramSlot,
    offset: undefined, sramSlot: undefined,
    skipReason: undefined, warnReason: undefined,
  }));

  computePlacements(entries);

  /* Format results for the UI */
  const results = {};
  for (const g of entries) {
    if (g.offset !== undefined) {
      const bn    = Math.floor(g.offset / BANK_PAIR_SIZE);
      const eSram = g.forceNoSram ? 0 : g.sramSize;
      results[g.idx] = {
        offset: g.offset,
        v7000: bn & 0xFF,
        v7001: (256 - g.size / BANK_PAIR_SIZE) & 0xFF,
        v7002: ((bn >> 8) & 0x03) | v7002Flags(g.cartType, eSram, g.size, g.cartTitle, g.sramSlot),
        sramSlot: g.sramSlot,
      };
    } else {
      results[g.idx] = {
        offset: null, v7000: null,
        v7001: (256 - g.size / BANK_PAIR_SIZE) & 0xFF,
        v7002: v7002Flags(g.cartType, g.forceNoSram ? 0 : g.sramSize, g.size, g.cartTitle, g.sramSlot),
        sramSlot: null, skip: g.skipReason,
      };
    }
  }
  return results;
}


/* --- Text Encoding & Checksum Fixing --- */

/** Encode a string into a fixed-size byte field, padded with `pad`. */
function encodeField(text, size, pad = 0x20) {
  const enc = new TextEncoder();
  const raw = enc.encode(text || '').slice(0, size);
  const result = new Uint8Array(size);
  result.fill(pad);
  result.set(raw);
  return result;
}

/**
 * Fix all three checksum fields inside the ROM:
 *   1. Header checksum   (0x014D)
 *   2. Menu checksum      (0x0002-0x0003, first 128 KiB)
 *   3. Global checksum    (0x014E-0x014F)
 *
 * Also computes a timestamp compensation block at 0x1FEFF.
 */
function fixChecksums(rom) {
  const total = rom.length;

  /* 1. Header checksum */
  let hdrSum = 0;
  for (let addr = 0x0134; addr < 0x014D; addr++) hdrSum = (hdrSum - rom[addr] - 1) & 0xFF;
  rom[0x014D] = hdrSum;

  /* Timestamp compensation */
  let timestampSum = 0;
  for (let bankIdx = 0; bankIdx < 4; bankIdx++) {
    const bankBase = GAMEDB_BANK4_BASE + bankIdx * BANK_SIZE;
    for (let slotInBank = 0; slotInBank < GAMEDB_SLOTS_PER_BANK; slotInBank++) {
      const slotOff = bankBase + GAMEDB_HEADER_SIZE + slotInBank * GAMEDB_SLOT_SIZE;
      if (slotOff + GAMEDB_SLOT_SIZE > total) break;
      const tsEnd = slotOff + GAMEDB_TS_OFFSET + GAMEDB_TIMESTAMP_SIZE;
      for (let b = slotOff + GAMEDB_TS_OFFSET; b < tsEnd; b++) timestampSum = (timestampSum + rom[b]) >>> 0;
    }
  }
  const target   = (-timestampSum) & 0xFFFF;
  const compData = new Uint8Array(TS_COMP_SIZE);
  compData.fill(255);
  let subtract = (0xFFFF - target) & 0xFFFF;
  for (let i = TS_COMP_SIZE - 1; i >= 0; i--) {
    if (subtract === 0) break;
    const deduct = Math.min(255, subtract);
    compData[i] = 255 - deduct;
    subtract -= deduct;
  }
  rom.set(compData, TS_COMP_ADDR);

  /* Zero checksum fields before calculation */
  rom[0x0002] = rom[0x0003] = 0;
  rom[0x014E] = rom[0x014F] = 0;

  /* 2. Menu checksum (first 128 KiB) */
  let sum128 = 0;
  for (let i = 0; i < Math.min(total, 0x20000); i++) sum128 = (sum128 + rom[i]) & 0xFFFF;
  rom[0x0002] = (sum128 >> 8) & 0xFF;
  rom[0x0003] = sum128 & 0xFF;

  /* 3. Global checksum */
  let gsum = 0;
  for (let i = 0; i < total; i++) gsum = (gsum + rom[i]) & 0xFFFF;
  rom[0x014E] = (gsum >> 8) & 0xFF;
  rom[0x014F] = gsum & 0xFF;

  return gsum;
}


/* --- Application State --- */

const state = PAGE === 'builder'
  ? { menuRom: null, games: [], savFiles: {}, bgImages: [], bgCgb: null, bgDmg: null, newsImage: null, tickerMode: 'text', cgbRenderMode: 'asis', dmgThresholdLow: 64, dmgThresholdHigh: 192, cgbThresholdLow: 64, cgbThresholdHigh: 192, dmgInvert: false, cgbInvert: false, cgbColor0: '#ffffff', cgbColor3: '#000000', cgbSecondary1: '#aaaaaa', cgbSecondary2: '#555555', enableMusic: true, skipRebootOnCgbGames: false }
  : { romData: null, romName: '', savData: null, savName: '', games: [] };

/* --- Mapper Patches (loaded from mapper_patches_b64.js) --- */

let mapperPatches = {};

/** Load mapper patches from embedded constant. */
function loadMapperPatches() {
  try {
    if (typeof MAPPER_PATCHES === 'object' && MAPPER_PATCHES !== null) {
      mapperPatches = MAPPER_PATCHES;
    } else {
      log('warn', 'Mapper patches constant not available');
    }
  } catch (e) {
    log('warn', `Failed to load mapper patches: ${errorMessage(e)}`);
  }
}

/** Default news text with today's date baked in. */
function getDefaultTickerText() {
  const d  = new Date();
  const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `This collection was created on ${ds}.`;
}


/* --- File Handling --- */

/** Handle one or more dropped / selected files. */
async function handleFilesBuilder(fileList) {
  const files = [...fileList];
  const dirty = { menu: false, games: false, bg: false, news: false };

  for (const file of files) {
    const ext = getFileExtension(file.name);
    const buf = new Uint8Array(await file.arrayBuffer());

    /* Menu ROM? (check CRC of first 96 KiB) */
    if (ROM_EXTS.includes(ext) && buf.length >= MENU_CRC32_RANGE) {
      if (crc32(buf, 0, MENU_CRC32_RANGE) === MENU_CRC32_EXPECTED) { addMenuRom(file.name, buf); dirty.menu = true; continue; }
    }

    /* Save file? */
    if (ext === '.sav') { addSavFile(file.name, buf); dirty.games = true; continue; }

    /* Game ROM? */
    if (ROM_EXTS.includes(ext)) { addGameRom(file.name, buf); dirty.games = true; continue; }

    /* Image? */
    if (ext === '.png' || ext === '.bmp') {
      try {
        const img     = await loadImage(buf, ext === '.png' ? 'image/png' : 'image/bmp');
        const imgData = getImageData(img);
        /* News-ticker image: exactly 14 px tall, 64-4080 px wide */
        if (imgData.height === 14 && imgData.width >= 64 && imgData.width <= 4080) { addNewsImage(file.name, imgData); dirty.news = true; continue; }
        /* Otherwise treat as background */
        addBgImage(file.name, imgData); dirty.bg = true; continue;
      } catch (e) {
        log('warn', `Could not load image: ${file.name}: ${e.message}`);
      }
    }

    log('warn', `Unrecognized file: ${file.name}`);
  }

  /* Only refresh containers that actually changed */
  if (dirty.menu)  updateMenuUI();
  if (dirty.games) updateGamesUI();
  if (dirty.bg)    updateBgUI();
  if (dirty.news)  updateNewsUI();
}

/** Store the menu ROM (truncated to 96 KiB if larger). */
function addMenuRom(name, data) {
  const kioskId = data.length > 0x1C1D9
    ? String.fromCharCode(...data.slice(0x1C1D1, 0x1C1D9)).trim()
    : '';
  if (data.length > 0x18000) data = data.slice(0, 0x18000);
  state.menuRom = { name, data, kioskId };
  log('ok', `Menu ROM loaded: ${name} (${formatSize(data.length)})`);
}

/** Parse & store a game ROM. */
function addGameRom(name, data) {
  if (data.length < 0x150) { log('warn', `${name}: too small to be a valid ROM`); return; }
  if (data.length > 0x800000) { log('warn', `${name}: ROM too large (${formatSize(data.length)}) – max 8 MiB supported`); return; }

  /* Validate Nintendo boot logo (CRC32 of $0104-$0133) */
  const logoCrc = crc32(data, 0x104, 0x134);
  if (logoCrc !== 0x46195417) {
    log('warn', `${name}: invalid boot logo (CRC32 ${logoCrc.toString(16).padStart(8, '0')} ≠ 46195417)`);
    return;
  }

  /* Validate header checksum ($014D) */
  let hdrSum = 0;
  for (let i = 0x134; i < 0x14D; i++) hdrSum = (hdrSum - data[i] - 1) & 0xFF;
  if (hdrSum !== data[0x14D]) {
    log('warn', `${name}: header checksum mismatch (computed ${hdrSum.toString(16).padStart(2, '0')} ≠ ${data[0x14D].toString(16).padStart(2, '0')})`);
    return;
  }

  const stem = name.replace(/\.[^.]+$/, '');
  if (state.games.find(g => g.name === name)) { log('info', `${name}: already added`); return; }

  const cartType  = data[0x147];
  const cartTitle = readCartTitle(data);
  let sramSize    = SRAM_SIZES[data[0x149]] || 0;
  if (MBC2_TYPES.has(cartType)) sramSize = 512;

  const romSize = nextPow2(data.length);
  const padded  = new Uint8Array(romSize);
  padded.fill(0xFF);
  padded.set(data);

  const platform = detectPlatform(data);

  /* ECJ flag: CRC32 of first $150 bytes identifies the specific ROM */
  const ecjFlag = (data.length >= 0x150 && crc32(data, 0, 0x150) === 0x6715F5ED) ? 1 : 0;

  /* Calculate full ROM CRC32 to check for mapper patches */
  const fullCrc32 = crc32(data).toString(16).toUpperCase().padStart(8, '0');
  const unsupportedCrc32 = UNSUPPORTED_CRC32.has(fullCrc32);
  let mapperPatch = null;
  if (mapperPatches[fullCrc32]) {
    mapperPatch = mapperPatches[fullCrc32];
    log('ok', `${stem}: mapper patch found for CRC32 0x${fullCrc32}`);
  }
  if (unsupportedCrc32) {
    log('warn', `${stem}: This game may be unsupported.`);
  }

  /* Patched ROMs must run as MBC5 on this cart. */
  const effectiveCartType = mapperPatch ? 0x19 : cartType;

  state.games.push({
    name, stem,
    title: stem.replace(/^#\d+\s*/, ''),
    data:  padded,
    rom:   { data: padded, size: romSize, sramSize, cartType: effectiveCartType, cartTitle },
    originalCartType: cartType,
    platform,
    ecjFlag,
    crc32: fullCrc32,
    unsupportedCrc32: unsupportedCrc32,
    mapperPatch,
    savData:       state.savFiles[stem] || null,
    forceNoSram:   false,
    forceSramSlot: null,
  });

  /* Keep games sorted naturally by filename */
  state.games.sort((a, b) => natSortKey(a.name).localeCompare(natSortKey(b.name)));

  const mapperLabel = mapperPatch ? `${mapperName(cartType)}→5` : mapperName(effectiveCartType);
  log('ok', `Game added: ${stem} (${formatSize(romSize)}, ${mapperLabel})`);
}

/** Store a .sav file and link it to an existing game by stem name. */
function addSavFile(name, data) {
  const stem = name.replace(/\.[^.]+$/, '');
  state.savFiles[stem] = data;
  for (const g of state.games) {
    if (g.stem === stem) g.savData = data;
  }
  log('ok', `Save file added: ${name} (${formatSize(data.length)})`);
}


/* --- Background Image Handling --- */

/** Process and store a CGB background image. */
function processCgbSlot(name, imgData, warnings) {
  const srcImgData = imgData;
  let cgbData = imgData;
  let colorsReduced = false;
  let tilesReduced = false;
  try {
    processBgCgb(cgbData);
  } catch (e) {
    if (!(e instanceof Error) || !/more than \d+ custom colors|needs \d+ palettes|not covered by any palette|more than \d+ unique/.test(e.message)) throw e;
    const result = reduceColorsForCgb(cgbData);
    cgbData = result.imgData;
    colorsReduced = result.colorsReduced;
    tilesReduced = result.tilesReduced;
    if (colorsReduced) warnings.push(`CGB: Colors were auto-reduced (max 2 non-BW colors per 8×8 tile, max ${BG_MAX_PALETTES * 2} custom colors / ${BG_MAX_PALETTES} palettes).`);
    if (tilesReduced)  warnings.push(`CGB: Tiles were auto-merged to fit ${BG_MAX_UNIQUE_TILES} VRAM slots (max ${BG_MAX_NONFONT_TILES} slots outside of menu text area).`);
  }
  state.bgCgb = { name, srcImgData, imgData: cgbData, colorsReduced, tilesReduced };
  log('ok', `CGB background loaded: ${name}`);
}

/** Quantize a luminance value to one of 4 DMG shades using state thresholds. */
function dmgQuantize(v) {
  return grayQuantize(v, state.dmgThresholdLow, state.dmgThresholdHigh);
}

/** Process and store a DMG background image. */
function processDmgSlot(name, imgData, warnings, silent) {
  const srcImgData = imgData;
  let tilesReduced = false;
  const sized = ensureScreenSize(imgData);
  const dmgPx = new Uint8ClampedArray(sized.data.length);
  for (let i = 0; i < sized.data.length; i += 4) {
    const v = luminance(sized.data[i], sized.data[i + 1], sized.data[i + 2]);
    dmgPx[i] = dmgPx[i + 1] = dmgPx[i + 2] = dmgQuantize(v);
    dmgPx[i + 3] = 255;
  }
  let dmgData = new ImageData(dmgPx, sized.width, sized.height);
  try {
    processBgDmg(dmgData);
  } catch (e) {
    if (!(e instanceof Error) || !/more than \d+ unique/.test(e.message)) throw e;
    const result = reduceForDmg(imgData);
    dmgData = result.imgData;
    tilesReduced = result.tilesReduced;
    if (tilesReduced) warnings.push(`DMG: Tiles were auto-merged to fit ${BG_MAX_UNIQUE_TILES} VRAM slots (max ${BG_MAX_NONFONT_TILES} slots outside of menu text area).`);
  }
  state.bgDmg = { name, srcImgData, imgData: dmgData, tilesReduced };
  if (!silent) log('ok', `DMG background loaded: ${name}`);
}

/**
 * Import a background image into the image pool (max 2).
 * Auto-assigns to CGB/DMG slots that have no image yet.
 */
function addBgImage(name, imgData) {
  if (state.bgImages.length >= 2) {
    /* Remove the oldest image to make room */
    removeBgImage(0);
  }

  const warnings = [];
  if (imgData.width > 160 || imgData.height > 144)
    warnings.push(`Image is ${imgData.width}×${imgData.height}, will be scaled to 160×144.`);

  const idx = state.bgImages.length;
  state.bgImages.push({ name, srcImgData: imgData });

  /* Auto-assign to unoccupied slots */
  if (!state.bgCgb) { processCgbSlot(name, imgData, warnings); state.bgCgb._srcIdx = idx; }
  if (!state.bgDmg) { processDmgSlot(name, imgData, warnings); state.bgDmg._srcIdx = idx; }

  if (warnings.length) for (const w of warnings) log('warn', `${name}: ${w}`);
  log('ok', `Background image added: ${name}`);
  scheduleBgPreviewUpdate();
}

/** Remove a background image from the pool by index. */
function removeBgImage(idx) {
  state.bgImages.splice(idx, 1);
  /* Adjust or clear slot references */
  if (state.bgCgb) {
    if (state.bgCgb._srcIdx === idx) { state.bgCgb = null; }
    else if (state.bgCgb._srcIdx > idx) { state.bgCgb._srcIdx--; }
  }
  if (state.bgDmg) {
    if (state.bgDmg._srcIdx === idx) { state.bgDmg = null; }
    else if (state.bgDmg._srcIdx > idx) { state.bgDmg._srcIdx--; }
  }
  updateBgUI();
  scheduleBgPreviewUpdate();
}

/** Assign a background image (by pool index) to a CGB or DMG slot, or clear the slot. */
function assignBgSlot(slot, idx) {
  const warnings = [];
  if (idx === '') {
    /* Clear the slot → use default */
    if (slot === 'cgb') state.bgCgb = null;
    else state.bgDmg = null;
  } else {
    const i = parseInt(idx, 10);
    if (Number.isNaN(i)) return;
    const img = state.bgImages[i];
    if (!img) return;
    if (slot === 'cgb') {
      processCgbSlot(img.name, img.srcImgData, warnings);
      state.bgCgb._srcIdx = i;
    } else {
      processDmgSlot(img.name, img.srcImgData, warnings);
      state.bgDmg._srcIdx = i;
    }
  }
  if (warnings.length) for (const w of warnings) log('warn', w);
  scheduleBgPreviewUpdate();
}

/**
 * Merge visually-similar tiles until the unique tile count fits within maxTiles.
 * @param {Object} opts
 * @param {Uint8ClampedArray} opts.px   Pixel array (RGBA, 160×144)
 * @param {number}   opts.w             Image width (160)
 * @param {number}   opts.maxTiles      Max unique non-font tiles
 * @param {function} opts.extractTile   (ty, tx) → Uint8Array  tile data
 * @param {function} opts.writeTile     (ty, tx, data) → void  write tile back
 * @returns {boolean} true if any tiles were merged
 */
function mergeSimilarTiles({ px, w, maxTiles, extractTile, writeTile }) {
  const isFont = (ty, tx) =>
    ty >= BG_FONT_ROW_FROM && ty < BG_FONT_ROW_TO && tx >= BG_FONT_COLUMN_FROM && tx < BG_FONT_COLUMN_TO;

  const fingerprints = new Map();
  for (let ty = 0; ty < BG_SCREEN_H; ty++) {
    for (let tx = 0; tx < BG_SCREEN_W; tx++) {
      if (isFont(ty, tx)) continue;
      const data = extractTile(ty, tx);
      const fp = tileKey(data);
      if (!fingerprints.has(fp))
        fingerprints.set(fp, { positions: [], data });
      fingerprints.get(fp).positions.push({ ty, tx });
    }
  }

  let didMerge = false;
  while (fingerprints.size > maxTiles) {
    didMerge = true;
    let leastFp = null, leastN = Infinity;
    for (const [fp, info] of fingerprints) {
      if (info.positions.length < leastN) { leastN = info.positions.length; leastFp = fp; }
    }
    const lData = fingerprints.get(leastFp).data;
    let bestFp = null, bestD = Infinity;
    for (const [fp, info] of fingerprints) {
      if (fp === leastFp) continue;
      let d = 0;
      for (let i = 0; i < lData.length; i++) { const v = lData[i] - info.data[i]; d += v * v; }
      if (d < bestD) { bestD = d; bestFp = fp; }
    }
    const bestData = fingerprints.get(bestFp).data;
    for (const { ty, tx } of fingerprints.get(leastFp).positions)
      writeTile(ty, tx, bestData);
    fingerprints.get(bestFp).positions.push(...fingerprints.get(leastFp).positions);
    fingerprints.delete(leastFp);
  }
  return didMerge;
}

/** Merge similar grayscale tiles in an RGBA pixel buffer. */
function mergeGrayTiles(px, w) {
  return mergeSimilarTiles({
    px, w, maxTiles: BG_MAX_NONFONT_TILES,
    extractTile(ty, tx) {
      const gray = new Uint8Array(64);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++)
        gray[y * 8 + x] = px[tilePixelIdx(ty, tx, y, x, w)];
      return gray;
    },
    writeTile(ty, tx, data) {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const i = tilePixelIdx(ty, tx, y, x, w);
        const g = data[y * 8 + x];
        px[i] = px[i + 1] = px[i + 2] = g;
      }
    }
  });
}

/**
 * Smart colour reduction for CGB background images.
 * 1. Reduce each 8×8 tile to its 2 most-used non-white/non-black colours.
 * 2. If more than 6 unique colour pairs remain, map excess tiles to the
 *    nearest available palette (by RGB distance).
 * 3. Merge similar tiles if the unique-tile count exceeds VRAM capacity.
 */
function reduceColorsForCgb(imgData) {
  const data = ensureScreenSize(imgData);
  const w = 160, h = 144;
  const px = new Uint8ClampedArray(data.data);
  const srcPx = new Uint8ClampedArray(data.data);     /* original pixels for distortion scoring */

  /* ---- helpers -------------------------------------------------- */
  function ckR(k)             { return (k >> 16) & 0xFF; }
  function ckG(k)             { return (k >> 8) & 0xFF;  }
  function ckB(k)             { return k & 0xFF;         }
  function cdist(a, b) {
    const dr = ckR(a) - ckR(b), dg = ckG(a) - ckG(b), db = ckB(a) - ckB(b);
    return dr * dr + dg * dg + db * db;
  }

  function readTileColors(ty, tx) {
    const counts = new Map();
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const i = tilePixelIdx(ty, tx, y, x, w);
      const r = px[i], g = px[i + 1], b = px[i + 2];
      if (isWhite(r, g, b) || isBlack(r, g, b)) continue;
      const k = colorKey(r, g, b);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return counts;
  }

  /* nearest colour in palette (including white & black) */
  function nearest4(r, g, b, c1, c2) {
    const k = colorKey(r, g, b);
    const wDist  = cdist(k, 0xFFFFFF);
    const bDist  = cdist(k, 0x000000);
    const c1Dist = cdist(k, c1);
    const c2Dist = cdist(k, c2);
    const min = Math.min(wDist, bDist, c1Dist, c2Dist);
    if (min === wDist)  return [255, 255, 255];
    if (min === c1Dist) return [ckR(c1), ckG(c1), ckB(c1)];
    if (min === c2Dist) return [ckR(c2), ckG(c2), ckB(c2)];
    return [0, 0, 0];
  }

  let didReduceColors = false;

  /* --- Step 1: per-tile reduction to 2 most-used colours --- */
  const tilePairs = [];                              /* parallel to tile grid */
  for (let ty = 0; ty < BG_SCREEN_H; ty++) {
    for (let tx = 0; tx < BG_SCREEN_W; tx++) {
      const counts = readTileColors(ty, tx);
      if (counts.size <= 2) {
        tilePairs.push(new Set(counts.keys()));
        continue;
      }
      /* keep the 2 most frequent colours */
      didReduceColors = true;
      const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      const c1 = sorted[0][0];
      const c2 = sorted.length > 1 ? sorted[1][0] : c1;
      /* remap every pixel in this tile */
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const i = tilePixelIdx(ty, tx, y, x, w);
        const r = px[i], g = px[i + 1], b = px[i + 2];
        if (isWhite(r, g, b) || isBlack(r, g, b)) continue;
        const k = colorKey(r, g, b);
        if (k === c1 || k === c2) continue;
        const [nr, ng, nb] = nearest4(r, g, b, c1, c2);
        px[i] = nr; px[i + 1] = ng; px[i + 2] = nb;
      }
      tilePairs.push(new Set(c1 === c2 ? [c1] : [c1, c2]));
    }
  }

  /* --- Step 2: global colour consolidation ---
   * Merge near-duplicate colours, then keep top (MAX_PAL * 2) by pixel count
   * so that buildBgPalettes can fill all 6 palettes with 2 custom colours
   * each (= 12 unique custom colours max).
   */
  const globalCounts = new Map();
  for (let ty = 0; ty < BG_SCREEN_H; ty++) {
    for (let tx = 0; tx < BG_SCREEN_W; tx++) {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const i = tilePixelIdx(ty, tx, y, x, w);
        const r = px[i], g = px[i + 1], b = px[i + 2];
        if (isWhite(r, g, b) || isBlack(r, g, b)) continue;
        const k = colorKey(r, g, b);
        globalCounts.set(k, (globalCounts.get(k) || 0) + 1);
      }
    }
  }

  const maxColors = BG_MAX_PALETTES * 2;

  /* Phase A: merge near-duplicate colours into their most-frequent variant */
  if (globalCounts.size > maxColors) {
    const MERGE_THRESHOLD = 1000;  /* squared Euclidean distance threshold */
    const sorted = [...globalCounts.entries()].sort((a, b) => b[1] - a[1]);
    const mergeMap = new Map();  /* from → to */
    const canonical = [];        /* surviving colours in frequency order */
    for (const [k, cnt] of sorted) {
      let merged = false;
      for (const ck of canonical) {
        if (cdist(k, ck) <= MERGE_THRESHOLD) {
          mergeMap.set(k, ck);
          globalCounts.set(ck, globalCounts.get(ck) + cnt);
          merged = true;
          break;
        }
      }
      if (!merged) canonical.push(k);
    }

    if (mergeMap.size > 0) {
      didReduceColors = true;
      for (let ty = 0; ty < BG_SCREEN_H; ty++) {
        for (let tx = 0; tx < BG_SCREEN_W; tx++) {
          for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
            const i = tilePixelIdx(ty, tx, y, x, w);
            const r = px[i], g = px[i + 1], b = px[i + 2];
            if (isWhite(r, g, b) || isBlack(r, g, b)) continue;
            const k = colorKey(r, g, b);
            const target = mergeMap.get(k);
            if (target !== undefined) {
              px[i] = (target >> 16) & 0xFF; px[i + 1] = (target >> 8) & 0xFF; px[i + 2] = target & 0xFF;
            }
          }
        }
      }
      /* Remove merged entries from globalCounts */
      for (const k of mergeMap.keys()) globalCounts.delete(k);
    }
  }

  /* Phase B: if still too many colours, keep top maxColors by pixel count */
  if (globalCounts.size > maxColors) {
    didReduceColors = true;
    const sortedColors = [...globalCounts.entries()].sort((a, b) => b[1] - a[1]);
    const kept = new Set(sortedColors.slice(0, maxColors).map(e => e[0]));

    for (let ty = 0; ty < BG_SCREEN_H; ty++) {
      for (let tx = 0; tx < BG_SCREEN_W; tx++) {
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          const i = tilePixelIdx(ty, tx, y, x, w);
          const r = px[i], g = px[i + 1], b = px[i + 2];
          if (isWhite(r, g, b) || isBlack(r, g, b)) continue;
          const k = colorKey(r, g, b);
          if (kept.has(k)) continue;
          /* Find nearest kept colour */
          let bestK = 0, bestD = Infinity;
          for (const ck of kept) {
            const d = cdist(k, ck);
            if (d < bestD) { bestD = d; bestK = ck; }
          }
          px[i] = (bestK >> 16) & 0xFF; px[i + 1] = (bestK >> 8) & 0xFF; px[i + 2] = bestK & 0xFF;
        }
      }
    }
  }

  /* Rebuild tile pairs after any colour changes */
  if (didReduceColors) {
    for (let ti = 0; ti < tilePairs.length; ti++) {
      const ty = Math.floor(ti / BG_SCREEN_W);
      const tx = ti % BG_SCREEN_W;
      tilePairs[ti] = new Set(readTileColors(ty, tx).keys());
    }
  }

  /* If greedy packing of tile pairs still exceeds palette limit, consolidate */
  let needsPairConsolidation = false;
  try { buildBgPalettes(tilePairs); } catch { needsPairConsolidation = true; }

  if (needsPairConsolidation) {
    didReduceColors = true;

    /* Greedy palette selection: enumerate all C(n,2) possible 2-colour
     * palettes from the ≤12 remaining colours, then greedily pick 6
     * that minimise total per-pixel distortion (scored against the
     * original resized pixels).  No colour reuse across palettes.       */

    /* Collect all unique colours across tile pairs */
    const allColors = [...new Set(tilePairs.flatMap(tp => [...tp]))].sort((a, b) => a - b);

    /* Build candidate palettes: every pair + every singleton */
    const candidates = [];
    for (let i = 0; i < allColors.length; i++) {
      for (let j = i + 1; j < allColors.length; j++) {
        candidates.push([allColors[i], allColors[j]]);
      }
      candidates.push([allColors[i], allColors[i]]);
    }

    /* Precompute per-tile distortion for each candidate palette and the
     * white/black-only baseline, using the original source pixels.      */
    const NT = BG_SCREEN_W * BG_SCREEN_H;
    const tileBaseline = new Float64Array(NT);          /* WB-only distortion */
    const candDist = [];  /* candDist[ci][ti] = distortion */
    for (let ci = 0; ci < candidates.length; ci++) candDist.push(new Float64Array(NT));

    for (let ti = 0; ti < NT; ti++) {
      const ty = (ti / BG_SCREEN_W) | 0, tx = ti % BG_SCREEN_W;
      let wbSum = 0;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const si = tilePixelIdx(ty, tx, y, x, w);
        const r = srcPx[si], g = srcPx[si + 1], b = srcPx[si + 2];
        if (isWhite(r, g, b) || isBlack(r, g, b)) continue;
        const k = colorKey(r, g, b);
        wbSum += Math.min(cdist(k, 0xFFFFFF), cdist(k, 0x000000));
      }
      tileBaseline[ti] = wbSum;

      for (let ci = 0; ci < candidates.length; ci++) {
        const [c1, c2] = candidates[ci];
        let sum = 0;
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          const si = tilePixelIdx(ty, tx, y, x, w);
          const r = srcPx[si], g = srcPx[si + 1], b = srcPx[si + 2];
          if (isWhite(r, g, b) || isBlack(r, g, b)) continue;
          const k = colorKey(r, g, b);
          sum += Math.min(cdist(k, c1), cdist(k, c2), cdist(k, 0xFFFFFF), cdist(k, 0x000000));
        }
        candDist[ci][ti] = sum;
      }
    }

    /* Greedy: pick 6 palettes, no colour reuse */
    const selected = [];
    const tileCurDist = Float64Array.from(tileBaseline);
    const usedCands = new Set();
    const usedColors = new Set();

    for (let round = 0; round < BG_MAX_PALETTES; round++) {
      let bestCi = -1, bestImprove = 0;
      for (let ci = 0; ci < candidates.length; ci++) {
        if (usedCands.has(ci)) continue;
        const [c1, c2] = candidates[ci];
        const cs = new Set([c1, c2]);
        let skip = false;
        for (const uc of usedColors) { if (cs.has(uc)) { skip = true; break; } }
        if (skip) continue;
        let improve = 0;
        for (let ti = 0; ti < NT; ti++) {
          const diff = tileCurDist[ti] - candDist[ci][ti];
          if (diff > 0) improve += diff;
        }
        if (improve > bestImprove) { bestImprove = improve; bestCi = ci; }
      }
      if (bestCi < 0 || bestImprove <= 0) break;
      const [c1, c2] = candidates[bestCi];
      selected.push([c1, c2]);
      usedCands.add(bestCi);
      usedColors.add(c1); usedColors.add(c2);
      for (let ti = 0; ti < NT; ti++) {
        if (candDist[bestCi][ti] < tileCurDist[ti]) tileCurDist[ti] = candDist[bestCi][ti];
      }
    }

    /* Assign each tile the distortion-minimising palette and remap pixels */
    for (let ti = 0; ti < NT; ti++) {
      const ty = (ti / BG_SCREEN_W) | 0, tx = ti % BG_SCREEN_W;

      /* Find best palette for this tile (using srcPx for scoring) */
      let bestPi = 0, bestD = Infinity;
      for (let pi = 0; pi < selected.length; pi++) {
        const [c1, c2] = selected[pi];
        let d = 0;
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          const si = tilePixelIdx(ty, tx, y, x, w);
          const r = srcPx[si], g = srcPx[si + 1], b = srcPx[si + 2];
          if (isWhite(r, g, b) || isBlack(r, g, b)) continue;
          const k = colorKey(r, g, b);
          d += Math.min(cdist(k, c1), cdist(k, c2), cdist(k, 0xFFFFFF), cdist(k, 0x000000));
        }
        if (d < bestD) { bestD = d; bestPi = pi; }
      }

      const [c1, c2] = selected[bestPi];

      /* Remap every pixel in this tile to nearest of {W, c1, c2, B} */
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const i = tilePixelIdx(ty, tx, y, x, w);
        const r = srcPx[i], g = srcPx[i + 1], b = srcPx[i + 2];
        if (isWhite(r, g, b)) { px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; continue; }
        if (isBlack(r, g, b)) { px[i] = 0;   px[i + 1] = 0;   px[i + 2] = 0;   continue; }
        const [nr, ng, nb] = nearest4(r, g, b, c1, c2);
        px[i] = nr; px[i + 1] = ng; px[i + 2] = nb;
      }
      tilePairs[ti] = new Set(c1 === c2 ? [c1] : [c1, c2]);
    }
  }

  /* --- Step 3: VRAM tile merging (≤ 92 unique non-font tiles) --- */
  const didMergeTiles = mergeSimilarTiles({
    px, w, maxTiles: BG_MAX_NONFONT_TILES,
    extractTile(ty, tx) {
      const rgb = new Uint8Array(192);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const si = tilePixelIdx(ty, tx, y, x, w);
        const di = (y * 8 + x) * 3;
        rgb[di] = px[si]; rgb[di + 1] = px[si + 1]; rgb[di + 2] = px[si + 2];
      }
      return rgb;
    },
    writeTile(ty, tx, data) {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const i = tilePixelIdx(ty, tx, y, x, w);
        const di = (y * 8 + x) * 3;
        px[i] = data[di]; px[i + 1] = data[di + 1]; px[i + 2] = data[di + 2];
      }
    }
  });

  return { imgData: new ImageData(px, w, h), colorsReduced: didReduceColors, tilesReduced: didMergeTiles };
}

/**
 * Smart tile reduction for DMG background images.
 * 1. Convert to grayscale and quantize to 4 DMG shades (white, light, dark, black).
 * 2. Merge similar tiles if the unique-tile count exceeds VRAM capacity (92).
 */
function reduceForDmg(imgData) {
  const data = ensureScreenSize(imgData);
  const w = 160, h = 144;
  const px = new Uint8ClampedArray(data.data);

  /* Quantize all pixels to 4 DMG gray levels */
  for (let i = 0; i < px.length; i += 4) {
    const v = luminance(px[i], px[i + 1], px[i + 2]);
    px[i] = px[i + 1] = px[i + 2] = dmgQuantize(v);
  }

  /* VRAM tile merging (≤ 92 unique non-font tiles) */
  const didMergeTiles = mergeGrayTiles(px, w);

  return { imgData: new ImageData(px, w, h), tilesReduced: didMergeTiles };
}

/** Store a news-ticker image and switch to image mode. */
function addNewsImage(name, imgData) {
  state.newsImage = { name, imgData };
  setTickerMode('image');
  log('ok', `Newsticker image loaded: ${name} (${imgData.width}×${imgData.height})`);
}


/* --- Item Management (remove, edit, swap, reorder) --- */

function removeGame(idx) {
  state.games.splice(idx, 1);
  updateGamesUI();
}

function parseTitleCellGameIdx(cell) {
  const dataIdx = cell?.dataset?.gameIdx;
  if (dataIdx !== undefined && dataIdx !== null && dataIdx !== '') {
    const parsed = parseInt(dataIdx, 10);
    if (!isNaN(parsed)) return parsed;
  }
  const handler = cell?.getAttribute('onclick') || '';
  const match = handler.match(/editGameTitle\((\d+),/);
  return match ? parseInt(match[1], 10) : null;
}

function findTitleCellByGameIdx(gameIdx) {
  const cells = [...document.querySelectorAll('#gameSelectionBody td.title-cell')];
  return cells.find(cell => parseTitleCellGameIdx(cell) === gameIdx) || null;
}

function neighborTitleGameIdx(currentGameIdx, step) {
  const cells = [...document.querySelectorAll('#gameSelectionBody td.title-cell')];
  const order = cells.map(parseTitleCellGameIdx).filter(idx => idx !== null);
  const at = order.indexOf(currentGameIdx);
  if (at < 0 || order.length <= 1) return null;
  const nextAt = at + step;
  if (nextAt < 0 || nextAt >= order.length) return null;
  return order[nextAt];
}

/** Inline-edit a game title in the table. */
function editGameTitle(idx, el) {
  if (el.querySelector('input')) return;

  const current = state.games[idx].title;
  const tr = el.closest('tr');
  if (tr) tr.draggable = false;

  const input = document.createElement('input');
  input.type  = 'text';
  input.value = current;

  let done = false;
  function commit(nextIdx = null) {
    if (done) return;
    done = true;
    state.games[idx].title = input.value.trim();
    updateGameTable();
    if (nextIdx === null || nextIdx === undefined) return;
    setTimeout(() => {
      const nextCell = findTitleCellByGameIdx(nextIdx);
      if (nextCell) editGameTitle(nextIdx, nextCell);
    }, 0);
  }

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
    if (e.key === 'Tab') {
      e.preventDefault();
      const step = e.shiftKey ? -1 : 1;
      const nextIdx = neighborTitleGameIdx(idx, step);
      commit(nextIdx);
    }
    if (e.key === 'Escape') { updateGameTable(); }
  });
  input.addEventListener('mousedown', e => e.stopPropagation());
  input.addEventListener('click',     e => e.stopPropagation());

  el.textContent = '';
  el.appendChild(input);
  el.removeAttribute('onclick');
  input.focus();
  input.select();
}

/** Remove a menu item (menu ROM, background or news image). */
function removeMenuItem(type) {
  if (type === 'menu')  { state.menuRom = null; updateMenuUI(); }
  else if (type === 'news')  { state.newsImage = null; if (state.tickerMode === 'image') setTickerMode('text'); updateNewsUI(); }
}

/* --- Game Drag & Drop Reorder --- */

let _gameDragIdx = null;

function gameDragStart(e, idx) {
  _gameDragIdx = idx;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', idx);
}

function gameDragOver(e, _idx) {
  e.preventDefault();
  /* Accept both internal reorders and external file drops */
  e.dataTransfer.dropEffect = _gameDragIdx !== null ? 'move' : 'copy';
  const tr = e.currentTarget;
  const rect = tr.getBoundingClientRect();
  const inBottomHalf = (e.clientY - rect.top) > rect.height / 2;
  tr.classList.toggle('drag-over-top', !inBottomHalf);
  tr.classList.toggle('drag-over-bottom', inBottomHalf);
}

function gameDragLeave(e) {
  e.currentTarget.classList.remove('drag-over-top', 'drag-over-bottom');
}

function gameDrop(e, targetIdx) {
  e.preventDefault();
  const tr = e.currentTarget;
  const inBottomHalf = tr.classList.contains('drag-over-bottom');
  tr.classList.remove('drag-over-top', 'drag-over-bottom');

  /* External file drop: add ROM files and insert at this position */
  if (_gameDragIdx === null && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    handleFilesAtPosition(e.dataTransfer.files, inBottomHalf ? targetIdx + 1 : targetIdx);
    return;
  }

  /* Internal reorder */
  if (_gameDragIdx === null || _gameDragIdx === targetIdx) return;
  const insertIdx = inBottomHalf ? targetIdx + 1 : targetIdx;
  const [item] = state.games.splice(_gameDragIdx, 1);
  /* Adjust insert position if the source was before the target */
  const adjusted = _gameDragIdx < insertIdx ? insertIdx - 1 : insertIdx;
  state.games.splice(adjusted, 0, item);
  _gameDragIdx = null;
  updateGameTable();
}

function moveGameUp(idx) {
  if (idx <= 0) return;
  const [item] = state.games.splice(idx, 1);
  state.games.splice(idx - 1, 0, item);
  updateGameTable();
}

function moveGameDown(idx) {
  if (idx >= state.games.length - 1) return;
  const [item] = state.games.splice(idx, 1);
  state.games.splice(idx + 1, 0, item);
  updateGameTable();
}

/**
 * Handle files dropped directly onto a game-table row.
 * ROM files are inserted at the given position; other files are
 * processed normally via handleFiles().
 */
async function handleFilesAtPosition(fileList, insertIdx) {
  const files    = [...fileList];
  const romFiles = [];
  const others   = [];

  for (const file of files) {
    const ext = getFileExtension(file.name);
    if (ROM_EXTS.includes(ext)) romFiles.push(file);
    else others.push(file);
  }

  /* Process non-ROM files normally */
  if (others.length) await handleFiles(others);

  /* Update only the affected sections */
  let addedMenuRom = false;
  /* Add ROM files and move them to the target position */
  for (const file of romFiles) {
    const ext = getFileExtension(file.name);
    const buf = new Uint8Array(await file.arrayBuffer());

    /* Skip if it's the menu ROM */
    if (buf.length >= MENU_CRC32_RANGE && crc32(buf, 0, MENU_CRC32_RANGE) === MENU_CRC32_EXPECTED) {
      addMenuRom(file.name, buf);
      addedMenuRom = true;
      continue;
    }

    const prevLen = state.games.length;
    addGameRom(file.name, buf);

    /* If a game was added, move it from its sorted position to the target */
    if (state.games.length > prevLen) {
      const addedIdx = state.games.findIndex(g => g.name === file.name);
      if (addedIdx !== -1 && addedIdx !== insertIdx) {
        const [item] = state.games.splice(addedIdx, 1);
        state.games.splice(Math.min(insertIdx, state.games.length), 0, item);
        insertIdx++;
      }
    }
  }

  if (addedMenuRom) updateMenuUI();
  if (romFiles.length) updateGamesUI();
}

/* --- SRAM Slot Selector --- */

function setSramSlot(idx, value) {
  const g = state.games[idx];
  if (value === 'auto')         { g.forceSramSlot = null; g.forceNoSram = false; }
  else if (value === 'disable') { g.forceNoSram = true;   g.forceSramSlot = null; }
  else {
    const n = parseInt(value, 10);
    g.forceSramSlot = (isNaN(n) || n < 0 || n >= SRAM_NUM_SLOTS) ? null : n;
    g.forceNoSram = false;
  }
  updateGameTable();
}


/* --- Game Selection Table --- */

/**
 * Truncate a game title if its rendered pixel width exceeds
 * the 128 px tile area (16 tiles × 8 px).  Uses the actual
 * GBMEM font metrics for accuracy.
 */
function fitTitle(title) {
  const w   = GAMEDB_GFX_TILES * TILE_PX;
  const c   = document.createElement('canvas'); c.width = w; c.height = 8;
  const ctx = c.getContext('2d');
  ctx.font  = "8px 'GBMEM', sans-serif";

  if (ctx.measureText(title).width <= w + 1) return title;
  for (let i = title.length - 1; i >= 0; i--) {
    const t = title.substring(0, i) + '...';
    if (ctx.measureText(t).width <= w) return t;
  }
  return '...';
}

/** (Re-)render the game-selection table with placement results. */
function updateGameTableBuilder() {
  const gsSec  = document.getElementById('gameSelectionSection');
  const gsBody = document.getElementById('gameSelectionBody');

  if (state.games.length === 0) {
    gsSec.style.display = 'none';
    const fuSec = document.getElementById('flashUsageSection');
    if (fuSec) fuSec.style.display = 'none';
    return;
  }

  gsSec.style.display = '';
  const placements     = simulatePlacements();
  const sramShareCounts = new Map();
  for (let i = 0; i < state.games.length; i++) {
    const g = state.games[i];
    const p = placements[i];
    if (!p || p.offset === null || p.offset === undefined) continue;
    if ((p.v7002 & V7002_NO_SRAM_MODE) !== 0) continue;
    if (p.sramSlot === null || p.sramSlot === undefined || p.sramSlot < 0) continue;
    const reqSlots = requiredSramSlots(g.rom.size, g.rom.sramSize, g);
    const key = sramShareKey(p.sramSlot, reqSlots);
    sramShareCounts.set(key, (sramShareCounts.get(key) || 0) + 1);
  }
  const sharedSramKeys = new Set();
  for (const [key, count] of sramShareCounts.entries()) {
    if (count > 1) sharedSramKeys.add(key);
  }
  const placed   = [];
  const unplaced = [];
  let placedIdx  = 0;

  state.games.forEach((g, i) => {
    const p             = placements[i] || {};
    const mapper        = gameMapperLabel(g);
    const effectiveMapper = mapperName(g.rom.cartType);
    const hasSram       = g.rom.sramSize > 0;

    /* Platform badge */
    const platCls = platformBadgeClass(g.platform);
    const platBadge = `<span class="plat-badge ${platCls}">${g.platform}</span>`;

    /* Mapper warning for unsupported types */
    const mapperWarn = SUPPORTED_MAPPERS.has(effectiveMapper) ? ''
      : ' <span class="sram-warn" title="This mapper may be unsupported.">\u26a0\ufe0f</span>';
    const gameWarn = g.unsupportedCrc32
      ? ' <span class="sram-warn" title="This game may be unsupported.">\u26a0\ufe0f</span>'
      : '';
    const hasPlacedSram = p.sramSlot !== null && p.sramSlot !== undefined && p.sramSlot >= 0
      && ((p.v7002 ?? V7002_NO_SRAM_MODE) & V7002_NO_SRAM_MODE) === 0;
    const advanceModeBlockWarn = (p.offset !== null && p.offset !== undefined)
      && isAdvanceModeGameLike(g)
      && hasPlacedSram
      && !LAST_SRAM_BANK_MODE_ALLOWED_BLOCKS.has(sramBlockIndexForSlot(p.sramSlot))
      ? ' <span class="sram-warn" title="This game may not work with this SRAM slot.">\u26a0\ufe0f</span>'
      : '';

    /* --- SRAM column HTML --- */
    let sramHtml;
    if (!hasSram) {
      sramHtml = '<span style="color:var(--text3);font-size:.7rem">\u2014</span>';
    } else {
      const autoSlot = p.sramSlot;
      const isAuto   = g.forceSramSlot === null && !g.forceNoSram;
      const reqSlots = requiredSramSlots(g.rom.size, g.rom.sramSize, g);
      const alignBlocks = Math.max(1, Math.ceil(g.rom.size / SRAM_BLOCK));

      let autoLabel = 'Auto';
      if (isAuto && autoSlot !== null && autoSlot !== undefined && p.offset !== null && p.offset !== undefined) {
        const endSlot = autoSlot + reqSlots - 1;
        autoLabel = autoSlot === endSlot
          ? `Auto (Slot ${autoSlot + 1})`
          : `Auto (Slots ${autoSlot + 1}&ndash;${endSlot + 1})`;
      }

      const opts = [`<option value="auto"${isAuto ? ' selected' : ''}>${autoLabel}</option>`];
      for (let s = 0; s < SRAM_NUM_SLOTS; s++) {
        if (Math.floor(s / 2) % alignBlocks !== 0) continue;
        if (reqSlots > 1 && (s % 2) !== 0) continue;
        if (reqSlots === 1 && (s % 2) === 1 && !canUseOddSingleSramSlot(g.rom, s)) continue;
        const endS  = s + reqSlots - 1;
        if (endS >= SRAM_NUM_SLOTS) continue;
        const label = reqSlots > 1 ? 'Slots ' + (s + 1) + '&ndash;' + (endS + 1) : 'Slot ' + (s + 1);
        opts.push(`<option value="${s}"${g.forceSramSlot === s ? ' selected' : ''}>${label}</option>`);
      }
      opts.push(`<option value="disable"${g.forceNoSram ? ' selected' : ''}>Disable SRAM</option>`);
      sramHtml = `<select class="sram-select" onchange="setSramSlot(${i},this.value)">${opts.join('')}</select>`;
    }

    const isPlaced = p.offset !== null && p.offset !== undefined;
    const reqSlotsForRow = hasSram ? requiredSramSlots(g.rom.size, g.rom.sramSize, g) : 0;
    const shareHint = (isPlaced
      && p.sramSlot !== null && p.sramSlot !== undefined
      && ((p.v7002 & V7002_NO_SRAM_MODE) === 0)
      && sharedSramKeys.has(sramShareKey(p.sramSlot, reqSlotsForRow)))
      ? ' <span class="sram-share" title="Shares save data with at least one other game.">🔗</span>'
      : '';
    const n = state.games.length;
    const moveBtns = `<td class="move-cell"><button class="move-btn" onclick="moveGameUp(${i})"${i === 0 ? ' disabled' : ''}>\u25b2</button><button class="move-btn" onclick="moveGameDown(${i})"${i === n - 1 ? ' disabled' : ''}>\u25bc</button></td>`;
    let row;

    if (isPlaced) {
      placedIdx++;
      row = `<tr draggable="true" ondragstart="gameDragStart(event,${i})" ondragover="gameDragOver(event,${i})" ondrop="gameDrop(event,${i})" ondragleave="gameDragLeave(event)"><td data-label="#" class="reg-cell">${placedIdx}</td>${moveBtns}<td data-label="File">${esc(g.name)}</td><td data-label="Title" class="title-cell" data-game-idx="${i}" onclick="editGameTitle(${i},this)">${esc(fitTitle(g.title))}</td><td data-label="SRAM">${sramHtml}${shareHint}</td><td data-label="Mapper">${platBadge} ${mapper}${mapperWarn}${gameWarn}${advanceModeBlockWarn}</td><td data-label="Size" class="offset-cell">${formatRomSramSize(g.rom.size, g.rom.sramSize)}</td><td data-label="Offset" class="offset-cell">${formatRomSramOffset(p.offset, p.sramSlot)}</td><td data-label="Regs" class="reg-cell">${formatRegs(p.v7000, p.v7001, p.v7002)}</td></tr>`;
    } else {
      const reason = p.skip || 'no space';
      row = `<tr draggable="true" ondragstart="gameDragStart(event,${i})" ondragover="gameDragOver(event,${i})" ondrop="gameDrop(event,${i})" ondragleave="gameDragLeave(event)"><td data-label="#" class="reg-cell">\u2014</td>${moveBtns}<td data-label="File">${esc(g.name)}</td><td data-label="Title" class="title-cell" data-game-idx="${i}" onclick="editGameTitle(${i},this)">${esc(fitTitle(g.title))}</td><td data-label="SRAM">${sramHtml}${shareHint}</td><td data-label="Mapper">${platBadge} ${mapper}${mapperWarn}${gameWarn}${advanceModeBlockWarn}</td><td data-label="Size" class="offset-cell">${formatRomSramSize(g.rom.size, g.rom.sramSize)}</td><td data-label="Status" class="offset-cell" colspan="2" style="color:var(--red)">\u26a0\ufe0f ${esc(reason)}</td></tr>`;
    }

    if (isPlaced) placed.push(row);
    else unplaced.push(row);
  });

  /* Build final rows with page separators every 10 games */
  const finalRows = [];
  for (let i = 0; i < placed.length; i++) {
    if (placed.length > 10 && i % 10 === 0) {
      finalRows.push(`<tr class="page-sep"><td colspan="9"><span>Page ${Math.floor(i / 10) + 1}</span></td></tr>`);
    }
    finalRows.push(placed[i]);
  }
  if (unplaced.length) {
    finalRows.push('<tr class="page-sep"><td colspan="9"><span style="color:var(--red)">Games that cannot be added</span></td></tr>');
    unplaced.forEach(r => finalRows.push(r));
  }

  gsBody.innerHTML =
    '<table class="game-table"><thead><tr>' +
    '<th>#</th><th class="move-col-head"></th><th>Filename</th><th>Game Title</th><th>SRAM Slot</th>' +
    '<th>Platform</th><th>Size</th><th>Location</th><th>Registers</th>' +
    '</tr></thead><tbody>' + finalRows.join('') + '</tbody></table>';

  updateFlashUsage(placements);
}

/** Derive a deterministic hue from a string (game title). */
function titleHue(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
  return h % 360;
}

/**
 * Compute flash block ownership from placement results.
 * Returns { blockOwner, blockStart, usedBlocks, usedBytes, pct, TOTAL_BLOCKS }.
 */
function computeBlockOwners(placements) {
  const TOTAL_BLOCKS = FLASH_SIZE / BANK_PAIR_SIZE;
  const MENU_BLOCKS  = MENU_SIZE / BANK_PAIR_SIZE;
  const blockOwner = new Int16Array(TOTAL_BLOCKS).fill(-1);
  const blockStart = new Uint8Array(TOTAL_BLOCKS);
  blockStart[0] = 1;
  for (let b = 0; b < MENU_BLOCKS; b++) blockOwner[b] = 0;
  /* Build placed-ordinal map: global index → sequential placed number */
  let ord = 0;
  const placedOrd = new Map();
  state.games.forEach((g, i) => {
    const p = placements[i];
    if (p && p.offset !== null && p.offset !== undefined) placedOrd.set(i, ++ord);
  });
  state.games.forEach((g, i) => {
    const p = placements[i];
    if (!p || p.offset === null || p.offset === undefined) return;
    const startBlk = p.offset / BANK_PAIR_SIZE;
    const numBlks  = g.rom.size / BANK_PAIR_SIZE;
    blockStart[startBlk] = 1;
    for (let b = startBlk; b < startBlk + numBlks; b++) blockOwner[b] = placedOrd.get(i);
  });
  const usedBlocks = blockOwner.reduce((n, v) => n + (v >= 0 ? 1 : 0), 0);
  const usedBytes  = usedBlocks * BANK_PAIR_SIZE;
  const pct        = usedBlocks / TOTAL_BLOCKS * 100;
  /* placedGames[ordinal] = game object (1-indexed, slot 0 unused) */
  const placedGames = [null];
  for (const [gi, o] of placedOrd) placedGames[o] = state.games[gi];
  return { blockOwner, blockStart, usedBlocks, usedBytes, pct, TOTAL_BLOCKS, placedGames };
}

/** Render the flash usage block matrix and progress bar. */
function updateFlashUsage(placements) {
  const sec = document.getElementById('flashUsageSection');
  const el  = document.getElementById('flashUsage');
  if (!el || !sec) return;
  sec.style.display = '';

  const { blockOwner, usedBytes, pct, TOTAL_BLOCKS, placedGames } = computeBlockOwners(placements);

  const cells = [];
  for (let b = 0; b < TOTAL_BLOCKS; b++) {
    const owner = blockOwner[b];
    if (owner === 0) {
      cells.push('<div class="blk menu">M</div>');
    } else if (owner > 0) {
      const h = titleHue(placedGames[owner].title);
      cells.push('<div class="blk" style="background:hsl(' + h + ' 55% 45%)">' + owner + '</div>');
    } else {
      cells.push('<div class="blk"></div>');
    }
  }

  const barCls = pct >= 90 ? ' warn' : '';

  el.innerHTML =
    '<div class="flash-matrix">' + cells.join('') + '</div>' +
    '<div class="flash-bar-wrap"><div class="flash-bar' + barCls + '" style="width:' + pct.toFixed(1) + '%"></div></div>' +
    '<div class="flash-label">' + pct.toFixed(1) + '% used (' + formatSize(usedBytes) + ' / ' + formatSize(FLASH_SIZE) + ')</div>' +
    '<div class="flash-rules">' +
      '<p><b>How games are placed in flash by this tool:</b></p>' +
      '<ul>' +
        '<li>Every ROM is rounded up to the next power-of-2 size (32 KiB, 64 KiB, 128 KiB, … up to 8 MiB) and must be aligned to that size in flash.</li>' +
        '<li>Each 2 MiB flash block maps to either an SRAM block of 32 KiB. Half of the available SRAM blocks can also be divided into two 8 KiB SRAM slots each (up to 24 slots total).</li>' +
        '<li>Some games will be patched to use the MBC5 mapper to resolve incompatibilities.</li>' +
        '<li>GBMem-Menu supports a maximum of <b>160 games</b> on a single 32 MiB cartridge.</li>' +
      '</ul>' +
    '</div>';
}


/* --- UI Update --- */

/** Render a single file-item row with icon, name, optional extra, and remove button. */
function renderFileItem(icon, name, removeAction, extra) {
  return `<div class="file-item status-ok"><span class="icon">${icon}</span>` +
    `<span class="name">${esc(name)}</span>` +
    (extra ? `<span class="size">${extra}</span>` : '') +
    `<span class="remove" onclick="${removeAction}">×</span></div>`;
}

/** Refresh the Menu ROM container. */
function updateMenuUI() {
  const ml = document.getElementById('menuList');
  if (state.menuRom) {
    const kioskId = state.menuRom.kioskId || '';
    ml.innerHTML = renderFileItem('✓', state.menuRom.name, "removeMenuItem('menu')", kioskId ? esc(kioskId) : '');
  } else {
    resetToEmpty(ml);
  }
  document.getElementById('buildBtn').disabled = !state.menuRom;
}

/** Refresh the Games list (sidebar) + game selection table. */
function updateGamesUI() {
  const gl = document.getElementById('gamesList');
  const gc = document.getElementById('gamesCount');
  gc.textContent = state.games.length;
  if (state.games.length === 0) {
    resetToEmpty(gl);
  } else {
    gl.innerHTML = state.games.map((g, i) => {
      const savBadge = g.savData ? '<span class="save-badge">+SAVE</span>' : '';
      return `<div class="file-item status-ok"><span class="icon">🎮</span><span class="name">${esc(g.name)}</span>${savBadge}<span class="remove" onclick="removeGame(${i})">×</span></div>`;
    }).join('');
  }
  updateGameTable();
}

/** Refresh the Backgrounds container. */
function updateBgUI() {
  const bl = document.getElementById('bgList');
  if (!state.bgImages.length) {
    bl.innerHTML = bl.dataset.text || '';
    return;
  }
  bl.innerHTML = state.bgImages.map((img, i) =>
    `<div class="file-item status-ok"><span class="icon">🎨</span><span class="name">${esc(img.name)}</span>` +
    `<span class="remove" onclick="removeBgImage(${i})">×</span></div>`
  ).join('');
}

/** Refresh the News container. */
function updateNewsUI() {
  const nl = document.getElementById('newsList');
  if (state.newsImage) {
    nl.innerHTML = renderFileItem('📰', state.newsImage.name, "removeMenuItem('news')");
  } else {
    resetToEmpty(nl);
  }
}

/** Refresh all UI panels from current state. */
function updateUI() {
  updateMenuUI();
  updateGamesUI();
  updateBgUI();
  updateNewsUI();
  _updateCgbSampleColors();
}


/* --- Ticker Mode & News Preview --- */

function setTickerMode(mode) {
  state.tickerMode = mode;
  document.getElementById('tickerTextBtn').classList.toggle('active',  mode === 'text');
  document.getElementById('tickerImageBtn').classList.toggle('active', mode === 'image');
  document.getElementById('tickerText').style.display = mode === 'text' ? '' : 'none';
  updateNewsPreview();
}

function updateNewsPreview() {
  const el = document.getElementById('tickerImageHint');

  if (state.tickerMode !== 'image') { el.style.display = 'none'; return; }
  el.style.display = '';

  if (state.newsImage) {
    const c = imageDataToCanvas(state.newsImage.imgData);
    c.style.cssText = 'image-rendering:pixelated;height:28px;display:block';

    el.innerHTML   = '';
    el.className   = 'ticker-input';
    el.style.overflowX  = 'auto';
    el.style.whiteSpace = 'nowrap';
    el.style.display    = 'block';
    el.style.padding    = '0 .5rem 0 .75rem';
    el.appendChild(c);
  } else {
    el.className = '';
    el.style.overflowX  = '';
    el.style.whiteSpace = '';
    el.style.padding    = '';
    el.textContent = 'Upload a grayscale PNG image (14px tall, up to 4080px wide) via the drop zone above.';
  }
}


/* --- Background Previews --- */

/** Cached default preview images (fetched once, reused). */
const _defaultBgImg = { cgb: null, dmg: null };
let _bgPreviewTimer = 0;
let _lastCgbPreviewError = '';

/** Coalesce expensive preview updates when sliders fire rapidly. */
function scheduleBgPreviewUpdate() {
  if (_bgPreviewTimer) return;
  _bgPreviewTimer = setTimeout(() => {
    _bgPreviewTimer = 0;
    updateBgPreviews();
  }, 0);
}

/** Load the default CGB/DMG preview images on first paint. */
async function loadDefaultBgPreviews() {
  try {
    _defaultBgImg.cgb = await loadImageFromUrl('res/bg_cgb.png');
    _defaultBgImg.dmg = await loadImageFromUrl('res/bg_dmg.png');
    drawBgPreview('bgCgbCanvas', _defaultBgImg.cgb);
    drawBgPreview('bgDmgCanvas', _defaultBgImg.dmg);
  } catch (e) {
    log('warn', `Failed to load default BG previews: ${errorMessage(e)}`);
  }
}

function drawBgPreview(canvasId, img) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  canvas.width = 160; canvas.height = 144;
  const ctx = require2dContext(canvas);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, 160, 144);
}

/** Sync a threshold slider pair: read DOM, enforce lo < hi, update state + DOM labels. */
function syncThresholdPair(prefix) {
  const lo = parseInt(document.getElementById(prefix + 'ThresholdLow').value, 10);
  const hi = parseInt(document.getElementById(prefix + 'ThresholdHigh').value, 10);
  state[prefix + 'ThresholdLow']  = Math.min(lo, hi - 1);
  state[prefix + 'ThresholdHigh'] = Math.max(hi, lo + 1);
  document.getElementById(prefix + 'ThresholdLow').value  = state[prefix + 'ThresholdLow'];
  document.getElementById(prefix + 'ThresholdHigh').value  = state[prefix + 'ThresholdHigh'];
  document.getElementById(prefix + 'ThresholdLowVal').textContent  = state[prefix + 'ThresholdLow'];
  document.getElementById(prefix + 'ThresholdHighVal').textContent = state[prefix + 'ThresholdHigh'];
}

/**
 * Called when DMG gray threshold sliders change.
 * Re-processes the DMG background from original source image.
 */
function onDmgThresholdChange() {
  syncThresholdPair('dmg');

  if (!state.bgDmg) return;
  const srcIdx = state.bgDmg._srcIdx;
  const src = state.bgDmg.srcImgData || state.bgDmg.imgData;
  const warnings = [];
  processDmgSlot(state.bgDmg.name, src, warnings, true);
  if (srcIdx !== undefined) state.bgDmg._srcIdx = srcIdx;
  scheduleBgPreviewUpdate();
}

const _sampleTimers = { cgb: null, dmg: null };

/** Flash a sample overlay for 3 seconds, clearing any previous timer. */
function flashSampleOverlay(mode) {
  const overlay = document.getElementById(mode + 'SampleOverlay');
  if (overlay) overlay.style.display = 'block';
  if (_sampleTimers[mode]) clearTimeout(_sampleTimers[mode]);
  _sampleTimers[mode] = setTimeout(() => { _sampleTimers[mode] = null; if (overlay) overlay.style.display = ''; }, 3000);
}

function onDmgInvertChange() {
  state.dmgInvert = document.getElementById('dmgInvert').checked;
  _updateDmgSampleColors();
  scheduleBgPreviewUpdate();
  flashSampleOverlay('dmg');
}

function _updateSampleColors(prefix, fgColor, bgColor) {
  const line1 = document.getElementById(prefix + 'SampleLine1');
  const line2 = document.getElementById(prefix + 'SampleLine2');
  if (line1) { line1.style.color = fgColor; line1.style.backgroundColor = bgColor; }
  if (line2) line2.style.color = bgColor;
}
function _updateDmgSampleColors() {
  const fg = state.dmgInvert ? '#ffffff' : '#000000';
  const bg = state.dmgInvert ? '#000000' : '#ffffff';
  _updateSampleColors('dmg', fg, bg);
}
function _updateCgbSampleColors() {
  _updateSampleColors('cgb', state.cgbColor3, state.cgbColor0);
}

function onCgbColorChange() {
  state.cgbColor0 = document.getElementById('cgbColor0').value;
  state.cgbColor3 = document.getElementById('cgbColor3').value;
  _updateCgbSampleColors();
  scheduleBgPreviewUpdate();
}

function onCgbInvertChange() {
  state.cgbInvert = document.getElementById('cgbInvert').checked;
  /* Swap the two primary colors */
  const tmp = state.cgbColor0;
  state.cgbColor0 = state.cgbColor3;
  state.cgbColor3 = tmp;
  document.getElementById('cgbColor0').value = state.cgbColor0;
  document.getElementById('cgbColor3').value = state.cgbColor3;
  _updateCgbSampleColors();
  scheduleBgPreviewUpdate();
  flashSampleOverlay('cgb');
}

function onCgbSecondaryChange() {
  state.cgbSecondary1 = document.getElementById('cgbSecondary1').value;
  state.cgbSecondary2 = document.getElementById('cgbSecondary2').value;
  scheduleBgPreviewUpdate();
}

function onEnableMusicChange() {
  state.enableMusic = document.getElementById('enableMusic').checked;
}

function onSkipRebootOnCgbGamesChange() {
  state.skipRebootOnCgbGames = document.getElementById('skipRebootOnCgbGames').checked;
}

function setCgbRenderMode(mode) {
  state.cgbRenderMode = mode;
  document.getElementById('cgbModeAsisBtn').classList.toggle('active', mode === 'asis');
  document.getElementById('cgbModeGrayBtn').classList.toggle('active', mode === 'grayscale');
  showEl('cgbThresholdControls', mode === 'grayscale' && state.bgCgb);
  showEl('cgbSecondaryControls', mode === 'grayscale' && state.bgCgb);
  /* Auto-set secondary colors from image average (excl. black/white) when entering grayscale */
  if (mode === 'grayscale' && state.bgCgb) {
    const src = state.bgCgb.srcImgData || state.bgCgb.imgData;
    const avg = averageColor(src);
    const rgbToHex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
    state.cgbSecondary2 = rgbToHex(avg);
    state.cgbSecondary1 = rgbToHex(lightenColor(avg));
    document.getElementById('cgbSecondary1').value = state.cgbSecondary1;
    document.getElementById('cgbSecondary2').value = state.cgbSecondary2;
  }
  scheduleBgPreviewUpdate();
}

function onCgbThresholdChange() {
  syncThresholdPair('cgb');
  scheduleBgPreviewUpdate();
}

/** Swap shades 0↔3 in 2BPP tile data, keeping shades 1,2 unchanged. */
function invertPrimaryColors(tiles) {
  for (let i = 0; i < tiles.length; i += 2) {
    const lo = tiles[i], hi = tiles[i + 1];
    const mask = ~(lo ^ hi) & 0xFF;  /* bits where lo==hi (shade 0 or 3) */
    tiles[i]     = lo ^ mask;
    tiles[i + 1] = hi ^ mask;
  }
}

/** Rebuild a bg-slot <select> to reflect current bgImages and selection. */
function _syncBgSelect(selId, slotObj) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  const curIdx = slotObj ? slotObj._srcIdx : '';
  let html = '<option value=""' + (curIdx === '' || curIdx === undefined ? ' selected' : '') + '>Default</option>';
  state.bgImages.forEach((img, i) => {
    html += `<option value="${i}"${i === curIdx ? ' selected' : ''}>${esc(img.name)}</option>`;
  });
  sel.innerHTML = html;
}

function updateBgPreviews() {
  const isGray = state.cgbRenderMode === 'grayscale';

  let cgbResult = null;
  if (state.bgCgb) {
    try {
      const srcImg = state.bgCgb.srcImgData || state.bgCgb.imgData;
      if (isGray) {
        cgbResult = processBgCgbGrayscale(srcImg);
      } else {
        cgbResult = processBgCgb(state.bgCgb.imgData);
      }
      if (state.cgbInvert) invertPrimaryColors(cgbResult.rawTiles);
      const decoded = decodeBgCgbToImageData(cgbResult);
      drawBgPreview('bgCgbCanvas', imageDataToCanvas(decoded));
      _lastCgbPreviewError = '';
    } catch (e) {
      const msg = errorMessage(e);
      if (msg !== _lastCgbPreviewError) {
        _lastCgbPreviewError = msg;
        log('warn', `CGB preview error: ${msg}`);
      }
      /* Fallback: show the raw imgData */
      drawBgPreview('bgCgbCanvas', imageDataToCanvas(state.bgCgb.imgData));
    }
  } else {
    _lastCgbPreviewError = '';
    if (_defaultBgImg.cgb) {
      drawBgPreview('bgCgbCanvas', _defaultBgImg.cgb);
      if (state.cgbRenderMode !== 'asis') setCgbRenderMode('asis');
      state.cgbColor0 = '#ffffff';
      state.cgbColor3 = '#000000';
      if (state.cgbInvert) {
        state.cgbInvert = false;
        const cgbInvertEl = document.getElementById('cgbInvert');
        if (cgbInvertEl) cgbInvertEl.checked = false;
        flashSampleOverlay('cgb');
      }
      const cgbColor0El = document.getElementById('cgbColor0');
      const cgbColor3El = document.getElementById('cgbColor3');
      if (cgbColor0El) cgbColor0El.value = state.cgbColor0;
      if (cgbColor3El) cgbColor3El.value = state.cgbColor3;
      _updateCgbSampleColors();
    }
  }
  if (state.bgDmg) {
    drawBgPreview('bgDmgCanvas', imageDataToCanvas(state.bgDmg.imgData));
  } else {
    if (_defaultBgImg.dmg) {
      drawBgPreview('bgDmgCanvas', _defaultBgImg.dmg);
      if (state.dmgInvert) {
        state.dmgInvert = false;
        const dmgInvertEl = document.getElementById('dmgInvert');
        if (dmgInvertEl) dmgInvertEl.checked = false;
        _updateDmgSampleColors();
      }
    }
  }

  /* Show warning below each preview when colors/tiles were auto-reduced */
  const cgbWarn = document.getElementById('bgCgbWarnings');
  if (cgbWarn) {
    const msgs = [];
    if (!isGray && state.bgCgb?.colorsReduced) msgs.push('\u26a0\ufe0f More than 2 non-BW colors per 8\u00d78 pixel tile may cause artifacts');
    const tilesMerged = isGray ? cgbResult?.tilesReduced : state.bgCgb?.tilesReduced;
    if (tilesMerged)  msgs.push(`\u26a0\ufe0f Too many unique 8\u00d78 pixel tiles may cause artifacts`);
    cgbWarn.innerHTML = msgs.map(m => `<div>${m}</div>`).join('');
  }
  const dmgWarn = document.getElementById('bgDmgWarnings');
  if (dmgWarn) {
    dmgWarn.textContent = state.bgDmg?.tilesReduced
      ? `\u26a0\ufe0f Too many unique 8\u00d78 pixel tiles may cause artifacts`
      : '';
  }

  /* Show/hide DMG invert checkbox and threshold sliders */
  showEl('dmgInvertLabel', state.bgDmg);
  showEl('dmgThresholdControls', state.bgDmg);

  /* Show/hide CGB render mode toggle, palette controls */
  showEl('cgbModeToggle', state.bgCgb);
  showEl('cgbColorControls', state.bgCgb);
  showEl('cgbThresholdControls', isGray && state.bgCgb);
  showEl('cgbInvertLabel', state.bgCgb);
  showEl('cgbSecondaryControls', isGray && state.bgCgb);

  /* Synchronize background slot dropdowns with current image pool */
  _syncBgSelect('bgCgbSelect', state.bgCgb);
  _syncBgSelect('bgDmgSelect', state.bgDmg);
}


/* --- Build Log --- */

function syncLogWrapState() {
  const wrap = document.getElementById('logWrap');
  const logEl = document.getElementById('buildLog');
  if (!wrap || !logEl) return;
  wrap.classList.toggle('has-active-log', logEl.classList.contains('active'));
}

/** Append a styled line to the build/extract log. */
function log(cls, msg) {
  const el = document.getElementById('buildLog');
  if (!el) return;
  el.classList.add('active');
  const line = document.createElement('div');
  line.className = 'line ' + cls;
  line.textContent = msg;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
  syncLogWrapState();
}

/** Clear the build/extract log and hide it. */
function clearLog() {
  const el = document.getElementById('buildLog');
  if (!el) return;
  el.innerHTML = '';
  el.classList.remove('active');
  syncLogWrapState();
}

/** Copy all log lines as plain text to the clipboard. */
async function copyLogToClipboard() {
  const el = document.getElementById('buildLog');
  if (!el) return;
  const lines = [...el.querySelectorAll('.line')].map(l => l.textContent);
  try {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      throw new Error('Clipboard API unavailable');
    }
    await navigator.clipboard.writeText(lines.join('\n'));
    const btn = document.getElementById('logCopyBtn');
    if (btn) {
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = '📋'; }, 1500);
    }
  } catch (e) {
    log('warn', `Could not copy log to clipboard: ${errorMessage(e)}`);
  }
}

/** Log a game entry with optional +SAVE badge (used by extractor). */
function logGame(idx, title, romSize, hasSave) {
  const el = document.getElementById('buildLog');
  if (!el) return;
  el.classList.add('active');
  const line = document.createElement('div');
  line.className = 'line ok';
  const text = document.createTextNode('  ' + idx + ': ' + title + ' (' + formatSize(romSize) + ')');
  line.appendChild(text);
  if (hasSave) {
    const badge = document.createElement('span');
    badge.textContent = ' +SAVE';
    badge.style.color = 'var(--accent2)';
    line.appendChild(badge);
  }
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
  syncLogWrapState();
}


/* --- Build Process --- */

/** Wrap an async operation with progress UI: disable button, show progress bar, restore on finish. */
async function withProgressUI(btnId, resetDisabled, body) {
  const btn          = document.getElementById(btnId);
  const progressBar  = document.getElementById('progressBar');
  const progressFill = document.getElementById('progressFill');
  if (!btn || !progressBar || !progressFill) {
    throw new Error('Progress UI is not fully initialized');
  }

  const buildSection = document.getElementById('buildSection');
  btn.disabled       = true;
  if (buildSection) buildSection.classList.add('building');
  progressBar.classList.add('active');
  progressFill.style.width = '0%';
  const progress = pct => {
    const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
    progressFill.style.width = clamped + '%';
  };
  try {
    await body(progress);
  } catch (e) {
    log('err', `${btnId === 'buildBtn' ? 'Build' : 'Extraction'} failed: ${errorMessage(e)}`);
  } finally {
    btn.disabled = resetDisabled();
    if (buildSection) buildSection.classList.remove('building');
    progressBar.classList.remove('active');
    progressFill.style.width = '0%';
  }
}

async function startBuild() {
  if (!state.menuRom) return;

  await withProgressUI('buildBtn', () => !state.menuRom, async (progress) => {
    /* --- Step 1: Patch menu ROM --- */
    log('head', '=== Patching Menu ROM ===');
    const bpsPatch = b64ToUint8Array(BPS_PATCH_B64);
    let rom;
    try {
      rom = new Uint8Array(applyBpsPatch(bpsPatch, state.menuRom.data));
    } catch (e) {
      log('err', `BPS patching failed: ${e.message}`);
      throw e;
    }
    rom = new Uint8Array(rom);
    if (rom.length < MENU_SIZE) {
      const padded = new Uint8Array(MENU_SIZE);
      padded.fill(0xFF);
      padded.set(rom);
      rom = padded;
    }
    log('ok', `Patched menu ROM: ${rom.length} bytes`);

    log('head', '=== Menu Settings ===');
    /* Write menu options to ROM offset $8005. */
    rom[0x8005] = (rom[0x8005] & 0xFC)
      | (state.enableMusic ? 0x01 : 0x00)
      | (state.skipRebootOnCgbGames ? 0x00 : 0x02);
    log('ok', `Music: ${state.enableMusic ? 'enabled' : 'disabled'}`);
    log('ok', `Skip reboot on CGB games: ${state.skipRebootOnCgbGames ? 'enabled' : 'disabled'}`);

    progress(10);
    await sleep(0);

    /* --- Step 2: Import backgrounds --- */
    log('head', '=== Importing Backgrounds ===');
    let cgbImgData, cgbSrcImgData;
    if (state.bgCgb) {
      cgbImgData = state.bgCgb.imgData;
      cgbSrcImgData = state.bgCgb.srcImgData || state.bgCgb.imgData;
      log('info', `CGB source: ${state.bgCgb.name}` + (state.cgbRenderMode === 'grayscale' ? ' (colorized grayscale)' : ''));
    } else {
      cgbImgData = await imageDataFromB64Png(BG_CGB_DEFAULT_B64);
      cgbSrcImgData = cgbImgData;
      log('info', 'CGB source: default (embedded)');
    }
    let dmgImgData;
    if (state.bgDmg) {
      dmgImgData = state.bgDmg.imgData;
      log('info', `DMG source: ${state.bgDmg.name}`);
    } else {
      dmgImgData = await imageDataFromB64Png(BG_DMG_DEFAULT_B64);
      log('info', 'DMG source: default (embedded)');
    }

    const cgb = state.cgbRenderMode === 'grayscale'
      ? processBgCgbGrayscale(cgbSrcImgData)
      : processBgCgb(cgbImgData);
    if (state.cgbInvert) invertPrimaryColors(cgb.rawTiles);
    rom.set(cgb.palBytes, BG_PALETTES_OFFSET);
    rom.set(cgb.rawTiles, BG_CGB_TILES_OFFSET);
    rom.set(cgb.tilemap,  BG_CGB_TILEMAP_OFFSET);
    rom.set(cgb.attrmap,  BG_CGB_ATTRMAP_OFFSET);
    const dmg = processBgDmg(dmgImgData);
    if (state.dmgInvert) {
      for (let i = 0; i < dmg.rawTiles.length; i++)
        dmg.rawTiles[i] ^= 0xFF;
    }
    rom.set(dmg.rawTiles, BG_DMG_TILES_OFFSET);
    rom.set(dmg.tilemap,  BG_DMG_TILEMAP_OFFSET);
    rom[BG_VRAM_SLOTS_CGB_ADDR] = cgb.nVramSlots & 0xFF;
    rom[BG_VRAM_SLOTS_DMG_ADDR] = dmg.nVramSlots & 0xFF;
    rom[DMG_BGP_ADDR] = state.dmgInvert ? 0x1B : 0xE4;
    log('ok', `CGB: ${cgb.nVramSlots} VRAM slots / DMG: ${dmg.nVramSlots} VRAM slots`);
    progress(25);
    await sleep(0);

    await document.fonts.ready;

    /* --- Step 3: Import news ticker --- */
    log('head', '=== Importing News Ticker ===');
    let newsImgData;
    if (state.tickerMode === 'image' && state.newsImage) {
      newsImgData = prepareNewsImage(state.newsImage.imgData);
      log('info', `News from image: ${state.newsImage.name}`);
    } else {
      const text = document.getElementById('tickerText').value || getDefaultTickerText();
      newsImgData = prepareNewsImage(renderNewsText(text));
      log('info', 'News from text input');
    }

    const newsTiles  = imageToTilesColumnMajor(newsImgData);
    const bankStart  = NEWS_BANK_OFFSET;
    const dataStart  = bankStart + NEWS_DATA_OFFSET;
    const bankEnd    = bankStart + BANK_SIZE;

    /* Clear header area */
    for (let i = bankStart + 1; i < dataStart; i++) rom[i] = 0xFF;

    /* Write tile data */
    let written = 0;
    for (let i = 0; i < newsTiles.length && dataStart + written + TILE_BYTES <= bankEnd; i++) {
      rom.set(newsTiles[i], dataStart + written);
      written += TILE_BYTES;
    }
    for (let i = dataStart + written; i < bankEnd; i++) rom[i] = 0xFF;
    log('ok', `Ticker: ${written} bytes written`);
    progress(35);
    await sleep(0);

    /* --- Step 4: Build game database --- */
    log('head', '=== Building Game Database ===');
    const now = new Date();
    const timestamp =
      `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}` +
      `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    /* Preserve the menu slot header from the patched ROM */
    const hdrOffset   = GAMEDB_BANK4_BASE + GAMEDB_HEADER_SIZE;
    const originalHdr = rom.slice(hdrOffset, hdrOffset + GAMEDB_SLOT_SIZE);

    /* Clear banks 4-7 */
    for (let bankIdx = 0; bankIdx < 4; bankIdx++) {
      const bankBase = GAMEDB_BANK4_BASE + bankIdx * BANK_SIZE;
      rom[bankBase] = 4 + bankIdx;
      for (let i = bankBase + 1; i < bankBase + BANK_SIZE; i++) rom[i] = 0xFF;
    }
    rom.set(originalHdr, hdrOffset);

    let savData = null;

    if (state.games.length === 0) {
      log('info', 'No games to pack');
      progress(80);
    } else {
      const games = state.games.map((g, i) => ({ ...g, index: i + 1 }));
      log('info', `Packing ${games.length} ROM(s)...`);
      progress(40);
      await sleep(0);

      const { flash, outSize, regs, skipped, warnings, placementMeta } = packRoms(games);
      if (placementMeta?.rescueUsed) {
        log('warn', `SRAM auto-placement reflow active (strategy: ${placementMeta.strategy}, odd-slot autos: ${placementMeta.score?.oddAutoSingleSlot ?? 0})`);
      } else if (placementMeta) {
        log('info', `SRAM auto-placement strategy: ${placementMeta.strategy} (odd-slot autos: ${placementMeta.score?.oddAutoSingleSlot ?? 0})`);
      }

      /* Write game-database slots */
      let slotIdx = 0;
      const sramPlacements = [];

      for (const g of games) {
        if (regs[g.index] === undefined) continue;
        slotIdx++;

        const r       = regs[g.index];
        const gfxData = await renderTitleImage(fitTitle(g.title));
        const titleBytes = encodeField(g.title, GAMEDB_TITLE_SIZE);
        const gcValue    = g.ecjFlag || 0;
        const tsBytes    = encodeField(timestamp, GAMEDB_TIMESTAMP_SIZE);
        const blankRegion = new TextEncoder().encode('BLR00001');
        const tail = new Uint8Array(7); tail.fill(0xFF);

        /* Assemble 352-byte slot structure */
        const v7002Combined = r.v7002 | (r.cgbFlag << 8);
        const slotData = new Uint8Array(GAMEDB_SLOT_SIZE);
        slotData.fill(0);
        let off = 0;
        slotData[off++] = slotIdx;                        // B: slot index
        slotData[off++] = r.v7000;                        // B: v7000
        slotData[off++] = r.v7001;                        // B: v7001
        slotData[off++] = v7002Combined & 0xFF;           // H: v7002|(cgb<<8) lo
        slotData[off++] = (v7002Combined >> 8) & 0xFF;    //                    hi
        slotData[off++] = 0;                              // H: padding
        slotData[off++] = 0;
        slotData[off++] = gcValue & 0xFF;                 // H: game code (ECJ flag) lo
        slotData[off++] = (gcValue >> 8) & 0xFF;          //                          hi
        slotData.set(titleBytes, off); off += 54;         // 54s: title
        slotData.set(gfxData,   off); off += 256;         // 256s: title gfx
        slotData.set(tsBytes,   off); off += 18;          // 18s: timestamp
        const blkPad = new Uint8Array(8);
        blkPad.set(blankRegion);
        slotData.set(blkPad,    off); off += 8;           // 8s: blank region
        slotData.set(tail,      off);                     // 7s: tail

        /* Map slotIdx to bank + slot using firmware GAMES_PER_BANK (40),
           NOT physical SLOTS_PER_BANK (43).  Bank 4 slot 0 = header. */
        const gameIdx    = slotIdx - 1;  // 0-based game index
        const dbBankIdx  = Math.floor(gameIdx / GAMEDB_GAMES_PER_BANK);
        const gameInBank = gameIdx % GAMEDB_GAMES_PER_BANK;
        const slotInBank = (dbBankIdx === 0) ? (gameInBank + 1) : gameInBank;
        const romOffset  = GAMEDB_BANK4_BASE + dbBankIdx * BANK_SIZE + GAMEDB_HEADER_SIZE + slotInBank * GAMEDB_SLOT_SIZE;
        rom.set(slotData, romOffset);

        const sramId = (r.sramSlot !== undefined && r.sramSlot !== null)
          ? r.sramSlot
          : Math.floor(r.flashOffset / SRAM_BLOCK) * 2;
        const sramSlots = requiredSramSlots(g.rom.size, g.rom.sramSize, g);
        let logMsg = `  ${slotIdx}: ${g.title} (CRC32: 0x${g.crc32.toString(16).toUpperCase().padStart(8, '0')}) @ ${formatHexOffset(r.flashOffset)} [${formatRegs(r.v7000, r.v7001, r.v7002)}]`;
        if (g.mapperPatch) logMsg += ' [PATCHED]';
        log('ok', logMsg);

        if ((r.v7002 & V7002_NO_SRAM_MODE) === 0) {
          const sramBytes = Math.min(Math.max(g.rom.sramSize || 0, 0), sramSlots * SRAM_SLOT_SIZE);
          sramPlacements.push({ sramId, sramSlots, sramBytes, stem: g.stem });
        }
        if (slotIdx % 10 === 0) progress(40 + Math.min(35, slotIdx / games.length * 35));
      }

      /* Append flash data after menu */
      const extraData = flash.subarray(MENU_SIZE, outSize);
      const fullRom   = new Uint8Array(MENU_SIZE + extraData.length);
      fullRom.set(rom.subarray(0, MENU_SIZE));
      fullRom.set(extraData, MENU_SIZE);
      rom = fullRom;

      if (skipped.length) {
        log('warn', 'Skipped games:');
        for (const [t, r] of skipped) log('warn', `  ${t}: ${r}`);
      }
      if (warnings.length) {
        for (const [t, w] of warnings) log('warn', `  ${t}: ${w}`);
      }
      log('ok', `Database: ${slotIdx} game(s) placed`);
      progress(75);
      await sleep(0);

      /* --- Build combined .sav --- */
      if (sramPlacements.length > 0) {
        log('head', '=== Building Combined SRAM (.sav) ===');
        const savBuf = new Uint8Array(SRAM_TOTAL_SIZE);
        let foundAny = false;
        for (const p of sramPlacements) {
          const savFile = state.savFiles[p.stem];
          if (!savFile) continue;
          const totalBytes = Math.min(
            p.sramBytes || (p.sramSlots * SRAM_SLOT_SIZE),
            p.sramSlots * SRAM_SLOT_SIZE,
          );
          for (let i = 0; i < p.sramSlots; i++) {
            const slot = p.sramId + i;
            if (slot < 0 || slot >= SRAM_NUM_SLOTS) continue;
            const srcOff = i * SRAM_SLOT_SIZE;
            const dstOff = sramDataChunkOffset(p.sramId, i, p.sramSlots);
            const chunkLen = Math.min(
              sramChunkLength(p.sramId, i, p.sramSlots, totalBytes, savBuf.length),
              Math.max(0, savFile.length - srcOff),
            );
            if (chunkLen <= 0) continue;
            savBuf.set(savFile.subarray(srcOff, srcOff + chunkLen), dstOff);
          }
          log('ok', `  Slots ${p.sramId + 1}-${p.sramId + p.sramSlots}: ${p.stem}.sav (${savFile.length} bytes)`);
          foundAny = true;
        }
        if (foundAny) savData = savBuf;
        else log('info', '  No .sav files found — skipping');
      }
    }
    progress(85);

    /* --- Update ROM header --- */
    const titleStr = new TextEncoder().encode('GBMEM-MENU 256M');
    rom.set(titleStr, 0x134);
    if (rom.length > BANK_PAIR_SIZE) rom[0x148] = Math.round(Math.log2(rom.length / BANK_PAIR_SIZE));

    /* --- Fix checksums --- */
    log('head', '=== Fixing Checksums ===');
    const checksum = fixChecksums(rom);
    log('ok', `Checksum: 0x${checksum.toString(16).toUpperCase().padStart(4, '0')}`);
    progress(95);

    /* --- Download --- */
    const outName = `GBMEM-MENU_256M_${checksum.toString(16).toUpperCase().padStart(4, '0')}.gbc`;
    downloadBlob(rom, outName);
    log('ok', `Downloaded: ${outName} (${(rom.length / 1024 / 1024).toFixed(2)} MiB)`);

    if (savData) {
      await sleep(500);
      const savName = outName.replace('.gbc', '.sav');
      downloadBlob(savData, savName);
      log('ok', `Downloaded: ${savName} (${SRAM_TOTAL_SIZE / 1024} KiB)`);
    }

    progress(100);

    /* --- Build Summary --- */
    log('head', '=== Build Summary ===');

    /* Game Selection table */
    const sim = state.games.length ? simulatePlacements() : null;
    if (sim) {
      log('info', 'Game Selection:');
      let summaryOrd = 0;
      for (let i = 0; i < state.games.length; i++) {
        const g = state.games[i];
        const p = sim[i];
        const isPlaced = p && p.offset != null;
        const sram = g.forceNoSram ? 'off' : (g.rom.sramSize ? formatSize(g.rom.sramSize) : 'none');
        if (isPlaced) {
          summaryOrd++;
          const sramSlot = p.sramSlot != null ? `SRAM#${p.sramSlot+1}` : '';
          log('ok', `  ${String(summaryOrd).padStart(2)}: ${g.title}  [${formatSize(g.rom.size)}, ${gameMapperLabel(g)}, ${g.platform}, SRAM:${sram}]  @ ${formatHexOffset(p.offset)} ${sramSlot}`);
        } else {
          const reason = (p && p.skip) || 'no space';
          log('warn', `   -: ${g.title}  [${formatSize(g.rom.size)}, ${gameMapperLabel(g)}, ${g.platform}, SRAM:${sram}]  – ${reason}`);
        }
      }
    }

    /* Flash usage map (ASCII art) */
    if (sim) {
      const { blockOwner, blockStart, pct, TOTAL_BLOCKS, usedBytes } = computeBlockOwners(sim);

      /* Uppercase = first block of entry, lowercase = continuation, .=free */
      const COLS = 64;
      const chars = [];
      for (let b = 0; b < TOTAL_BLOCKS; b++) {
        const o = blockOwner[b];
        if (o === 0) chars.push(blockStart[b] ? 'M' : 'm');
        else if (o > 0) chars.push(blockStart[b] ? 'R' : 'r');
        else chars.push('.');
      }
      log('info', 'Flash Usage Map:');
      for (let row = 0; row < chars.length; row += COLS) {
        log('info', '  ' + chars.slice(row, row + COLS).join(''));
      }
      log('info', `  ${pct.toFixed(1)}% used (${formatSize(usedBytes)} / ${formatSize(FLASH_SIZE)})`);
    }

    /* Backgrounds */
    const cgbParts = [`mode=${state.cgbRenderMode}`, `primary1=${state.cgbColor0}`, `primary2=${state.cgbColor3}`];
    if (state.cgbInvert) cgbParts.push('inverted');
    if (state.cgbRenderMode === 'grayscale') {
      cgbParts.push(`secondary1=${state.cgbSecondary1}`, `secondary2=${state.cgbSecondary2}`);
      cgbParts.push(`thresholds: dark=${state.cgbThresholdLow}, light=${state.cgbThresholdHigh}`);
    }
    log('info', `CGB Background: ${state.bgCgb ? state.bgCgb.name : 'default'}  [${cgbParts.join(', ')}]`);
    log('info', `DMG Background: ${state.bgDmg ? state.bgDmg.name : 'default'}  [thresholds: dark=${state.dmgThresholdLow}, light=${state.dmgThresholdHigh}${state.dmgInvert ? ', inverted' : ''}]`);
    log('info', `Music: ${state.enableMusic ? 'enabled' : 'disabled'}`);
    log('info', `Skip reboot on CGB games: ${state.skipRebootOnCgbGames ? 'enabled' : 'disabled'}`);

    /* News ticker */
    if (state.tickerMode === 'text') {
      const tickerEl = document.getElementById('tickerText');
      const text = tickerEl ? tickerEl.value.trim() : '';
      log('info', `News: "${text}"`);
    } else {
      log('info', `News: ${state.newsImage ? state.newsImage.name : 'default'} (image)`);
    }

    log('ok', `Use the FlashGBX software to write the ROM and Save Data to compatible flash cartridges.`);
    log('head', `=== Build of ${outName.replace('.gbc', '')} Complete! ===`);

  });
}


/* --- General Helpers --- */

/** Show/hide an element by id. No-op if the element doesn't exist. */
function showEl(id, visible) {
  const el = document.getElementById(id);
  if (el) el.style.display = visible ? '' : 'none';
}

/** Format a byte count as "X MiB", "X KiB" or "X B". */
function formatSize(bytes) {
  if (bytes >= 1048576) { const v = bytes / 1048576; return (v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)) + ' MiB'; }
  if (bytes >= 1024)    { const v = bytes / 1024;    return (v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)) + ' KiB'; }
  return bytes + ' B';
}

/** Format ROM/SRAM size as a two-line table cell. */
function formatRomSramSize(romBytes, sramBytes) {
  const sram = sramBytes > 0 ? formatSize(sramBytes) : '-';
  return `ROM: ${formatSize(romBytes)}<br>SRAM: ${sram}`;
}

/** Format ROM/SRAM offsets as a two-line table cell. */
function formatRomSramOffset(romOffset, sramSlot) {
  const sramOffset = (sramSlot !== null && sramSlot !== undefined && sramSlot >= 0)
    ? formatHexOffset(sramSlotOffset(sramSlot))
    : '-';
  return `ROM: ${formatHexOffset(romOffset)}<br>SRAM: ${sramOffset}`;
}

/** Format 256M mapper registers */
function formatRegs(v7000, v7001, v7002) {
  const aa = v7000.toString(16).toUpperCase().padStart(2, '0');
  const bb = v7001.toString(16).toUpperCase().padStart(2, '0');
  const cc = v7002.toString(16).toUpperCase().padStart(2, '0');
  const c  = ((v7002 >> 2) & 1) == 1 ? 'A' : '-';
  const d  = ((v7002 >> 5) & 1) == 1 ? 'L' : '-';
  const e  = ((v7002 >> 6) & 1) == 1 ? 'N' : '-';
  return `${aa}:${bb}:${cc}<br>${c}${d}${e}`;
}

/** Format a flash offset as "0x0NNNNNN". */
function formatHexOffset(n) {
  return '0x' + n.toString(16).toUpperCase();
}

/** Sanitize a string for use as a filename. */
function sanitizeFilename(s) {
  return String(s || '')
    .replace(/[<>:"\/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim() || 'untitled';
}

/** HTML-escape a string for safe innerHTML insertion. */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Promise-based sleep (yield to the event loop during long operations). */
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** Trigger a file download for a Uint8Array. */
function downloadBlob(data, filename) {
  const blob = new Blob([data], { type: 'application/octet-stream' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
}
/* --- Extractor – Parse Game Database --- */

/** Parse the game database from a 256M compilation ROM into state.games. */
function parseGameDatabase() {
  state.games = [];
  if (!state.romData) return;

  const rom = state.romData;
  const dec = new TextDecoder('utf-8', { fatal: false });

  for (let bankIdx = 0; bankIdx < 4; bankIdx++) {
    const bankBase = GAMEDB_BANK4_BASE + bankIdx * BANK_SIZE;
    for (let s = (bankIdx === 0 ? 1 : 0); s < GAMEDB_SLOTS_PER_BANK; s++) {
      const off = bankBase + GAMEDB_HEADER_SIZE + s * GAMEDB_SLOT_SIZE;
      if (off + GAMEDB_SLOT_SIZE > rom.length) break;

      const slotIdx = rom[off];
      if (slotIdx === 0 || slotIdx === 0xFF) continue;

      const v7000   = rom[off + 1];
      const v7001   = rom[off + 2];
      const v7002   = rom[off + 3];

      const bankNum  = v7000 | ((v7002 & 0x03) << 8);
      const flashOff = bankNum * BANK_PAIR_SIZE;
      const romBanks = (256 - v7001) & 0xFF;
      const romSize  = romBanks * BANK_PAIR_SIZE;
      const hasSram  = (v7002 & V7002_NO_SRAM_MODE) === 0;

      const titleRaw = dec.decode(rom.slice(off + 9, off + 9 + 54));
      const title    = titleRaw.replace(/[\x00-\x1F\x7F-\xFF]+$/g, '').trim();

      if (romSize === 0 || flashOff + romSize > rom.length) continue;

      const flashSlice = rom.slice(flashOff, flashOff + romSize);
      const romView = restoreExtractedRomData(flashSlice, { romSize, v7002 });
      const cartType = romView.length > 0x147 ? romView[0x147] : 0;
      const sramCode = romView.length > 0x149 ? romView[0x149] : 0;
      const sramSize = MBC2_TYPES.has(cartType) ? 512 : (SRAM_SIZES[sramCode] || 0);
      const reqSramSlots = requiredSramSlots(romSize, sramSize, { cartType });
      let sramSlot = -1;
      if (hasSram) {
        const baseSlot = Math.floor(flashOff / SRAM_BLOCK) * 2;
        const backAligned = (v7002 & V7002_LAST_SRAM_BANK_MODE) !== 0
          && canUseLastSramBankModeForSlot(baseSlot + 1);
        sramSlot = (reqSramSlots === 1 && backAligned) ? (baseSlot + 1) : baseSlot;
        if (sramSlot < 0 || sramSlot >= SRAM_NUM_SLOTS) sramSlot = -1;
      }
      const platform = detectPlatform(romView);

      let internalTitle = '';
      if (romView.length > 0x143) {
        internalTitle = dec.decode(romView.slice(0x134, 0x143))
          .replace(/[\x00-\x1F\x7F-\xFF]/g, '').trim();
      }

      state.games.push({
        slotIdx, title, internalTitle, platform,
        flashOff, romSize, hasSram, sramSlot,
        cartType, sramCode, sramSize, v7000, v7001, v7002,
      });
    }
  }

  state.games.sort((a, b) => a.slotIdx - b.slotIdx);
}

/* --- Extractor – UI & Extraction --- */

/** Refresh the ROM status display on the extractor page. */
function updateRomUI() {
  const el = document.getElementById('romList');
  if (state.romData) {
    el.innerHTML = renderFileItem('✓', state.romName, 'removeRom()', formatSize(state.romData.length));
  } else {
    resetToEmpty(el);
  }
  document.getElementById('extractBtn').disabled = !state.romData || state.games.length === 0;
}

/** Refresh the save-file status display on the extractor page. */
function updateSavUI() {
  const el = document.getElementById('savList');
  if (state.savData) {
    el.innerHTML = renderFileItem('✓', state.savName, 'removeSav()', formatSize(state.savData.length));
  } else {
    resetToEmpty(el);
  }
  updateGameTable();
}

/** Clear the loaded ROM and reset the extractor state. */
function removeRom() {
  state.romData = null; state.romName = ''; state.games = [];
  updateRomUI(); updateGameTable();
}

/** Clear the loaded save file. */
function removeSav() {
  state.savData = null; state.savName = '';
  updateSavUI();
}

/** Check whether an SRAM slot in the loaded .sav file contains non-empty data. */
function isSramSlotNonEmpty(slotIdx) {
  if (!state.savData || slotIdx < 0 || slotIdx >= SRAM_NUM_SLOTS) return false;
  const off = sramSlotOffset(slotIdx);
  const end = off + SRAM_SLOT_SIZE;
  if (end > state.savData.length) return false;
  for (let i = off; i < end; i++) {
    if (state.savData[i] !== 0x00 && state.savData[i] !== 0xFF) return true;
  }
  return false;
}

function isSramRangeNonEmpty(slotIdx, count) {
  for (let i = 0; i < count; i++) {
    const off = sramDataChunkOffset(slotIdx, i, count);
    const chunkLen = sramChunkLength(slotIdx, i, count, count * SRAM_SLOT_SIZE, state.savData ? state.savData.length : SRAM_TOTAL_SIZE);
    const end = off + chunkLen;
    if (!state.savData || end > state.savData.length) continue;
    for (let p = off; p < end; p++) {
      if (state.savData[p] !== 0x00 && state.savData[p] !== 0xFF) return true;
    }
  }
  return false;
}

/** Render the detected-games table on the extractor page. */
function updateGameTableExtractor() {
  const sec  = document.getElementById('gameListSection');
  const body = document.getElementById('gameTableBody');

  if (state.games.length === 0) {
    sec.style.display = 'none';
    body.innerHTML = '';
    document.getElementById('extractBtn').disabled = true;
    return;
  }

  sec.style.display = '';
  document.getElementById('extractBtn').disabled = false;

  const sramShareCounts = new Map();
  for (const g of state.games) {
    if (!g.hasSram || g.sramSlot < 0 || g.sramSlot >= SRAM_NUM_SLOTS) continue;
    const reqSlots = requiredSramSlots(g.romSize, g.sramSize);
    const key = sramShareKey(g.sramSlot, reqSlots);
    sramShareCounts.set(key, (sramShareCounts.get(key) || 0) + 1);
  }
  const sharedSramKeys = new Set();
  for (const [key, count] of sramShareCounts.entries()) {
    if (count > 1) sharedSramKeys.add(key);
  }

  let html = '<table class="game-table"><thead><tr>' +
    '<th>#</th><th>Game Title</th><th>SRAM Slot</th><th>Platform</th>' +
    '<th>Size</th><th>Location</th><th>Registers</th>' +
    '</tr></thead><tbody>';

  for (const g of state.games) {
    const platCls   = platformBadgeClass(g.platform);
    const mapper    = mapperName(g.cartType);
    const platBadge = `<span class="plat-badge ${platCls}">${g.platform}</span> ${mapper}`;
    const reqSlotsForBadge = requiredSramSlots(g.romSize, g.sramSize);
    const saveBadge = (g.hasSram && isSramRangeNonEmpty(g.sramSlot, reqSlotsForBadge))
      ? ' <span class="save-badge">+SAVE</span>' : '';
    let sramInfo;
    if (g.hasSram) {
      const reqSlots = requiredSramSlots(g.romSize, g.sramSize);
      const endSlot = g.sramSlot + reqSlots - 1;
      const shareHint = sharedSramKeys.has(sramShareKey(g.sramSlot, reqSlots))
        ? ' <span class="sram-share" title="Shares save data with at least one other game.">🔗</span>'
        : '';
      sramInfo = reqSlots > 1
        ? `Slots ${g.sramSlot + 1}\u2013${endSlot + 1}${saveBadge}${shareHint}`
        : `Slot ${g.sramSlot + 1}${saveBadge}${shareHint}`;
    } else {
      sramInfo = '\u2014';
    }
    const regs      = formatRegs(g.v7000, g.v7001, g.v7002);

    html += `<tr>` +
      `<td data-label="#" class="reg-cell">${g.slotIdx}</td>` +
      `<td data-label="Title" class="title-cell">${esc(g.title)}</td>` +
      `<td data-label="SRAM" class="sram-cell">${sramInfo}</td>` +
      `<td data-label="Platform">${platBadge}</td>` +
      `<td data-label="Size" class="offset-cell">${formatRomSramSize(g.romSize, g.sramSize)}</td>` +
      `<td data-label="Offset" class="offset-cell">${formatRomSramOffset(g.flashOff, g.sramSlot)}</td>` +
      `<td data-label="Regs" class="reg-cell">${regs}</td>` +
      `</tr>`;
  }

  html += '</tbody></table>';
  body.innerHTML = html;
}

/** Handle dropped/selected files on the extractor page (.gbc / .sav). */
async function handleFilesExtractor(fileList) {
  for (const file of fileList) {
    const ext = getFileExtension(file.name);
    const buf = new Uint8Array(await file.arrayBuffer());

    if (ext === '.sav') {
      if (buf.length !== SRAM_TOTAL_SIZE) {
        log('warn', `${file.name}: expected ${formatSize(SRAM_TOTAL_SIZE)} .sav file, got ${formatSize(buf.length)}`);
        continue;
      }
      state.savData = buf;
      state.savName = file.name;
      updateSavUI();
      continue;
    }

    if (ext === '.gb' || ext === '.gbc') {
      if (buf.length < MENU_SIZE) {
        log('warn', `${file.name}: too small for a 256M compilation ROM`);
        continue;
      }
      const hdrTitle = new TextDecoder('ascii').decode(buf.slice(0x134, 0x143)).replace(/\0.*/, '');
      const hdrVer   = buf[0x14C];
      if (!hdrTitle.startsWith('GBMEM-MENU') || hdrVer !== 1) {
        log('err', `${file.name}: Only ROMs created with the GBMem-Menu 256M ROM Builder are supported.`);
        continue;
      }
      state.romData = buf;
      state.romName = file.name;
      parseGameDatabase();
      updateRomUI();
      updateGameTable();
    }
  }
}

/* --- Extractor – ZIP Writer (Store method, no compression) --- */

/**
 * Build a ZIP archive (Store method, no compression) from an array
 * of { name, data } entries.  Returns the final Uint8Array.
 */
function createZip(entries) {
  const enc            = new TextEncoder();
  const localHeaders   = [];
  const centralHeaders = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBytes = enc.encode(name);
    const crc       = crc32(data);
    const size      = data.length;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv    = new DataView(local.buffer);
    lv.setUint32(0, 0x04034B50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    localHeaders.push({ header: local, data, offset });

    const central = new Uint8Array(46 + nameBytes.length);
    const cv      = new DataView(central.buffer);
    cv.setUint32(0, 0x02014B50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralHeaders.push(central);

    offset += local.length + data.length;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const c of centralHeaders) cdSize += c.length;

  const eocd = new Uint8Array(22);
  const ev   = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054B50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdOffset, true);
  ev.setUint16(20, 0, true);

  const totalSize = offset + cdSize + 22;
  const zip = new Uint8Array(totalSize);
  let pos = 0;
  for (const { header, data } of localHeaders) {
    zip.set(header, pos); pos += header.length;
    zip.set(data, pos);   pos += data.length;
  }
  for (const c of centralHeaders) { zip.set(c, pos); pos += c.length; }
  zip.set(eocd, pos);

  return zip;
}

/** Run the extraction pipeline: slice ROMs, collect saves, build ZIP, download. */
async function startExtract() {
  if (!state.romData || state.games.length === 0) return;
  clearLog();

  await withProgressUI('extractBtn', () => !state.romData || state.games.length === 0, async (progress) => {
    const rom     = state.romData;
    const sav     = state.savData;
    const entries = [];

    log('head', '=== Extracting Games ===');
    const total = state.games.length;

    for (let i = 0; i < total; i++) {
      const g   = state.games[i];
      const pct = 10 + Math.floor(80 * i / total);
      progress(pct);

      let romSlice = rom.slice(g.flashOff, g.flashOff + g.romSize);
      romSlice = restoreExtractedRomData(romSlice, g);

      const safeName    = sanitizeFilename(g.title || g.internalTitle || `game_${g.slotIdx}`);
      const ext         = (g.platform === 'CGB' || g.platform === 'CGB!') ? '.gbc'
                        : g.platform === 'SGB' ? '.sgb' : '.gb';
      const romFilename = `${String(g.slotIdx).padStart(2, '0')}_${safeName}${ext}`;

      entries.push({ name: romFilename, data: romSlice });

      let hasSave = false;
      if (g.hasSram && sav && g.sramSlot >= 0 && g.sramSlot < SRAM_NUM_SLOTS) {
        const reqSlots = requiredSramSlots(g.romSize, g.sramSize);
        const totalBytes = Math.min(Math.max(g.sramSize || 0, 0), reqSlots * SRAM_SLOT_SIZE);
        const savSlice = new Uint8Array(totalBytes);
        let complete = true;
        for (let si = 0; si < reqSlots; si++) {
          const slot = g.sramSlot + si;
          if (slot < 0 || slot >= SRAM_NUM_SLOTS) { complete = false; break; }
          const sramOff = sramDataChunkOffset(g.sramSlot, si, reqSlots);
          const chunkLen = sramChunkLength(g.sramSlot, si, reqSlots, totalBytes, sav.length);
          const sramEnd = sramOff + chunkLen;
          if (sramEnd > sav.length) { complete = false; break; }
          if (chunkLen > 0) savSlice.set(sav.slice(sramOff, sramEnd), si * SRAM_SLOT_SIZE);
        }
        if (complete) {
          let empty = true;
          for (let j = 0; j < savSlice.length; j++) {
            if (savSlice[j] !== 0x00 && savSlice[j] !== 0xFF) { empty = false; break; }
          }
          if (!empty) {
            const savFilename = romFilename.replace(ext, '.sav');
            entries.push({ name: savFilename, data: savSlice });
            hasSave = true;
          }
        }
      }
      logGame(g.slotIdx, g.title, g.romSize, hasSave);

      if (i % 5 === 0) await sleep(0);
    }

    progress(90);
    log('head', '=== Creating ZIP ===');
    const zip = createZip(entries);
    log('ok', `ZIP: ${entries.length} file(s), ${formatSize(zip.length)}`);
    progress(95);

    const baseName = state.romName.replace(/\.[^.]+$/, '');
    const zipName  = `${baseName}_extracted.zip`;
    downloadBlob(zip, zipName);

    log('ok', `Downloaded: ${zipName}`);
    progress(100);
    log('head', '=== Extraction Complete! ===');

  });
}

/* --- Dispatch & Initialisation --- */

/** Cache the initial innerHTML of a container into data-text for later reuse. */
function cacheEmptyText(id) {
  const el = document.getElementById(id);
  if (el) el.dataset.text = el.innerHTML;
}

/** Restore a container to its initial empty state (from cached data-text). */
function resetToEmpty(el) {
  if (!el) return;
  el.innerHTML = el.dataset.text || '';
}

/** Route file handling to the active page's implementation. */
function handleFiles(fileList) {
  if (PAGE === 'builder') return handleFilesBuilder(fileList);
  return handleFilesExtractor(fileList);
}

/** Route game-table rendering to the active page's implementation. */
function updateGameTable() {
  if (PAGE === 'builder') return updateGameTableBuilder();
  return updateGameTableExtractor();
}

/* Shared drop-zone wiring */
const dropzone  = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');

if (dropzone && fileInput) {
  dropzone.setAttribute('role', 'button');
  dropzone.setAttribute('tabindex', '0');
  dropzone.setAttribute('aria-controls', 'fileInput');
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener('change', e => { handleFiles(e.target.files); e.target.value = ''; });
}

/* Cache initial empty-state HTML for all file-column containers */
if (PAGE === 'builder') {
  ['menuList', 'bgList', 'newsList', 'gamesList'].forEach(cacheEmptyText);
} else {
  ['romList', 'savList'].forEach(cacheEmptyText);
}

/* Builder-only initialisation */
if (PAGE === 'builder') {
  document.getElementById('tickerText').value = getDefaultTickerText();
  document.fonts.ready.then(() => loadDefaultBgPreviews());
  loadMapperPatches();

  const gsBody = document.getElementById('gameSelectionBody');
  gsBody.addEventListener('dragover', e => {
    if (_gameDragIdx !== null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  gsBody.addEventListener('drop', e => {
    if (_gameDragIdx !== null) return;
    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
    e.preventDefault();
    handleFilesAtPosition(e.dataTransfer.files, state.games.length);
  });
}
