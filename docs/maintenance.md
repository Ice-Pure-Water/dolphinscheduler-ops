# 维护与发布

[返回首页](../README.md)

## 内容维护

1. 修改前核对本地 skill 与仓库内容，保留已验证结论的版本、环境和时间限定。
2. 修改接口规则时重新核验目标版本的 OpenAPI；不要把当前部署实测结论推广到其他版本。
3. 凭据不得写入 skill、脚本、示例、日志或提交。若计划公开仓库，先移除内网地址、实例标识和环境专属运行证据。
4. 同步更新 `README.md` 与 `docs/usage.md` 中受影响的安装、适用范围或退出码说明，避免入口文档与细节规则冲突。

## 验证

在仓库根目录运行：

```bash
python3 scripts/check_workflow.py --help
uv run --with pyyaml python ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py .
git diff --check
```

另需确认：

- Python 脚本语法有效，命令帮助可显示。
- Markdown 相对链接都指向仓库内存在的文件。
- 涉及 DAG 画布规则时，核对节点坐标覆盖全部 Task Code、主链与分支泳道符合依赖拓扑，并明确说明脚本预检不检测连线交叉，需由 DS 画布确认。
- 待提交差异只包含本次 skill 变更，不含凭据、个人目录路径或不应上传的环境数据。
- 对运行脚本的验证使用静态检查或 mock，不为了验收文档而触发真实工作流或向部署执行写操作。

## Pull Request 发布

每项更新从主题分支提交并通过 Pull Request 合入 `main`；不要直接向 `main` 推送。PR 中说明变更范围、接口/版本证据和验证结果。合并后核对远端 `main` 提交与本地发布版本。

仓库管理员应为 `main` 配置保护规则并要求 Pull Request 合并。保护功能受 GitHub 仓库可见性和套餐限制；若 GitHub 拒绝为私有仓库启用规则，保持仓库私有并记录限制，待套餐支持后再配置，不要擅自公开仓库。
