# Version and release policy

## Version source

`VERSION.txt` contains one `MAJOR.MINOR.PATCH` version. Use semantic versioning: PATCH for compatible fixes or documentation releases, MINOR for compatible features, MAJOR for breaking changes. While MAJOR is zero, a breaking change increments MINOR and requires explicit migration notes. Begin at **0.1.0**, the first versioned baseline of the existing application. Historical Round numbers and database schema identifiers are not application versions.

Use `vMAJOR.MINOR.PATCH` for Git tags and GitHub Release names. Tags are immutable: never retarget an existing release; publish a corrective version. A version identifies source, not the installed runtime, database schema, models or dependencies. Do not claim it is the running version without inspecting that installation.

## Preparing a release

1. Work on a `codex/` branch. Update `VERSION.txt`, both home pages, `docs/CHANGELOG.md` and `docs/releases/<version>.md` plus `<version>.zh-CN.md` together. Move the release changes out of `Unreleased`, leaving that section for future work. Include scope, compatibility, upgrade notes and known limitations.
2. Run `python3 tools/check_release.py` and the applicable checks in [testing](testing.md). Stage only intended source files; inspect the diff and run both source audits. Record exact commands and results in the PR. Documentation-only changes do not justify paid CI or real inference.
3. Open a draft PR. A native subagent reviews the exact final commit, checks unresolved findings and repository requirements, then performs the authorized merge. Codex coordinates the release. Do not trigger bots or cloud agents.
4. Fetch the merge result into a clean, isolated checkout. Confirm it is on `origin/main`, its tree matches the reviewed PR tree (or revalidate any difference), and rebuild and rerun the full current synthetic suite there (`.venv/bin/python tools/validate.py`), including release/build verification and source audits. Record the merge SHA. Never release an unmerged feature branch or use a moving branch name as the tag target.
5. Set `VERSION` from `VERSION.txt` and `MERGED_SHA` to that verified full merge SHA. Run `python3 tools/check_release.py --tag "v$VERSION"`. Create the annotated tag at that exact SHA and push only that tag:

   ```sh
   git tag -a "v$VERSION" "$MERGED_SHA" -m "LocalGPT $VERSION"
   git push origin "refs/tags/v$VERSION"
   ```

6. Publish a GitHub source release using `gh release create "v$VERSION" --verify-tag --title "LocalGPT $VERSION" --notes-file "docs/releases/$VERSION.md"`. The English notes link to the separate Chinese notes. Mark it latest only if it is the newest intended stable release. GitHub's automatic source archives are sufficient; do not attach local data, environments, models or screenshots.
7. Read back the release, resolve the remote tag to its commit, and verify both match the reviewed merge SHA. Report the release URL and validation. Do not mark this as deployment.

## Upgrades and rollback

A release note must say whether runtime, configuration or schema behavior changes. Version 0.1.0 is documentation/organization only and preserves all runtime paths. Future runtime releases must document backup, writer compatibility and rollback before installation. Do not restore an old database over newer user activity. Existing runtime maintenance remains a separate authorized action.

No automated deployment or billable CI is configured by this policy. If required remote checks exist, satisfy them or report the blocker; local checks do not silently replace them. Unrelated pending PRs retain their own acceptance gates.
