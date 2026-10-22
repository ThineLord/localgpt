# LocalGPT repository migration — 2026-10-22

## Administrative operation

The existing private repository was renamed in place using GitHub's official
`PATCH /repos/ThineLord/hanzagent` operation with only `name=localgpt`.
Canonical address: https://github.com/ThineLord/localgpt . Repository ID
`1427359362` and node ID `R_kgDOVRPGgg` are unchanged. No repository was recreated,
no history was rewritten, and no permissions or visibility were changed.
The pre-migration accepted main was `86199dcb6f572d4cc71759efa52f5d736f9aba09` (PR #20).

Immediately after rename, all 22 original branch names/SHAs and all 20 PR IDs
were preserved. Tags, issues, releases, deployments, rulesets, hooks, deploy keys,
Actions workflows and runs were empty before and after. Collaborator permissions
and Actions permissions matched the checkpoint. Maintenance adds its own branch
and PR normally; it does not delete historical branches. The old repository API
address resolves to the same repository under the new name. Controlled remotes
and navigable documentation links now use the canonical address.

GitHub's [rename documentation](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository)
explains redirect behavior. Do not reuse the old repository name: doing so would
remove that redirect. GitHub Pages and hosted reusable Actions were not present.

## PR #8 disposition

[PR #8](https://github.com/ThineLord/localgpt/pull/8) was the only open PR at audit.
It is closed, unmerged, with an English archival comment. Its head
`5293bf7e22706da8de532d6f2babe00c7c415233` and branch
`cursor/round4-memory-settings` are retained.

The three files in that candidate are byte-identical to integration commit
`6bbe9f66ace953b4d2703479bc44c23d7c9d0ec0`, delivered through PR #9 (`23740de`).
Later PR #9 commits wired the styles/navigation and added translation and
repeatable synthetic acceptance (`33f3da1`, `7024e9f`). Round 5 PRs #11/#12 refined
the shell and gallery; PR #14 (`8f39a0a`, implementation `bdbd8f5`) added LocalGPT
branding/profile; PR #18 (`d03730b`, including `f4da40f`, `0959308`, `d20994f`)
replaced the memory UI with the personalization manager and strengthened memory
command/conflict behavior. PRs #19/#20 retained that functionality.
No unique candidate feature required extraction. Merging the obsolete dialog
implementation would regress the current architecture.

## Checkout and local entrypoints

The primary checkout changed from `work/hanzagent-repository` to
`work/localgpt-repository` under the existing local workspace. A relative symlink
at the old name supports saved shortcuts and historical tool references. The
new checkout does not depend on that link. Git remote `origin`, three linked
worktree administrative pointers, and generated virtualenv activation/pip entry
points use the new checkout path. The virtualenv interpreter and installed
package versions are unchanged.

Use `Start LocalGPT.command` in the repository, or the workspace wrapper
`outputs/启动LocalGPT.command`. The previous Chinese-named launcher delegates to
the new wrapper. The workspace README points at the new repository and clearly
separates the earlier Liquid Glass record from current launch instructions.
No external agent or reviewer was started for this maintenance task.

## Deliberately retained compatibility

| Identifier | Reason |
| --- | --- |
| `/qwen-cn/`, health `service: hanzagent` | Existing routes, launcher ownership checks and external clients |
| `qwen-studio.sqlite3`, original database/input/output paths | Preserve all chats, messages, drafts, memory, gallery relationships and deletion journals |
| `HanzAgent/runtime.json` and `HanzAgent/service.log` in Application Support | Reuse the known database cache, including when ComfyUI is offline |
| `hanzagent-options`, `hanz-transient-draft`, `qwen-studio-*` and existing navigation keys | Preserve model choices, browser drafts, theme/language and navigation preferences |
| LM Studio `hanzagent-` instance IDs | Preserve ownership checks and avoid unloading unrelated models |
| input subfolder `hanzagent`, `hanz-ref-` files and `hanzagent-upload-recovery` | Existing image references and recovery receipts validate these exact names |
| `hanz-diagnostics-refresh`, `hanzlanguage`, `HANZ_FAVICON` | Internal event/build contracts; no visible brand or data migration benefit |
| `qwen-local-app` installation name | Existing ComfyUI extension registration |
| Historical prose, commits, branch names and archived screenshots | Preserve original provenance, not a current product label |

The generated visual-report title now uses LocalGPT; earlier report artifacts remain unchanged.
The build-only logo file is now `assets/localgpt-mark.svg`; its bytes are unchanged.
New synthetic preview directories use `localgpt-demo-`. No database schema,
frontend behavior, inference settings or model installation changed. Existing
`.localgpt-profile` avatar storage is already branded correctly and stays in place.

## Verification and recovery

Local-only checkpoints contain the verified complete Git bundle, administrative
before/after inventories, an SQLite online backup, all-table row counts/logical
fingerprint, runtime-cache/profile copies, and media hashes. No private data or
machine-specific runtime configuration is committed to this repository.

Validation covers build freshness, preview/health and persistence/media/profile
regressions with isolated fixtures; direct API and browser checks use read-only
real data. The production SQLite integrity result and every table count must
match before/after; content fingerprints strengthen that check. Verify the new
path can build and launch, 8190 can restart and reload, and all existing gallery
raster assets remain readable. No full visual matrix or new model inference is
required for this name migration. ComfyUI was offline before maintenance; cached
history/gallery operation must continue, and that pre-existing condition is not
a migration failure. LM Studio was reachable on its existing port.

Rollback code through a reviewed revert of the maintenance PR, rebuild, and
restart only the verified 8190 UI process. The database did not migrate: do not
restore its backup unless actual corruption is demonstrated, and preserve any
newer user data before recovery. The source-only Git bundle is the fallback for
lost refs. If undoing the directory rename, stop only the owned UI, remove the
compatibility symlink, move the checkout back, repair worktree/virtualenv paths
and launcher pointers, and restart. If undoing the remote rename, first verify
the old name is still free, rename the same repository back, and update remotes.
Never force-push or delete evidence to perform rollback.

### Completed acceptance

- 79 existing targeted tests passed: preview (2), health (5), offline images (5),
  profile (5), upload recovery (9), chats/drafts (8), Round 7 memory (39), source
  publication guard (6). Build/check, Python compilation, shell syntax and an
  isolated synthetic demo startup also passed.
- The new checkout built and launched while the old symlink was temporarily
  unavailable; all three linked worktrees resolved independently. The owned UI
  stopped gracefully and restarted from the new path; five consecutive HTTP
  reloads returned the exact built page.
- SQLite integrity passed. All table counts and the full logical database digest
  matched. Chat, memory, gallery and profile API payloads matched; media/profile
  hashes and runtime cache bytes matched. Every unique existing gallery image
  returned HTTP 200.
- An independent browser verified existing chats, gallery reload, loaded images,
  profile avatar, Memory settings, English language and the pre-existing dark
  appearance. No persistent user settings were changed, no live memory or chat
  fixture was created, and no inference was requested.
- The old repository REST URL returned HTTP 301 to the same numeric repository
  identity; the canonical repository and Git fetch were accessible. There is no
  configured GitHub Actions workflow; local evidence is not a CI claim.
