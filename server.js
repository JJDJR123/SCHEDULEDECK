'use strict';
/* 日程舱 — 本地服务（静态页面 + 飞书代理 + 本地存档） */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const feishu = require('./feishu');

const argv = process.argv.slice(2);
const argOf = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};

const ROOT = __dirname;
const WEB = path.join(ROOT, 'web');
const DATA = path.resolve(argOf('data', path.join(ROOT, 'data')));
const STATE_FILE = path.join(DATA, 'state.json');
const CONFIG_FILE = path.join(DATA, 'config.json');
const OAUTH_FILE = path.join(DATA, 'oauth.json');
const OAUTH_PORT = Number(argOf('oauth-port', 17899)) || 17899;

// App ID 不是密钥（相当于公开的 client_id），内置省得每台机器都填；
// App Secret 才是凭证，永远不进安装包，由使用者在「设置 → 数据源 → 应用凭证」填，只存本机 data/config.json
const DEFAULT_APP_ID = 'cli_aa5276c66d78dc10';
const DEFAULT_APP_SECRET = '';
// 自动更新清单地址（公开仓库的固定地址，不是密钥），写死省得每台机器填
const DEFAULT_MANIFEST_URL = 'https://github.com/JJDJR123/SCHEDULEDECK/releases/download/latest/latest.json';

let oauthPortReady = false;
let pendingState = '';

fs.mkdirSync(DATA, { recursive: true });

/* ------------------------------------------------------------------ 自动更新 */

let updateState = { phase: 'idle', received: 0, total: 0, error: '', file: '', via: '' };

function appVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
  } catch {
    return { version: 'dev', stamp: '0' };
  }
}

function sha256File(file) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}

/** 私有仓库 / 私有存储：可以在 data/update.json 里配一个只读 token */
function authHeaders(cfg) {
  const h = { 'Cache-Control': 'no-cache', 'User-Agent': 'ScheduleDeck' };
  const token = String((cfg && cfg.token) || '').trim();
  if (token) h.Authorization = 'Bearer ' + token;
  return h;
}

let downloading = false;

// 国内直连 github 经常超时：按顺序换线路，哪条通用哪条
// 都是公开的 github 加速镜像，只拼接 download 地址，不经过任何第三方账号
const MIRRORS = ['', 'https://ghfast.top/', 'https://gh-proxy.com/', 'https://ghproxy.net/'];
let lastGoodMirror = '';   // 上次成功的线路（'' = 直连）

function mirrorCandidates(url) {
  if (!/^https:\/\/github\.com\//i.test(url)) return [{ url, direct: true }];
  const order = [lastGoodMirror, ...MIRRORS.filter((m) => m !== lastGoodMirror)];
  return [...new Set(order.filter((m) => m !== undefined))].map((m) => ({ url: m + url, direct: !m }));
}

async function fetchManifest(url, cfg) {
  let lastErr = null;
  for (const target of mirrorCandidates(url)) {
    try {
      // 镜像不传凭证，只有直连 github 才带 token
      const r = await fetch(target.url, { headers: target.direct ? authHeaders(cfg) : { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!j || !j.stamp) throw new Error('返回不是 latest.json');
      lastGoodMirror = MIRRORS.find((m) => m && target.url.startsWith(m)) || '';
      return j;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('所有线路都不通');
}

async function downloadFromOne(url, headers, expect) {
  const res = await fetch(url, {
    headers: { ...(headers || { 'Cache-Control': 'no-cache' }), Accept: 'application/octet-stream' },
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!res.ok) throw new Error('下载失败：HTTP ' + res.status);

  const dir = path.join(DATA, 'update');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'new.exe');
  try { fs.unlinkSync(file); } catch { /* 没有就算了 */ }

  const total = Number(res.headers.get('content-length') || 0);
  if (!expect.total) updateState.total = total;

  const out = fs.createWriteStream(file);
  const reader = res.body.getReader();
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();   // eslint-disable-line no-await-in-loop
    if (done) break;
    got += value.length;
    updateState.received = got;
    if (!out.write(Buffer.from(value))) {
      await new Promise((r) => out.once('drain', r));   // eslint-disable-line no-await-in-loop
    }
  }
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));

  if (expect.size && got !== expect.size) throw new Error(`大小不对（${got} ≠ ${expect.size}）`);
  if (expect.sha256) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (actual !== String(expect.sha256).toLowerCase()) throw new Error('校验不通过（内容被改过）');
  }
  return file;
}

async function downloadUpdate(url, headers, expect = {}) {
  if (downloading) return null;         // 同时只允许一个下载，避免进度重复累计
  downloading = true;
  updateState = { phase: 'downloading', received: 0, total: expect.size || 0, error: '', file: '', via: '' };
  try {
    let lastErr = null;
    for (const target of mirrorCandidates(url)) {
      try {
        updateState.received = 0;
        updateState.via = MIRRORS.find((m) => m && target.url.startsWith(m)) || '直连';
        const file = await downloadFromOne(target.url, target.direct ? headers : { 'Cache-Control': 'no-cache' }, expect);
        lastGoodMirror = MIRRORS.find((m) => m && target.url.startsWith(m)) || '';
        updateState.phase = 'ready';
        updateState.file = file;
        return file;
      } catch (e) {
        lastErr = e;
        try { fs.unlinkSync(path.join(DATA, 'update', 'new.exe')); } catch { /* ignore */ }
      }
    }
    throw lastErr || new Error('所有线路都下载失败');
  } finally {
    downloading = false;
  }
}


const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

// 首次运行只预填 App ID（公开标识），App Secret 不进安装包，必须本机填一次
function ensureDefaultApp() {
  const cfg = readJson(CONFIG_FILE, {});
  let changed = false;
  if (!cfg.appId) { cfg.appId = DEFAULT_APP_ID; changed = true; }
  if (changed) writeJson(CONFIG_FILE, cfg);
}

const NEED_SECRET = '这台机器还没保存 App Secret。打开「设置 → 数据源 → 应用凭证」填一次即可，它只存在本机 data/config.json，不会打包进 exe。';

function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('请求体太大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('JSON 格式错误')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(WEB, rel));
  if (!file.startsWith(path.normalize(WEB + path.sep))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(file).pipe(res);
  });
}

