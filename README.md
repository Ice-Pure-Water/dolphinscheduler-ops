# DolphinScheduler 运维 skill

本仓库发布 `dolphinscheduler-ops` Codex skill，用于通过 DolphinScheduler REST API 或 Web UI 查询和运维资源、工作流、定义版本、工作流实例及任务实例。内容包括部署版本核验、写操作前置检查、假成功诊断、SQL Task 全局变量与日期排障，以及只读工作流结构预检脚本。

## 使用

将仓库中的 skill 目录安装到支持 Agent Skills 的工具目录（例如 `~/.codex/skills/dolphinscheduler-ops`），然后在支持的助手中调用：

```text
使用 $dolphinscheduler-ops 检查目标工作流的定义、子流程引用和调度状态。
```

只读预检脚本要求 Python 3.10+，并从环境变量读取 `DS_USER`、`DS_PASSWORD`：

```bash
python3 scripts/check_workflow.py \
  --url "$DS_URL" --project-code "$PROJECT_CODE" --workflow-code "$WORKFLOW_CODE"
```

脚本仅支持文档说明的 DolphinScheduler 3.2.0 只读接口，目标地址必须通过 `--url` 显式提供。执行前阅读 `SKILL.md` 的安全边界及 `references/api-3.2.0-safety.md`。

## 内容结构

- `SKILL.md`：调用条件、运维流程与安全边界。
- `references/api-3.2.0-safety.md`：当前部署接口语义与副作用门禁。
- `references/api-2.0.5.md`：历史版本对照。
- `references/sql-global-parameters.md`：SQL Task 参数、日期和假成功排障证据。
- `scripts/check_workflow.py`：只读工作流预检。
- `agents/openai.yaml`：助手界面元数据。

部分参考记录来自私有部署环境。本仓库保持私有；对外公开前应先移除内网地址、实例标识和环境专属运行证据。
