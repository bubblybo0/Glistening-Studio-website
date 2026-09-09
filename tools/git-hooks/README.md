# Git-hooks

Deze map bevat de git-hooks die met de repo meereizen.

- **pre-commit** — houdt een commit tegen zodra er een em-dash (—) in een
  gewijzigd `.html`-bestand staat (draait `tools/check-em-dashes.mjs`).

## Eenmalig aanzetten (na een verse clone)

Git kijkt standaard in `.git/hooks`, niet hierheen. Zet daarom één keer aan:

```bash
git config core.hooksPath tools/git-hooks
```

Daarna draait de hook vanzelf bij elke commit. Overslaan kan met
`git commit --no-verify`.
