import { useState, useEffect } from 'react';
import { db, auth, firebaseConfig } from '@/lib/firebase';
import { ref, onValue, set, remove, update } from 'firebase/database'; 
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { Users, UserPlus, Trash2, User as UserIcon, Search, X, Eye, EyeOff, ShieldAlert, ShieldCheck, UserCheck, Crown, Pencil, Save, Check } from 'lucide-react';

const ROLES = [
  { value: 'Admin', label: 'Admin', color: 'bg-rose-500/10 text-rose-300', icon: Crown },
  { value: 'Supervisor', label: 'Supervisor', color: 'bg-amber-500/10 text-amber-300', icon: ShieldAlert },
  { value: 'Shift supervisor', label: 'Shift supervisor', color: 'bg-emerald-500/10 text-emerald-300', icon: ShieldCheck },
  { value: 'Regional supervisor', label: 'Regional supervisor', color: 'bg-cyan-500/10 text-cyan-300', icon: UserCheck },
  { value: 'Team Leader', label: 'Team Leader', color: 'bg-blue-500/10 text-blue-300', icon: UserIcon },
] as const;

type RoleType = typeof ROLES[number]['value'];

const REGIONAL_ROLE: RoleType = 'Regional supervisor';
const REGIONS = ['AMERICAS', 'APAC', 'EMEA', 'PLANO'] as const;

type AppUser = {
  uid: string;
  email: string;
  name: string;
  role: RoleType;
  regions?: string[];
  createdAt?: number;
};

// Firebase may hand back an array or an index-keyed object
const normRegions = (v: unknown): string[] => {
  if (!v) return [];
  const list = Array.isArray(v) ? v : typeof v === 'object' ? Object.values(v as object) : [];
  return list.map((x) => String(x)).filter((x) => (REGIONS as readonly string[]).includes(x));
};

const withTimeout = <T,>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(errorMsg)), ms))
  ]);
};

