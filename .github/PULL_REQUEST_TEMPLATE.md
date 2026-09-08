## What changed and why

## Checklist

- [ ] `cd neuro-pil && npm install && npm test` and/or `cd akesi-pil && npm install && npm test`
      pass locally, for whichever package(s) this PR touches.
- [ ] If this touches `akesi-pil`'s prompts, updated the golden-file fixtures (see
      [CONTRIBUTING.md](../CONTRIBUTING.md)) rather than letting them drift.
- [ ] If this touches `neuro-pil`'s hashing or graph-validation contract, updated
      [`neuro-pil/ARCHITECTURE.md`](../neuro-pil/ARCHITECTURE.md) to match.
- [ ] Neither package imports the other, and no shared `common/` was introduced (see
      [README.md § What this is for](../README.md#what-this-is-for)).
