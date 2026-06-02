// Zero-dependency validator for the normalized opencode result object.
//
// Rules mirror schemas/opencode-output.json (kept as documentation). Hand-rolled
// instead of using Ajv so the plugin has NO runtime npm dependencies — a user
// who installs via `/plugin marketplace add` gets a clone with no node_modules,
// and Claude Code does not run `npm install` for plugins. Keep it that way.

const VALID_STATUS = new Set(['completed', 'failed', 'aborted', 'running'])

/**
 * @param {unknown} obj
 * @returns {{valid: boolean, errors: Array<{instancePath: string, message: string}>|null}}
 */
export function validate(obj) {
  const errors = []

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { valid: false, errors: [{ instancePath: '', message: 'must be an object' }] }
  }

  // required: session_id (non-empty string)
  if (typeof obj.session_id !== 'string' || obj.session_id.length < 1) {
    errors.push({
      instancePath: '/session_id',
      message: "must have required property 'session_id' (non-empty string)",
    })
  }

  // required: status ∈ enum
  if (!VALID_STATUS.has(obj.status)) {
    errors.push({
      instancePath: '/status',
      message: `status must match enum: ${[...VALID_STATUS].join(', ')}`,
    })
  }

  // optional: result is object | null
  if (obj.result !== undefined && obj.result !== null && typeof obj.result !== 'object') {
    errors.push({ instancePath: '/result', message: 'result must be an object or null' })
  }

  // optional: error is string | null
  if (obj.error !== undefined && obj.error !== null && typeof obj.error !== 'string') {
    errors.push({ instancePath: '/error', message: 'error must be a string or null' })
  }

  // additionalProperties allowed (forward-compat) — no extra-key check.
  return { valid: errors.length === 0, errors: errors.length ? errors : null }
}
