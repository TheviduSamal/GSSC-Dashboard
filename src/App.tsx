import { useState, useEffect } from 'react';
import { Sidebar, MobileMenuButton } from '@/components/Sidebar';
import { GidModal } from '@/components/GidModal';
import { HourlyView } from '@/views/HourlyView';
import { ProjectTaskView } from '@/views/ProjectTaskView';
import { OutflowView } from '@/views/OutflowView';
import { CancellationView } from '@/views/CancellationView';
import { ApiRequestView } from '@/views/ApiRequestView';
import { UserManagementView } from '@/views/UserManagementView';
import { LoginView } from '@/views/LoginView';

// අලුත් views ටික import කරන විදිහ වෙනස් කළා (Auto-detect)
import * as REDoubtGroupModule from '@/views/REDoubtGroup';
import * as PlanoDoubtGroupModule from '@/views/PlanoDoubtGroup';
import * as DenominatorSheetModule from '@/views/DenominatorSheet';
import * as StaffRosterModule from '@/views/StaffRoster';
import * as DoNotWorkModule from '@/views/DoNotWork';

const REDoubtGroup = (REDoubtGroupModule as any).REDoubtGroup || (REDoubtGroupModule as any).default || (() => <div className="p-10 text-white">REDoubtGroup Component Not Found</div>);
const PlanoDoubtGroup = (PlanoDoubtGroupModule as any).PlanoDoubtGroup || (PlanoDoubtGroupModule as any).default || (() => <div className="p-10 text-white">PlanoDoubtGroup Component Not Found</div>);
const DenominatorSheet = (DenominatorSheetModule as any).DenominatorSheet || (DenominatorSheetModule as any).default || (() => <div className="p-10 text-white">DenominatorSheet Component Not Found</div>);
const StaffRoster = (StaffRosterModule as any).StaffRoster || (StaffRosterModule as any).default || (() => <div className="p-10 text-white">StaffRoster Component Not Found</div>);
const DoNotWork = (DoNotWorkModule as any).DoNotWork || (DoNotWorkModule as any).default || (() => <div className="p-10 text-white">DoNotWork Component Not Found</div>);

import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { useDashboard } from '@/hooks/useDashboardData';
import { db } from '@/lib/firebase';
import { ref, onValue } from 'firebase/database';

function DashboardContent() {
  const { user } = useAuth();
  const { active } = useDashboard();
  const id = (active as any).id as string;

  const [isAdmin, setIsAdmin] = useState(false);
  const [isCheckingRole, setIsCheckingRole] = useState(true);

  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      setIsCheckingRole(false);
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
      setIsCheckingRole(false);
    });

    return () => unsubscribe();
  }, [user]);

  if (!user) {
    return <LoginView />;
  }

  if (isCheckingRole) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0a1020] text-teal-400">
        <div className="animate-pulse">Loading Dashboard...</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <div className="flex items-center gap-2 px-3 py-2 lg:hidden">
          <MobileMenuButton />
          <span className="text-sm font-semibold text-slate-200">QAT Dashboard</span>
        </div>
        <main className="min-w-0 flex-1 overflow-hidden">
          <div key={id} className="h-full animate-fade">
            {/* පරණ Views */}
            {id === 'hourly' && <HourlyView />}
            {id === 'filtered' && <ProjectTaskView />}
            {id === 'outflow' && <OutflowView />}
            {id === 'cancellation' && <CancellationView />}
            {id === 'api' && <ApiRequestView />}
            
            {/* අලුත් Views */}
            {id === 'reDoubtGroup' && <REDoubtGroup />}
            {id === 'planoDoubtGroup' && <PlanoDoubtGroup />}
            {id === 'denominatorSheet' && <DenominatorSheet />}
            {id === 'staffRoster' && <StaffRoster />}
            {id === 'doNotWork' && <DoNotWork />}

            {/* Admin Only View */}
            {id === 'users' && isAdmin && <UserManagementView />}
            {id === 'users' && !isAdmin && (
              <div className="flex h-full items-center justify-center text-rose-400">
                Access Denied. Admin privileges required.
              </div>
            )}
          </div>
        </main>
      </div>
      <GidModal />
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <DashboardContent />
    </AuthProvider>
  );
}

export default App;