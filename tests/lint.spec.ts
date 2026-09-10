import { describe, expect, it } from 'vitest'
import { lintKnowledge, relativePathCandidates, type KnowledgeSnapshot } from '../src/lint.ts'

/** 达标快照：1 条已确认 + 1 条待审核（队列与索引齐）。 */
function goodSnapshot(): KnowledgeSnapshot {
  return {
    entries: [
      { path: 'meta/a.md', fields: { title: 'A', domain: 'dsh-ecosystem', 'source.origin': 'o', 'source.ref': 'https://example.com', confirmed: '2026-09-10', status: '已确认', owner: '主人' } },
      { path: 'principle/b.md', fields: { title: 'B', domain: 'methodology', 'source.origin': 'o', 'source.ref': 'docs/x.md', confirmed: '2026-09-10', status: '待审核', owner: '主人' } },
    ],
    reviewQueue: [{ file: 'principle/b.md' }],
    indexes: [
      { dir: 'meta', rows: [{ file: 'a.md', status: '已确认' }] },
      { dir: 'principle', rows: [{ file: 'b.md', status: '待审核' }] },
    ],
  }
}

describe('lintKnowledge 达标路径', () => {
  it('好快照零错误通过，stats 正确；相对路径 ref 缺省核查出 R7 warning', () => {
    const r = lintKnowledge(goodSnapshot())
    expect(r.pass).toBe(true)
    expect(r.errors).toEqual([])
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0].rule).toBe('R7')
    expect(r.warnings[0].path).toBe('principle/b.md')
    expect(r.stats).toEqual({ entries: 2, confirmed: 1, pending: 1 })
  })

  it('仅有 warnings（未核查的相对路径 ref）不阻断通过', () => {
    const r = lintKnowledge(goodSnapshot())
    expect(r.pass).toBe(true)
    expect(r.warnings.every(w => w.rule === 'R7')).toBe(true)
  })

  it('空快照返回零错误空警告（检查器不得抛错）', () => {
    const r = lintKnowledge({ entries: [], reviewQueue: [], indexes: [] })
    expect(r.pass).toBe(true)
    expect(r.stats.entries).toBe(0)
  })

  it('null/undefined 字段不抛错', () => {
    const r = lintKnowledge(undefined as unknown as KnowledgeSnapshot)
    expect(r.pass).toBe(true)
  })
})

describe('lintKnowledge 破坏样本（八类逐一检出）', () => {
  it('①缺必填字段 → R1', () => {
    const s = goodSnapshot()
    delete (s.entries[0].fields as Record<string, string>)['source.origin']
    const r = lintKnowledge(s)
    expect(r.errors.some(i => i.rule === 'R1' && i.path === 'meta/a.md' && i.message.includes('source.origin'))).toBe(true)
    expect(r.pass).toBe(false)
  })

  it('②status 非法 → R2', () => {
    const s = goodSnapshot()
    ;(s.entries[0].fields as Record<string, string>).status = '草稿'
    const r = lintKnowledge(s)
    expect(r.errors.some(i => i.rule === 'R2')).toBe(true)
  })

  it('③confirmed 日期格式坏 → R3', () => {
    const s = goodSnapshot()
    ;(s.entries[0].fields as Record<string, string>).confirmed = '2026/09/10'
    const r = lintKnowledge(s)
    expect(r.errors.some(i => i.rule === 'R3')).toBe(true)
  })

  it('④队列引用不存在/非待审核条目 → R4', () => {
    const s = goodSnapshot()
    s.reviewQueue = [{ file: 'meta/ghost.md' }, { file: 'meta/a.md' }]
    const r = lintKnowledge(s)
    // 三条：ghost 不存在 + a 非待审核 + 原 b（待审核）因队列被替换而漏登——双向一致性各自独立触发
    expect(r.errors.filter(i => i.rule === 'R4')).toHaveLength(3)
    expect(r.errors.some(i => i.rule === 'R4' && i.message.includes('不存在的条目'))).toBe(true)
    expect(r.errors.some(i => i.rule === 'R4' && i.message.includes('非待审核条目'))).toBe(true)
    expect(r.errors.some(i => i.rule === 'R4' && i.message.includes('未登记 review-queue'))).toBe(true)
  })

  it('⑤待审核条目漏登队列 → R4', () => {
    const s = goodSnapshot()
    s.reviewQueue = []
    const r = lintKnowledge(s)
    expect(r.errors.some(i => i.rule === 'R4' && i.message.includes('未登记 review-queue'))).toBe(true)
  })

  it('⑥index 缺行/引用不存在/状态漂移 → R5', () => {
    const s = goodSnapshot()
    s.indexes = [
      { dir: 'meta', rows: [{ file: 'ghost.md', status: '已确认' }] },
      { dir: 'principle', rows: [{ file: 'b.md', status: '已确认' }] },
    ]
    const r = lintKnowledge(s)
    expect(r.errors.some(i => i.rule === 'R5' && i.message.includes('未登记所在目录'))).toBe(true)
    expect(r.errors.some(i => i.rule === 'R5' && i.message.includes('引用不存在的条目'))).toBe(true)
    expect(r.errors.some(i => i.rule === 'R5' && i.message.includes('不一致'))).toBe(true)
  })

  it('⑦owner 为空 → R6', () => {
    const s = goodSnapshot()
    ;(s.entries[0].fields as Record<string, string>).owner = ' '
    const r = lintKnowledge(s)
    expect(r.errors.some(i => i.rule === 'R6')).toBe(true)
  })

  it('⑧refExists=false 升 R7 error；true 消音；undefined 保持 warning', () => {
    const s = goodSnapshot()
    const rFalse = lintKnowledge(s, { refExists: () => false })
    expect(rFalse.errors.some(i => i.rule === 'R7')).toBe(true)
    expect(rFalse.pass).toBe(false)
    const rTrue = lintKnowledge(s, { refExists: () => true })
    expect(rTrue.errors.filter(i => i.rule === 'R7')).toHaveLength(0)
    expect(rTrue.warnings).toEqual([])
  })
})

describe('路径归一与候选提取', () => {
  it('反斜杠与 ./ 前缀归一后可匹配（R4/R5 跨平台）', () => {
    const s = goodSnapshot()
    s.entries[1].path = 'principle\\b.md'
    const r = lintKnowledge(s)
    expect(r.errors.filter(i => i.rule === 'R4' || i.rule === 'R5')).toHaveLength(0)
  })

  it('relativePathCandidates 只收相对路径形态', () => {
    expect(relativePathCandidates('https://mp.weixin.qq.com/s/abc（含 8 张图）')).toEqual([])
    expect(relativePathCandidates('../../adapters/README.md；与 suite 同构（核心不动）')).toEqual(['../../adapters/README.md'])
    expect(relativePathCandidates('§0/§1.2/§9')).toEqual([])
    expect(relativePathCandidates('docs/designs/2026-09-10-x.md')).toEqual(['docs/designs/2026-09-10-x.md'])
  })
})
