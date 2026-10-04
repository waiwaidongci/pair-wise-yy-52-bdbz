<script setup lang="ts">
import { useOperationsStore } from '~/stores/operations'
import type { Permit, PermitStep, PointType } from '~/types'

const store = useOperationsStore()
const route = useRoute()
const toast = useToast()
const selectedId = ref(String(route.query.id || store.permits[0]?.id))
const modal = ref(route.query.new === '1')
const form = reactive({ title: '', device: '', crew: '电气一班', owner: '孙禾', window: '09-30 08:00 — 12:00', risk: '二级' as Permit['risk'] })

const selected = computed(() => store.permits.find((item) => item.id === selectedId.value) ?? store.permits[0])
const steps = computed<PermitStep[]>(() => selected.value?.steps ?? [])
const completed = computed(() => selected.value ? Math.round(steps.value.filter((step) => step.done).length / steps.value.length * 100) : 0)
const statusIndex = computed(() => ['待复核', '待执行', '执行中', '待结束', '待关闭', '已完成'].indexOf(selected.value?.status ?? ''))
const isDuty = computed(() => store.actors.find((a) => a.name === store.actorName)?.role === '值班负责人')
const permitConflicts = computed(() => store.conflicts.filter((item) => item.permitId === selected.value?.id))
const permitQueue = computed(() => store.queue.filter((item) => item.permitId === selected.value?.id))
const permitPoints = computed(() => selected.value ? store.points.filter((point) => selected.value!.pointIds.includes(point.id)) : [])

function notify(result: { ok: boolean; error?: string } | undefined, okText = '操作已执行') {
  if (!result) return
  if (!result.ok) toast.add({ title: '操作未执行', description: result.error, color: 'red', timeout: 4000 })
  else toast.add({ title: okText, color: 'green' })
}

function reconfirm() {
  const result = store.reconfirmReview(selected.value.id)
  notify(result, '复核已基于最新隔离点修订重算通过')
}

function createPermit() {
  if (!form.title.trim() || !form.device.trim()) return
  const ts = Date.now()
  const id = `WP-${new Date(ts).toISOString().slice(2, 10).replaceAll('-', '')}-${String(store.permits.length + 31).padStart(3, '0')}`
  const pointId = `IP-${String(ts).slice(-5)}`
  store.points.push({
    id: pointId, device: form.device, label: '主隔离点', type: '开关' as PointType,
    state: '待操作', revision: 1, updatedAt: new Date(ts).toLocaleString('zh-CN'), updatedBy: form.owner, source: store.actors.find((a) => a.name === store.actorName)?.source ?? 'WEB-值班台',
  })
  const permit: Permit = {
    id, ...form, status: '待复核', revision: 1,
    updatedAt: new Date(ts).toLocaleString('zh-CN'), updatedBy: form.owner,
    pointIds: [pointId],
    review: { valid: false, result: '待复核', reason: '新建许可，隔离尚未执行，等待值班负责人复核', basis: [`${pointId}@1`] },
    steps: [
      { id: 'ST-31', text: '核对设备双重编号与工作范围', done: false, owner: form.owner },
      { id: 'ST-32', text: '完成隔离、锁定、验电和接地', done: false, owner: form.owner },
    ],
  }
  store.addPermit(permit)
  selectedId.value = id
  modal.value = false
}
</script>

