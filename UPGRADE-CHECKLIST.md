# dsh 运行时升级检查清单（dsh-architect / 数字架构师套件）

> 2026-09-16 事故：dsh 0.1.6-alpha.1 移除 `@deepseek-ai/dsh-workflow-worker-thread`，
> 本包 `presets/architect/agent.cordis.yml` 的 delegation 组仍引用旧包名 →
> 每次新鲜物化都产出挂载必失败的预设。当时挂载副本靠手修 + 版本戳"碰巧相等"
> 侥幸没被坏模板写回。本清单与回归测试（`tests/preset-template.spec.ts`）、
> 审计脚本（`scripts/check-compat.mjs`）共同保证同类问题不再复发。

## 升级标准动作

1. **升级前**：`node scripts/check-compat.mjs` → 记录基线（应 0 error）。
2. **升级后重跑**：任何 ERROR 按下表处置。
3. **改过 `presets/architect/agent.cordis.yml` = 必须 bump `src/materialize.ts` 的
   `PRESET_VERSION`**（当前 `'2'`），并 `npm run build` 同步 `lib/materialize.js`。
   不 bump = 修复永远追不上已物化副本（物化器按戳跳过）。
4. `npm run build && npm test`（测试含模板静态回归：禁止 workflow-worker-thread、
   必须 workflow-ptc / present / persona prefix）。
5. 发布新 Release（pack-release.mjs），宿主 profile 重新安装。
6. 挂载验证：`architect` 预设开新会话（或经 `agentPresets.standingKeyFor('architect')`），
   确认 architect_* 工具、workflow、present 行为正常。

## ERROR 形态速查

| 审计输出 | 处置 |
|---|---|
| `组合 …: 行 name: '…' 在解析链上不存在` | 预设/patch 行引用了被移除的宿主包 → 对齐新版 shipped standard 改行，bump PRESET_VERSION |
| `运行时 …: import '…' 不存在` | lib/ 硬 import 被宿主移除的包/导出 → 迁移代码后重建 |
| `预设漂移: … 缺少来源行` | 模板演进未下发 → bump PRESET_VERSION 重物化（或手工同步挂载副本） |
| `预设漂移: … 多出来源外行` | 副本有模板外行：物化器可选行（加入 `allowExtras`）或残留（清理） |

## 可选行探测规则（2026-09-16 教训 #2）
`src/materialize.ts` 的 `detectOptionalPackages` **只探测当前 profile** 的
node_modules（按 bundle 安装位置推断，见 `currentProfileFromPackageDir`）。
不要改回全 profile 扫描：会把只在别的 profile 安装的包写成可选行，
挂载时本 profile 解析不到 → 整份预设被拒。

## architect profile 的依赖纪律
architect profile（`$DSH_HOME/profiles/architect/package.json`）若启用，
其 dependencies 必须覆盖 OPTIONAL_ROWS 引用的全部可选包
（当前缺 `@dsh-extra/dsh-memory`——未装时物化器不会追加 tool-memory 行，属正常降级）。
