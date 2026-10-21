/* 日程舱 — 主界面渲染 */
import {
  state, setView, setFilter, resetFilters, toggleDone, filteredRecords, rowCardList,
  tagCounts, computeStats, save, DEFAULT_RULES, phaseList, canEdit, TAG_MULTI_SELECT,
  switchSource, removeSource,
} from './store.js';
import { evalRules, resolveStyle, styleVars, describeRule, sampleRecord } from './rules.js';
import { icon, toast } from './kit.js';
import {
  esc, fmtDue, fmtShort, relTime, bucketOf, BUCKETS, fmtDate, weekdayCN,
  DAY, HOUR, MIN, sameDay, startOfDay, addDays, startOfWeek, initials,
} from './util.js';
import * as panels from './panels.js';
import { upcoming, permission } from './reminders.js';

let calCursor = new Date();
let inited = false;

const NAV = [
  { key: 'overview', label: '总览', icon: 'overview' },
  { key: 'tasks', label: '任务清单', icon: 'list', count: true },
  { key: 'calendar', label: '日历', icon: 'calendar' },
  { key: 'table', label: '表格', icon: 'table' },
  { key: 'rules', label: '规则中心', icon: 'rules' },
];

const VIEW_TITLE = {
  overview: '总览',
  tasks: '任务清单',
  calendar: '日历',
  table: '表格视图',
  rules: '规则中心',
};

function timeAgo(ts) {
  if (!ts) return '尚未同步';
  const d = Date.now() - ts;
  if (d < MIN) return '刚刚同步';
  if (d < HOUR) return `${Math.floor(d / MIN)} 分钟前`;
  if (d < DAY) return `${Math.floor(d / HOUR)} 小时前`;
  return `${Math.floor(d / DAY)} 天前`;
}

/* ========================================================================== */
/* 渲染入口                                                                   */
/* ========================================================================== */

export function render({ keepScroll = false, onlyView = false } = {}) {
  const root = document.getElementById('viewRoot');
  const scroll = root.scrollTop;
  if (!onlyView) {
    renderNav();
    renderSource();
    renderTags();
    renderFoot();
  }
  renderHeader();
  renderView();
  if (keepScroll) requestAnimationFrame(() => { root.scrollTop = scroll; });
}

function renderNav() {
  const nav = document.getElementById('nav');
  const stats = computeStats();
  nav.innerHTML = NAV.map((n) => `
    <button class="nav-item ${state.ui.view === n.key ? 'active' : ''}" data-view="${n.key}">
      ${icon(n.icon)}<span class="label">${n.label}</span>
      ${n.count ? `<span class="nav-count">${stats.open}</span>` : ''}
    </button>`).join('');
}

function renderSource() {
  const el = document.getElementById('sideSource');
  const list = state.sources || [];
  if (!list.length) {
    el.innerHTML = `
      <div class="side-title">数据源</div>
      <div class="source-card">
        <div class="source-meta">尚未导入表格</div>
        <button class="btn sm primary" data-act="import">${icon('plus')}导入飞书表格</button>
      </div>`;
    return;
  }
  el.innerHTML = `
    <div class="side-title">数据源<button data-act="import-new" title="新增一个数据源">${icon('plus', 'sm')}</button></div>
    ${list.map((s) => {
      const meta = s.meta || {};
      const active = s.id === state.activeId;
      const demo = meta.kind === 'demo';
      const dot = demo ? 'warn' : (meta.error ? 'warn' : 'ok');
      const canSync = meta.kind === 'feishu' && meta.url;
      const rows = s.table && s.table.rows ? s.table.rows.length : 0;
      return `
      <div class="source-card ${active ? 'active' : ''}" ${active ? '' : `data-act="source-switch" data-id="${esc(s.id)}" role="button" title="切换到 ${esc(meta.title || '这个数据源')}"`}>
        <div class="source-top">
          <span class="sync-dot ${dot}"></span>
          <span class="source-name" title="${esc(meta.title || '')}">${esc(meta.title || '未命名数据源')}</span>
          ${list.length > 1 ? `<button class="icon-btn" data-act="source-remove" data-id="${esc(s.id)}" title="移除这个数据源">${icon('x', 'sm')}</button>` : ''}
        </div>
        <div class="source-meta">${demo ? '示例数据 · 仅供预览' : `${timeAgo(meta.lastSync)} · ${rows} 行`}</div>
        ${active ? `<div class="source-actions">
          <button class="btn sm ghost" data-act="sync" title="${canSync ? '从飞书重新读取' : '重新导入'}">${icon('refresh')}${canSync ? '同步' : '重新导入'}</button>
          <button class="btn sm ghost" data-act="import" title="更换这条数据源">${icon('link')}更换</button>
        </div>` : ''}
      </div>`;
    }).join('')}`;
}

