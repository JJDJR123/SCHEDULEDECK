'use strict';
/* 飞书表格 / 多维表格读取 —— 只用 tenant_access_token，官方开放接口 */

const TIMEOUT = 20000;

class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function endpointOf(host) {
  const lark = /(^|\.)larksuite\.com$/i.test(host || '');
  return lark
    ? { open: 'https://open.larksuite.com', accounts: 'https://accounts.larksuite.com' }
    : { open: 'https://open.feishu.cn', accounts: 'https://accounts.feishu.cn' };
}

function friendly(code, msg) {
  const map = {
    10003: 'App ID / App Secret 不正确（或复制时带了空格），请到开放平台「凭证与基础信息」重新复制',
    10012: 'App ID 不存在，请确认复制的是自建应用的 App ID',
    10014: 'App Secret 不正确，请在开放平台重置后重新复制',
    131006: '没有权限：请把应用加为这篇文档 / 知识库的协作者（文档右上角 ··· → 添加文档应用）',
    91403: '没有权限：需要在文档「···」→「添加文档应用」里把应用加为可阅读',
    99991672: '应用缺少权限：请在开放平台「权限管理」里添加 sheets:spreadsheet:readonly、bitable:app:readonly、wiki:wiki:readonly',
    99991663: 'access token 无效或过期，请检查 App ID / Secret',
    1310214: '表格 token 不正确，请重新复制表格链接',
    1254003: '多维表格 app_token 不正确',
    1254041: '多维表格 table_id 不正确',
    1254302: '多维表格开启了高级权限，请在高级权限里给应用「可管理」',
    99991400: '请求太频繁，请稍后再试',
    1254290: '请求太频繁，请稍后再试',
    20001: '授权参数缺失，请重新发起登录',
    20002: 'App Secret 不正确，请检查「凭证与基础信息」',
    20003: '授权码无效（只能用一次），请重新发起登录',
    20004: '授权码已过期（5 分钟），请重新发起登录',
    20009: '这个应用还没有安装到你的租户，请先发布应用',
    20010: '你没有该应用的使用权限，请检查应用「可用范围」里是否包含你自己',
    20024: '授权码与 App ID 不匹配，请勿混用不同应用',
    20048: '应用不存在，请检查 App ID',
    20068: '请求了用户未授权的权限，请检查应用的权限管理',
    20071: '重定向地址不一致：请在开放平台「安全设置 → 重定向 URL」里添加 http://127.0.0.1:17899/callback',
  };
  if (map[code]) return map[code];
  return (msg || '飞书接口返回错误') + (code ? `（错误码 ${code}）` : '');
}

function normalizeError(e) {
  if (e instanceof ApiError) return e;
  if (e && e.name === 'AbortError') return new ApiError('连接飞书超时，请检查网络或代理', null, 0);
  const code = e && (e.cause && e.cause.code);
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return new ApiError('无法解析 open.feishu.cn，请检查网络', null, 0);
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET') return new ApiError('无法连接飞书服务器，请检查网络或代理', null, 0);
  if (e && e.name === 'TypeError' && /fetch failed/i.test(e.message)) {
    return new ApiError('无法连接飞书服务器，请检查网络或代理', null, 0);
  }
  return e instanceof Error ? e : new ApiError(String(e), null, 0);
}

async function request(url, { method = 'GET', token, body, form } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  let payload;
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(form).toString();
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json; charset=utf-8';
    payload = JSON.stringify(body);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  let res;
  try {
    res = await fetch(url, { method, headers, body: payload, signal: ctrl.signal });
  } catch (e) {
    throw normalizeError(e);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }

  if (!res.ok) {
    const msg = (json && (json.msg || json.error_description || json.error)) || `HTTP ${res.status}`;
    const code = json && (json.code || json.error);
    throw new ApiError(friendly(code, msg), code, res.status);
  }
  if (json && typeof json.code === 'number' && json.code !== 0) {
    throw new ApiError(friendly(json.code, json.msg), json.code, res.status);
  }
  return json || {};
}

/* ------------------------------------------------------------------ token */

const tokenCache = new Map();

