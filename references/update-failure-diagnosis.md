# 工作流保存失败诊断

## 证据顺序

1. 保存当前定义、任务 code/version、依赖、参数和调度基线到受控文件，确认授权范围与活动实例。凭据不写入报告。
2. 对照部署 OpenAPI 及实际前端请求，记录 method/path、operationId、Content-Type、字段位置、HTTP 状态、业务码和时间。OpenAPI 的 query 声明并不证明前端表单无效；当前 3.2.0 前端保存使用 URL-encoded form body。
3. 请求失败后回读定义、目标任务和可用版本接口，分别报告可见变化与无法核验项。定义版本未变不能证明任务日志等所有元数据均无写入。
4. 授权允许页面操作时，可保存同一目标的已审核修改，检查实际响应。页面同错说明 CLI 特有请求格式不足以解释问题；不代表已定位数据库异常。
5. 获取对应时间的当前 API 服务端异常堆栈，定位首个业务异常及 Caused by，再制定最小修复。确认日志来自当前主机、进程和日期；旧部署日志不构成本次证据。缺少访问方式时请求所缺登录方式或脱敏堆栈，避免继续猜测写请求。
6. 恢复原发布/调度状态并回读。修复后再次预览、保存，核对目标参数和任务/工作流/依赖版本，再做结构检查。运行及通知送达另行取证。

## 错误码解释边界

- 50043：任务详情查询失败；不能证明任务不存在。
- 50039：任务版本查询失败；不能证明版本不存在。
- 10107：工作流更新失败；Controller 通用异常包装也可返回该码，不能据此限定为某两条持久化分支。
- 50037：任务创建失败；没有返回 code 不能单独证明任何内部写入都未发生。

3.2.0 上游 TaskDefinition 的 taskParams 虽声明为 String，但 JsonDataDeserializer 同时接受对象和 JSON 字符串。编码方式不同是待验证变量，不是已确认根因。ID、审计字段、当前表缺行等判断也需要独立证据。

上游参考：[TaskDefinition](https://github.com/apache/dolphinscheduler/blob/3.2.0/dolphinscheduler-dao/src/main/java/org/apache/dolphinscheduler/dao/entity/TaskDefinition.java)、[ProcessDefinitionController](https://github.com/apache/dolphinscheduler/blob/3.2.0/dolphinscheduler-api/src/main/java/org/apache/dolphinscheduler/api/controller/ProcessDefinitionController.java)。部署可能有定制，以实际异常为准。

## 仅行数监控

用户要求只展示当日数据量时，SQL 仅返回各表指定日期的 COUNT(*)，OUT 别名与下游占位符一致；日期默认使用已有当天参数。保留每表既定过滤条件，明确统计日期及库表名。通知按处理顺序分段显示千分位行数，删除对账指标和基于业务计数主动失败的逻辑。保留网络/脚本本身的错误处理；它不属于业务成功失败判定。
