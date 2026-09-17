// tools/make-icon.mjs — 배포용 아이콘을 굽는다.
//
// WHENNOTE는 원본 PNG를 읽어 줄이지만 이쪽은 원본이 없다. 대신 **그린다** — 이 앱의 상징이
// 오버레이의 링 게이지라 도형이 원과 호 둘뿐이고, 그 정도는 계산으로 그리는 편이 낫다.
// 손으로 그린 512px을 16px로 줄이면 얇은 획이 뭉개지는데, 크기마다 다시 계산하면 두께가
// 그 크기에 맞게 나온다.
//
//   build/icon.png  — 설치 파일·실행 파일이 쓰는 앱 아이콘 (512px, 배경 있음)
//   build/tray.png  — 트레이 글리프 (32px, 배경 투명)
//
// 외부 의존성을 두지 않으려고 PNG 인코더를 직접 넣었다(zlib만 쓴다).
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'build');

// ── PNG 인코딩 (RGBA 8bit)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // 나머지(압축·필터·인터레이스)는 0

  // 스캔라인마다 필터 바이트 0을 앞에 붙인다
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── 그리기
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// 16px에서도 형태가 남으려면 가장자리가 부드러워야 한다. 픽셀마다 4×4로 나눠 세어
// 덮인 비율을 알파로 쓴다 — 축소가 아니라 그 크기에서 바로 그리는 방식이다.
const SS = 4;

function render(size, { bg = null, ring, sweep = 0.72, radius = 0.34, thick = 0.125 }) {
  const buf = Buffer.alloc(size * size * 4);
  const c = size / 2;
  const R = size * radius;
  const half = (size * thick) / 2;
  const ringRGB = hex(ring);
  const bgRGB = bg ? hex(bg) : null;
  // 앱 아이콘 배경은 둥근 사각형이다 — 정사각형은 Windows 설치 화면에서 유독 튄다
  const corner = size * 0.22;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let ringHits = 0;
      let bgHits = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          const dx = px - c;
          const dy = py - c;
          const dist = Math.hypot(dx, dy);

          if (Math.abs(dist - R) <= half) {
            // 12시에서 시계방향으로 sweep 만큼만 그린다 — 남은 시간이 줄어든 링
            let a = Math.atan2(dx, -dy) / (Math.PI * 2);
            if (a < 0) a += 1;
            if (a <= sweep) ringHits++;
          }

          if (bgRGB) {
            const qx = Math.abs(dx) - (size / 2 - corner);
            const qy = Math.abs(dy) - (size / 2 - corner);
            const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - corner;
            if (outside <= 0) bgHits++;
          }
        }
      }

      const total = SS * SS;
      const ringA = ringHits / total;
      const bgA = bgRGB ? bgHits / total : 0;
      const i = (y * size + x) * 4;

      // 링을 배경 위에 얹는다
      const outA = ringA + bgA * (1 - ringA);
      if (outA <= 0) continue;
      for (let k = 0; k < 3; k++) {
        const src = ringRGB[k] * ringA + (bgRGB ? bgRGB[k] : 0) * bgA * (1 - ringA);
        buf[i + k] = Math.round(src / outA);
      }
      buf[i + 3] = Math.round(outA * 255);
    }
  }
  return buf;
}

function write(name, size, opts) {
  const file = path.join(OUT, name);
  fs.writeFileSync(file, encodePng(size, render(size, opts)));
  console.log(`  ${name}  ${size}x${size}`);
}

fs.mkdirSync(OUT, { recursive: true });
console.log('아이콘을 굽는다');

// 앱 아이콘 — 어두운 둥근 사각형 위에 accent 링 (형제 앱과 같은 팔레트)
write('icon.png', 512, { bg: '#16171c', ring: '#7aa2f7', radius: 0.3, thick: 0.1 });

// 트레이 글리프 — 배경 없이 링만. 16px 트레이에서도 원으로 읽히도록 조금 두껍게
write('tray.png', 32, { ring: '#e6e8ee', radius: 0.33, thick: 0.17 });
write('tray@2x.png', 64, { ring: '#e6e8ee', radius: 0.33, thick: 0.17 });
