import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { materializeAt, PRESET_VERSION } from '../src/materialize.ts'

// 集成测试：真实 fs 上验证物化/幂等/备份（替代不可靠的 node -e 冒烟）
const pkgRoot = fileURLToPath(new URL('..', import.meta.url))

describe('materializeAt（真实 fs 集成）', () => {
  it('冷环境：物化出 preset 两文件 + 版本戳 + 可选行', () => {
    const home = mkdtempSync(join(tmpdir(), 'arch-preset-'))
    try {
      const ok = materializeAt(home, pkgRoot)
      expect(ok).toBe(true)
      const dir = join(home, '.agent-presets', 'architect')
      expect(existsSync(join(dir, 'agent.cordis.yml'))).toBe(true)
      expect(existsSync(join(dir, 'preset.yml'))).toBe(true)
      expect(existsSync(join(dir, '.materialized-version'))).toBe(true)
      // 断言导出常量而非字面量：模板变更 bump 版本时测试自动跟随
      expect(readFileSync(join(dir, '.materialized-version'), 'utf8').trim()).toBe(PRESET_VERSION)
      // 本机已装 dsh-yuyi/dsh-memory → 可选行应被追加（若环境未装则为空，测试退化为结构检查）
      const yml = readFileSync(join(dir, 'agent.cordis.yml'), 'utf8')
      expect(yml).toContain('tool-architect')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('幂等：复跑不改变版本戳内容，文件仍在', () => {
    const home = mkdtempSync(join(tmpdir(), 'arch-preset-'))
    try {
      expect(materializeAt(home, pkgRoot)).toBe(true)
      const ymlPath = join(home, '.agent-presets', 'architect', 'agent.cordis.yml')
      const before = readFileSync(ymlPath, 'utf8')
      expect(materializeAt(home, pkgRoot)).toBe(true)
      expect(readFileSync(ymlPath, 'utf8')).toBe(before)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('坏源目录：返回 false 不抛错（物化器不得成为宿主阻断点）', () => {
    const home = mkdtempSync(join(tmpdir(), 'arch-preset-'))
    try {
      const badPkg = join(home, 'not-a-package')
      mkdirSync(badPkg, { recursive: true })
      expect(materializeAt(home, badPkg)).toBe(false)
      expect(existsSync(join(home, '.agent-presets', 'architect'))).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
