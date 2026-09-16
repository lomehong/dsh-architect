#!/usr/bin/env node
/**
 * dsh 升级兼容审计（check-compat）——2026-09-16 事故防复发机制。
 *
 * 事故回顾：dsh 0.1.6-alpha.1 移除 @deepseek-ai/dsh-workflow-worker-thread 后，
 * 套件仓库里的 agent 预设模板仍引用旧包名 → 上游 agent-presets 把整份组合判为
 * 不可挂载 → 挂载被拒 / 会话恢复失败。同类风险还有三族：
 *   ① 组合行引用的包在目标解析链上不存在（本审计的主检查）；
 *   ② 构建产物 import 了已被宿主移除/更名的 @deepseek-ai/* 包
 *      （model-failover / plugin-manager 的 dsh-settings 死 import 即此类）；
 *   ③ 预设模板与已物化副本漂移，且物化器版本戳未 bump，修复永远发不下去。
 *
 * 本脚本做三件事（全部只读，绝不修改任何文件）：
 *   A. 组合行审计 —— 扫描仓库内所有 cordis.patch.yml / presets/*.cordis.yml
 *      （以及 $DSH_HOME/.agent-presets 下已物化的预设），取每行 name: 引用的包，
 *      按 Node 解析链验证存在性（自引 → 包内 node_modules → profile node_modules
 *      → 宿主镜像 <home>/profiles/node_modules/@deepseek-ai）。
 *   B. 运行时 import 审计 —— 扫描各包 lib/**\/*.js 对 @deepseek-ai/* 的
 *      import/require 动态导入说明符，验证目标包在解析链上存在。
 *   C. 预设漂移审计 —— 模板 vs 已物化副本（模板每个 name: 必须出现在副本中，
 *      否则 = 副本落后：bump 物化器版本戳并重启）；手工维护的预设（如
 *      standard-yuyi）与 shipped standard 按 name: 集合比对，多出的行须在白名单内。
 *
 * 用法：
 *   node check-compat.mjs [--repo <套件仓库根>] [--home <DSH_HOME>] [--profile web]
 * 退出码：0 = 通过（警告不阻塞）；1 = 存在 ERROR 级问题。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ────────────────────────── 参数 ──────────────────────────
const scriptDir = dirname(fileURLToPath(import.meta.url))
function argOf(flag, fallback) {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
// Desktop home layouts: newer releases use dsh-desktop\home, legacy used
// dsh-desktop-app-data\home. Probe both before falling back to ~/.dsh.
const desktopHomes = [
  join(process.env.LOCALAPPDATA ?? '', 'dsh-desktop', 'home'),
  join(process.env.LOCALAPPDATA ?? '', 'dsh-desktop-app-data', 'home'),
]
const HOME = resolve(argOf('--home', process.env.DSH_HOME ?? (desktopHomes.find((p) => existsSync(p)) ?? join(process.env.USERPROFILE ?? '.', '.dsh'))))
const PROFILE = argOf('--profile', process.env.DSH_PROFILE ?? 'web')
const REPO = resolve(argOf('--repo', dirname(scriptDir)))

const errors = []
const warnings = []
const error = (msg) => errors.push(msg)
const warn = (msg) => warnings.push(msg)

// ─────────────────── 解析链根（按优先级） ───────────────────
// 注意：这些根都是 node_modules 层；@scope/pkg 由 resolveRowName 用完整包名拼接。
const mirrorScope = join(HOME, 'profiles', 'node_modules')
const profileNodeModules = join(HOME, 'profiles', PROFILE, 'node_modules')
const homeNodeModules = join(HOME, 'node_modules')

/** 检查包根存在且带 package.json。 */
function pkgOk(pkgDir) {
  return existsSync(join(pkgDir, 'package.json'))
}

/**
 * 解析一个组合行 name:（可含 ./subpath）。
 * @param {string} name        如 '@deepseek-ai/dsh-tools'、'dsh-yuyi/tools'
 * @param {string[]} extraRoots 包自身 node_modules 等优先根
 * @returns {{ ok: boolean, via: string, subpath: string | null }}
 */
