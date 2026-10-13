/* ============================================================
 * Turbo Web —— 打包脚本
 *
 * 产出两个文件（放在 dist/ 下）：
 *   dist/web-turbo-<ver>.zip   解压后用「加载已解压的扩展程序」安装
 *   dist/web-turbo-<ver>.crx   安卓狐猴浏览器「安装本地扩展」一步装好
 *
 * 两个都自己造，不依赖压缩软件或 openssl：
 *   - ZIP 用 zlib.deflateRawSync 手写结构
 *   - CRX3 用 Node crypto 生成 RSA 密钥并签名
 *
 * 首次运行会生成 tools/.crx-key.pem —— 这个私钥决定扩展 ID，
 * 已列入 .gitignore，**永远不要提交或分享**；要发布新版本必须复用
 * 同一把，否则用户装上去会是另一个扩展（需要先卸载旧的）。
 * ============================================================ */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist');
const KEY_FILE = path.join(__dirname, '.crx-key.pem');

// 只打包扩展运行必需的内容，tools/demo 属于开发资料不塞进去
const INCLUDE_DIRS = ['src', 'popup', 'icons'];
const INCLUDE_FILES = ['manifest.json', 'README.md'];

/* ---------------- 工具 ---------------- */
const u16le = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n >>> 0); return b; };
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };

function varint(n) {
  const out = [];
  let v = n;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
  return Buffer.from(out);
}

function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

/** 收集要打包的文件，返回 [{ name, data }]，name 用正斜杠 */
function collect() {
  const files = [];

  for (const f of INCLUDE_FILES) {
    const p = path.join(ROOT, f);
    if (fs.existsSync(p)) files.push({ name: f, data: fs.readFileSync(p) });
  }

  const walk = (dir, prefix) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      const rel = prefix + '/' + e.name;
      if (e.isDirectory()) walk(full, rel);
      else files.push({ name: rel, data: fs.readFileSync(full) });
    }
  };
  for (const d of INCLUDE_DIRS) {
    const p = path.join(ROOT, d);
    if (fs.existsSync(p)) walk(p, d);
  }

  return files;
}

/** 手写 ZIP：UTF-8 名称 + deflate */
function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  // 固定时间戳，保证同样内容产出同样的文件（便于比对）
  const time = u16le(0);
  const date = u16le(0x2821);   // 2020-01-01

  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.data);
    const deflated = zlib.deflateRawSync(f.data, { level: 9 });
    const useDeflate = deflated.length < f.data.length;
    const body = useDeflate ? deflated : f.data;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.concat([
      u32le(0x04034b50), u16le(20), u16le(0x0800), u16le(method),
      time, date, u32le(crc), u32le(body.length), u32le(f.data.length),
      u16le(name.length), u16le(0), name, body
    ]);
    locals.push(local);

    centrals.push(Buffer.concat([
      u32le(0x02014b50), u16le(20), u16le(20), u16le(0x0800), u16le(method),
      time, date, u32le(crc), u32le(body.length), u32le(f.data.length),
      u16le(name.length), u16le(0), u16le(0), u16le(0), u16le(0),
      u32le(0), u32le(offset), name
    ]));

    offset += local.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    u32le(0x06054b50), u16le(0), u16le(0),
    u16le(files.length), u16le(files.length),
    u32le(centralBuf.length), u32le(offset), u16le(0)
  ]);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

/* ---------------- CRX3 ---------------- */
/** 加载签名私钥；--ephemeral-key 时只在内存里生成一把，绝不落盘 */
function loadOrCreateKey() {
  if (process.argv.includes('--ephemeral-key')) {
    console.log('  --ephemeral-key：使用一次性内存密钥（CI 构建，不写入 tools/.crx-key.pem）');
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    return privateKey.export({ type: 'pkcs8', format: 'pem' });
  }
  if (fs.existsSync(KEY_FILE)) return fs.readFileSync(KEY_FILE, 'utf8');
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  fs.writeFileSync(KEY_FILE, pem, { mode: 0o600 });
  console.log('  已生成新签名密钥 tools/.crx-key.pem（决定扩展 ID，请备份）');
  return pem;
}

function makeCrx(zipBuf, privateKeyPem) {
  const publicKey = crypto.createPublicKey(privateKeyPem).export({ type: 'spki', format: 'der' });
  const crxId = crypto.createHash('sha256').update(publicKey).digest().subarray(0, 16);

  // SignedData { crx_id = 1 }
  const signedHeaderData = Buffer.concat([Buffer.from([0x0a]), varint(crxId.length), crxId]);

  // 签名覆盖：magic + 长度 + signed_header_data + zip
  const signed = Buffer.concat([
    Buffer.from('CRX3 SignedData\x00', 'utf8'),
    u32le(signedHeaderData.length),
    signedHeaderData,
    zipBuf
  ]);
  const signature = crypto.sign('sha256', signed, privateKeyPem);

  // AsymmetricKeyProof { public_key = 1, signature = 2 }
  const proof = Buffer.concat([
    Buffer.from([0x0a]), varint(publicKey.length), publicKey,
    Buffer.from([0x12]), varint(signature.length), signature
  ]);

  // CrxFileHeader: sha256_with_rsa = 2, signed_header_data = 10000
  const header = Buffer.concat([
    Buffer.from([0x12]), varint(proof.length), proof,
    Buffer.from([0x82, 0xf1, 0x04]), varint(signedHeaderData.length), signedHeaderData
  ]);

  const crx = Buffer.concat([
    Buffer.from('Cr24', 'ascii'), u32le(3), u32le(header.length), header, zipBuf
  ]);

  const id = [...crxId]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));

  return { crx, id };
}

/* ---------------- 主流程 ---------------- */
function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const ver = manifest.version;

  const files = collect();
  console.log(`打包 Turbo Web v${ver} —— ${files.length} 个文件`);

  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  const zipBuf = makeZip(files);
  const zipPath = path.join(OUT, `web-turbo-${ver}.zip`);
  fs.writeFileSync(zipPath, zipBuf);
  console.log(`  dist/web-turbo-${ver}.zip   ${(zipBuf.length / 1024).toFixed(1)} KB`);

  const { crx, id } = makeCrx(zipBuf, loadOrCreateKey());
  const crxPath = path.join(OUT, `web-turbo-${ver}.crx`);
  fs.writeFileSync(crxPath, crx);
  console.log(`  dist/web-turbo-${ver}.crx   ${(crx.length / 1024).toFixed(1)} KB`);
  console.log(`  扩展 ID: ${id}`);

  for (const f of files) console.log(`    · ${f.name}`);
}

main();
