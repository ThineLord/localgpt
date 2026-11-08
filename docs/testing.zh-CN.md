# 本地验收

[English](testing.md) · [简体中文](testing.zh-CN.md)

当前版本的一键验收入口：

```sh
python3 -m venv .venv
.venv/bin/python tools/validate.py --setup
```

首次会按 `requirements-test.txt` 安装固定 Python 依赖、按浏览器 lockfile 执行 `npm ci` 并下载 Playwright 配套 Chromium；之后只需 `.venv/bin/python tools/validate.py`。已在 macOS、Python 3.13、Node 26 验证；运行时任务所有权依赖 macOS/Linux POSIX 文件锁。Node/npm 仅用于验收，前端无 npm 构建流程。

完整合成验收包含构建一致性、版本/文档链接、全部后端和工具测试、当前 JS 语法、暂存/工作区 diff、源码及历史审计、检索性能回归和 15 个浏览器/API 套件。每个浏览器套件使用独立临时数据、服务和随机身份校验；成功、失败或中断都会清理自己创建的进程和数据，不使用已有服务或个人数据库。

默认报告为 `output/validation/report.json`，附各项日志和各套件截图。`PASS` 仅表示当前合成套件全部通过，不代表真实推理成功。依赖/环境阻塞为 `BLOCKED`，断言失败为 `FAIL`，超时为 `TIMEOUT`，中断为 `INTERRUPTED`；失败和阻塞返回非零退出码。开始即写入带唯一标识的 `RUNNING`，不会复用旧通过结果。`--browser-only`、`--skip-browser`、`--case projects` 明确为局部测试，最多得到 `PARTIAL_PASS`。

最终验收前暂存预期源码变更，审查 diff 并检查个人信息；自动审计检查 Git 对象，不能证明任意文本都没有隐私内容。没有 Git 历史的源码压缩包不能代替干净 clone 的发布验收。

[当前浏览器套件](../tools/browser/README.md) 与 [历史覆盖映射](../tools/history/browser/README.md) 分开维护。旧 Round 脚本仅保留溯源，不计入当前通过结果。检索基准使用 1×10k、20×100k、100×200k 重复合成文本，不能据此保证所有真实文档具有相同延迟。

真实推理单独使用 `tools/projects_live_acceptance.py` 和 `tools/round7_memory_live_acceptance.py`，需要本地模型服务和当前任务授权；连接失败必须报告环境阻塞。不能为让合成测试通过而启动外部服务、加载模型或改动生产数据。

发布时先验证最终审查提交，由获授权的原生 subagent 合并，再对准确的合并/tag 提交重新构建并跑完整套件。记录本地结果及局限；缺少或跳过 GitHub 工作流不等于远端检查通过，源码发布与运行环境部署分开。
