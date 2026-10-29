# 使用指南

[返回首页](../README.md)

## 适用场景

使用 `dolphinscheduler-ops` 处理 DolphinScheduler 资源、工作流定义、工作流实例、任务实例和运行日志的查询或运维。开始前先确认目标地址、部署版本、项目和目标对象身份。接口路径、参数与副作用以目标部署的 OpenAPI 为准。

本 skill 中的 3.2.0 与 2.0.5 资料分别有明确的环境和历史边界。它们不代表任意 DolphinScheduler 部署的统一行为。对生产写操作，必须先明确授权目标和范围，再查询当前状态、保存可回退基线、预览请求、执行并复查。加载 skill 不代表对发布、运行、重跑、删除等操作的授权。

## 安装

把本仓库根目录复制到 Codex 的用户 skills 目录：

```bash
mkdir -p ~/.codex/skills
cp -R ~/Downloads/projects/dolphinscheduler-ops ~/.codex/skills/dolphinscheduler-ops
```

如果目标目录已存在，先检查本地修改，再同步更新，避免覆盖本地专有内容。安装后在新会话调用 `$dolphinscheduler-ops`。

## 只读工作流预检

脚本 `scripts/check_workflow.py` 只面向文档已核验的 DolphinScheduler 3.2.0 API。运行前确认：

- Python 版本为 3.10 或更高。
- `DS_URL` 是无用户名、密码、查询参数或片段的服务根地址。
- `DS_USER` 和 `DS_PASSWORD` 已由运行环境安全提供，不能写入命令行、文档或日志。
- `PROJECT_CODE` 和 `WORKFLOW_CODE` 是从目标环境确认的数字编码。
- 目标 `/v3/api-docs` 返回版本 3.2.0，且相关 `operationId` 与参考文档一致。

执行命令：

```bash
python3 scripts/check_workflow.py \
  --url "$DS_URL" \
  --project-code "$PROJECT_CODE" \
  --workflow-code "$WORKFLOW_CODE"
```

脚本检查当前工作流定义结构、工作流详情与独立 Task 列表的一致性、直接子流程和关联调度。它不会创建、修改或运行 DS 对象，也不检查所有父流程引用、活动实例、SQL 结果或业务数据。单 Task 详情接口返回 `50043` 时，脚本使用 `getNodeListByDefinitionCode` 读取完整 Task 清单并与工作流详情核对。

脚本可检查 `locations` 是否覆盖每个 Task Code、坐标是否重复或间距过近，并核对依赖边及 Task 版本，但不检测 DAG 连线交叉。每次保存工作流定义后都要运行脚本，修复所有坐标或拓扑问题后再结束操作。修改画布或任务关系后，还要打开 DS 实际画布，确认节点未重叠、连线不交叉，主链、分支和汇合关系清晰；无法视觉核验时须明确说明未完成。

| 退出码 | 含义 | 后续处理 |
| --- | --- | --- |
| `0` | 预检完成，没有发现结构问题 | 仍需按目标任务验证业务逻辑和运行结果 |
| `1` | 预检发现需要人工核对的问题 | 检查脚本列出的结构问题，再决定是否修复 |
| `2` | 检查未完成，或目标接口与已核验契约不符 | 停止依赖本次结果的操作，先检查服务端版本和 OpenAPI |

退出码 `0` 只表示该脚本覆盖的结构检查没有报错，不代表工作流运行成功或业务验收通过。

## 参考资料怎么选

- 当前部署为 3.2.0 时，从 [`api-3.2.0-safety.md`](../references/api-3.2.0-safety.md) 查接口语义、副作用和操作前检查；使用前重新核对部署 OpenAPI。
- 维护 2.0.5 环境时，将 [`api-2.0.5.md`](../references/api-2.0.5.md) 作为旧版参考，并对照目标 Swagger/OpenAPI 验证每个路由。
- 排查 SQL Task 全局参数、日期或假成功时，阅读 [`sql-global-parameters.md`](../references/sql-global-parameters.md)。其中部署实测结论只适用于文档标注的环境与时间。

## 安全边界

脚本凭据只能由环境变量提供。日志可能包含密码、Webhook、SQL 参数或连接信息，输出时只保留必要的脱敏证据。GET 请求也可能改变状态；不能根据 HTTP 方法判断接口只读。遇到未知 `operationId`、接口版本不匹配、目标对象身份不符或响应异常时，停止后续写操作并重新查询状态。

## DS 3.2.0 运维 CLI

使用 Node.js 22 或更新版本运行 `scripts/ds_ops.mjs`（需要原生 fetch 与 Headers.getSetCookie）。命令、环境变量和限制见 [CLI 使用说明](../references/ds-ops-cli.md)。写命令运行前仍须完成 SKILL.md 的授权、基线与状态检查。近期布置、切换和排障流程见 [场景参考](../references/recent-operations.md)。
