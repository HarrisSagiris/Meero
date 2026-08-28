@AGENTS.md

## gstack (recommended for maintainers — optional)

Core maintainers use [gstack](https://github.com/garrytan/gstack) for its
AI-assisted workflows (`/qa`, `/ship`, `/review`, `/investigate`, `/browse`).
It is **not required** to build, run, test, or contribute to Meero — the
standard commands in `CONTRIBUTING.md` are the source of truth for that.

If you want the gstack skills available in your AI coding tool:

```bash
git clone --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
cd ~/.claude/skills/gstack && ./setup --team
# then restart your AI coding tool
```

When gstack is installed: prefer `/browse` for web browsing, and use
`~/.claude/skills/gstack/...` for gstack file paths (the global path). When it
is not installed, ignore any gstack references and proceed normally.
