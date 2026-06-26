# Agent Maintenance Notes

This file is for agents maintaining this Chrome extension repository. It is project-local guidance, not a globally registered Codex skill.

## Scope

Maintain the WeChat article capture extension:

- single-article popup capture
- local ZIP downloads
- Feishu cloud-doc sync
- batch queue execution
- CSV export from batch results
- companion service integration

Do not put private local paths, credentials, App Secrets, tokens, or machine-specific runtime state in committed files.

## Product Rules

- The popup is for quick single-article capture. Keep it compact.
- The workbench/options page owns heavier management: batch queue, local settings, Feishu sync/destination, service status, notifications, and CSV export.
- Save modes are explicit:
  - `local`: download ZIP only.
  - `feishu`: create Feishu cloud doc only; do not download a local ZIP.
  - `both`: create both outputs; preserve the local ZIP even if Feishu sync fails.
- Do not reintroduce a hidden "capture then auto-sync" toggle. Local-only must remain local-only.
- Feishu sync must return a cloud-doc URL when successful, and UI should support opening and copying it.
- Local downloads must expose enough result data for showing the downloaded file and copying the local path.

## Batch Queue

- Batch execution must not rely on the currently focused browser tab. Open article tabs inactive, process them one by one, and close them after processing.
- The batch queue stores records in `chrome.storage.local.batchQueue`.
- Batch records should expose clear statuses such as pending, running, success, partial image failure, body failure, sync failure, retry, and skipped.
- The batch page must expose per-run configuration before starting: save mode, local download subfolder, Feishu destination, and Feishu image inclusion.
- Batch defaults to local output and must not silently sync to an implicit Feishu destination.
- Rows with Feishu output should allow opening and copying the cloud doc URL.
- Rows with local output should allow showing the downloaded file and copying the local path.

## CSV Export

- Batch results should be exportable as CSV.
- Provide a predefined field set.
- Persist field visibility and ordering in browser storage.
- Field ordering should use drag-and-drop with visible sequence numbers, not up/down buttons.
- Keep CSV controls in a collapsible section so the main queue stays scannable.

## Workbench UI

- Keep dense controls in collapsible sections.
- Collapsible sections need clear internal padding and gaps. Nested controls such as CSV field cards and reset buttons should not touch the section border or create visually overlapping border lines.
- Avoid stacking too many primary actions at once. Prefer contextual result actions.
- Do not create separate settings, batch, or history pages unless the workbench routes to them deliberately.

## Feishu Integration

- Destination inputs may accept Feishu folder links, wiki node links, raw parent tokens, or `my_library`.
- Recent Feishu destinations should be stored locally and surfaced as quick-switch chips.
- `lark-cli` sync should pass destination as `docs +create --parent-token <token>` or `--parent-position my_library`.
- API/OAuth sync should use the same destination model with `parent_token` / `parent_position`.
- Destination and permission failures should be surfaced with actionable guidance.
- A Chrome extension cannot start arbitrary local processes. The macOS companion is installed by `companion/install.sh` as a `launchd` service; the extension should detect and explain service state rather than claiming it can start the process itself.

## Validation

Before calling extension changes complete, run:

```bash
python3 -m json.tool manifest.json >/dev/null
node --check src/background.js
node --check src/popup/popup.js
node --check src/popup/options.js
python3 -m py_compile companion/feishu_sync_server.py
```
