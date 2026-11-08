# LocalGPT

[English](README.md) · [简体中文](README.zh-CN.md)

**A local workspace for conversations, images, projects and personal memory.**
LocalGPT brings LM Studio text chat and ComfyUI image tools into one browser interface, with SQLite storage on your computer. It is an independent application.

**For users:** start with the [user guide](docs/user-guide.md).

**For agents:** read [AGENTS.md](AGENTS.md), then the [agent guide](docs/agent-guide.md).

## Try it locally

Use Python 3.10 or newer. The demo works without models or a ComfyUI installation.

```sh
git clone https://github.com/ThineLord/localgpt.git
cd localgpt
git checkout v0.1.0
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python work/chat-sidebar/build.py
.venv/bin/python work/chat-sidebar/demo.py
```

Open **http://127.0.0.1:8191/qwen-cn/**. Demo answers and images are synthetic; its temporary database is separate from your personal data. Stop it with Ctrl+C. For real chat and image generation, follow [local service setup](docs/user-guide.md#local-services).

## What you can do

- Chat with local models, stream answers, edit prompts and retry responses.
- Generate and edit images through your existing ComfyUI setup.
- Organize chats, instructions and local files in projects.
- Manage saved memory, conversation history, drafts, gallery and trash.
- Switch between English and Chinese, and light, dark or system appearance.

## Project layout

```text
localgpt/
├── work/chat-sidebar/   application source and backend tests
├── tools/               validation and synthetic demo tools
├── assets/              source artwork
├── docs/                user, agent and release documentation
│   └── history/         previous design and acceptance records
├── AGENTS.md            agent entry point
├── CHANGELOG.md         version history
└── VERSION.txt          canonical application version
```

Models, personal databases, generated images, backups and local configuration stay outside the published source. Existing runtime paths are preserved. See [privacy and storage](docs/PRIVACY.md).

## Versions and documentation

Current version: **0.1.0**. This first versioned baseline organizes the existing application; it does not add new inference features or deploy to an existing installation.

- [User guide](docs/user-guide.md) · [Agent guide](docs/agent-guide.md)
- [Release notes](docs/releases/0.1.0.md) · [Changelog](CHANGELOG.md) · [GitHub Releases](https://github.com/ThineLord/localgpt/releases)
- [Version and release policy](docs/versioning.md) · [Validation](docs/testing.md)
- [Documentation index](docs/README.md)

The interface uses plain JavaScript, HTML and CSS; the backend uses Python/aiohttp and SQLite. Real inference requires separately installed models and local services. Source releases do not bundle those dependencies or migrate your data.
