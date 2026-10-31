# AI-KIDO skills

Skills for AI-KIDO, installable with `/skill-manage`, plus a list of external
repositories from which compatible skills can be imported.

## Published skills

| Skill | Category | Purpose |
|---|---|---|
| `jira` | integration | Bidirectional JIRA Cloud sync, Agile KPIs, HTML reports |
| `confluence` | integration | Bidirectional Markdown <-> Confluence Cloud sync |
| `drawthing` | generation | Local image generation with the Draw Things macOS app (HTTP API), AI-KIDO website style |
| `aikido-skill-example` | example | Minimal skeleton to copy |

## Layout

| Path | Purpose |
|---|---|
| `catalog.json` | AI-KIDO skills published here, ready to install |
| `sources.json` | External repositories that `/skill-manage` can search and import from |
| `skills/<name>/SKILL.md` | One directory per published skill |

## Use

Point `GIT_GROUP` in `prompts/hard_points/configuration/skills.cfg` at this
repository, then:

```text
/skill-manage search --query <term>
/skill-manage get --skill <name>
/skill-manage get --skill <name> --source <source-id>
```

Skills from `sources.json` are third-party content. `/skill-manage` shows what
will be copied, including scripts, and asks for confirmation. Scripts are never
run automatically.

## Add a skill

1. Copy `skills/aikido-skill-example/` to `skills/<name>/` and edit `SKILL.md`
   (the `name` front matter must equal the directory name).
2. Add an entry to `catalog.json`; bump `version` on every change.
3. Run `node scripts/validate.mjs` and `node --test tests/*.test.mjs`.

## Add an external source

Add an entry to `sources.json` with an HTTPS GitHub `.git` URL, a `layout`
(`skills-dir` for `<root>/<skill>/SKILL.md`, `plugin-marketplace` for
`<root>/<plugin>/skills/<skill>/SKILL.md`), and its `roots`. Only skills are
imported: plugin hooks, MCP servers and agents are not.

## Local staging

`sources/` is a local, git-ignored transfer area used to prepare skills before formalizing them under `skills/`. It is never published.
