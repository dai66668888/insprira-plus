import { localApi } from './api.js';
import { Modal, toast } from './components.js';
import { esc } from './utils.js';
import { initIcons } from './icons.js';
import { gotoPage } from './navigation.js';

let currentAccount = null;
let accountModal = null;

function accountInitial(account) {
  return String(account?.displayName || account?.username || 'A').trim().charAt(0).toUpperCase() || 'A';
}

export function renderAccountSummary(account = currentAccount) {
  if (!account) return;
  currentAccount = account;
  const avatar = document.getElementById('current-user-avatar');
  const name = document.getElementById('current-user-name');
  const username = document.getElementById('current-user-username');
  const warning = document.getElementById('current-user-warning');
  if (avatar) avatar.textContent = accountInitial(account);
  if (name) name.textContent = account.displayName || account.username;
  if (username) username.textContent = `@${account.username}`;
  if (warning) warning.classList.toggle('hidden', !account.mustChangePassword);
}

export async function loadCurrentAccount({ promptPasswordChange = false } = {}) {
  const account = await localApi('account');
  renderAccountSummary(account);
  if (promptPasswordChange && account.mustChangePassword) {
    const promptKey = `furnace_password_prompted:${account.id}`;
    if (!sessionStorage.getItem(promptKey)) {
      sessionStorage.setItem(promptKey, '1');
      setTimeout(() => openAccountModal(), 150);
    }
  }
  return account;
}

export async function openAccountModal() {
  try {
    const account = await loadCurrentAccount();
    accountModal?.close();
    accountModal = new Modal({
      title: '账户与安全',
      maxWidth: '680px',
      body: `
        ${account.mustChangePassword ? `
          <div class="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-200 mb-4">
            当前仍在使用系统默认密码，请立即修改。
          </div>
        ` : ''}
        <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
          <form id="account-profile-form" class="space-y-3" autocomplete="off">
            <div>
              <div class="text-sm font-semibold mb-1">账户资料</div>
              <div class="text-[11px] text-gray-500">用户名用于登录，显示名称用于界面展示。</div>
            </div>
            <div>
              <label class="text-xs text-gray-400 block mb-1">用户名</label>
              <input class="input" id="account-username" autocomplete="username" value="${esc(account.username)}" />
            </div>
            <div>
              <label class="text-xs text-gray-400 block mb-1">显示名称</label>
              <input class="input" id="account-display-name" autocomplete="name" value="${esc(account.displayName || account.username)}" />
            </div>
            <button type="submit" class="btn btn-ghost w-full justify-center" data-action="saveAccountProfile">
              <i data-lucide="save" class="w-3.5 h-3.5"></i>保存账户资料
            </button>
          </form>
          <form id="account-password-form" class="space-y-3" autocomplete="off">
            <div>
              <div class="text-sm font-semibold mb-1">修改密码</div>
              <div class="text-[11px] text-gray-500">密码保存在 SQLite 中并使用 scrypt 加盐哈希。</div>
            </div>
            <div>
              <label class="text-xs text-gray-400 block mb-1">当前密码</label>
              <input class="input" type="password" id="account-current-password" name="furnace_current_password" autocomplete="new-password" value="" />
            </div>
            <div>
              <label class="text-xs text-gray-400 block mb-1">新密码</label>
              <input class="input" type="password" id="account-new-password" name="furnace_new_password" autocomplete="new-password" minlength="6" value="" />
            </div>
            <div>
              <label class="text-xs text-gray-400 block mb-1">确认新密码</label>
              <input class="input" type="password" id="account-confirm-password" name="furnace_confirm_password" autocomplete="new-password" minlength="6" value="" />
            </div>
            <button type="submit" class="btn btn-primary w-full justify-center" data-action="changeAccountPassword">
              <i data-lucide="shield-check" class="w-3.5 h-3.5"></i>更新密码
            </button>
          </form>
        </div>
        <div class="flex items-center justify-between border-t border-white/10 mt-5 pt-4">
          <div class="text-[11px] text-gray-500">角色：${esc(account.role)} · 创建于 ${new Date(account.createdAt).toLocaleDateString('zh-CN')}</div>
          <button class="btn btn-ghost text-red-400" data-action="logoutAccount">
            <i data-lucide="log-out" class="w-3.5 h-3.5"></i>退出登录
          </button>
        </div>
      `,
    }).open();
    const profileForm = document.getElementById('account-profile-form');
    const passwordForm = document.getElementById('account-password-form');
    profileForm?.addEventListener('submit', event => event.preventDefault());
    passwordForm?.addEventListener('submit', event => event.preventDefault());
    initIcons(accountModal.bodyElement);
  } catch (error) {
    toast(error.message, 'error');
  }
}

export async function saveAccountProfile() {
  const username = document.getElementById('account-username')?.value.trim() || '';
  const displayName = document.getElementById('account-display-name')?.value.trim() || '';
  try {
    const account = await localApi('account', {
      method: 'PATCH',
      body: { username, displayName },
    });
    localStorage.setItem('furnace_user', account.username);
    renderAccountSummary(account);
    toast('账户资料已保存', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

export async function changeAccountPassword() {
  const currentPassword = document.getElementById('account-current-password')?.value || '';
  const newPassword = document.getElementById('account-new-password')?.value || '';
  const confirmPassword = document.getElementById('account-confirm-password')?.value || '';
  if (newPassword !== confirmPassword) {
    toast('两次输入的新密码不一致', 'error');
    return;
  }
  try {
    const account = await localApi('account/password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    });
    renderAccountSummary(account);
    accountModal?.close();
    accountModal = null;
    toast('密码已更新，其他登录会话已注销', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

export async function logoutAccount() {
  try {
    await localApi('logout', { method: 'POST', body: {} });
  } catch {}
  accountModal?.close();
  accountModal = null;
  currentAccount = null;
  const password = document.getElementById('loginPass');
  if (password) password.value = '';
  gotoPage('login', { replaceHistory: true });
}