async function getToken(appId, appSecret, host) {
  const key = appId + '|' + host;
  const cached = tokenCache.get(key);
  if (cached && cached.exp > Date.now() + 60 * 1000) return cached.token;

  const ep = endpointOf(host);
  let token = '';
  let expires = 7200;

  try {
    const j = await request(ep.accounts + '/oauth/v3/token', {
      method: 'POST',
      form: { grant_type: 'client_credentials', client_id: appId, client_secret: appSecret },
    });
    token = j.access_token || j.tenant_access_token;
    expires = Number(j.expires_in) || 7200;
  } catch (e) {
    if (e.status && e.status < 500) {
      // 新接口不可用时退回旧接口
      const j = await request(ep.open + '/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        body: { app_id: appId, app_secret: appSecret },
      });
      token = j.tenant_access_token;
      expires = Number(j.expire) || 7200;
    } else {
      throw e;
    }
  }

  if (!token) throw new ApiError('没有拿到 access_token，请检查 App ID / App Secret', null, 0);
  tokenCache.set(key, { token, exp: Date.now() + expires * 1000 });
  return token;
}

/* ------------------------------------------------------------------ 链接 */

function parseUrl(input) {
  let u;
  try { u = new URL(input); } catch { throw new ApiError('链接格式不对，请粘贴完整的飞书链接', null, 0); }
  if (!/(^|\.)(feishu\.cn|larksuite\.com)$/i.test(u.hostname)) {
    throw new ApiError('这不是飞书链接（域名应为 feishu.cn 或 larksuite.com）', null, 0);
  }
  const parts = u.pathname.split('/').filter(Boolean);
  const kind = (parts[0] || '').toLowerCase();
  const token = parts[1] || '';
  if (!token) throw new ApiError('链接里没有找到文档 token', null, 0);
  if (!['wiki', 'sheets', 'base', 'docx', 'docs', 'mindnotes'].includes(kind)) {
    throw new ApiError('暂不支持这种飞书文档类型，请使用表格 / 多维表格 / 知识库里的表格', null, 0);
  }
  return {
    host: u.hostname,
    kind,
    token,
    sheetId: u.searchParams.get('sheet') || u.searchParams.get('sheet_id') || '',
    tableId: u.searchParams.get('table') || '',
    viewId: u.searchParams.get('view') || '',
    origin: u.origin,
  };
}

function colLetter(n) {
  let s = '';
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s || 'A';
}

function cell(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    return v.map((x) => cell(x)).filter(Boolean).join(', ');
  }
  if (typeof v === 'object') {
    if (v.text != null) return String(v.text);
    if (v.link != null) return String(v.link);
    if (v.name != null) return String(v.name);
  }
  return String(v);
}

