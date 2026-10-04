<script setup lang="ts">
import { useOperationsStore } from '~/stores/operations'

const store = useOperationsStore()
const route = useRoute()
const open = ref(false)
const nav = [
  { to: '/', label: '状态看板', icon: 'i-heroicons-chart-bar-square' },
  { to: '/permits', label: '作业许可', icon: 'i-heroicons-clipboard-document-check' },
  { to: '/devices', label: '隔离与锁定', icon: 'i-heroicons-lock-closed' },
  { to: '/audit', label: '审计记录', icon: 'i-heroicons-clock' },
]

const connBadge = computed(() => {
  if (store.connection === '在线') return { color: 'green', label: '在线' }
  if (store.connection === '离线') return { color: 'red', label: '离线 · 本地记录' }
  return { color: 'amber', label: '重连中 · 有待处理项' }
})
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar" :class="{ open }">
      <div class="brand"><span>风</span><div><b>风场作业许可台</b><small>LOCKOUT CONTROL</small></div></div>
      <nav>
        <NuxtLink v-for="item in nav" :key="item.to" :to="item.to" :class="{ active: route.path === item.to }"><UIcon :name="item.icon" /><span>{{ item.label }}</span></NuxtLink>
      </nav>
      <div class="site-card"><span class="pulse" /><div><b>海州湾 H2 风电场</b><small>32 台风机 · 在线 30</small></div></div>
    </aside>
    <div class="content">
      <header class="topbar">
        <UButton class="mobile-menu" icon="i-heroicons-bars-3" color="gray" variant="ghost" @click="open = !open" />
        <div class="who">
          <b>运行中 · A 区集电线路检修</b>
          <span class="muted desktop-only">2026-09-29 · 两组值班同时在岗</span>
        </div>
        <span class="flex-1" />
        <USelect
          v-model="store.actorName"
          :options="store.actors.map((a) => ({ label: `${a.name}（${a.role}）`, value: a.name }))"
          value-attribute="value"
          size="sm"
          class="actor-select"
        />
        <UBadge :color="connBadge.color" variant="subtle">{{ connBadge.label }}</UBadge>
        <UButton v-if="store.connection === '在线'" size="sm" color="red" variant="soft" icon="i-heroicons-wifi-off" @click="store.setOffline">模拟断网</UButton>
        <UButton v-if="store.recovering" size="sm" color="green" variant="soft" icon="i-heroicons-wifi" @click="store.setOnline">网络恢复 · 合并补传</UButton>
        <UBadge v-else-if="store.connection !== '在线'" color="amber" variant="subtle">请逐条处理待办</UBadge>
        <UBadge v-if="store.pendingCount" color="amber" variant="subtle">待处理 {{ store.pendingCount }}</UBadge>
        <UBadge v-if="store.conflictCount" color="red" variant="subtle" icon="i-heroicons-arrows-right-left">修订冲突 {{ store.conflictCount }}</UBadge>
        <UButton icon="i-heroicons-plus" color="primary" size="sm" @click="navigateTo('/permits?new=1')">新建许可</UButton>
      </header>
      <UAlert
        v-if="store.connection !== '在线'"
        class="net-banner"
        :color="store.connection === '离线' ? 'red' : 'amber'"
        variant="soft"
        :icon="store.connection === '离线' ? 'i-heroicons-wifi-off' : 'i-heroicons-arrow-path'"
        :title="store.connection === '离线' ? '网络已中断：现场确认照常进行，本地暂存，恢复后自动补传' : '恢复合并完成，存在待处理项'"
        :description="store.notice || `队列中 ${store.pendingCount} 条待处理、${store.conflictCount} 条修订冲突；每条操作带操作人、来源终端与修订号，重复补传只保留一次。`"
      />
      <main class="main"><slot /></main>
    </div>
  </div>
</template>

<style scoped>
.app-shell{min-height:100vh;display:flex}.sidebar{width:236px;background:#0f172a;color:#e2e8f0;padding:18px 12px;display:flex;flex-direction:column;position:sticky;top:0;height:100vh}.brand{display:flex;gap:11px;align-items:center;padding:4px 8px 22px;border-bottom:1px solid #233047}.brand>span{display:grid;place-items:center;width:38px;height:38px;border-radius:8px;background:#0891b2;font-weight:800}.brand b,.brand small{display:block}.brand small{font-size:9px;color:#7f8c9f;letter-spacing:1px}.sidebar nav{display:grid;gap:5px;padding:16px 0;flex:1}.sidebar a{display:flex;gap:10px;align-items:center;padding:11px 12px;border-radius:7px;color:#aebbd0;text-decoration:none;font-size:14px}.sidebar a:hover,.sidebar a.active{background:#1e293b;color:#fff}.sidebar a.active{box-shadow:inset 3px 0 #22d3ee}.site-card{display:flex;align-items:center;gap:10px;background:#151f31;border:1px solid #263247;border-radius:8px;padding:12px}.site-card b,.site-card small{display:block;font-size:13px}.site-card small{color:#8290a7;margin-top:4px}.pulse{width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 4px #165e35}.content{min-width:0;flex:1}.topbar{height:68px;background:#fff;border-bottom:1px solid #dfe5ec;display:flex;align-items:center;gap:12px;padding:0 22px;position:sticky;top:0;z-index:20}.topbar span{font-size:12px}.who b{display:block}.actor-select{width:168px}.net-banner{margin:14px 22px 0}.main{padding:22px}.mobile-menu{display:none}
@media(max-width:1100px){.actor-select{width:140px}}
@media(max-width:900px){.sidebar{position:fixed;left:-250px;z-index:50;transition:.2s}.sidebar.open{left:0}.content{width:100%}.mobile-menu{display:inline-flex}.main{padding:14px}.topbar{padding:0 12px;flex-wrap:wrap;height:auto;min-height:68px}}
</style>
