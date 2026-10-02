import clsx from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { NetworkModeBadge } from '../components/NetworkModeBadge';
import { VIEWPORT_MIN_HEIGHT_FULL } from '../constants/viewportLayout';
import { useAuth } from '../contexts/AuthContext';
import { ConfirmProvider } from '../contexts/ConfirmContext';
import { useDismissOnOutside } from '../hooks/useDismissOnOutside';

import { ADMIN_HOME, ADMIN_NAV_GROUPS, filterAdminNavGroups, findActiveAdminNav } from './adminNavigation';

const tabClass = 'flex h-[34px] items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[13px] font-semibold transition-colors';
// 文字色は状態ごとに1つだけ付ける。重ねると後勝ちになり、選択中の白地に白文字が出る。
const tabIdleClass = 'text-white/70 hover:bg-white/10 hover:text-white';
const tabHotClass = 'bg-white/10 text-white';
const tabActiveClass = 'bg-white text-slate-950';

type MenuState = { hotGroupId: string | null; focusSearch: boolean } | null;

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function AdminLayout() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const active = findActiveAdminNav(pathname);

  const [menu, setMenu] = useState<MenuState>(null);
  const [query, setQuery] = useState('');
  const [accountOpen, setAccountOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const closeMenu = useCallback(() => setMenu(null), []);
  const closeAccount = useCallback(() => setAccountOpen(false), []);
  const openMenu = useCallback((hotGroupId: string | null, focusSearch: boolean) => {
    setQuery('');
    setAccountOpen(false);
    setMenu({ hotGroupId, focusSearch });
  }, []);

  useDismissOnOutside(headerRef, menu !== null, closeMenu);
  useDismissOnOutside(accountRef, accountOpen, closeAccount);

  // 「/」でどの画面からでも画面検索を開く（入力中は除く）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      event.preventDefault();
      openMenu(null, true);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [openMenu]);

  useEffect(() => {
    if (menu?.focusSearch) searchRef.current?.focus();
  }, [menu]);

  const filteredGroups = filterAdminNavGroups(query);
  const firstMatch = query.trim() ? filteredGroups[0]?.items[0] : undefined;
  const toggleGroup = (groupId: string) => (menu?.hotGroupId === groupId ? closeMenu() : openMenu(groupId, false));

  return (
    <ConfirmProvider>
      <div className={`${VIEWPORT_MIN_HEIGHT_FULL} bg-slate-800 text-white`}>
        <header ref={headerRef} className="relative z-30 border-b border-white/10 bg-slate-900">
          <div className="mx-auto flex h-[52px] max-w-screen-2xl items-center gap-1.5 px-3">
            <Link to="/admin" className="flex shrink-0 items-center gap-2 pr-2 text-sm font-bold text-white" onClick={closeMenu}>
              <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
                <rect width="26" height="26" rx="7" className="fill-blue-600" />
                <path d="M8 8h10v3h-6.5v2.5H17v3h-5.5V20H8z" fill="#fff" />
              </svg>
              <span className="sr-only whitespace-nowrap xl:not-sr-only">Factory Borrow System</span>
            </Link>

            <button
              type="button"
              className="flex h-[34px] min-w-0 items-center gap-2 rounded-lg bg-white px-2.5 text-[13px] font-bold text-slate-950 lg:hidden"
              aria-expanded={menu !== null}
              aria-controls="admin-menu"
              onClick={() => (menu ? closeMenu() : openMenu(active?.group.id ?? null, false))}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0" aria-hidden="true">
                <path d="M1 3h12M1 7h12M1 11h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
              </svg>
              <span className="truncate">{active?.item.label ?? ADMIN_HOME.label}</span>
            </button>

            <nav className="hidden min-w-0 gap-0.5 lg:flex" aria-label="管理ナビゲーション">
              <NavLink
                to={ADMIN_HOME.to}
                end
                className={({ isActive }) => clsx(tabClass, isActive ? tabActiveClass : tabIdleClass)}
                onClick={closeMenu}
              >
                {ADMIN_HOME.label}
              </NavLink>
              {ADMIN_NAV_GROUPS.map((group) => {
                const isCurrent = active?.group.id === group.id;
                const isHot = menu?.hotGroupId === group.id;
                return (
                  <button
                    key={group.id}
                    type="button"
                    className={clsx(tabClass, isCurrent ? tabActiveClass : isHot ? tabHotClass : tabIdleClass)}
                    aria-expanded={isHot}
                    aria-controls="admin-menu"
                    onClick={() => toggleGroup(group.id)}
                    onMouseEnter={() => {
                      if (menu && !isHot) setMenu({ hotGroupId: group.id, focusSearch: false });
                    }}
                  >
                    {group.label}
                    {isCurrent ? (
                      <span className="hidden font-medium text-slate-600 before:mr-1.5 before:text-slate-400 before:content-['/'] xl:inline">
                        {active.item.label}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </nav>

            <div className="flex-1" />

            <button
              type="button"
              className="hidden h-[34px] shrink-0 items-center gap-2 rounded-lg border border-white/10 px-2.5 text-xs text-white/50 transition-colors hover:border-white/25 hover:text-white/75 sm:flex"
              aria-label="画面を検索"
              onClick={() => openMenu(null, true)}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <circle cx="6" cy="6" r="4.2" stroke="currentColor" strokeWidth="1.6" fill="none" />
                <path d="M9.3 9.3 13 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <span className="hidden xl:inline">検索</span>
              <kbd className="rounded border border-white/20 px-1.5 font-mono text-[10px] text-white/70">/</kbd>
            </button>

            <NetworkModeBadge />

            <Link
              to="/kiosk"
              className="flex h-[34px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-blue-600 px-3 text-[13px] font-bold text-white transition-colors hover:bg-blue-500"
              aria-label="キオスクへ"
            >
              <span className="hidden sm:inline">キオスクへ</span>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M4 2h6v6M10 2 2.5 9.5" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>

            <div ref={accountRef} className="relative shrink-0">
              <button
                type="button"
                className="h-[34px] w-[34px] rounded-full border border-white/20 bg-slate-800 text-[13px] font-bold text-white transition-colors hover:border-white/40"
                aria-label={`アカウント ${user?.username ?? ''}`}
                aria-expanded={accountOpen}
                aria-haspopup="menu"
                onClick={() => {
                  closeMenu();
                  setAccountOpen((v) => !v);
                }}
              >
                {(user?.username ?? '?').slice(0, 1).toUpperCase()}
              </button>
              {accountOpen ? (
                <div className="absolute right-0 top-full z-40 mt-2 w-56 rounded-xl border border-white/20 bg-slate-900 p-3.5 shadow-2xl">
                  <p className="truncate text-sm font-bold text-white">{user?.username}</p>
                  <button
                    type="button"
                    className="mt-3 h-[34px] w-full rounded-lg border border-white/20 text-[13px] font-semibold text-white transition-colors hover:bg-white/10"
                    onClick={logout}
                  >
                    ログアウト
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          {menu ? (
            <div
              id="admin-menu"
              className="absolute inset-x-0 top-full max-h-[calc(100dvh-53px)] overflow-y-auto border-b border-white/20 bg-slate-900 shadow-2xl"
            >
              <div className="mx-auto max-w-screen-2xl px-4 pb-4 pt-3.5">
                <label className="mb-3.5 flex h-10 items-center gap-2.5 rounded-lg border border-white/20 bg-slate-950/60 px-3 focus-within:border-blue-500">
                  <svg width="15" height="15" viewBox="0 0 14 14" className="shrink-0 text-white/50" aria-hidden="true">
                    <circle cx="6" cy="6" r="4.2" stroke="currentColor" strokeWidth="1.6" fill="none" />
                    <path d="M9.3 9.3 13 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                  <input
                    ref={searchRef}
                    type="text"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' || event.nativeEvent.isComposing || !firstMatch) return;
                      navigate(firstMatch.to);
                      closeMenu();
                    }}
                    placeholder="画面名で絞り込み（例: 点検、CSV）"
                    aria-label="画面名で絞り込み"
                    autoComplete="off"
                    className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/40"
                  />
                  <kbd className="rounded border border-white/20 px-1.5 font-mono text-[10px] text-white/70">Enter</kbd>
                </label>
                {filteredGroups.length === 0 ? (
                  <p className="px-2 py-4 text-[13px] text-white/50">一致する画面がありません</p>
                ) : (
                  <nav className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6" aria-label="すべての管理画面">
                    {filteredGroups.map((group) => (
                      <div
                        key={group.id}
                        className={clsx(
                          'rounded-lg border p-2 transition-colors',
                          menu.hotGroupId === group.id && !query.trim() ? 'border-white/10 bg-white/5' : 'border-transparent'
                        )}
                      >
                        <p className="mb-1.5 flex justify-between px-2 text-[11px] font-bold tracking-widest text-white/50">
                          {group.label}
                          <span className="font-mono tracking-normal">{group.items.length}</span>
                        </p>
                        {group.items.map((item) => {
                          const isCurrent = active?.item.to === item.to;
                          return (
                            <Link
                              key={item.to}
                              to={item.to}
                              aria-current={isCurrent ? 'page' : undefined}
                              className={clsx(
                                'flex items-center gap-2 rounded-md px-2 py-[7px] text-[13px] transition-colors hover:bg-white/10 hover:text-white',
                                isCurrent ? 'font-bold text-white' : 'font-medium text-white/70',
                                item === firstMatch && 'bg-white/10 text-white'
                              )}
                              onClick={closeMenu}
                            >
                              <span className="min-w-0 break-words">{item.label}</span>
                              {isCurrent ? <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" /> : null}
                            </Link>
                          );
                        })}
                      </div>
                    ))}
                  </nav>
                )}
              </div>
            </div>
          ) : null}
        </header>
        {menu ? <div className="fixed inset-0 z-20 bg-slate-950/55" aria-hidden="true" /> : null}
        <main className="mx-auto flex max-w-screen-2xl flex-col gap-4 px-4 py-4 sm:px-6">
          <Outlet />
        </main>
      </div>
    </ConfirmProvider>
  );
}
