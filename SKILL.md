---
name: dolphinscheduler-ops
description: "通过 DolphinScheduler REST API 查询和操作资源、工作流定义、实例与任务；涵盖当前部署 SQL 全局变量解析、假成功排障、工作流发布/修改/删除和重跑。先确认服务端版本与实际 API。"
---

# DolphinScheduler 运维操作

## 当前目标部署版本

截至 2026-11-20，对用户指定的 DS 部署只读请求 `/v3/api-docs` 返回 HTTP 200，`info.version=3.2.0`，共 273 条 API 路径。故本 skill 的目标部署接口参考与 3.2.0 对齐；本地 `ds_ops.mjs` 和 `check_workflow.py` 均按 3.2.0 契约实现。操作时仍需重新读取目标 OpenAPI，避免服务升级或定制构建导致漂移。此版本核验不包含登录，不证明身份/权限，也未读取或修改用户指定的工作流页面。出于安全，不在公开仓库记录部署地址或工作流 ID。

## 能力模型：登录、查询、变更、验收

本 skill 是操作规程和工具路由，不等于 DS 连接器本身。连接能力来自当前会话实际可用的 DS MCP/API 工具或本仓库 CLI。开始时先盘点可用工具；没有 DS 工具且本地没有安全配置的 CLI 时，明确说明只能基于脱敏资料分析，不得声称已登录或已操作。登录前校验 `DS_URL`、凭据来源和目标部署；调用 `/v3/api-docs` 取得版本、认证契约和 operationId。未知版本/API 默认只读探测，不执行写入。

将具体能力视为以下四类：

1. **读取与诊断**：项目、用户权限（限接口可见范围）、资源、工作流定义/版本/任务/依赖、调度、实例、任务状态和分页日志；支持结构检查、参数追踪、父子实例追踪、失败根因归类。只输出完成判断所需的脱敏字段。
2. **草拟与预览**：生成 SQL/任务参数/DAG/调度变更，显示目标 code、变更前后差异、影响工作流与实例、预计状态变化；支持 dry-run，不产生 DS 状态改变。
3. **受控写入**：在明确用户授权的对象、动作和范围内保存资源/任务/定义、发布或下线、创建/修改调度、启动/重跑/暂停/恢复实例。授权必须涵盖具体动作；“登录”“检查”“修复”等泛化表达不自动覆盖发布、运行或删除。
4. **写后验收**：重新读取定义/资源/调度/实例，核对版本、状态、关系、关键参数及业务验收证据；区分请求已接受、配置已保存、实例已启动、任务已成功和业务数据正确。

登录优先级：独立 API Token（`DS_TOKEN`，请求头 `token`）→ 专用服务账号密码 → 交互用户账号。使用 Token 时不要调用 `/login` 或 `/signOut`，避免影响网页会话。CLI 的 CookieJar 本身与浏览器隔离，但 DS 服务端可能因同账号新登录而使既有会话失效；具体会话策略未从部署端配置核实。不得用用户当前网页账号自动登录。Token 只从受保护连接器秘密或环境变量取值，不能要求用户贴入对话；不得回显 Cookie、Token、密码、Webhook、数据源口令。创建/轮换 Token 是权限敏感写操作，不由 skill 自动执行。

## 统一写操作门禁

任何非只读动作按此顺序：目标身份和授权范围 → 实时状态与完整分页查询 → 影响面和活动实例检查 → 可恢复基线/备份 → 字段级差异与 dry-run → 执行一次 → 重新读取验收。任一环节目标不唯一、分页不完整、版本/API 不匹配、活动任务冲突、回滚基线缺失或响应含糊时停止。写失败后先回读确认是否部分成功；禁止盲目重试。高影响动作（启动、补数、重跑、强制成功、跳过失败节点、调度上线、删除）必须核实用户授权覆盖该精确动作和目标。不能以“AI 已确认”代替授权。

恢复基线要覆盖实际受影响对象：定义版本、任务参数、资源引用、发布状态、调度 Cron/时区/告警/失败策略。若无法可靠恢复，不执行状态切换。并发修改或读取期间版本发生变化，停止并重新生成预览。

