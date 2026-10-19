# 维护与发布

1. 修改前核对本地 skill 与仓库内容，保留对已验证结论的版本和环境限定。
2. 修改接口规则时重新核验目标版本的 OpenAPI；不要把当前部署实测结论推广到其他版本。
3. 凭据不得写入 skill、脚本、示例、日志或提交。若计划公开仓库，先移除内网地址、实例标识和环境专属运行证据。
4. 每项变更使用主题分支并通过 Pull Request 合入 `main`；不要直接向 `main` 推送。仓库管理员应配置 `main` 保护规则，要求 Pull Request 合并。
5. 发布前检查差异和待提交文件，验证 Python 脚本语法、CLI 帮助、相对链接及 skill 元数据；发布后核对合并提交与本地副本。

## 本地验证

```bash
python3 scripts/check_workflow.py --help
uv run --with pyyaml python ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py .
```

脚本只读预检可用静态检查和 mock 验证；不要为了验证文档而触发真实工作流或对部署执行写操作。
