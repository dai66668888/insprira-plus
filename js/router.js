import { currentPage } from './state.js';
import { toast } from './components.js';
import { gotoPage } from './navigation.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderHotlist, clearHotCache } from './pages/hotlist.js';
import { renderInspiration } from './pages/inspiration.js';
import { renderSearch, doSearch, showSearchHistory } from './pages/search.js';
import { renderTracker } from './pages/tracker.js';
import { renderLibrary } from './pages/knowledgebase.js';
import { renderSkills, clearSkillCache } from './pages/agent.js';
import { renderAgent } from './pages/agent.js';
import { renderSettings } from './pages/settings.js';

export { gotoPage, toggleSidebar, openMobileSidebar, closeMobileSidebar } from './navigation.js';

export function refreshCurrent() {
  if (currentPage === 'dashboard') renderDashboard();
  else if (currentPage === 'hotlist') { clearHotCache(); renderHotlist(); }
  else if (currentPage === 'inspiration') renderInspiration();
  else if (currentPage === 'tracker') renderTracker();
  else if (currentPage === 'library' || currentPage === 'knowledgebase') renderLibrary();
  else if (currentPage === 'skills') { clearSkillCache(); renderSkills(); }
  else if (currentPage === 'agent') renderAgent();
  else if (currentPage === 'settings') renderSettings();
  else if (currentPage === 'search') { showSearchHistory(); }
  toast('已刷新', 'success');
}

export function doGlobalSearch() {
  const kw = document.getElementById('globalSearch').value.trim();
  if (!kw) return;
  gotoPage('search');
  document.getElementById('searchInput').value = kw;
  doSearch();
}