function renderTags() {
  const el = document.getElementById('sideTags');
  const tags = tagCounts().slice(0, 9);
  const active = state.filters.tags;
  const scheduleOn = state.schedule && state.schedule.enabled;
  const phases = scheduleOn ? phaseList() : [];
  const activePhase = state.filters.phase || '';
  const phaseHtml = phases.length ? `
    <div class="side-title">档期${activePhase ? `<button data-act="phase" data-phase="" title="显示全部">${icon('x', 'sm')}</button>` : ''}</div>
    <div class="tag-list" style="max-height:210px;overflow:auto">
      <button class="tag-row ${activePhase ? '' : 'active'}" data-act="phase" data-phase="">
        <span class="tag-dot" style="background:var(--accent)"></span>
        <span class="tag-name">全部档期</span>
        <span class="tag-count">${phases.reduce((a, x) => a + x[1], 0)}</span>
      </button>
      ${phases.map(([p, n]) => `
        <button class="tag-row ${activePhase === p ? 'active' : ''}" data-act="phase" data-phase="${esc(p)}">
          <span class="tag-dot" style="background:${activePhase === p ? 'var(--accent)' : 'var(--text-3)'}"></span>
          <span class="tag-name">${esc(p)}</span>
          <span class="tag-count">${n}</span>
        </button>`).join('')}
    </div>` : '';

  if (!tags.length && !phaseHtml) { el.innerHTML = ''; return; }
  el.innerHTML = phaseHtml + (tags.length ? `
    <div class="side-title">角色 / 标签${active.length ? `<button data-act="clear-tags" title="清除标签筛选">${icon('x', 'sm')}</button>` : ''}</div>
    <div class="tag-list">
      ${tags.map(([t, n], i) => `
        <button class="tag-row ${active.includes(t) ? 'active' : ''}" data-act="tag" data-tag="${esc(t)}">
          <span class="tag-dot" style="background:${tagColor(t, i)}"></span>
          <span class="tag-name">${esc(t)}</span>
          <span class="tag-count">${n}</span>
        </button>`).join('')}
    </div>` : '');
}

function renderFoot() {
  const el = document.getElementById('sideFoot');
  const perm = permission();
  const text = perm === 'granted' ? '提醒已开启' : perm === 'denied' ? '通知被拦截' : '提醒未开启';
  el.innerHTML = `
    <span class="pill">${icon('bell', 'sm')}${text}</span>
    <button class="icon-btn" data-act="settings" title="设置">${icon('settings')}</button>`;
}

function renderHeader() {
  const view = state.ui.view;
  const stats = computeStats();
  document.getElementById('pageTitle').textContent = VIEW_TITLE[view] || '任务';
  let sub = '';
  if (view === 'overview') {
    sub = `今天是 ${fmtDate(Date.now(), 'M月D日')} ${weekdayCN(Date.now())} · 共 ${stats.total} 项，${stats.open} 项待办`;
  } else if (view === 'tasks') {
    sub = `${stats.open} 项待办${stats.overdue ? ` · ${stats.overdue} 项已逾期` : ''}${stats.today ? ` · 今天 ${stats.today} 项` : ''}`;
  } else if (view === 'calendar') {
    sub = '按截止日期浏览 · 点击任务可查看详情';
  } else if (view === 'table') {
    sub = `${state.source ? state.source.title : '表格'} · ${state.records.length} 行${state.table ? ` × ${state.table.headers.length} 列` : ''}`;
  } else {
    sub = `按截止时间自动上色 · 共 ${state.rules.length} 条规则 · 从上往下匹配`;
  }
  document.getElementById('pageSub').textContent = sub;
}

function renderView() {
  const root = document.getElementById('viewRoot');
  const view = state.ui.view;
  let html = '';
  if (view === 'overview') html = viewOverview();
  else if (view === 'tasks') html = viewTasks();
  else if (view === 'calendar') html = viewCalendar();
  else if (view === 'table') html = viewTable();
  else html = viewRules();
  root.innerHTML = html;
  updateBell();
}

/* ========================================================================== */
/* 总览                                                                       */
/* ========================================================================== */

function viewOverview() {
  const stats = computeStats();
  const now = Date.now();
  const open = state.records.filter((r) => !r.done && r.due != null && r.due < now + 7 * DAY)
    .sort((a, b) => a.due - b.due).slice(0, 7);
  const topTags = tagCounts().slice(0, 6);
  const maxTag = Math.max(1, ...topTags.map((t) => t[1]));
  const ruleHit = new Map();
  state.records.forEach((rec) => {
    const r = evalRules(rec, now);
    if (r) ruleHit.set(r.id, (ruleHit.get(r.id) || 0) + 1);
  });
  const ruleRows = state.rules.map((r) => ({ rule: r, count: ruleHit.get(r.id) || 0 }))
    .filter((x) => x.count > 0);

  return `
  <div class="view">
    ${demoBanner()}
    <div class="stat-grid">
      ${statCard('待办任务', stats.open, `共 ${stats.total} 项`, 'list', 'var(--accent)')}
      ${statCard('今天到期', stats.today, stats.overdueToday ? `${stats.overdueToday} 项已过时间` : '今天安排得过来', 'clock', 'var(--amber)')}
      ${statCard('已逾期', stats.overdue, stats.overdue ? '优先处理这些' : '全部按期推进', 'alert', 'var(--red)')}
      ${statCard('完成率', stats.rate + '%', `已完成 ${stats.done} 项`, 'check-circle', 'var(--green)')}
    </div>

    <div class="panel-grid">
      <section class="panel">
        <div class="panel-head">
          <div class="panel-title">接下来 7 天</div>
          <span class="spacer"></span>
          <button class="btn" data-act="go" data-view="tasks">全部任务 ${icon('arrow-right')}</button>
        </div>
        ${open.length ? `<div class="feed">${open.map((r) => feedItem(r, now)).join('')}</div>`
      : `<div class="empty" style="padding:36px 10px"><div class="empty-icon">${icon('check-circle')}</div><h3>未来 7 天没有到期任务</h3><p>享受一下，或者去导入新的表格。</p></div>`}
      </section>

      <section class="panel">
        <div class="panel-head">
          <div class="panel-title">标签分布</div>
          <span class="spacer"></span>
          <button class="btn" data-act="go" data-view="tasks">筛选 ${icon('arrow-right')}</button>
        </div>
        ${topTags.length ? `<div class="bar-list">${topTags.map(([t, n]) => `
          <div class="bar-row">
            <div class="bar-name" title="${esc(t)}">${esc(t)}</div>
            <div class="bar-track"><div class="bar-fill" style="width:${Math.round((n / maxTag) * 100)}%;background:${tagColor(t, 0)}"></div></div>
            <div class="bar-val">${n}</div>
          </div>`).join('')}</div>` : `<p style="font-size:12px;color:var(--text-3)">还没有标签</p>`}
      </section>
    </div>

    <section class="panel" style="margin-top:12px">
      <div class="panel-head">
        <div class="panel-title">规则命中情况</div>
        <span class="spacer"></span>
        <button class="btn" data-act="go" data-view="rules">自定义规则 ${icon('arrow-right')}</button>
      </div>
      ${ruleRows.length ? `<div class="chips">${ruleRows.map(({ rule, count }) => `
        <span class="chip" style="cursor:default;background:${rule.style.bg};color:${rule.style.fg};border-color:${rule.style.bar}55">
          <span style="width:6px;height:6px;border-radius:2px;background:${rule.style.bar}"></span>${esc(rule.name)}
          <b style="font-size:11px;opacity:.7">${count}</b>
        </span>`).join('')}</div>`
      : `<p style="font-size:12px;color:var(--text-3)">暂时没有命中任何规则</p>`}
    </section>
  </div>`;
}

