# CrewDock PostHog Telemetry

CrewDock can send anonymous product analytics to PostHog from the Tauri backend.

## Setup

1. Open `Settings`.
2. Go to the `Workbench` section.
3. In `PostHog telemetry`, paste your PostHog project API key.
4. Keep the default host `https://us.i.posthog.com` for US Cloud, or replace it with your PostHog ingest host.
5. Enable anonymous analytics.

## Events

CrewDock currently emits:

- `app_opened`
- `workspace_created`
- `workspace_switched`
- `codex_session_started`
- `codex_session_resumed`
- `git_commit_succeeded`

## Shared properties

Every telemetry event includes:

- `app_version`
- `os`
- `arch`
- anonymous `distinct_id`

## Data not sent

CrewDock does not send:

- repo paths
- filenames
- terminal output
- commands
- prompts
- commit messages
- API keys

## Notes

- Telemetry is disabled until you enable it in Settings.
- The anonymous install ID is generated locally and persisted on the device.
