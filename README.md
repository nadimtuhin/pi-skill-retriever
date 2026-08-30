# pi-skill-retriever

[![npm version](https://img.shields.io/npm/v/pi-skill-retriever.svg)](https://www.npmjs.com/package/pi-skill-retriever)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Keyword-based skill retrieval for the [Pi coding agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent).

Scores your prompt against every discovered skill (name + description) each turn and injects the top matches as a hidden context message telling the agent which `SKILL.md` files to read first.

**Zero LLM calls. Zero config. Works with any number of installed skills.**

## Why

Pi already lists all skills in the system prompt, but with dozens (or hundreds) installed, the model skims past them. pi-skill-retriever surfaces the 3–5 most relevant skills per turn so they actually get loaded.

```
your prompt ──▶ keyword score vs all skills ──▶ top-5 injected as context
                 (name match ×2, description ×1)
```

## Install

```bash
pi install pi-skill-retriever
```

Or manually add to `~/.pi/agent/settings.json`:

```json
{
  "packages": ["npm:pi-skill-retriever"]
}
```

## Commands

| Command | Action |
|---------|--------|
| `/sr` | Show status (on/off, skills indexed) |
| `/sr off` / `/sr on` | Toggle injection |
| `/sr <query>` | Preview what would be injected for a query |

## How it works

1. On `before_agent_start`, reads the full skill list from `systemPromptOptions.skills`
2. Tokenizes the prompt (stopwords dropped)
3. Scores each skill: token found in name = 2, in description = 1
4. Injects top 5 (score ≥ 2) as a hidden message with skill paths and descriptions

Skills with `disable-model-invocation: true` are excluded.

## Tuning

Constants at the top of `src/index.ts`:

- `MAX_INJECT` — max skills per turn (default 5)
- `MIN_SCORE` — injection threshold (default 2)

## Credits

- **[Hermes Agent](https://hermes-agent.nousresearch.com)** skill-retriever plugin (Donald Thompson & contributors, MIT) — the flat-index keyword pre-filter approach this extension adapts from.
- **[Pi coding agent](https://github.com/badlogic/pi-mono)** (Earendil Works / Mario Zechner) — the extension API this builds on.

## License

[MIT](LICENSE) © Nadim Tuhin