function statCard(label, value, hint, ico, color) {
  return `
  <div class="stat-card" style="--stat-color:${color}">
    <div class="stat-label">${icon(ico)}${esc(label)}</div>
    <div class="stat-value">${value}</div>
    <div class="stat-hint">${esc(hint)}</div>
  </div>`;
}

function feedItem(rec, now) {
  const rule = evalRules(rec, now);
  const st = rule ? resolveStyle(rule, rec, now) : null;
  const d = new Date(rec.due);
  return `
  <div class="feed-item" data-act="open-task" data-id="${esc(rec.id)}" style="cursor:pointer">
    <div class="feed-date"><b>${d.getDate()}</b><span>${weekdayCN(rec.due)}</span></div>
    <div class="feed-main">
      <div class="feed-title">${esc(rec.title)}</div>
      <div class="feed-sub">${[rec.status, rec.owner, rec.tags.join(' / ')].filter(Boolean).join(' · ') || '—'}</div>
    </div>
    ${st && st.badge ? `<span class="badge" style="--r-badge-bg:${st.badgeBg};--r-badge-fg:${st.badgeFg}">${esc(st.badge)}</span>` : ''}
  </div>`;
}

/* ========================================================================== */
/* 任务清单                                                                   */
/* ========================================================================== */

function demoBanner() {
  if (!state.source || state.source.kind !== 'demo') return '';
  return `
  <div class="callout" style="margin:0 0 14px;align-items:center;background:var(--accent-soft);color:var(--accent)">
    ${icon('sparkles')}
    <div style="flex:1">正在预览示例数据。导入你的飞书表格后，这里会换成真实任务。</div>
    <button class="btn sm primary" data-act="import">${icon('link')}导入表格</button>
  </div>`;
}

function bucketCounts() {
  const now = Date.now();
  const c = { all: 0, today: 0, week: 0, overdue: 0, undone: 0, done: 0 };
  const ws = startOfWeek(now, state.settings.weekStart);
  // 合并模式下按「内容」计数，和列表里的卡片数对得上
  const list = mergedMode() ? rowCardList({ ignoreBucket: true }) : state.records;
  c.all = list.length;
  list.forEach((r) => {
    if (r.done) { c.done++; return; }
    c.undone++;
    if (r.due == null) return;
    if (r.due < now) c.overdue++;
    if (sameDay(r.due, now)) c.today++;
    if (r.due >= now && r.due < ws + 7 * DAY) c.week++;
  });
  return c;
}

function activeFilterChips() {
  const out = [];
  state.filters.tags.forEach((t) => out.push(`<button class="chip active" data-act="tag" data-tag="${esc(t)}">${esc(t)} ${icon('x', 'sm')}</button>`));
  state.filters.statuses.forEach((s) => out.push(`<button class="chip active" data-act="status" data-status="${esc(s)}">${esc(s)} ${icon('x', 'sm')}</button>`));
  state.filters.priority.forEach((p) => out.push(`<button class="chip active" data-act="priority" data-priority="${esc(p)}">${esc(p)} ${icon('x', 'sm')}</button>`));
  return out;
}

