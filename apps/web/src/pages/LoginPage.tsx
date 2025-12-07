import axios from 'axios';
import { FormEvent, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useAuth } from '../contexts/AuthContext';

export function LoginPage() {
  const { login, loading, user } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: Location })?.from?.pathname ?? '/admin';

  // ログイン成功後、認証済みユーザーが利用可能になったら遷移
  useEffect(() => {
    if (!loading && user) {
      navigate(from, { replace: true });
    }
  }, [loading, user, navigate, from]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await login(username, password);
    } catch (err) {
      // axiosエラーの場合、response.data.messageを優先的に使用
      let errorMessage = 'ログインに失敗しました';
      if (axios.isAxiosError(err) && err.response?.data?.message) {
        errorMessage = err.response.data.message;
      } else if (err instanceof Error) {
        errorMessage = err.message;
      }
      setError(errorMessage);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md space-y-4 rounded-2xl border border-white/10 bg-white/5 p-8 shadow-xl"
      >
        <div>
          <p className="text-sm uppercase tracking-wide text-emerald-300">Factory Borrow System</p>
          <h1 className="text-2xl font-bold">管理者ログイン</h1>
        </div>
        <label className="block">
          <span className="text-sm text-white/70">ユーザー名</span>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
        </label>
        <label className="block">
          <span className="text-sm text-white/70">パスワード</span>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error ? (
          <p className="text-sm text-red-400" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? '送信中...' : 'ログイン'}
        </Button>
      </form>
    </div>
  );
}
