# LocalGPT Projects

## Interaction contract

The signed-in ChatGPT web sidebar and Create project dialog were inspected during
implementation. The existing 52px navigation rail and 288px history panel remain;
Projects contains expandable chat groups, project actions, and a new-chat shortcut.
The creation dialog uses a 512px surface, an 18px heading, a name/icon input,
color/icon picker, contextual help and a memory-scope selector. Project pages reuse
the existing composer, typography and theme tokens; their content width is 768px.
Chinese/English, dark/light/system themes and narrow screens remain supported.

Reference: [OpenAI Projects guidance](https://learn.chatgpt.com/docs/projects?surface=web).
The signed-in project home was not fully available for visual measurement. This
is a local implementation of the documented workflow, not a claim of complete
pixel equivalence or access to ChatGPT's private backend.

## Supported behavior

- Create, rename, recolor, choose an icon, pin/unpin, expand and search projects.
- Create project chats; open, rename, search their titles/messages and move
  existing chats between projects or back to ordinary history. Drag/drop and menus
  use the same membership API. Running chats cannot move or have their project
  trashed. Moving out of project-only memory requires an explicit context notice.
- Edit project instructions. They apply to future model requests in that project.
- Add files or pasted text, preview extracted text, download original bytes,
  remove/undo and restore removed sources. Save an assistant answer as a source.
- Use relevant source excerpts and completed chats from the same active project
  in local text generation; answer context badges show the source/chat IDs that
  actually entered the request. Excerpts remain low-trust data, never system text.
- Default memory uses existing global saved memories plus related project chats.
  Project-only memory uses an independent local Memory store, including explicit
  remember/correct/forget commands and the per-message save action. Other projects
  and ordinary chats cannot retrieve those saved memories or project transcripts.
  The scope is immutable after creation. Pausing project memory preserves saved
  rows and excludes saved memories/other chats; files and instructions still apply.
- Deleting a project soft-deletes its active chats and preserves sources and
  memories. Projects → Deleted projects restores the collection, excluding chats
  already in trash before the project was deleted. Ordinary chat restore requires
  restoring its parent project first. No permanent project-delete action exists.
- The project list and the open project's detail refresh with the rest of the
  page about every three seconds. A list or detail response is applied only when
  that read is still the newest one and the page has not navigated since it
  started. An older list does not treat a project opened afterward as moved to
  trash. An older detail does not replace the project now on screen, or a newer
  title already shown for the same project. A failed refresh is reported only
  for the read that is still current. Deleting the project that is still open
  still leaves the page and says it was moved to trash. A list refresh that
  starts while a project open is already in progress does not treat the project
  still painted on screen as the one to leave, and does not cancel that open.
  If the open fails and that deleted project is still the one on screen, a
  refresh leaves the page and says it was moved to trash.

## Retrieval and file limits

Text/code must be UTF-8. PDF text and DOCX paragraphs are extracted locally.
Limits are 10 MiB per source, 100 active sources, 200,000 extracted characters and
300 PDF pages. Encrypted PDFs, image-only scans and unsupported binaries fail with
an explicit message. OCR, image understanding of project sources, spreadsheets,
remote URL fetches, connected cloud drives and collaborative sharing are not
implemented. Existing chat image attachments and ComfyUI remain separate flows.

Retrieval uses a cached SQLite lexical index (including Chinese bigrams), with bounded chunks
and at most eight excerpts within a roughly 2,200-token reference budget. Related
chats consider the latest 150 completed text turns. This is not an embedding index
or exhaustive recall of every file and past chat. The complete request reserves
room for instructions, the current prompt, saved memory and model output within
the app's 8,192-token budget. Overlong inputs/instructions receive a clear error.
Model citation quality and resistance to instructions inside sources are not
guaranteed; the UI badge records the actual injected references independently.

Source chunks and distinct terms are indexed when imported. Existing sources are indexed lazily on their first retrieval, without changing their bytes or text. Soft removal and project scope are checked on every query; restoring a source reuses its index. Retrieval and legacy indexing run in a worker thread so the application event loop remains responsive. The additive `project_source_chunks`, `project_source_terms` and `project_source_index` tables contain rebuildable derived data; they require no external indexing service.

Project context currently applies to text-model responses. Image prompts continue
through the existing ComfyUI pipeline without silently changing workflow settings.

## Storage and compatibility

`project_store.py` adds four core tables plus three rebuildable index tables beside the existing chats. Existing table
schemas, identifiers, transcripts and draft versions are not rewritten by chat
membership changes. Project edits and moves use version checks; project trash and
restore are transactions. Source bytes live in SQLite and soft removal preserves
them. Downloads force attachment/octet-stream with `nosniff`; HTML is never run.
Mutations remain inside the existing loopback/same-origin server boundary.

Before the first Projects schema creation, SQLite's online backup API writes a
checkpoint in `.localgpt-backups` beside the database, including WAL content.
Project-only memory databases live in `.localgpt-project-memory`, keyed by validated
UUIDs, with private file permissions. Back up that directory together with the
main database and existing `.localgpt-profile` assets. These directories, files,
browser storage and all user sources stay out of Git.

The existing `/qwen-cn/` routes, database location, localStorage/sessionStorage
keys, model ownership prefix and local connector configuration remain compatible.
New project expansion state uses `localgpt-projects-expanded`. Transient draft
recovery checks both chat and project identity to avoid crossing memory scopes.
A conflict on a chat that already has a saved draft is kept in that same
`hanz-transient-draft` sessionStorage key, with the local text, the original
base, and a choice that is still waiting. Reloading the tab, choosing the chat
again in the sidebar, opening its project, or starting on that chat asks again.
The saved draft is not replaced, including when another page has changed the
saved text back to the original base. One pending draft is stored in the
original single-record shape. When more than one chat or project is waiting,
including a new chat that does not have an id yet, those drafts share the same
key and are restored only in their own scope. An ordinary edit or save of a
chat that already has an id does not claim the same-project record that still
has no chat id. That claim happens only in the successful POST that creates
the new chat. An explicit save or an explicit choice removes only that scope.

A reference image selected on a saved chat, or on a new chat that still has no
id, is applied only while that same composer is still current. Navigation and
project ownership are both checked, so two projects that each have no current
id cannot receive each other's image. Leaving does not write the image into the
destination, does not create a chat there, and does not replace that project's
draft or mode. Text already entered on the source stays with that source. The
page says the image was not added. If the same new chat gains an id from the
450ms autosave before the upload finishes, and the user has not left, the image
is saved on that chat with the text. If opening another chat fails and the page
is still showing the original chat id, address, and draft, the finished upload
is saved on that chat and the open failure stays as the status. A successful
leave, including returning to the same chat before the upload finishes, still
does not add the image.

## Validation and rollback

`test_projects.py` covers additive schema backup/reopen, stale edits, immutable
memory scope, message/draft-preserving moves, active-generation guards, search,
source extraction/deduplication/restore, scoped retrieval, manual-memory origin
checks, pause behavior, same-origin enforcement, attachment downloads and project
trash/restore. `projects_live_acceptance.py` verifies real local inference with a
random source fact and project-specific instruction on a disposable database.

Browser acceptance uses `projects_demo.py`, with explicitly synthetic responses:
creation/customization, instructions, uploads/downloads, source undo, chat moves,
search, reload persistence, project memory controls, deletion/restore, themes and
mobile layout. `project-refresh` covers a delayed detail or list response that
must not replace a completed navigation or a newer read, a delayed failure for a
request that is no longer current, and deletion of the project still on screen.
It also covers a list that returns while a project open is already in flight,
including when the project still on screen was deleted, and a refresh after
that open fails. `upload-ownership` covers a reference image selected on a
saved chat or a no-id project chat that must not land on another project,
including when both current chats have no id, and a new chat whose autosave
assigns an id before that upload finishes. It also covers a sidebar open that
returns an error and leaves the source chat in place, and a leave to another
chat and back before that upload finishes.
Production acceptance must separately verify the deployed build,
service restart, SQLite integrity, preserved original rows and gallery assets.

For a code rollback, stop only the owned UI service after its queue is idle,
checkout the prior release, rebuild and start the launcher. Keep the current data:
the older runtime can ignore the additive tables. Project chats then appear in
ordinary history, and project-only memories are not consumed by that older code.
Do not overwrite a live database with an old backup after new user activity.
If restoring a database checkpoint is necessary, first stop every writer and
preserve the complete current database plus project memory/profile directories.
