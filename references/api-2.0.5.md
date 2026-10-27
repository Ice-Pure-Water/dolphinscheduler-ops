# DolphinScheduler 历史 2.0.5 API 参考与当前部署路由

> 2026-09-13 更新：当前地址 `/v3/api-docs` 返回 `info.version=3.2.0`，不再视为 2.0.5。`/v3/api-docs/swagger-config` 列出 v1/v2 分组。下列旧路径在当前环境仍可用，以实际 OpenAPI 为准；不要因路径名推断版本。SQL 参数、日期和前置注释导致假成功的限制见 [sql-global-parameters.md](sql-global-parameters.md)。

历史环境记录（版本记录已过时）：

```text
DS 服务端：2.0.5
API 根地址：由目标环境的 DS_URL 提供
认证：POST /login，通常返回 session cookie；不要假设 3.x token 认证可用
```

2.0.5 使用 `process-definition`、`process-instances`、`task-instances` 等旧 API 命名。执行前可在目标环境检查：

```bash
curl -fsS "$DS_URL/swagger-ui/index.html"
```

如果没有 Swagger 页面，使用只读请求确认路径和响应，不要通过猜测连续发送写请求。不同 2.x 补丁版本可能存在参数名和返回结构差异。

## 认证和通用响应

```text
POST /login
```

常见方式是表单提交 `userName`、`userPassword`，并保存返回的 session cookie。每次请求检查 HTTP 状态和 DS JSON 的 `code`、`msg`、`data`；不能只看 HTTP 200。

通用变量：

```text
{base} = /dolphinscheduler
{projectCode} = 项目编码
{definitionCode} = 工作流定义编码
{instanceId} = 工作流实例 id
{taskId} = 任务实例 id
```

## 资源中心

| 目的 | 2.0.5 API 族 | 关键参数/注意事项 |
|---|---|---|
| 查询资源树 | `GET {base}/resources/list` | `type=FILE` 或 `UDF`；可带 `fullName`；记录 id、name、fullName、type |
| 查询资源 | `GET {base}/resources/query-by-name` 或资源树递归查询 | 旧版本 query-by-name 可能有问题，优先树查询后按完整路径匹配 |
| 创建目录 | `POST {base}/resources/directory` | `name`、`description`、`currentDir`、`type`；先解析父目录 id |
| 创建文本文件 | `POST {base}/resources/online-create` | 适合文本；固定完整路径和文件名 |
| 上传文件 | `POST {base}/resources` | multipart 文件上传；适合 jar/zip 等二进制；上传前确认是否已有同路径资源 |
| 查看/下载 | `GET {base}/resources/{id}`、`GET {base}/resources/{id}/download` | 下载内容可能是二进制；不要把内容直接写入资源中心新文件 |
| 更新内容 | `PUT/POST {base}/resources/{id}/update-content` | 以当前 Swagger 为准；优先复用 id，避免重复创建 |
| 重命名 | `PUT {base}/resources/{id}` | 可能表现为删除后重建，必须复查 id 和工作流引用 |
| 删除 | `DELETE {base}/resources/{id}` | 删除不可逆；目录删除前确认子项和引用关系 |

资源路径规则：

```text
允许根目录：由用户或项目配置明确指定，例如 /ai-managed/
允许路径：根目录及其子路径
禁止：/、..、随机临时目录、未经确认的自动生成目录
```

DS 2.0.5 没有足够可靠的资源子目录 ACL 可依赖。路径限制应在调用脚本/API 代理中强制校验，并限制任意 raw POST/PUT；仅靠 agent 提示不构成安全边界。

## 工作流定义

