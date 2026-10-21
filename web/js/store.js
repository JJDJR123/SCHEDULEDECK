/* 日程舱 — 状态、数据源、持久化 */
import {
  parseDate, parseTags, parseMonthDay, hash, startOfDay, startOfWeek, addDays, DAY, sameDay, fmtDate,
} from './util.js';

const LS_KEY = 'scheduledeck.v1';

/**
 * 侧栏「档期 / 角色」标签的交互方式。
 * false = 选哪个看哪个（单选，再点一次取消）；true = 多选叠加。
 * 多选代码一直保留着，想调回去把这里改成 true 就行。
 */
export const TAG_MULTI_SELECT = false;

const ROLES = ['title', 'due', 'status', 'tags', 'priority', 'owner', 'note', 'id'];
const ROLE_KEYWORDS = {
  title: ['任务', '事项', '内容', '名称', '标题', '待办', '工作', 'task', 'title', 'item', 'todo', 'name'],
  due: ['截止', 'ddl', 'due', 'deadline', '到期', '结束时间', '完成时间', '日期', '时间', 'date', 'end'],
  status: ['状态', '进度', '完成情况', '阶段', 'status', 'state', 'progress'],
  tags: ['标签', '分类', '类型', '项目', '所属', 'tag', 'label', 'category', 'group'],
  priority: ['优先级', '优先', '重要', '紧急', 'priority', 'level', 'p'],
  owner: ['负责人', '执行人', '处理人', '人员', 'owner', 'assignee', 'user', '负责'],
  note: ['备注', '说明', '描述', '详情', 'note', 'remark', 'memo', 'desc', 'comment'],
  id: ['id', '编号', '序号', 'no.', 'no'],
};

export const DEFAULT_SETTINGS = {
  theme: 'light',
  density: 'cozy',
  notify: true,
  sound: true,
  defaultReminders: [1440, 120, 15],
  repeatOverdue: true,
  dailyDigest: '',
  doneKeywords: ['完成', '已完成', 'done', 'finished', '✅', '结项', 'closed', '100%', '已上线'],
  weekStart: 1,
  sortBy: 'due',
  showDone: true,
  myName: '',
  // 合并单元格向下填充：默认关。很多表里「负责人」空着就是还没排人，
  // 填上会凭空多出「这行是他的」……需要的话在 排期设置 里手动打开。
  fillDown: false,
  fillDownVer: 2,
  syncOnSwitch: false,
  myColor: '#5B5BF0',
  manifestUrl: '',
};

export const DEFAULT_SCHEDULE = {
  enabled: false,
  baseDate: '',
  phaseCol: -1,
  titleCol: -1,
  releaseCol: -1,
  roles: [],
};

export const DEFAULT_RULES = [
  {
    id: 'r_done',
    name: '已完成',
    enabled: true,
    logic: 'all',
    conds: [{ field: 'done', op: 'is', value: 'true' }],
    style: {
      bg: '#F4F5F7', fg: '#98A2B3', bar: '#D0D5DD',
      badge: '已完成', badgeBg: '#EAECF0', badgeFg: '#667085', strike: true,
    },
  },
  {
    id: 'r_overdue',
    name: '已逾期',
    enabled: true,
    logic: 'all',
    conds: [{ field: 'dueIn', op: 'lt', value: 0, unit: 'min' }],
    style: {
      bg: '#FEF1F0', fg: '#B42318', bar: '#F04438',
      badge: '{overdue}', badgeBg: '#FEE4E2', badgeFg: '#B42318',
    },
  },
  {
    id: 'r_today',
    name: '24 小时内到期',
    enabled: true,
    logic: 'all',
    conds: [{ field: 'dueIn', op: 'lte', value: 24, unit: 'hour' }],
    style: {
      bg: '#FFF6ED', fg: '#B54708', bar: '#F79009',
      badge: '24 小时内', badgeBg: '#FEF0C7', badgeFg: '#B54708',
    },
  },
  {
    id: 'r_3d',
    name: '3 天内到期',
    enabled: true,
    logic: 'all',
    conds: [{ field: 'dueIn', op: 'lte', value: 3, unit: 'day' }],
    style: {
      bg: '#FFFCEB', fg: '#A15C07', bar: '#FDB022',
      badge: '3 天内', badgeBg: '#FEF7C3', badgeFg: '#A15C07',
    },
  },
  {
    id: 'r_7d',
    name: '7 天内到期',
    enabled: true,
    logic: 'all',
    conds: [{ field: 'dueIn', op: 'lte', value: 7, unit: 'day' }],
    style: {
      bg: '#F5F8FF', fg: '#175CD3', bar: '#84ADFF',
      badge: '7 天内', badgeBg: '#E0EAFF', badgeFg: '#175CD3',
    },
  },
];

export const state = {
  version: 1,
  updatedAt: 0,
  table: null,
  source: null,
  mapping: emptyMapping(),
  schedule: JSON.parse(JSON.stringify(DEFAULT_SCHEDULE)),
  overrides: {},
  rules: JSON.parse(JSON.stringify(DEFAULT_RULES)),
  settings: { ...DEFAULT_SETTINGS },
  filters: { q: '', bucket: 'all', tags: [], statuses: [], priority: [], mine: false, role: 'all' },
  ui: { view: 'overview' },
  reminders: { fired: {} },
  records: [],
  rowCards: [],
  byId: new Map(),
  // 多数据源：sources[].{ id, meta, table, mapping, schedule }，上面的 table/source/mapping/schedule 是「当前那一条」的镜像
  sources: [],
  activeId: '',
};

