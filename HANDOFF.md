# 交接文档 · 日程舱（ScheduleDeck）

> 这份文档**持续更新**。规则见文末「文档迭代规则」。
> 最后更新：2026-10-21 · 会话 #19

## 1. 项目位置

| 用途 | 路径 |
| --- | --- |
| 源码 / Git 仓库 | `A:\大肥鱼工作区\版本管理\日程舱` |
| 远程 | https://github.com/JJDJR123/SCHEDULEDECK （**必须 Private**） |
| 成品（单文件 exe） | `A:\大肥鱼工作区\打包成品\日程舱.exe` |
| 旧工作副本 | `A:\大肥鱼工作区\schedule-deck`（以 Git 仓库为准，逐步废弃） |

## 2. 常用命令

```powershell
cd A:\大肥鱼工作区\版本管理\日程舱
node server.js --open                     # 开发运行 http://127.0.0.1:17890
powershell -File build\build-single.ps1   # 打包单文件，自动定位「打包成品」目录
git add -A; git commit -m "..."; git push
```

- **成品目录**：脚本从仓库往上逐级找现成的 `打包成品\`（当前 = `A:\大肥鱼工作区\打包成品`），找不到才回退到仓库上一级；也可 `-OutDir <路径>` 指定。
- **中间产物** `dist\日程舱\` 现在在**仓库内**（已 gitignore），不再写到仓库外面。
- 打包前必须关闭正在运行的 `日程舱.exe`（build 脚本会检测占用并报错）。注意启动器与 node 子进程互不联动：杀掉启动器后 node 会残留并继续服务旧快照（随机端口），要一并结束，否则会留下"幽灵服务"。

## 3. 架构

- **server.js**：本地 HTTP（随机端口 + 固定 OAuth 回调端口 17899）、静态页、`/api/state`、`/api/import`、`/api/sync`、`/api/oauth/*`、`/api/shutdown`；单文件 exe 时内嵌 **Payload.zip**，启动自解压到 `%LOCALAPPDATA%\ScheduleDeck\app-<stamp>\`
- **feishu.js**：tenant token、用户 OAuth（v3 优先、v2 回退）、wiki `get_node`、sheets v2 读值、bitable search、错误码中文化、表头识别（两行表头/无表头）
- **web/js/store.js**：状态、数据导入、字段映射、**排期识别**、记录生成、持久化（localStorage + `/api/state`）
- **web/js/ui.js**：侧栏、列表/表格/日历/规则视图、筛选
- **web/js/panels.js**：任务详情、规则编辑器、设置、导入弹窗（扫码登录 / 应用凭证 / 粘贴 / 示例）
- **launcher/Program.cs**：WinForms 托盘 + Chrome/Edge `--app` 窗口；有内嵌 payload 时自解压
- **build/**：`make-icon.ps1`、`build.ps1`（文件夹版）、`build-single.ps1`（单文件版）

## 4. 飞书接入

- **扫码登录（推荐）**：`http://127.0.0.1:17899/callback` 已注册；scope：`offline_access`、`sheets:spreadsheet:readonly`、`wiki:wiki:readonly`、`bitable:app:readonly`
- 用户身份：**杨浩源**（`data/oauth.json`，约 2 小时 access / 30 天 refresh，自动刷新）
- 当前应用：App ID `cli_aa5276c66d78dc10`，Secret 已写入 `server.js` 的 `DEFAULT_APP_ID/SECRET`（**泄露风险：不要公开仓库/外发 exe**）
- 源表：`总制作排期`（sheet `REDACTED_SHEET1`）与 `秘术排期`（`REDACTED_SHEET2`），同属 wiki 节点 `REDACTED_WIKI`

## 5. 排期模式（当前核心）

`detectSchedule()` 自动识别：内容列、期数列、上线日列，以及「负责人列 + 日期列」重复出现的角色组。

总制作排期实测：48 行 × 3 角色 = 104 条角色任务

| 角色 | 负责人 | 日期列 | 截止取 |
| --- | --- | --- | --- |
| 动作 | 动作负责人 | 动作开始 / 动作完成 | 动作完成 |
| 特效 | 特效负责人 | 特效开始 / 特效完成 | 特效完成 |
| 策划 | 策划负责人 | 配置完成 / 音效… / 收尾验收 | 收尾验收 |

- **岗位识别**：先按「XX负责人」列起岗位，再按表头语义把日期列分给对应岗位（`subjectOf` + `SUBJECT_ALIAS`）。`配置完成 → 策划`、`音效/图标 → 音效`（无负责人列，独立岗位）、`模型/原画/角色需求/收尾验收 → 里程碑`（只上卡片，不算岗位）。识别算法版本 `DETECT_VERSION = 3`
- **卡片合并**：岗位选「全部角色」时，一行内容一张卡（`rowCardList` / `rowCard`），动作·特效·策划·音效 + 里程碑全摊在卡上；左侧**没有勾选框**，只有自己负责的那块可点（`canEdit`，按 OAuth 姓名匹配负责人），别人的块只读
- **筛选交互**：侧栏「档期 / 角色」标签是**单选**（选哪个看哪个，再点一次取消）。多选代码保留着，`store.js` 里把 `TAG_MULTI_SELECT` 改成 `true` 就切回去
- **负责人向下填充**：合并单元格只有左上角有值，`settings.fillDown`（默认开）会把上一行的负责人顺延下来；整行一个人都没排的（黄忠、魏延这种）不填，避免凭空长出负责人。在「排期设置」里可以关
- **未排期卡**：一行完全没排岗位时也出一张卡，标「未排期」，落在「无截止」分组
- **手动选列**：设置 → 字段映射里可以手动指「内容 / 期数 / 上线日」三列，每个岗位还能改负责人列、点选它用哪几列当日期（最后一个日期列不让关）。改完立即生效并落盘，`DETECT_VERSION` 不变（不是重新识别，是直接改 `state.schedule`）
- 日期补年：`settings` 里的档期基准日（默认今天），`M月D日` 落在 [基准-30天, 基准+335天)，跨年自动切换，**不改表格**
- **角色名从表头取**（`roleName()`）：`策划负责人 → 策划`、`特效负责人 → 特效`；取不到才退回「角色 N」。以前是按出现顺序硬套 `['动作','特效','策划']`，所以「秘术排期」（策划组排在最前）的第一组会被叫成「动作」，策划直接消失
- 旧存档的角色名靠 `schedule.v`（`DETECT_VERSION`）在 `loadState` 时自动重算一次，保留用户设的档期基准日
- 「只看我的」按 OAuth 姓名匹配负责人列（合并单元格只返回左上角，暂无向下填充）
- 期数已从 tags 拆出为独立「档期」列表（侧栏），点击筛选
- 表头识别优先含「负责人/开始/完成/时间/周期/验收」的行；第一行含 ≥2 日期视为无表头

## 6. 自动更新

发布一次新版本：

1. `powershell -File build\build-single.ps1` 打包
2. 把 `打包成品\日程舱.exe` 传到存储（私有 GitHub Release、OSS、任意能直链的地址都行）
3. `powershell -File build\make-manifest.ps1 -Exe <exe路径> -Url <下载地址> -Notes "这次改了什么"` → 生成 `latest.json`（version / stamp / url / sha256 / size / notes）
4. 用这个 `latest.json` 覆盖「更新地址」指向的文件

客户端这边：

- 设置 → 外观与数据 → **自动更新**，填 `latest.json` 的网址（留空 = 不检查；保存时会同步写进 `data/update.json` 给启动器读）
- 托盘右键「**检查更新…**」手动查；开了自动更新的话启动 40 秒后查一次，之后每小时一次
- 新旧判断用 exe 内嵌的 `Stamp.txt`（打包时间戳，单调递增），不依赖语义化版本号
- 流程：弹窗确认 → 下载到 `%TEMP%` → **校验 sha256** → 写一个 bat → 程序退出 → bat 等进程退出 → 备份 `日程舱.exe.bak` → 替换 → 重启
- `--auto-update` 参数可跳过确认直接装（无人值守 / 自测用）
- 更新日志在 `data/update.log`

## 7. 数据与凭证

| 文件 | 内容 |
| --- | --- |
| `data/state.json` | **多数据源**：`state.sources[]`（每条 = `{id, meta, table, mapping, schedule}`）+ `activeId`，另有完成状态、规则、设置 |
| `data/config.json` | App ID/Secret、**最近一次使用的表 URL**、mode（oauth/feishu） |
| `data/oauth.json` | 用户 token（**敏感**） |

- 侧栏「数据源」是卡片列表：点非当前那条即切换，`＋` 新增一条，`×` 移除；当前那条才有「同步 / 更换」。
- `state.table/source/mapping/schedule` 只是**当前那条的镜像**，`flushActive()` 负责写回；`serialize()` 前会自动 flush。
- 记录 id 带数据源前缀（`srcxxxx|s12:r1`），所以完成状态、提醒在不同表之间不会串。
- 老存档（只有单张 `table`）在 `loadState` 里会自动迁移成一条数据源。
- `/api/sync` 由前端带上 `url`，同步的就是当前这条，不会同步成「上次导入的那张表」。

单文件版优先把 `data` 放在 exe 同级，不可写则回落 `%LOCALAPPDATA%\ScheduleDeck\data`。

## 8. 已知问题 / 待办

- [ ] 方案 B 自动更新：私有 GitHub 源码 + 私有对象存储 `latest.json`（version/url/sha256），每小时检查、校验后退出替换重启
- [ ] 档期异常格式（S1、第一赛季）归一；「全部/多选」的切回开关已有（`TAG_MULTI_SELECT`）
- [ ] 行数超 5000 截断、超大表分批读取
- [ ] 启动器 / node 生命周期联动：node 意外退出时启动器没感知（不提示、不重启）；反向强杀启动器会留下孤儿 node

## 9. 血泪教训

1. **禁止用 Windows PowerShell 5.1 的 `Get-Content`/`Set-Content` 批量改源码**：UTF-8 无 BOM 会被按 GBK 读，中文变 `?` 且不可逆。只能用 `edit` 工具或 Node `fs.readFileSync(p,'utf8')`。
2. 编辑 `build/*.ps1` 后需补 UTF-8 **BOM**，否则 Windows PowerShell 解析中文失败。
3. 改 `web/js` 后必须重新打包，exe 内是快照；用户看到的永远是 exe 里的版本。
4. **`edit` 工具会丢掉 `build/*.ps1` 的 UTF-8 BOM**：改完立刻用 `.NET` 写回带 BOM 的 UTF-8（`New-Object System.Text.UTF8Encoding($true)`），否则中文解析失败（见第 2 条）。
5. **打包脚本别按「仓库上一级」写死输出目录**：仓库从 `A:\大肥鱼工作区\schedule-deck` 搬到 `版本管理\日程舱` 后，exe 一度悄悄落到 `版本管理\打包成品`，用户点开的还是旧 exe。现在改成向上逐级找现成的 `打包成品`。
6. **验 exe 内容不要只看时间戳**：用 `[Reflection.Assembly]::LoadFile($exe)` + `GetManifestResourceStream('Payload.zip')` 解出内嵌包，比对 `web/js/*.js`、`server.js` 的 SHA256，能一眼看出 exe 是不是旧快照。
7. 关 / 开 exe 的姿势：进程名 `日程舱.exe`，node 子进程父进程是它、端口写在 `data\port.txt`；`POST /api/shutdown` 只关 node，启动器不会自己退。
8. **`loadState` 里要 `save()`，必须等所有字段都恢复完之后**：`save()` 序列化的是当前内存状态，若在 `state.overrides`/`settings` 还没从存档赋值时调用，会把空值写回磁盘（#20 踩过：重算角色时顺手保存，把完成状态清空，幸好当时没勾过）。

## 10. 文档迭代规则

- 本文超过 ~300 行，或话题发生代际变化（如更新器上线）时，新建 `HANDOFF-<序号>-<主题>.md`
- 新文档开头保留：项目路径、当前版本、上一份文档链接、**未完成事项**
- 旧文档不删除，只在其顶部标注「已被 XXX 取代」
- 每次重要改动后追加到「变更记录」并 commit

## 11. 变更记录

- 2026-10-22：#28 修「点调色盘/选文件后小窗口自己关掉」：原生弹窗关掉时 Windows 会把那次点击重放给页面，砸在遮罩上就触发关闭。现在遮罩要求「按下也在遮罩上」才算点外面，且原生弹窗前后 0.9 秒内屏蔽关闭与 Esc
- 2026-10-22：#27 同步失败排查：`/api/sync` 出错时写日志（`server.log` 里的 `[sync] 失败 ...`），前端失败自动重试一次、提示里带错误码；新增**自动更新**（manifest + sha256 + 备份替换重启、托盘「检查更新…」、每小时检查、`--auto-update`），配套 `build/make-manifest.ps1`
- 2026-10-22：#26 「自己负责的那块」卡片上色：`settings.myColor`（默认 #5B5BF0），设置 → 外观与数据里有 8 个预设色 + 自定义取色器；颜色通过 CSS 变量 `--my-color` 落到 `.track.mine`
- 2026-10-22：#25 修侧栏数据源按钮点了没反应（`+` / 切源 / 删除 的 data-act 只挂在主区域监听上，侧栏没接）；修 `openImport({asNew})` 被当成 tab 参数（加号打开的是「示例」页且不会新建源）；二次启动 exe 不再丢给默认浏览器——先聚焦已有应用窗口，没有才新开 `--app` 窗口；设置里加「在浏览器中打开」（`/api/open-browser`）；新增 `settings.syncOnSwitch`（默认关，切源只用缓存）
- 2026-10-22：#24 多数据源（`state.sources[]` + `activeId`，侧栏卡片切换/新增/移除；记录 id 带数据源前缀；老存档自动迁移）；`/api/sync` 改为前端传 url，避免同步成上次导入的那张表
- 2026-10-22：#23 手动选列（内容/期数/上线日 + 每个岗位的负责人列、日期列），在设置→字段映射里；最后一个日期列不让关
- 2026-10-22：#22 侧栏档期/角色标签改单选（`TAG_MULTI_SELECT=false`，多选代码保留）；合并单元格负责人向下填充（`settings.fillDown`，整行空的不填）；未排期的行也出卡
- 2026-10-21：#21 任务卡合并（一行内容一张卡，摊开动作/特效/策划/音效+里程碑）；岗位归属改按表头语义（配置完成→策划、音效独立岗位、验收/模型/原画当里程碑）；去掉左侧勾选框，只允许勾自己负责的块（`canEdit`）；新增「一行详情」抽屉 `openRow`
- 2026-10-21：#20 角色名改为从「负责人」表头取（以前按出现顺序硬套 动作/特效/策划，「秘术排期」的策划组被叫成「动作」，策划就此消失）；加 `DETECT_VERSION` 让旧存档自动重算角色；修 `loadState` 保存过早会把空 `overrides` 写回磁盘的 bug
- 2026-10-21：#19 修正打包输出目录（此前 exe 落到 `版本管理\打包成品`，用户跑的是旧版）；`dist\` 移回仓库内；补 BOM；重打 exe 并启动验证（`/api/state` 200，快照哈希与源码一致）
- 2026-10-21：#18 修 phase 混入 tags；建立本交接文档；仓库首推
- 2026-10-21：#17 单文件 exe、OAuth 扫码、内置凭证、表头识别修复、排期模式
