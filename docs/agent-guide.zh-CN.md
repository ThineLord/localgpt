# LocalGPT Agent 指南

[English](agent-guide.md) · [简体中文](agent-guide.zh-CN.md) · [Agent 入口](../AGENTS.md)

## 职责与文件位置

Codex 负责组织、实现和仓库管理；原生 subagent 独立 review 最终提交，并在检查通过且任务已授权时负责合并。不调用 bots、外部桥接或云端 agent。历史协作记录不覆盖当前流程。

| 位置 | 内容 |
| --- | --- |
| `work/chat-sidebar/` | Python 运行时、浏览器源码、构建和后端测试 |
| `tools/` | 审计、合成演示和验收工具 |
| `assets/` | 已审查的源码素材 |
| `docs/` | 当前用户／agent 指南和技术约定 |
| `docs/history/` | 早期设计、协作和验收证据 |
| `docs/releases/` | 每个版本的范围和升级说明 |
| `VERSION.txt` | 应用版本的唯一来源 |

生成的 `index.html`、虚拟环境、截图、运行数据和本地证据不进入 Git。外层 `Local_First` 是本地工作区，不是发布仓库；不要将其中的旧 checkout、输出或调查资料导入源码，也不要因整理源码而移动它们。

## 修改流程

1. 检查分支、远端、工作区、版本和适用指令，保留已有修改。如果 checkout 承载正在运行的应用，使用隔离 clone。
2. 新建 `codex/` 分支，完成范围明确的修改，同步对应中英文指南。发布前将计划变更写在 `Unreleased`。
3. 执行[相应检查](testing.md)，审查暂存 diff，运行暂存源码和历史审计。测试使用临时数据库和合成服务。
4. 推送分支并创建 draft PR，说明行为、范围、验证和限制。由原生 subagent review 精确的最终 head；修复后重新执行受影响检查。
5. 任务授权合并时，由 subagent 核对 head/base、review 发现和必需检查，再将 PR 转为 ready 并合并。不要绕过仓库规则。同账号 agent review 必须如实说明，不能称为 GitHub APPROVED review。
6. 发布任务继续执行[版本规则](versioning.md)；其他任务停在已验证、等待下一项授权的状态。

历史 PR #26 保持独立；当前恢复实现基于现有主分支重新 review 和验收，不通过直接合并旧 PR 或启用旧 CI 流程跳过检查。升级前阅读[任务恢复与协调升级说明](APP03_RECOVERY.md)。

## 运行边界

`/qwen-cn/` API、数据库路径、浏览器键、模型所有权标识及 `HanzAgent` 支持目录是兼容性标识，修改需要明确的迁移设计。更新源码和发布标签不会重启服务。安装、真实模型调用、数据迁移和生产维护须属于任务授权范围。

修改存储或运行行为前先读[架构](ARCHITECTURE.md)、[隐私](PRIVACY.md)和[项目说明](PROJECTS.md)。不要为通过测试而放宽保护或修改真实模型设置；如实记录证据和剩余限制。
