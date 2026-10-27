# 当前部署 SQL Task / 全局变量使用与排障

## 适用版本与证据

2026-09-13 对某 DolphinScheduler 部署的实测：

- `/v3/api-docs` → `info.version=3.2.0`。此前 skill 记录的 2.0.5 不能作为当前版本结论。
- 此部署仍使用 `/projects/{projectCode}/process-definition`、`process-instances` API。不要仅按大版本猜测路径。
- 当前 SQL Task 行为与 Apache DolphinScheduler 3.2.0 `SqlTask.split` 源码一致；未核对部署 JAR 校验和，不宣称所有节点二进制完全一致。
- 实测使用 `STARROCKS` 数据源和 MySQL JDBC 协议；Worker 地址与数据源 ID 不在公开文档中记录。

## 已确认根因：前置行注释令整段 SQL 被跳过

该版本 `SqlTask` 使用 `;\n` 分割不支持多语句直传的数据源 SQL，随后：

```java
if (line.trim().isEmpty() || line.startsWith("--")) {
    continue;
}
```

这里的 `line` 是整个 SQL 分段，不是逐行注释。因此：

```sql
-- 聚合说明
INSERT INTO ... SELECT ...;
```

整个分段可能被丢弃。若 `sqlType=1`（非查询），空语句列表也可能成功结束，出现 **SUCCESS、无绑定日志、无执行日志、0 行写入**。不是全局变量丢失。

### 必须遵循

- 提交给 SQL Task 的 SQL 直接以 `SELECT` / `WITH` / `INSERT` 等关键字开始。
- 多语句任务的每个分段都不能以 `--` 开始；优先单任务单条语句。
- SQL 说明放任务 description、旁边的 Markdown 文档，不靠加空格或空行绕过 bug。
- 发布前检查实际提交的 SQL，不只检查本地文件；保留源 SQL 的独立说明。
- 长期修复应采用经过回归的 SQL splitter 修复/升级，正确处理注释、引号内分号、空语句列表。不要未经验证直接替换生产 Worker 插件或重启集群。

源码参考：
- https://github.com/apache/dolphinscheduler/blob/3.2.0/dolphinscheduler-task-plugin/dolphinscheduler-task-sql/src/main/java/org/apache/dolphinscheduler/plugin/task/sql/SqlTask.java
- https://github.com/apache/dolphinscheduler/blob/3.2.0/dolphinscheduler-spi/src/main/java/org/apache/dolphinscheduler/spi/enums/DbType.java

## 全局变量的正确使用（已实测）

工作流全局参数使用 `direct=IN`、`type=VARCHAR`，SQL 可以直接引用，无需再声明同名 localParams：

```sql
SELECT
    '${PATENT_RUN_MODE}' AS run_mode,
    '${batch_date}' AS batch_date_value,
    STR_TO_DATE('${batch_date}', '%Y%m%d') AS parsed_batch_date;
```

- 当前插件会将上述带引号的 `${...}` 转成 JDBC `?`，再按参数类型绑定。不要要求日志必须出现拼接后的完整字面量 SQL。
- 定义/实例持久化的 `taskParams.sql` 保留 `${...}` 是正常现象。
- `globalParams` 中保留 `$[yyyyMMdd]` 也不证明失败；Worker 的 `prepareParamsMap` 才能展示展开后的值。
- `varPool=[]` 不是全局参数未传入的证据；VarPool 用于任务输出传递。
- `startParams={"batch_date":"20260911"}` 覆盖全局默认日期已经实测。
- 不要配置 `localParams: batch_date=${batch_date}` 之类同名自引用；也不要通过硬编码本地 IN 参数掩盖全局配置问题。复杂覆盖优先级需另做对照实验。
- `${...}` 的上述绑定用法适用于值，不要当作动态表名、字段名的通用替换机制；标识符动态化须单独验证和白名单校验。

## 日期语义（纠正此前结论）

下表的 T 是调度基准日期，不保证等于查看/重跑时的机器自然日；补数要看 scheduleTime 和 Worker 上下文。当前使用 Asia/Shanghai。

