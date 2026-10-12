# School Bridge Community

This is the explicitly authorized clean community successor. The personal Bridge is a separate read-only source of reusable code. Never deploy to, alter, import records from, or connect this project to the personal Bridge's bindings, credentials, calendars, Drive folders, collectors or GPTs.

Copyright 2026 Daksh Breja. All rights reserved. This repository is private; no open-source license is granted. Preserve third-party notices and dependency licenses.

New workspaces start empty. Only synthetic fixtures belong in tests. No personal records, grades, student materials, tokens, source URLs containing access secrets, browser profiles or production logs belong in Git. New connectors require explicit per-student consent and actual source verification; site registration alone is not a successful sync.

Derive student identity only from a server-verified identity token. Every operation, retry, receipt, search and data object is scoped to that identity. Never accept a caller-selected owner/student ID or retain request data in module globals. Fail closed when authentication is unconfigured. Never infer submission, successful learning or source freshness.

Use Cloudflare skills before platform changes. Test real local Worker/SQLite behavior as well as isolated contracts. Keep cloud deployment and real-account onboarding separate from the local foundation. Maintain docs/STATUS.md with evidence and explicit unsupported features.