function toolbar() {
  const c = bucketCounts();
  const f = state.filters;
  const activeFilters = activeFilterChips();
  const S = state.schedule || {};
  const chips = [
    ['all', '全部', c.all],
    ['today', '今天', c.today],
    ['week', '本周', c.week],
    ['overdue', '已逾期', c.overdue],
    ['undone', '未完成', c.undone],
    ['done', '已完成', c.done],
  ];
  const roleBar = S.enabled ? `
  <div class="toolbar" style="padding-top:0">
    <div class="chips">
      <button class="chip ${f.role === 'all' ? 'active' : ''}" data-act="role" data-role="all">全部角色</button>
      ${(S.roles || []).map((r) => `<button class="chip ${f.role === r.key ? 'active' : ''}" data-act="role" data-role="${esc(r.key)}">${esc(r.name)}</button>`).join('')}
      ${state.settings.myName ? `<button class="chip ${f.mine ? 'active' : ''}" data-act="mine">${icon('user', 'sm')}只看我的 · ${esc(state.settings.myName)}</button>` : ''}
    </div>
    <span class="spacer"></span>
    <span class="hint">档期基准 ${esc(S.baseDate || '—')}</span>
    <button class="chip" data-act="settings-schedule" title="设置档期与角色">${icon('settings', 'sm')}排期设置</button>
  </div>` : '';

  return `
  <div class="toolbar">
    <div class="chips">
      ${chips.map(([k, label, n]) => `<button class="chip ${f.bucket === k ? 'active' : ''}" data-act="bucket" data-bucket="${k}">${label}<span class="n">${n}</span></button>`).join('')}
    </div>
    <span class="spacer"></span>
    <select class="select" data-role="sort" title="排序方式">
      <option value="due" ${state.settings.sortBy === 'due' ? 'selected' : ''}>按截止时间</option>
      <option value="priority" ${state.settings.sortBy === 'priority' ? 'selected' : ''}>按优先级</option>
      <option value="title" ${state.settings.sortBy === 'title' ? 'selected' : ''}>按标题</option>
      <option value="status" ${state.settings.sortBy === 'status' ? 'selected' : ''}>按状态</option>
    </select>
    <button class="chip ${state.settings.showDone ? '' : 'active'}" data-act="toggle-done" title="是否在列表里显示已完成">
      ${state.settings.showDone ? '隐藏已完成' : '显示已完成'}
    </button>
  </div>
  ${roleBar}
  ${activeFilters.length ? `<div class="toolbar" style="padding-top:0"><div class="chips">${activeFilters.join('')}
    <button class="chip" data-act="clear-filters">清除筛选</button></div></div>` : ''}`;
}

/** 没选具体岗位时：一行内容一张卡，所有岗位摊在同一张卡上 */
function mergedMode() {
  return !!(state.schedule && state.schedule.enabled
    && Array.isArray(state.schedule.roles) && state.schedule.roles.length
    && (state.filters.role || 'all') === 'all'
    && Array.isArray(state.rowCards) && state.rowCards.length);
}

function viewTasks() {
  const merged = mergedMode();
  const list = merged ? rowCardList() : filteredRecords();
  const now = Date.now();
  const groups = [];
  const map = new Map();
  list.forEach((item) => {
    const key = item.done ? 'done' : bucketOf(item.due, now);
    if (!map.has(key)) { map.set(key, []); groups.push(key); }
    map.get(key).push(item);
  });
  const order = ['overdue', 'today', 'tomorrow', 'week', 'later', 'none', 'done'];
  const ordered = order.filter((k) => map.has(k));

  const body = ordered.length
    ? ordered.map((key) => {
      const b = key === 'done' ? BUCKETS.done : BUCKETS[key];
      const items = map.get(key);
      return `
        <section class="group">
          <div class="group-head" style="--g-color:${b.color}">
            <span class="group-dot"></span>
            <span class="group-title">${b.label}</span>
            <span class="group-count">${items.length}</span>
            <span class="group-line"></span>
          </div>
          <div class="task-list">${items.map((r) => (merged ? rowCard(r, now) : taskCard(r, now))).join('')}</div>
        </section>`;
    }).join('')
    : emptyState();

  return `<div class="view">${demoBanner()}${toolbar()}${body}</div>`;
}

/** 一个岗位的进度块：动作 · 李琰琰 · 10/24→10/31 */
function trackChip(rec, now) {
  const editable = canEdit(rec);
  const dates = rec.start != null && rec.due != null && rec.start !== rec.due
    ? `${fmtShort(rec.start, now)}→${fmtShort(rec.due, now)}`
    : rec.due != null ? fmtShort(rec.due, now) : (rec.done ? '完成' : '—');
  const cls = ['track', rec.done ? 'done' : '', editable ? 'mine' : '', rec.ownerless ? 'ownerless' : '']
    .filter(Boolean).join(' ');
  const attrs = editable
    ? ` data-act="toggle" data-id="${esc(rec.id)}" title="${rec.done ? '撤销完成' : '标记我的这块完成'}" role="button" tabindex="0"`
    : ` title="${esc(rec.roleName)}${rec.owner ? ' · ' + esc(rec.owner) : ''}"`;
  return `<span class="${cls}"${attrs}>
    <span class="track-role">${esc(rec.roleName)}</span>
    ${rec.owner ? `<span class="track-owner">${esc(rec.owner)}</span>` : ''}
    <span class="track-dates">${esc(dates)}</span>
    ${editable ? `<span class="track-check">${icon('check')}</span>` : ''}
  </span>`;
}

