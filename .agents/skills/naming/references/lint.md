# Lint

Rule numbers refer to [SKILL.md](../SKILL.md).

## Machine: the CI gate `naming`

`bundles/workflow/rules/naming.sh` in the hub, run on the files changed in the PR. It reads [naming.json](naming.json) merged with the repo's `.skilly/naming.json` (merge rules in [SKILL.md](../SKILL.md), Per-project overrides).

| Check | Rule | JSON key | Level |
| --- | --- | --- | --- |
| File and folder names kebab-case | 11 | `artifacts.file.case`, `artifacts.folder.case` | error |
| Banned short words and single-letter declared names | 4 | `shortWords` | error |
| Noise-word suffix | 3 | `noiseWords` | error |
| `enum` | 9 | none | error |
| `I` or `T` prefixed type name | 3 | none | error |
| Banned verb synonym, replaced by the value | 6 | `synonyms` | error |
| Env var shape in `.env*.example` | 10 | `artifacts.env.roles`, `artifacts.env.shape` | error |
| `type:` used as discriminant | 9 | `discriminant` | warning |

### Exceptions

`allow` in `.skilly/naming.json`: one regex string per entry, matched against identifier, env name and file path. A match silences every check for it.

```json
{ "allow": ["^MERGED$", "^ctx_"] }
```

## Machine: Biome, opt-in

Consumers on Biome 2.x merge [biome.json](biome.json) into theirs. It covers kebab-case file names, no `I`/`T` prefix on interfaces and type aliases, camelCase functions, PascalCase types, CONSTANT_CASE top-level consts, `noEnum` and `noMagicNumbers`. All rules live in the `style` group. Biome's `match` regex has no lookahead, so the prefix ban is written as a positive pattern.

## Agent

| Rule | What you judge |
| --- | --- |
| 1 | The word matches `CONTEXT.md`, and the repo's word won over the request's |
| 2 | A new word went through term-check and the user signed it off |
| 3 | The name says the role, not the type |
| 5 | The name repeats nothing the call site says |
| 6 | A noun-named function is a pure derivation, not an action |
| 7 | A bare adjective is stored state; a prefixed name is a check |
