/* 日程舱 — DIY 规则引擎 */
import { state } from './store.js';
import { DAY, HOUR, MIN, sameDay, startOfDay } from './util.js';

export const FIELDS = [
  { key: 'dueIn', label: '剩余时间', type: 'duration' },
  { key: 'due', label: '截止日期', type: 'date' },
  { key: 'status', label: '状态', type: 'text' },
  { key: 'tags', label: '标签', type: 'text' },
  { key: 'priority', label: '优先级', type: 'text' },
  { key: 'title', label: '标题', type: 'text' },
  { key: 'done', label: '是否完成', type: 'bool' },
  { key: 'owner', label: '负责人', type: 'text' },
  { key: 'note', label: '备注', type: 'text' },
  { key: 'col', label: '任意列…', type: 'column' },
];

export const OPS = {
  lt: { label: '小于', types: ['duration'] },
  lte: { label: '小于等于', types: ['duration'] },
  gt: { label: '大于', types: ['duration'] },
  gte: { label: '大于等于', types: ['duration'] },
  today: { label: '是今天', types: ['date'] },
  tomorrow: { label: '是明天', types: ['date'] },
  thisweek: { label: '在本周内', types: ['date'] },
  within: { label: '在未来 N 天内', types: ['date'] },
  before: { label: '早于', types: ['date'] },
  after: { label: '晚于', types: ['date'] },
  contains: { label: '包含', types: ['text', 'column'] },
  not_contains: { label: '不包含', types: ['text', 'column'] },
  eq: { label: '等于', types: ['text', 'column', 'bool'] },
  neq: { label: '不等于', types: ['text', 'column', 'bool'] },
  empty: { label: '为空', types: ['text', 'column'] },
  not_empty: { label: '不为空', types: ['text', 'column'] },
};

export const PALETTE = {
  bg: ['#FEF1F0', '#FFF6ED', '#FFFCEB', '#F5F8FF', '#F0FDF4', '#F4F5F7', '#FAF5FF', '#FDF2F8', '#FFFFFF'],
  fg: ['#B42318', '#B54708', '#A15C07', '#175CD3', '#067647', '#475467', '#6941C6', '#C11574', '#151922'],
  bar: ['#F04438', '#F79009', '#FDB022', '#3B82F6', '#12B76A', '#98A2B3', '#9E77ED', '#EE46BC', '#D0D5DD'],
};

export function fieldDef(key) {
  return FIELDS.find((f) => f.key === key) || FIELDS[0];
}

export function opsFor(field) {
  const t = fieldDef(field).type;
  return Object.entries(OPS).filter(([, v]) => v.types.includes(t)).map(([k, v]) => ({ key: k, label: v.label }));
}

export function durationMs(value, unit) {
  const n = Number(value) || 0;
  if (unit === 'day') return n * DAY;
  if (unit === 'hour') return n * HOUR;
  return n * MIN;
}

function textOf(rec, field, cond) {
  switch (field) {
    case 'status': return String(rec.status || '');
    case 'tags': return rec.tags.join(' ');
    case 'priority': return String(rec.priority || '');
    case 'title': return String(rec.title || '');
    case 'owner': return String(rec.owner || '');
    case 'note': return String(rec.note || '');
    case 'col': return String((rec.raw || [])[cond.col] ?? '');
    default: return '';
  }
}

function matchCmp(op, a, b) {
  switch (op) {
    case 'lt': return a < b;
    case 'lte': return a <= b;
    case 'gt': return a > b;
    case 'gte': return a >= b;
    case 'eq': return a === b;
    case 'neq': return a !== b;
    default: return false;
  }
}

export function condMatch(cond, rec, now = Date.now()) {
  const c = cond || {};
  if (c.field === 'dueIn') {
    if (rec.due == null) return false;
    const v = durationMs(c.value, c.unit);
    return matchCmp(c.op, rec.due - now, v);
  }
  if (c.field === 'due') {
    if (rec.due == null) return false;
    switch (c.op) {
      case 'today': return sameDay(rec.due, now);
      case 'tomorrow': return sameDay(rec.due, now + DAY);
      case 'thisweek': {
        const a = startOfDay(now) - ((new Date(now).getDay() + 6) % 7) * DAY;
        return rec.due >= a && rec.due < a + 7 * DAY;
      }
      case 'within': return rec.due >= now && rec.due <= now + durationMs(c.value || 7, 'day');
      case 'before': return rec.due < new Date(c.date || c.value || 0).getTime();
      case 'after': return rec.due > new Date(c.date || c.value || 0).getTime();
      default: return false;
    }
  }
  if (c.field === 'done') {
    const want = c.value === 'true' || c.value === true;
    return c.op === 'neq' ? rec.done !== want : rec.done === want;
  }
  const text = textOf(rec, c.field, c);
  const val = String(c.value ?? '');
  switch (c.op) {
    case 'contains': return val === '' ? true : text.toLowerCase().includes(val.toLowerCase());
    case 'not_contains': return val === '' ? true : !text.toLowerCase().includes(val.toLowerCase());
    case 'eq': return text.trim().toLowerCase() === val.trim().toLowerCase();
    case 'neq': return text.trim().toLowerCase() !== val.trim().toLowerCase();
    case 'empty': return text.trim() === '';
    case 'not_empty': return text.trim() !== '';
    default: return false;
  }
}

