# HEADINGS.md

**Every `##` and `###` heading in this repository, grouped by document — the fallback for a
question whose subject is unknown.** 118 headings across 13 documents, written whole by
`plover-context`'s `infra/retrieval/gen_headings.py` and edited by hand nowhere. It is a projection
and not a source: a figure read here carries the date the projection was generated, which
`git log -1 --format='%h %ad' HEADINGS.md` answers off the tree rather than out of the text.

[`AGENTS.md`](AGENTS.md) beside it is the entry point, and its three ranked commands come first —
they answer a word that appears in no heading at all, which this cannot.

**The headings sort into three kinds, and knowing which one a hit is saves opening the wrong
document.** A heading in a package's `README.md` is a numbered step of a worked example, so the
answer under it is a demonstration. A heading in a package's `ARCHITECTURE.md` is a contract, so
the answer under it is a rule the code is held to — including the two `Explicitly out of scope`
sections, which are where a question about something this repository deliberately does not do is
answered. A heading in `BENCHMARKS.md` names a measurement and carries a number, and the number is
the point: the section above it says what a row has to do to be on the page at all.

- **[AGENTS.md](AGENTS.md)**
    - [Three ways in, in this order](AGENTS.md#three-ways-in-in-this-order)
        - [The words a question uses](AGENTS.md#the-words-a-question-uses)
        - [What may be read, and how a hit may be quoted](AGENTS.md#what-may-be-read-and-how-a-hit-may-be-quoted)
    - [Known gaps — what this layer does not route](AGENTS.md#known-gaps--what-this-layer-does-not-route)
- **[ARCHITECTURE.md](ARCHITECTURE.md)**
    - [Two packages, no edge between them](ARCHITECTURE.md#two-packages-no-edge-between-them)
    - [Building a brain](ARCHITECTURE.md#building-a-brain)
        - [Step 5 is the only seam that crosses](ARCHITECTURE.md#step-5-is-the-only-seam-that-crosses)
- **[BENCHMARKS.md](BENCHMARKS.md)**
    - [What a row has to do to be on this page](BENCHMARKS.md#what-a-row-has-to-do-to-be-on-this-page)
    - [Deterministic — neuro-pil](BENCHMARKS.md#deterministic--neuro-pil)
        - [The guarantee — nothing that changed goes unreported](BENCHMARKS.md#the-guarantee--nothing-that-changed-goes-unreported)
        - [The price — 43.6% wasted, against 82.3% for regenerating everything](BENCHMARKS.md#the-price--436-wasted-against-823-for-regenerating-everything)
        - [The two ways to lose the guarantee](BENCHMARKS.md#the-two-ways-to-lose-the-guarantee)
        - [Three further rows, each pricing something previously stated without a number](BENCHMARKS.md#three-further-rows-each-pricing-something-previously-stated-without-a-number)
    - [Sampled — akesi-pil](BENCHMARKS.md#sampled--akesi-pil)
        - [Pre-registration — recorded before the run](BENCHMARKS.md#pre-registration--recorded-before-the-run)
        - [Result — run 2026-08-30](BENCHMARKS.md#result--run-2026-08-30)
        - [The seam](BENCHMARKS.md#the-seam)
    - [Not yet measured](BENCHMARKS.md#not-yet-measured)
- **[CHANGELOG.md](CHANGELOG.md)**
    - [[Unreleased]](CHANGELOG.md#unreleased)
    - [[0.1.0] - 2026-08-29](CHANGELOG.md#010---2026-08-29)
- **[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)**
    - [Our Pledge](CODE_OF_CONDUCT.md#our-pledge)
    - [Our Standards](CODE_OF_CONDUCT.md#our-standards)
    - [Enforcement Responsibilities](CODE_OF_CONDUCT.md#enforcement-responsibilities)
    - [Scope](CODE_OF_CONDUCT.md#scope)
    - [Enforcement](CODE_OF_CONDUCT.md#enforcement)
    - [Attribution](CODE_OF_CONDUCT.md#attribution)
- **[CONTRIBUTING.md](CONTRIBUTING.md)**
    - [Running a package standalone](CONTRIBUTING.md#running-a-package-standalone)
    - [Benchmarks](CONTRIBUTING.md#benchmarks)
    - [Golden-fixture regeneration](CONTRIBUTING.md#golden-fixture-regeneration)
    - [Move commits](CONTRIBUTING.md#move-commits)
    - [Pull requests](CONTRIBUTING.md#pull-requests)
    - [Inbound contributions: sign off, don't sign a CLA](CONTRIBUTING.md#inbound-contributions-sign-off-dont-sign-a-cla)
    - [Releases](CONTRIBUTING.md#releases)
- **[README.md](README.md)**
    - [What this is for](README.md#what-this-is-for)
    - [Checking what came back — akesi-pil](README.md#checking-what-came-back--akesi-pil)
    - [Tracking what it came from — neuro-pil](README.md#tracking-what-it-came-from--neuro-pil)
    - [What has actually been measured](README.md#what-has-actually-been-measured)
    - [On the names](README.md#on-the-names)
    - [Packages](README.md#packages)
    - [License](README.md#license)
- **[SECURITY.md](SECURITY.md)**
    - [Supported versions](SECURITY.md#supported-versions)
    - [Scope](SECURITY.md#scope)
    - [Reporting a vulnerability](SECURITY.md#reporting-a-vulnerability)
- **[START-HERE.md](START-HERE.md)**
    - [A · You don't write code, and you're curious](START-HERE.md#a--you-dont-write-code-and-youre-curious)
        - [The problem, as a situation you have already had](START-HERE.md#the-problem-as-a-situation-you-have-already-had)
        - [What is actually in it](START-HERE.md#what-is-actually-in-it)
        - [What it is not](START-HERE.md#what-it-is-not)
        - [Seven words, decoded](START-HERE.md#seven-words-decoded)
        - [If you want the version written for engineers](START-HERE.md#if-you-want-the-version-written-for-engineers)
    - [B · You write code and want to see it work](START-HERE.md#b--you-write-code-and-want-to-see-it-work)
        - [Sixty seconds, from clone to a real result](START-HERE.md#sixty-seconds-from-clone-to-a-real-result)
        - [Then the actual tutorial](START-HERE.md#then-the-actual-tutorial)
        - [Then read, in this order](START-HERE.md#then-read-in-this-order)
        - [The one thing that is not obvious](START-HERE.md#the-one-thing-that-is-not-obvious)
- **[akesi-pil/ARCHITECTURE.md](akesi-pil/ARCHITECTURE.md)**
    - [1. This package's role: derive, don't decide](akesi-pil/ARCHITECTURE.md#1-this-packages-role-derive-dont-decide)
    - [2. The layering](akesi-pil/ARCHITECTURE.md#2-the-layering)
    - [3. The prompt contract](akesi-pil/ARCHITECTURE.md#3-the-prompt-contract)
        - [Determinism, and what actually makes goldens possible](akesi-pil/ARCHITECTURE.md#determinism-and-what-actually-makes-goldens-possible)
    - [4. The response contract](akesi-pil/ARCHITECTURE.md#4-the-response-contract)
    - [5. The convergence contracts](akesi-pil/ARCHITECTURE.md#5-the-convergence-contracts)
        - [Marker grouping — runMarkerGroupingPasses](akesi-pil/ARCHITECTURE.md#marker-grouping--runmarkergroupingpasses)
        - [Finding generation — generateFindingResponse](akesi-pil/ARCHITECTURE.md#finding-generation--generatefindingresponse)
    - [6. The model seam](akesi-pil/ARCHITECTURE.md#6-the-model-seam)
    - [7. Safety invariants](akesi-pil/ARCHITECTURE.md#7-safety-invariants)
    - [8. The host's job: a brain registry](akesi-pil/ARCHITECTURE.md#8-the-hosts-job-a-brain-registry)
    - [9. Explicitly out of scope](akesi-pil/ARCHITECTURE.md#9-explicitly-out-of-scope)
- **[akesi-pil/README.md](akesi-pil/README.md)**
    - [One patient, end to end](akesi-pil/README.md#one-patient-end-to-end)
        - [1. What arrives](akesi-pil/README.md#1-what-arrives)
        - [2. Normalize the units, where a bug is a clinical error](akesi-pil/README.md#2-normalize-the-units-where-a-bug-is-a-clinical-error)
        - [3. Bucket by time](akesi-pil/README.md#3-bucket-by-time)
        - [4. What the model actually sees](akesi-pil/README.md#4-what-the-model-actually-sees)
        - [5. The round trip that has to converge](akesi-pil/README.md#5-the-round-trip-that-has-to-converge)
        - [6. What comes back, and what is checked](akesi-pil/README.md#6-what-comes-back-and-what-is-checked)
    - [Seven prompts, one discipline](akesi-pil/README.md#seven-prompts-one-discipline)
    - [Measured](akesi-pil/README.md#measured)
    - [When the model gets it wrong](akesi-pil/README.md#when-the-model-gets-it-wrong)
    - [The dose rule](akesi-pil/README.md#the-dose-rule)
    - [Where neuro-pil comes in](akesi-pil/README.md#where-neuro-pil-comes-in)
    - [Module map](akesi-pil/README.md#module-map)
    - [Importing](akesi-pil/README.md#importing)
    - [Tests](akesi-pil/README.md#tests)
    - [License](akesi-pil/README.md#license)
- **[neuro-pil/ARCHITECTURE.md](neuro-pil/ARCHITECTURE.md)**
    - [1. Node/vault schema](neuro-pil/ARCHITECTURE.md#1-nodevault-schema)
    - [2. Canonical hashing algorithm](neuro-pil/ARCHITECTURE.md#2-canonical-hashing-algorithm)
        - [2a. Deterministic stringification (stableStringify)](neuro-pil/ARCHITECTURE.md#2a-deterministic-stringification-stablestringify)
        - [2b. What gets hashed for a given node — the source closure](neuro-pil/ARCHITECTURE.md#2b-what-gets-hashed-for-a-given-node--the-source-closure)
        - [2c. The hash itself (sha256hex12)](neuro-pil/ARCHITECTURE.md#2c-the-hash-itself-sha256hex12)
        - [2d. Which nodes get hashed at all — isStamped](neuro-pil/ARCHITECTURE.md#2d-which-nodes-get-hashed-at-all--isstamped)
        - [2e. The stamp file](neuro-pil/ARCHITECTURE.md#2e-the-stamp-file)
    - [3. CLI contract](neuro-pil/ARCHITECTURE.md#3-cli-contract)
        - [3a. The rule catalogue](neuro-pil/ARCHITECTURE.md#3a-the-rule-catalogue)
        - [3b. Mermaid output](neuro-pil/ARCHITECTURE.md#3b-mermaid-output)
        - [3c. Conformance vectors, sketched](neuro-pil/ARCHITECTURE.md#3c-conformance-vectors-sketched)
    - [4. Explicitly out of scope](neuro-pil/ARCHITECTURE.md#4-explicitly-out-of-scope)
    - [Lineage](neuro-pil/ARCHITECTURE.md#lineage)
- **[neuro-pil/README.md](neuro-pil/README.md)**
    - [Tutorial — a vault from scratch](neuro-pil/README.md#tutorial--a-vault-from-scratch)
        - [1. Declare three nodes](neuro-pil/README.md#1-declare-three-nodes)
        - [2. Check the graph holds together — lint](neuro-pil/README.md#2-check-the-graph-holds-together--lint)
        - [3. See it — mermaid](neuro-pil/README.md#3-see-it--mermaid)
        - [4. Record a baseline — stale --update](neuro-pil/README.md#4-record-a-baseline--stale---update)
        - [5. Change the evidence](neuro-pil/README.md#5-change-the-evidence)
        - [6. Now change the forecast's prose](neuro-pil/README.md#6-now-change-the-forecasts-prose)
        - [7. Script it — --json](neuro-pil/README.md#7-script-it----json)
    - [Two front-ends over the same Dag type](neuro-pil/README.md#two-front-ends-over-the-same-dag-type)
    - [Example — the TypeScript manifest front-end](neuro-pil/README.md#example--the-typescript-manifest-front-end)
        - [Scenario](neuro-pil/README.md#scenario)
        - [Before: two options, both fail](neuro-pil/README.md#before-two-options-both-fail)
        - [After: ask the graph](neuro-pil/README.md#after-ask-the-graph)
        - [The point](neuro-pil/README.md#the-point)
    - [Declaring the prompt as a source node](neuro-pil/README.md#declaring-the-prompt-as-a-source-node)
    - [Scoring competing versions — compareBrains](neuro-pil/README.md#scoring-competing-versions--comparebrains)
    - [Importing](neuro-pil/README.md#importing)
    - [Module map](neuro-pil/README.md#module-map)
    - [CLI usage](neuro-pil/README.md#cli-usage)
    - [Lineage](neuro-pil/README.md#lineage)
    - [What this trades away](neuro-pil/README.md#what-this-trades-away)
    - [What this does not catch](neuro-pil/README.md#what-this-does-not-catch)
    - [License](neuro-pil/README.md#license)
