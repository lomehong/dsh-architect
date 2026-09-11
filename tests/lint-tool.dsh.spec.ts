import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { apply as toolsApply } from '../src/tools.ts'

/** 造一个最小知识库夹具（1 条已确认条目 + 五类目录与 index + 空队列）。 */
function makeKb(extraBody = ''): string {
  const root = mkdtempSync(join(tmpdir(), 'kb-lint-tool-'))
  for (const dir of ['meta', 'principle', 'scenario', 'practice', 'reference']) {
    mkdirSync(join(root, dir), { recursive: true })
    writeFileSync(join(root, dir, 'index.md'), '| 条目 | 定位 | 状态 |\n|---|---|---|\n')
  }
  writeFileSync(join(root, 'meta', 'a.md'), [
    '---',
    'title: A',
    'domain: dsh-ecosystem',
    'source:',
    '  origin: 测试夹具',
    '  ref: https://example.com',
    'confirmed: 2026-09-11',
    'status: 已确认',
    'owner: 主人',
    '---',
    '',
    '# A',
    extraBody,
  ].join('\n'))
  writeFileSync(join(root, 'meta', 'index.md'), '| 条目 | 定位 | 状态 |\n|---|---|---|\n| [a.md](a.md) | A | 已确认 |\n')
  return root
}

const temps: string[] = []
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true })
})

function captureTools() {
  const registered: Array<{ name: string; execute: (a: unknown) => Promise<unknown> }> = []
  toolsApply({ tools: { register(t: never) { registered.push(t) } } } as never)
  return registered
}

describe('architect_lint 工具（dsh 外壳）', () => {
  it('干净知识库 → pass=true 且 stats 正确', async () => {
    const kb = makeKb(); temps.push(kb)
    const tool = captureTools().find(t => t.name === 'architect_lint')
    expect(tool).toBeDefined()
    const r = (await tool!.execute({ kb_root: kb })) as { pass: boolean; entries: number; confirmed: number; errors_text: string }
    expect(r.pass).toBe(true)
    expect(r.entries).toBe(1)
    expect(r.confirmed).toBe(1)
    expect(r.errors_text).toBe('')
  })

  it('含设备路径 → pass=false 且错误含 R9', async () => {
    const kb = makeKb(`设备路径 ${'D:'}${String.fromCharCode(92)}work${String.fromCharCode(92)}proj 不该入库`)
    temps.push(kb)
    const tool = captureTools().find(t => t.name === 'architect_lint')
    const r = (await tool!.execute({ kb_root: kb })) as { pass: boolean; errors_text: string }
    expect(r.pass).toBe(false)
    expect(r.errors_text).toContain('[R9]')
  })
})