function resolveRowName(name, extraRoots = []) {
  const segments = name.split('/')
  const pkgName = segments[0].startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]
  const subpath = segments.slice(pkgName.split('/').length).join('/')
  const roots = [
    ...extraRoots,
    profileNodeModules,
    homeNodeModules,
    pkgName.startsWith('@deepseek-ai/') ? mirrorScope : null,
  ].filter(Boolean)
  for (const root of roots) {
    const pkgDir = join(root, pkgName)
    if (pkgOk(pkgDir)) {
      if (subpath) {
        const ok = exportsHasSubpath(pkgDir, `./${subpath}`)
        return { ok, via: pkgDir, subpath: subpath || null }
      }
      return { ok: true, via: pkgDir, subpath: null }
    }
  }
  return { ok: false, via: '', subpath: subpath || null }
}

/** package.json exports 是否声明某子路径（宽松：无 exports 视为通过）。 */
function exportsHasSubpath(pkgDir, subpath) {
  try {
    const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
    if (!manifest.exports) return true
    const entry = manifest.exports[subpath]
    if (entry === undefined) return false
    return true
  } catch {
    return true // manifest 不可读交由 pkgOk 判断，这里不重复报错
  }
}

// ─────────────────── A. 组合行审计 ───────────────────
const ROW_NAME_RE = /^\s*(?:-\s+)?name:\s*['"]?([^'"\n]+?)['"]?\s*$/gm
function auditCompositionFile(file, label, extraRoots = []) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (e) {
    warn(`${label}: 无法读取（${e.message}）`)
    return
  }
  ROW_NAME_RE.lastIndex = 0
  let m
  const seen = new Set()
  while ((m = ROW_NAME_RE.exec(text)) !== null) {
    const name = m[1].trim()
    if (name === 'cordis:group' || seen.has(name)) continue
    seen.add(name)
    const r = resolveRowName(name, extraRoots)
    if (!r.ok) {
      // 仓库内自引行（包目录在 REPO 下、带 package.json + cordis.patch.yml）且未部署：
      // 属"本地开发包"的已知状态，降级为 WARN；其余解析失败保持 ERROR（2026-09-16 事故类）。
      const tail = name.split('/').pop()
      const localDir = join(REPO, tail)
      const selfReferenced = existsSync(join(localDir, 'package.json')) && existsSync(join(localDir, 'cordis.patch.yml'))
      if (selfReferenced) {
        warn(`${label}: 行 name: '${name}' 当前未部署（仓库内本地包，link:/Release 部署后生效）`)
      } else {
        error(`${label}: 行 name: '${name}' 在解析链上不存在（profile=${PROFILE}）—— 升级后该行会让整份组合拒绝挂载`)
      }
    }
  }
}

/** 仓库内组合文件清单（不动 node_modules；深度 ≤3）。 */
function findCompositionFiles(root) {
  const out = []
  const walk = (dir, depth) => {
    if (depth > 3) return
    let entries
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue
      const full = join(dir, entry)
      let st
      try { st = statSync(full) } catch { continue }
      if (st.isDirectory()) {
        walk(full, depth + 1)
      } else if (entry === 'cordis.patch.yml' || (entry.endsWith('.cordis.yml') && full.includes(join(root, 'presets')))) {
        out.push(full)
      }
    }
  }
  walk(root, 0)
  return out
}

