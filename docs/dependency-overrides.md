# Dependency overrides

`package.json` has an `overrides` block: versions npm installs for a package
whatever the dependency that asks for it says. Each one is a decision that
outlives the reason for it unless the reason is written down, so each is
listed here with what it changes and what would let it go.
`src/test/architecture.test.ts` fails when an override is not in this list,
or when one no longer applies to anything installed.

They were added before this list existed and without notes. Every one raises
the lowest version a dependency accepts, which is what a fix for an advisory
in a transitive dependency looks like; the advisory itself was not recorded.
What is stated below is what each does today, from `npm explain`.

| Override                                              | Asked for by                                         | Was       | Is        | Shipped |
| ----------------------------------------------------- | ---------------------------------------------------- | --------- | --------- | ------- |
| `flatted`                                             | `flat-cache`, under `eslint`                         | `^3.2.9`  | `3.4.2`   | No      |
| `dompurify`                                           | `yummies`, under `swagger-typescript-api`            | `^3.4.1`  | `^3.4.0`  | No      |
| `follow-redirects`                                    | `axios`                                              | `^1.16.0` | `^1.16.2` | Yes     |
| `joi`                                                 | `wait-on`; an optional peer of `@hookform/resolvers` | `^18.1.2` | `^18.3.1` | No      |
| `postcss-selector-parser`                             | `postcss-nested`, under `tailwindcss`                | `^6.1.1`  | `^6.1.5`  | No      |
| `minimatch` in `@typescript-eslint/typescript-estree` | `@typescript-eslint/typescript-estree`               | `^10.2.2` | `^11.0.1` | No      |

"Shipped" says whether the package is in the console's bundle. Only
`follow-redirects` is in the dependency tree of what ships, and a browser
build of `axios` does not use it.

## Letting one go

An override can be removed when the dependency that asks for the package
accepts the overridden version by itself: remove it, run
`npm install --package-lock-only`, and if `package-lock.json` does not change,
it was doing nothing. `dompurify` is one to look at first: the range it sets
is lower than the one it replaces.

Two were removed that way when this list was written: `serialize-javascript`,
which nothing installed asks for, and `uuid`, which only this project depends
on, at the same version.
