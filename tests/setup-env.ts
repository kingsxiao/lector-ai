// Runs once per test file, BEFORE any test module imports its source code.
//
// Lector AI is BYOK and has no backend, so the shared modules under test read
// no environment variables at module-load time. This file is kept as the
// vitest setupFiles entry (vitest.config.ts) and exists to host any future
// environment plumbing the test suite may need; it is intentionally empty.
