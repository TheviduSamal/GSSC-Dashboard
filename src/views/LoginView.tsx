import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Mail, Lock, Eye, EyeOff, ShieldCheck } from 'lucide-react';

export function LoginView() {
  const { login, resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError('');
    setSuccess('');

    if (!email || !password) {
      setError('Please enter both email and password.');
      return;
    }

    setLoading(true);
    try {
      await login(email, password, remember);
      // Successfully logged in, AuthContext will handle redirect
    } catch (err: any) {
      let msg = 'Login failed: ';
      switch (err.code) {
        case 'auth/user-not-found': msg += 'No account found with this email.'; break;
        case 'auth/wrong-password': msg += 'Incorrect password.'; break;
        case 'auth/invalid-email': msg += 'Invalid email format.'; break;
        case 'auth/invalid-credential': msg += 'Invalid email or password.'; break;
        default: msg += err.message;
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    setError('');
    setSuccess('');
    const targetEmail = email || prompt('Please enter your email address:');
    if (!targetEmail) {
      setError('Please enter an email address to reset your password.');
      return;
    }
    try {
      await resetPassword(targetEmail);
      setSuccess('Password reset link sent! Check your inbox.');
    } catch (err: any) {
      setError('Error: ' + err.message);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#0a1020] via-[#0f172a] to-[#1e293b] p-4 relative overflow-hidden">
      
      {/* Background Glow Effects */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-teal-500/10 blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-blue-500/10 blur-[120px] pointer-events-none"></div>

      <div className="w-full max-w-[420px] overflow-hidden rounded-2xl bg-white shadow-[0_0_50px_rgba(0,0,0,0.5)] z-10 border border-slate-700/50">
        
        {/* Header */}
        <div className="bg-[#4a6bfc] p-8 text-center relative">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm">
            <ShieldCheck size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Welcome Back</h1>
          <p className="text-sm text-blue-100 mt-1">Sign in to continue to QAT Dashboard</p>
        </div>

        <div className="p-8">
          {error && (
            <div className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-center text-sm font-medium text-red-600">
              {error}
            </div>
          )}
          {success && (
            <div className="mb-5 rounded-lg border border-green-200 bg-green-50 p-3 text-center text-sm font-medium text-green-600">
              {success}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            {/* Email Input */}
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-gray-700">Email Address</label>
              <div className="relative">
                <Mail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  className="w-full rounded-xl border-2 border-gray-200 bg-slate-50 py-3 pl-10 pr-4 text-gray-900 placeholder-gray-400 transition-all focus:border-[#4a6bfc] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#4a6bfc]/10"
                  required
                />
              </div>
            </div>

            {/* Password Input */}
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-gray-700">Password</label>
              <div className="relative">
                <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full rounded-xl border-2 border-gray-200 bg-slate-50 py-3 pl-10 pr-12 text-gray-900 placeholder-gray-400 transition-all focus:border-[#4a6bfc] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#4a6bfc]/10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Remember & Forgot Password */}
            <div className="flex items-center justify-between pt-1">
              <label className="flex cursor-pointer items-center text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="mr-2 h-4 w-4 rounded border-gray-300 text-[#4a6bfc] focus:ring-[#4a6bfc]"
                />
                Remember Me
              </label>
              <button
                type="button"
                onClick={handleReset}
                className="text-sm font-semibold text-[#4a6bfc] hover:underline"
              >
                Forgot Password?
              </button>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="mt-2 w-full rounded-xl bg-[#4a6bfc] py-3.5 text-base font-bold text-white shadow-lg shadow-[#4a6bfc]/30 transition-all hover:bg-[#3a5be0] hover:-translate-y-0.5 disabled:opacity-70 disabled:hover:translate-y-0"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          {/* Footer */}
          <div className="mt-8 text-center text-sm text-gray-400 border-t border-gray-100 pt-5">
            Need an account? <span className="font-semibold text-gray-600">Contact administrator</span>
          </div>
        </div>
      </div>
    </div>
  );
}