function pad2(n) { return String(n).padStart(2, '0'); }
function fmtDateTime(ms) {
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '';
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  if (d.getHours() === 0 && d.getMinutes() === 0) return date;
  return `${date} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/* ------------------------------------------------------------------ 清洗 */

function looksLikeDate(v) {
  const s = String(v || '').trim();
  if (!s) return false;
  return /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(s)
    || /^\d{1,2}[-/.]\d{1,2}$/.test(s)
    || /^\d{1,2}月\d{1,2}日?$/.test(s)
    || /^\d{4}年\d{1,2}月\d{1,2}日/.test(s)
    || /^\d{10,13}$/.test(s);
}

function cleanMatrix(values) {
  let rows = (values || []).map((r) => (Array.isArray(r) ? r.map(cell) : []));
  let width = 0;
  rows.forEach((r) => {
    for (let i = r.length - 1; i >= 0; i--) {
      if (String(r[i]).trim() !== '') { width = Math.max(width, i + 1); break; }
    }
  });
  rows = rows.map((r) => r.slice(0, width));
  rows = rows.filter((r) => r.some((v) => String(v).trim() !== ''));
  return rows;
}

function detectHeaderRow(rows) {
  const limit = Math.min(5, rows.length);
  const HINTS = /负责人|开始|完成|时间|周期|验收|上线|日期|内容|期数|状态|备注|预计|需求|原画|模型|配置|音效|立绘/;
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < limit; i++) {
    const cells = rows[i].filter((c) => String(c).trim() !== '');
    if (!cells.length) continue;
    let score = cells.length * 2;
    const hints = cells.filter((c) => HINTS.test(String(c))).length;
    score += hints * 12;
    if (hints >= 3) score += 20;
    if (cells.some(looksLikeDate)) score -= 6;
    if (cells.some((c) => String(c).length > 40)) score -= 4;
    if (cells.length < 2) score -= 3;
    if (i === 0) score += 1;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

function finalize(rows, title) {
  if (!rows.length) throw new ApiError('表格里没有读到内容（可能是空表或权限不足）', null, 0);
  const headerIdx = detectHeaderRow(rows);
  const headerRow = rows[headerIdx] || [];
  const dateHits = headerRow.filter((v) => looksLikeDate(v)).length;

  // 第一行就有两个以上日期 → 这张表没有表头，直接当数据
  if (dateHits >= 2) {
    const width = Math.max(...rows.map((r) => r.length));
    const headers = Array.from({ length: width }, (_, i) => `列 ${i + 1}`);
    return { headers, rows, headerIndex: -1, title };
  }

  const headers = headerRow.map((v, i) => String(v).trim() || `列 ${i + 1}`);
  const dataRows = rows.slice(headerIdx + 1).filter((r) => r.some((v) => String(v).trim() !== ''));
  return { headers, rows: dataRows, headerIndex: headerIdx, title };
}

/* ------------------------------------------------------------------ 读取 */

async function readSheet(host, token, spreadsheetToken, sheetId, fallbackTitle) {
  const ep = endpointOf(host);
  const meta = await request(
    `${ep.open}/open-apis/sheets/v3/spreadsheets/${encodeURIComponent(spreadsheetToken)}/sheets/query`,
    { token },
  );
  const sheets = (meta.data && meta.data.sheets) || [];
  if (!sheets.length) throw new ApiError('这个表格里没有工作表', null, 0);
  const target = sheets.find((s) => s.sheet_id === sheetId)
    || sheets.find((s) => !s.hidden)
    || sheets[0];

  const grid = target.grid_properties || {};
  const rowCount = Number(grid.row_count) || 200;
  const colCount = Number(grid.column_count) || 20;
  const maxRows = Math.min(Math.max(rowCount + 3, 10), 5000);
  const range = `${target.sheet_id}!A1:${colLetter(Math.max(colCount, 1))}${maxRows}`;

  const url = `${ep.open}/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(spreadsheetToken)}/values/${range}`
    + '?valueRenderOption=FormattedValue&dateTimeRenderOption=FormattedString';

  const res = await request(url, { token });
  const values = (res.data && res.data.valueRange && res.data.valueRange.values)
    || (res.data && res.data.values) || [];
  const rows = cleanMatrix(values);
  const out = finalize(rows, target.title || fallbackTitle || '飞书表格');
  return {
    headers: out.headers,
    rows: out.rows,
    source: {
      kind: 'feishu',
      title: out.title,
      url: '',
      spreadsheetToken,
      sheetId: target.sheet_id,
      sheetTitle: target.title || '',
      appToken: '',
      tableId: '',
      mode: 'feishu',
      sheets: sheets.map((s) => ({ id: s.sheet_id, title: s.title, hidden: !!s.hidden })),
    },
  };
}

async function readBitable(host, token, appToken, tableId, fallbackTitle) {
  const ep = endpointOf(host);
  const tRes = await request(
    `${ep.open}/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables?page_size=100`,
    { token },
  );
  const tables = (tRes.data && tRes.data.items) || [];
  if (!tables.length) throw new ApiError('这个多维表格里没有数据表', null, 0);
  const table = tables.find((t) => t.table_id === tableId) || tables[0];

  const fRes = await request(
    `${ep.open}/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${table.table_id}/fields?page_size=100`,
    { token },
  );
  const fields = (fRes.data && fRes.data.items) || [];
  const names = fields.map((f) => f.field_name);
  const typeOf = {};
  fields.forEach((f) => { typeOf[f.field_name] = f.type; });
  if (!names.length) throw new ApiError('数据表没有字段', null, 0);

  const rows = [];
  let pageToken = '';
  let guard = 0;
  do {
    const body = { automatic_fields: false };
    if (pageToken) body.page_token = pageToken;
    const j = await request(
      `${ep.open}/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${table.table_id}/records/search?page_size=500`,
      { method: 'POST', token, body },
    );
    const items = (j.data && j.data.items) || [];
    items.forEach((rec) => {
      const fieldsObj = rec.fields || {};
      rows.push(names.map((n) => {
        const v = fieldsObj[n];
        if (typeOf[n] === 5 && typeof v === 'number') return fmtDateTime(v);
        return cell(v);
      }));
    });
    pageToken = j.data && j.data.has_more ? j.data.page_token : '';
    guard++;
  } while (pageToken && guard < 20);

  return {
    headers: names,
    rows,
    source: {
      kind: 'feishu',
      title: table.name || fallbackTitle || '多维表格',
      url: '',
      spreadsheetToken: '',
      sheetId: '',
      appToken,
      tableId: table.table_id,
      mode: 'feishu',
      tables: tables.map((t) => ({ id: t.table_id, name: t.name })),
    },
  };
}

/* ------------------------------------------------------------------ 入口 */

async function load({ url, appId, appSecret, userToken }) {
  if (!url) throw new ApiError('请先粘贴飞书表格链接', null, 0);
  if (!userToken && (!appId || !appSecret)) throw new ApiError('缺少 App ID / App Secret', null, 0);

  const parsed = parseUrl(url);
  const ep = endpointOf(parsed.host);
  const token = userToken || await getToken(appId, appSecret, parsed.host);

  let kind = parsed.kind;
  let tokenId = parsed.token;
  let sheetId = parsed.sheetId;
  let tableId = parsed.tableId;
  let title = '飞书表格';
  let origin = parsed.origin;

  if (kind === 'wiki') {
    const j = await request(
      `${ep.open}/open-apis/wiki/v2/spaces/get_node?token=${encodeURIComponent(parsed.token)}&obj_type=wiki`,
      { token },
    );
    const node = j.data && j.data.node;
    if (!node || !node.obj_token) throw new ApiError('没有找到这个知识库节点，请确认链接可访问', null, 0);
    tokenId = node.obj_token;
    title = node.title || title;
    origin = node.obj_url ? String(node.obj_url).replace(/\/[^/]*$/, '') : parsed.origin;
    if (node.obj_type === 'sheet') kind = 'sheets';
    else if (node.obj_type === 'bitable') kind = 'base';
    else throw new ApiError(`这个知识库节点是「${node.obj_type}」，不是表格，读不了内容`, null, 0);
  }

  let result;
  if (kind === 'sheets') {
    result = await readSheet(parsed.host, token, tokenId, sheetId, title);
  } else if (kind === 'base') {
    result = await readBitable(parsed.host, token, tokenId, tableId, title);
  } else {
    throw new ApiError('暂不支持这种飞书文档类型，请使用电子表格或多维表格链接', null, 0);
  }

  result.source.url = url;
  result.source.host = parsed.host;
  result.source.kind = 'feishu';
  result.source.mode = userToken ? 'oauth' : 'feishu';
  if (!result.source.title) result.source.title = title;
  return result;
}

/* ------------------------------------------------------------------ 用户授权 */

function oauthEndpoints(host) {
  const lark = /(^|\.)larksuite\.com$/i.test(host || '');
  return lark
    ? {
      authorize: 'https://accounts.larksuite.com/open-apis/authen/v1/authorize',
      token: 'https://accounts.larksuite.com/oauth/v3/token',
      tokenV2: 'https://open.larksuite.com/open-apis/authen/v2/oauth/token',
      userinfo: 'https://open.larksuite.com/open-apis/authen/v1/user_info',
    }
    : {
      authorize: 'https://accounts.feishu.cn/open-apis/authen/v1/authorize',
      token: 'https://accounts.feishu.cn/oauth/v3/token',
      tokenV2: 'https://open.feishu.cn/open-apis/authen/v2/oauth/token',
      userinfo: 'https://open.feishu.cn/open-apis/authen/v1/user_info',
    };
}

const OAUTH_SCOPES = [
  'offline_access',
  'sheets:spreadsheet:readonly',
  'bitable:app:readonly',
  'wiki:wiki:readonly',
].join(' ');

function buildAuthorizeUrl({ appId, redirectUri, state, host }) {
  const ep = oauthEndpoints(host);
  const q = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
    scope: OAUTH_SCOPES,
  });
  return ep.authorize + '?' + q.toString();
}

async function tokenRequest(host, body) {
  const ep = oauthEndpoints(host);
  const parse = (j) => (j && j.data && j.data.access_token ? j.data : j);
  try {
    return parse(await request(ep.token, { method: 'POST', body }));
  } catch (e) {
    // v3 未开通或返回 404 时退回 v2（请求参数一致）
    if (e.status === 404 || e.status === 405) {
      return parse(await request(ep.tokenV2, { method: 'POST', body }));
    }
    throw e;
  }
}

async function exchangeCode({ appId, appSecret, code, redirectUri, host }) {
  const j = await tokenRequest(host, {
    grant_type: 'authorization_code',
    client_id: appId,
    client_secret: appSecret,
    code,
    redirect_uri: redirectUri,
  });
  if (!j || !j.access_token) throw new ApiError('换取 user_access_token 失败', null, 0);
  return j;
}

async function refreshUserToken({ appId, appSecret, refreshToken, host }) {
  const j = await tokenRequest(host, {
    grant_type: 'refresh_token',
    client_id: appId,
    client_secret: appSecret,
    refresh_token: refreshToken,
  });
  if (!j || !j.access_token) throw new ApiError('刷新登录凭证失败，请重新扫码登录', null, 0);
  return j;
}

async function getUserInfo(token, host) {
  const ep = oauthEndpoints(host);
  const j = await request(ep.userinfo, { token });
  return j.data || j;
}

module.exports = {
  load, parseUrl, ApiError,
  OAUTH_SCOPES, buildAuthorizeUrl, exchangeCode, refreshUserToken, getUserInfo,
};