function emptyMapping() {
  return { title: -1, due: -1, status: -1, tags: -1, priority: -1, owner: -1, note: -1, id: -1 };
}

/* ------------------------------------------------------------------ 多数据源 */

function newSourceId() {
  return 'src' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function activeSource() {
  return (state.sources || []).find((s) => s.id === state.activeId) || null;
}

/** 把当前镜像写回当前数据源（切源 / 保存前调用） */
export function flushActive() {
  const src = activeSource();
  if (!src) return;
  src.meta = state.source;
  src.table = state.table;
  src.mapping = state.mapping;
  src.schedule = state.schedule;
}

function loadIntoMirrors(src) {
  state.activeId = src ? src.id : '';
  state.source = src ? src.meta : null;
  state.table = src ? src.table : null;
  state.mapping = src ? { ...emptyMapping(), ...(src.mapping || {}) } : emptyMapping();
  state.schedule = src ? { ...DEFAULT_SCHEDULE, ...(src.schedule || {}) } : JSON.parse(JSON.stringify(DEFAULT_SCHEDULE));
}

/** 切到另一个数据源 */
export function switchSource(id) {
  if (id === state.activeId) return false;
  const src = (state.sources || []).find((s) => s.id === id);
  if (!src) return false;
  flushActive();
  loadIntoMirrors(src);
  clearTransientFilters();
  rebuild();
  save();
  return true;
}

/** 去掉某个数据源；当前那条被删掉就切到第一条 */
export function removeSource(id) {
  const list = state.sources || [];
  const i = list.findIndex((s) => s.id === id);
  if (i < 0) return false;
  list.splice(i, 1);
  if (state.activeId === id) {
    loadIntoMirrors(list[0] || null);
    clearTransientFilters();
  }
  rebuild();
  save();
  return true;
}

function clearTransientFilters() {
  state.filters = { ...state.filters, q: '', tags: [], statuses: [], priority: [], role: 'all', phase: '' };
}

/* ------------------------------------------------------------------ 数据源 */

export function demoTable() {
  const t0 = startOfDay(Date.now());
  const at = (d, h = 0, m = 0) => {
    const x = new Date(t0);
    x.setDate(x.getDate() + d);
    x.setHours(h, m, 0, 0);
    return fmtDate(x.getTime(), 'YYYY-MM-DD HH:mm');
  };
  const inHours = (h) => fmtDate(Date.now() + h * 3600000, 'YYYY-MM-DD HH:mm');
  return {
    headers: ['任务', '截止时间', '状态', '标签', '优先级', '负责人', '备注'],
    rows: [
      ['完成 iOS 端联调', inHours(-30), '进行中', '工作/研发', '高', '阿哲', '卡在登录态过期'],
      ['提交季度复盘报告', inHours(-3), '进行中', '工作/汇报', '高', '我', '需要财务数据支撑'],
      ['报销上月差旅费', inHours(2), '进行中', '工作/财务', '高', '我', '发票还差两张'],
      ['客户回访电话', inHours(5), '未开始', '工作/客户', '中', '小周', '3 个重点客户'],
      ['产品需求评审会', at(1, 10), '未开始', '工作/产品', '高', '小林', '带上交互原型'],
      ['给妈妈挑生日礼物', at(2, 20), '未开始', '生活/家人', '中', '我', '预算 500 以内'],
      ['预约年度体检', at(3, 9, 30), '未开始', '生活/健康', '中', '我', '空腹，记得带医保卡'],
      ['缴纳房租', at(4, 10), '未开始', '生活/财务', '高', '我', ''],
      ['读《深度工作》第 3 章', at(5, 22), '进行中', '学习/阅读', '低', '我', ''],
      ['健身打卡 3 次', at(6, 21), '进行中', '生活/健康', '低', '我', ''],
      ['整理设计规范 v2', at(9, 18), '未开始', '工作/设计', '低', '小林', '先补组件状态'],
      ['提交专利申请材料', at(12, 17), '未开始', '工作/研发', '中', '阿哲', ''],
      ['国庆旅行攻略', at(25, 12), '未开始', '生活/旅行', '低', '我', '看机票'],
      ['周报汇总', at(-3, 18), '已完成', '工作', '中', '我', ''],
      ['续签办公场地合同', at(-1, 17), '已完成', '工作/法务', '高', '我', ''],
    ],
  };
}

export function loadDemo(asNew = true) {
  const t = demoTable();
  applyImport({
    headers: t.headers,
    rows: t.rows,
    source: {
      kind: 'demo',
      title: '示例数据 · 产品团队周计划',
      url: '',
      spreadsheetToken: '',
      sheetId: '',
      tableId: '',
      appToken: '',
      mode: 'demo',
    },
  }, { asNew });
}

const MONTH_DAY = /^\d{1,2}\s*[月\-/.]\s*\d{1,2}\s*日?$/;
export const isMonthDay = (v) => MONTH_DAY.test(String(v ?? '').trim());
export const isDoneText = (v) => String(v ?? '').trim() === '完成';

/** 识别算法版本：升级后老存档会按新规则重算角色（见 loadState） */
export const DETECT_VERSION = 3;

/** 表头 → 阶段主语：动作开始 → 动作、配置完成 → 配置、音效/图标 → 音效 */
export function subjectOf(header) {
  const s = String(header ?? '')
    .replace(/[（(][^)）]*[)）]/g, '')
    .replace(/\s+/g, '')
    .replace(/[\/、,，].*$/, '')
    .replace(/(开始|结束|完成|时间|日期|需求|排期|周期)/g, '')
    .trim();
  if (!s || /^列\d+$/.test(s) || /^\d+$/.test(s)) return '';
  return s;
}

