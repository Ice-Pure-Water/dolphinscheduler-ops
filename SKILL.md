---
name: dolphinscheduler-ops
description: "通过 DolphinScheduler REST API 查询和操作资源、工作流定义、实例与任务；涵盖当前部署 SQL 全局变量解析、假成功排障、工作流发布/修改/删除和重跑。先确认服务端版本与实际 API。"
---

# DolphinScheduler 运维操作

优先使用 REST API 或 Web UI。当前地址 `http://172.16.1.35:12345/dolphinscheduler` 的 `/v3/api-docs` 于 2026-09-27 回读 `info.version=3.2.0`，此前 2.0.5 记录已过时；当前部署仍使用 `process-definition` / `process-instances` 路径。先确认版本与 OpenAPI，不根据大版本机械替换路由或认证。当前环境先看 [3.2.0 接口安全速查](references/api-3.2.0-safety.md)；[2.0.5 路由](references/api-2.0.5.md)仅作历史对照，以目标实际 OpenAPI 为准。`ssh dev` 仅用于本机辅助操作；DS 对象操作通过 DS API 客户端或脚本执行，不默认经由 SSH 转发。SQL 和全局参数任务必须读取 [当前部署 SQL 全局变量与回归证据](references/sql-global-parameters.md)。

## 操作顺序

先确认 DS 地址、用户、项目编码、目标对象的 code/id，以及操作属于读操作还是写操作。优先按名称查询并记录唯一 code/id，再执行后续动作；不要用名称模糊匹配直接删除或修改。

读操作包括项目、资源、工作流、工作流实例、任务实例和日志查询。读操作完成标准是返回结果与目标项目/对象身份一致，并保留 code/id、状态和版本信息。

写操作按“确认授权范围 → 查询 → 保存可回退基线 → 预览请求 → 执行 → 复查”处理。只读预检可用本 skill 的 `scripts/check_workflow.py`：

```bash
python3 "$SKILL_DIR/scripts/check_workflow.py" \
  --url "$DS_URL" --project-code "$PROJECT_CODE" --workflow-code "$WORKFLOW_CODE"
```

此脚本需 Python 3.10+，仅使用已校验 `operationId` 的只读接口（加登录），凭据只从 `DS_USER`、`DS_PASSWORD` 环境变量读取；返回 0 为结构预检通过、1 为发现问题、2 为检查未完成。它不验证业务运行、SQL 结果或全部父流程引用，不得代替发布验收。先将 `SKILL_DIR` 设为本 `SKILL.md` 所在目录的绝对路径，勿在脚本中写死机器路径。

1. 执行前查询当前对象详情、状态、版本和引用关系。
2. 资源写入只允许在用户指定的资源根目录下进行；没有通用默认可写目录；具体路径必须由用户请求或项目配置明确指定。
3. 已存在资源优先更新内容并复用 resource id；只有确认目标不存在时才创建或上传。
4. 工作流修改使用现有 definition code，记录修改前版本；创建新工作流时先确认名称不存在。
5. 发布、运行、重跑、删除、停止、暂停、恢复和资源删除属于外部状态变更，执行前明确目标和范围。
6. 完成后重新查询对象，确认新版本、状态、实例状态或删除结果；失败时只清理本次新建且已确认无引用的资源。

## 资源操作

支持资源目录和文件查询、创建目录、文本创建、二进制上传、内容更新、重命名、下载和删除。路径必须使用 DS 资源中心的完整路径；创建、上传和重命名时校验路径前缀，禁止通过 `..`、根目录或随机目录绕过约束。

资源管理的完成标准是：查询到唯一资源、返回 resource id 和完整路径，或删除后再次查询确认不存在。工作流删除、版本回滚和实例删除不会自动清理资源中心文件，因此资源清理必须单独确认引用关系。

## 工作流操作

支持工作流定义查询、创建、修改、版本查询、发布/下线、运行、克隆和删除。创建或修改 DAG 时保留任务 code、依赖关系、全局参数、租户、worker group、资源引用和 `SUB_PROCESS` 参数；不要仅凭名称重建已有生产工作流。

修改工作流前读取当前定义并保存版本号。修改完成后查询 definition 详情和版本，确认任务数量、任务类型、依赖关系、资源 id 和关键参数没有意外变化。历史版本会保留，不能把“修改成功”误认为“旧版本已删除”。

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

JSON 类型 OUT 变量嵌入 Python 脚本时，必须使用原始三引号字符串，避免 JSON 内部双引号破坏 Python 语法：

```python
inputs = {
    "pg_value": "${pg_value}",
    "sr_results_json": r'''${sr_results_json}''',
}
```

配置下游任务时，应避免重复声明上游 OUT 变量；排查时优先检查上游 OUT 定义、下游 VarPool 和最终生成的脚本内容。

## 凭据和失败处理

凭据通过目标环境已有环境变量或安全配置提供，不写入脚本、日志、skill、命令历史或最终回复。API 返回非零业务 code、HTTP 4xx/5xx、对象身份不一致或版本变化异常时停止后续写操作，保存响应摘要并重新查询状态。

不要直接修改数据库作为常规 API 替代。只有 API 无法处理已确认的 `READY_STOP` 实例时，才按专门清理规程执行最小范围、带状态条件和可回滚的数据库操作。
