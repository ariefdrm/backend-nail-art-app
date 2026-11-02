# Git Workflow & Collaboration Guidelines

This document defines the Git branching strategy, commit conventions, pull request process, and collaboration guidelines for the following projects:

- **Backend:** [backend-nail-art-app](https://github.com/ariefdrm/backend-nail-art-app) — Express.js, TypeScript, Bun, Prisma ORM, PostgreSQL.
- **Frontend:** [nail-art-frontend-app](https://github.com/ariefdrm/nail-art-frontend-app) — React, TanStack Start, TypeScript, Bun.

Both repositories follow the same Git workflow to maintain consistency, code quality, and collaboration standards.

---

## 1. Branching Strategy

We use a lightweight Git Flow approach with two permanent branches and several temporary working branches.

### Permanent Branches

| Branch    | Description                                                          |
| --------- | -------------------------------------------------------------------- |
| `main`    | Production-ready code. Contains stable and reviewed changes.         |
| `develop` | Integration branch for completed features before production release. |

### Temporary Branches

Temporary branches are created from `develop` and merged back through Pull Requests.

| Branch Prefix | Example                       | Purpose                          |
| ------------- | ----------------------------- | -------------------------------- |
| `feature/`    | `feature/user-authentication` | Implement new features.          |
| `fix/`        | `fix/login-validation`        | Fix application bugs.            |
| `hotfix/`     | `hotfix/payment-error`        | Fix critical production issues.  |
| `security/`   | `security/jwt-validation`     | Implement security improvements. |
| `refactor/`   | `refactor/auth-service`       | Refactor existing code.          |
| `docs/`       | `docs/api-documentation`      | Update project documentation.    |
| `chore/`      | `chore/update-dependencies`   | Perform maintenance tasks.       |

### Branch Structure

```text
main
  │
  └── develop
        │
        ├── feature/user-authentication
        │
        ├── feature/product-management
        │
        ├── fix/login-validation
        │
        ├── security/jwt-validation
        │
        └── docs/api-documentation
```

**Important rules:**

- Never commit directly to `main` or `develop`.
- Always create temporary branches for development tasks.
- All changes must be submitted through Pull Requests.
- Temporary branches should be deleted after successful merging.
- Do not reuse an existing feature branch for an unrelated task.

---

## 2. Development Workflow

Every development task should follow these steps.

### Step 1: Synchronize the Local Repository

Before starting new work, make sure your local `develop` branch is up to date.

```bash
# Switch to develop
git switch develop

# Fetch the latest changes
git fetch origin

# Synchronize local develop
git pull --ff-only origin develop
```

### Step 2: Create a Working Branch

Create a new branch from the latest `develop` branch.

```bash
# Example: implementing user authentication
git switch -c feature/user-authentication
```

Use the appropriate branch prefix based on the task.

### Step 3: Implement Changes

Work on your assigned task.

Before committing, review your changes:

```bash
# Check modified files
git status

# Review code changes
git diff

# Stage specific files
git add src/controller/auth.controller.ts

# Or stage all intended changes
git add .
```

Avoid committing unrelated files, generated build output, environment files, or sensitive credentials.

### Step 4: Commit Changes

Use the Conventional Commits format described in Section 3.

```bash
git commit -m "feat(auth): implement user authentication"
```

Make small, meaningful commits that represent logical units of work.

### Step 5: Push Your Working Branch

```bash
git push -u origin feature/user-authentication
```

For subsequent updates:

```bash
git push
```

### Step 6: Create a Pull Request

Open a Pull Request on GitHub with the following configuration:

| Field          | Value                                        |
| -------------- | -------------------------------------------- |
| Base branch    | `develop`                                    |
| Compare branch | Your working branch                          |
| Title          | Follow Conventional Commits                  |
| Description    | Explain changes, implementation, and testing |

Before requesting a review, ensure that:

- [ ] The application runs successfully.
- [ ] TypeScript type checking passes.
- [ ] ESLint checks pass.
- [ ] Relevant tests pass.
- [ ] No sensitive credentials are included.
- [ ] The Pull Request description is complete.

### Step 7: Code Review and Merge

The Pull Request must receive at least one approval from another collaborator.

After approval:

1. Resolve all requested changes.
2. Ensure all required CI checks pass.
3. Resolve all review conversations.
4. Merge the Pull Request into `develop`.
5. Delete the temporary working branch.

### Step 8: Release to Production

When `develop` contains a stable and tested release, create a Pull Request targeting `main`.

```text
develop → Pull Request → main
```

After approval and successful CI checks, merge the Pull Request.

The `main` branch must always represent stable, production-ready code.

---

## 3. Commit Message Convention

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification to maintain readable and consistent commit history.

### Commit Format

```text
<type>(<scope>): <description>
```

| Component     | Description                             |
| ------------- | --------------------------------------- |
| `type`        | Category of the change.                 |
| `scope`       | Optional component or feature affected. |
| `description` | Short explanation of the change.        |

### Commit Types

| Type       | Description                                        | Example                                      |
| ---------- | -------------------------------------------------- | -------------------------------------------- |
| `feat`     | Introduces a new feature.                          | `feat(auth): add JWT authentication`         |
| `fix`      | Fixes a bug.                                       | `fix(auth): handle expired refresh token`    |
| `docs`     | Documentation changes.                             | `docs(readme): update installation guide`    |
| `style`    | Formatting changes without changing functionality. | `style(ui): format button component`         |
| `refactor` | Code restructuring without changing behavior.      | `refactor(user): simplify user service`      |
| `perf`     | Performance improvements.                          | `perf(api): optimize database queries`       |
| `test`     | Adds or updates tests.                             | `test(auth): add login service tests`        |
| `build`    | Changes build system or dependencies.              | `build(deps): update prisma dependencies`    |
| `ci`       | Changes CI/CD configuration.                       | `ci(github): add lint workflow`              |
| `chore`    | Maintenance tasks.                                 | `chore(config): update eslint configuration` |
| `revert`   | Reverts a previous commit.                         | `revert: revert login implementation`        |

### Examples

Backend:

```bash
git commit -m "feat(auth): implement refresh token rotation"
git commit -m "fix(prisma): handle database connection errors"
git commit -m "feat(user): add user registration endpoint"
```

Frontend:

```bash
git commit -m "feat(auth): implement login page"
git commit -m "feat(ui): add reusable input component"
git commit -m "fix(router): handle unauthorized navigation"
```

### Breaking Changes

For changes that introduce breaking behavior, use `!` after the type or scope and explain the breaking change in the commit body.

```text
feat(api)!: change authentication response format

BREAKING CHANGE: Authentication responses now return
accessToken instead of token.
```

---

## 4. Keeping Working Branches Updated

While working on a feature, other collaborators may merge changes into `develop`.

Before submitting your Pull Request, synchronize your working branch with the latest `develop`.

```bash
# Fetch remote changes
git fetch origin

# Update your working branch using rebase
git rebase origin/develop
```

If conflicts occur:

```bash
# Check conflicting files
git status

# Resolve conflicts manually
# Stage resolved files
git add .

# Continue rebase
git rebase --continue
```

If you need to cancel the rebase:

```bash
git rebase --abort
```

After successfully rebasing a branch that has already been pushed:

```bash
git push --force-with-lease
```

**Important:** Never use `git push --force` on shared branches. Avoid rebasing branches that other collaborators are actively using.

---

## 5. Hotfix Workflow

Hotfixes are reserved for critical problems affecting the production version.

Unlike normal feature branches, hotfix branches are created from `main`.

```bash
# Switch to production branch
git switch main

# Synchronize with remote
git pull --ff-only origin main

# Create hotfix branch
git switch -c hotfix/critical-auth-error
```

After implementing and testing the fix:

```bash
git add .
git commit -m "fix(auth): resolve critical authentication error"

git push -u origin hotfix/critical-auth-error
```

Create a Pull Request targeting `main`.

After merging into `main`, ensure the fix is also incorporated into `develop`.

```text
main
  │
  └── hotfix/critical-auth-error
          │
          ▼
      Pull Request
          │
          ▼
         main
          │
          ▼
       develop
```

This prevents the production fix from being lost in future releases.

---

## 6. Collaboration Rules

All collaborators must follow these guidelines:

1. Never push directly to `main` or `develop`.
2. Never force-push to permanent branches.
3. Always synchronize `develop` before creating a new working branch.
4. Use descriptive branch names.
5. Follow Conventional Commits.
6. Keep Pull Requests focused on a single task.
7. Request at least one review before merging.
8. Do not merge Pull Requests with failing required CI checks.
9. Never commit `.env` files, passwords, API keys, or private credentials.
10. Update documentation when introducing significant changes.
11. Communicate with other collaborators before modifying shared architectural components.
12. Delete merged temporary branches to keep the repository clean.

---

## 7. Useful Git Commands

| Command                           | Description                                  |
| --------------------------------- | -------------------------------------------- |
| `git status`                      | Check the current working tree status.       |
| `git branch`                      | List local branches.                         |
| `git branch -a`                   | List local and remote branches.              |
| `git switch develop`              | Switch to the develop branch.                |
| `git fetch origin`                | Fetch remote repository updates.             |
| `git pull --ff-only`              | Pull changes without creating merge commits. |
| `git switch -c feature/example`   | Create and switch to a new branch.           |
| `git add .`                       | Stage changes.                               |
| `git commit -m "message"`         | Create a commit.                             |
| `git push -u origin branch-name`  | Push a new branch to GitHub.                 |
| `git log --oneline --graph --all` | Display commit history graphically.          |
| `git branch -d branch-name`       | Delete a merged local branch.                |

---

## 8. Development Workflow Summary

The standard workflow for feature development is:

```text
1. Synchronize develop
        │
        ▼
2. Create feature branch
        │
        ▼
3. Implement changes
        │
        ▼
4. Run tests and code checks
        │
        ▼
5. Commit changes
        │
        ▼
6. Push working branch
        │
        ▼
7. Create Pull Request
        │
        ▼
8. Code review and CI validation
        │
        ▼
9. Merge into develop
        │
        ▼
10. Delete working branch
```

For production releases:

```text
develop
   │
   ▼
Pull Request
   │
   ▼
Code Review
   │
   ▼
CI Validation
   │
   ▼
main
   │
   ▼
Production Deployment
```

---

## 9. Final Guidelines

The purpose of this workflow is to establish a consistent development process across the backend and frontend repositories.

Every collaborator is responsible for maintaining code quality, writing meaningful commit messages, reviewing changes, and following the established branching conventions.

**Remember:** No changes should reach the production branch without proper review and validation.