/** 阶段主语 → 岗位（表里没有「配置负责人」，配置这件事归策划） */
const SUBJECT_ALIAS = { 配置: '策划', 收尾: '验收' };
/** 没有负责人列、但确实是独立工种的阶段 */
const TRACK_RE = /音效|配乐|音频|立绘|奥义图|图标/;
/** 更像是节点/老板查看，不算岗位 */
const MILESTONE_RE = /验收|上线|发布|审核|需求/;

/**
 * 角色名从「负责人」表头里取：策划负责人 → 策划、特效负责人 → 特效。
 * 取不到（无名列、纯数字列）才退回「角色 N」，不再按出现顺序硬套动作/特效/策划。
 */
export function roleName(header, index) {
  const raw = String(header ?? '').trim()
    .replace(/[（(][^)）]*[)）]/g, '')
    .replace(/(负责人|执行人|处理人|责任人|跟进人|owner|assignee|user)$/i, '')
    .replace(/[\s:：]+$/, '')
    .trim();
  if (raw && raw.length <= 8 && !/^列\s*\d+$/.test(raw) && !/^(未命名|null|undefined|nan)$/i.test(raw)) {
    return raw;
  }
  return `角色 ${index + 1}`;
}

/**
 * 识别「排期表」：一行一个内容，按角色分组重复出现「负责人 + 日期…」。
 * 不依赖表头，也不写死列号；识别不到就返回 null，走普通任务表。
 */
export function detectSchedule(headers, rows) {
  const width = Math.max(0, headers.length, ...rows.map((r) => r.length));
  if (!width || rows.length < 2) return null;

  const cols = [];
  for (let i = 0; i < width; i++) {
    const vals = rows.map((r) => String(r[i] ?? '').trim());
    const nonEmpty = vals.filter(Boolean);
    const dates = nonEmpty.filter(isMonthDay).length;
    const done = nonEmpty.filter(isDoneText).length;
    const texts = [...new Set(nonEmpty.filter((v) => !isMonthDay(v) && !isDoneText(v)))];
    const avgLen = texts.length ? texts.reduce((a, v) => a + v.length, 0) / texts.length : 0;
    cols.push({ i, dates, done, nonEmpty: nonEmpty.length, texts, avgLen });
  }

  const dateish = cols.map((c) => c.nonEmpty >= 3
    && c.dates + c.done >= Math.max(3, c.nonEmpty * 0.5)
    && c.texts.length <= 1);

  const phaseCol = cols.find((c) => c.texts.length >= 3
    && c.texts.filter((v) => /期|轮|批|阶段|阶段/.test(v)).length >= 3)?.i ?? -1;

  const nameCols = cols.filter((c) => c.i !== phaseCol
    && c.texts.length >= 2 && c.texts.length <= 12
    && c.dates === 0 && c.done === 0
    && c.avgLen <= 8);

  const roles = [];
  const milestones = [];
  const ownerCols = nameCols.filter((c) => /负责人|执行人|处理人|责任人/i.test(headers[c.i] || ''));

  if (ownerCols.length) {
    // 先按「负责人」列起岗位，再按表头语义把日期列分给对应岗位
    ownerCols.sort((a, b) => a.i - b.i).forEach((c, i) => {
      roles.push({ key: 'r' + i, name: roleName(headers[c.i], i), ownerCol: c.i, dateCols: [] });
    });

    const findRole = (subject) => {
      const s = SUBJECT_ALIAS[subject] || subject;
      if (!s) return null;
      return roles.find((r) => r.name === s)
        || roles.find((r) => r.name && (r.name.includes(s) || s.includes(r.name)))
        || null;
    };

    cols.forEach((c) => {
      if (!dateish[c.i]) return;
      const header = headers[c.i] || '';
      const subject = subjectOf(header);
      if (!subject) return;                      // 「上线日」这类没有主语，留给 releaseCol

      const hit = findRole(subject);
      if (hit) { hit.dateCols.push(c.i); return; }

      if (TRACK_RE.test(subject) && !MILESTONE_RE.test(header)) {
        // 音效这类没有负责人列，但确实是独立工种 → 自成一个岗位
        let t = roles.find((r) => r.ownerCol < 0 && r.name === subject);
        if (!t) {
          t = { key: 'r' + roles.length, name: subject, ownerCol: -1, dateCols: [] };
          roles.push(t);
        }
        t.dateCols.push(c.i);
        return;
      }

      // 模型 / 原画 / 收尾验收 → 卡片上的节点，不当岗位
      milestones.push({
        key: 'm' + milestones.length,
        name: header.replace(/(完成|时间|日期)$/, '') || subject,
        dateCols: [c.i],
      });
    });
  } else {
    // 没有「负责人」表头：退回老规矩，低基数文本列 + 紧跟其后的连续日期列
    for (const c of nameCols) {
      const dateCols = [];
      for (let j = c.i + 1; j < width && dateish[j]; j++) dateCols.push(j);
      if (dateCols.length >= 1) {
        roles.push({
          key: 'r' + roles.length,
          name: roleName(headers[c.i], roles.length),
          ownerCol: c.i,
          dateCols,
        });
      }
    }
  }

  if (roles.filter((r) => r.dateCols.length).length < 2) return null;

  const used = new Set([
    ...roles.flatMap((r) => (r.ownerCol >= 0 ? [r.ownerCol] : []).concat(r.dateCols)),
    ...milestones.flatMap((m) => m.dateCols),
  ]);
  const firstOwner = roles.find((r) => r.ownerCol >= 0);
  const before = cols.filter((c) => !used.has(c.i) && (!firstOwner || c.i < firstOwner.ownerCol));
  const titleCol = before
    .filter((c) => c.texts.length >= Math.max(5, rows.length * 0.4) && c.avgLen >= 2)
    .sort((a, b) => b.texts.length - a.texts.length)[0]?.i ?? -1;
  const releaseCol = before.find((c) => dateish[c.i] && c.i !== titleCol)?.i ?? -1;

  return {
    enabled: true,
    v: DETECT_VERSION,
    baseDate: fmtDate(Date.now(), 'YYYY-MM-DD'),
    phaseCol,
    titleCol,
    releaseCol,
    roles: roles.filter((r) => r.dateCols.length),
    milestones,
  };
}

