# DS 3.2.0 工作流发布与定时 CLI

凭据必须由环境安全注入：`DS_URL`、`DS_USER`、`DS_PASSWORD`。脚本会重新读取 `/v3/api-docs`，只在版本为 3.2.0 且 operationId 匹配时工作。不得把凭据写进命令行、文件或日志。

```bash
node scripts/ds_ops.mjs inspect --project PROJECT_CODE --code WORKFLOW_CODE
node scripts/ds_ops.mjs release --project PROJECT_CODE --code WORKFLOW_CODE
node scripts/ds_ops.mjs create-schedule --project PROJECT_CODE --code WORKFLOW_CODE --schedule '{"processDefinitionCode":WORKFLOW_CODE,"crontab":"0 0 16 * * ? *","startTime":"2026-10-28 16:00:00","endTime":"2099-12-31 23:59:59","timezoneId":"Asia/Shanghai","releaseState":"OFFLINE"}'
node scripts/ds_ops.mjs online-schedule --project PROJECT_CODE --code WORKFLOW_CODE --id SCHEDULE_ID
```

流程：先 `inspect` 确认定义、零活动实例、无重复调度并记录版本；`release` 只将目标定义置为 ONLINE；随后创建 OFFLINE schedule，确认返回唯一 schedule id 和所需 Cron/时区后才上线；最后再次查询 schedule 列表核验 ONLINE、Cron、时区和工作流引用。任何 API 或版本/身份校验失败即停止。脚本不启动工作流实例，不验证业务结果。

## 其他已有命令与限制

实例诊断：`inspect-instance --id INSTANCE_ID`（也支持精确 `--name`）；SQL 导出：`show-sql --out FILE`；调度下线：`offline-schedule --id SCHEDULE_ID`。

定义修改支持先预览再提交：

```bash
node scripts/ds_ops.mjs update-definition --project PROJECT_CODE --code WORKFLOW_CODE \
  --sql-updates-file SQL_PATCH.json --task-params-updates-file TASK_PATCH.json --description '更新后的说明' --dry-run true
node scripts/ds_ops.mjs update-definition --project PROJECT_CODE --code WORKFLOW_CODE \
  --sql-updates-file SQL_PATCH.json --task-params-updates-file TASK_PATCH.json --description '更新后的说明'
node scripts/ds_ops.mjs update-task --project PROJECT_CODE --code WORKFLOW_CODE --task-code TASK_CODE \
  --sql-updates-file SQL_PATCH.json --task-params-updates-file TASK_PATCH.json --dry-run true
node scripts/ds_ops.mjs update-task --project PROJECT_CODE --code WORKFLOW_CODE --task-code TASK_CODE \
  --sql-updates-file SQL_PATCH.json --task-params-updates-file TASK_PATCH.json
node scripts/ds_ops.mjs update-workflow-info --project PROJECT_CODE --code WORKFLOW_CODE \
  --description '更新后的工作流说明' --dry-run true
```

`--global-param name=value` 是可选项。SQL patch 是 `{ "TASK_CODE": "SQL 文本" }`；任务参数 patch 是 `{ "TASK_CODE": {"rawScript": "...", "description": "...", "localParams": [...] } }`。SHELL 仅允许 `rawScript`、`description`、`localParams`；SQL 仅允许 `description`、`localParams`；SUB_PROCESS 仅允许 `localParams`、`processDefinitionVersion`。未知任务、字段或字段类型会在请求前拒绝。所有 taskParams 按 DS 的字符串 JSON 字段编码，提交时保留原 task version：DS 3.2.0 的 `saveTaskDefine` 按 `(taskCode, version)` 判断更新，并为变更任务生成下一版；客户端预先递增会被当成新任务版本。任务匹配与版本判定依赖 code/version；CLI 对变更任务省略版本日志 ID，不能将此当作已证实的故障修复；依赖关系保留 code/version 和条件，但不提交数据库关系 ID，由 DS 为新关系行生成 ID。更新 API 的 OpenAPI 把参数声明为 query；为避免两个大 JSON 数组触发网关 414，CLI 将 `name`、`globalParams`、`locations` 等标量放在 query，仅将 `taskRelationJson` 和 `taskDefinitionJson` 放入 URL-encoded form body，并在提交前核对全部字段仍受当前 OpenAPI 契约支持。dry-run 显示工作流基线、将发生的任务版本变化和修改字段，不发送写请求；正式更新后回读定义版本、任务参数、任务/边版本及数量。更新失败后 CLI 自动回读一次并停止，不自动重试。实现依据：[DS 3.2.0 `saveTaskDefine` 和 `saveTaskRelation`](https://github.com/apache/dolphinscheduler/blob/3.2.0/dolphinscheduler-service/src/main/java/org/apache/dolphinscheduler/service/process/ProcessServiceImpl.java#L1928-L2103)。

`update-task` 用于单个 SQL/SHELL 任务参数变更：必须指定所属工作流，工作流必须 OFFLINE 且无活动实例；命令会扫描项目内所有工作流，只有该任务唯一属于目标工作流时才可继续。先成功读取 task-definition 详情，再调用更新接口。详情查询失败时停止写入并报告存在性未知；按 [保存失败诊断](update-failure-diagnosis.md) 收集证据，不从通用错误码推断缺行或自动创建新任务。每次只处理一个 `TASK_CODE`，正式写入前先 dry-run。遇到其他工作流引用、多个引用、写后版本或参数不符时立即停止。

`update-workflow-info` 只通过 V2 API 修改工作流说明；须先 OFFLINE 且无活动实例，写后检查定义版本、节点 code 集合、关系数量和关系归属版本。

上线修改前先核对活动实例为零、定义 OFFLINE，并保留关联定时状态；更新后按原 Cron/时区恢复 ONLINE。命令均需 project/code，并遵守 SKILL.md 的写操作基线和状态恢复顺序。

实例和调度列表现在遍历分页，分页异常或超过 1000 页时报错；日志摘要仅覆盖前 2000 行，不能据此排除后续错误。定义修改与发布的自动化门禁仍不完整，详见 [能力范围](recent-operations.md#自动化能力范围)。这些命令的存在不代表完成了生产运行验证。
