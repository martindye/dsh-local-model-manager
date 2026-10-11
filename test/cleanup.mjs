import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, resolve } from 'node:path'

/** Delete only an owned model-test directory immediately beneath the OS temp dir. */
export function removeTestDirectory(directory) {
  const target = resolve(directory)
  if (dirname(target) !== resolve(tmpdir()) || !/^model(?:-| legacy's )/.test(basename(target))) {
    throw new Error('Refusing to remove a directory outside the model-test temp namespace')
  }
  rmSync(target, { recursive: true, force: true })
}