## 连接器/MCP 兼容策略

社区项目 [iflytek/dolphin-mcp-pilot](https://github.com/iflytek/dolphin-mcp-pilot) 在 Apache DolphinScheduler 社区讨论中公开介绍，涵盖项目、工作流、调度、实例、资源、监控等类别；其 Release 页面列出 3.x 兼容声明和版本化容器。它是可评估的外接 MCP 候选，不是 Apache 官方内置功能，也不代表本 skill 已安装/连接。接入前检查固定版本/镜像摘要、源代码与许可证、认证方式、租户隔离、工具实际 schema、任意 HTTP/raw API 能力、日志脱敏、请求超时/重试以及写操作授权门禁；默认关闭 raw POST/PUT/DELETE 和危险工具，按需开放最小集合。版本兼容声明须在目标 DS 的 `/v3/api-docs` 和只读调用中验证。

MCP 工具名称或参数与 skill/CLI 不一致时，以已连接服务器工具 schema 和 DS OpenAPI 为准；不得猜字段或把某社区 MCP 的工具能力宣称为本地可用能力。若连接器支持过宽权限，skill 仍执行上述流程，并在具体写入前确认授权。

## 技能来源与反馈

本 skill 的规范源和更新入口是 [GitHub 仓库](https://github.com/Ice-Pure-Water/dolphinscheduler-ops)。在其他环境使用时发现错误或需要改进，可直接通过 [Issues](https://github.com/Ice-Pure-Water/dolphinscheduler-ops/issues/new) 报告，或从 GitHub 网页创建分支并提交 [Pull Request](https://github.com/Ice-Pure-Water/dolphinscheduler-ops/pulls)；无需访问本机项目副本。合并到 `main` 的内容是后续安装和同步的来源。

反馈请注明 skill 提交版本、DolphinScheduler 版本、相关 OpenAPI `operationId`、复现步骤和脱敏结果。不要提交密码、令牌、Webhook、内网地址、未脱敏 SQL 参数或原始日志。

优先使用 REST API 或 Web UI。先检查目标部署 `/v3/api-docs` 的版本和 OpenAPI；本 skill 的 3.2.0 接口核对记录见 [3.2.0 接口安全速查](references/api-3.2.0-safety.md)，[2.0.5 路由](references/api-2.0.5.md)仅作历史对照。不要根据大版本机械替换路由或认证。`ssh dev` 仅用于本机辅助操作；DS 对象操作通过 DS API 客户端或脚本执行，不默认经由 SSH 转发。SQL 和全局参数任务必须读取 [当前部署 SQL 全局变量与回归证据](references/sql-global-parameters.md)。

## 按场景读取

涉及版本升级、仅布置 OFFLINE、旧新链路切换、父子实例排障、日志分页、通知送达或 StarRocks 超时与重试时，读取 [近期运维场景与版本边界](references/recent-operations.md)。该文档区分历史部署证据、上游发布信息和 CLI 已实现能力。

需要调用 MCP 覆盖的项目/工作流/DAG/调度/实例/资源/监控能力，先读 [MCP 能力映射与 Skill 操作手册](references/mcp-capability-map.md)。它区分上游 MCP 能力目录、本地 CLI 实现和本次会话实际可用工具。

## 操作顺序

先确认 DS 地址、用户、项目编码、目标对象的 code/id，以及操作属于读操作还是写操作。优先按名称查询并记录唯一 code/id，再执行后续动作；不要用名称模糊匹配直接删除或修改。

读操作包括项目、资源、工作流、工作流实例、任务实例和日志查询。读操作完成标准是返回结果与目标项目/对象身份一致，并保留 code/id、状态和版本信息。

本技能提供 `scripts/ds_ops.mjs` 处理 DS 3.2.0 工作流上线和定时：运行前须检查脚本所用 operationId 与目标 `/v3/api-docs` 一致；凭据只从 `DS_URL`、`DS_USER`、`DS_PASSWORD` 环境变量读取。先用 `inspect` 查定义、活动实例和关联调度；只有活动实例为零且工作流/项目身份匹配时才继续。发布用 `release`，创建调度必须先创建 OFFLINE，再用 `online-schedule` 上线。创建后回读调度列表确认 Cron、时区、状态、告警组和失败策略。命令详见 [ds-ops-cli.md](references/ds-ops-cli.md)。

3.2.0 登录参数按 `/v3/api-docs` 中 `/login` 声明的查询参数位置发送；遵循目标 API 契约，不依赖请求体兼容行为。只读预检脚本按此契约实现。

写操作按“确认授权范围 → 查询 → 保存可回退基线 → 预览请求 → 执行 → 复查”处理。只读预检可用本 skill 的 `scripts/check_workflow.py`：

```bash
python3 "$SKILL_DIR/scripts/check_workflow.py" \
  --url "$DS_URL" --project-code "$PROJECT_CODE" --workflow-code "$WORKFLOW_CODE"
```

此脚本需 Python 3.10+，仅使用已校验 `operationId` 的只读接口（加登录），凭据只从 `DS_USER`、`DS_PASSWORD` 环境变量读取；返回 0 为结构预检通过、1 为发现问题、2 为检查未完成。工作流写入后必须运行该预检；只要仍有坐标、节点、依赖或状态问题，就继续修正并复查，不能把未通过的预检当作完成。它不验证业务运行、SQL 结果或全部父流程引用，不得代替发布验收。先将 `SKILL_DIR` 设为本 `SKILL.md` 所在目录的绝对路径，勿在脚本中写死机器路径。

1. 执行前查询当前对象详情、状态、版本和引用关系。
2. 资源写入只允许在用户指定的资源根目录下进行；没有通用默认可写目录；具体路径必须由用户请求或项目配置明确指定。
3. 已存在资源优先更新内容并复用 resource id；只有确认目标不存在时才创建或上传。
4. 工作流修改使用现有 definition code，记录修改前版本；创建新工作流时先确认名称不存在。
5. 发布、运行、重跑、删除、停止、暂停、恢复和资源删除属于外部状态变更，执行前明确目标和范围。
6. 工作流每次保存、切换版本或发布状态后，重新查询对象并运行 `check_workflow.py`。核对新版本、发布状态、任务数、任务类型、任务版本、依赖边和调度状态；预检发现问题时先修复并复查，不能遗留“需人工核对”的坐标或拓扑问题。
7. 完成后重新查询对象，确认实例状态或删除结果；失败时只清理本次新建且已确认无引用的资源。

## 资源操作

支持资源目录和文件查询、创建目录、文本创建、二进制上传、内容更新、重命名、下载和删除。路径必须使用 DS 资源中心的完整路径；创建、上传和重命名时校验路径前缀，禁止通过 `..`、根目录或随机目录绕过约束。

资源管理的完成标准是：查询到唯一资源、返回 resource id 和完整路径，或删除后再次查询确认不存在。工作流删除、版本回滚和实例删除不会自动清理资源中心文件，因此资源清理必须单独确认引用关系。

## 工作流操作

支持工作流定义查询、创建、修改、版本查询、发布/下线、运行、克隆和删除。创建或修改 DAG 时保留任务 code、依赖关系、全局参数、租户、worker group、资源引用和 `SUB_PROCESS` 参数；不要仅凭名称重建已有生产工作流。

修改工作流前读取当前定义并保存版本号。修改完成后查询 definition 详情和版本，确认任务数量、任务类型、依赖关系、资源 id 和关键参数没有意外变化。历史版本会保留，不能把“修改成功”误认为“旧版本已删除”。

使用 `scripts/ds_ops.mjs update-definition` 修改完整 DAG、SQL、SHELL 或子流程参数时，先用 `--dry-run true` 预览白名单补丁。只修改工作流说明可用 `update-workflow-info`，该命令通过 V2 API 写入并回读节点和依赖。单个 SQL/SHELL 任务可使用 `update-task`：要求工作流 OFFLINE、无活动实例，并扫描项目定义确认该任务仅被目标工作流引用；先成功读取任务详情，再调用单任务更新接口；详情查询失败时报告存在性未知，不自动创建替代任务。SQL 文本通过 `--sql-updates-file` 更新；`--task-params-updates-file` 按任务类型只允许 SQL 的 `description`/`localParams`、SHELL 的 `rawScript`/`description`/`localParams`、SUB_PROCESS 的 `localParams`/`processDefinitionVersion`。`--global-param` 可选。Task `taskParams` 按 DS `TaskDefinition` 的字符串 JSON 格式提交；完整 DAG 更新时保留当前 Task 版本号，由 DS 根据参数变更生成下一版，不要在客户端预先递增。写后回读任务参数、版本、关系版本和数量。更新失败自动读回一次后停止；核对工作流、任务及版本接口能观测到的变化，区分事实与假设，再修复和预览，不直接重放原请求。完整参数格式见 [ds-ops-cli.md](references/ds-ops-cli.md)。

### DAG 画布布局

修改画布前先从 `processTaskRelationList` 还原实际拓扑，再安排 `locations`：

- 按依赖顺序从左向右分列；连续主链保持在同一水平泳道。
- 分支放在分流节点旁的独立上下泳道；汇合节点放在所有入边之后，避免支线穿过主链、节点或其他边。
- 按 DS 画布节点尺寸留出稳定间距；不能用坐标齐整替代连线检查。多个分支时调整同一层节点顺序以减少交叉。
- 坐标必须与当前 Task Code 一一对应且不重复。只调整布局时只改 `locations`，并把任务定义和依赖原样带回；回读确认任务参数、边和版本关系未意外变化。
- 保存前确认 `locations` 是非空 JSON 列表，且每个现存 Task Code 恰有一个坐标；按预检阈值留出节点间距（横向至少 480、纵向至少 160 坐标单位）。不要把空串或空列表传回定义，否则 DS 会把节点堆在一起。
- 每次工作流写入后立即回读 `locations`，运行 `check_workflow.py`，直到没有坐标缺失、重复或间距问题。再打开 DS 实际画布检查连线不交叉、不压住节点，主链、分支和汇合结构符合依赖关系；脚本不检测连线交叉。无法打开画布时，明确标为“画布视觉核验未完成”，不得报告布局已验收。

若 ONLINE 定义拒绝修改，先回读确认状态、版本、活动实例和关联调度。存在活动实例时等待结束；只有明确获准在活动实例期间维护时才走例外流程。没有活动实例后，按已核验 API 暂时下线定义再修改，并恢复原发布状态。下线或重新上线可能改变关联调度状态；保存调度发布状态、Cron、时区和告警等基线，并在修改后逐项恢复与复查。若 update 请求因 URL 过长返回 HTTP 414，先回读确认没有部分写入，再按目标 API 的参数契约尝试表单请求体，不盲目重放原请求。

## 实例和任务实例

工作流实例操作包括分页查询、详情、停止、暂停、恢复、重跑、从失败节点重跑、补数和删除。任务实例操作包括查询任务状态、读取日志、定位失败节点及必要时执行任务级运维动作。

处理失败实例时先检查实例状态、任务状态、外部 Spark/YARN 应用和日志；存在活动任务或活动应用时不要直接删除实例。对 `READY_STOP` 这类终态未收尾实例，先按项目内清理规程处理，只有目标 id 和状态再次核对一致后才允许数据库级应急清理。

重跑或补数前记录 process instance id、definition code、run date 和任务范围。完成标准是新实例已创建且状态可查询，或目标失败节点已经进入预期状态；不要因 API 返回成功就跳过实例和任务复查。

## SQL Task 全局参数与日期（当前部署必读）

- SQL 直接以 `SELECT` / `WITH` / `INSERT` 开始，说明放 description/Markdown。当前 3.2.0 SQL splitter 会跳过以 `--` 开始的整个分段，非查询任务可能空执行却 SUCCESS；不要误判成参数失效。
- 全局 IN 参数可直接通过 `'${batch_date}'` 等引用，无须同名本地 IN。避免同名自引用；不要通过硬编码本地参数绕过排障。
- T：`${system.biz.curdate}` 或全局值 `$[yyyyMMdd]`；T-1：`${system.biz.date}` 或 `$[yyyyMMdd-1]`。均为 `yyyyMMdd`，SQL 用 `STR_TO_DATE('${batch_date}', '%Y%m%d')`。T 以调度基准/时区为准，补数另核 scheduleTime。
- 定义/实例保存占位符、`varPool=[]` 均不能证明解析失败。检查 Worker `prepareParamsMap`、JDBC `?` 绑定值、实际 SQL 执行日志和查询结果。
- 只读探针设 `sqlType=0`；INSERT 设 `sqlType=1`，可声明一个 OUT 返回 affected rows。SUCCESS、无效 CAST 或除零不构成有效断言；必须验证返回列及目标数据。
- 日志：`GET /log/detail?taskInstanceId={id}&skipLineNum=0&limit=2000`。只摘取白名单参数与执行结果，日志上下文含敏感凭据，禁止原样输出。
- 具体已验证用法、对照实验、源码及版本证据见 [sql-global-parameters.md](references/sql-global-parameters.md)。不要把该部署发现未经验证推广至其他版本。

## SQL Task OUT → 下游 Task 变量传递

SQL Task 可通过 `localParams` 声明输出变量（当前部署探针已验证 SELECT 列别名到 OUT 的回传）：

```text
direct = OUT
```

上游 SQL Task 执行成功后，这些 OUT 变量会进入下游任务的 VarPool。下游任务默认接收这些变量，不需要再次配置同名 `localParams` 或显式声明 IN 参数。脚本中可直接使用占位符：

```text
${pg_value}
${sr_results_json}
```

对于受控且确认不含三引号终止符的 JSON，原始三引号可避免双引号和反斜杠破坏 Python 语法。它不是任意输入的安全序列化；包含任意文本时优先经文件或可靠编码传递，再解析。受控值示例：

```python
inputs = {
    "pg_value": "${pg_value}",
    "sr_results_json": r'''${sr_results_json}''',
}
```

配置下游任务时，应避免重复声明上游 OUT 变量；排查时优先检查上游 OUT 定义、下游 VarPool 和最终生成的脚本内容。

## 当前部署字符限制

保存到当前 DS 部署的工作流名称、描述、任务名称、SQL、Shell/Python 脚本、全局参数和通知模板，均不得包含四字节 Unicode 字符（码点大于 U+FFFF），包括美国旗帜 emoji（U+1F1FA U+1F1F8）。使用普通中文、ASCII 或 BMP 字符替代。

提交前检查完整待保存内容，而不仅是消息标题。可用 Python 检查 `any(ord(c) > 0xFFFF for c in content)`；结果为真时先替换，再保存。通知正文仍保留机器人要求的关键词“监控告警”。

这是当前部署的操作约束；此前保存失败与四字节字符有关的判断尚缺服务端异常堆栈或列字符集证据，不将 MySQL utf8mb3 写成已确认根因，也不推广为所有 DS 部署的限制。

## 凭据和失败处理

凭据通过目标环境已有环境变量或安全配置提供，不写入脚本、日志、skill、命令历史或最终回复。API 返回非零业务 code、HTTP 4xx/5xx、对象身份不一致或版本变化异常时停止后续写操作，保存响应摘要并重新查询状态。

不要直接修改数据库作为常规 API 替代。只有 API 无法处理已确认的 `READY_STOP` 实例时，才按专门清理规程执行最小范围、带状态条件和可回滚的数据库操作。

保存或任务详情 API 返回通用错误时，读取 [保存失败诊断](references/update-failure-diagnosis.md)。先取得响应和服务端异常证据，再决定修复范围；页面与 API 同错不等于已定位数据库根因。
