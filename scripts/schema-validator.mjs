import Ajv from 'ajv'
import { readFileSync } from 'node:fs'

const schemaPath = new URL('../schemas/opencode-output.json', import.meta.url)
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
const ajv = new Ajv({ allErrors: true, strict: false })
const compiled = ajv.compile(schema)

export function validate(obj) {
  const valid = compiled(obj)
  return {
    valid: Boolean(valid),
    errors: valid ? null : compiled.errors,
  }
}
