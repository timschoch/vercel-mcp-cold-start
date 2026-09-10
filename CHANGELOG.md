# Changelog

## [0.6.0](https://github.com/timschoch/vercel-mcp-cold-start/compare/v0.5.0...v0.6.0) (2026-09-10)


### ⚠ BREAKING CHANGES

* `coldStart` is now `notices` with `name`, `firstNoticeMs` and `repeatNoticeMs`; `seconds` and `probeTimeoutMs` are gone. `COLD_START` and `ColdStart` are now `NOTICES` and `Notices`.

### Features

* notify on every slow request, drop the cold probe ([#12](https://github.com/timschoch/vercel-mcp-cold-start/issues/12)) ([49864ce](https://github.com/timschoch/vercel-mcp-cold-start/commit/49864cecfe695f2e5e309e61e4c60b0db1a31c15))

## [0.5.0](https://github.com/timschoch/vercel-mcp-cold-start/compare/v0.4.0...v0.5.0) (2026-09-09)


### ⚠ BREAKING CHANGES

* `path` is gone and `upstream` is the endpoint URL, not the host. `MCP_PATH` is gone; `UPSTREAM_MCP_PATH` names the endpoint on the upstream host.

### Features

* the front owns no path ([#10](https://github.com/timschoch/vercel-mcp-cold-start/issues/10)) ([a898d5c](https://github.com/timschoch/vercel-mcp-cold-start/commit/a898d5c4f3dc02bd22ee852ffdaa271b0e039106))

## [0.4.0](https://github.com/timschoch/vercel-mcp-cold-start/compare/v0.3.0...v0.4.0) (2026-09-09)


### Features

* make the MCP path a setting ([#8](https://github.com/timschoch/vercel-mcp-cold-start/issues/8)) ([721864a](https://github.com/timschoch/vercel-mcp-cold-start/commit/721864ab514e953b6bccaacc94197b85b3b4e3c5))

## [0.3.0](https://github.com/timschoch/vercel-mcp-cold-start/compare/v0.2.0...v0.3.0) (2026-09-09)


### Features

* export COLD_START from the package root ([#4](https://github.com/timschoch/vercel-mcp-cold-start/issues/4)) ([b790fe6](https://github.com/timschoch/vercel-mcp-cold-start/commit/b790fe666777fdd5d4b274b3b053b306d53c3896))

## [0.2.0](https://github.com/timschoch/vercel-mcp-cold-start/compare/v0.1.0...v0.2.0) (2026-09-09)


### Features

* extract the front from meco ([#2](https://github.com/timschoch/vercel-mcp-cold-start/issues/2)) ([75dffae](https://github.com/timschoch/vercel-mcp-cold-start/commit/75dffae70522e2b22677834e0dfe60cc0c42afe8))
