<script setup lang="ts">
import { useOperationsStore } from '~/stores/operations'
import { operators } from '~/utils/mock'
import type { Permit } from '~/types'

const store = useOperationsStore()
const route = useRoute()
const selectedId = ref(String(route.query.id || store.permits[0]?.id))
const modal = ref(route.query.new === '1')
const form = reactive({ title: '', device: '', crew: '电气一班', owner: '孙禾', window: '09-30 08:00 — 12:00', risk: '二级' as Permit['risk'] })
const selected = computed(() => store.permits.find((item) => item.id === selectedId.value) ?? store.permits[0])
const completed = computed(() => selected.value ? Math.round(selected.value.steps.filter((step) => step.done).length / selected.value.steps.length * 100) : 0)
const statusIndex = computed(() => ['待复核', '待执行', '执行中', '待结束', '待关闭', '已完成'].indexOf(selected.value?.status ?? ''))

const selectedConflicts = computed(() => store.outbox.filter((o) => o.status === 'conflict' && o.permitId === selected.value?.id))
const queuedStepIds = computed(() => new Set(store.outbox.filter((o) => o.status === 'queued' && o.kind === 'step').map((o) => o.stepId)))

function createPermit() {
  if (!form.title.trim() || !form.device.trim()) return
  const permit: Permit = {
    id: `WP-${new Date().toISOString().slice(2, 10).replaceAll('-', '')}-${String(store.permits.length + 31).padStart(3, '0')}`,
    ...form, status: '待复核', revision: 1, reviewRequired: false,
    isolationPoints: [{ id: `IP-${Date.now().toString().slice(-4)}`, device: form.device, label: '主隔离点', type: '开关', state: '待操作', revision: 1 }],
    steps: [
      { id: 'ST-31', text: '核对设备双重编号与工作范围', done: false, owner: form.owner, revision: 1, confirmations: [] },
      { id: 'ST-32', text: '完成隔离、锁定、验电和接地', done: false, owner: form.owner, revision: 1, confirmations: [] },
    ],
  }
  store.addPermit(permit)
  selectedId.value = permit.id
  modal.value = false
}

function simulateRemote(stepId: string) {
  const others = operators.filter((o) => o.terminal !== store.currentSource.terminal)
  const source = others[Math.floor(Math.random() * others.length)]!
  store.applyRemoteStepConfirm({ permitId: selected.value.id, stepId, done: true, evidence: '现场照片 1 张', source })
}
function diffValue(v: unknown) {
  if (v === undefined || v === null || v === '') return '—'
  if (typeof v === 'boolean') return v ? '是' : '否'
  return String(v)
}
</script>

