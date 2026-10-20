# Local acceptance evidence

Validation was performed on 2026-10-21 using synthetic prompts and dedicated test conversations. Screenshots, raw receipts, databases and generated images stay outside Git. This document records observations; final merge approval is sent separately for an exact commit SHA.

## Visual and browser checks

The ChatGPT guest interface was directly observed at 1440×900 and 390×844, including dark appearance. The implemented desktop uses a 260px sidebar and 768px input shell, with the empty-state heading top at y386 and input shell top at y462. The input is taller than the reference to accommodate HanzAgent's real mode, model, reference and settings controls. No brand assets or fake feature entries were copied.

`tools/browser_acceptance.js` is a Playwright CLI `run-code` function for the synthetic demo on port 8191. It checks real DOM interaction, not screenshot hashes. Coverage includes desktop empty/populated states, streamed partial text, code copy, edit, stop, regenerate, durable long drafts, sidebar collapse/mobile drawer, dialog focus return, light/dark/system changes, language, memory, image progress/result/download, gallery editing, reference removal and conversation rename/trash/restore. Layout checks cover 320/390/768/1440px widths. Screenshots are written to ignored `output/playwright`.

Codex inspected rendered desktop, dark and mobile screenshots, fed layout findings to Axel, retrieved the correction commit and repeated browser acceptance. No page errors or horizontal overflow were observed in the accepted run.

## Real services

LM Studio with the existing qwen3-8b configuration completed a synthetic chat. The API observer received 22 SSE events, observed partial text and a completed persisted answer. A separate browser send also showed partial streaming and completion; the browser uploaded a locally generated test reference, loaded its preview and removed it.

The existing ComfyUI image model completed a synthetic green ceramic mug prompt at 512×512, 15 steps, CFG 1 and seed 42. The stored image was retrieved with HTTP 200 and decoded/displayed in the real frontend. The original model files, credentials and inference settings were not changed.

The image test harness initially failed while serializing nested image metadata into URL parameters after generation had completed. The harness was fixed to pass only the supported fields and retrieved the same output; no second generation was needed. The image SSE event count was not retained, so it is not claimed as verified. Visible image progress and stop behavior were additionally exercised with the synthetic demo.

## Reproducibility and limits

The remote private repository was independently cloned, its requirements installed in a fresh virtual environment, the frontend built and its demo opened in a browser. The 21 repository tests cover storage migration, persistence, drafts/conflicts, memory, origin checks, streaming, cancellation and routes. Build equality, JavaScript syntax and staged/reachable-history source audits supplement these checks.

An initial system-Python test invocation failed to import aiohttp; the installed clone virtual environment was then used successfully. Cloud-side unit-test execution did not produce a valid final result, so acceptance relies on Codex's local tests. No CI success is claimed.

The real image run proves text-to-image and output display, while real upload proves reference handling; a new model inference using that reference was not performed. ChatGPT comparison is to the observed guest interface, not every authenticated product state. Existing Markdown remains an escaped subset. Real model setup is machine-specific; the portable demo is the independent clone entrypoint.