// ─────────────────── B. 运行时 import 审计 ───────────────────
const IMPORT_RES = [
  /from\s+['"](@deepseek-ai\/[a-z0-9-]+(?:\/[a-z0-9.-]+)*)['"]/g,
  /import\(\s*['"](@deepseek-ai\/[a-z0-9-]+(?:\/[a-z0-9.-]+)*)['"]\s*\)/g,
  /require\(\s*['"](@deepseek-ai\/[a-z0-9-]+(?:\/[a-z0-9.-]+)*)['"]\s*\)/g,
]
function walkJsFiles(dir, out = []) {
  let entries
  try { entries = readdirSync(dir) } catch { return out }
  for (const entry of entries) {
    if (entry.endsWith('.map') || entry.endsWith('.d.ts')) continue
    const full = join(dir, entry)
    let st
    try { st = statSync(full) } catch { continue }
    if (st.isDirectory()) walkJsFiles(full, out)
    // lib/client.js（及 client/ 目录）是浏览器半产物：由页面 ModuleLoader 解析，
    // 不经 Node 镜像（如 dsh-client-ui-primitives 这类前端内置模块），跳过 Node 解析审计
    else if (entry.endsWith('.js') && !isClientArtifact(full, dir)) out.push(full)
  }
  return out
}
function isClientArtifact(file, libDir) {
  if (file.toLowerCase() === join(libDir, 'client.js').toLowerCase()) return true
  return file.toLowerCase().startsWith(join(libDir, 'client').toLowerCase() + '\\')
    || file.toLowerCase().startsWith(join(libDir, 'client').toLowerCase() + '/')
}
function auditRuntimeImports(pkgDir, label) {
  const libDir = join(pkgDir, 'lib')
  if (!existsSync(libDir)) return
  const ownNodeModules = join(pkgDir, 'node_modules')
  const files = walkJsFiles(libDir)
  const seen = new Set()
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const re of IMPORT_RES) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(text)) !== null) {
        const spec = m[1]
        const pkgName = spec.split('/').slice(0, 2).join('/')
        if (seen.has(pkgName)) continue
        seen.add(pkgName)
        const inOwn = pkgOk(join(ownNodeModules, pkgName))
        const inMirror = pkgOk(join(mirrorScope, pkgName))
        const inProfile = pkgOk(join(profileNodeModules, pkgName))
        if (!inOwn && !inMirror && !inProfile) {
          error(`${label}: 运行时 import '${pkgName}' 不存在于宿主镜像/解析链 —— 启动即 ERR_MODULE_NOT_FOUND（若宿主已移除该包，需迁移代码）`)
        }
      }
    }
  }
}

// ─────────────────── C. 预设漂移审计 ───────────────────
function rowNames(file) {
  const text = readFileSync(file, 'utf8')
  const names = new Set()
  ROW_NAME_RE.lastIndex = 0
  let m
  while ((m = ROW_NAME_RE.exec(text)) !== null) {
    const name = m[1].trim()
    if (name !== 'cordis:group') names.add(name)
  }
  return names
}
const userPresetsRoot = join(HOME, '.agent-presets')
function auditPresetDrift(spec) {
  const mountedFile = join(userPresetsRoot, spec.mountedId, 'agent.cordis.yml')
  if (!existsSync(mountedFile)) {
    warn(`预设漂移: ${spec.mountedId} 未物化（${mountedFile} 不存在），跳过`)
    return
  }
  const mounted = rowNames(mountedFile)
  const sourceNames = spec.templateFile
    ? rowNames(spec.templateFile)
    : rowNames(spec.shippedStandardFile)
  for (const name of sourceNames) {
    if (!mounted.has(name)) {
      error(`预设漂移: ${spec.mountedId} 缺少来源行 name: '${name}'（来源=${spec.templateFile ? '仓库模板' : 'shipped standard'}）—— 模板已演进但副本未重物化：bump 物化器 PRESET_VERSION 后重启，或手工同步`)
    }
  }
  const allow = new Set(spec.allowExtras ?? [])
  for (const name of mounted) {
    if (!sourceNames.has(name) && !allow.has(name)) {
      error(`预设漂移: ${spec.mountedId} 多出来源外行 name: '${name}' 且不在白名单 —— 确认是有意增量（加入 allowExtras）还是残留`)
    }
  }
}

