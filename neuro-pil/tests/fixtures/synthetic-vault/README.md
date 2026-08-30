# Synthetic vault fixture

Two weather stations feeding one weekend forecast. Used by `neuro-pil/tests/cli.test.ts`,
by the worked example in `neuro-pil/ARCHITECTURE.md`, and by the manual verification commands for
the `neuro-pil` CLI and any external invoker. Entirely synthetic, safe to commit — no real
vault content. This file itself carries no frontmatter, proving `dagFromFiles`/`walkVault`
silently skip files that aren't graph nodes.

`forecast/WEEKEND` declares its inputs `[station/INLAND, station/COASTAL]` in that order on
purpose: the source closure comes back sorted (`station/COASTAL` first), so a test that passes
against this fixture could not be passing by accident of declaration order.
