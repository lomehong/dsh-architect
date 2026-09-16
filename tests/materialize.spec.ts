import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planMaterialize, renderOptionalRows, OPTIONAL_ROWS, detectOptionalPackages, currentProfileFromPackageDir } from '../src/materialize.ts'

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

describe('detectOptionalPackages × 当前 profile 锁定（2026-09-16 事故防复发）', () => {
  // 探测器内部用真实 readdirSync 列 profiles 子目录，因此用真实临时目录结构测试
  it('bundle 装在 web profile 时：不把其他 profile 的包探测为在位', () => {
    const home = mkdtempSync(join(tmpdir(), 'arch-detect-'))
    try {
      mkdirSync(join(home, 'profiles/web/node_modules/dsh-yuyi'), { recursive: true })
      mkdirSync(join(home, 'profiles/other/node_modules/@dsh-extra/dsh-memory'), { recursive: true })
      const pkgDir = join(home, 'profiles/web/node_modules/@dsh-extra/dsh-architect')
      mkdirSync(pkgDir, { recursive: true })
      const detected = detectOptionalPackages(home, existsSync, pkgDir)
      expect(detected['dsh-yuyi']).toBe(true) // 当前 profile 在位
      expect(detected['@dsh-extra/dsh-memory']).toBe(false) // 其他 profile 不计入
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('推断不出 profile（开发态直跑）时退回全扫描', () => {
    const home = mkdtempSync(join(tmpdir(), 'arch-detect-'))
    try {
      mkdirSync(join(home, 'profiles/other/node_modules/dsh-yuyi'), { recursive: true })
      const detected = detectOptionalPackages(home, existsSync)
      expect(detected['dsh-yuyi']).toBe(true)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('currentProfileFromPackageDir 解析安装位置', () => {
    expect(currentProfileFromPackageDir('C:\\dsh\\home\\profiles\\web\\node_modules\\@dsh-extra\\dsh-architect')).toBe('web')
    expect(currentProfileFromPackageDir('/pkg/dsh-architect')).toBeUndefined()
  })
})
