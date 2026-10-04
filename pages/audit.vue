<script setup lang="ts">
import { useOperationsStore } from '~/stores/operations'

const store = useOperationsStore()
const keyword = ref('')
const kindFilter = ref<'全部' | 'point' | 'step' | 'review' | 'sync'>('全部')
const filtered = computed(() => store.audit.filter((event) => {
  const text = `${event.actor}${event.action}${event.target}${event.detail}${event.source}`
  return (kindFilter.value === '全部' || event.kind === kindFilter.value) && text.includes(keyword.value)
}))
const filters = ['全部', 'point', 'step', 'review', 'sync'] as const
const kindLabel: Record<string, string> = { point: '隔离点', step: '步骤确认', review: '复核', sync: '同步/重试', system: '系统' }
</script>

<template>
  <div class="page">
    <div class="head">
      <div><p class="eyebrow">不可覆盖的操作记录</p><h1 class="page-title">审计与交接时间线</h1><p class="muted">每条记录写明谁、在何时、从哪个终端确认了什么，以及操作后的修订号；补传去重与重试过程同样留痕。</p></div>
      <UButton color="gray" variant="outline" icon="i-heroicons-arrow-down-tray">导出审计包</UButton>
    </div>
    <section class="panel p-4">
      <div class="inline justify-between wrap mb-4">
        <UInput v-model="keyword" icon="i-heroicons-magnifying-glass" placeholder="搜索人员、许可、隔离点或操作" class="search" />
        <div class="inline">
          <UButton
            v-for="kind in filters" :key="kind" size="sm"
            :color="kindFilter === kind ? 'primary' : 'gray'"
            :variant="kindFilter === kind ? 'soft' : 'ghost'"
            @click="kindFilter = kind"
          >{{ kind === '全部' ? '全部' : kindLabel[kind] }}</UButton>
          <UBadge color="gray">共 {{ filtered.length }} 条</UBadge>
        </div>
      </div>
      <div class="timeline">
        <div v-for="event in filtered" :key="event.id" class="event" :class="`kind-${event.kind ?? 'system'}`">
          <time>{{ event.time }}</time><i></i>
          <div>
            <div class="inline wrap">
              <b>{{ event.actor }}</b>
              <UBadge size="xs" variant="subtle" :color="event.kind === 'point' ? 'blue' : event.kind === 'review' ? 'red' : event.kind === 'sync' ? 'amber' : 'gray'">{{ event.action }}</UBadge>
              <span class="target">{{ event.target }}</span>
              <UBadge v-if="event.revision" size="xs" color="gray" variant="ghost">r{{ event.revision }}</UBadge>
            </div>
            <p>{{ event.detail }}</p>
            <small class="meta">来源 {{ event.source }} · 操作键 {{ event.clientId }}</small>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.head{display:flex;justify-content:space-between;gap:16px;margin-bottom:18px}.head h1{margin:3px 0 7px}.head p{margin:0;max-width:820px}.eyebrow{font-size:12px;color:#2563eb;font-weight:700}.search{min-width:300px}.timeline{padding:4px 0}
.event{display:grid;grid-template-columns:90px 16px 1fr;gap:10px;position:relative;padding:7px 0}.event time{color:#667085;font-size:13px;padding-top:3px}.event i{position:relative;width:10px;height:10px;border-radius:50%;background:#2563eb;top:7px;z-index:1;box-shadow:0 0 0 4px #dbeafe}.event.kind-point i{background:#2563eb;box-shadow:0 0 0 4px #dbeafe}.event.kind-review i{background:#dc2626;box-shadow:0 0 0 4px #fee2e2}.event.kind-step i{background:#16a34a;box-shadow:0 0 0 4px #dcfce7}.event.kind-sync i{background:#d97706;box-shadow:0 0 0 4px #fef3c7}
.event:not(:last-child):after{content:"";position:absolute;left:98px;top:21px;bottom:-7px;width:2px;background:#dbeafe}.event>div{border-bottom:1px solid #edf0f5;padding:0 0 14px 8px}.event p{margin:6px 0 0;color:#475569}.target{font-family:monospace;color:#475569;font-size:12px}.meta{color:#94a3b8;font-size:11px}
@media(max-width:620px){.head{flex-direction:column;gap:12px}.event{grid-template-columns:70px 14px 1fr}.event:not(:last-child):after{left:81px}.search{min-width:100%}.inline.justify-between{align-items:flex-start;flex-direction:column}}
</style>
