import { useState, useEffect } from 'react';
import { Clock, Database, LayoutDashboard, LogOut, Menu, TrendingDown, X, Users, AlertCircle, AlertTriangle, FileSpreadsheet, Calendar, UserX } from 'lucide-react';
import { useDashboard } from '@/hooks/useDashboardData';
import { useAuth } from '@/contexts/AuthContext';
import { DATASETS } from '@/lib/constants';
import { db } from '@/lib/firebase';
import { ref, onValue } from 'firebase/database';
import { AnimatedLogo } from '@/components/AnimatedLogo'; // <-- අලුත් ලෝගෝ එක import කළා

const ICONS: Record<string, typeof LayoutDashboard> = {
  hourly: Clock,
  filtered: Database,
  outflow: TrendingDown,
  cancellation: X,
};

export function Sidebar() {
  const { active, setActive, sidebarOpen, setSidebarOpen } = useDashboard();
  const { logout, user } = useAuth();
  
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      return;
    }

    const userRef = ref(db, 'users/' + user.uid);
    const unsubscribe = onValue(userRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        setIsAdmin(data.role === 'Admin');
      } else {
        setIsAdmin(false);
      }
    });

    return () => unsubscribe();
  }, [user]);

  // DATASETS walin ena items walata ewage nijja dataset eka `dataset` kiyala attach karanawa.
  // Extra views (RE Doubt Group etc.) walata dataset nathi nisa fallback eka use wenawa.
  const allNavItems: Array<{
    id: string;
    label: string;
    title: string;
    icon: typeof LayoutDashboard;
    dataset?: (typeof DATASETS)[number];
  }> = [
    ...DATASETS.map((d) => ({
      id: d.id as string,
      label: (d as any).label as string,
      title: ((d as any).title ?? (d as any).label) as string,
      icon: ICONS[d.id] ?? LayoutDashboard,
      dataset: d,
    })),
    { id: 'reDoubtGroup', label: 'RE Doubt Group', title: 'RE Doubt Group', icon: AlertCircle },
    { id: 'planoDoubtGroup', label: 'Plano Doubt Group', title: 'Plano Doubt Group', icon: AlertTriangle },
    { id: 'denominatorSheet', label: 'Denominator Sheet', title: 'Denominator Sheet', icon: FileSpreadsheet },
    { id: 'staffRoster', label: 'Staff Roster', title: 'Staff Roster', icon: Calendar },
    { id: 'doNotWork', label: 'Do Not Work', title: 'Do Not Work', icon: UserX },
    { id: 'users', label: 'User Management', title: 'User Management', icon: Users },
  ];

  const navItems = allNavItems.filter((item) => item.id !== 'users' || isAdmin);

  return (
    <>
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-[var(--line)] bg-[#0a1020]/95 backdrop-blur-xl transition-transform duration-300 lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Header */}
        <div className="flex items-center gap-3 px-5 py-5">
          {/* මෙතන තමයි අලුත් Animated Logo එක දාලා තියෙන්නේ */}
          <div className="flex h-12 w-12 shrink-0 items-center justify-center">
            <AnimatedLogo className="h-10 w-10" />
          </div>
          
          <div>
            <div className="text-sm font-bold tracking-tight text-slate-100">Team Leader Dashboard</div>
          </div>
          <button className="btn btn-ghost ml-auto !p-1.5 lg:hidden" onClick={() => setSidebarOpen(false)}>
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {navItems.map((item) => {
            const isActive = active.id === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() =>
                  setActive(
                    // Hourly / Filtered / Outflow / Cancellation -> ewage nijja dataset eka
                    // Anith views -> pala fallback eka (id witharak wenas karala)
                    (item.dataset ?? { ...DATASETS[0], id: item.id }) as any,
                  )
                }
                className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-gradient-to-r from-teal-500/20 to-cyan-500/10 text-teal-200 shadow-inner'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                }`}
              >
                <Icon size={18} className={isActive ? 'text-teal-300' : 'text-slate-500 group-hover:text-slate-300'} />
                <span className="flex-1 text-left">{item.label}</span>
                {isActive && <span className="h-1.5 w-1.5 rounded-full bg-teal-400 pulse-dot" />}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-[var(--line)] px-3 py-3 space-y-1">
          {user && (
            <button 
              onClick={() => logout()} 
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-rose-400 transition-colors hover:bg-rose-500/10 hover:text-rose-300"
            >
              <LogOut size={16} className="shrink-0" />
              <div className="flex flex-col items-start text-left overflow-hidden">
                <span className="leading-tight">Sign Out</span>
                <span className="text-[10px] text-slate-500 truncate w-full">{user.email}</span>
              </div>
            </button>
          )}

          <div className="mt-2 px-3 text-[10px] text-slate-600">© Thevidu Samal</div>
        </div>
      </aside>
    </>
  );
}

export function MobileMenuButton() {
  const { setSidebarOpen } = useDashboard();
  return (
    <button className="btn btn-ghost !p-2 lg:hidden" onClick={() => setSidebarOpen(true)}>
      <Menu size={20} />
    </button>
  );
}