| 变量/全局值 | 含义 | 格式 | 基准日 2026-09-13 实测 |
|---|---|---|---|
| `${system.biz.curdate}` | T | `yyyyMMdd` | `20260913` |
| `${system.biz.date}` | T-1 | `yyyyMMdd` | `20260912` |
| `$[yyyyMMdd]` | T | `yyyyMMdd` | `20260913` |
| `$[yyyyMMdd-1]` | T-1 | `yyyyMMdd` | `20260912` |
| 全局值 `${system.biz.curdate}` | 嵌套系统变量，可正常展开 | `yyyyMMdd` | `20260913` |
| `20260911` | 固定日期 | `yyyyMMdd` | `20260911` |

建议：ADS T 聚合 `batch_date=$[yyyyMMdd]`；ES T-1 同步 `batch_date=$[yyyyMMdd-1]`；固定日期补数 `batch_date=20260911`。这里只是使用规范，不代表已经修改其他工作流。

SQL 与格式对应：

```sql
batch_date = STR_TO_DATE('${batch_date}', '%Y%m%d')
```

不要把 `${system.biz.date}` 当 T 或 `yyyy-MM-dd`；也不要无依据改成 `CAST(... AS DATE)`。不同数据库对无效 CAST、除零可能返回 NULL，不能把 `CAST('${batch_date}' AS DATE)` 或 `1/0` 当必然失败的断言。

## 如何验证，避免假成功

1. 创建隔离、只读的 SQL 探针，不运行原工作流的业务 INSERT 或 ES 节点。使用 `sqlType=0`（查询），`displayRows=10`，SQL 第一字符就是 `SELECT`。
2. 查询实际列值；可配置不同名的 OUT 参数承接 SELECT 列别名，检查任务 VarPool。不要只看 SUCCESS。
3. 日志调用：

```text
GET /log/detail?taskInstanceId={id}&skipLineNum=0&limit=2000
```

此前漏传分页参数出现 `10103`，不能据此宣称 Worker 日志不可读。分页读取至完成。

4. 日志证据链：`prepareParamsMap` → `after replace sql , preparing` → 参数绑定 → `main statement execute query/update` → 结果行/affected rows。
5. 日志上下文可能含项目凭据、密码、Webhook。只输出白名单参数和必要执行片段，禁止原样打印/持久化完整上下文。
6. `Connect strings must start with jdbc:snowflake://` 在成功查询里也出现过；单独该 WARN 不能证明连接失败或数据源选错。
7. INSERT 使用 `sqlType=1`。可添加一个 OUT 参数 `ads_affected_rows`（VARCHAR）读取执行更新结果。再次通过 DBX 查目标批次、更新时间和来源申请号覆盖；0 行需要结合源数据判断，不应对所有合法空批次硬失败。
8. SQL Task 修改后必须更新工作流引用的任务版本；只更新 task-definition 不一定改变旧工作流 DAG 引用。发布前回读定义版本、task version、SQL、数据源、边及全局参数。

## 本次回归记录

| 实例 | 用例 | 结果 |
|---|---|---|
| 1107409 | MYSQL 兼容数据源45，无前置注释 SELECT | 返回全部变量及日期 |
| 1107410 / task301018 | 原 STARROCKS 数据源34，同一 SELECT | 同样返回正确值，排除必须改数据源的假设 |
| 1107411 / task301019 | 加前置 `--` 注释，sqlType=1 | SUCCESS、无实际 SQL 执行日志，复现跳过 |
| 1107412 / task301020 | 原数据源34、无注释、覆盖日期+嵌套系统变量 | 日期覆盖为20260911，T/T-1/嵌套值均正确 |
| 1107413 / task301021 | ADS 修复，启动日期20260912 | 更新85345行，DBX确认目标日期85345行 |

ADS 工作流 code `23007573826944`，v7→v8：去掉 SQL 前置行注释，保留原数据源34、任务code、DAG和名称；`batch_date` 恢复 T 表达式 `$[yyyyMMdd]`；增加 `ads_affected_rows` OUT。本次执行用显式启动日期20260912；未执行 ES 同步。

只读探针工作流 code `23018060893696`，完成后 OFFLINE，无定时。新增的 MYSQL 数据源45仅用于对照实验；历史探针v1引用它，未替换/删除共享数据源34。

目标 ADS 为按 app_number 更新的表；新批次覆盖旧记录后，旧批次计数下降不必然表示丢失。本次9月11日计数由97230变为70271，需按主键覆盖口径核验，不应要求历史批次数永久不变。
