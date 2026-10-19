# 当前部署 DS 3.2.0 接口安全速查

2026-09-27 只读核对 `http://172.16.1.35:12345/dolphinscheduler/v3/api-docs` 的 `info.version=3.2.0` 与以下 `operationId`。**使用前重新检查目标部署的 OpenAPI；下面的写接口仅描述语义，不构成执行授权。** 所有路径均相对于 `/dolphinscheduler`，登录会话及敏感参数不在此保存。

| 路径和方法 | `operationId` | 作用与限制 |
|---|---|---|
| `GET /projects/{projectCode}/process-definition/{code}` | `queryProcessDefinitionByCode` | 查询**当前**定义、Task、relation 和 `locations`；不会获取任意历史版本。 |
| `GET /projects/{projectCode}/process-definition/{code}/versions?pageNo=1&pageSize=50` | `queryProcessDefinitionVersions` | 分页查看历史版本**元数据**，需翻页核对总数；不保证包含每版完整 Task/DAG。 |
| `GET /projects/{projectCode}/process-definition/{code}/versions/{version}` | `switchProcessDefinitionVersion` | **写操作！切换当前版本，并可能将定义变为 OFFLINE；严禁用于读取历史。** 仅在明确授权的版本恢复/切换操作中使用，随后回读状态、父引用和调度。 |
| `DELETE /projects/{projectCode}/process-definition/{code}/versions/{version}` | `deleteProcessDefinitionVersion` | 删除指定历史版本；不是只读。 |
| `GET /projects/{projectCode}/task-definition/{code}` | `queryTaskDefinitionDetail` | 查询当前 Task 详情；若返回 `50043`，停止常规整流更新并排查。 |
| `GET /projects/{projectCode}/task-definition/{code}/versions?pageNo=1&pageSize=50` | `queryTaskDefinitionVersions` | 查询历史 Task 版本元数据；分页处理。 |
| `GET /projects/{projectCode}/task-definition/{code}/versions/{version}` | `switchTaskDefinitionVersion` | **写操作！** 切换当前 Task 版本，不用于历史查询。 |
| `GET /projects/{projectCode}/task-definition/gen-task-codes` | `genTaskCodeList` | 生成 Task Code，虽是 GET 也不是无副作用的查询；仅在明确创建/重建授权后调用。 |
| `PUT /projects/{projectCode}/process-definition/{code}` | `updateProcessDefinition` | 更新定义；包括 `locations`、`taskDefinitionJson` 和 `taskRelationJson`，可能生成新版本。保存前先对比 Task Code、参数、依赖和布局；保存后核对父子版本。 |
| `POST /projects/{projectCode}/process-definition/{code}/release` | `releaseProcessDefinition` | 使用 `releaseState` 上线/下线；前后核对当前版本和关联调度。 |
| `GET /resources/list?type=FILE&fullName=...` | `queryResourceList` | 查询资源；参数实际必填以 OpenAPI 为准。 |
| `GET /resources/download?fullName=...` | `downloadResource` | 读取资源内容；可能含凭据，禁止直接输出到日志或归档。 |
| `PUT /resources/update-content` | `updateResourceContent` | `fullName`、`tenantCode`、`content` 为必填；先核对授权路径和原内容，再提交、回读。不是旧参考的 `/resources/{id}/update-content`。 |
| `GET /projects/{projectCode}/schedules` | `queryScheduleListPaging` | 分页查询关联定时；核对原始发布状态、Cron、时区和告警设置。 |
| `POST /projects/{projectCode}/schedules/{id}/online` / `offline` | `publishScheduleOnline` / `offlineSchedule` | 定时上线/下线是写操作；避免独立监控与父流程双重触发。 |
| `GET /projects/{projectCode}/process-instances?pageNo=1&pageSize=50&processDefineCode=...` | `queryProcessInstanceList` | 分页核对活动实例及近期执行情况；实例列表不等于任务执行证明。 |
| `GET /projects/{projectCode}/process-instances/{id}/tasks` | `queryTaskListByProcessId` | 读取指定实例的任务；不能凭定义状态推断运行成功。 |
| `GET /log/detail?taskInstanceId=...&skipLineNum=0&limit=2000` | `queryLog_1` | 日志可能含敏感信息，只摘录脱敏白名单字段。 |

## 操作前的副作用门禁

1. 从目标 OpenAPI 确认 `operationId`、描述、必填参数及当前版本；**GET 也可能改变生产状态**，不认识的操作先停下，不以 HTTP 方法或路径名称推测安全性。版本切换、Task Code 生成和主动预览执行类接口都不能进入只读脚本白名单。
2. 保存原 `code/version/releaseState`、Task/依赖/`locations` 和调度状态。布局坐标应与现存 Task Code 一一对应；`locations=[]` 会让前端节点堆叠。仅改画布也可能递增工作流版本。
3. 修改子流程后查所有引用它的父流程，处理明确固定的 `SUB_PROCESS.taskParams.processDefinitionVersion`，再逐一核对 ONLINE 和 OFFLINE 调度原状态；不要在调度触发前后做未验证的批量修改。
4. 切版本属于生产写操作；误切时先停止其他变更，从事前基线确认目标版本和关联引用，再经授权恢复原版本和状态，最后向用户报告影响窗口。版本历史清单不能替代业务运行验证。
5. `scripts/check_workflow.py` 是只读**辅助检查**，仅覆盖一个工作流、它的 Task 详情、直接子流程与调度；不搜索所有父流程、不查询活动实例、不验证 SQL 结果/业务日期，也不是 DS API 的权限隔离层。生产修改仍需人工核对授权、父子引用、调度和实例。
