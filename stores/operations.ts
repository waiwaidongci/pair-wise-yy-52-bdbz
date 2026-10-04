import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  AuditEvent, ConnectionState, IsolationPoint, MergeConflict,
  PendingOp, Permit, PermitStatus, PointState, ReviewState,
} from '~/types'
import { auditEvents as seedAudit, isolationPoints as seedPoints, permits as seedPermits } from '~/utils/mock'

const STORAGE_KEY = 'yy52-permit-ops-v3'

export interface Actor { name: string; role: string; source: string }

/** 值班台与现场终端：切换“当前操作人”模拟两组值班员同时作业 */
export const actors: Actor[] = [
  { name: '赵清', role: '值班负责人', source: 'WEB-值班台' },
  { name: '李骁', role: '值班负责人', source: 'WEB-值班台' },
  { name: '何岚', role: '线路一班', source: 'PAD-01' },
  { name: '周野', role: '机务二班', source: 'PAD-02' },
  { name: '谭勇', role: '线路一班', source: 'PAD-03' },
  { name: '孙禾', role: '电气一班', source: 'PAD-05' },
]

const PEER: Actor = { name: '谭勇', role: '线路一班', source: 'PAD-08' }
const DUTY_ROLE = '值班负责人'

const STATUS_FLOW: Record<PermitStatus, PermitStatus | undefined> = {
  待复核: '待执行', 待执行: '执行中', 执行中: '待结束', 待结束: '待关闭', 待关闭: '已完成', 已完成: undefined,
}
const POINT_NEXT: Record<PointState, PointState[]> = {
  待操作: ['已隔离'], 已隔离: ['已恢复'], 已恢复: ['已隔离'],
}

let seq = 100
const nextId = (prefix: string) => `${prefix}-${String(++seq).padStart(5, '0')}`

