// Runs once per test file, BEFORE any test module imports its source code.
//
// The API handlers read process.env.OPENROUTER_API_KEY at module-load time
// (api/_lib/openrouter.ts:3), so we set the defaults here. Individual tests
// may override these (e.g. to clear the key and assert the "not configured"
// path), but the import-time constant must already be populated.
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key'
process.env.OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'test/model'