// ─────────────────── 套件识别 ───────────────────
const shippedStandard = join(mirrorScope, '@deepseek-ai', 'dsh-agent-presets', 'presets', 'standard', 'agent.cordis.yml')
const SUITES = []
if (existsSync(join(REPO, 'dsh-twin', 'package.json'))) {
  SUITES.push({
    label: '数字分身套件',
    presetRoots: ['dsh-twin/presets'],
    drift: [
      {
        mountedId: 'digital-twin',
        templateFile: join(REPO, 'dsh-twin', 'presets', 'digital-twin', 'agent.cordis.yml'),
        // 物化器按安装状态追加的可选行：模板里没有属正常增量
        allowExtras: ['@dsh-extra/dsh-memory/tools', 'dsh-yuyi/tools', '@dsh-extra/dsh-computer/tools', '@dsh-extra/dsh-task-board/tools', '@dsh-extra/dsh-architect/tools'],
      },
      {
        mountedId: 'standard-yuyi',
        shippedStandardFile: shippedStandard,
        allowExtras: ['dsh-yuyi/tools', '@dsh-extra/dsh-memory/tools', '@dsh-extra/dsh-computer/tools', '@dsh-extra/dsh-task-board/tools'],
      },
    ],
  })
}
if (existsSync(join(REPO, 'dsh-architect', 'package.json'))) {
  SUITES.push({
    label: '数字架构师套件',
    presetRoots: ['dsh-architect/presets'],
    drift: [
      {
        mountedId: 'architect',
        templateFile: join(REPO, 'dsh-architect', 'presets', 'architect', 'agent.cordis.yml'),
        allowExtras: ['dsh-yuyi/tools', '@dsh-extra/dsh-memory/tools'],
      },
    ],
  })
} else if (existsSync(join(REPO, 'presets', 'architect', 'agent.cordis.yml'))) {
  // 脚本放进 dsh-architect 包内（scripts/check-compat.mjs）时：REPO 即包根
  SUITES.push({
    label: '数字架构师套件（dsh-architect 包内）',
    presetRoots: ['presets'],
    drift: [
      {
        mountedId: 'architect',
        templateFile: join(REPO, 'presets', 'architect', 'agent.cordis.yml'),
        allowExtras: ['dsh-yuyi/tools', '@dsh-extra/dsh-memory/tools'],
      },
    ],
  })
}
if (SUITES.length === 0) {
  // 兜底：无已知套件标记时按通用布局扫描
  SUITES.push({ label: `通用扫描（${REPO}）`, presetRoots: [], drift: [] })
}

// ─────────────────── 执行 ───────────────────
console.log(`[check-compat] home=${HOME} profile=${PROFILE} repo=${REPO}`)
for (const suite of SUITES) {
  console.log(`[check-compat] ── ${suite.label} ──`)
  // A. 仓库内组合文件
  const compFiles = findCompositionFiles(REPO)
  for (const file of compFiles) {
    // 自引解析根：该文件所属包目录（link: 自引时包就在 profile 里，但仓库内也核一份）
    auditCompositionFile(file, `组合 ${file.replace(REPO, '')}`)
  }
  // A+. 已物化预设审计（每个用户预设的每一行都按当前 profile 解析链核对）
  if (existsSync(userPresetsRoot)) {
    for (const entry of readdirSync(userPresetsRoot)) {
      const yml = join(userPresetsRoot, entry, 'agent.cordis.yml')
      if (existsSync(yml)) auditCompositionFile(yml, `已物化预设 ${entry}`)
    }
  }
  // B. 各包运行时 import（lib/ 存在的包）
  for (const pkgName of readdirSync(REPO)) {
    if (pkgName === 'node_modules' || pkgName.startsWith('.')) continue
    const pkgDir = join(REPO, pkgName)
    try { if (!statSync(pkgDir).isDirectory()) continue } catch { continue }
    const candidates = [pkgDir, join(pkgDir, 'im-channel'), join(pkgDir, 'ui-settings-im'), join(pkgDir, 'dsh-client-ui-settings-im')]
    for (const dir of candidates) {
      if (existsSync(join(dir, 'package.json'))) {
        auditRuntimeImports(dir, `运行时 ${dir.replace(REPO, '')}`)
      }
    }
  }
  // C. 漂移
  for (const spec of suite.drift) auditPresetDrift(spec)
}

// 汇总
console.log('')
for (const w of warnings) console.log(`[WARN ] ${w}`)
for (const e of errors) console.log(`[ERROR] ${e}`)
console.log(`[check-compat] 结果：${errors.length} error, ${warnings.length} warning`)
process.exit(errors.length > 0 ? 1 : 0)
