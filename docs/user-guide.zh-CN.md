# LocalGPT 用户指南

[English](user-guide.md) · [简体中文](user-guide.zh-CN.md) · [首页](../README.zh-CN.md)

## 先运行演示

按照[首页步骤](../README.zh-CN.md#本地体验)安装，使用 macOS 或 Linux，以及 Python 3.10 或更新版本；任务所有权依赖 POSIX 文件锁，暂不支持原生 Windows。演示运行在 8191 端口，使用临时数据库；回答和图像为合成内容，不调用模型。保持终端运行，按 Ctrl+C 停止。

## 本地服务

实际应用面向已有本地安装。macOS 启动器和应用支持目录带有平台约定；其他系统建议先体验可移植演示。

1. 在仓库 `.venv` 中安装依赖，运行 `.venv/bin/python work/chat-sidebar/build.py` 构建页面。
2. 在 `127.0.0.1:1234` 启动 LM Studio 本地服务器，并确保 `lms` 可用。既有默认文本模型是 `qwen3-8b`。
3. 在 `127.0.0.1:8188` 启动装有 LocalGPT 扩展的 ComfyUI（旧安装名为 `qwen-local-app`）。扩展来自 `work/chat-sidebar/`：将 `backend.py` 安装为 `__init__.py`，配合 `storage.py`、`lm_chat.py`、`generation.py`、`generation_ownership.py`, `build_info.py`, `diagnostics.py` 和构建后的 `index.html`。安装或更新扩展是单独的本地维护操作，演示不会执行。
4. 运行 `.venv/bin/python work/chat-sidebar/launch.py`，或在 macOS 双击 `Start LocalGPT.command`，打开 **http://127.0.0.1:8190/qwen-cn/**。启动器使 UI 独立于终端运行，并拒绝覆盖已占用的服务。前台调试可用 `.venv/bin/python work/chat-sidebar/serve.py`。

首次启动需要运行 ComfyUI，以便通过 `/qwen-cn/health` 发现已有数据库和图像路径。发现后，ComfyUI 停止时仍可使用文本对话；图像生成仍需要 ComfyUI。LM Studio 和模型需另行安装。图像生成使用 `generation.py` 中指定的 Qwen Image 2.1 GGUF、Qwen3-VL 编码器、VAE，以及 `UnetLoaderGGUF`、`TextEncodeQwenImage21`、`QwenImage21Cache` 节点；仓库不分发这些模型。不要为了通过演示而修改模型名。

如果扩展仍是旧版，在使用永久删除前先备份，并统一升级所有写入端的 `storage.py`、`generation.py` 和 `backend.py`；仅在队列空闲时重启 ComfyUI。生命周期升级后，8188 的旧删除路由会被拒绝，应使用 8190 的控制入口。

## 日常使用

新建对话进行文本或图像工作，草稿和历史保存在本机。项目可集中管理对话、指令和来源；记忆范围在创建时选择。来源支持本地文本／代码、PDF 文本和 DOCX 段落，不提供 OCR。详细限制和恢复行为见[项目说明](PROJECTS.md)。

设置中可调整语言、外观、头像和保存的记忆。新设置默认关闭自动记忆；暂停召回会保留记忆，删除记忆仅影响之后的召回，不改写旧消息。图库和回收站有各自的删除确认和保留行为，操作前请查看对话框。

## 数据与升级

原有 SQLite 数据库、上传／输出目录、项目记忆、头像和迁移备份仍保存在本机。部分偏好使用浏览器存储。运行时沿用 `HanzAgent` 应用支持目录缓存已发现的路径；整理仓库不会重命名这些路径或 API。

安装时使用版本标签。已有安装升级前先阅读目标版本说明并检查本地修改；用 `git fetch origin --tags` 获取标签，仅在干净且不承载运行服务的 checkout 中切换版本。源码发布和服务升级是两件事。恢复数据前应单独安排维护，备份完整数据并停止所有写入端；产生新活动后，不要直接用旧备份覆盖当前数据。

下一个运行版本加入升级后写入端创建的中断对话任务恢复：保留部分回答，用户显式重试，不自动重放模型调用。UI 与 ComfyUI 扩展必须一起升级，并包含 `generation_ownership.py`, `build_info.py`, `diagnostics.py`。旧版所有权未知的任务仍需专门维护，不要手工删除数据库记录或生成锁文件。详见[恢复与升级要求](APP03_RECOVERY.md)。0.1.0 标签本身仍是之前的文档基线。

## 常见问题

- 演示端口被占用：停止自己启动的旧演示，或通过 `demo.py --help` 查看端口选项，不要结束未知进程。
- 实际 UI 无法发现数据：先启动已配置的 ComfyUI 扩展并确认 health 接口。
- 启动器提示另一个 checkout：先完成对应服务的维护再切换；启动器会保留原服务。
- 缺少模型或节点：修复本地服务安装；合成演示通过不等于真实推理通过。

## 版本与本地诊断

设置 → 关于显示界面构建版本/提交和运行服务启动时的版本。工作区修改会注明；无 Git 的源码归档会显示提交未知。源码改变后需重新构建，并按协调升级指南重启两个写入端；磁盘文件更新不会让旧进程自动变成新版本。

设置 → 本地服务 → 刷新诊断信息分别检查应用数据库、LM Studio 模型列表接口和 ComfyUI 队列。探测仅使用 GET、仅访问回环地址、不跟随重定向，超时为两秒。“可连接”不等于模型已加载或推理成功；演示服务会明确标为模拟。诊断不会启动服务或提交生成任务。