/* ------------------------------------------------------------------ 扫码登录 */

function redirectUri() {
  return `http://127.0.0.1:${OAUTH_PORT}/callback`;
}

function hostFromUrl(u) {
  try { return new URL(u).hostname; } catch { return ''; }
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}

function oauthPage(res, ok, title, detail) {
  const color = ok ? '#12B76A' : '#F04438';
  const mark = ok ? '✓' : '!';
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>日程舱 · 飞书授权</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;height:100vh;display:grid;place-items:center;background:#F3F5F9;
font-family:"Microsoft YaHei UI","Segoe UI",sans-serif;color:#151922}
.card{background:#fff;border:1px solid #E6E9F1;border-radius:16px;padding:36px 40px;
max-width:380px;text-align:center;box-shadow:0 20px 50px -20px rgba(16,24,40,.25)}
.icon{width:48px;height:48px;border-radius:50%;background:${color};color:#fff;
display:grid;place-items:center;font-size:26px;font-weight:700;margin:0 auto 16px}
h1{font-size:18px;margin:0 0 8px}p{font-size:13px;color:#586175;line-height:1.7;margin:0}
.hint{margin-top:14px;font-size:11.5px;color:#939CB0}
</style></head><body><div class="card">
<div class="icon">${mark}</div><h1>${escHtml(title)}</h1><p>${escHtml(detail)}</p>
${ok ? '<p class="hint">窗口会自动关闭，也可以手动关闭后回到日程舱</p>' : ''}
</div>${ok ? '<script>setTimeout(function(){window.close()},1500)</script>' : ''}
</body></html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

async function startOAuthServer() {
  return new Promise((resolve) => {
    const srv = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      const err = u.searchParams.get('error');
      const code = u.searchParams.get('code');
      const state = u.searchParams.get('state');
      if (err) return oauthPage(res, false, '授权未完成', err);
      if (!state || !pendingState || state !== pendingState) {
        return oauthPage(res, false, '校验失败', 'state 不匹配，请回到日程舱重新发起登录');
      }
      if (!code) return oauthPage(res, false, '缺少授权码', '请回到日程舱重新发起登录');

      const cfg = readJson(CONFIG_FILE, {});
      if (!cfg.appId || !cfg.appSecret) {
        return oauthPage(res, false, '缺少应用凭证', '请先在日程舱填写 App ID / Secret');
      }
      try {
        const j = await feishu.exchangeCode({
          appId: cfg.appId,
          appSecret: cfg.appSecret,
          code,
          redirectUri: redirectUri(),
          host: cfg.host || 'feishu.cn',
        });
        const info = await feishu.getUserInfo(j.access_token, cfg.host || 'feishu.cn');
        writeJson(OAUTH_FILE, {
          access_token: j.access_token,
          refresh_token: j.refresh_token || '',
          expires_at: Date.now() + (Number(j.expires_in) || 7200) * 1000,
          refresh_expires_at: j.refresh_token_expires_in
            ? Date.now() + Number(j.refresh_token_expires_in) * 1000 : null,
          scope: j.scope || '',
          host: cfg.host || 'feishu.cn',
          user: {
            name: info.name || '',
            avatar: info.avatar_url || '',
            open_id: info.open_id || '',
          },
          at: Date.now(),
        });
        pendingState = '';
        oauthPage(res, true, '登录成功', `${info.name || '飞书用户'}，现在可以回到日程舱读取表格了`);
      } catch (e) {
        oauthPage(res, false, '登录失败', e.message || String(e));
      }
    });
    srv.once('error', (e) => {
      oauthPortReady = false;
      console.warn(`[oauth] 回调端口 ${OAUTH_PORT} 不可用: ${e.message}`);
      resolve(null);
    });
    srv.listen(OAUTH_PORT, '127.0.0.1', () => {
      oauthPortReady = true;
      console.log(`[oauth] callback ${redirectUri()}`);
      resolve(srv);
    });
  });
}

async function ensureUserToken() {
  const cfg = readJson(CONFIG_FILE, {});
  const o = readJson(OAUTH_FILE, null);
  if (!o || !o.access_token) throw new Error('还没有登录飞书，请先扫码登录');
  const left = (o.expires_at || 0) - Date.now();
  if (left > 5 * 60 * 1000) return o.access_token;

  if (!o.refresh_token) throw new Error('登录已过期，请重新扫码登录');
  if (!cfg.appSecret) throw new Error(NEED_SECRET);
  const j = await feishu.refreshUserToken({
    appId: cfg.appId,
    appSecret: cfg.appSecret,
    refreshToken: o.refresh_token,
    host: o.host || 'feishu.cn',
  });
  const next = {
    ...o,
    access_token: j.access_token,
    refresh_token: j.refresh_token || o.refresh_token,
    expires_at: Date.now() + (Number(j.expires_in) || 7200) * 1000,
    scope: j.scope || o.scope || '',
    at: Date.now(),
  };
  writeJson(OAUTH_FILE, next);
  return next.access_token;
}

async function handler(req, res) {
  const u = new URL(req.url, 'http://127.0.0.1');
  const p = u.pathname;

  try {
    if (p === '/api/health') {
      return send(res, 200, { ok: true, app: 'schedule-deck', version: '1.0.0', time: Date.now() });
    }

    if (p === '/api/state' && req.method === 'GET') {
      const saved = readJson(STATE_FILE, null);
      return send(res, 200, { ok: true, state: saved && saved.state ? saved.state : null });
    }

    if (p === '/api/state' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body || !body.state) return send(res, 400, { ok: false, error: '缺少 state' });
      writeJson(STATE_FILE, { savedAt: Date.now(), state: body.state });
      return send(res, 200, { ok: true });
    }

    if (p === '/api/config' && req.method === 'GET') {
      const cfg = readJson(CONFIG_FILE, {});
      const o = readJson(OAUTH_FILE, null);
      return send(res, 200, {
        ok: true,
        appId: cfg.appId || '',
        hasSecret: !!cfg.appSecret,
        url: cfg.url || '',
        mode: cfg.mode || '',
        loggedIn: !!(o && o.access_token),
        user: o ? o.user : null,
        callback: redirectUri(),
      });
    }

    if (p === '/api/oauth/status' && req.method === 'GET') {
      const o = readJson(OAUTH_FILE, null);
      const cfg = readJson(CONFIG_FILE, {});
      return send(res, 200, {
        ok: true,
        loggedIn: !!(o && o.access_token),
        user: o ? o.user : null,
        expiresAt: o ? o.expires_at : null,
        scope: o ? o.scope : '',
        appId: cfg.appId || '',
        hasSecret: !!cfg.appSecret,
        callback: redirectUri(),
        callbackReady: oauthPortReady,
      });
    }

    if (p === '/api/oauth/start' && req.method === 'POST') {
      const body = await readBody(req);
      const cfg = readJson(CONFIG_FILE, {});
      const url = String(body.url || cfg.url || '').trim();
      const appId = String(body.appId || cfg.appId || '').trim();
      const appSecret = String(body.appSecret || cfg.appSecret || '').trim();
      if (!appId || !appSecret) {
        return send(res, 200, { ok: false, error: '先填 App ID 和 App Secret（应用「凭证与基础信息」里复制）' });
      }
      if (!oauthPortReady) {
        return send(res, 200, { ok: false, error: `回调端口 ${OAUTH_PORT} 被占用，请关掉占用它的程序后重启日程舱` });
      }
      const host = hostFromUrl(url) || cfg.host || 'feishu.cn';
      pendingState = crypto.randomBytes(16).toString('hex');
      writeJson(CONFIG_FILE, { ...cfg, appId, appSecret, url: url || cfg.url || '', host, updatedAt: Date.now() });
      const authUrl = feishu.buildAuthorizeUrl({
        appId, redirectUri: redirectUri(), state: pendingState, host,
      });
      return send(res, 200, { ok: true, authUrl, callback: redirectUri() });
    }

    if (p === '/api/oauth/import' && req.method === 'POST') {
      const body = await readBody(req);
      const cfg = readJson(CONFIG_FILE, {});
      const url = String(body.url || cfg.url || '').trim();
      if (!url) return send(res, 200, { ok: false, error: '请先粘贴表格链接' });
      try {
        const token = await ensureUserToken();
        const data = await feishu.load({ url, userToken: token });
        writeJson(CONFIG_FILE, { ...cfg, url, mode: 'oauth', updatedAt: Date.now() });
        return send(res, 200, { ok: true, data });
      } catch (e) {
        return send(res, 200, { ok: false, error: e.message || String(e), code: e.code || null });
      }
    }

    if (p === '/api/oauth/logout' && req.method === 'POST') {
      try { fs.unlinkSync(OAUTH_FILE); } catch { /* ignore */ }
      return send(res, 200, { ok: true });
    }

    if (p === '/api/import' && req.method === 'POST') {
      const body = await readBody(req);
      const cfg = readJson(CONFIG_FILE, {});
      const appId = String(body.appId || cfg.appId || '').trim();
      const appSecret = String(body.appSecret || cfg.appSecret || '').trim();
      const url = String(body.url || cfg.url || '').trim();

      if (!url) return send(res, 200, { ok: false, error: '请先粘贴飞书表格链接' });
      if (!appId || !appSecret) return send(res, 200, { ok: false, error: '缺少 App ID / App Secret，请展开下面的 6 步先建一个自建应用' });

      try {
        const data = await feishu.load({ url, appId, appSecret });
        writeJson(CONFIG_FILE, {
          appId, appSecret, url, mode: 'feishu', host: hostFromUrl(url), updatedAt: Date.now(),
        });
        return send(res, 200, { ok: true, data });
      } catch (e) {
        return send(res, 200, { ok: false, error: e.message || String(e), code: e.code || null });
      }
    }

    if (p === '/api/sync' && req.method === 'POST') {
      const cfg = readJson(CONFIG_FILE, {});
      // 多数据源：前端把当前这条的链接带上，避免同步到「上次导入的那张表」
      let body = {};
      try { body = await readBody(req); } catch { body = {}; }
      const url = String((body && body.url) || cfg.url || '').trim();
      if (!url) {
        return send(res, 200, { ok: false, error: '还没有保存表格链接，请先用「导入表格」连接一次' });
      }
      try {
        let data;
        if (cfg.mode === 'oauth') {
          const token = await ensureUserToken();
          data = await feishu.load({ url, userToken: token });
        } else {
          if (!cfg.appId || !cfg.appSecret) {
            return send(res, 200, { ok: false, error: '还没有保存应用凭证，请先用「导入表格」连接一次' });
          }
          data = await feishu.load({ url, appId: cfg.appId, appSecret: cfg.appSecret });
        }
        writeJson(CONFIG_FILE, { ...cfg, url: url || cfg.url || '', updatedAt: Date.now() });
        return send(res, 200, { ok: true, data });
      } catch (e) {
        const code = e.code || null;
        console.log(`[sync] 失败 code=${code} url=${url} :: ${e.message || e}`);
        return send(res, 200, { ok: false, error: e.message || String(e), code });
      }
    }

    if (p === '/api/report-error' && req.method === 'POST') {
      // 同一个账号 + 同一个错误签名 → 一个文件：最多留 5 条样本，其余只累计次数
      let body = {};
      try { body = await readBody(req); } catch { body = {}; }
      const signature = String((body && body.signature) || 'unknown').slice(0, 120);
      const message = String((body && body.message) || '').slice(0, 2000);
      const user = (String((body && body.user) || 'anonymous').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40)) || 'anonymous';
      const dir = path.join(DATA, 'errors', user);
      fs.mkdirSync(dir, { recursive: true });
      const hash = crypto.createHash('sha1').update(signature).digest('hex').slice(0, 10);
      const file = path.join(dir, hash + '.json');

      let rec = null;
      try { rec = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { rec = null; }
      const now = new Date().toISOString();
      if (!rec) rec = { signature, user, count: 0, firstAt: now, samples: [] };
      rec.count = (rec.count || 0) + 1;
      rec.lastAt = now;
      rec.samples = Array.isArray(rec.samples) ? rec.samples : [];
      if (rec.samples.length < 5) {
        rec.samples.push({ at: now, message, version: appVersion().version || 'dev' });
      }
      fs.writeFileSync(file, JSON.stringify(rec, null, 2), 'utf8');
      return send(res, 200, { ok: true, count: rec.count, samples: rec.samples.length });
    }

    if (p === '/api/suggestion' && req.method === 'POST') {
      let body = {};
      try { body = await readBody(req); } catch { body = {}; }
      const name = String((body && body.name) || '').trim() || '匿名';
      const text = String((body && body.text) || '').trim();
      if (!text) return send(res, 200, { ok: false, error: '内容为空' });
      if (text.length > 100 * 1024) return send(res, 200, { ok: false, error: '内容太长（上限 100KB）' });

      const safe = name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) || 'anonymous';
      const dir = path.join(DATA, 'suggestions', safe);
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const file = path.join(dir, stamp + '.txt');
      const when = new Date().toLocaleString('zh-CN', { hour12: false });
      // 纯文本：头三行是元信息，--- 之后是正文
      // 只记时间和版本；是谁由文件夹名（账号）体现，正文里不写
      const content = [
        '# 时间：' + when,
        '# 版本：' + (appVersion().version || 'dev'),
        '---',
        text,
        '',
      ].join('\r\n');
      fs.writeFileSync(file, content, 'utf8');
      return send(res, 200, { ok: true, path: `data/suggestions/${safe}/${stamp}.txt`, file });
    }

    if (p === '/api/update/check') {
      const cfg = readJson(path.join(DATA, 'update.json'), {});
      const manifestUrl = String(cfg.manifestUrl || DEFAULT_MANIFEST_URL).trim();
      const cur = appVersion();
      if (!manifestUrl) {
        return send(res, 200, { ok: false, error: '还没有配置更新地址', current: cur });
      }
      try {
        // 清单地址可能被 CDN 缓存，加个时间戳绕过去
        const bust = manifestUrl + (manifestUrl.includes('?') ? '&' : '?') + 't=' + Date.now();
        const latest = await fetchManifest(bust, cfg);
        if (!latest || !latest.stamp || !latest.url) throw new Error('latest.json 缺字段');
        return send(res, 200, {
          ok: true,
          current: cur,
          latest,
          via: lastGoodMirror || '直连',
          hasUpdate: String(latest.stamp) > String(cur.stamp || '0'),
        });
      } catch (e) {
        return send(res, 200, { ok: false, error: '检查更新失败：' + (e.message || e), current: cur });
      }
    }

    if (p === '/api/update/download' && req.method === 'POST') {
      let body = {};
      try { body = await readBody(req); } catch { body = {}; }
      const url = String((body && body.url) || '').trim();
      if (!/^https?:\/\//i.test(url)) return send(res, 200, { ok: false, error: '更新地址不合法' });
      if (downloading || updateState.phase === 'downloading') return send(res, 200, { ok: true, started: false, progress: updateState });
      const cfg = readJson(path.join(DATA, 'update.json'), {});
      // 立刻返回，下载在后台跑，进度用 /api/update/progress 轮询
      downloadUpdate(url, authHeaders(cfg), {
        sha256: String((body && body.sha256) || '').trim(),
        size: Number((body && body.size) || 0) || 0,
      }).catch((e) => {
        updateState.phase = 'error';
        updateState.error = e.message || String(e);
      });
      return send(res, 200, { ok: true, started: true });
    }

    if (p === '/api/update/progress') {
      return send(res, 200, { ok: true, progress: updateState });
    }

    if (p === '/api/update/apply' && req.method === 'POST') {
      let body = {};
      try { body = await readBody(req); } catch { body = {}; }
      const file = updateState.file;
      if (updateState.phase !== 'ready' || !file || !fs.existsSync(file)) {
        return send(res, 200, { ok: false, error: '还没有下载好更新包' });
      }
      const got = sha256File(file);
      const want = String((body && body.sha256) || '').toLowerCase();
      if (want && got !== want) {
        updateState.phase = 'error';
        updateState.error = 'sha256 不匹配';
        return send(res, 200, { ok: false, error: '下载的文件校验不通过（sha256 不匹配）' });
      }
      // 通知启动器：它负责退出、替换、重启
      const dir = path.join(DATA, 'update');
      fs.mkdirSync(dir, { recursive: true });
      writeJson(path.join(dir, 'apply.json'), {
        path: file,
        sha256: got,
        stamp: String((body && body.stamp) || ''),
        at: Date.now(),
      });
      return send(res, 200, { ok: true, sha256: got });
    }

    if (p === '/api/update-config') {
      // 自动更新配置：前端改，启动器读。token 只留在磁盘，不回传给页面
      const UPDATE_FILE = path.join(DATA, 'update.json');
      if (req.method === 'GET') {
        const cfg = readJson(UPDATE_FILE, {});
        return send(res, 200, {
          ok: true,
          config: { manifestUrl: cfg.manifestUrl || '', auto: cfg.auto !== false, hasToken: !!cfg.token },
        });
      }
      let body = {};
      try { body = await readBody(req); } catch { body = {}; }
      const cur = readJson(UPDATE_FILE, {});
      const next = {
        ...cur,
        manifestUrl: String(body.manifestUrl != null ? body.manifestUrl : cur.manifestUrl || DEFAULT_MANIFEST_URL).trim(),
        auto: body.auto != null ? !!body.auto : cur.auto !== false,
        updatedAt: Date.now(),
      };
      // token 只在显式传了才改（空字符串 = 清除）
      if (body.token != null) next.token = String(body.token).trim();
      writeJson(UPDATE_FILE, next);
      return send(res, 200, { ok: true, config: { manifestUrl: next.manifestUrl, auto: next.auto, hasToken: !!next.token } });
    }

    if (p === '/api/open-browser' && req.method === 'POST') {
      // 用系统默认浏览器打开当前页面（--app 窗口里点这个才有意义）
      let body = {};
      try { body = await readBody(req); } catch { body = {}; }
      const target = String((body && body.url) || '').trim();
      const url = /^https?:\/\/127\.0\.0\.1[:/]/.test(target) ? target : `http://127.0.0.1:${server.address().port}/`;
      try {
        const { execFile } = require('child_process');
        execFile('cmd', ['/c', 'start', '', url], { windowsHide: true }, () => {});
        return send(res, 200, { ok: true, url });
      } catch (e) {
        return send(res, 200, { ok: false, error: e.message || String(e) });
      }
    }

    if (p === '/api/shutdown' && req.method === 'POST') {
      send(res, 200, { ok: true });
      setTimeout(() => process.exit(0), 120);
      return undefined;
    }

    if (p.startsWith('/api/')) {
      return send(res, 404, { ok: false, error: '未知接口' });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405); res.end('Method not allowed'); return undefined;
    }
    return serveStatic(req, res, p);
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message || '服务器错误' });
  }
}

function listen(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  ensureDefaultApp();
  const wanted = Number(argOf('port', 0)) || 0;
  let server = null;

  if (wanted) {
    try { server = await listen(wanted); } catch { server = null; }
  }
  if (!server) {
    for (const p of [17890, 17891, 17892, 17893, 17894, 17910, 17920]) {
      try { server = await listen(p); break; } catch { /* try next */ }
    }
  }
  if (!server) server = await listen(0);

  const port = server.address().port;
  fs.writeFileSync(path.join(DATA, 'port.txt'), String(port), 'utf8');
  console.log(`[schedule-deck] ready http://127.0.0.1:${port}`);
  await startOAuthServer();
  console.log(`[schedule-deck] data dir ${DATA}`);

  if (argv.includes('--open')) {
    const { exec } = require('child_process');
    exec(`start "" "http://127.0.0.1:${port}"`, { shell: 'cmd.exe' }, () => {});
  }

  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}

main().catch((e) => {
  console.error('[schedule-deck] failed:', e);
  process.exit(1);
});
