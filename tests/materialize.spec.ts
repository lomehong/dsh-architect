import { describe, expect, it } from 'vitest'
import { planMaterialize, renderOptionalRows, OPTIONAL_ROWS } from '../src/materialize.ts'

/** 内存版 exists。 */
function fakeExists(files: Set<string>) {
  return (p: string) => files.has(p.replaceAll('\\', '/'))
}

const baseInput = {
  dshHome: '/home/u/.dsh',
  packageDir: '/pkg',
  optionalDetected: { dshyuyi: true } as Record<string, boolean>,
}

describe('planMaterialize', () => {
  it('全新目录 → write，无备份，含两个 preset 文件', () => {
    const plan = planMaterialize({ ...baseInput, optionalDetected: {}, exists: () => false })
    expect(plan.action).toBe('write')
    expect(plan.backups).toEqual([])
    expect(plan.files).toHaveLength(2)
    expect(plan.files[0].dst).toContain('architect/agent.cordis.yml')
  })

  it('版本戳一致 → skip', () => {
    const files = new Set(['/home/u/.dsh/.agent-presets/architect/.materialized-version'])
    const plan = planMaterialize({ ...baseInput, version: '1', exists: fakeExists(files), readText: () => '1' })
    expect(plan.action).toBe('skip')
  })

  it('版本戳不一致 → write 且旧文件进备份清单', () => {
    const dir = '/home/u/.dsh/.agent-presets/architect'
    const files = new Set([
      `${dir}/.materialized-version`,
      `${dir}/agent.cordis.yml`,
    ])
    const plan = planMaterialize({ ...baseInput, version: '2', exists: fakeExists(files), readText: () => '1' })
    expect(plan.action).toBe('write')
    expect(plan.backups).toEqual(['agent.cordis.yml.bak'])
  })

  it('可选行按探测结果过滤', () => {
    const plan = planMaterialize({ ...baseInput, optionalDetected: { 'dsh-yuyi': true, '@dsh-extra/dsh-memory': false }, exists: () => false })
    expect(plan.optionalRows).toHaveLength(1)
    expect(plan.optionalRows[0].id).toBe('tool-yuyi')
  })

  it('OPTIONAL_ROWS 契约：包根唯一且 id 唯一', () => {
    const ids = OPTIONAL_ROWS.map(r => r.id)
    expect(new Set(ids).size).toBe(OPTIONAL_ROWS.length)
  })
})

describe('renderOptionalRows', () => {
  it('空行组渲染为空串', () => {
    expect(renderOptionalRows([])).toBe('')
  })

  it('行组含 id/name 与探测注释', () => {
    const out = renderOptionalRows([{ id: 'tool-yuyi', name: 'dsh-yuyi/tools', packageRoot: 'dsh-yuyi' }])
    expect(out).toContain('- id: tool-yuyi')
    expect(out).toContain("name: 'dsh-yuyi/tools'")
    expect(out).toContain('dsh-yuyi 在位')
  })
})
