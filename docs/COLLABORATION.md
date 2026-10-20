# Development and independent review

Codex owns architecture, privacy, local services, integration and visual/function acceptance. Axel coordinates a single Cursor Cloud Agent for scoped frontend work and relays review requests to Mason. Mason reviews independently and performs conditional merges only under separately recorded human authorization.

The authorized repository for this delivery is `ThineLord/hanzagent`. This is not organization-wide permission. Existing bot tools, routines and other projects remain outside this task. Einstein obtained approval to reuse Mason; Kit updated Mason's role description rather than creating a duplicate bot. Those organizational receipts remain in the private coordination conversation.

Cloud task: `bc-ea24cc35-60bd-5f16-ae3f-dc3e23b5e0e9`, branch `cursor/chatgpt-ui-redesign`, [PR 1](https://github.com/ThineLord/hanzagent/pull/1). The agent delivered the neutral layout, composer, responsive styles and flat dialogs. The allowed scope was template, styling, dialog adapter and build; backend and local integration stayed with Codex. Cloud commits were fetched and merged into `codex/local-integration` for local validation. PR 1 itself is read-only review material and must not be merged independently.

After the initial screenshot review, Codex sent measured corrections through Axel. The same agent pushed `d4e914ad1b1e42b8a2926b72af6529a07572b45d`, fixing heading alignment and redundant labels. Codex then corrected the textarea focus treatment and removed invisible shortcuts from keyboard navigation during integration.

Mason independently found the hidden-focus and textarea-outline problems on PR 1, confirmed the allowed file scope and DOM/dialog contracts, and flagged a settings panel overlap. The integrated candidate fixes these, gives the settings panel at least 8px separation from its trigger on desktop, and shows the existing image model hint in image mode while retaining the selected chat model for auto/chat. Initial merge readiness was explicitly withdrawn during these final fixes and must be renewed for the new HEAD.

## Model and cost record

For this already-running task, Axel's launch omitted `model` and `model_params`: requested configuration **DEFAULT**. The actual model ID and effective reasoning effort were not exposed by status/transcript: **UNKNOWN**. Cloud Max Mode is a platform mode, not evidence of a particular model or reasoning effort. Per-task tokens, account quota and charges were unavailable through Axel's tools. No task was restarted and no additional cloud agent was launched.

For future launches, Codex chooses model, explicit supported effort/parameters and cost strategy. Axel must query the current official catalog and validate the exact configuration before launch. Unsupported choices return to Codex for a decision. Record requested configuration, exposed effective values, task ID and available usage; do not infer prices from model names or invent missing usage. Extra subscriptions or paid resources beyond authorized existing service require user approval.

## Merge contract

- Only the final integration PR can be merged for this delivery.
- Mason must inspect the actual diff, task coverage, compatibility and privacy independently. A developer's completion report or green checks alone are insufficient.
- All 21 repository tests must pass on the integrated candidate, with build/syntax checks, browser screenshots and Codex's real local chat/image evidence. No baseline test exception is allowed on the final PR.
- Codex must explicitly accept the exact final HEAD. Mason must recheck HEAD immediately before merging; any change invalidates acceptance.
- Honor branch protection and required checks. No force push, branch/repository deletion, self-approval or protection bypass.
- Expanded permissions, user-data changes, secret handling, extra fees or irreversible actions outside this authorization stop for human approval.
- Return the independent review result, actual merged commit and PR URL through Axel. Codex verifies GitHub, safely fetches/fast-forwards and checks the running frontend.

No GitHub Actions workflow is configured in this baseline; local test and browser receipts are the alternative evidence. A review comment from an independent bot is not automatically a formal GitHub APPROVED review, particularly if bot and PR author share a GitHub account.
