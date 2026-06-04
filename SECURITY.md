# Security checklist — public viz repo

This repo is **public** (jsdelivr requires it) and serves code that runs inside a
Looker-authenticated tab. Treat the served file as fully trusted by every Looker user.
Apply ALL of the following before the first push, then keep them on.

## Repo settings (GitHub → Settings)

- [ ] **Branch protection on `main`**
  - [ ] Require a pull request before merging (0 approvals is fine for a solo repo — the point is to block direct pushes)
  - [ ] Require linear history
  - [ ] Block force pushes
  - [ ] Block branch deletion
  - [ ] Apply rules to administrators (`enforce_admins: true`)
- [ ] **Disable unused surfaces:** Issues, Wiki, Projects, Discussions, and **Actions**
      (GitHub Actions is a code-execution surface you don't want on a public repo serving live code).
- [ ] **Secret scanning** — enabled
- [ ] **Push protection** — enabled

> Forks can't be disabled on GitHub Free personal repos. That's OK — the real defense is the
> **SHA-pinned jsdelivr URL** in Looker, not preventing forks. Even if `main` is compromised,
> a SHA-pinned URL keeps serving the trusted code.

## Code / data hygiene

- [ ] No customer or company data anywhere in the tree (files, `example.png`, commit messages).
      `example.png` must be a **synthetic-data** screenshot.
- [ ] `.gitignore` patterns are in place (see `.gitignore`).
- [ ] If real data was used locally during iteration, start a clean repo
      (`rm -rf .git && git init`) or scrub history with `git filter-repo` before pushing.
- [ ] All user-supplied strings are HTML-escaped before entering the DOM (`escapeHtml` in the viz).

## Production

- [ ] Looker "Main" URL is pinned to a **commit SHA**, not `@main`.
- [ ] Re-pin the SHA whenever a new version ships.
