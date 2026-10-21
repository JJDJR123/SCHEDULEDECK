/* 日程舱 — 通用工具 */
export const MIN = 60000;
export const HOUR = 3600000;
export const DAY = 86400000;

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export const pad = (n) => String(n).padStart(2, '0');

export function uid(prefix = 'id') {
  return prefix + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

export function hash(str) {
  let h = 5381;
  const s = String(str);
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

export function debounce(fn, ms = 300) {
  let t = 0;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function startOfDay(ts = Date.now()) {
  const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime();
}
export function addDays(ts, n) {
  const d = new Date(ts); d.setDate(d.getDate() + n); return d.getTime();
}
export function sameDay(a, b) {
  if (a == null || b == null) return false;
  const x = new Date(a), y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}
export function startOfWeek(ts, firstDay = 1) {
  const d = new Date(startOfDay(ts));
  const wd = d.getDay(); // 0 Sun
  const diff = (wd - firstDay + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d.getTime();
}

const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];
export function weekdayCN(ts) { return '周' + WEEK_CN[new Date(ts).getDay()]; }

/* ---------------------------------------------------------------- 日期解析 */

function fromSerial(n) {
  if (!isFinite(n) || n <= 0) return null;
  const days = Math.floor(n);
  const frac = n - days;
  const base = new Date(1899, 11, 30, 0, 0, 0, 0);
  base.setDate(base.getDate() + days);
  return base.getTime() + Math.round(frac * DAY);
}

/**
 * 兼容飞书表格（Excel 序列号 / 格式化字符串）、Bitable（毫秒时间戳）、
 * 以及中文人写的「10月25日 18:00」「明天」「周五」等。
 */
export function parseDate(v, now = Date.now()) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.getTime();

  if (typeof v === 'number') {
    if (v > 1e12) return Math.round(v);
    if (v > 1e9) return Math.round(v * 1000);
    if (v > 20000 && v < 80000) return fromSerial(v);
    return null;
  }

  let s = String(v).trim();
  if (!s) return null;

  if (/^\d{13}$/.test(s)) return +s;
  if (/^\d{10}$/.test(s)) return +s * 1000;
  if (/^\d{4,5}(\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    if (n > 20000 && n < 80000) return fromSerial(n);
  }

  // 去掉括号备注、前后缀
  s = s.replace(/[（(][^）)]*[）)]/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^(截止|截止时间|到期|期限|deadline|due)[:：\s]*/i, '').trim();
  if (!s) return null;

  const nowD = new Date(now);
  const relMap = { 今天: 0, 今日: 0, 明天: 1, 明日: 1, 后天: 2, 大后天: 3 };
  const relKey = Object.keys(relMap).find((k) => s.startsWith(k));
  if (relKey) {
    const base = addDays(startOfDay(now), relMap[relKey]);
    const tm = s.match(/(\d{1,2})[:：](\d{2})/);
    return tm ? base + (+tm[1]) * HOUR + (+tm[2]) * MIN : base;
  }

  let m = s.match(/^(\d{4})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})\s*日?\s*(?:[T ]?\s*(\d{1,2})[:：](\d{2})(?:[:：](\d{2}))?)?/);
  if (m) {
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
  }

  m = s.match(/^(\d{1,2})\s*[月\-/.]\s*(\d{1,2})\s*日?\s*(?:[T ]?\s*(\d{1,2})[:：](\d{2})(?:[:：](\d{2}))?)?/);
  if (m) {
    let ts = new Date(nowD.getFullYear(), +m[1] - 1, +m[2], +(m[3] || 0), +(m[4] || 0), +(m[5] || 0)).getTime();
    if (ts < startOfDay(now) - 180 * DAY) ts = new Date(nowD.getFullYear() + 1, +m[1] - 1, +m[2], +(m[3] || 0), +(m[4] || 0)).getTime();
    return ts;
  }

  // 只写了时间 18:00 → 今天
  m = s.match(/^(\d{1,2})[:：](\d{2})$/);
  if (m) return startOfDay(now) + (+m[1]) * HOUR + (+m[2]) * MIN;

  // 周几
  m = s.match(/^(?:周|星期)([一二三四五六日天])$/);
  if (m) {
    const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };
    const target = map[m[1]];
    let d = new Date(startOfDay(now));
    for (let i = 0; i < 8; i++) {
      if (d.getDay() === target) { if (i === 0) break; return d.getTime(); }
      d.setDate(d.getDate() + 1);
    }
  }

  const t = new Date(s).getTime();
  return isNaN(t) ? null : t;
}

/**
 * 只有「M月D日」、没有年份时，按档期基准日补全年份。
 * 规则：落在 [基准-30天, 基准+335天) 内；更早算下一年，更晚算上一年。
 */
export function parseMonthDay(v, baseTs = Date.now()) {
  if (v == null) return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\s*[月\-/.]\s*(\d{1,2})\s*日?$/);
  if (!m) return null;
  const mo = Number(m[1]) - 1;
  const d = Number(m[2]);
  if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
  const base = new Date(baseTs);
  base.setHours(0, 0, 0, 0);
  let ts = new Date(base.getFullYear(), mo, d).getTime();
  const min = base.getTime() - 30 * DAY;
  const max = base.getTime() + 335 * DAY;
  if (ts < min) ts = new Date(base.getFullYear() + 1, mo, d).getTime();
  else if (ts > max) ts = new Date(base.getFullYear() - 1, mo, d).getTime();
  return ts;
}

