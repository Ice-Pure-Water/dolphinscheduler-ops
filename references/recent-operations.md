# 近期运维场景与版本边界

## 版本研究（2026-10-29）

2026-10-29 已只读访问当前服务 `/v3/api-docs`，确认 `info.version=3.2.0`、273 条接口路径。此证据确认服务声明的 API 版本，不代表独立核验了运行镜像与定制补丁。执行操作前读取目标 `/v3/api-docs`，记录 info.version、操作的 method/path/operationId、参数位置、必填字段和响应模型。版本字段不能排除定制补丁，应结合部署镜像或构建标识确认。

上游发布页当前列出 3.4.3；它不代表用户部署已升级。3.2.2 发布记录包含参数类型改进，3.3.1 包含日志客户端调整，3.4.3 包含调度 missed-fire policy。跨版本时重新核对参数、日志和调度接口，不直接套用 3.2.0 脚本。

来源：https://github.com/apache/dolphinscheduler/releases
历史 3.2.0 发行包：https://archive.apache.org/dist/dolphinscheduler/3.2.0/

## 先布置、不执行与链路切换

用户只授权布置时：保存新定义为 OFFLINE，调度保持 OFFLINE，交付 code/version、任务与依赖、参数默认值、资源引用、待执行迁移项。运行探针、发布、补数及业务表写入均需要已有授权覆盖。

替换旧链路时先列出全部目标表写入者，包括父流程、独立调度和手工入口。切换方案明确映射/DDL 前置条件、旧写入者停用顺序、新链路启动顺序、回退条件。仅新定义保存成功不能证明切换完成；切换后核查实际触发入口与业务批次，避免双写。

## 实例、日志与通知证据

按父实例 → SUB_PROCESS 任务实例 → 子实例 → 失败任务追踪，记录各自 ID、definition code/version、业务日期、开始结束时间及状态。定义更新不会改写已经启动实例的版本。

实例、调度与版本列表必须按 total/分页结束条件读完；一页没有目标不能证明不存在。日志使用 skipLineNum 分页，设置最大页数/总行数，空页结束；日志仍增长或达到上限时报告截断。仅输出错误类别、任务 ID、时间和必要脱敏上下文，过滤密码、token、Webhook、连接串和 SQL 中的敏感值。

通知分别记录任务执行、供应商响应和接收端可见证据。HTTP 200 仍须检查供应商业务码；没有接收端证据时只能报告接口已接受，不能声称送达。重试前确认是否可能重复通知。

## StarRocks SQL 排障与写入重试

先读取实际 schema 与 JDBC 执行日志，再定位失败阶段。出现 planner timeout 时区分优化器超时、query_timeout 和 insert_timeout。需要修改会话配置且获得授权时，在现有 preStatements 上增量加入 SET new_planner_optimize_timeout = 30000；这是历史修复示例，先核对目标 StarRocks 支持该变量及单位。保留已有语句，不修改全局配置。

SQL/API 超时后先核对实例与目标批次计数、业务键和样本，再决定重试。计数相同不能证明业务键或字段相同。数据验收至少覆盖业务日期、唯一键、重复/空值、关键状态分布与差异样本，并说明是否实际执行。

## 自动化能力范围

现有 ds_ops.mjs 包含 inspect、inspect-instance、show-sql、release、create-schedule、online-schedule、offline-schedule、update-definition、update-task、update-workflow-info。定义更新先用 `--dry-run true` 检查白名单 patch，再提交。SQL 支持 SQL 文本与 `description`/`localParams` patch；SHELL 支持 `rawScript`/`description`/`localParams`；SUB_PROCESS 支持 `localParams`/`processDefinitionVersion`。`update-task` 仅在任务唯一属于指定 OFFLINE 工作流且没有活动实例时调用 DS 单任务更新 API，由 DS 自行生成任务/工作流版本并同步依赖。`update-workflow-info` 仅通过 V2 API 更新说明并校验拓扑。写入后回读参数、版本与关系；失败时单次回读并停止，禁止盲目重试。

2026-10-29 美国三源处理保存失败：API 完整定义更新（全表单及混合 query/form）、V2 说明更新返回 10107；同一工作流在官方 Web UI 编辑两个监控节点并保存，也返回 HTTP 200、业务码 10107。页面使用 PUT process-definition/{code}，全部字段为 URL-encoded form body。目标任务详情/版本接口分别返回 50043/50039，不能据此判断当前表缺行。回读工作流仍为 v23，目标任务仍为 v6/v8，仅证明这些可见版本未变化，未完成元数据全量核对。已恢复原定义及原定时上线，未运行工作流。直接 DS 主机 SSH 认证未通过；辅助主机的旧 API 日志停在 2024 年，不用于解释本次异常。根因尚待当前 API 服务端异常堆栈确认。详见 [保存失败诊断](update-failure-diagnosis.md)。

2026-10-30 后续：移除通知模板中的四字节字符后，重建工作流的完整定义更新已成功；修正 SQL OUT 参数名和默认增量参数后完成发布与每日 16:00 定时。随后通过 CLI 为 ADS 当日行数增加美国申请号前缀过滤，保存、版本/参数回读及结构检查通过。未手动启动实例。字符限制现写入 SKILL.md；缺少服务端异常堆栈，仍不将此前所有错误统一归因于数据库字符集。

该 CLI 仍是受限场景脚本，不是通用 DS 客户端；写命令不会自动备份生产配置，也不替代操作者核验身份、活动实例、基线与定时归属。创建调度仍限定 16:00 Asia/Shanghai。更新失败后自动回读一次，核对版本未变后方可定位原因；先修复请求或接口问题，再单独预览和重试。

show-sql 导出的 SQL 可能敏感，只在授权诊断需要时保存到受控文件。inspect-instance 仅输出错误类别摘要，原始日志另按脱敏流程按需读取。


接口契约匹配、结构预检、保存回读、画布检查、运行结果和业务数据验收分别记录结论。生产环境不可用时交付离线结果并注明未完成的实测项目。