function rowCard(card, now) {
  const rec = card.dueRec;
  const rule = rec ? evalRules(rec, now) : null;
  const st = rule ? resolveStyle(rule, rec, now) : null;
  const cls = ['task', 'row-card', st ? 'has-rule' : '', card.done ? 'is-done' : ''].filter(Boolean).join(' ');
  const rel = relTime(card.due, now);
  const meta = [];

  meta.push(`<span class="due-chip">${icon('clock')}${card.due == null ? '未设截止' : esc(fmtDue(card.due, now))}</span>`);
  if (card.due != null && !card.done) meta.push(`<span class="rel ${rel.tone}">${esc(rel.text)}</span>`);
  if (card.phase) meta.push(`<span class="meta-sep">·</span><span class="tag" style="--tag-color:${tagColor(card.phase)}">${esc(card.phase)}</span>`);
  if (card.release) meta.push(`<span class="meta-sep">·</span><span class="release-chip">上线 ${esc(card.release)}</span>`);

  return `
  <article class="${cls}" data-row="${card.rowIndex}" style="${st ? styleVars(st) : ''}">
    <div class="task-main" data-act="open-row" data-row="${card.rowIndex}">
      <div class="task-head">
        <h3 class="task-title" title="${esc(card.title)}">${esc(card.title)}</h3>
        ${card.unplanned ? '<span class="badge ghost">未排期</span>' : ''}
        ${st && st.badge ? `<span class="badge">${esc(st.badge)}</span>` : ''}
        ${card.doneCount ? `<span class="badge ghost">${card.doneCount}/${card.recs.length} 完成</span>` : ''}
      </div>
      <div class="task-meta">${meta.join('')}</div>
      <div class="tracks">
        ${card.recs.length
          ? card.recs.map((r) => trackChip(r, now)).join('')
          : '<span class="track milestone"><span class="track-role">未排期</span><span class="track-dates">还没有人认领</span></span>'}
        ${card.milestones.map((m) => `<span class="track milestone"><span class="track-role">${esc(m.name)}</span><span class="track-dates">${esc(m.raw)}</span></span>`).join('')}
      </div>
    </div>
    <div class="task-side">
      <button class="icon-btn" data-act="open-row" data-row="${card.rowIndex}" title="详情">${icon('chevron-right')}</button>
    </div>
  </article>`;
}

/** 普通任务表没有「谁负责」的限制；排期表只让本人勾自己的块 */
function canToggle(rec) {
  return !(state.schedule && state.schedule.enabled) || canEdit(rec);
}

function taskCard(rec, now) {
  const rule = evalRules(rec, now);
  const st = rule ? resolveStyle(rule, rec, now) : null;
  const cls = ['task', st ? 'has-rule' : '', rec.done ? 'is-done' : ''].filter(Boolean).join(' ');
  const rel = relTime(rec.due, now);
  const hasOwn = Array.isArray(rec.reminders) && rec.reminders.length > 0;
  const snoozed = rec.snoozeUntil && rec.snoozeUntil > now;
  const meta = [];

  meta.push(`<span class="due-chip">${icon('clock')}${rec.due == null ? '未设截止' : esc(fmtDue(rec.due, now))}</span>`);
  if (rec.due != null && !rec.done) meta.push(`<span class="rel ${rel.tone}">${esc(rel.text)}</span>`);
  if (snoozed) meta.push(`<span class="tag">稍后提醒</span>`);
  if (rec.tags.length) {
    meta.push('<span class="meta-sep">·</span>');
    rec.tags.slice(0, 4).forEach((t, i) => {
      meta.push(`<span class="tag" style="--tag-color:${tagColor(t, i)}">${esc(t)}</span>`);
    });
  }
  if (rec.owner) {
    meta.push('<span class="meta-sep">·</span>');
    meta.push(`<span class="owner"><span class="avatar">${esc(initials(rec.owner))}</span>${esc(rec.owner)}</span>`);
  }

  return `
  <article class="${cls}" data-id="${esc(rec.id)}" style="${st ? styleVars(st) : ''}">
    ${canToggle(rec) ? `<button class="check" data-act="toggle" data-id="${esc(rec.id)}" aria-label="${rec.done ? '标记为未完成' : '标记完成'}" title="标记完成">
      ${icon('check')}
    </button>` : ''}
    <div class="task-main" data-act="open-task" data-id="${esc(rec.id)}">
      <div class="task-head">
        <h3 class="task-title" title="${esc(rec.title)}">${esc(rec.title)}</h3>
        ${st && st.badge ? `<span class="badge">${esc(st.badge)}</span>` : ''}
        ${rec.priority ? `<span class="badge neutral">${esc(rec.priority)}</span>` : ''}
        ${rec.status ? `<span class="badge ghost">${esc(rec.status)}</span>` : ''}
      </div>
      <div class="task-meta">${meta.join('')}</div>
      ${rec.note ? `<p class="task-note">${esc(rec.note)}</p>` : ''}
    </div>
    <div class="task-side">
      <button class="icon-btn ${hasOwn || snoozed ? 'on' : ''}" data-act="bell" data-id="${esc(rec.id)}" title="提醒设置">${icon('bell')}</button>
      <button class="icon-btn" data-act="open-task" data-id="${esc(rec.id)}" title="详情">${icon('chevron-right')}</button>
    </div>
  </article>`;
}

