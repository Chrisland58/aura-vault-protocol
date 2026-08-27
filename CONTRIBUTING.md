# Contributing to Aura Vault Protocol

Thanks for helping improve Aura Vault Protocol. This guide explains how to report issues, propose features, submit pull requests, and meet the project’s quality bar.

## How to report issues

Please use the issue templates in [.github/ISSUE_TEMPLATE](.github/ISSUE_TEMPLATE) when possible.

### Bug report

Use the bug report template when you have reproducible behavior, a broken flow, or a failing test.

### Feature request

Use the feature request template when you want to propose a new capability, workflow, or integration.

## Pull request process

1. Create a branch from the latest `main`.
2. Make focused changes and keep the diff small.
3. Update or add tests where relevant.
4. Open a pull request using the repository template.
5. Wait for review; the target review SLA is 2 business days.

### Pull request checklist

- [ ] The change is scoped to a single concern.
- [ ] The relevant tests and builds pass locally.
- [ ] The change is documented when it affects workflows or APIs.
- [ ] Security-sensitive changes were reviewed for dependencies and secrets.
- [ ] The PR description includes the rationale, testing steps, and rollout notes.

## Code quality standards

### Rust

- Format code with `cargo fmt`.
- Run `cargo clippy --all-targets -- -D warnings` before opening a pull request.
- Avoid `unwrap()` and `expect()` in production code unless the failure mode is explicitly tested.

### JavaScript and TypeScript

- Follow the workspace lint rules. Typical commands include `npm run lint` for the relevant package.
- Keep TypeScript strictness and typing consistent with the existing codebase.
- Favor small, testable modules and avoid introducing unnecessary dependencies.

## Commit message conventions

Use Conventional Commits:

- `feat: add new vault dashboard filter`
- `fix: correct deposit validation edge case`
- `docs: add dependency policy guide`
- `chore: update CI security workflow`

## Review process

- Pull requests are reviewed by at least one maintainer.
- The expected initial response time is 2 business days.
- Large or high-risk changes should include a brief rollout or rollback plan.
- Security-sensitive changes should be flagged for extra review.
