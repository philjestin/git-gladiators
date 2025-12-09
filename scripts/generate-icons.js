/**
 * Generate PNG icons for Git Gladiators Chrome extension
 * Uses pure JavaScript PNG generation - no native dependencies
 * Run with: node scripts/generate-icons.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ICONS_DIR = path.join(__dirname, '..', 'icons');
const ICON_SIZES = [16, 48, 128];

// Colors
const COLORS = {
  background: [26, 26, 37, 255],      // #1a1a25
  gold: [255, 215, 0, 255],            // #ffd700
  darkGold: [204, 172, 0, 255],        // darker gold for shadow
  cyan: [0, 255, 255, 255],            // #00ffff
};

/**
 * Create a PNG file from raw RGBA pixel data
 */
function createPNG(width, height, pixels) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  
  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8);   // bit depth
  ihdrData.writeUInt8(6, 9);   // color type (RGBA)
  ihdrData.writeUInt8(0, 10);  // compression
  ihdrData.writeUInt8(0, 11);  // filter
  ihdrData.writeUInt8(0, 12);  // interlace
  const ihdr = createChunk('IHDR', ihdrData);
  
  // IDAT chunk (compressed image data)
  const rawData = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    rawData[y * (width * 4 + 1)] = 0; // filter byte
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = y * (width * 4 + 1) + 1 + x * 4;
      rawData[dstIdx] = pixels[srcIdx];
      rawData[dstIdx + 1] = pixels[srcIdx + 1];
      rawData[dstIdx + 2] = pixels[srcIdx + 2];
      rawData[dstIdx + 3] = pixels[srcIdx + 3];
    }
  }
  const compressed = zlib.deflateSync(rawData, { level: 9 });
  const idat = createChunk('IDAT', compressed);
  
  // IEND chunk
  const iend = createChunk('IEND', Buffer.alloc(0));
  
  return Buffer.concat([signature, ihdr, idat, iend]);
}

/**
 * Create a PNG chunk with type, data, and CRC
 */
function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData), 0);
  
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/**
 * CRC32 calculation for PNG chunks
 */
function crc32(data) {
  let crc = 0xffffffff;
  const table = getCRC32Table();
  
  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  
  return (crc ^ 0xffffffff) >>> 0;
}

let crc32Table = null;
function getCRC32Table() {
  if (crc32Table) return crc32Table;
  
  crc32Table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crc32Table[i] = c;
  }
  return crc32Table;
}

/**
 * Set a pixel in the image buffer
 */
function setPixel(pixels, width, x, y, color) {
  if (x < 0 || x >= width || y < 0) return;
  const idx = (Math.floor(y) * width + Math.floor(x)) * 4;
  if (idx >= 0 && idx < pixels.length - 3) {
    // Alpha blending
    const alpha = color[3] / 255;
    const invAlpha = 1 - alpha;
    pixels[idx] = Math.round(color[0] * alpha + pixels[idx] * invAlpha);
    pixels[idx + 1] = Math.round(color[1] * alpha + pixels[idx + 1] * invAlpha);
    pixels[idx + 2] = Math.round(color[2] * alpha + pixels[idx + 2] * invAlpha);
    pixels[idx + 3] = Math.min(255, pixels[idx + 3] + color[3]);
  }
}

/**
 * Draw a filled rectangle
 */
function fillRect(pixels, width, x, y, w, h, color) {
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      setPixel(pixels, width, Math.floor(px), Math.floor(py), color);
    }
  }
}

/**
 * Draw a simple trophy shape
 */
function drawTrophy(pixels, size) {
  const cx = size / 2;
  const cy = size / 2;
  
  // Trophy cup (trapezoid shape)
  const cupTopWidth = size * 0.5;
  const cupBottomWidth = size * 0.3;
  const cupTop = cy - size * 0.25;
  const cupBottom = cy + size * 0.05;
  const cupHeight = cupBottom - cupTop;
  
  for (let row = 0; row < cupHeight; row++) {
    const progress = row / cupHeight;
    const currentWidth = cupTopWidth - (cupTopWidth - cupBottomWidth) * progress;
    const startX = cx - currentWidth / 2;
    fillRect(pixels, size, startX, cupTop + row, currentWidth, 1, COLORS.gold);
  }
  
  // Trophy stem
  const stemWidth = size * 0.1;
  const stemTop = cupBottom;
  const stemHeight = size * 0.12;
  fillRect(pixels, size, cx - stemWidth / 2, stemTop, stemWidth, stemHeight, COLORS.gold);
  
  // Trophy base
  const baseWidth = size * 0.35;
  const baseHeight = size * 0.08;
  const baseTop = stemTop + stemHeight;
  fillRect(pixels, size, cx - baseWidth / 2, baseTop, baseWidth, baseHeight, COLORS.gold);
  
  // Handles (for larger icons)
  if (size >= 32) {
    const handleWidth = Math.max(2, size * 0.06);
    const handleHeight = size * 0.15;
    const handleY = cupTop + cupHeight * 0.15;
    
    // Left handle
    fillRect(pixels, size, cx - cupTopWidth / 2 - handleWidth - 1, handleY, handleWidth, handleHeight, COLORS.gold);
    
    // Right handle  
    fillRect(pixels, size, cx + cupTopWidth / 2 + 1, handleY, handleWidth, handleHeight, COLORS.gold);
  }
}