function emptyState() {
  const hasFilter = state.filters.q || state.filters.bucket !== 'all' || state.filters.tags.length
    || state.filters.statuses.length || state.filters.priority.length;
  return `
  <div class="empty">
    <div class="empty-icon">${icon(hasFilter ? 'filter' : 'inbox')}</div>
    <h3>${hasFilter ? '没有符合条件的任务' : '还没有任务'}</h3>
    <p>${hasFilter ? '试试换个筛选条件，或者清空搜索关键词。' : '从飞书表格导入任务，或者先看看示例数据。'}</p>
    <div class="actions">
      ${hasFilter ? `<button class="btn ghost" data-act="clear-filters">清除筛选</button>` : ''}
      <button class="btn primary" data-act="import">${icon('plus')}导入表格</button>
    </div>
  </div>`;
}

/* ========================================================================== */
/* 表格视图                                                                   */
/* ========================================================================== */

function viewTable() {
  const list = filteredRecords();
  const now = Date.now();
  const heads = state.table ? state.table.headers : [];
  const rows = list.map((rec) => {
    const rule = evalRules(rec, now);
    const st = rule ? resolveStyle(rule, rec, now) : null;
    const rel = relTime(rec.due, now);
    return `
    <tr class="${st ? 'has-rule' : ''} ${rec.done ? 'row-done' : ''}" style="${st ? styleVars(st) : ''}" data-act="open-task" data-id="${esc(rec.id)}">
      <td class="col-check"><button class="check" data-act="toggle" data-id="${esc(rec.id)}" aria-label="完成">${icon('check')}</button></td>
      <td><div class="cell-title">${st && st.badge ? `<span class="badge" style="flex:none">${esc(st.badge)}</span>` : ''}<span>${esc(rec.title)}</span></div></td>
      <td><div class="cell-tags">${rec.tags.map((t, i) => `<span class="tag" style="--tag-color:${tagColor(t, i)}">${esc(t)}</span>`).join('') || '<span class="muted-cell">—</span>'}</div></td>
      <td>${rec.status ? esc(rec.status) : '<span class="muted-cell">—</span>'}</td>
      <td class="num">${rec.due != null ? esc(fmtShort(rec.due, now)) : '<span class="muted-cell">—</span>'}</td>
      <td class="num"><span class="rel ${rel.tone}">${rec.due != null && !rec.done ? esc(rel.text) : '—'}</span></td>
      <td>${rec.owner ? esc(rec.owner) : '<span class="muted-cell">—</span>'}</td>
      <td class="muted-cell">${esc(rec.note || '')}</td>
    </tr>`;
  }).join('');

  return `
  <div class="view">
    ${demoBanner()}
    ${toolbar()}
    ${list.length ? `
    <div class="table-wrap">
      <table class="data">
        <thead><tr>
          <th class="col-check"></th><th>任务</th><th>标签</th><th>状态</th><th>截止</th><th>剩余</th><th>负责人</th><th>备注</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p style="font-size:11px;color:var(--text-3);margin:10px 2px">共 ${list.length} 行 · 原始列：${heads.map((h) => esc(h)).join(' / ')}</p>` : emptyState()}
  </div>`;
}

/* ========================================================================== */
/* 日历                                                                       */
/* ========================================================================== */

function viewCalendar() {
  const now = Date.now();
  const y = calCursor.getFullYear();
  const m = calCursor.getMonth();
  const first = new Date(y, m, 1);
  const start = startOfWeek(first.getTime(), 1);
  const list = filteredRecords({ ignoreBucket: true }).filter((r) => r.due != null);
  const byDay = new Map();
  list.forEach((r) => {
    const key = startOfDay(r.due);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(r);
  });

  const cells = [];
  for (let i = 0; i < 42; i++) {
    const ts = addDays(start, i);
    const d = new Date(ts);
    const other = d.getMonth() !== m;
    const items = (byDay.get(ts) || []).sort((a, b) => a.due - b.due);
    const shown = items.slice(0, 3);
    cells.push(`
      <div class="cal-cell ${other ? 'other' : ''} ${sameDay(ts, now) ? 'today' : ''}">
        <div class="cal-date">${d.getDate()}</div>
        <div class="cal-items">
          ${shown.map((r) => {
    const rule = evalRules(r, now);
    const st = rule ? resolveStyle(rule, r, now) : null;
    return `<button class="cal-chip ${r.done ? 'done' : ''}" style="${st ? styleVars(st) : ''}" data-act="open-task" data-id="${esc(r.id)}" title="${esc(r.title)}">${esc(r.title)}</button>`;
  }).join('')}
          ${items.length > 3 ? `<span class="cal-more">+${items.length - 3} 项</span>` : ''}
        </div>
      </div>`);
  }

  const dows = ['一', '二', '三', '四', '五', '六', '日'];
  return `
  <div class="view">
    <div class="cal-month">
      <h2>${y} 年 ${m + 1} 月</h2>
      <span>${list.length} 项有截止时间的任务</span>
      <span class="spacer" style="flex:1"></span>
      <div class="seg">
        <button data-act="cal-prev" title="上个月">${icon('chevron-left', 'sm')}</button>
        <button data-act="cal-today">今天</button>
        <button data-act="cal-next" title="下个月">${icon('chevron-right', 'sm')}</button>
      </div>
    </div>
    <div class="cal-grid">
      ${dows.map((d) => `<div class="cal-dow">周${d}</div>`).join('')}
      ${cells.join('')}
    </div>
  </div>`;
}

/* ========================================================================== */
/* 规则中心                                                                   */
/* ========================================================================== */

