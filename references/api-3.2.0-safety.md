# 当前部署 DS 3.2.0 接口安全速查

2026-09-27 只读核对某部署 `/v3/api-docs` 的 `info.version=3.2.0` 与以下 `operationId`。**使用前重新检查目标部署的 OpenAPI；下面的写接口仅描述语义，不构成执行授权。** 所有路径均相对于 `/dolphinscheduler`，登录会话及敏感参数不在此保存。

| 路径和方法 | `operationId` | 作用与限制 |
|---|---|---|
| `GET /projects/{projectCode}/process-definition/{code}` | `queryProcessDefinitionByCode` | 查询**当前**定义、Task、relation 和 `locations`；不会获取任意历史版本。 |
| `GET /projects/{projectCode}/process-definition/{code}/tasks` | `getNodeListByDefinitionCode` | 查询当前定义下的完整 Task 列表；与工作流详情内嵌的 Task 列表交叉核对。 |
| `GET /projects/{projectCode}/process-definition/{code}/versions?pageNo=1&pageSize=50` | `queryProcessDefinitionVersions` | 分页查看历史版本**元数据**，需翻页核对总数；不保证包含每版完整 Task/DAG。 |
| `GET /projects/{projectCode}/process-definition/{code}/versions/{version}` | `switchProcessDefinitionVersion` | **写操作！切换当前版本，并可能将定义变为 OFFLINE；严禁用于读取历史。** 仅在明确授权的版本恢复/切换操作中使用，随后回读状态、父引用和调度。 |
| `DELETE /projects/{projectCode}/process-definition/{code}/versions/{version}` | `deleteProcessDefinitionVersion` | 删除指定历史版本；不是只读。 |
| `GET /projects/{projectCode}/task-definition/{code}` | `queryTaskDefinitionDetail` | 查询单个 Task 详情；部分部署可能返回 `50043`，此时改用工作流 Task 列表接口交叉核对，不要把该只读接口错误误判为工作流写入失败。 |
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

`POST /login` 的 `userName` 与 `userPassword` 依 OpenAPI 声明作为查询参数发送；只读检查脚本遵循该参数位置，不依赖请求体兼容行为。

1. 从目标 OpenAPI 确认 `operationId`、描述、必填参数及当前版本；**GET 也可能改变生产状态**，不认识的操作先停下，不以 HTTP 方法或路径名称推测安全性。版本切换、Task Code 生成和主动预览执行类接口都不能进入只读脚本白名单。
2. 保存原 `code/version/releaseState`、Task/依赖/`locations` 和调度完整状态。布局坐标应与现存 Task Code 一一对应；`locations=[]` 会让前端节点堆叠。仅改画布也可能递增工作流版本。先按依赖拓扑从左至右分层，主链和分支使用独立泳道；保存后在 DS 画布核对连线，坐标检查本身不能证明没有交叉。
3. 对 ONLINE 定义执行修改前，先查活动实例和调度。若定义拒绝编辑，先等待活动实例结束，再按目标 API 暂时下线、修改并恢复原发布状态。实测本环境下定义下线会使关联调度变为 OFFLINE，重新上线定义不会自动恢复调度；因此必须在事前记录 schedule state、Cron、时区和告警配置，结束后恢复原调度状态并回读确认。此行为按部署处理，操作前仍以目标环境回读为准。
4. 若 `updateProcessDefinition` 的查询参数超过服务端 URL 限制并返回 HTTP 414，先回读确认定义和版本未变化；核验目标 OpenAPI 后，可以用 `application/x-www-form-urlencoded` 请求体传递同一组参数（本环境已验证），不直接重放过长 URL。更新后仍需比较任务参数与依赖边。
5. 修改子流程后查所有引用它的父流程，处理明确固定的 `SUB_PROCESS.taskParams.processDefinitionVersion`，再逐一核对 ONLINE 和 OFFLINE 调度原状态；不要在调度触发前后做未验证的批量修改。
6. 切版本属于生产写操作；误切时先停止其他变更，从事前基线确认目标版本和关联引用，再经授权恢复原版本和状态，最后向用户报告影响窗口。版本历史清单不能替代业务运行验证。
7. `scripts/check_workflow.py` 是只读**辅助检查**，仅覆盖一个工作流、它的 Task 详情、直接子流程和调度；不搜索所有父流程、不查询活动实例、不验证 SQL 结果/业务日期，也不检测 DAG 连线交叉，不能替代画布检查或构成 DS API 权限隔离层。生产修改仍需人工核对授权、父子引用、调度和实例。

## 2026-10-29 当前服务只读复核

`/v3/api-docs` 返回 `info.version=3.2.0`，共 273 条路径。重新核对 login、queryProcessDefinitionByCode、updateProcessDefinition、queryProcessInstanceList、queryScheduleListPaging、createSchedule_1、queryLog_1，与上表一致。未执行生产写入或工作流运行。

登录 userName/userPassword 均为必填 query 参数；日志 taskInstanceId/skipLineNum/limit 均为必填 query 参数。调度列表的 processDefinitionId 标记 required=true，却未声明 in，属于当前契约缺陷；沿用已验证客户端处理并检查响应身份，不能据此假设任意 OpenAPI 客户端均可用。升级后重新核验。
