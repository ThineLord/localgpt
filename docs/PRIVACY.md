# Publication boundary

The source baseline was created in a new, independent Git object database. The original local workspace had no branch commits but did contain application-generated checkpoint refs and objects; none were copied. Only explicitly reviewed runtime source, synthetic test code, dependency metadata and documentation were copied. The original workspace, local configuration and user data remain on the machine.

The private remote is `ThineLord/hanzagent`. Initial main is `946c860537b12e75a42d4aaca4a6bb8c8081144b`. GitHub visibility was verified PRIVATE before the initial push, and remote main SHA was checked against the local commit. Later changes use feature branches and PRs. Never push all refs, mirror, force-push or change visibility.

Excluded from the source copy: personal SQLite databases and sidecars, legacy chat JSON, memory contents, ComfyUI input/output, uploaded attachments, generated imagery (including old decorative material), logs, browser profiles/storage/traces, screenshots, historical backup/source snapshots, local launcher/configuration paths and credentials. The build is generated and ignored; the demo's labeled vector fixture is authored source and contains no private imagery.

The portable demo uses a temporary database and only synthetic dialogue. Real inference acceptance stays local. No screenshot of a live personal sidebar or gallery may be published; local browser acceptance filters the conversation list to dedicated synthetic test conversations before taking live-service screenshots.

Before each publication: inspect the complete staged file list and diff, run `python tools/audit_source.py`, inspect any new assets for provenance, then run `python tools/audit_source.py --history`. These scans detect common credential formats and disallowed paths/file types; they supplement human review and do not claim arbitrary personal text can be recognized automatically.

PR review must bind to the exact commit. UI changes need browser evidence. Inference-affecting work needs Codex local model evidence. CI or agent self-report alone is insufficient. Review/merge automation is pending separate explicit human authorization; no bot or developer receives merge authority from this document.