function viewRules() {
  const now = Date.now();
  const hit = new Map();
  state.records.forEach((rec) => {
    const r = evalRules(rec, now);
    if (r) hit.set(r.id, (hit.get(r.id) || 0) + 1);
  });
  const rows = state.rules.map((rule) => {
    const st = rule.style || {};
    const count = hit.get(rule.id) || 0;
    const sample = resolveStyle(rule, sampleRecord(), now);
    return `
    <div class="rule-card ${rule.enabled ? '' : 'disabled'}" data-rule="${esc(rule.id)}">
      <div class="rule-swatch" style="--r-bg:${st.bg};--r-fg:${st.fg};--r-bar:${st.bar || st.bg}"></div>
      <div class="rule-main">
        <div class="rule-name"><span class="dot" style="background:${st.bar || st.bg}"></span>${esc(rule.name)}
          ${rule.enabled ? '' : '<span class="badge ghost">已停用</span>'}
          <span class="badge neutral">${count}</span>
        </div>
        <div class="rule-cond">当 <b>${esc(describeRule(rule, state.table ? state.table.headers : []))}</b></div>
      </div>
      <div class="rule-sample" style="--r-bg:${st.bg};--r-fg:${st.fg};--r-bar:${st.bar || st.bg};border-color:${(st.bar || '#ccc')}55">
        <b>${esc(sample.badge || rule.name)}</b>
        <span>${esc(st.strike ? '划掉 + 置灰' : '背景 / 左边条 / 徽章')}</span>
      </div>
      <div class="rule-actions">
        <button class="icon-btn" data-act="rule-up" data-id="${esc(rule.id)}" title="上移">${icon('chevron-down', 'sm')}</button>
        <button class="icon-btn" data-act="rule-down" data-id="${esc(rule.id)}" title="下移">${icon('chevron-down', 'sm')}</button>
        <button class="icon-btn" data-act="rule-toggle" data-id="${esc(rule.id)}" title="${rule.enabled ? '停用' : '启用'}">${icon(rule.enabled ? 'check-circle' : 'play')}</button>
        <button class="icon-btn" data-act="rule-edit" data-id="${esc(rule.id)}" title="编辑">${icon('edit')}</button>
        <button class="icon-btn" data-act="rule-del" data-id="${esc(rule.id)}" title="删除">${icon('trash')}</button>
      </div>
    </div>`;
  }).join('');

  return `
  <div class="view">
    <div class="rules-head">
      <div>
        <div style="font-size:13px;font-weight:600">自动配色规则</div>
        <div style="font-size:11.5px;color:var(--text-3)">命中第一条规则后停止匹配，顺序即优先级。</div>
      </div>
      <span class="spacer"></span>
      <button class="btn ghost" data-act="rule-reset">恢复默认</button>
      <button class="btn primary" data-act="rule-new">${icon('plus')}新建规则</button>
    </div>
    <div class="rule-list">${rows || emptyRules()}</div>
    <div class="rules-note">
      ${icon('info')}
      <div>规则可以组合多个条件（且 / 或），支持「剩余时间」「截止日期」「状态」「标签」以及表格里的任意一列。
      已完成的项会被最上面的「已完成」规则接管，所以不会被标成逾期。</div>
    </div>
  </div>`;
}

function emptyRules() {
  return `<div class="empty"><div class="empty-icon">${icon('rules')}</div><h3>还没有规则</h3><p>新建一条规则，给临近 DDL 的任务自动上色。</p></div>`;
}

/* ========================================================================== */
/* 工具                                                                       */
/* ========================================================================== */

const TAG_COLORS = ['#7F56D9', '#F79009', '#12B76A', '#2E90FA', '#EE46BC', '#667085', '#F04438', '#0E9384', '#6172F3'];
export function tagColor(tag, i = 0) {
  let h = 0;
  for (let k = 0; k < tag.length; k++) h = (h * 31 + tag.charCodeAt(k)) | 0;
  return TAG_COLORS[Math.abs(h + i) % TAG_COLORS.length];
}

function updateBell() {
  const dot = document.getElementById('bellDot');
  if (!dot) return;
  const now = Date.now();
  const soon = state.records.some((r) => !r.done && r.due != null && r.due - now < 2 * HOUR);
  dot.hidden = !soon;
}

/* ========================================================================== */
/* 事件                                                                       */
/* ========================================================================== */

export function initUI() {
  if (inited) return;
  inited = true;

  document.getElementById('nav').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    setView(b.dataset.view);
    render();
  });

  document.getElementById('sideSource').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'import') { panels.openImport(); return; }
    if (act === 'import-new') { panels.openImport({ asNew: true }); return; }
    if (act === 'sync') { window.__syncNow && window.__syncNow(); return; }
    if (act === 'source-switch') {
      if (switchSource(b.dataset.id)) {
        render();
        // 默认只用本地缓存；开了「切换时自动同步」才去读表
        const src = state.source;
        if (state.settings.syncOnSwitch && src && src.kind === 'feishu' && src.url) {
          window.__syncNow && window.__syncNow();
        }
      }
      return;
    }
    if (act === 'source-remove') {
      e.stopPropagation();
      if (removeSource(b.dataset.id)) {
        toast({ type: 'ok', title: '已移除这个数据源' });
        render();
      }
    }
  });

  document.getElementById('sideTags').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'tag') toggleTag(b.dataset.tag);
    if (b.dataset.act === 'phase') { setFilter({ phase: b.dataset.phase || '' }); render(); }
    if (b.dataset.act === 'clear-tags') { setFilter({ tags: [] }); render(); }
  });

  document.getElementById('sideFoot').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b && b.dataset.act === 'settings') panels.openSettings();
  });

  document.getElementById('viewRoot').addEventListener('click', onViewClick);
  document.getElementById('viewRoot').addEventListener('change', onViewChange);

  document.getElementById('btnRefresh').addEventListener('click', () => window.__syncNow && window.__syncNow());
  document.getElementById('btnUpdate').addEventListener('click', () => panels.openUpdate());
  document.getElementById('btnBell').addEventListener('click', () => panels.openReminders());
  document.getElementById('btnSettings').addEventListener('click', () => panels.openSettings());
  document.getElementById('btnImport').addEventListener('click', () => panels.openImport());

  const search = document.getElementById('searchInput');
  let timer = 0;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      setFilter({ q: search.value });
      render({ keepScroll: true });
    }, 140);
  });

  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { search.value = ''; setFilter({ q: '' }); render(); search.blur(); }
  });
}

