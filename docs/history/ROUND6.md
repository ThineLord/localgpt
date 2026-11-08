# LocalGPT — Round 6

## Scope and compatibility

- Home click uses the existing draft-safe `newChat()` flow. Hover still opens the
  temporary history panel; the dedicated toggle controls pinning.
- Empty chat hides the header New Chat button through message state, without an
  invisible hit area or empty SQLite row. Populated chat retains its entry.
- Chat, Gallery, image detail and full-page Settings share the main surface clip.
  Settings categories replace chat-history navigation instead of stacking two sidebars.
  Memory remains a nested modal; the underlying page retains that same boundary.
- Message actions use one original SVG family, icon-only 32px controls, 20px glyphs,
  accessible labels and custom tooltips. User edit is below the user bubble;
  assistant copy/retry and image edit/download are below their corresponding output.
- Avatar upload is local-only, content-validated, size/pixel limited, normalized and
  atomically replaced. Conditional versions prevent stale-window overwrites. No
  database schema or existing message/media deletion semantics change.
- Product UI, title, About, messages, launcher, README and model self-identification
  use LocalGPT. Existing durable identifiers, repository/root/URL, backups and
  historical evidence remain unchanged. Infrastructure renaming needs separate approval.

## Reference and deliberate differences

Signed-in Safari blank-page DOM measurements at 1008×391:

| State | Main x | Rendered clip-path | Background |
|---|---:|---|---|
| Collapsed | 52 | inset(0 round 16px) | rgb(14,14,14) |
| Pinned | 340 | inset(0 0 0 -16px round 16px) | rgb(14,14,14) |

The negative left inset means the pinned surface's visible left edge is square.
LocalGPT follows that edge; its pinned bottom-right corner is also square because
of the user's explicit requirement, a deliberate departure from this reference.
The right-top remains 16px. Collapsed/temporary retain all four 16px corners;
mobile uses square full-width surfaces. Existing Round 5 color/geometry tokens
remain. Message button dimensions and 350ms tooltip timing are calibrated component
targets, not newly measured ChatGPT message DOM. No proprietary SVG/font was copied.
Browser developer features were restored to their original off state after measurement.

## Direct cloud development and independent review

The current round supersedes the historical Axel/Mason routing in COLLABORATION.md.
Only the official Cursor REST API is used. Existing MCP/BDK/GitHub connections and
shell configuration are not changed. No API key is stored in this repository.

Development agent: `bc-4de9fd73-65b6-4ee6-b100-2c9b24d5ae73`.
Initial run: `run-e64b7818-3232-4401-b3c4-fb2a968ab3c2`.
Requested catalog-supported model: `composer-2.5`, `fast=false`; no configurable
reasoning-effort parameter is exposed for this model. Development run FINISHED;
[component PR 13](https://github.com/ThineLord/localgpt/pull/13) is provenance only.
Only the final integrated PR may be merged after independent review and local acceptance.
Run duration was returned; tokens, account remaining allowance and monetary usage
were not returned by the run endpoint and must not be inferred.

## Validation

Synthetic UI: build and run `tools/round5_demo.py --port 8194`. Round 6 browser scripts
cover navigation/surface geometry, message controls and avatar preview/persistence.
Backend avatar tests cover valid formats, corrupt/spoofed/oversized inputs, origin
checks, symlink rejection, stale versions and reset. Existing draft, Memory, lifecycle
and publication tests remain applicable. Browser evidence and local data backups
stay under ignored `output/`; they are not PR attachments.

Independent reviewer: `bc-675b1b7c-fbad-44ae-a8e7-8e02cd639b09`, initial run
`run-b5264722-6a44-456b-a4a4-1ee7acf490df`, same `composer-2.5` / `fast=false`.
The reviewer inspected the actual diff and ran synthetic browser, build, security
and backend tests. Its technical PASS is a normal comment, not GitHub APPROVED.
The exact final head is rechecked after local visual refinements.

Local acceptance includes a real LM Studio response streamed through the candidate
server and reloaded from SQLite using a synthetic prompt. The existing synthetic
ComfyUI output was downloaded and decoded as 512×512; previous real generation
evidence is reused because the generation graph and protocol are unchanged.
Original database rows are compared against a local safety snapshot before deployment.
