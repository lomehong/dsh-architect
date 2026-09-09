/**
 * dsh-architect 需求准入核心（纯函数，零依赖）——prd-digest 六项覆盖的确定性检查器。
 *
 * 方法论出处：dsh-memory 条目 mem_1788978083156_yycfzp §prd-digest 六项覆盖检查清单；
 * 准入语义：不足标「未知/待验证」**不编造**；阻断项存在即不通过。
 *
 * @module @dsh-extra/dsh-architect/digest
 */

export interface DigestInput {
  /** 需求原文（PRD 或主人口头描述的转写；非空） */
  requirement: string
  /** 做（需求条目逐项归属） */
  doItems: string[]
  /** 不做（显式排除） */
  dontItems: string[]
  /** 待确认（问主人的问题清单；允许为空 = 显式无） */
  toConfirm: string[]
  /** 假设（每条应有依据） */
  assumptions: string[]
  /** 阻断项（不解除不得进入设计；非空即不通过） */
  blockers: string[]
  /** 涉及系统/仓库/上下游 */
  systems: string[]
  /** 关键结论与证据来源 */
  evidences: Array<{ conclusion: string; source: string }>
  /** 风险检查是否逐类过（兼容/异常/缓存/MQ/状态机/安全） */
  risksChecked: boolean
  /** 验证计划（如何算完成；非空） */
  validationPlan: string
}

export interface DigestCoverageItem {
  item: string
  ok: boolean
  note: string
}

export interface DigestResult {
  admission: '通过' | '不通过'
  /** 六项覆盖检查表（与 SKILL 六项一一对应） */
  coverage: DigestCoverageItem[]
  /** 不通过时的补齐清单 */
  missing: string[]
  /** 始终为真的提示：准入通过 ≠ 方案完成 */
  next: string
}

function isNonEmptyArray(a: readonly string[] | undefined): boolean {
  return Array.isArray(a) && a.some(s => typeof s === 'string' && s.trim() !== '')
}

/** 需求准入六项覆盖检查。纯函数：同输入同输出。 */
export function checkDigest(input: DigestInput): DigestResult {
  const missing: string[] = []
  const coverage: DigestCoverageItem[] = []

  const req = typeof input.requirement === 'string' ? input.requirement.trim() : ''
  const hasDo = isNonEmptyArray(input.doItems)
  coverage.push({
    item: '① 需求覆盖（Do / Don\u2019t / To Confirm）',
    ok: req !== '' && hasDo,
    note: req === '' ? '需求原文为空' : hasDo ? `Do ${input.doItems.length} 项 / Don't ${input.dontItems?.length ?? 0} 项 / 待确认 ${input.toConfirm?.length ?? 0} 项` : '缺少「做」条目——PRD 条目必须逐项归属',
  })
  if (req === '') missing.push('补需求原文')
  if (!hasDo) missing.push('把需求条目逐项归属为「做/不做/待确认」（至少要有「做」）')

  const hasSystems = isNonEmptyArray(input.systems)
  coverage.push({
    item: '② 系统覆盖（Services/Repos/Dependencies）',
    ok: hasSystems,
    note: hasSystems ? `涉及 ${input.systems.length} 个系统/仓库` : '缺少涉及系统清单（对照 dsh 生态矩阵或空清单声明）',
  })
  if (!hasSystems) missing.push('列出涉及的服务/仓库/上下游（若无也需显式声明空集原因）')

  const evidences = Array.isArray(input.evidences) ? input.evidences : []
  const badEvidence = evidences.filter(e => e == null || typeof e.conclusion !== 'string' || e.conclusion.trim() === '' || typeof e.source !== 'string' || e.source.trim() === '')
  coverage.push({
    item: '③ 证据覆盖（结论可回源）',
    ok: evidences.length > 0 && badEvidence.length === 0,
    note: evidences.length === 0 ? '没有任何关键结论登记' : badEvidence.length === 0 ? `${evidences.length} 条结论均有来源` : `${badEvidence.length} 条结论缺来源`,
  })
  if (evidences.length === 0) missing.push('登记关键结论及其证据来源')
  if (badEvidence.length > 0) missing.push('为每条关键结论补证据来源（当前行为以代码为准）')

  coverage.push({
    item: '④ 风险覆盖（兼容/异常/缓存/MQ/状态/安全）',
    ok: input.risksChecked === true,
    note: input.risksChecked === true ? '已逐类检查' : '风险检查未声明完成',
  })
  if (input.risksChecked !== true) missing.push('逐类过风险清单后置 risksChecked=true')

  const hasValidation = typeof input.validationPlan === 'string' && input.validationPlan.trim() !== ''
  coverage.push({
    item: '⑤ 验证覆盖（如何算完成）',
    ok: hasValidation,
    note: hasValidation ? '验证计划已登记' : '缺少验证计划',
  })
  if (!hasValidation) missing.push('补验证计划（至少明确「如何算完成」）')

  const blockers = isNonEmptyArray(input.blockers)
  const assumptionItems = isNonEmptyArray(input.assumptions)
  const hasUncertaintyRegister = blockers || assumptionItems || isNonEmptyArray(input.toConfirm)
  coverage.push({
    item: '⑥ 不确定性治理（Unknown/Conflict 显式登记）',
    ok: hasUncertaintyRegister || (req !== '' && hasDo),
    note: blockers ? `阻断项 ${input.blockers.length} 项（不通过主因）` : hasUncertaintyRegister ? '未知/待确认已显式登记（未擅自补全）' : '无登记项——若无未知项请在 toConfirm/assumptions 显式留空并说明',
  })

  const hardFail = blockers || !hasDo || !hasValidation || evidences.length === 0 || badEvidence.length > 0 || input.risksChecked !== true || req === ''
  return {
    admission: hardFail ? '不通过' : '通过',
    coverage,
    missing,
    next: hardFail ? '补齐 missing 清单后重跑准入；不足标「未知/待验证」，不得编造' : '准入通过，可进入 architect-design（设计后仍须 architect-review + 主人确认）',
  }
}