function toggleTag(tag) {
  const cur = state.filters.tags;
  // TAG_MULTI_SELECT=false：选哪个看哪个，再点一次取消；=true 恢复多选叠加
  const tags = TAG_MULTI_SELECT
    ? (cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag])
    : (cur.length === 1 && cur[0] === tag ? [] : [tag]);
  setFilter({ tags });
  render({ keepScroll: true });
}

function onViewClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  const id = b.dataset.id;

  switch (act) {
    case 'open-task': panels.openTask(id); break;
    case 'open-row': panels.openRow(Number(b.dataset.row)); break;
    case 'toggle': e.stopPropagation(); toggleDone(id); render({ keepScroll: true }); break;
    case 'bell': e.stopPropagation(); panels.openTask(id, { focusReminder: true }); break;
    case 'go': setView(b.dataset.view); render(); break;
    case 'bucket': setFilter({ bucket: b.dataset.bucket }); render({ keepScroll: true }); break;
    case 'role': setFilter({ role: b.dataset.role }); render({ keepScroll: true }); break;
    case 'mine': setFilter({ mine: !state.filters.mine }); render({ keepScroll: true }); break;
    case 'settings-schedule': panels.openSettings('mapping'); break;
    case 'tag': toggleTag(b.dataset.tag); break;
    case 'status': {
      const s = b.dataset.status;
      setFilter({ statuses: state.filters.statuses.includes(s) ? state.filters.statuses.filter((x) => x !== s) : [...state.filters.statuses, s] });
      render({ keepScroll: true });
      break;
    }
    case 'priority': {
      const p = b.dataset.priority;
      setFilter({ priority: state.filters.priority.includes(p) ? state.filters.priority.filter((x) => x !== p) : [...state.filters.priority, p] });
      render({ keepScroll: true });
      break;
    }
    case 'clear-filters': {
      resetFilters();
      const s = document.getElementById('searchInput');
      if (s) s.value = '';
      render();
      break;
    }
    case 'toggle-done': {
      state.settings.showDone = !state.settings.showDone;
      save();
      render({ keepScroll: true });
      break;
    }
    case 'import': panels.openImport(); break;
    case 'import-new': panels.openImport({ asNew: true }); break;
    case 'source-switch': {
      if (switchSource(b.dataset.id)) render();
      break;
    }
    case 'source-remove': {
      e.stopPropagation();
      if (removeSource(b.dataset.id)) {
        toast({ type: 'ok', title: '已移除这个数据源' });
        render();
      }
      break;
    }
    case 'rule-new': panels.openRuleEditor(null); break;
    case 'rule-edit': panels.openRuleEditor(id); break;
    case 'rule-toggle': {
      const r = state.rules.find((x) => x.id === id);
      if (r) { r.enabled = !r.enabled; save(); render({ keepScroll: true }); }
      break;
    }
    case 'rule-del': {
      const r = state.rules.find((x) => x.id === id);
      if (r) {
        panels.confirmDeleteRule(r).then((ok) => {
          if (!ok) return;
          state.rules = state.rules.filter((x) => x.id !== id);
          save();
          toast({ type: 'ok', title: '规则已删除', text: `「${r.name}」不再生效` });
          render({ keepScroll: true });
        });
      }
      break;
    }
    case 'rule-up':
    case 'rule-down': {
      const i = state.rules.findIndex((x) => x.id === id);
      const j = act === 'rule-up' ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= state.rules.length) return;
      const arr = [...state.rules];
      [arr[i], arr[j]] = [arr[j], arr[i]];
      state.rules = arr;
      save();
      render({ keepScroll: true });
      break;
    }
    case 'rule-reset': {
      panels.confirmResetRules().then((ok) => {
        if (!ok) return;
        state.rules = JSON.parse(JSON.stringify(DEFAULT_RULES));
        save();
        toast({ type: 'ok', title: '已恢复默认规则' });
        render({ keepScroll: true });
      });
      break;
    }
    case 'cal-prev': calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() - 1, 1); render(); break;
    case 'cal-next': calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 1); render(); break;
    case 'cal-today': calCursor = new Date(); render(); break;
    default: break;
  }
}

function onViewChange(e) {
  const el = e.target.closest('[data-role]');
  if (!el) return;
  if (el.dataset.role === 'sort') {
    state.settings.sortBy = el.value;
    save();
    render({ keepScroll: true });
  }
}


