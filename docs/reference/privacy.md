# Privacy and publication boundary

The public repository is `ThineLord/localgpt`. It contains application source, synthetic tests, current documentation and two approved demo screenshots. Personal runtime data stays outside Git. The [historical index](../history.md) preserves earlier migration records without treating old private-repository instructions as current policy.

Never publish personal SQLite databases or sidecars, chat or memory exports, uploaded attachments, ComfyUI output, real model-generated images, local configurations, credentials, logs, browser profiles, traces or backup snapshots. Generated `index.html` and local test evidence are ignored.

## README screenshots

Only `docs/images/workspace.png` and `docs/images/gallery.png` are allowed raster files. They are captures of the real application using a newly created temporary demo database, deterministic synthetic artwork and a fresh browser context. No model service, personal chat, avatar, gallery or browser profile is used. See [provenance and refresh instructions](../images/README.md).

The source audit checks their exact approved SHA-256 values. A changed screenshot fails until its content and provenance are reviewed and its hash is explicitly updated. This is not a general exemption for PNG files or other screenshots. Raw captures and other runtime evidence stay ignored.

## Before publishing

Inspect the complete staged file list and diff, run `python tools/audit_source.py`, review every new asset, then run `python tools/audit_source.py --history`. Pattern and format checks supplement human review; they cannot recognize arbitrary private prose or image content. A repository-visibility review must also inspect commits, tags, PR/comments, releases and Actions artifacts/logs, not only the latest source tree.

Use feature branches and reviewed PRs. Do not rewrite history, push all refs or change repository visibility unless the current task specifically authorizes it. Historic identifiers may survive in Git and PR/edit history even after current documents are cleaned.

The standalone demo is temporary and synthetic. Real inference acceptance requires separate authorization and stays local. Source releases do not authorize deployment or expand data access. Current coordination and independent review follow [AGENTS.md](../../AGENTS.md); archived bot workflows are not active instructions.
