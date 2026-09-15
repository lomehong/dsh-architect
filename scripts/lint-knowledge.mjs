#!/usr/bin/env node
/**
 * knowledge-lint CLI：对 architect-knowledge/ 知识库做结构校验（母包 P1-1）。
 *
 * 用法：node dsh-architect/scripts/lint-knowledge.mjs [知识库根目录]（默认 architect-knowledge）
 * 依赖：node >= 22；需先 `npm ci`（file: 依赖 architect-core 就绪）——核心经包名导入，外壳单独安装亦可解析。
 *
 * 分层（2026-09-11 重构，与两宿主工具共用同一实现，杜绝双采集器漂移）：
 *   kbcollect.collectKnowledgeSnapshot（fs 采集）→ lintKnowledge（纯函数校验）→ 本脚本只做报告与 exit code。
 * 退出码：0 = pass；1 = 有 error（Q1：error 阻断 CI）。
 *
 * @module @dsh-extra/dsh-architect/lint-cli
 */
import { lintKnowledgeAt } from 'architect-core'

// 显式覆盖：--isolated / --full；env LINT_KB_ISOLATED=1/0（缺省自动探测：.snapshot 标记或正向证据）
const args = process.argv.slice(2)
const rootArg = args.find(a => !a.startsWith('--')) ?? 'architect-knowledge'
const flagIso = args.includes('--isolated') ? true : args.includes('--full') ? false : undefined
const envIso = process.env.LINT_KB_ISOLATED
const isolated = flagIso ?? (envIso === '1' ? true : envIso === '0' ? false : undefined)
const result = lintKnowledgeAt(rootArg, process.cwd(), { isolated })

console.log(`knowledge-lint｜root=${result.root}`)
if (result.isolated) console.log(`⚠️ 隔离上下文（快照/活仓挂载）：KB 外 ref 降 warning，备案计数见下；如需严格请 --full`)
const s = result.stats
console.log(`条目 ${s.entries}（已确认 ${s.confirmed} / 待审核 ${s.pending}）｜错误 ${result.errors.length}｜警告 ${result.warnings.length}`)
for (const i of result.errors) console.log(`  ⛔ [${i.rule}] ${i.path}：${i.message}`)
for (const w of result.warnings) console.log(`  ⚠️  [${w.rule}] ${w.path}：${w.message}`)
console.log(result.pass ? '✅ PASS' : '⛔ FAIL（error 阻断 CI——主人 2026-09-10 拍板 Q1）')
process.exit(result.pass ? 0 : 1)