| 目的 | 2.0.5 API 族 | 关键参数/注意事项 |
|---|---|---|
| 分页查询 | `GET {base}/projects/{projectCode}/process-definition` | `pageNo`、`pageSize`、`searchVal`、`userId` |
| 查询详情 | `GET {base}/projects/{projectCode}/process-definition/{definitionCode}` | 读取任务定义、依赖、全局参数和资源引用 |
| 创建 | `POST {base}/projects/{projectCode}/process-definition` | 需要 `name`、`taskDefinitionJson`、`taskRelationJson` 等表单字段；以 Swagger 为准 |
| 更新 | `PUT {base}/projects/{projectCode}/process-definition/{definitionCode}` | 通常生成新版本；保留旧版本和 definition code |
| 发布/下线 | 旧版通常在 process-definition 相关接口或 executor 接口中提供 | 先通过 Swagger/现有 UI 请求确认具体 endpoint |
| 运行 | `POST {base}/projects/{projectCode}/executors/start-process-instance` | 传 definition code 和启动参数；执行后查询实例 |
| 版本 | 可能是 definition 的 versions 子路径或详情返回历史 | 2.0.5 与 3.x 不同，先探测 |
| 删除 | `DELETE {base}/projects/{projectCode}/process-definition/{definitionCode}` | 先下线并确认没有活动实例；删除不等于删除资源文件 |

创建或修改的最小校验集：工作流名称、definition code、任务 code、任务类型、依赖边、`SUB_PROCESS` code、资源 id、全局参数和调度配置。

## 工作流实例

| 目的 | 2.0.5 API 族 | 关键参数/注意事项 |
|---|---|---|
| 分页查询 | `GET {base}/projects/{projectCode}/process-instances` | `pageNo`、`pageSize`、`searchVal`、`stateType`、`processDefineCode` |
| 实例详情 | `GET {base}/projects/{projectCode}/process-instances/{instanceId}` | 记录 state、start/end time、definition code |
| 查询实例任务 | `GET {base}/projects/{projectCode}/process-instances/{instanceId}/tasks` | 当前部署已验证；原先记录的 `.../task-instances` 返回 UI HTML，不能当 API 成功 |
| 停止/暂停/恢复 | `{base}/projects/{projectCode}/executors/*` | 通常按 process instance id 调用；先确认实例仍处于可操作状态 |
| 重跑/失败点重跑 | `{base}/projects/{projectCode}/executors/*` | 重跑前记录参数和目标任务；完成后查询新实例或任务状态 |
| 删除 | `DELETE {base}/projects/{projectCode}/process-instances/{instanceId}` | 活动任务、Spark/YARN 应用或 READY_STOP 时不要直接删除 |

## 任务实例和日志

任务实例通常通过工作流实例下的 task-instances 查询；部分 2.0.5 部署还提供项目级 task instance 查询。查询任务时至少保留 task id、task code、task name、state、host、start/end time。

当前已验证日志接口：`GET {base}/log/detail?taskInstanceId={taskId}&skipLineNum=0&limit=2000`，返回 `data.message` / `data.lineNum`。必须传分页参数；漏传导致 `10103` 不能说明 Worker 不可达。其他部署先查 OpenAPI。日志上下文可能包含项目密码/Webhook，仅输出白名单变量和必要执行结果。读取日志后优先定位第一个失败任务、退出码、worker、外部应用 id 和错误摘要；不要通过日志文本猜测可以删除的对象。

## 版本和兼容性边界

- 2.0.5 已是历史版本；当前 Apache 文档中的新版 `workflow-definition` 路径不能直接代替旧路径。
- `dolphin-mcp-pilot v0.3.1` 的官方 E2E 目标是 DS 3.4.2，对 2.0.5 只有基础读操作已有环境验证；本 skill 直接按 REST API 2.0.5 处理，仍需以目标环境 Swagger 和只读探测为准。
- API 成功返回不代表业务操作完成；所有写操作都必须复查对象、版本、状态或删除结果。

参考来源：Apache DS 2.x 源码中的 `ProcessDefinitionController` 和 `ProcessInstanceController`，以及 [Apache DolphinScheduler REST API 文档](https://dolphinscheduler.apache.org/en-us/docs/latest/user_doc/guide/open-api.html)。运行时行为仍以目标环境 OpenAPI 和只读探测为准。