function RegionPicker({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const toggle = (r: string) => onChange(value.includes(r) ? value.filter((x) => x !== r) : [...value, r]);
  const allOn = value.length === REGIONS.length;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="block text-xs font-medium text-slate-400">Regions</label>
        <button
          type="button"
          onClick={() => onChange(allOn ? [] : [...REGIONS])}
          className="text-[11px] font-medium text-teal-300 hover:text-teal-200"
        >
          {allOn ? 'Clear all' : 'Select all'}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {REGIONS.map((r) => {
          const on = value.includes(r);
          return (
            <button
              key={r}
              type="button"
              onClick={() => toggle(r)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-medium transition-colors ${
                on
                  ? 'border-cyan-400/60 bg-cyan-500/15 text-cyan-200'
                  : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
              }`}
            >
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-cyan-400 bg-cyan-500' : 'border-white/30'}`}>
                {on && <Check size={12} className="text-white" />}
              </span>
              {r}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-[11px] text-slate-500">{value.length} selected</p>
    </div>
  );
}

export function UserManagementView() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<RoleType>('Team Leader');
  const [newRegions, setNewRegions] = useState<string[]>([]);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<RoleType>('Team Leader');
  const [editRegions, setEditRegions] = useState<string[]>([]);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    const usersRef = ref(db, 'users');
    const unsubscribe = onValue(usersRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        const usersList = Object.keys(data).map(key => ({
          uid: key,
          ...data[key],
          regions: normRegions(data[key]?.regions),
        })) as AppUser[];
        
        usersList.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        setUsers(usersList);
      } else {
        setUsers([]);
      }
      setLoading(false);
    }, (error) => {
      console.error("Error fetching users:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail || !newPassword) return;

    if (newRole === REGIONAL_ROLE && newRegions.length === 0) {
      alert("Please select at least one region for a Regional supervisor.");
      return;
    }

    setIsSubmitting(true);
    let secondaryApp;
    try {
      const secondaryAppName = 'SecondaryApp_' + Date.now();
      secondaryApp = initializeApp(firebaseConfig, secondaryAppName);
      const secondaryAuth = getAuth(secondaryApp);

      const userCredential = await withTimeout(
        createUserWithEmailAndPassword(secondaryAuth, newEmail, newPassword),
        15000,
        "Firebase Auth request timed out."
      );
      
      const newUid = userCredential.user.uid;
      await signOut(secondaryAuth);

      const payload: Record<string, unknown> = {
        email: newEmail,
        name: newName || newEmail.split('@')[0],
        role: newRole,
        createdAt: Date.now()
      };
      if (newRole === REGIONAL_ROLE) payload.regions = newRegions;

      await withTimeout(
        set(ref(db, 'users/' + newUid), payload),
        15000,
        "Realtime Database write timed out."
      );

      setIsAddModalOpen(false);
      resetAddForm();
      alert("User created successfully!");
    } catch (err: any) {
      console.error("Error adding user:", err);
      if (err.code === 'auth/email-already-in-use') {
        alert("This email is already registered.");
      } else if (err.code === 'auth/weak-password') {
        alert("Password should be at least 6 characters.");
      } else {
        alert("Failed to create user:\n" + (err.message || JSON.stringify(err)));
      }
    } finally {
      if (secondaryApp) await deleteApp(secondaryApp);
      setIsSubmitting(false);
    }
  };

  const handleEditClick = (user: AppUser) => {
    setEditingUser(user);
    setEditName(user.name || '');
    setEditRole(user.role || 'Team Leader');
    setEditRegions(normRegions(user.regions));
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    if (editRole === REGIONAL_ROLE && editRegions.length === 0) {
      alert("Please select at least one region for a Regional supervisor.");
      return;
    }

    setIsUpdating(true);
    console.log("Updating user in Firebase:", editingUser.uid, editName, editRole, editRegions);
    
    try {
      // Firebase Realtime Database එකේ අදාළ user ගේ node එක update කරනවා
      const userRef = ref(db, 'users/' + editingUser.uid);
      await update(userRef, {
        name: editName,
        role: editRole,
        // null removes the field when the role is no longer Regional supervisor
        regions: editRole === REGIONAL_ROLE ? editRegions : null,
      });
      
      console.log("Update successful!");
      setEditingUser(null); // Modal එක වහනවා
    } catch (err: any) {
      console.error("Error updating user in Firebase:", err);
      alert("Failed to update user in Firebase:\n" + err.message);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDelete = async (uid: string) => {
    if (!window.confirm("Are you sure you want to delete this user profile?")) return;
    try {
      await remove(ref(db, 'users/' + uid));
    } catch (err) {
      console.error("Error deleting user:", err);
      alert("Failed to delete user.");
    }
  };

  const resetAddForm = () => {
    setNewEmail('');
    setNewName('');
    setNewPassword('');
    setNewRole('Team Leader');
    setNewRegions([]);
    setShowPassword(false);
  };

  const q = search.toLowerCase();
  const filteredUsers = users.filter(u => 
    u.email.toLowerCase().includes(q) || 
    u.name.toLowerCase().includes(q) ||
    (u.role && u.role.toLowerCase().includes(q)) ||
    (u.regions || []).some((r) => r.toLowerCase().includes(q))
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 lg:px-6 border-b border-[var(--line)] bg-[#0a1020]/50">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/20 text-teal-300">
            <Users size={20} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-100">User Management</h1>
            <p className="text-xs text-[var(--muted)]">Manage Auth & Realtime Database</p>
          </div>
        </div>
        
        <button 
          onClick={() => setIsAddModalOpen(true)}
          className="btn btn-primary !py-2 text-sm shadow-lg shadow-teal-500/20"
        >
          <UserPlus size={16} className="mr-2" />
          Add New User
        </button>
      </div>

      <div className="flex-1 overflow-auto px-4 py-6 lg:px-6">
        <div className="card overflow-hidden">
          <div className="flex items-center gap-3 border-b border-[var(--line)] p-4">
            <div className="relative max-w-sm flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Search by name, email, role or region..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input w-full !py-2 pl-9 text-sm"
              />
            </div>
            <span className="text-xs text-[var(--muted)]">{filteredUsers.length} users</span>
          </div>

          <table className="w-full text-left text-sm">
            <thead className="bg-white/[0.02] text-[11px] uppercase tracking-wide text-[var(--muted)]">
              <tr>
                <th className="px-6 py-3 font-semibold">User</th>
                <th className="px-6 py-3 font-semibold">Role</th>
                <th className="px-6 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={3} className="px-6 py-12 text-center text-[var(--muted)]">Loading users...</td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-6 py-12 text-center text-[var(--muted)]">
                    No users found.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const roleConfig = ROLES.find(r => r.value === u.role) || ROLES[4];
                  const RoleIcon = roleConfig.icon;
                  const userRegions = u.role === REGIONAL_ROLE ? normRegions(u.regions) : [];

                  return (
                    <tr key={u.uid} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-slate-300 font-bold">
                            {u.name?.charAt(0).toUpperCase() || '?'}
                          </div>
                          <div>
                            <div className="font-semibold text-slate-200">{u.name}</div>
                            <div className="text-xs text-[var(--muted)]">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${roleConfig.color}`}>
                          <RoleIcon size={12} />
                          {u.role || 'Team Leader'}
                        </span>
                        {u.role === REGIONAL_ROLE && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {userRegions.length === 0 ? (
                              <span className="text-[11px] text-amber-300/80">No region assigned</span>
                            ) : (
                              userRegions.map((r) => (
                                <span key={r} className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">
                                  {r}
                                </span>
                              ))
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button 
                            onClick={() => handleEditClick(u)}
                            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-teal-500/10 hover:text-teal-400"
                            title="Edit User"
                          >
                            <Pencil size={16} />
                          </button>
                          <button 
                            onClick={() => handleDelete(u.uid)}
                            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-rose-500/10 hover:text-rose-400"
                            title="Delete User"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ADD USER MODAL */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-[#0f172a] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--line)] px-6 py-4">
              <h2 className="text-lg font-bold text-slate-100">Create New Account</h2>
              <button onClick={() => { setIsAddModalOpen(false); resetAddForm(); }} className="text-slate-500 hover:text-slate-300">
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleAddUser} className="p-6 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">Email Address</label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="input w-full text-sm"
                  placeholder="user@example.com"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="input w-full text-sm pr-10"
                    placeholder="Min 6 characters"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">Full Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="input w-full text-sm"
                  placeholder="John Doe"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">Role</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as RoleType)}
                  className="input w-full text-sm"
                >
                  {ROLES.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>

              {newRole === REGIONAL_ROLE && (
                <RegionPicker value={newRegions} onChange={setNewRegions} />
              )}

              <div className="mt-6 flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setIsAddModalOpen(false); resetAddForm(); }}
                  className="btn btn-ghost text-sm"
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary text-sm"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Creating...' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT USER MODAL */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-[#0f172a] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--line)] px-6 py-4">
              <h2 className="text-lg font-bold text-slate-100">Edit User Details</h2>
              <button onClick={() => setEditingUser(null)} className="text-slate-500 hover:text-slate-300">
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleUpdateUser} className="p-6 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">Email (Cannot be changed)</label>
                <input
                  type="email"
                  disabled
                  value={editingUser.email}
                  className="input w-full text-sm opacity-50 cursor-not-allowed"
                />
              </div>
              
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">Full Name</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="input w-full text-sm"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">Role</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as RoleType)}
                  className="input w-full text-sm"
                >
                  {ROLES.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>

              {editRole === REGIONAL_ROLE && (
                <RegionPicker value={editRegions} onChange={setEditRegions} />
              )}

              <div className="mt-6 flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="btn btn-ghost text-sm"
                  disabled={isUpdating}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary text-sm flex items-center gap-2"
                  disabled={isUpdating}
                >
                  {isUpdating ? 'Saving...' : <><Save size={16} /> Save Changes</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}