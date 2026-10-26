# APP-03 generation crash recovery

Scope: one host, local filesystem, POSIX `fcntl.flock` (macOS/Python 3.9+ and
Linux). Network/shared filesystems, mixed old/new writers, database replacement,
and physical power loss are not covered. This patch is not a deployment.

## Ownership protocol

Both the standalone runtime and the Comfy extension use
`generation_ownership.py`. Each canonical SQLite path has a persistent sibling
`<database>.generation.lock` (owner-only regular file, no symlink or hardlink).
Never delete, replace, copy, or rotate this lock while either writer may run.
Database symlinks resolve to the same canonical file; hardlinked databases are
rejected. Open descriptors are close-on-exec; no PID/TTL liveness heuristic is used.

Send checks request-key identity, acquires a nonblocking exclusive lock, reconciles
known orphan chat/routing rows, then reserves the message and owner in one
`BEGIN IMMEDIATE` transaction. Owner metadata records a random nonce, protocol
version, and database/lock device+inode identity. The database's existing active
check still arbitrates image jobs and legacy writers. Concurrent duplicate sends
can return the original ID or a transient busy response; retrying the same key
never launches another attempt. A conflicting payload returns 409. Explicit Retry
uses a new key; the old attempt remains visible. This is API idempotency, not a new
browser-side transport retry mechanism.

The lock is transferred to the actual generation task, including memory handling,
model loading and streaming. Completion/cancellation/error writes retire ownership
atomically with the terminal row. A task callback also handles cancellation before
its first instruction. Persistent write failure leaves recoverable metadata and
releases the lock only after work ends. SIGKILL releases the process's descriptors.
SSE observers own no lock and cannot cancel generation by disconnecting.

Reconciliation holds the lock and a SQLite write transaction. Only active `chat`
or `routing` rows with the recognized protocol, nonce shape, and matching stored
file identities can become `failed`. An unknown row makes the whole reconciliation
fail closed. It records a content-free recovery receipt, retires ownership, and
bumps the chat version in the same transaction. Prompt, partial answer, reasoning,
settings, memory results, request key and completed rows are preserved. No model
call or memory effect is replayed. Startup, new sends and orphan Stop share this
logic; repeated reconciliation changes nothing after the first committed recovery.

Image ownership transfers only after `kind=image` commits. The chat lock is held
through the submission task's end, but chat recovery never modifies image active
rows. Existing image queue/history monitoring and uncertain-submission behavior
remain responsible for those rows.

## Schema and legacy compatibility

Two additive tables, `generation_owners` and `generation_recoveries`, are created
in one explicit transaction. Existing message/chat schemas and terminal records
are unchanged by this migration. Foreign keys cascade on deliberate message
removal; recovery receipts contain no message text. The old Store API remains
usable; reserve calls without an owner are explicitly **not** recoverable under
the new protocol. No automatic adoption, TTL cleanup or recovery script is shipped.

An old active row without owner metadata is `ownership_unknown`, even if it is
very old. A lock cannot prove that a writer ignoring this protocol has stopped.
File identity mismatch after restore/replacement is also unknown, not dead.

A future deployment requires separately authorized coordinated maintenance:
stop both old writers, confirm all model/image work is quiescent, make a proper
SQLite backup including committed WAL state, upgrade both runtime and installed
Comfy extension together (include `generation_ownership.py`), and deliberately
handle any unknown legacy active rows with a reviewed offline migration and
receipt. Start both upgraded writers and run runtime acceptance. Do not perform
a rolling upgrade or run an old extension's unconditional startup sweep against
new live tasks. This PR neither provides nor executes that production procedure.

## Readiness and Stop

Health probes SQLite separately. `database_ready` describes database access;
`generation_recovery_ready` and `generation_recovery_state` describe ownership:
`ready`, `busy`, `recovery_required`, `ownership_unknown`, or `unavailable`.
Top-level `ready` is false while generation recovery is not ready. Health does not
recover rows. It can create/check the lock file; it does not modify chat contents.
Image availability and model availability are not implied by recovery readiness.
A known orphan Stop can recover locally even if Comfy is offline. Unknown ownership
returns `requested=false`/409. Live local tasks still cancel normally; runtime
forwards a busy remote chat Stop to the other entry point without claiming success
when that owner cannot be reached.

## Validation

Run with only temporary SQLite and mock services:

```sh
python work/chat-sidebar/build.py
python work/chat-sidebar/build.py --check
python -m unittest discover -s work/chat-sidebar -p 'test_*.py' -v
python -m unittest discover -s tools -p 'test_*.py' -v
```

`test_generation_ownership.py` exercises transaction/lock boundaries using separate
processes. `test_generation_recovery_http.py` uses real isolated runtime processes
and mock loopback services. Its worker rejects production paths, non-fixture SQLite,
non-mock network and model subprocesses. The same strict crash-recovery assertion
can run against an unmodified historical source via `APP03_SOURCE`; failure there
and success on this patch must be recorded separately. Historical G3 “expected
bug reproduced” results are not a patch pass. Test logs and the exact-SHA review
receipt belong to the integration handoff.