export function applyImport(payload, { asNew = false } = {}) {
  if (!payload || !Array.isArray(payload.headers)) throw new Error('数据格式不正确');
  const rows = (payload.rows || []).filter((r) => Array.isArray(r) && r.some((c) => String(c ?? '').trim() !== ''));
  const table = { headers: payload.headers.map((h) => String(h ?? '').trim()), rows };
  const meta = {
    ...(payload.source || {}),
    lastSync: Date.now(),
    rowCount: rows.length,
    colCount: table.headers.length,
    error: '',
  };
  if (meta.mode === 'oauth' || meta.mode === 'feishu') meta.kind = 'feishu';
  const mapping = autoMap(table.headers, table.rows);
  const schedule = detectSchedule(table.headers, table.rows)
    || JSON.parse(JSON.stringify(DEFAULT_SCHEDULE));

  // asNew=true 时新开一条数据源，否则替换当前这条（没有就新建）
  let src = asNew ? null : activeSource();
  if (src) {
    src.meta = meta;
    src.table = table;
    src.mapping = mapping;
    src.schedule = schedule;
  } else {
    src = { id: newSourceId(), meta, table, mapping, schedule };
    state.sources.push(src);
  }
  state.activeId = src.id;
  state.source = meta;
  state.table = table;
  state.mapping = mapping;
  state.schedule = schedule;
  clearTransientFilters();
  rebuild();
  save(true);
  return state.records.length;
}

/* ------------------------------------------------------------------ 字段映射 */

const norm = (s) => String(s ?? '').toLowerCase().replace(/[\s\-_/\\:：()（）[\]【】]/g, '');

export function autoMap(headers, rows) {
  const m = emptyMapping();
  const used = new Set();
  const sample = (i) => (rows || []).slice(0, 12).map((r) => r[i]).filter((v) => String(v ?? '').trim() !== '');

  const score = (role, h, i) => {
    const nh = norm(h);
    if (!nh) return 0;
    let s = 0;
    for (const kw of ROLE_KEYWORDS[role]) {
      const nk = norm(kw);
      if (!nk) continue;
      if (nh === nk) { s = Math.max(s, 100); break; }
      if (nh.includes(nk)) s = Math.max(s, 62);
    }
    const vals = sample(i);
    if (role === 'due' && vals.length) {
      const ok = vals.filter((v) => parseDate(v) != null).length / vals.length;
      if (ok > .6) s = Math.max(s, 78);
      if (vals.every((v) => /^\d{4,5}(\.\d+)?$/.test(String(v).trim()))) s -= 40;
    }
    if (role === 'status' && vals.length) {
      const ok = vals.filter((v) => /完成|进行|未开始|待办|进行中|done|todo|closed/i.test(String(v))).length / vals.length;
      if (ok > .5) s = Math.max(s, 74);
    }
    if (role === 'tags' && vals.length) {
      const ok = vals.filter((v) => /[,，/、;；]/.test(String(v))).length / vals.length;
      if (ok > .5) s = Math.max(s, 58);
    }
    if (role === 'priority' && vals.length) {
      const ok = vals.filter((v) => /高|中|低|紧急|重要|high|medium|low/i.test(String(v))).length / vals.length;
      if (ok > .6) s = Math.max(s, 70);
    }
    if (role === 'title' && vals.length) {
      const avg = vals.reduce((a, v) => a + String(v).length, 0) / vals.length;
      if (avg > 6) s = Math.max(s, 30);
    }
    return s;
  };

  for (const role of ROLES) {
    let best = -1;
    let bestScore = role === 'title' ? 26 : 44;
    headers.forEach((h, i) => {
      if (used.has(i)) return;
      const s = score(role, h, i);
      if (s > bestScore) { bestScore = s; best = i; }
    });
    if (best >= 0) { m[role] = best; used.add(best); }
  }
  if (m.title < 0) {
    // 选平均文本最长的列
    let best = 0; let bestLen = -1;
    headers.forEach((h, i) => {
      const vals = sample(i);
      const avg = vals.length ? vals.reduce((a, v) => a + String(v).length, 0) / vals.length : 0;
      if (avg > bestLen) { bestLen = avg; best = i; }
    });
    m.title = best;
  }
  return m;
}

/* ------------------------------------------------------------------ 归一化 */

function isDoneStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  if (!s) return false;
  return (state.settings.doneKeywords || []).some((k) => k && s.includes(String(k).toLowerCase()));
}

function srcPrefix() {
  return state.activeId ? `${state.activeId}|` : '';
}