export function ruleMatches(rule, rec, now = Date.now()) {
  if (!rule || !rule.enabled) return false;
  const conds = (rule.conds || []).filter(Boolean);
  if (!conds.length) return false;
  const results = conds.map((c) => condMatch(c, rec, now));
  return rule.logic === 'any' ? results.some(Boolean) : results.every(Boolean);
}

/** 返回第一个命中的规则（规则按顺序从上到下，优先级从高到低） */
export function evalRules(rec, now = Date.now()) {
  for (const rule of state.rules || []) {
    if (ruleMatches(rule, rec, now)) return rule;
  }
  return null;
}

export function resolveStyle(rule, rec, now = Date.now()) {
  if (!rule) return null;
  const st = rule.style || {};
  const diff = rec.due != null ? rec.due - now : 0;
  const span = (ms) => {
    if (ms < HOUR) return `${Math.max(1, Math.round(ms / MIN))} 分钟`;
    if (ms < DAY) return `${Math.floor(ms / HOUR)} 小时`;
    return `${Math.floor(ms / DAY)} 天`;
  };
  const fill = (s) => String(s || '')
    .replace(/\{days\}/g, String(Math.max(0, Math.ceil(diff / DAY))))
    .replace(/\{hours\}/g, String(Math.max(0, Math.ceil(diff / HOUR))))
    .replace(/\{overdueDays\}/g, String(Math.max(1, Math.floor(-diff / DAY))))
    .replace(/\{left\}/g, diff > 0 && rec.due != null ? '剩 ' + span(diff) : '')
    .replace(/\{overdue\}/g, diff < 0 && rec.due != null ? '逾期 ' + span(-diff) : '')
    .replace(/\{status\}/g, rec.status || '')
    .replace(/\{tags\}/g, rec.tags.join(' '));
  return {
    bg: st.bg || '#FFFFFF',
    fg: st.fg || '#151922',
    bar: st.bar || 'transparent',
    badge: fill(st.badge),
    badgeBg: st.badgeBg || st.bg || '#F2F4F7',
    badgeFg: st.badgeFg || st.fg || '#475467',
    strike: !!st.strike,
  };
}

export function styleVars(st) {
  if (!st) return '';
  return [
    `--r-bg:${st.bg}`,
    `--r-fg:${st.fg}`,
    `--r-bar:${st.bar}`,
    `--r-badge-bg:${st.badgeBg}`,
    `--r-badge-fg:${st.badgeFg}`,
    `--r-due:${st.fg}`,
  ].join(';');
}

export function describeCond(cond, colHeaders = []) {
  if (!cond) return '';
  const f = fieldDef(cond.field);
  const op = OPS[cond.op]?.label || '';
  if (cond.field === 'dueIn') {
    const unit = { min: '分钟', hour: '小时', day: '天' }[cond.unit] || '小时';
    const n = Number(cond.value) || 0;
    if (cond.op === 'lt' && n === 0) return '已经逾期';
    const opTxt = { lt: '<', lte: '≤', gt: '>', gte: '≥' }[cond.op] || op;
    return `剩余时间 ${opTxt} ${n} ${unit}`;
  }
  if (cond.field === 'due') {
    if (cond.op === 'within') return `未来 ${cond.value} 天内到期`;
    if (cond.op === 'before' || cond.op === 'after') return `截止日期 ${op} ${cond.date || ''}`;
    return `截止日期 ${op}`;
  }
  if (cond.field === 'done') return cond.value === 'true' ? '已标记完成' : '未完成';
  if (cond.field === 'col') {
    const name = colHeaders[cond.col] || `第 ${Number(cond.col) + 1} 列`;
    return `「${name}」${op}${cond.value ? ' ' + cond.value : ''}`;
  }
  return `${f.label} ${op}${cond.value ? ' ' + cond.value : ''}`;
}

export function describeRule(rule, colHeaders = []) {
  if (!rule) return '';
  const parts = (rule.conds || []).map((c) => describeCond(c, colHeaders));
  return parts.join(rule.logic === 'any' ? ' 或 ' : ' 且 ') || '未设置条件';
}

export function newRule() {
  return {
    id: 'r_' + Math.random().toString(36).slice(2, 8),
    name: '新规则',
    enabled: true,
    logic: 'all',
    conds: [{ field: 'dueIn', op: 'lte', value: 48, unit: 'hour' }],
    style: {
      bg: '#FEF1F0', fg: '#B42318', bar: '#F04438',
      badge: '紧急', badgeBg: '#FEE4E2', badgeFg: '#B42318', strike: false,
    },
  };
}

export function sampleRecord() {
  return {
    id: 'sample',
    title: '完成项目结项材料',
    due: Date.now() + 20 * HOUR,
    status: '进行中',
    tags: ['工作', '汇报'],
    priority: '高',
    owner: '我',
    note: '预览效果',
    done: false,
    raw: ['完成项目结项材料', '进行中', '工作', '高'],
  };
}