function nowTs() { return Date.now() }
function fmt(ts: number) {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
function clone<T>(value: T): T {
  // 不用 structuredClone：Pinia/Vue 响应式代理在浏览器与 Node 中都会触发 DataCloneError
  return JSON.parse(JSON.stringify(value))
}

interface World {
  points: IsolationPoint[]
  permits: Permit[]
  audit: AuditEvent[]
  seen: Set<string>
}

interface OpResult { ok: boolean; error?: string; conflict?: Omit<MergeConflict, 'id' | 'detectedAt'> }

function pushAudit(world: World, event: Omit<AuditEvent, 'id' | 'ts' | 'time'> & { ts?: number }) {
  const ts = event.ts ?? nowTs()
  world.audit.unshift({ id: nextId('AE'), ts, time: fmt(ts), ...event })
}

function pointBasis(world: World, permit: Permit) {
  return permit.pointIds.map((id) => {
    const point = world.points.find((item) => item.id === id)
    return point ? `${id}@${point.revision}` : `${id}@缺失`
  })
}

/**
 * 隔离点一变化，引用该点的许可复核立即失效：
 * 比对复核时留存的隔离点快照（IP-xxx@修订号）与当前修订号。
 */
function invalidateStaleReviews(world: World, changedPointIds: string[]) {
  const changed = new Set(changedPointIds)
  for (const permit of world.permits) {
    if (!permit.pointIds.some((id) => changed.has(id))) continue
    const current = pointBasis(world, permit)
    if (permit.review.valid && current.some((token, i) => token !== permit.review.basis[i])) {
      const stale = permit.review.basis.filter((token, i) => token !== current[i])
      permit.review = {
        ...permit.review,
        valid: false,
        result: '失效待重算',
        reason: `隔离点 ${stale.join('、')} 状态已变化，原复核依据失效，必须重新复核`,
        lastReviewer: permit.review.reviewer ?? permit.review.lastReviewer,
        lastReviewedAt: permit.review.reviewedAt ?? permit.review.lastReviewedAt,
      }
    }
  }
}

function applyPointOp(world: World, op: PendingOp): OpResult {
  const point = world.points.find((item) => item.id === op.pointId)
  if (!point) return { ok: false, error: `隔离点 ${op.pointId} 不存在` }
  const to = op.payload.to as PointState
  if (op.baseRevision !== point.revision) {
    return {
      ok: false,
      conflict: {
        clientId: op.clientId, type: 'point-op', pointId: point.id,
        label: `${point.device} · ${point.label}`,
        local: { actor: op.actor, at: op.createdAt, source: op.source, baseRevision: op.baseRevision, value: `${point.state} → ${to}（基于 r${op.baseRevision}）` },
        remote: { actor: point.updatedBy, at: point.updatedAt, source: point.source, revision: point.revision, value: `当前为「${point.state}」 r${point.revision}` },
      },
    }
  }
  if (!POINT_NEXT[point.state].includes(to)) return { ok: false, error: `隔离点当前为「${point.state}」，不能变更为「${to}」` }
  const from = point.state
  point.state = to
  point.revision += 1
  point.updatedAt = String(op.payload.at ?? fmt(nowTs()))
  point.updatedBy = op.actor
  point.source = op.source
  for (const permit of world.permits.filter((item) => item.pointIds.includes(point.id))) {
    permit.revision += 1
    permit.updatedAt = point.updatedAt
    permit.updatedBy = op.actor
  }
  pushAudit(world, {
    actor: op.actor, action: '隔离点操作', target: `${point.device} / ${point.id}`, kind: 'point',
    detail: `${point.label}：「${from}」→「${to}」（r${op.baseRevision} → r${point.revision}）${op.payload.replayed ? '，网络恢复后补传' : ''}`,
    source: op.source, clientId: op.clientId, revision: point.revision, ts: op.payload.ts as number | undefined,
  })
  invalidateStaleReviews(world, [point.id])
  for (const permit of world.permits.filter((item) => item.pointIds.includes(point.id) && !item.review.valid)) {
    pushAudit(world, {
      actor: '系统', action: '复核自动失效', target: permit.id, kind: 'review',
      detail: `隔离点 ${point.id} 修订号变化，${permit.review.lastReviewer ?? '原复核人'} ${permit.review.lastReviewedAt ?? ''} 的复核结果立即失效，需重算`,
      source: '系统', clientId: `${op.clientId}:invalidate:${permit.id}`,
    })
  }
  return { ok: true }
}

function applyStepOp(world: World, op: PendingOp): OpResult {
  const permit = world.permits.find((item) => item.id === op.permitId)
  const step = permit?.steps.find((item) => item.id === op.stepId)
  if (!permit || !step) return { ok: false, error: `步骤 ${op.permitId}/${op.stepId} 不存在` }
  const evidenceOnly = op.payload.evidence !== undefined && op.payload.done === undefined
  if (!evidenceOnly) {
    const done = Boolean(op.payload.done)
    if (op.baseRevision !== permit.revision && step.done !== done) {
      return {
        ok: false,
        conflict: {
          clientId: op.clientId, type: 'step-confirm', permitId: permit.id, stepId: step.id,
          label: `${permit.id} · ${step.text}`,
          local: { actor: op.actor, at: op.createdAt, source: op.source, baseRevision: op.baseRevision, value: done ? '现场确认完成' : '撤销确认' },
          remote: { actor: step.confirmedBy ?? permit.updatedBy, at: step.confirmedAt ?? permit.updatedAt, source: step.source ?? permit.updatedBy, revision: permit.revision, value: step.done ? `已由 ${step.confirmedBy} 确认完成（r${permit.revision}）` : `已被撤销（r${permit.revision}）` },
        },
      }
    }
    const changed = step.done !== done
    if (changed) {
      step.done = done
      step.confirmedBy = done ? op.actor : undefined
      step.confirmedAt = done ? String(op.payload.at) : undefined
      step.source = done ? op.source : undefined
      step.revision = done ? permit.revision + 1 : step.revision
      permit.revision += 1
      permit.updatedAt = String(op.payload.at ?? fmt(nowTs()))
      permit.updatedBy = op.actor
    }
    if (!changed && !op.payload.evidence) {
      // 别人已基于更新的修订完成了同一步骤：幂等成功，不覆盖对方记录
      return { ok: true }
    }
  }
  if (op.payload.evidence) {
    // 证据补传合到最新步骤上，不改对方的确认人与确认状态
    const note = String(op.payload.evidence)
    step.evidence = step.evidence && !step.evidence.includes(note) ? `${step.evidence}；${note}` : (step.evidence ?? note)
    permit.revision += 1
  }
  pushAudit(world, {
    actor: op.actor,
    action: op.payload.evidence && !evidenceOnly ? '确认并补传证据' : evidenceOnly ? '补传证据' : step.done ? '现场确认步骤' : '撤销步骤确认',
    target: `${permit.id} / ${step.id}`, kind: 'step',
    detail: `${step.text}${op.payload.evidence ? `：${op.payload.evidence}` : evidenceOnly ? '' : step.done ? ' 已确认' : ' 确认已撤销'}（r${op.baseRevision} → r${permit.revision}）${op.payload.replayed ? '，网络恢复后补传' : ''}`,
    source: op.source, clientId: op.clientId, revision: permit.revision, ts: op.payload.ts as number | undefined,
  })
  return { ok: true }
}

function applyOp(world: World, op: PendingOp): OpResult {
  if (world.seen.has(op.clientId)) return { ok: true, error: 'duplicate' }
  const result = op.type === 'point-op' ? applyPointOp(world, op) : applyStepOp(world, op)
  if (result.ok) world.seen.add(op.clientId)
  return result
}

export const useOperationsStore = defineStore('operations', () => {
  const points = ref<IsolationPoint[]>(clone(seedPoints))
  const permits = ref<Permit[]>(clone(seedPermits))
  const audit = ref<AuditEvent[]>(clone(seedAudit))
  const actorName = ref(actors[2]!.name)
  const connection = ref<ConnectionState>('在线')
  const queue = ref<PendingOp[]>([])
  const conflicts = ref<MergeConflict[]>([])
  const seen = ref<Set<string>>(new Set())
  const latestAlert = ref('18:00–20:00 LINE-A2 存在跨班组重叠作业；IP-413 已由其他班组操作，WP-260929-021 复核已失效')
  const loaded = ref(false)

  /** 断网期间的“服务器影子状态”：对端修改只进影子，恢复时作为合并基线 */
  const shadow = ref<World | null>(null)
  const optimisticKeys = ref<string[]>([])
  const notice = ref('')

  const actor = computed(() => actors.find((item) => item.name === actorName.value) ?? actors[0]!)
  const pendingCount = computed(() => queue.value.filter((item) => item.status !== '同步中').length)
  const conflictCount = computed(() => conflicts.value.length)

  function persist() {
    if (!import.meta.client) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      actor: actorName.value, points: points.value, permits: permits.value, audit: audit.value,
      queue: queue.value, conflicts: conflicts.value, seen: [...seen.value], optimisticKeys: optimisticKeys.value,
    }))
  }
  function restore() {
    if (!import.meta.client || loaded.value) return
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      try {
        const draft = JSON.parse(raw)
        if (draft?.points && draft?.permits && draft?.audit) {
          actorName.value = draft.actor ?? actorName.value
          points.value = draft.points
          permits.value = draft.permits
          audit.value = draft.audit
          queue.value = draft.queue ?? []
          conflicts.value = draft.conflicts ?? []
          seen.value = new Set(draft.seen ?? [])
          optimisticKeys.value = draft.optimisticKeys ?? []
          if (queue.value.length) connection.value = '重连中'
        }
      } catch { /* 版本不兼容时回落种子数据 */ }
    }
    loaded.value = true
  }

  function addAuditLocal(event: { actor: string; action: string; target: string; detail: string; source?: string; clientId?: string; kind?: AuditEvent['kind']; revision?: number }) {
    pushAudit(localWorld(), { source: actor.value.source, clientId: event.clientId ?? `local-${nextId('X')}`, ...event })
    persist()
  }
  function localWorld(): World {
    return { points: points.value, permits: permits.value, audit: audit.value, seen: seen.value }
  }

  // ---------- 操作派发：在线直发服务器，离线进队列并本地乐观执行 ----------

  function buildOp(type: PendingOp['type'], args: { permitId?: string; pointId?: string; stepId?: string; payload: Record<string, unknown>; baseRevision: number; clientId?: string; at?: string; who?: Actor }): PendingOp {
    const who = args.who ?? actor.value
    const ts = nowTs()
    return {
      clientId: args.clientId ?? `op-${ts}-${Math.random().toString(36).slice(2, 7)}`,
      type, permitId: args.permitId, pointId: args.pointId, stepId: args.stepId,
      payload: { ...args.payload, at: args.at ?? fmt(ts), ts },
      baseRevision: args.baseRevision, actor: who.name, source: who.source,
      createdAt: fmt(ts), attempts: 0, status: '待发送',
    }
  }

  function dispatch(op: PendingOp): { ok: boolean; error?: string } {
    if (seen.value.has(op.clientId)) return { ok: false, error: '该操作已补传过，按幂等键只保留一次' }
    if (connection.value !== '离线') {
      const result = applyOp(localWorld(), op)
      if (result.conflict) {
        registerConflict(result.conflict)
        return { ok: false, error: '修订号已变化，对方先行修改，已保留对方记录' }
      }
      if (!result.ok) return { ok: false, error: result.error }
      latestAlert.value = `${op.actor} 的操作已同步（修订号 r${op.type === 'point-op' ? points.value.find((p) => p.id === op.pointId)?.revision : permits.value.find((p) => p.id === op.permitId)?.revision}）`
      persist()
      return { ok: true }
    }
    // 离线/重连挂起：乐观执行 + 进入待处理队列
    op.status = '待发送'
    const affectedPermitIds = op.type === 'point-op'
      ? permits.value.filter((item) => item.pointIds.includes(op.pointId!)).map((item) => item.id)
      : op.permitId ? [op.permitId] : []
    const optimistic = applyOp(localWorld(), { ...op, payload: { ...op.payload } })
    if (optimistic.conflict || !optimistic.ok) {
      // 本地乐观校验不过（非法状态跳转）直接拒绝，不入队
      return { ok: false, error: optimistic.error ?? '本地操作校验失败' }
    }
    queue.value.unshift(op)
    optimisticKeys.value.push(op.clientId, ...affectedPermitIds.map((id) => `${op.clientId}:invalidate:${id}`))
    persist()
    return { ok: true }
  }

  function registerConflict(conflict: Omit<MergeConflict, 'id' | 'detectedAt'>) {
    if (conflicts.value.some((item) => item.clientId === conflict.clientId)) return
    conflicts.value.unshift({ ...conflict, id: nextId('CF'), detectedAt: fmt(nowTs()) })
    const op = queue.value.find((item) => item.clientId === conflict.clientId)
    if (op) op.status = '冲突'
  }

  // ---------- 对外动作 ----------

  function toggleStep(permitId: string, stepId: string) {
    const permit = permits.value.find((item) => item.id === permitId)
    const step = permit?.steps.find((item) => item.id === stepId)
    if (!permit || !step) return { ok: false, error: '步骤不存在' }
    const op = buildOp('step-confirm', { permitId, stepId, baseRevision: permit.revision, payload: { done: !step.done } })
    return dispatch(op)
  }

  function uploadEvidence(permitId: string, stepId: string) {
    const permit = permits.value.find((item) => item.id === permitId)
    if (!permit) return { ok: false, error: '许可不存在' }
    const note = `补传现场照片 1 张（${actor.value.source}）`
    const op = buildOp('step-evidence', { permitId, stepId, baseRevision: permit.revision, payload: { evidence: note } })
    return dispatch(op)
  }

  function operatePoint(pointId: string, to: PointState) {
    const point = points.value.find((item) => item.id === pointId)
    if (!point) return { ok: false, error: '隔离点不存在' }
    if (!POINT_NEXT[point.state].includes(to)) return { ok: false, error: `「${point.state}」不允许直接变更为「${to}」` }
    const op = buildOp('point-op', { pointId, baseRevision: point.revision, payload: { to } })
    return dispatch(op)
  }

  function cyclePoint(pointId: string) {
    const point = points.value.find((item) => item.id === pointId)!
    const to = POINT_NEXT[point.state][0]!
    return operatePoint(pointId, to)
  }

  function reconfirmReview(permitId: string) {
    const permit = permits.value.find((item) => item.id === permitId)
    if (!permit) return { ok: false, error: '许可不存在' }
    if (actor.value.role !== DUTY_ROLE) return { ok: false, error: '只有值班负责人可以重新复核' }
    if (connection.value === '离线') return { ok: false, error: '网络中断中，复核签字需要在线进行，请等待网络恢复' }
    const basis = pointBasis(localWorld(), permit)
    const previous = permit.review
    permit.review = {
      valid: true, result: '通过', reason: '隔离点状态重新核对无误，复核重算通过',
      reviewer: actor.value.name, reviewedAt: fmt(nowTs()),
      lastReviewer: previous.lastReviewer ?? previous.reviewer, lastReviewedAt: previous.lastReviewedAt ?? previous.reviewedAt,
      basis, revision: permit.revision + 1,
    } as ReviewState
    permit.revision += 1
    permit.updatedAt = fmt(nowTs())
    permit.updatedBy = actor.value.name
    pushAudit(localWorld(), {
      actor: actor.value.name, action: '复核重算通过', target: permit.id, kind: 'review',
      detail: `原复核（${previous.lastReviewer ?? previous.reviewer ?? '—'} ${previous.lastReviewedAt ?? previous.reviewedAt ?? ''}）因隔离点变化失效后，依据 ${basis.join('、')} 重新复核通过`,
      source: actor.value.source, clientId: `review-${permit.id}-${permit.revision}`, revision: permit.revision,
    })
    persist()
    return { ok: true }
  }

  function advancePermit(id: string) {
    const permit = permits.value.find((item) => item.id === id)
    if (!permit) return { ok: false, error: '许可不存在' }
    if (connection.value === '离线') return { ok: false, error: '网络中断中，流程推进已挂起；现场确认可继续，恢复后补传' }
    if (!permit.review.valid) return { ok: false, error: '隔离点状态变化导致复核失效，必须先重新复核才能推进' }
    const next = STATUS_FLOW[permit.status]
    if (!next) return { ok: false, error: '该许可已关闭' }
    const from = permit.status
    permit.status = next
    permit.revision += 1
    permit.updatedAt = fmt(nowTs())
    permit.updatedBy = actor.value.name
    pushAudit(localWorld(), {
      actor: actor.value.name, action: '流程推进', target: permit.id, kind: 'system',
      detail: `状态由「${from}」变更为「${next}」（r${permit.revision - 1} → r${permit.revision}）`,
      source: actor.value.source, clientId: `advance-${id}-${permit.revision}`, revision: permit.revision,
    })
    persist()
    return { ok: true }
  }

  function addPermit(permit: Permit) {
    permits.value.unshift(permit)
    pushAudit(localWorld(), {
      actor: actor.value.name, action: '新建许可', target: permit.id, kind: 'system',
      detail: permit.title, source: actor.value.source, clientId: `create-${permit.id}`, revision: permit.revision,
    })
    persist()
  }

  function acceptAlert() {
    latestAlert.value = ''
    addAuditLocal({ actor: '值班负责人', action: '确认冲突', target: '跨班组重叠', detail: '同意调整 LINE-A2 作业时间，不允许同时开工', kind: 'system' })
  }

  // ---------- 断网 / 恢复 / 对端模拟 ----------

  function setOffline() {
    if (connection.value !== '在线') return
    connection.value = '离线'
    shadow.value = {
      points: clone(points.value), permits: clone(permits.value),
      audit: clone(audit.value), seen: new Set(seen.value),
    }
    addAuditLocal({ actor: '系统', action: '网络中断', target: '实时通道', detail: '现场确认转为离线记录，恢复后自动补传', source: '系统', clientId: `net-down-${nowTs()}`, kind: 'sync' })
  }

  /** 模拟“对端值班员”：在线时直接合并，离线时只落到服务器影子，等待恢复合并 */
  function peerEditPoint(pointId: string, to?: PointState) {
    const point = (shadow.value?.points ?? points.value).find((item) => item.id === pointId)
    if (!point) return { ok: false, error: '隔离点不存在' }
    const target = to ?? POINT_NEXT[point.state][0]!
    const op = buildOp('point-op', { pointId, baseRevision: point.revision, payload: { to: target }, who: PEER })
    const world = shadow.value ?? localWorld()
    const result = applyOp(world, op)
    if (result.conflict || !result.ok) return { ok: false, error: result.error ?? '对端操作冲突' }
    if (shadow.value) {
      notice.value = `对端 ${PEER.name} 在服务器端操作了 ${point.label}，恢复后显示差异`
    } else {
      latestAlert.value = `对端 ${PEER.name} 刚操作了 ${point.label}（r${point.revision + 1}），相关许可复核已联动重算`
      persist()
    }
    return { ok: true }
  }

  function peerEditStep(permitId: string, stepId: string, done = true) {
    const permit = (shadow.value?.permits ?? permits.value).find((item) => item.id === permitId)
    const step = permit?.steps.find((item) => item.id === stepId)
    if (!permit || !step) return { ok: false, error: '步骤不存在' }
    const op = buildOp('step-confirm', { permitId, stepId, baseRevision: permit.revision, payload: { done }, who: PEER })
    const world = shadow.value ?? localWorld()
    const result = applyOp(world, op)
    if (result.conflict || !result.ok) return { ok: false, error: result.error ?? '对端操作冲突' }
    if (shadow.value) {
      notice.value = `对端 ${PEER.name} 在服务器端确认了 ${permit.id} 的步骤，恢复后显示差异`
    } else {
      latestAlert.value = `对端 ${PEER.name} 刚确认了 ${permit.id} 的步骤（r${permit.revision}）`
      persist()
    }
    return { ok: true }
  }

  /**
   * 网络恢复：把队列逐条合并进服务器影子。
   * - 同一 clientId 只落一次（重复补传去重）
   * - 修订号不匹配 → 冲突，服务器记录优先，本地乐观改动回滚，差异挂出待处理
   * - 合不上的（非法跳转等）保留为待处理项，可继续重试
   */
  function setOnline() {
    if (!shadow.value || connection.value === '在线') return
    connection.value = '重连中'
    const server = shadow.value
    let applied = 0, deduped = 0, failed = 0
    const remaining: PendingOp[] = []

    // 先去掉本地乐观审计（含联动失效审计），改用服务器影子的权威记录
    const optimistic = new Set(optimisticKeys.value)
    audit.value = audit.value.filter((event) => !optimistic.has(event.clientId))

    for (const op of queue.value) {
      op.attempts += 1
      if (server.seen.has(op.clientId)) { deduped += 1; continue }
      const replay = { ...op, payload: { ...op.payload, replayed: true } }
      const result = applyOp(server, replay)
      if (result.ok && result.error !== 'duplicate') {
        applied += 1
      } else if (result.error === 'duplicate') {
        deduped += 1
      } else if (result.conflict) {
        failed += 1
        op.status = '冲突'
        op.lastError = '修订号与服务器不一致'
        registerConflict(result.conflict)
        remaining.push(op)
      } else {
        failed += 1
        op.status = '失败'
        op.lastError = result.error
        remaining.push(op)
      }
    }

    // 合并对端审计与服务器侧联动审计（按 clientId 去重），按时间倒序
    const known = new Set(audit.value.map((event) => event.clientId))
    const peerEvents = server.audit.filter((event) => !known.has(event.clientId))
    for (const event of peerEvents) {
      audit.value.unshift(event)
      known.add(event.clientId)
    }
    audit.value.sort((a, b) => b.ts - a.ts)

    // 权威状态整体接管：冲突步骤/点自动回滚为服务器版本，绝不覆盖对方记录
    points.value = server.points
    permits.value = server.permits
    seen.value = new Set([...seen.value, ...server.seen])
    queue.value = remaining
    optimisticKeys.value = []

    pushAudit(localWorld(), {
      actor: '系统', action: '网络恢复合并', target: '实时通道', kind: 'sync',
      detail: `补传确认 ${applied} 条${deduped ? `，重复补传去重 ${deduped} 条` : ''}${failed ? `，${failed} 条挂为待处理/冲突` : ''}${peerEvents.length ? `，合并对端记录 ${peerEvents.length} 条` : ''}`,
      source: '系统', clientId: `net-up-${nowTs()}`,
    })
    connection.value = failed ? '重连中' : '在线'
    shadow.value = null
    notice.value = ''
    latestAlert.value = failed
      ? `网络已恢复：${applied} 条已补传，${failed} 条需要处理（修订冲突/失败）`
      : `网络已恢复：${applied} 条现场确认全部补传完成，审计已留痕`
    persist()
  }

  /** 单条重试：仍是同一 clientId，服务器若已收到则按幂等去重 */
  function retryOp(clientId: string) {
    const op = queue.value.find((item) => item.clientId === clientId)
    if (!op) return { ok: false, error: '待处理项不存在' }
    op.attempts += 1
    if (seen.value.has(clientId)) {
      queue.value = queue.value.filter((item) => item.clientId !== clientId)
      persist()
      return { ok: true }
    }
    if (connection.value === '离线') return { ok: false, error: '网络仍未恢复' }
    const result = applyOp(localWorld(), { ...op, payload: { ...op.payload, replayed: true } })
    if (result.conflict) {
      op.status = '冲突'
      registerConflict(result.conflict)
      persist()
      return { ok: false, error: '修订号已变化，对方先行修改，已挂出差异' }
    }
    if (!result.ok) {
      op.status = '失败'
      op.lastError = result.error
      persist()
      return { ok: false, error: result.error }
    }
    queue.value = queue.value.filter((item) => item.clientId !== clientId)
    addAuditLocal({
      actor: op.actor, action: '重试补传成功', target: op.pointId ?? `${op.permitId} / ${op.stepId ?? ''}`, kind: 'sync',
      detail: `第 ${op.attempts} 次尝试后补传成功，审计可查确认人、时间与来源 ${op.source}`, source: '系统', clientId: `retry-${clientId}`,
    })
    if (!queue.value.length) connection.value = '在线'
    persist()
    return { ok: true }
  }

  function discardConflict(conflictId: string) {
    const conflict = conflicts.value.find((item) => item.id === conflictId)
    if (!conflict) return
    queue.value = queue.value.filter((item) => item.clientId !== conflict.clientId)
    conflicts.value = conflicts.value.filter((item) => item.id !== conflictId)
    addAuditLocal({
      actor: actor.value.name, action: '放弃本地修改', target: conflict.label, kind: 'sync',
      detail: `查看差异后保留对方记录（${conflict.remote.actor} r${conflict.remote.revision}），本地操作作废`, source: actor.value.source, clientId: `discard-${conflict.clientId}`,
    })
    if (!queue.value.length && connection.value === '重连中') connection.value = '在线'
    persist()
  }

  /** 基于最新修订重做：这是看过差异之后的一次新操作，赋予新修订号与 clientId */
  function rebaseConflict(conflictId: string) {
    const conflict = conflicts.value.find((item) => item.id === conflictId)
    if (!conflict) return { ok: false, error: '冲突不存在' }
    if (conflict.type === 'step-confirm' && conflict.permitId && conflict.stepId) {
      const permit = permits.value.find((item) => item.id === conflict.permitId)!
      const result = toggleStep(conflict.permitId, conflict.stepId)
      if (result.ok) {
        addAuditLocal({
          actor: actor.value.name, action: '差异合并重做', target: conflict.label, kind: 'sync',
          detail: `对照 ${conflict.remote.actor} 的修订 r${conflict.remote.revision} 后，基于 r${permit.revision - 1} 重新确认`,
          source: actor.value.source, clientId: `rebase-${conflict.clientId}`,
        })
        conflicts.value = conflicts.value.filter((item) => item.id !== conflictId)
        queue.value = queue.value.filter((item) => item.clientId !== conflict.clientId)
        persist()
      }
      return result
    }
    if (conflict.type === 'point-op' && conflict.pointId) {
      const point = points.value.find((item) => item.id === conflict.pointId)!
      const to = POINT_NEXT[point.state][0]
      const result = operatePoint(conflict.pointId, to)
      if (result.ok) {
        addAuditLocal({
          actor: actor.value.name, action: '差异合并重做', target: conflict.label, kind: 'sync',
          detail: `对照 ${conflict.remote.actor} 的修订 r${conflict.remote.revision} 后，基于 r${point.revision - 1} 重新执行隔离操作`,
          source: actor.value.source, clientId: `rebase-${conflict.clientId}`, revision: point.revision,
        })
        conflicts.value = conflicts.value.filter((item) => item.id !== conflictId)
        queue.value = queue.value.filter((item) => item.clientId !== conflict.clientId)
        persist()
      }
      return result
    }
    return { ok: false, error: '该冲突类型不支持重做' }
  }

  const recovering = computed(() => connection.value === '离线')

  restore()
  return {
    // state
    points, permits, audit, actorName, actors, connection, recovering, queue, conflicts,
    pendingCount, conflictCount, latestAlert, notice,
    // actions
    toggleStep, uploadEvidence, operatePoint, cyclePoint, reconfirmReview, advancePermit,
    addPermit, acceptAlert, setOffline, setOnline, peerEditPoint, peerEditStep,
    retryOp, discardConflict, rebaseConflict, restore,
  }
})
