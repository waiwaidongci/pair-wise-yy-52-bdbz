import { defineStore } from 'pinia'
import type { AuditEvent, ConnectionState, DiffEntry, FieldOperation, IsolationPoint, OperationSource, Permit, PermitStep, PointState } from '~/types'
import { auditEvents as seedAudit, operators, permits as seedPermits } from '~/utils/mock'

const STORAGE_KEY = 'yy52-permit-ops-v2'

function nowTime() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}
function genId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/** 补齐旧版本数据缺少的修订/确认字段 */
function normalizePermit(raw: Permit): Permit {
  return {
    ...raw,
    isolationPoints: raw.isolationPoints.map((pt) => ({ ...pt, revision: pt.revision ?? 1 })),
    steps: raw.steps.map((st) => ({ ...st, revision: st.revision ?? 1, confirmations: st.confirmations ?? [] })),
  }
}

export const useOperationsStore = defineStore('operations', () => {
  const permits = ref<Permit[]>(seedPermits.map(normalizePermit))
  const audit = ref<AuditEvent[]>(structuredClone(seedAudit))
  const connection = ref<ConnectionState>('在线')
  const outbox = ref<FieldOperation[]>([])
  const appliedOpIds = ref<string[]>([])
  const currentSource = ref<OperationSource>(operators[0]!)
  const latestAlert = ref('18:00–20:00 LINE-A2 存在跨班组重叠作业')
  const loaded = ref(false)

  const pendingCount = computed(() => outbox.value.length)
  const conflictCount = computed(() => outbox.value.filter((o) => o.status === 'conflict').length)

  function persist() {
    if (import.meta.client) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        permits: permits.value,
        audit: audit.value,
        outbox: outbox.value,
        appliedOpIds: appliedOpIds.value,
        currentSource: currentSource.value,
      }))
    }
  }
  function restore() {
    if (!import.meta.client || loaded.value) return
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const draft = JSON.parse(raw)
      if (draft.permits) permits.value = draft.permits.map(normalizePermit)
      if (draft.audit) audit.value = draft.audit
      if (draft.outbox) outbox.value = draft.outbox
      if (draft.appliedOpIds) appliedOpIds.value = draft.appliedOpIds
      if (draft.currentSource) currentSource.value = draft.currentSource
    }
    loaded.value = true
  }

  function addAudit(action: string, target: string, detail: string, source?: OperationSource) {
    const s = source ?? currentSource.value
    audit.value.unshift({
      id: genId('AE'),
      time: nowTime(),
      actor: s.actor,
      action,
      target,
      detail,
      source: s,
    })
    persist()
  }

  // ───────────────────────── 复核失效重算 ─────────────────────────

  /** 某隔离点状态变化后，所有引用该点/该设备的许可复核结果立即失效 */
  function invalidateForPoint(changed: IsolationPoint) {
    for (const permit of permits.value) {
      const touched = permit.isolationPoints.some(
        (pt) => pt.id === changed.id || pt.device === changed.device || (changed.device === 'BUS-A' && pt.device === 'BUS-A'),
      )
      if (!touched) continue
      permit.reviewRequired = true
      if (permit.status !== '待复核' && permit.status !== '已完成') {
        permit.status = '待复核'
        addAudit('复核失效', permit.id, `隔离点「${changed.label}」(${changed.device}) 状态变为 ${changed.state}，复核结果失效，退回待复核`)
      }
    }
  }

  /** 复核通过：快照当前各隔离点修订号，之后点修订再超过快照即失效 */
  function passReview(permitId: string) {
    const permit = permits.value.find((p) => p.id === permitId)
    if (!permit) return
    permit.lastReviewPointRevisions = Object.fromEntries(permit.isolationPoints.map((pt) => [pt.id, pt.revision]))
    permit.reviewRequired = false
    if (permit.status === '待复核') permit.status = '待执行'
    permit.revision += 1
    addAudit('复核通过', permit.id, `核对 ${permit.isolationPoints.length} 个隔离点状态，准予执行（r${permit.revision}）`)
    persist()
  }

  // ───────────────────────── 权威应用（服务端语义） ─────────────────────────

  function snapshotStep(step: PermitStep): Record<string, unknown> {
    return { done: step.done, evidence: step.evidence, revision: step.revision, updatedBy: step.updatedBy, updatedAt: step.updatedAt, confirmations: [...step.confirmations] }
  }
  function snapshotPoint(point: IsolationPoint): Record<string, unknown> {
    return { state: point.state, revision: point.revision, updatedBy: point.updatedBy, updatedAt: point.updatedAt }
  }

  function diffStep(step: PermitStep, patch: Record<string, unknown>): DiffEntry[] {
    const entries: DiffEntry[] = []
    if ('done' in patch) entries.push({ field: 'done', label: '步骤状态', local: patch.done, remote: step.done, remoteSource: step.updatedBy, remoteAt: step.updatedAt })
    if ('evidence' in patch) entries.push({ field: 'evidence', label: '现场证据', local: patch.evidence, remote: step.evidence, remoteSource: step.updatedBy, remoteAt: step.updatedAt })
    return entries
  }
  function diffPoint(point: IsolationPoint, patch: Record<string, unknown>): DiffEntry[] {
    const entries: DiffEntry[] = []
    if ('state' in patch) entries.push({ field: 'state', label: '隔离点状态', local: patch.state, remote: point.state, remoteSource: point.updatedBy, remoteAt: point.updatedAt })
    return entries
  }

  /**
   * 应用一条操作（服务端权威）。
   * - 幂等：op.id 已应用过 → 跳过；目标状态已等于补丁 → 视为重复，不再追加。
   * - 冲突：基线修订 < 当前修订（别人改过）→ 返回 diff，绝不覆盖。
   */
  function applyOp(op: FieldOperation): { ok: boolean; diff?: DiffEntry[]; error?: string; idempotent?: boolean } {
    const permit = permits.value.find((p) => p.id === op.permitId)
    if (!permit) return { ok: false, error: '许可不存在' }

    if (op.kind === 'step') {
      const step = permit.steps.find((s) => s.id === op.stepId)
      if (!step) return { ok: false, error: '步骤不存在' }
      // 幂等：状态已一致（含我方离线乐观更新已落定、或重复补传）
      if (('done' in op.patch && step.done === op.patch.done) && (!('evidence' in op.patch) || step.evidence === op.patch.evidence)) {
        if (op.patch.done === true && !step.confirmations.some((c) => c.source.actor === op.source.actor && c.at === op.createdAt)) {
          step.confirmations.push({ source: op.source, at: op.createdAt, note: op.note ?? (op.patch.evidence as string | undefined) })
        }
        return { ok: true, idempotent: true }
      }
      if (step.revision !== op.baseRevision) {
        return { ok: false, diff: diffStep(step, op.patch) }
      }
      Object.assign(step, op.patch)
      step.revision += 1
      step.updatedBy = op.source
      step.updatedAt = op.createdAt
      if (op.patch.done === true) step.confirmations.push({ source: op.source, at: op.createdAt, note: op.note ?? (op.patch.evidence as string | undefined) })
      permit.revision += 1
      return { ok: true }
    }

    if (op.kind === 'point') {
      const point = permit.isolationPoints.find((pt) => pt.id === op.pointId)
      if (!point) return { ok: false, error: '隔离点不存在' }
      if ('state' in op.patch && point.state === op.patch.state) return { ok: true, idempotent: true }
      if (point.revision !== op.baseRevision) {
        return { ok: false, diff: diffPoint(point, op.patch) }
      }
      Object.assign(point, op.patch)
      point.revision += 1
      point.updatedBy = op.source
      point.updatedAt = op.createdAt
      permit.revision += 1
      invalidateForPoint(point)
      return { ok: true }
    }

    return { ok: false, error: '未知操作类型' }
  }

  // ───────────────────────── 提交（在线立即 / 离线暂存） ─────────────────────────

  function submitStep(permitId: string, stepId: string, patch: { done?: boolean; evidence?: string }, note?: string, source?: OperationSource) {
    const s = source ?? currentSource.value
    const permit = permits.value.find((p) => p.id === permitId)
    const step = permit?.steps.find((st) => st.id === stepId)
    if (!permit || !step) return

    const op: FieldOperation = {
      id: genId('OP'),
      kind: 'step',
      permitId,
      stepId,
      patch,
      source: s,
      baseRevision: step.revision,
      basePermitRevision: permit.revision,
      createdAt: nowTime(),
      status: 'queued',
      attempts: 0,
      note,
    }

    if (connection.value === '在线') {
      const res = applyOp(op)
      if (res.ok) {
        op.status = 'applied'
        appliedOpIds.value.push(op.id)
        const target = `${permitId} / ${stepId}`
        if (res.idempotent) addAudit('重复补传忽略', target, `步骤已为目标状态，操作 ${op.id} 只保留一次`, s)
        else addAudit(patch.done === false ? '撤销步骤' : '确认步骤', target, `${step.text}${note ? ` · ${note}` : ''}（${s.crew}·${s.actor} 于 ${op.createdAt}）`, s)
      } else if (res.diff) {
        op.status = 'conflict'
        op.diff = res.diff
        op.remoteSnapshot = snapshotStep(step)
        outbox.value.push(op)
      }
    } else {
      // 离线：乐观更新界面，但不递增修订号；待补传时由服务端基线比对
      const existing = outbox.value.find((o) => o.status === 'queued' && o.permitId === permitId && o.stepId === stepId)
      if (existing) {
        existing.patch = { ...existing.patch, ...patch }
        existing.createdAt = op.createdAt
      } else {
        outbox.value.push(op)
        if (patch.done !== undefined) step.done = patch.done
        if (patch.evidence !== undefined) step.evidence = patch.evidence
      }
      addAudit('离线暂存', `${permitId} / ${stepId}`, `${step.text}（${s.crew}·${s.actor} 于 ${op.createdAt}）已暂存，网络恢复后补传`, s)
    }
    persist()
  }

  function submitPoint(permitId: string, pointId: string, state: PointState, source?: OperationSource) {
    const s = source ?? currentSource.value
    const permit = permits.value.find((p) => p.id === permitId)
    const point = permit?.isolationPoints.find((pt) => pt.id === pointId)
    if (!permit || !point) return

    const op: FieldOperation = {
      id: genId('OP'),
      kind: 'point',
      permitId,
      pointId,
      patch: { state },
      source: s,
      baseRevision: point.revision,
      basePermitRevision: permit.revision,
      createdAt: nowTime(),
      status: 'queued',
      attempts: 0,
    }

    if (connection.value === '在线') {
      const res = applyOp(op)
      if (res.ok) {
        op.status = 'applied'
        appliedOpIds.value.push(op.id)
        if (!res.idempotent) addAudit('隔离操作', `${permitId} / ${pointId}`, `${point.label} 状态 → ${state}（${s.crew}·${s.actor} 于 ${op.createdAt}）`, s)
      } else if (res.diff) {
        op.status = 'conflict'
        op.diff = res.diff
        op.remoteSnapshot = snapshotPoint(point)
        outbox.value.push(op)
      }
    } else {
      const existing = outbox.value.find((o) => o.status === 'queued' && o.permitId === permitId && o.pointId === pointId)
      if (existing) {
        existing.patch = { state }
        existing.createdAt = op.createdAt
      } else {
        outbox.value.push(op)
        point.state = state
      }
      addAudit('离线暂存', `${permitId} / ${pointId}`, `${point.label} 状态 → ${state}（${s.crew}·${s.actor} 于 ${op.createdAt}）已暂存，网络恢复后补传`, s)
    }
    persist()
  }

  // ───────────────────────── 网络恢复：补传合并 ─────────────────────────

  function retryOutbox() {
    if (connection.value !== '在线') return
    for (const op of [...outbox.value]) {
      if (op.status === 'applied') continue
      if (appliedOpIds.value.includes(op.id)) {
        op.status = 'applied'
        continue
      }
      op.attempts += 1
      const res = applyOp(op)
      if (res.ok) {
        op.status = 'applied'
        appliedOpIds.value.push(op.id)
        const target = op.kind === 'step' ? `${op.permitId} / ${op.stepId}` : `${op.permitId} / ${op.pointId}`
        if (res.idempotent) addAudit('重复补传忽略', target, `操作 ${op.id} 已生效，重复补传只留一次`, op.source)
        else addAudit(op.kind === 'step' ? '现场确认补传' : '隔离操作补传', target, `${op.source.crew}·${op.source.actor} 于 ${op.createdAt} 的操作已补传成功`, op.source)
      } else if (res.diff) {
        op.status = 'conflict'
        op.diff = res.diff
        const permit = permits.value.find((p) => p.id === op.permitId)
        op.remoteSnapshot = op.kind === 'step'
          ? snapshotStep(permit!.steps.find((s) => s.id === op.stepId)!)
          : snapshotPoint(permit!.isolationPoints.find((pt) => pt.id === op.pointId)!)
        const changed = res.diff.map((d) => `${d.label}: 对方「${String(d.remote)}」`).join('，')
        addAudit('补传冲突', `${op.permitId} / ${op.stepId ?? op.pointId}`, `对方已修改（${changed}），已显示差异，未覆盖对方记录`, op.source)
      } else {
        op.status = 'failed'
        op.error = res.error
      }
    }
    outbox.value = outbox.value.filter((o) => o.status !== 'applied')
    persist()
  }

  /** 冲突处理：采纳对方（回滚我方乐观更新）或追加我方确认（不覆盖对方） */
  function resolveConflict(opId: string, mode: 'accept-remote' | 'append-mine') {
    const op = outbox.value.find((o) => o.id === opId)
    if (!op || op.status !== 'conflict') return
    const permit = permits.value.find((p) => p.id === op.permitId)
    const target = `${op.permitId} / ${op.stepId ?? op.pointId}`

    if (mode === 'accept-remote') {
      if (op.remoteSnapshot && op.kind === 'step') {
        const step = permit?.steps.find((s) => s.id === op.stepId)
        if (step) Object.assign(step, op.remoteSnapshot)
      }
      addAudit('冲突处理', target, `采纳对方记录，放弃 ${op.source.crew}·${op.source.actor} 的本地确认`, op.source)
    } else {
      // 追加我方确认：不改动对方字段，只追加确认历史
      if (op.kind === 'step') {
        const step = permit?.steps.find((s) => s.id === op.stepId)
        if (step && op.patch.done === true) step.confirmations.push({ source: op.source, at: nowTime(), note: op.note })
      }
      addAudit('追加确认', target, `在对方记录基础上追加 ${op.source.crew}·${op.source.actor} 的现场确认，未覆盖对方记录`, op.source)
    }
    outbox.value = outbox.value.filter((o) => o.id !== opId)
    persist()
  }

  // ───────────────────────── 远端他人操作（实时通道） ─────────────────────────

  function applyRemoteStepConfirm(payload: { permitId: string; stepId: string; done: boolean; evidence?: string; source: OperationSource }) {
    const permit = permits.value.find((p) => p.id === payload.permitId)
    const step = permit?.steps.find((s) => s.id === payload.stepId)
    if (!permit || !step) return
    step.done = payload.done
    if (payload.evidence) step.evidence = payload.evidence
    step.revision += 1
    step.updatedBy = payload.source
    step.updatedAt = nowTime()
    step.confirmations.push({ source: payload.source, at: nowTime(), note: payload.evidence })
    permit.revision += 1
    addAudit('现场确认', `${permit.id} / ${step.id}`, `${step.text}（${payload.source.crew}·${payload.source.actor} 于 ${nowTime()}）`, payload.source)
    persist()
  }

  // ───────────────────────── 连接 ─────────────────────────

  function setConnection(state: ConnectionState) {
    connection.value = state
    if (state === '在线') retryOutbox()
  }
  function markOffline() { setConnection('离线') }
  function markOnline() { setConnection('在线') }

  // ───────────────────────── 现有流程动作（保留兼容） ─────────────────────────

  function advancePermit(id: string) {
    const permit = permits.value.find((item) => item.id === id)
    if (!permit) return
    const flow: Record<string, Permit['status']> = { 待复核: '待执行', 待执行: '执行中', 执行中: '待结束', 待结束: '待关闭', 待关闭: '已完成' }
    const next = flow[permit.status]
    if (!next) return
    if (permit.status === '待复核' && permit.reviewRequired && !confirm('该许可存在待复核冲突，确认由值班负责人承担审批责任？')) return
    const prev = permit.status
    permit.status = next
    permit.reviewRequired = false
    permit.revision += 1
    addAudit('流程推进', permit.id, `状态由「${prev}」变更为「${next}」（r${permit.revision}）`)
    persist()
  }
  function toggleStep(permitId: string, stepId: string) {
    const permit = permits.value.find((item) => item.id === permitId)
    const step = permit?.steps.find((item) => item.id === stepId)
    if (!permit || !step) return
    submitStep(permitId, stepId, { done: !step.done })
  }
  function addPermit(permit: Permit) {
    permits.value.unshift(permit)
    addAudit('新建许可', permit.id, permit.title)
  }
  function acceptAlert() {
    latestAlert.value = ''
    addAudit('值班负责人', '确认冲突', '跨班组重叠', '同意调整 LINE-A2 作业时间，不允许同时开工')
  }
  function retryPending() { retryOutbox() }

  restore()
  return {
    permits, audit, connection, outbox, appliedOpIds, currentSource, latestAlert, loaded,
    pendingCount, conflictCount,
    addAudit, passReview, invalidateForPoint,
    submitStep, submitPoint, retryOutbox, resolveConflict, applyRemoteStepConfirm,
    setConnection, markOffline, markOnline,
    advancePermit, toggleStep, addPermit, acceptAlert, retryPending, restore,
  }
})
