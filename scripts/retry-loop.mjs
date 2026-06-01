import { randomUUID } from 'node:crypto'
import {
  invoke as defaultInvoke,
  OpencodeNotInstalledError,
  OpencodeTimeoutError,
} from './opencode-bridge.mjs'

export class RetryExhaustedError extends Error {
  constructor(message, history) {
    super(message)
    this.name = 'RetryExhaustedError'
    this.history = history
  }
}

const MAX_RETRY = 2
const FATAL_ERROR_TYPES = [OpencodeNotInstalledError, OpencodeTimeoutError]

function isFatal(err) {
  return FATAL_ERROR_TYPES.some((cls) => err instanceof cls)
}

function buildFeedbackPrompt(originalPrompt, history) {
  const last = history[history.length - 1]
  const parts = [`previous attempt failed: ${last.error}`]
  if (last.reviewer_comment) {
    parts.push(`reviewer feedback: ${last.reviewer_comment}`)
  }
  if (last.diff) {
    parts.push(`previous diff:\n${last.diff}`)
  }
  return `${originalPrompt}\n\n--- retry context ---\n${parts.join('\n')}`
}

export async function run({
  prompt,
  cwd,
  model,
  agent,
  invoke = defaultInvoke,
  reviewer = null,
  onTrace = () => {},
  maxRetry = MAX_RETRY,
}) {
  const traceId = randomUUID()
  const history = []
  let currentPrompt = prompt

  for (let attempt = 1; attempt <= maxRetry + 1; attempt++) {
    const t0 = Date.now()
    try {
      const result = await invoke({ prompt: currentPrompt, cwd, model, agent })

      let reviewerVerdict = null
      if (reviewer && result?.result?.diff) {
        reviewerVerdict = await reviewer(result.result.diff)
        if (!reviewerVerdict.pass) {
          const rejectErr = new Error(`reviewer rejected: ${reviewerVerdict.comment}`)
          rejectErr.name = 'ReviewerRejectError'
          rejectErr.reviewerComment = reviewerVerdict.comment
          rejectErr.diff = result.result.diff
          throw rejectErr
        }
      }

      onTrace({
        traceId,
        attempt,
        status: 'completed',
        duration_ms: Date.now() - t0,
        session_id: result.session_id,
      })
      return result
    } catch (err) {
      const entry = {
        traceId,
        attempt,
        status: 'failed',
        duration_ms: Date.now() - t0,
        error: err.message,
        reviewer_comment: err.reviewerComment || null,
        diff: err.diff || null,
      }
      onTrace(entry)
      history.push(entry)

      if (isFatal(err)) throw err
      if (attempt > maxRetry) {
        throw new RetryExhaustedError(
          `retry exhausted after ${attempt} attempts (last error: ${err.message})`,
          history,
        )
      }

      currentPrompt = buildFeedbackPrompt(prompt, history)
    }
  }
}