/* ---------------------------------------------------------------- 日期展示 */

export function fmtDate(ts, fmt = 'YYYY-MM-DD') {
  if (ts == null) return '';
  const d = new Date(ts);
  const map = {
    YYYY: d.getFullYear(),
    MM: pad(d.getMonth() + 1),
    DD: pad(d.getDate()),
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes()),
    M: d.getMonth() + 1,
    D: d.getDate(),
  };
  return fmt.replace(/YYYY|MM|DD|HH|mm|M|D/g, (k) => map[k]);
}

export function hasTime(ts) {
  const d = new Date(ts);
  return d.getHours() !== 0 || d.getMinutes() !== 0;
}

/** 「今天 18:00」「明天」「10月25日 18:00」「2027年1月5日」 */
export function fmtDue(ts, now = Date.now()) {
  if (ts == null) return '未设截止';
  const time = hasTime(ts) ? ' ' + fmtDate(ts, 'HH:mm') : '';
  if (sameDay(ts, now)) return '今天' + time;
  if (sameDay(ts, now + DAY)) return '明天' + time;
  if (sameDay(ts, now - DAY)) return '昨天' + time;
  const d = new Date(ts);
  const y = new Date(now).getFullYear();
  if (d.getFullYear() === y) return `${d.getMonth() + 1}月${d.getDate()}日` + time;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日` + time;
}

export function fmtShort(ts, now = Date.now()) {
  if (ts == null) return '—';
  const d = new Date(ts);
  const y = new Date(now).getFullYear();
  const base = d.getFullYear() === y
    ? `${d.getMonth() + 1}/${d.getDate()}`
    : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  return hasTime(ts) ? base + ' ' + fmtDate(ts, 'HH:mm') : base;
}

/** 倒计时 → { text, tone } */
export function relTime(due, now = Date.now()) {
  if (due == null) return { text: '', tone: 'none' };
  const diff = due - now;
  const abs = Math.abs(diff);
  if (diff < 0) {
    if (abs < HOUR) return { text: `逾期 ${Math.max(1, Math.round(abs / MIN))} 分钟`, tone: 'over' };
    if (abs < DAY) return { text: `逾期 ${Math.floor(abs / HOUR)} 小时`, tone: 'over' };
    return { text: `逾期 ${Math.floor(abs / DAY)} 天`, tone: 'over' };
  }
  if (diff < HOUR) return { text: `剩 ${Math.max(1, Math.round(diff / MIN))} 分钟`, tone: 'soon' };
  if (diff < DAY) return { text: `剩 ${Math.floor(diff / HOUR)} 小时`, tone: 'soon' };
  if (diff < 7 * DAY) return { text: `剩 ${Math.floor(diff / DAY)} 天`, tone: 'ok' };
  return { text: `剩 ${Math.floor(diff / DAY)} 天`, tone: 'later' };
}

export function bucketOf(due, now = Date.now()) {
  if (due == null) return 'none';
  if (due < now) return 'overdue';
  const t1 = startOfDay(now) + DAY;
  if (due < t1) return 'today';
  if (due < t1 + DAY) return 'tomorrow';
  if (due < startOfDay(now) + 7 * DAY) return 'week';
  return 'later';
}

export const BUCKETS = {
  overdue: { label: '已逾期', color: '#F04438' },
  today: { label: '今天', color: '#F79009' },
  tomorrow: { label: '明天', color: '#12B76A' },
  week: { label: '本周内', color: '#3B82F6' },
  later: { label: '以后', color: '#98A2B3' },
  none: { label: '无截止', color: '#C4C9D4' },
  done: { label: '已完成', color: '#12B76A' },
};

/* ---------------------------------------------------------------- 文本 */

export function parseTags(v) {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : String(v).split(/[,，/、;；|｜]+/);
  return [...new Set(arr.map((x) => String(x).trim().replace(/^#/, '')).filter(Boolean))];
}

export function initials(name) {
  const s = String(name || '').trim();
  if (!s) return '?';
  return /^[a-zA-Z]/.test(s) ? s.slice(0, 1).toUpperCase() : s.slice(0, 1);
}

export function parseDelimited(text) {
  // 自动判断 TSV / CSV / 多空格
  const raw = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!raw) return { headers: [], rows: [] };
  const lines = raw.split('\n').filter((l) => l.trim() !== '');
  const tabbed = lines.filter((l) => l.includes('\t')).length;
  const commaed = lines.filter((l) => l.includes(',')).length;
  const delim = tabbed >= commaed ? '\t' : ',';
  const cells = (line) => {
    if (delim === ',') {
      const out = []; let cur = ''; let q = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (q) {
          if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
          else if (c === '"') q = false;
          else cur += c;
        } else if (c === '"') q = true;
        else if (c === ',') { out.push(cur); cur = ''; }
        else cur += c;
      }
      out.push(cur);
      return out.map((x) => x.trim());
    }
    return line.split('\t').map((x) => x.trim());
  };
  const matrix = lines.map(cells);
  const width = Math.max(...matrix.map((r) => r.length));
  const headers = matrix[0].concat(Array(Math.max(0, width - matrix[0].length)).fill(''));
  const rows = matrix.slice(1).map((r) => r.concat(Array(Math.max(0, headers.length - r.length)).fill('')));
  return { headers, rows };
}

export function download(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
    return true;
  }
}
