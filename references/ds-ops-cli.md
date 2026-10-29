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

实例诊断：`inspect-instance --id INSTANCE_ID`（也支持精确 `--name`）；SQL 导出：`show-sql --out FILE`；调度下线：`offline-schedule --id SCHEDULE_ID`；定义更新：`update-definition --global-param name=value`，可附 `--sql-updates-file FILE`。均需 project/code；写入前完整执行 SKILL.md 操作顺序。

实例和调度列表现在遍历分页，分页异常或超过 1000 页时报错；日志摘要仅覆盖前 2000 行，不能据此排除后续错误。定义修改与发布的自动化门禁仍不完整，详见 [能力范围](recent-operations.md#自动化能力范围)。这些命令的存在不代表完成了生产运行验证。