export function rebuild() {
  state.records = [];
  state.byId = new Map();
  state.rowCards = [];
  if (!state.table) return;
  if (state.schedule && state.schedule.enabled) rebuildSchedule();
  else rebuildGeneric();
  state.records.forEach((r) => state.byId.set(r.id, r));
}

function rebuildSchedule() {
  const S = state.schedule;
  const baseTs = S.baseDate ? new Date(S.baseDate + 'T00:00:00').getTime() : Date.now();
  const rows = state.table.rows;
  const roles = (S.roles || []).filter((r) => r.dateCols && r.dateCols.length);
  const milestones = S.milestones || [];

  // 合并单元格：飞书只返回左上角那一格，其余行是空串。
  // fillDown 打开时把上一行的负责人顺延下来，关掉就保持原样（设置 → 排期设置里可切）。
  // 整行一个人都没排（黄忠、魏延这种）不填，免得凭空长出负责人。
  const rowHasRoleData = rows.map((row) => roles.some((role) => {
    if (role.ownerCol >= 0 && String(row[role.ownerCol] ?? '').trim()) return true;
    return role.dateCols.some((ci) => String(row[ci] ?? '').trim());
  }));
  const filledOwners = roles.map((role) => {
    if (role.ownerCol < 0 || !state.settings.fillDown) return null;
    const out = new Array(rows.length).fill('');
    let last = '';
    for (let i = 0; i < rows.length; i++) {
      const v = String(rows[i][role.ownerCol] ?? '').trim();
      if (v) last = v;
      out[i] = rowHasRoleData[i] ? (v || last) : '';
    }
    return out;
  });

  rows.forEach((row, idx) => {
    const content = S.titleCol >= 0 ? String(row[S.titleCol] ?? '').trim() : '';
    const phase = S.phaseCol >= 0 ? String(row[S.phaseCol] ?? '').trim() : '';
    const release = S.releaseCol >= 0 ? String(row[S.releaseCol] ?? '').trim() : '';
    const recs = [];

    roles.forEach((role, ri) => {
      const hasOwnerCol = role.ownerCol >= 0;
      const ownCell = hasOwnerCol ? String(row[role.ownerCol] ?? '').trim() : '';
      const ownerRaw = ownCell || (filledOwners[ri] ? filledOwners[ri][idx] : '');
      if (hasOwnerCol && !ownerRaw) return;

      // 该岗位的开始 / 截止：取这一组日期列里最早与最晚的可解析日期
      let startRaw = '';
      let dueRaw = '';
      let done = false;
      role.dateCols.forEach((ci) => {
        const v = String(row[ci] ?? '').trim();
        if (!v) return;
        if (isDoneText(v)) { done = true; return; }
        if (!isMonthDay(v)) return;
        if (!startRaw) startRaw = v;
        dueRaw = v;
      });
      // 没有负责人列（音效）时，没有日期就不出任务
      if (!hasOwnerCol && !startRaw && !done) return;

      const owners = ownerRaw
        ? ownerRaw.split(/[、,，/\\\s]+/).map((x) => x.trim()).filter(Boolean)
        : [];
      const due = dueRaw ? parseMonthDay(dueRaw, baseTs) : null;
      const start = startRaw ? parseMonthDay(startRaw, baseTs) : null;
      const id = srcPrefix() + `s${idx}:${role.key}`;
      const ov = state.overrides[id] || {};
      const isDone = (ov.done != null ? !!ov.done : done) || false;

      recs.push({
        id,
        rowIndex: idx,
        raw: row,
        title: content || `${role.name}任务 ${idx + 1}`,
        due,
        dueRaw,
        start,
        startRaw,
        status: done ? '完成' : '',
        tags: [role.name].filter(Boolean),
        priority: '',
        owner: owners[0] || ownerRaw,
        owners,
        ownerless: !hasOwnerCol,
        note: release ? `上线 ${release}` : '',
        done: isDone,
        doneAt: ov.doneAt || null,
        reminders: Array.isArray(ov.reminders) ? ov.reminders : null,
        snoozeUntil: ov.snoozeUntil || null,
        roleKey: role.key,
        roleName: role.name,
        phase,
      });
    });

    if (!recs.length) {
      // 一行什么都没有：也给一张「未排期」卡，看得见才知道该排谁
      if (content) {
        state.rowCards.push({
          rowIndex: idx,
          title: content,
          phase,
          release,
          releaseTs: release ? parseMonthDay(release, baseTs) : null,
          recs: [],
          milestones: milestones
            .map((m) => {
              const raw = String(row[m.dateCols[0]] ?? '').trim();
              return { name: m.name, raw, due: isMonthDay(raw) ? parseMonthDay(raw, baseTs) : null };
            })
            .filter((m) => m.raw),
          unplanned: true,
        });
      }
      return;
    }
    state.records.push(...recs);
    state.rowCards.push({
      rowIndex: idx,
      title: content || `第 ${idx + 1} 行`,
      phase,
      release,
      releaseTs: release ? parseMonthDay(release, baseTs) : null,
      recs,
      milestones: milestones
        .map((m) => {
          const raw = String(row[m.dateCols[0]] ?? '').trim();
          return { name: m.name, raw, due: isMonthDay(raw) ? parseMonthDay(raw, baseTs) : null };
        })
        .filter((m) => m.raw),
    });
  });
}