<template>
  <div class="page">
    <div class="head">
      <div><p class="eyebrow">许可全生命周期</p><h1 class="page-title">作业许可证</h1><p class="muted">隔离点状态变化会让复核结果立即失效；步骤确认记录操作人、时间、来源与修订号，断线期间照常确认，恢复后补传。</p></div>
      <UButton icon="i-heroicons-plus" color="primary" @click="modal = true">新建许可</UButton>
    </div>
    <div class="permit-layout">
      <aside class="panel permit-list">
        <button v-for="permit in store.permits" :key="permit.id" :class="{ active: permit.id === selectedId }" @click="selectedId = permit.id">
          <span><b>{{ permit.id }}</b><small>{{ permit.title }} · r{{ permit.revision }}</small></span>
          <UBadge :color="permit.review.valid ? (permit.status === '执行中' ? 'green' : 'amber') : 'red'" variant="subtle">
            {{ permit.review.valid ? permit.status : '复核失效' }}
          </UBadge>
        </button>
      </aside>
      <section v-if="selected" class="grid detail-grid">
        <article class="panel p-4">
          <div class="detail-head">
            <div><small class="muted">{{ selected.id }} · 修订 r{{ selected.revision }} · 最近更新 {{ selected.updatedBy }} {{ selected.updatedAt }}</small><h2>{{ selected.title }}</h2><p>{{ selected.device }} · {{ selected.window }}</p></div>
            <UBadge size="lg" :color="selected.review.valid ? 'green' : 'red'" variant="subtle">{{ selected.review.valid ? selected.status : selected.review.result }}</UBadge>
          </div>
          <div class="flow">
            <div v-for="(stepName, index) in ['申请', '复核', '执行', '结束', '关闭']" :key="stepName" :class="{ done: index <= statusIndex, blocked: index === 1 && !selected.review.valid }">
              <i>{{ index + 1 }}</i><span>{{ stepName }}</span>
            </div>
          </div>

          <UAlert
            v-if="!selected.review.valid" color="red" variant="soft" icon="i-heroicons-exclamation-triangle" class="mb-3"
            title="复核结果已失效，必须重算"
            :description="selected.review.reason"
            :actions="isDuty
              ? [{ label: '值班负责人重新复核', icon: 'i-heroicons-shield-check', click: reconfirm }]
              : [{ label: '仅值班负责人可复核', disabled: true, click: () => {} }]"
          />
          <UAlert
            v-else color="green" variant="soft" icon="i-heroicons-shield-check" class="mb-3"
            :title="`复核有效：${selected.review.reviewer} · ${selected.review.reviewedAt}`"
            :description="`复核依据 ${selected.review.basis.join('、')}（隔离点修订号快照）`"
          />

          <div v-if="permitConflicts.length" class="conflict-block">
            <h3 class="danger">合并差异（别人改过，不能覆盖）</h3>
            <div v-for="conflict in permitConflicts" :key="conflict.id" class="conflict">
              <b>{{ conflict.label }}</b>
              <div class="diff">
                <div class="diff-local"><small>我的 · {{ conflict.local.actor }} · {{ conflict.local.source }} · {{ conflict.local.at }} · 基于 r{{ conflict.local.baseRevision }}</small><span>{{ conflict.local.value }}</span></div>
                <div class="diff-remote"><small>对方 · {{ conflict.remote.actor }} · {{ conflict.remote.source }} · {{ conflict.remote.at }} · r{{ conflict.remote.revision }}</small><span>{{ conflict.remote.value }}</span></div>
              </div>
              <div class="inline">
                <UButton size="xs" color="primary" variant="soft" icon="i-heroicons-arrow-path" @click="notify(store.rebaseConflict(conflict.id), '已看过差异并基于最新修订重做')">基于最新修订重做</UButton>
                <UButton size="xs" color="gray" variant="ghost" @click="store.discardConflict(conflict.id)">保留对方记录</UButton>
              </div>
            </div>
          </div>

          <h3>操作步骤（现场确认留痕）</h3>
          <div v-for="step in steps" :key="step.id" class="step">
            <UCheckbox :model-value="step.done" @update:model-value="notify(store.toggleStep(selected.id, step.id), '现场确认已记录')" />
            <div class="step-main">
              <b :class="{ completed: step.done }">{{ step.text }}</b>
              <small>责任人 {{ step.owner }}</small>
              <small v-if="step.done" class="confirm-meta">
                <UIcon name="i-heroicons-check-badge" />
                {{ step.confirmedBy }} 于 {{ step.confirmedAt }} 经 {{ step.source }} 确认 · r{{ step.revision ?? selected.revision }}
              </small>
              <small v-else class="muted">尚未确认</small>
              <small v-if="step.evidence">证据：{{ step.evidence }}</small>
            </div>
            <UButton size="xs" variant="ghost" icon="i-heroicons-camera" @click="notify(store.uploadEvidence(selected.id, step.id), '证据已上传')">证据</UButton>
            <UButton size="xs" variant="ghost" color="gray" icon="i-heroicons-user-plus" @click="notify(store.peerEditStep(selected.id, step.id), '已模拟对端确认')">模拟对端确认</UButton>
          </div>
          <UProgress :value="completed" class="mt-4" />
          <div class="inline justify-between mt-1"><span class="muted">步骤完成度</span><b>{{ completed }}%</b></div>

          <div v-if="permitQueue.length" class="queue-block">
            <h3>待补传确认 <UBadge color="amber" variant="subtle">{{ permitQueue.length }}</UBadge></h3>
            <div v-for="op in permitQueue" :key="op.clientId" class="queue-item">
              <div>
                <b>{{ op.stepId }} · {{ op.payload.done ? '确认完成' : '撤销' }}</b>
                <small>{{ op.actor }} · {{ op.source }} · {{ op.createdAt }} · 基于 r{{ op.baseRevision }} · 尝试 {{ op.attempts }} 次</small>
                <small class="mono">{{ op.clientId }}</small>
                <small v-if="op.lastError" class="danger">{{ op.lastError }}</small>
              </div>
              <UButton size="xs" :color="op.status === '冲突' ? 'red' : 'amber'" variant="soft" :disabled="store.connection === '离线'" @click="notify(store.retryOp(op.clientId), '重试成功，审计已留痕')">重试</UButton>
            </div>
          </div>
        </article>

        <aside class="grid right">
          <article class="panel p-4">
            <h3>隔离点与锁定</h3>
            <div v-for="point in permitPoints" :key="point.id" class="point">
              <span><b>{{ point.label }}</b><small>{{ point.device }} · {{ point.type }} · {{ point.id }}</small><small>r{{ point.revision }} · {{ point.updatedBy }} {{ point.updatedAt }} · {{ point.source }}</small></span>
              <UBadge :color="point.state === '已隔离' ? 'green' : point.state === '已恢复' ? 'gray' : 'amber'" variant="subtle">{{ point.state }}</UBadge>
            </div>
            <p class="muted small mt-2">隔离点在「隔离与锁定」页操作，状态一变本许可复核立即失效。</p>
          </article>
          <article class="panel p-4">
            <h3>流程操作</h3>
            <p class="muted small">推进前系统重新检查隔离点修订号与复核有效性；网络中断或复核失效时一律挂起，旧页面无法强行点完。</p>
            <UButton block color="primary" icon="i-heroicons-arrow-right-circle" @click="notify(store.advancePermit(selected.id), '流程已推进，修订号已递增')">推进到下一状态</UButton>
            <UButton block class="mt-2" color="gray" variant="outline" icon="i-heroicons-arrow-uturn-left">退回补件</UButton>
            <UButton block class="mt-2" color="red" variant="soft" icon="i-heroicons-exclamation-triangle">申请紧急暂停</UButton>
            <div class="offline-hint mt-3">
              <UBadge :color="store.connection === '在线' ? 'green' : 'red'" variant="subtle">{{ store.connection }}</UBadge>
              <small class="muted">{{ store.connection === '在线' ? '操作实时落库' : `步骤可离线确认，${store.pendingCount} 条排队等待补传` }}</small>
            </div>
          </article>
        </aside>
      </section>
    </div>
    <UModal v-model="modal">
      <article class="p-5">
        <h2>申请作业许可</h2>
        <p class="muted">提交后进入安全复核；隔离点为全局共享资源，冲突在状态变化时自动触发复核失效。</p>
        <div class="form-grid">
          <UFormGroup label="作业名称"><UInput v-model="form.title" /></UFormGroup>
          <UFormGroup label="设备编号"><UInput v-model="form.device" /></UFormGroup>
          <UFormGroup label="班组"><UInput v-model="form.crew" /></UFormGroup>
          <UFormGroup label="负责人"><UInput v-model="form.owner" /></UFormGroup>
          <UFormGroup label="计划窗口"><UInput v-model="form.window" /></UFormGroup>
          <UFormGroup label="风险等级"><USelect v-model="form.risk" :options="['一级', '二级', '三级']" /></UFormGroup>
        </div>
        <div class="inline justify-end mt-4"><UButton color="gray" @click="modal = false">取消</UButton><UButton color="primary" :disabled="!form.title || !form.device" @click="createPermit">提交复核</UButton></div>
      </article>
    </UModal>
  </div>
