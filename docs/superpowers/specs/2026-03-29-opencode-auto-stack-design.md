# OpenCode Auto Stack Design

## Goal

Make the current OpenCode setup feel as automatic as possible without adding unstable meta-layers or forcing aggressive orchestration on ordinary tasks.

The desired mode is conservative automation:
- important guidance is already present when relevant
- useful tools are already wired and available
- safety and context hygiene run automatically
- heavyweight orchestration remains available but secondary

## Current Stack

The active setup already has strong building blocks:

- `superpowers` as the main behavior layer
- `@openspoon/subtask2` for lightweight orchestration
- `swarm` wired through `~/.config/opencode/plugin/swarm.ts`
- `envsitter-guard` for `.env` safety
- `@tarquinen/opencode-dcp` for context pruning
- `opencode-mem` for memory
- `opencode-notify` for session notifications
- `playwright-hybrid.js` for browser-task guidance injection
- MCP integrations for `context7`, `playwright`, and `firecrawl-mcp`

This is already close to the target state. The design should preserve that shape rather than adding a second behavior system.

## Problem

The user wants a setup that feels automatic without needing to remember when to use each capability manually.

The risk is that adding more injected meta-guidance or automation plugins can make the environment less stable:
- multiple behavior layers may conflict
- orchestration may trigger too eagerly
- prompt overhead may grow
- debugging becomes harder when behavior comes from too many places

## Recommended Approach

Use a single-primary behavior model with secondary capability layers.

### Primary behavior layer

Keep `superpowers` as the only main process-enforcement layer.

It already does the highest-value automatic work:
- deciding when skills matter
- enforcing process discipline
- shaping agent behavior before tool use

No new plugin should compete with this role.

### Secondary auto-guidance layers

Allow narrowly scoped automatic guidance only where the trigger is clear and local.

In the current setup this includes:
- `playwright-hybrid.js` for browser-specific decision guidance
- `envsitter-guard` for secret-handling protection
- `@tarquinen/opencode-dcp` for context hygiene
- `opencode-notify` for background usability

These are good because they solve bounded problems and do not try to replace the main behavior layer.

### Orchestration policy

Keep orchestration split by task weight:
- `subtask2` is the default lightweight automation path
- `swarm` stays installed, healthy, and ready, but secondary

`swarm` should not be promoted into an always-preferred workflow for normal tasks. It is reserved for larger, clearer multi-agent coordination work.

## Scope

### In scope

- Preserve the current stable plugin list
- Preserve the current MCP list
- Keep browser-specific auto-guidance
- Keep swarm installed and wired
- Ensure config-path compatibility after `swarm setup`
- Add only minimal automation glue if a real gap is found

### Out of scope

- Adding another broad behavior-enforcement plugin
- Creating a new global injected prompt layer for every capability
- Making `swarm` the default orchestration path for ordinary tasks
- Adding more MCP servers just to increase automatic behavior

## Chosen Design

### Keep as-is

These should remain enabled because they are already stable and valuable:

- `superpowers`
- `opencode-mem`
- `@openspoon/subtask2`
- `envsitter-guard`
- `@tarquinen/opencode-dcp`
- `opencode-notify`
- `context7` MCP
- `playwright` MCP
- `swarm` integration files

### Keep, but treat as optional utility

- `firecrawl-mcp`
- `rovodev-auth.js`
- `playwright-hybrid.js`

`playwright-hybrid.js` should stay because it is a good example of narrowly scoped auto-awareness. The others remain available because they add capability rather than meta-control.

### Do not add now

- extra meta-awareness plugins
- extra memory plugins
- more orchestration systems
- more MCP layers whose main purpose is telling the agent what to do

## Compatibility Rule

`swarm setup` changed the global skills directory from `skills/` to `skill/`. The environment should preserve compatibility for both paths so older bootstrap logic and newer swarm expectations can coexist.

The current compatibility junction is acceptable and should remain in place unless OpenCode itself later standardizes on one path.

## Runtime Behavior Expectations

After this design is applied, the expected behavior is:

1. Skills and process guidance are automatically discovered through `superpowers`.
2. Browser work automatically follows the Playwright hybrid rule.
3. Secret-sensitive `.env` work is guarded automatically.
4. Context pruning happens automatically in long sessions.
5. Notifications are available automatically for long-running tasks.
6. Lightweight orchestration is available through `subtask2`.
7. Heavy orchestration is available through `swarm`, but only when clearly useful.

## Minimal Implementation Plan

Implementation should stay small:

1. Audit existing auto-guidance hooks and keep only the useful ones.
2. Preserve compatibility of config directories introduced by `swarm setup`.
3. Avoid adding new global behavior injections unless they solve a concrete missing trigger.
4. Re-verify config health after any change.

## Verification

Minimum verification for this setup work:

- confirm `opencode.json` remains valid JSON
- confirm `swarm config` shows all integration files present
- confirm `swarm doctor` reports required dependencies healthy
- confirm no removed integration like Serena remains in OpenCode config

## Acceptance Criteria

- The current setup remains stable after automation tuning.
- No second broad behavior layer is introduced.
- `superpowers` remains the primary automatic decision layer.
- Browser, safety, context, and notification automation remain available.
- `swarm` remains installed and ready but secondary.
- The setup feels more automatic without becoming more aggressive.