function rebuildGeneric() {
  const t = state.table;
  if (!t) return;

  const { headers, rows } = t;
  const m = state.mapping;
  const used = new Set();

  rows.forEach((row, idx) => {
    const cell = (k) => (m[k] >= 0 ? row[m[k]] : undefined);
    const title = String(cell('title') ?? '').trim();
    if (!title) return;
    if (idx === 0 && title === String(headers[m.title] ?? '').trim() && rows.length > 3) {
      // 有些粘贴内容把表头也带进来了
      return;
    }
    const dueRaw = cell('due');
    const due = parseDate(dueRaw);
    const status = String(cell('status') ?? '').trim();
    const tags = parseTags(cell('tags'));
    const priority = String(cell('priority') ?? '').trim();
    const owner = String(cell('owner') ?? '').trim();
    const note = String(cell('note') ?? '').trim();

    let id = m.id >= 0 ? String(cell('id') ?? '').trim() : '';
    if (!id) id = `h:${hash(title + '|' + (m.id >= 0 ? cell('id') : '') + '|' + idx)}`;
    id = srcPrefix() + id;
    if (used.has(id)) id = id + '-' + idx;
    used.add(id);

    const ov = state.overrides[id] || {};
    const done = (ov.done != null ? !!ov.done : isDoneStatus(status)) || false;

    state.records.push({
      id, rowIndex: idx, raw: row,
      title, due, dueRaw, status, tags, priority, owner, note,
      done,
      doneAt: ov.doneAt || null,
      reminders: Array.isArray(ov.reminders) ? ov.reminders : null,
      snoozeUntil: ov.snoozeUntil || null,
    });
  });
}

/* ------------------------------------------------------------------ 查询 */

export function phaseList() {
  const map = new Map();
  state.records.forEach((r) => { if (r.phase) map.set(r.phase, (map.get(r.phase) || 0) + 1); });
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-CN', { numeric: true }));
}

export function tagCounts() {
  const map = new Map();
  state.records.forEach((r) => r.tags.forEach((t) => map.set(t, (map.get(t) || 0) + 1)));
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

export function statusOptions() {
  const set = new Set();
  state.records.forEach((r) => { if (r.status) set.add(r.status); });
  return [...set];
}

export function priorityOptions() {
  const order = ['高', '中', '低'];
  const set = new Set();
  state.records.forEach((r) => { if (r.priority) set.add(r.priority); });
  return [...set].sort((a, b) => {
    const ia = order.indexOf(a); const ib = order.indexOf(b);
    return (ia < 0 ? 9 : ia) - (ib < 0 ? 9 : ib);
  });
}

export function filteredRecords({ ignoreBucket = false } = {}) {
  const now = Date.now();
  const f = state.filters;
  const q = f.q.trim().toLowerCase();
  let list = state.records;

  if (!ignoreBucket) {
    switch (f.bucket) {
      case 'overdue': list = list.filter((r) => !r.done && r.due != null && r.due < now); break;
      case 'today': list = list.filter((r) => !r.done && r.due != null && sameDay(r.due, now)); break;
      case 'week': {
        const a = startOfWeek(now, state.settings.weekStart);
        const b = addDays(a, 7);
        list = list.filter((r) => !r.done && r.due != null && r.due >= a && r.due < b);
        break;
      }
      case 'undone': list = list.filter((r) => !r.done); break;
      case 'done': list = list.filter((r) => r.done); break;
      default: break;
    }
    if (!state.settings.showDone && f.bucket !== 'done') list = list.filter((r) => !r.done);
  }

  if (f.tags.length) list = list.filter((r) => r.tags.some((t) => f.tags.includes(t)));
  if (f.statuses.length) list = list.filter((r) => f.statuses.includes(r.status));
  if (f.priority.length) list = list.filter((r) => f.priority.includes(r.priority));
  if (f.mine && state.settings.myName) {
    const me = state.settings.myName.trim();
    list = list.filter((r) => {
      const owners = r.owners && r.owners.length ? r.owners : [r.owner];
      return owners.some((o) => o && (o.includes(me) || me.includes(o)));
    });
  }
  if (f.role && f.role !== 'all') list = list.filter((r) => r.roleKey === f.role);
  if (f.phase) list = list.filter((r) => r.phase === f.phase);
  if (q) {
    list = list.filter((r) => {
      const hay = [r.title, r.status, r.owner, (r.owners || []).join(' '), r.note, r.priority, ...r.tags].join(' ').toLowerCase();
      return q.split(/\s+/).every((w) => hay.includes(w));
    });
  }

  const dir = state.settings.sortBy;
  const pr = { 高: 0, 中: 1, 低: 2 };
  list = [...list].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (dir === 'priority') {
      const d = (pr[a.priority] ?? 9) - (pr[b.priority] ?? 9);
      if (d) return d;
    }
    if (dir === 'title') return a.title.localeCompare(b.title, 'zh');
    if (dir === 'status') {
      const d = String(a.status).localeCompare(String(b.status), 'zh');
      if (d) return d;
    }
    if (a.due == null && b.due == null) return a.rowIndex - b.rowIndex;
    if (a.due == null) return 1;
    if (b.due == null) return -1;
    return a.due - b.due;
  });
  return list;
}

/* ------------------------------------------------------------------ 按内容合并的卡片 */

/** 当前用户是否负责这条记录 —— 表格是老板和各岗位维护的，只允许勾自己的部分 */
export function canEdit(rec) {
  const me = String(state.settings.myName || '').trim();
  if (!me || !rec) return false;
  if (rec.ownerless) return false;
  const owners = rec.owners && rec.owners.length ? rec.owners : [rec.owner];
  return owners.some((o) => o && (o.includes(me) || me.includes(o)));
}

