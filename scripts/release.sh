#!/bin/bash
# Release the latest commit of main: bump the version in package.json and
# package-lock.json, commit, tag vX.Y.Z and push. The tag push runs the
# release workflow, which publishes the tarball and the image
# ghcr.io/runtarahq/runtara-frontend:X.Y.Z and :latest.
#
# The bump is from the latest stable tag; prerelease tags (vX.Y.Z-rc.N) are
# ignored.
#
# Usage: ./scripts/release.sh <patch|minor|major>
# Example: ./scripts/release.sh patch   # 10.0.0 -> 10.0.1

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

BUMP_TYPE="${1:-}"
if [[ ! "$BUMP_TYPE" =~ ^(patch|minor|major)$ ]]; then
    echo "Usage: $0 <patch|minor|major>"
    echo "Example: $0 patch"
    exit 1
fi

# --- Release main as origin has it, and nothing else ---
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "main" ]; then
    echo "Error: on $BRANCH. Releases are cut from main."
    exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Error: Working tree is not clean. Commit or stash your changes first."
    exit 1
fi

git fetch --quiet --tags origin main
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
    echo "Error: main differs from origin/main. Pull or push first."
    exit 1
fi

# --- Read the current version from the latest stable tag ---
LATEST_TAG="$(git tag --list 'v*' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1 || true)"
if [ -z "$LATEST_TAG" ]; then
    echo "Error: No version tags found (expected vX.Y.Z)."
    exit 1
fi
CURRENT_VERSION="${LATEST_TAG#v}"
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

case "$BUMP_TYPE" in
    major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
    minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
    patch) PATCH=$((PATCH + 1)) ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
TAG="v${NEW_VERSION}"

echo "Current version: $CURRENT_VERSION"
echo "New version:     $NEW_VERSION"
echo "Tag:             $TAG"
echo ""

if git rev-parse --verify --quiet "refs/tags/$TAG" >/dev/null; then
    echo "Error: Tag $TAG already exists."
    exit 1
fi

# --- Bump, commit and tag ---
# The release workflow refuses a tag that differs from package.json's version.
npm version "$NEW_VERSION" --no-git-tag-version --allow-same-version >/dev/null

git add package.json package-lock.json
git commit --quiet -m "Release $NEW_VERSION"
git tag "$TAG"

echo "Created commit and tag $TAG."
echo ""
read -rp "Push commit and tag to origin? [y/N] " CONFIRM
if [[ "$CONFIRM" =~ ^[Yy]$ ]]; then
    git push --atomic origin HEAD "$TAG"
    echo "Pushed. The release workflow publishes the tarball and the image."
else
    echo "Skipped push. Run manually:"
    echo "  git push --atomic origin HEAD $TAG"
fi