/**
 * Draw border around the icon
 */
function drawBorder(pixels, size, color) {
  const borderWidth = Math.max(1, Math.floor(size / 16));
  
  // Top
  fillRect(pixels, size, 0, 0, size, borderWidth, color);
  // Bottom
  fillRect(pixels, size, 0, size - borderWidth, size, borderWidth, color);
  // Left
  fillRect(pixels, size, 0, 0, borderWidth, size, color);
  // Right
  fillRect(pixels, size, size - borderWidth, 0, borderWidth, size, color);
}

/**
 * Generate icon at specified size
 */
function generateIcon(size) {
  const pixels = new Uint8Array(size * size * 4);
  
  // Fill background
  for (let i = 0; i < size * size; i++) {
    pixels[i * 4] = COLORS.background[0];
    pixels[i * 4 + 1] = COLORS.background[1];
    pixels[i * 4 + 2] = COLORS.background[2];
    pixels[i * 4 + 3] = COLORS.background[3];
  }
  
  // Draw border
  drawBorder(pixels, size, COLORS.gold);
  
  // Draw trophy
  drawTrophy(pixels, size);
  
  // Add "GG" text for larger icons (128px)
  if (size >= 128) {
    // Simple "GG" at bottom - just draw cyan rectangles in G shapes
    const textY = size * 0.78;
    const letterSize = size * 0.08;
    const spacing = size * 0.02;
    
    // First G
    let gx = size * 0.35;
    // Vertical bar of G
    fillRect(pixels, size, gx, textY, letterSize * 0.3, letterSize, COLORS.cyan);
    // Top horizontal
    fillRect(pixels, size, gx, textY, letterSize, letterSize * 0.25, COLORS.cyan);
    // Bottom horizontal  
    fillRect(pixels, size, gx, textY + letterSize * 0.75, letterSize, letterSize * 0.25, COLORS.cyan);
    // Middle horizontal
    fillRect(pixels, size, gx + letterSize * 0.5, textY + letterSize * 0.4, letterSize * 0.5, letterSize * 0.25, COLORS.cyan);
    // Right small vertical
    fillRect(pixels, size, gx + letterSize * 0.7, textY + letterSize * 0.4, letterSize * 0.3, letterSize * 0.6, COLORS.cyan);
    
    // Second G
    gx = size * 0.55;
    fillRect(pixels, size, gx, textY, letterSize * 0.3, letterSize, COLORS.cyan);
    fillRect(pixels, size, gx, textY, letterSize, letterSize * 0.25, COLORS.cyan);
    fillRect(pixels, size, gx, textY + letterSize * 0.75, letterSize, letterSize * 0.25, COLORS.cyan);
    fillRect(pixels, size, gx + letterSize * 0.5, textY + letterSize * 0.4, letterSize * 0.5, letterSize * 0.25, COLORS.cyan);
    fillRect(pixels, size, gx + letterSize * 0.7, textY + letterSize * 0.4, letterSize * 0.3, letterSize * 0.6, COLORS.cyan);
  }
  
  return createPNG(size, size, pixels);
}

/**
 * Main function
 */
function main() {
  // Ensure icons directory exists
  if (!fs.existsSync(ICONS_DIR)) {
    fs.mkdirSync(ICONS_DIR, { recursive: true });
  }
  
  for (const size of ICON_SIZES) {
    const png = generateIcon(size);
    const filename = path.join(ICONS_DIR, `icon${size}.png`);
    fs.writeFileSync(filename, png);
    console.log(`✓ Generated ${filename} (${png.length} bytes)`);
  }
  
  console.log('\n🏆 All icons generated successfully!');
}

main();
