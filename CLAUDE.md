# CLAUDE.md

Operating rules for Claude Code (and any other AI assistant) working in this repository. These rules are **binding**, not suggestions.

---

## 1. Read before you write

Before proposing or making any change, read the following in order:

1. [`.memory/overview.md`](.memory/overview.md) — what this product is and, more importantly, is not.
2. [`.memory/domain-model.md`](.memory/domain-model.md) — business rules (rates, currency, invoice #, terms, line items).
3. [`.memory/state-transitions.md`](.memory/state-transitions.md) — the state machines and transition-log schema.
4. [`.memory/conventions.md`](.memory/conventions.md) — IDs, casing, correlation IDs, SQL, tests.
5. [`.memory/tech-stack.md`](.memory/tech-stack.md) — the approved stack, pinned versions, and the "deliberately NOT" list.
6. [`.memory/implementation-plan.md`](.memory/implementation-plan.md) — build order and validation gates for the current phase.
7. [`docs/`](docs/) — architecture, guides, decisions relevant to the area you are touching.

If a request conflicts with any of the above, **stop and surface the conflict** to the user. Do not silently reinterpret intent.

---

## 2. What you must maintain

You are responsible for keeping four surfaces in sync. **No silent evolution allowed.** Every substantive change must land with updates to all applicable surfaces in the same commit or PR:

| Surface             | What lives there                             | When to update                                                                                 |
| ------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `.memory/`          | Product intent, state model, stack decisions | Any change to scope, states, transitions, or approved tools                                    |
| `docs/`             | Architecture, guides, ADRs                   | Any change to how the system is built, run, or used                                            |
| `docs/changelog.md` | User-visible history                         | Any user-visible add / change / fix / removal                                                  |
| `README.md`         | The map                                      | Any change to repo layout, quickstart commands, or which files serve as the map's destinations |

### Rules

- **Scope changes → `.memory/overview.md`.** If a feature expands or contracts what the product does, update overview _first_, then implement.
- **New state, transition, or rejection reason → `.memory/state-transitions.md`.** Update the tables, the Mermaid diagram, and the list of rejection codes. Then implement.
- **New dependency or tool → `.memory/tech-stack.md`.** Justify it against the guiding principles. If it appears on the "deliberately NOT" list, do not add it without explicit user approval and a corresponding ADR in `docs/decisions/`.
- **Every user-visible change → `docs/changelog.md`.** Keep-a-Changelog format. One entry per change, present tense, plain language.
- **New top-level folder or renamed command → `README.md`.** The map must not lie.

### Definition of "substantive"

Any change to: behavior, state transitions, data schema, dependencies, folder layout, run/build commands, or documented decisions. Formatting-only edits and typo fixes are exempt.

If you are unsure whether a change is substantive, treat it as substantive.

---

## 3. What you must not do

- Do **not** add anything from the "deliberately NOT in the stack" list in [`.memory/tech-stack.md`](.memory/tech-stack.md) without an approved ADR.
- Do **not** invent state transitions that aren't defined in [`.memory/state-transitions.md`](.memory/state-transitions.md). Add them to the doc first.
- Do **not** introduce multi-user, auth, or cloud-sync concepts. This is a single-user local tool.
- Do **not** add abstractions "for future flexibility." Three similar lines beat a premature abstraction.
- Do **not** swallow exceptions. See §4.
- Do **not** drop correlation IDs. See §4.
- Do **not** create planning or analysis documents outside `.memory/` and `docs/`. Work from conversation context.

---

## 4. Logging conventions

Every function participates in the observability contract. This is non-negotiable — the transition log defined in [`.memory/state-transitions.md`](.memory/state-transitions.md) is the primary debugging surface for this app.

### 4.1 Levels

| Level   | Use for                                                          |
| ------- | ---------------------------------------------------------------- |
| `DEBUG` | Function entry/exit, intermediate values, branch decisions       |
| `INFO`  | State-changing operations — **must include before/after values** |
| `WARN`  | Recoverable anomalies (rejected transition, retryable failure)   |
| `ERROR` | Unrecoverable failures — **must include full context**           |

### 4.2 Rules

1. **Every function logs at DEBUG or above** — with the pure-utility exemption defined in `.memory/conventions.md` §6 (modules with no I/O, no side effects, no branch decisions worth tracing). A non-exempt function with no log line is incomplete. At minimum: one entry line naming the function and its inputs (redact secrets).
2. **State-changing operations log at INFO with before/after values.** Any function that writes to SQLite, mutates a Svelte store, or transitions an entity must log `{ before, after }` alongside the transition-log emission.
3. **Error paths log at ERROR with full context.** Include: correlation ID, entity type + ID, the operation attempted, inputs (redacted), and the caught error (`err.message`, `err.stack`, `err.code` if present).
4. **No swallowed exceptions.** Never write `catch {}` or `catch (e) { /* ignore */ }`. If an error is truly ignorable, log it at WARN with a `reason` field explaining why it's safe to continue. Then continue.
5. **Correlation IDs must be propagated, never dropped.** Every request, user action, and system-triggered flow generates one ULID at its origin. It is passed as an explicit argument (`correlationId: string`) through every function call in the chain, and included in every log line and every transition-log entry. If you call a function without a correlation ID, that is a bug.
6. **Structured, not interpolated.** Log messages are key-value objects, not string concatenation.

### 4.3 Format

Use the single `log.ts` module. It writes JSON lines with **camelCase keys** to `logs/transitions.jsonl`. One event per line. See [[conventions]] §6 for the full canonical ruleset.

```ts
// GOOD
log.info({
	event: 'entry.stop',
	correlationId,
	entityType: 'time_entry',
	entityId: entry.id,
	before: { state: 'entry.running', startedAt: entry.startedAt, stoppedAt: null },
	after: { state: 'entry.stopped', startedAt: entry.startedAt, stoppedAt: now }
});

// BAD — interpolated string, no correlation ID, no before/after
console.log(`Stopped timer for entry ${entry.id} at ${now}`);

// BAD — swallowed exception
try {
	commitInvoice(id);
} catch (e) {}
```

### 4.4 What every log line must contain

- `event` — namespaced verb (`entry.start`, `invoice.finalize`, `db.query`)
- `correlationId` — always
- `level` — set by the logger method used (`log.debug` / `log.info` / etc.)
- Entity fields (`entityType`, `entityId`) when the event concerns a specific entity
- Never: raw user input without redaction, full stack traces at DEBUG/INFO (ERROR only), or interpolated message strings as the primary payload

### 4.5 Errors

```ts
try {
	finalizeInvoice(invoiceId, correlationId);
} catch (err) {
	log.error({
		event: 'invoice.finalize.failed',
		correlationId,
		entityType: 'invoice',
		entityId: invoiceId,
		inputs: { invoiceId },
		error: { message: err.message, stack: err.stack, code: err.code }
	});
	throw err; // re-throw. Do not swallow.
}
```

---

## 5. When you finish a change

Before declaring a task complete, verify:

- [ ] `.memory/` reflects any scope, state, or stack change.
- [ ] `docs/` reflects any architecture, guide, or decision change.
- [ ] `docs/changelog.md` has an entry for any user-visible change.
- [ ] `README.md` still tells the truth about the repo shape and quickstart.
- [ ] Every new or modified function has DEBUG-or-above logging.
- [ ] Every state change logs INFO with before/after.
- [ ] Every catch block either re-throws or logs a WARN with an explicit `reason`.
- [ ] Correlation IDs are threaded through every new call path.

If any box is unchecked, the task is not done.