</template>

<style scoped>
.head{display:flex;justify-content:space-between;gap:16px;margin-bottom:18px}.head h1{margin:3px 0 7px}.head p{margin:0;max-width:820px}.eyebrow{font-size:12px;color:#2563eb;font-weight:700}
.permit-layout{display:grid;grid-template-columns:300px minmax(0,1fr);gap:16px}.permit-list{padding:8px;height:fit-content}.permit-list button{width:100%;display:flex;justify-content:space-between;align-items:center;gap:8px;padding:13px 11px;border:0;background:transparent;border-radius:7px;text-align:left;color:inherit;cursor:pointer}.permit-list button:hover,.permit-list button.active{background:#eff6ff}.permit-list b,.permit-list small{display:block}.permit-list small{color:#667085;margin-top:4px;font-size:12px}
.detail-grid{grid-template-columns:minmax(0,1.5fr) minmax(300px,.65fr);gap:16px}.right{height:fit-content;gap:14px}.detail-head{display:flex;justify-content:space-between;gap:10px;margin-bottom:16px}.detail-head h2{margin:4px 0}.detail-head p{margin:0;color:#667085}
.flow{display:grid;grid-template-columns:repeat(5,1fr);margin:20px 0}.flow>div{position:relative;text-align:center;color:#94a3b8}.flow>div:after{content:"";position:absolute;left:55%;right:-45%;top:13px;height:2px;background:#e2e8f0}.flow>div:last-child:after{display:none}.flow i{position:relative;z-index:1;display:grid;place-items:center;width:28px;height:28px;margin:auto;border-radius:50%;background:#e2e8f0;font-style:normal;font-size:12px}.flow span{display:block;font-size:12px;margin-top:5px}.flow .done{color:#2563eb}.flow .done i{background:#2563eb;color:#fff}.flow .done:after{background:#2563eb}.flow .blocked i{background:#dc2626;color:#fff}
.panel h3{font-size:15px;margin:18px 0 10px}
.step{display:flex;align-items:flex-start;gap:10px;padding:12px 0;border-bottom:1px solid #edf0f5}.step-main{flex:1}.step small{display:block;color:#667085;margin-top:4px}.step .completed{text-decoration:line-through;color:#667085}.confirm-meta{color:#15803d;display:flex;align-items:center;gap:5px}
.point{display:flex;justify-content:space-between;gap:8px;padding:11px 0;border-bottom:1px solid #edf0f5}.point b,.point small{display:block}.point small{color:#667085;margin-top:4px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:18px 0}.mt-2{margin-top:8px}.mt-3{margin-top:12px}.small{font-size:12px}
.conflict-block{margin-top:14px}.conflict{border:1px solid #fecaca;border-radius:8px;padding:10px;margin-bottom:10px;background:#fef2f2}.conflict>b{font-size:13px}.diff{display:grid;gap:6px;margin:8px 0}.diff small{display:block;color:#667085}.diff span{font-size:13px}.diff-local{border-left:3px solid #f59e0b;padding:4px 8px;background:#fffbeb;border-radius:0 6px 6px 0}.diff-remote{border-left:3px solid #2563eb;padding:4px 8px;background:#eff6ff;border-radius:0 6px 6px 0}
.queue-block{margin-top:18px}.queue-item{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid #edf0f5}.queue-item small{display:block;color:#667085;font-size:12px;margin-top:2px}.mono{font-family:monospace;font-size:11px}.offline-hint{display:flex;flex-direction:column;gap:6px}
@media(max-width:980px){.permit-layout{grid-template-columns:1fr}.permit-list{display:flex;overflow:auto}.permit-list button{min-width:230px}.detail-grid{grid-template-columns:1fr}}@media(max-width:620px){.head{flex-direction:column}.form-grid{grid-template-columns:1fr}}
</style>