/**
 * 列表用：一行内容一张卡，把动作 / 特效 / 策划（以及音效、验收节点）摊在同一张卡上。
 * 未选具体岗位时用它；选了岗位就退回 filteredRecords()。
 */
export function rowCardList({ ignoreBucket = false } = {}) {
  const now = Date.now();
  const f = state.filters;
  const q = f.q.trim().toLowerCase();
  const me = String(state.settings.myName || '').trim();
  const onlyRole = f.role && f.role !== 'all' ? f.role : '';

  // 「只看我的」不只筛卡片，卡上的别人的块也一起去掉（里程碑不属于谁，一并隐藏）
  const mineOnly = !!(f.mine && me);
  let cards = (state.rowCards || []).map((card) => {
    let recs = onlyRole ? card.recs.filter((r) => r.roleKey === onlyRole) : card.recs;
    if (mineOnly) recs = recs.filter((r) => canEdit(r));
    return { ...card, recs, milestones: mineOnly ? [] : card.milestones };
  }).filter((c) => c.recs.length || (!onlyRole && !mineOnly && c.unplanned));

  cards.forEach((c) => {
    const open = c.recs.filter((r) => !r.done);
    const pool = open.length ? open : c.recs;
    const withDue = pool.filter((r) => r.due != null);
    const pick = withDue.slice().sort((a, b) => a.due - b.due)[0] || pool[0] || null;
    c.due = pick && pick.due != null ? pick.due : null;
    c.dueRec = pick;
    c.done = c.recs.length > 0 && c.recs.every((r) => r.done);
    c.doneCount = c.recs.filter((r) => r.done).length;
    c.mine = !!me && c.recs.some((r) => canEdit(r));
  });

  if (f.tags.length) cards = cards.filter((c) => c.recs.some((r) => r.tags.some((t) => f.tags.includes(t))));
  if (f.phase) cards = cards.filter((c) => c.phase === f.phase);
  if (f.mine && me) cards = cards.filter((c) => c.mine);
  if (f.statuses.length) cards = cards.filter((c) => c.recs.some((r) => f.statuses.includes(r.status)));
  if (f.priority.length) cards = cards.filter((c) => c.recs.some((r) => f.priority.includes(r.priority)));
  if (q) {
    cards = cards.filter((c) => {
      const hay = [
        c.title, c.phase, c.release,
        ...c.recs.flatMap((r) => [r.owner, (r.owners || []).join(' '), r.roleName, r.note]),
        ...c.milestones.map((m) => m.name),
      ].join(' ').toLowerCase();
      return q.split(/\s+/).every((w) => hay.includes(w));
    });
  }

  if (!ignoreBucket) {
    switch (f.bucket) {
      case 'overdue': cards = cards.filter((c) => !c.done && c.due != null && c.due < now); break;
      case 'today': cards = cards.filter((c) => !c.done && c.due != null && sameDay(c.due, now)); break;
      case 'week': {
        const a = startOfWeek(now, state.settings.weekStart);
        const b = addDays(a, 7);
        cards = cards.filter((c) => !c.done && c.due != null && c.due >= a && c.due < b);
        break;
      }
      case 'undone': cards = cards.filter((c) => !c.done); break;
      case 'done': cards = cards.filter((c) => c.done); break;
      default: break;
    }
    if (!state.settings.showDone && f.bucket !== 'done') cards = cards.filter((c) => !c.done);
  }

  cards.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.due == null && b.due == null) return a.rowIndex - b.rowIndex;
    if (a.due == null) return 1;
    if (b.due == null) return -1;
    return a.due - b.due;
  });
  return cards;
}

export function computeStats() {
  const now = Date.now();
  const open = state.records.filter((r) => !r.done);
  const done = state.records.filter((r) => r.done);
  const overdue = open.filter((r) => r.due != null && r.due < now);
  const today = open.filter((r) => r.due != null && sameDay(r.due, now));
  const overdueToday = overdue.filter((r) => sameDay(r.due, now)).length;
  const week = open.filter((r) => r.due != null && r.due >= now && r.due < startOfWeek(now, 1) + 7 * DAY);
  const noDue = open.filter((r) => r.due == null);
  return {
    total: state.records.length,
    open: open.length,
    done: done.length,
    overdue: overdue.length,
    today: today.length,
    overdueToday,
    week: week.length,
    noDue: noDue.length,
    rate: state.records.length ? Math.round((done.length / state.records.length) * 100) : 0,
  };
}

/* ------------------------------------------------------------------ 变更 */

export function toggleDone(id) {
  const rec = state.byId.get(id);
  if (!rec) return false;
  // 排期表：只能勾自己负责的那一块，别人的进度不在这里改
  if (state.schedule && state.schedule.enabled && !canEdit(rec)) return false;
  const ov = state.overrides[id] || {};
  const next = !rec.done;
  state.overrides[id] = { ...ov, done: next, doneAt: next ? Date.now() : null };
  rec.done = next;
  rec.doneAt = state.overrides[id].doneAt;
  save();
  return true;
}

export function setOverride(id, patch) {
  state.overrides[id] = { ...(state.overrides[id] || {}), ...patch };
  rebuild();
  save();
}

export function setMapping(patch) {
  state.mapping = { ...state.mapping, ...patch };
  rebuild();
  save();
}

/* ------------------------------------------------------------------ 手动选列 */

/** 内容 / 期数 / 上线日：直接指到某一列（-1 = 不用） */
export function setScheduleCol(key, col) {
  if (!['phaseCol', 'titleCol', 'releaseCol'].includes(key)) return;
  state.schedule[key] = Number(col);
  rebuild();
  save();
}