<template>
  <div class="page">
    <div class="head"><div><p class="eyebrow">许可全生命周期</p><h1 class="page-title">作业许可证</h1><p class="muted">隔离点状态变化即触发复核失效；离线确认带来源与修订号，恢复后合并，冲突先显示差异、不覆盖对方。</p></div><UButton icon="i-heroicons-plus" color="primary" @click="modal = true">新建许可</UButton></div>
    <div class="permit-layout">
      <aside class="panel permit-list">
        <button v-for="permit in store.permits" :key="permit.id" :class="{ active: permit.id === selectedId }" @click="selectedId = permit.id"><span><b>{{ permit.id }}</b><small>{{ permit.title }}</small></span><UBadge :color="permit.reviewRequired ? 'red' : 'amber'" variant="subtle">{{ permit.reviewRequired ? '冲突' : permit.status }}</UBadge></button>
      </aside>
      <section v-if="selected" class="grid detail-grid">
        <article class="panel p-4">
          <div class="detail-head"><div><small class="muted">{{ selected.id }} · 修订 r{{ selected.revision }}</small><h2>{{ selected.title }}</h2><p>{{ selected.device }} · {{ selected.window }}</p></div><UBadge size="lg" :color="selected.reviewRequired ? 'red' : 'green'" variant="subtle">{{ selected.reviewRequired ? '待复核' : selected.status }}</UBadge></div>
          <div class="flow"><div v-for="(step,index) in ['申请','复核','执行','结束','关闭']" :key="step" :class="{ done: index <= statusIndex, current: index === statusIndex }"><i>{{ index + 1 }}</i><span>{{ step }}</span></div></div>
          <UAlert v-if="selected.reviewRequired" color="red" variant="soft" title="设备状态变化触发复核" description="共用隔离点或相关设备状态已发生变化，复核结果已失效，需值班负责人重新确认后方可继续。">
            <template #actions><UButton size="xs" color="red" variant="solid" @click="store.passReview(selected.id)">复核通过并继续</UButton></template>
          </UAlert>

          <div v-for="op in selectedConflicts" :key="op.id" class="conflict">
            <div class="conflict-head"><UIcon name="i-heroicons-exclamation-triangle" /><b>补传冲突 · 步骤 {{ op.stepId }}</b><UBadge color="red" variant="subtle">对方已改</UBadge></div>
            <p class="muted">我方（{{ op.source.actor }}）基线 r{{ op.baseRevision }}，对方已更新至更高修订。以下为差异，未覆盖对方记录：</p>
            <div v-for="d in op.diff" :key="d.field" class="diff-row"><span class="diff-label">{{ d.label }}</span><div class="diff-vals"><span class="local">我方 {{ diffValue(d.local) }}</span><span v-if="String(d.local) !== String(d.remote)" class="vs">≠</span><span v-else class="vs same">一致</span><span class="remote">对方 {{ diffValue(d.remote) }}<template v-if="d.remoteSource"> · {{ d.remoteSource.actor }} 于 {{ d.remoteAt }}</template></span></div></div>
            <div class="conflict-actions"><UButton size="xs" color="gray" variant="outline" @click="store.resolveConflict(op.id, 'accept-remote')">采纳对方记录</UButton><UButton size="xs" color="primary" variant="soft" @click="store.resolveConflict(op.id, 'append-mine')">追加我的确认（不覆盖对方）</UButton></div>
          </div>

          <h3>操作步骤</h3>
          <div v-for="step in selected.steps" :key="step.id" class="step">
            <UCheckbox :model-value="step.done" @update:model-value="store.toggleStep(selected.id, step.id)" />
            <div class="step-body">
              <b :class="{ completed: step.done }">{{ step.text }}</b>
              <small>责任人 {{ step.owner }} · {{ step.evidence || '尚未上传证据' }} · r{{ step.revision }}<template v-if="step.updatedBy"> · {{ step.updatedBy.actor }} 于 {{ step.updatedAt }}</template></small>
              <small v-if="step.confirmations.length" class="confirm-history">确认 {{ step.confirmations.length }} 次：<span v-for="(c, i) in step.confirmations" :key="i">{{ c.source.actor }} {{ c.at }}<template v-if="i < step.confirmations.length - 1">、</template></span></small>
            </div>
            <UBadge v-if="queuedStepIds.has(step.id)" color="amber" variant="subtle">待补传</UBadge>
            <UButton size="xs" variant="ghost" icon="i-heroicons-camera">证据</UButton>
            <UButton v-if="store.connection !== '在线'" size="xs" color="gray" variant="ghost" @click="simulateRemote(step.id)">模拟他人改动</UButton>
          </div>
          <UProgress :value="completed" class="mt-4" /><div class="inline justify-between mt-1"><span class="muted">步骤完成度</span><b>{{ completed }}%</b></div>
        </article>
        <aside class="grid right">
          <article class="panel p-4"><h3>隔离点与锁定</h3><div v-for="point in selected.isolationPoints" :key="point.id" class="point"><span><b>{{ point.label }}</b><small>{{ point.device }} · {{ point.type }} · r{{ point.revision }}<template v-if="point.updatedBy"> · {{ point.updatedBy.actor }}</template></small></span><UBadge :color="point.state === '已隔离' ? 'green' : point.state === '已恢复' ? 'blue' : 'amber'" variant="subtle">{{ point.state }}</UBadge></div></article>
          <article class="panel p-4"><h3>流程操作</h3><p class="muted">推进前系统重新检查隔离冲突、跨班组重叠与未完成交接。</p><UButton block color="primary" icon="i-heroicons-arrow-right-circle" @click="store.advancePermit(selected.id)">推进到下一状态</UButton><UButton block class="mt-2" color="gray" variant="outline" icon="i-heroicons-arrow-uturn-left">退回补件</UButton><UButton block class="mt-2" color="red" variant="soft" icon="i-heroicons-exclamation-triangle">申请紧急暂停</UButton></article>
        </aside>
      </section>
    </div>
    <UModal v-model="modal"><article class="p-5"><h2>申请作业许可</h2><p class="muted">提交后进入安全复核，设备隔离冲突会在提交时自动校验。</p><div class="form-grid"><UFormGroup label="作业名称"><UInput v-model="form.title" /></UFormGroup><UFormGroup label="设备编号"><UInput v-model="form.device" /></UFormGroup><UFormGroup label="班组"><UInput v-model="form.crew" /></UFormGroup><UFormGroup label="负责人"><UInput v-model="form.owner" /></UFormGroup><UFormGroup label="计划窗口"><UInput v-model="form.window" /></UFormGroup><UFormGroup label="风险等级"><USelect v-model="form.risk" :options="['一级','二级','三级']" /></UFormGroup></div><div class="inline justify-end mt-4"><UButton color="gray" @click="modal = false">取消</UButton><UButton color="primary" :disabled="!form.title || !form.device" @click="createPermit">提交复核</UButton></div></article></UModal>
  </div>
