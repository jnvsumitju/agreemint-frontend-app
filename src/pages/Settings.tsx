import { useSearchParams } from 'react-router-dom'
import { OrgSettingsTab } from '../components/settings/OrgSettingsTab'
import { MembersTab } from '../components/settings/MembersTab'
import { PreferencesTab } from '../components/settings/PreferencesTab'

type TabId = 'org' | 'members' | 'preferences'

const TABS: { id: TabId; label: string }[] = [
  { id: 'org', label: 'Organization' },
  { id: 'members', label: 'Members' },
  { id: 'preferences', label: 'Preferences' },
]

function isValidTab(v: string | null): v is TabId {
  return v === 'org' || v === 'members' || v === 'preferences'
}

export function Settings() {
  const [params, setParams] = useSearchParams()
  const rawTab = params.get('tab')
  const activeTab: TabId = isValidTab(rawTab) ? rawTab : 'org'

  function selectTab(id: TabId) {
    setParams({ tab: id }, { replace: true })
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Settings</h1>

      {/* Tab bar */}
      <div className="mb-8 flex gap-1 border-b border-zinc-200 dark:border-zinc-700">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => selectTab(tab.id)}
            className={`-mb-px px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'border-b-2 border-violet-600 text-violet-700 dark:border-violet-400 dark:text-violet-300'
                : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'org' && <OrgSettingsTab />}
      {activeTab === 'members' && <MembersTab />}
      {activeTab === 'preferences' && <PreferencesTab />}
    </div>
  )
}