/** 某个岗位的负责人列（-1 = 没有负责人列，比如音效） */
export function setRoleOwnerCol(roleKey, col) {
  const role = (state.schedule.roles || []).find((r) => r.key === roleKey);
  if (!role) return;
  role.ownerCol = Number(col);
  rebuild();
  save();
}

/** 某个岗位用哪几列当日期（点一下就加/减）。最后一个日期列不让关，否则这个岗位就没东西可算了 */
export function toggleRoleDateCol(roleKey, col) {
  const role = (state.schedule.roles || []).find((r) => r.key === roleKey);
  if (!role) return false;
  const c = Number(col);
  const has = role.dateCols.includes(c);
  if (has && role.dateCols.length <= 1) return false;
  role.dateCols = has
    ? role.dateCols.filter((x) => x !== c)
    : [...role.dateCols, c].sort((a, b) => a - b);
  rebuild();
  save();
  return true;
}

export function setFilter(patch) {
  state.filters = { ...state.filters, ...patch };
  save();
}

export function resetFilters() {
  state.filters = { q: '', bucket: 'all', tags: [], statuses: [], priority: [], mine: false, role: 'all' };
  save();
}

export function setView(view) {
  state.ui.view = view;
  save();
}

/* ------------------------------------------------------------------ 持久化 */

function serialize() {
  flushActive();
  return {
    version: state.version,
    updatedAt: state.updatedAt,
    sources: state.sources,
    activeId: state.activeId,
    overrides: state.overrides,
    rules: state.rules,
    settings: state.settings,
    filters: state.filters,
    ui: state.ui,
    reminders: state.reminders,
  };
}

let postTimer = 0;
export function save(immediate = false) {
  state.updatedAt = Date.now();
  const data = serialize();
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch { /* quota */ }
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  clearTimeout(postTimer);
  const push = () => {
    fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: data }),
    }).catch(() => {});
  };
  if (immediate) push(); else postTimer = setTimeout(push, 700);
}

export async function loadState() {
  let local = null;
  let remote = null;
  try { local = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { local = null; }
  if (location.protocol === 'http:' || location.protocol === 'https:') {
    try {
      const res = await fetch('/api/state', { cache: 'no-store' });
      if (res.ok) {
        const j = await res.json();
        if (j && j.state) remote = j.state;
      }
    } catch { /* server 不可用时降级 */ }
  }
  const best = (remote && local)
    ? ((remote.updatedAt || 0) >= (local.updatedAt || 0) ? remote : local)
    : (remote || local);

  if (!best || (!best.table && !(Array.isArray(best.sources) && best.sources.length))) {
    loadDemo();
    return { firstRun: true };
  }

  state.version = best.version || 1;
  state.updatedAt = best.updatedAt || 0;

  // 多数据源：新存档直接读 sources；老存档（单表）就地迁移成一条数据源
  if (Array.isArray(best.sources) && best.sources.length) {
    state.sources = best.sources;
    state.activeId = best.sources.some((s) => s.id === best.activeId) ? best.activeId : best.sources[0].id;
  } else if (best.table) {
    const src = {
      id: newSourceId(),
      meta: best.source || { kind: 'paste', title: '未命名数据源' },
      table: best.table,
      mapping: best.mapping || emptyMapping(),
      schedule: best.schedule || JSON.parse(JSON.stringify(DEFAULT_SCHEDULE)),
    };
    state.sources = [src];
    state.activeId = src.id;
  }
  loadIntoMirrors(activeSource());

  state.overrides = best.overrides || {};
  state.rules = Array.isArray(best.rules) && best.rules.length
    ? best.rules
    : JSON.parse(JSON.stringify(DEFAULT_RULES));
  const savedSettings = best.settings || {};
  state.settings = { ...DEFAULT_SETTINGS, ...savedSettings };
  // 老存档一次性把「向下填充」关掉（它会把空着的负责人算成上一个人）
  if ((savedSettings.fillDownVer || 1) < 2) {
    state.settings.fillDown = false;
    state.settings.fillDownVer = 2;
  }
  state.filters = { ...state.filters, ...(best.filters || {}) };
  state.ui = { ...state.ui, ...(best.ui || {}) };
  state.reminders = { fired: {}, ...(best.reminders || {}) };

  // 识别规则升级过：老存档按新规则重算角色（保留档期基准日）。
  // 必须等下面所有字段都恢复完再存，否则会把空的 overrides 写回磁盘。
  const staleSchedule = state.schedule.enabled && state.table
    && (state.schedule.v || 1) < DETECT_VERSION;
  if (staleSchedule) {
    const re = detectSchedule(state.table.headers, state.table.rows);
    if (re) state.schedule = { ...re, baseDate: state.schedule.baseDate || re.baseDate };
  }

  rebuild();
  if (staleSchedule) save();
  return { firstRun: false };
}

export function clearAll() {
  state.table = null;
  state.source = null;
  state.sources = [];
  state.activeId = '';
  state.mapping = emptyMapping();
  state.schedule = JSON.parse(JSON.stringify(DEFAULT_SCHEDULE));
  state.overrides = {};
  state.records = [];
  state.rowCards = [];
  state.byId = new Map();
  state.filters = { q: '', bucket: 'all', tags: [], statuses: [], priority: [], mine: false, role: 'all' };
  state.reminders = { fired: {} };
  save(true);
}

export function exportJSON() {
  return JSON.stringify(serialize(), null, 2);
}