</template>

<style scoped>
.head{display:flex;justify-content:space-between;gap:16px;margin-bottom:18px}.head h1{margin:3px 0 7px}.head p{margin:0}.eyebrow{font-size:12px;color:#2563eb;font-weight:700}.permit-layout{display:grid;grid-template-columns:300px minmax(0,1fr);gap:16px}.permit-list{padding:8px;height:fit-content}.permit-list button{width:100%;display:flex;justify-content:space-between;align-items:center;gap:8px;padding:13px 11px;border:0;background:transparent;border-radius:7px;text-align:left;color:inherit;cursor:pointer}.permit-list button:hover,.permit-list button.active{background:#eff6ff}.permit-list b,.permit-list small{display:block}.permit-list small{color:#667085;margin-top:4px}.detail-grid{grid-template-columns:minmax(0,1.5fr) minmax(280px,.65fr);gap:16px}.right{height:fit-content;gap:14px}.detail-head{display:flex;justify-content:space-between;gap:10px;margin-bottom:16px}.detail-head h2{margin:4px 0}.detail-head p{margin:0;color:#667085}.flow{display:grid;grid-template-columns:repeat(5,1fr);margin:20px 0}.flow>div{position:relative;text-align:center;color:#94a3b8}.flow>div:after{content:"";position:absolute;left:55%;right:-45%;top:13px;height:2px;background:#e2e8f0}.flow>div:last-child:after{display:none}.flow i{position:relative;z-index:1;display:grid;place-items:center;width:28px;height:28px;margin:auto;border-radius:50%;background:#e2e8f0;font-style:normal;font-size:12px}.flow span{display:block;font-size:12px;margin-top:5px}.flow .done{color:#2563eb}.flow .done i{background:#2563eb;color:#fff}.flow .done:after{background:#2563eb}.panel h3{font-size:15px;margin:18px 0 10px}.step{display:flex;align-items:flex-start;gap:10px;padding:12px 0;border-bottom:1px solid #edf0f5}.step-body{flex:1}.step-body small{display:block;color:#667085;margin-top:4px}.step .completed{text-decoration:line-through;color:#667085}.confirm-history{color:#2563eb!important}.conflict{border:1px solid #fecaca;background:#fef2f2;border-radius:8px;padding:12px;margin:12px 0}.conflict-head{display:flex;align-items:center;gap:8px;color:#b91c1c}.conflict-head b{flex:1}.conflict .muted{margin:6px 0 10px;font-size:13px}.diff-row{display:flex;align-items:center;gap:10px;padding:6px 0;font-size:13px}.diff-label{color:#667085;min-width:70px}.diff-vals{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.diff-vals .local{color:#b45309}.diff-vals .remote{color:#15803d}.diff-vals .vs{color:#dc2626;font-weight:700}.diff-vals .same{color:#15803d}.conflict-actions{display:flex;gap:8px;margin-top:10px}.point{display:flex;justify-content:space-between;padding:11px 0;border-bottom:1px solid #edf0f5}.point b,.point small{display:block}.point small{color:#667085;margin-top:4px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:18px 0}.mt-2{margin-top:8px}
@media(max-width:980px){.permit-layout{grid-template-columns:1fr}.permit-list{display:flex;overflow:auto}.permit-list button{min-width:230px}.detail-grid{grid-template-columns:1fr}}@media(max-width:620px){.head{flex-direction:column}.form-grid{grid-template-columns:1fr}}
</style>
