# Dependency Policy

This document defines how Aura Vault Protocol evaluates, approves, and maintains third-party dependencies for the Rust, Node.js, and GitHub Actions ecosystems.

## 1. Dependency acceptance criteria

New dependencies are allowed only when they meet all of the following conditions:

- The package is actively maintained and has recent releases within the last 6–12 months.
- The maintainer or upstream project has a credible security history with no unpatched high or critical advisories for the intended version.
- The license is compatible with the repository policy: MIT, Apache-2.0, BSD-3-Clause, ISC, and similar permissive licenses are preferred. GPL/AGPL and other copyleft licenses require explicit review.
- The dependency is necessary for the feature and cannot be replaced by an existing internal utility or a smaller package.
- The dependency has a clear public provenance, a documented install path, and a stable API surface for the planned integration.
- The dependency has at least basic test coverage or is used in a low-risk path if the package is tiny and well known.

### Review checklist for new dependencies

Before approving a new dependency, confirm:

- [ ] The package is required for a documented user or developer need.
- [ ] The package has a current release cadence and a clear maintainer response process.
- [ ] The package does not introduce known high or critical vulnerabilities.
- [ ] The license is acceptable for distribution and commercial use.
- [ ] The dependency is pinned to a version with an accompanying lockfile update.
- [ ] The team reviewed transitive dependencies and the resulting dependency graph size.
- [ ] The change includes tests or a verified build step for the affected project.

## 2. Security review and vulnerability handling

The repository uses automated scanning to catch common supply-chain issues before they reach production.

### CI enforcement

- The Node.js workspaces run `npm audit --audit-level=high` in CI for the affected package directories.
- The Rust workspace runs `cargo audit` in CI for the `aura-vault` crate.
- Dependabot opens weekly pull requests for the supported ecosystems so patch-level issues can be merged quickly.

### Response expectations

- High or critical vulnerabilities should be triaged within 48 hours.
- A dependency with a known vulnerability should be upgraded or removed before the next release if the fix is available.
- A temporary exception requires an issue, a documented risk, and an explicit owner.

## 3. Dependabot configuration

The repository’s automated dependency policy is declared in [.github/dependabot.yml](../.github/dependabot.yml).

The configuration covers:

- npm ecosystems for the root package, frontend, backend, ui, mobile, and contracts workspaces
- the Rust cargo ecosystem for `aura-vault`
- GitHub Actions updates

Updates are scheduled weekly and grouped into patch/minor updates to reduce review noise.

## 4. License compliance

The project should keep a record of every third-party package and its associated license.

| Dependency | Ecosystem | License | Approval status | Notes |
|---|---|---|---|---|
| Example package | npm | MIT | Approved | Used for CLI tooling |
| Example crate | cargo | Apache-2.0 | Approved | Runtime dependency |
| Example GitHub Action | github-actions | MIT | Approved | CI workflow only |

When a package is added, record the package name, version, license, and its approval status in the project’s dependency inventory or in the pull request description.

## 5. Dependency review workflow

1. Open or update an issue describing the need for the dependency.
2. Check the package’s maintenance window, security advisories, and license.
3. Add the dependency in the appropriate workspace and update the lockfile.
4. Run the relevant checks:
   - `npm audit --audit-level=high`
   - `cargo audit`
   - project tests and build steps
5. Open a pull request that includes the dependency rationale, the audit results, and the license review.

## 6. Recommended commands

```bash
# Frontend / backend / ui workspaces
npm audit --audit-level=high

# Rust workspace
cargo audit
```

This policy is intended to keep the project secure, maintainable, and compliant without blocking legitimate engineering work.
