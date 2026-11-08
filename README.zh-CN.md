# LocalGPT

[English](README.md) · [简体中文](README.zh-CN.md)

**在本机管理对话、图像、项目和个人记忆的工作台。**
LocalGPT 将 LM Studio 文本对话和 ComfyUI 图像工具整合到一个浏览器界面，使用本机 SQLite 保存数据。这是一个独立应用。

**用户入口：**阅读[用户指南](docs/user-guide.zh-CN.md)。

**Agent 入口：**先阅读 [AGENTS.md](AGENTS.md)，再阅读 [Agent 指南](docs/agent-guide.zh-CN.md)。

## 本地体验

使用 macOS 或 Linux，以及 Python 3.10 或更新版本；任务所有权依赖 POSIX 文件锁，暂不支持原生 Windows。演示无需模型或 ComfyUI。

```sh
git clone https://github.com/ThineLord/localgpt.git
cd localgpt
git checkout v0.1.0
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python work/chat-sidebar/build.py
.venv/bin/python work/chat-sidebar/demo.py
```

打开 **http://127.0.0.1:8191/qwen-cn/**。演示回答和图像均为合成内容，临时数据库与个人数据分开；按 Ctrl+C 停止。实际对话和图像生成见[本地服务配置](docs/user-guide.zh-CN.md#本地服务)。

## 主要功能

- 与本地模型对话，流式显示回答，编辑提示词并重试。
- 通过已有 ComfyUI 生成和编辑图像。
- 用项目整理对话、指令和本地文件。
- 管理保存的记忆、历史、草稿、图库和回收站。
- 切换中英文，以及浅色、深色或跟随系统外观。

## 文件位置

```text
localgpt/
├── work/chat-sidebar/   应用源码和后端测试
├── tools/               验证工具和合成数据演示
├── assets/              源码素材
├── docs/                用户、agent 和版本文档
│   └── history/         历次设计和验收记录
├── AGENTS.md            agent 入口
├── CHANGELOG.md         版本历史
└── VERSION.txt          应用版本的唯一来源
```

模型、个人数据库、生成图像、备份和本地配置不进入发布源码。既有运行路径保留，详见[隐私与存储说明](docs/PRIVACY.md)。

## 版本与文档

当前版本：**0.1.0**。这是现有应用首次采用版本管理的基线，主要整理仓库和文档；没有新增推理功能，也不会自动部署到已有安装。

- [用户指南](docs/user-guide.zh-CN.md) · [Agent 指南](docs/agent-guide.zh-CN.md)
- [版本说明](docs/releases/0.1.0.zh-CN.md) · [更新记录](CHANGELOG.md) · [GitHub Releases](https://github.com/ThineLord/localgpt/releases)
- [版本与发布规则](docs/versioning.md) · [验证方法](docs/testing.md)
- [文档目录](docs/README.md)

前端使用原生 JavaScript、HTML 和 CSS，后端使用 Python/aiohttp 与 SQLite。真实推理需要另行安装模型和本地服务；源码发布不打包这些依赖，也不迁移个人数据。
