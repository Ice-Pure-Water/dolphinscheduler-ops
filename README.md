# DolphinScheduler 运维 skill

本仓库发布 `dolphinscheduler-ops` skill，用于通过可用的 DolphinScheduler MCP/API 连接或 Web UI 完成登录核验、查询诊断、变更预览、受控写入和写后验收。能力规程覆盖资源、工作流定义/版本/任务/依赖、调度、实例、任务状态与日志；本地 CLI 仍是面向 DS 3.2.0 的受限实现，不等于全版本全 API 客户端。所有连接和写能力以当前会话实际工具及目标服务 `/v3/api-docs` 为准。

skill 的执行规则以 [`SKILL.md`](SKILL.md) 为准；安装步骤见[使用指南](docs/usage.md)，发布步骤见[维护说明](docs/maintenance.md)。

## 快速使用

将仓库根目录作为 skill 目录安装到 Codex 用户技能目录：

```bash
mkdir -p ~/.codex/skills
cp -R ~/Downloads/projects/dolphinscheduler-ops ~/.codex/skills/dolphinscheduler-ops
```

安装后，在支持 Agent Skills 的助手中调用：

```text
使用 $dolphinscheduler-ops 检查目标工作流的定义、子流程引用和调度状态。先核对服务端版本和只读接口。
```

## 反馈与贡献

在其他环境使用时发现问题，可直接[提交 Issue](https://github.com/Ice-Pure-Water/dolphinscheduler-ops/issues/new)；修复文档或脚本可从 GitHub 网页创建分支并提交 [Pull Request](https://github.com/Ice-Pure-Water/dolphinscheduler-ops/pulls)，不需要本机项目副本。合入 `main` 后，再从仓库更新 skill 安装副本。

提交时请提供 skill 提交版本、DolphinScheduler 版本、复现步骤和脱敏证据。不要附带密码、令牌、Webhook、内网地址、未脱敏 SQL 参数或原始日志。

## 新增运维能力

[近期场景与版本边界](references/recent-operations.md)覆盖 OFFLINE 布置、链路切换、实例日志与数据验收；[DS CLI](references/ds-ops-cli.md)提供查询与部分运维命令，并列出尚未自动实现的写入门禁。

主 skill 新增统一的连接能力模型、登录凭据边界、写操作门禁和 MCP 接入审查清单。社区候选参考 [iflytek/dolphin-mcp-pilot](https://github.com/iflytek/dolphin-mcp-pilot)；它不是本地已连接服务，也不是 Apache 内置 AI 功能。

[MCP 能力映射与 Skill 操作手册](references/mcp-capability-map.md)将上游 MCP 能力转换为项目/工作流/DAG/调度/实例/资源/监控的操作规程，逐项标示本地 CLI 覆盖程度及风险门禁。

## 文件导航

- [`SKILL.md`](SKILL.md)：适用范围、运维流程和安全边界。
- [`references/api-3.2.0-safety.md`](references/api-3.2.0-safety.md)：当前部署接口语义和副作用门禁；执行前仍需核验目标 OpenAPI。
- [`references/api-2.0.5.md`](references/api-2.0.5.md)：旧版路由参考，不代表当前部署。
- [`references/sql-global-parameters.md`](references/sql-global-parameters.md)：SQL Task 参数、日期、假成功排障及环境回归证据。
- [`scripts/check_workflow.py`](scripts/check_workflow.py)：受限接口白名单的只读结构预检，包含 Task 清单一致性和 DAG 坐标/依赖检查。
- [`agents/openai.yaml`](agents/openai.yaml)：助手界面元数据。
- [`docs/usage.md`](docs/usage.md)：安装、调用和脚本使用细节。
- [`docs/maintenance.md`](docs/maintenance.md)：校验、主题分支和 PR 发布流程。

本仓库当前公开。部分参考内容源于私有部署环境；提交公开反馈或修复前，请去除凭据、Webhook、内网地址、实例标识和未脱敏运行证据。
