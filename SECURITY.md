# Security Policy

## Supported versions

Only the latest published version of each package (`@pablotech/akesi`, `@pablotech/neuro`)
is supported.

## Scope

Neither package handles credentials or PHI directly. `akesi-pil` issues model calls but constructs
no client and reads no key — the client is supplied by the host — so a report about a leaked key or
credential is almost certainly about the host application, not this repo. In scope here: a way to
get `akesi-pil`'s response enforcement to accept output that violates a stated constraint, or a way
to make `neuro-pil`'s staleness/hashing report a stale value as valid (or vice versa).

## Reporting a vulnerability

Please use GitHub's [private vulnerability reporting](https://github.com/pablo-tech/pilos/security/advisories/new)
rather than opening a public issue. Include the package, version, and a minimal reproduction.

There is no bug bounty. We aim to acknowledge reports within 5 business days.
