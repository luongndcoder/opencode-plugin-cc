import { createInterface } from 'node:readline'

export function readChunked(stream, onLine) {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: stream, crlfDelay: Infinity })
    rl.on('line', onLine)
    rl.once('close', () => resolve())
    rl.once('error', reject)
    stream.on('error', reject)
  })
}

export async function readAll(stream) {
  const lines = []
  await readChunked(stream, (line) => lines.push(line))
  return lines.join('\n')
}
