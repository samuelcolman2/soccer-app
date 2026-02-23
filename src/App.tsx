import * as React from 'react';
import { Users, Trophy, RefreshCw, Trash2, UserCircle, Mail, Lock, Eye, EyeOff, ChevronRight, Play, Timer, MoreVertical, AlertTriangle, ShieldAlert, Goal, Check, Clock, ArrowLeft, Settings, LogOut, Shield, User as UserIcon, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { ref, onValue, set, remove, get, update, push } from 'firebase/database';
import { doc, getDoc } from 'firebase/firestore';
import { db, firestore } from './firebase';
import { ProfileModal } from './components/ProfileModal';
import { TeamCard } from './components/TeamCard';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  photoUrl?: string;
  position?: string;
}

interface TeamAssignment {
  player_id: string;
  team_number: number;
}

type AuthMode = 'login' | 'register-step-1' | 'register-step-2';

interface MatchEvent {
  id: string;
  type: 'goal' | 'yellow' | 'red';
  playerId: string;
  playerName: string;
  teamNumber: number;
  timestamp: number;
  minute: number;
}

interface MatchState {
  id: string;
  status: 'idle' | 'countdown' | 'active' | 'finished';
  duration: number; // in minutes
  halves: number;
  currentHalf: number;
  startTime: number | null;
  endTime?: number;
  score: { team1: number; team2: number };
  events: MatchEvent[];
  team1Ids: string[];
  team2Ids: string[];
}

type ViewMode = 'home' | 'history';

export default function App() {
  const [user, setUser] = React.useState<User | null>(null);
  const [allUsers, setAllUsers] = React.useState<User[]>([]);
  const [selectedUserIds, setSelectedUserIds] = React.useState<string[]>([]);
  const [teams, setTeams] = React.useState<TeamAssignment[]>([]);
  const [match, setMatch] = React.useState<MatchState | null>(null);
  const [history, setHistory] = React.useState<MatchState[]>([]);
  const [viewMode, setViewMode] = React.useState<ViewMode>('home');
  const [isConnecting, setIsConnecting] = React.useState(false);
  const [authMode, setAuthMode] = React.useState<AuthMode>('login');
  const [error, setError] = React.useState<string | null>(null);
  const [isProfileModalOpen, setIsProfileModalOpen] = React.useState(false);
  const [isAdminPanelOpen, setIsAdminPanelOpen] = React.useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const [isMatchConfigOpen, setIsMatchConfigOpen] = React.useState(false);
  const [showImbalanceConfirm, setShowImbalanceConfirm] = React.useState(false);
  const [countdown, setCountdown] = React.useState<number | null>(null);
  const [isActionModalOpen, setIsActionModalOpen] = React.useState(false);
  const [selectedPlayerForAction, setSelectedPlayerForAction] = React.useState<{id: string, name: string, team: number} | null>(null);
  const [selectedHistoryMatch, setSelectedHistoryMatch] = React.useState<MatchState | null>(null);

  // Form states
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [fullName, setFullName] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);

  // Load user from localStorage and fetch photo from Firestore
  React.useEffect(() => {
    const loadUser = async () => {
      const savedUser = localStorage.getItem('soccer_user');
      if (savedUser) {
        const parsedUser = JSON.parse(savedUser);
        try {
          const docRef = doc(firestore, 'users', parsedUser.id);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            parsedUser.photoUrl = docSnap.data().photoBase64;
          }
        } catch (err) {
          console.error("Error fetching photo:", err);
        }
        setUser(parsedUser);
      }
    };
    loadUser();
  }, []);

  // Firebase Realtime Sync
  React.useEffect(() => {
    if (!user) return;

    // Sync All Users
    const usersRef = ref(db, 'users');
    const unsubscribeUsers = onValue(usersRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const usersList = Object.entries(data).map(([id, val]: [string, any]) => ({
          id,
          name: val.name,
          email: val.email,
          role: val.role,
          position: val.position
        }));
        setAllUsers(usersList);
      } else {
        setAllUsers([]);
      }
    });

    // Sync Teams
    const teamsRef = ref(db, 'teams');
    const unsubscribeTeams = onValue(teamsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const teamsList = Object.entries(data).map(([player_id, team_number]: [string, any]) => ({
          player_id,
          team_number
        }));
        setTeams(teamsList);
      } else {
        setTeams([]);
      }
    });

    // Sync Match
    const matchRef = ref(db, 'match');
    const unsubscribeMatch = onValue(matchRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setMatch(data);
      } else {
        setMatch(null);
      }
    });

    // Sync History
    const historyRef = ref(db, 'history');
    const unsubscribeHistory = onValue(historyRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const historyList = Object.values(data) as MatchState[];
        setHistory(historyList.sort((a, b) => (b.endTime || 0) - (a.endTime || 0)));
      } else {
        setHistory([]);
      }
    });

    return () => {
      unsubscribeUsers();
      unsubscribeTeams();
      unsubscribeMatch();
      unsubscribeHistory();
    };
  }, [user]);

  // Local countdown effect
  React.useEffect(() => {
    if (match?.status === 'countdown') {
      setCountdown(3);
      const timer = setInterval(() => {
        setCountdown(prev => {
          if (prev === null || prev <= 1) {
            clearInterval(timer);
            if (user?.role === 'admin') {
              startMatchTimer();
            }
            return null;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    } else {
      setCountdown(null);
    }
  }, [match?.status]);

  const startMatchTimer = async () => {
    if (user?.role !== 'admin') return;
    await update(ref(db, 'match'), {
      status: 'active',
      startTime: Date.now(),
      currentHalf: 1
    });
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsConnecting(true);

    try {
      const usersRef = ref(db, 'users');
      const snapshot = await get(usersRef);
      const usersData = snapshot.val();

      if (usersData) {
        const foundUser = Object.entries(usersData).find(
          ([_, u]: [string, any]) => u.email === email && u.password === password
        );

        if (foundUser) {
          const [id, u]: [string, any] = foundUser;
          let photoUrl = undefined;
          try {
            const docRef = doc(firestore, 'users', id);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
              photoUrl = docSnap.data().photoBase64;
            }
          } catch (e) {}

          const userData = { 
            id, 
            name: u.name, 
            email: u.email, 
            role: u.role, 
            photoUrl,
            position: u.position
          };
          localStorage.setItem('soccer_user', JSON.stringify(userData));
          setUser(userData);
        } else {
          setError('E-mail ou senha incorretos.');
        }
      } else {
        setError('Nenhum usuário cadastrado.');
      }
    } catch (err) {
      setError('Erro ao fazer login. Tente novamente.');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }

    setIsConnecting(true);
    try {
      const usersRef = ref(db, 'users');
      const snapshot = await get(usersRef);
      const usersData = snapshot.val();

      if (usersData && Object.values(usersData).some((u: any) => u.email === email)) {
        setError('Este e-mail já está em uso.');
        setIsConnecting(false);
        return;
      }

      const id = Math.random().toString(36).substring(2, 9);
      const userData = {
        name: fullName,
        email,
        password,
        role: 'user'
      };

      await set(ref(db, `users/${id}`), userData);
      
      const sessionUser = { id, name: fullName, email, role: 'user' };
      localStorage.setItem('soccer_user', JSON.stringify(sessionUser));
      setUser(sessionUser);
    } catch (err) {
      setError('Erro ao cadastrar. Tente novamente.');
    } finally {
      setIsConnecting(false);
    }
  };

  const drawTeams = async (force = false) => {
    if (user?.role !== 'admin') return;
    if (selectedUserIds.length < 2) {
      alert('Selecione pelo menos 2 jogadores para realizar o sorteio.');
      return;
    }

    if (!force && selectedUserIds.length % 2 !== 0) {
      setShowImbalanceConfirm(true);
      return;
    }

    setShowImbalanceConfirm(false);
    const shuffled = [...selectedUserIds];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const newTeams: Record<string, number> = {};
    
    shuffled.forEach((id, index) => {
      newTeams[id] = (index % 2) + 1;
    });

    await set(ref(db, 'teams'), newTeams);
    await remove(ref(db, 'match')); // Reset match when teams change
  };

  const clearTeams = async () => {
    if (user?.role !== 'admin') return;
    await remove(ref(db, 'teams'));
    await remove(ref(db, 'match'));
  };

  const startMatchConfig = () => {
    if (user?.role !== 'admin') return;
    setIsMatchConfigOpen(true);
  };

  const handleStartMatch = async (duration: number, halves: number) => {
    if (user?.role !== 'admin') return;
    const matchId = Math.random().toString(36).substring(2, 9);
    await set(ref(db, 'match'), {
      id: matchId,
      status: 'countdown',
      duration,
      halves,
      currentHalf: 1,
      startTime: null,
      score: { team1: 0, team2: 0 },
      events: [],
      team1Ids: allUsers.filter(u => teams.find(t => t.player_id === u.id && t.team_number === 1)).map(u => u.id),
      team2Ids: allUsers.filter(u => teams.find(t => t.player_id === u.id && t.team_number === 2)).map(u => u.id)
    });
    setIsMatchConfigOpen(false);
  };

  const recordEvent = async (type: 'goal' | 'yellow' | 'red', player: {id: string, name: string, team: number}) => {
    if (user?.role !== 'admin' || !match) return;
    
    const elapsedMs = Date.now() - (match.startTime || 0);
    const minute = Math.floor(elapsedMs / 60000) + 1;
    
    const newEvent: MatchEvent = {
      id: Math.random().toString(36).substring(2, 9),
      type,
      playerId: player.id,
      playerName: player.name,
      teamNumber: player.team,
      timestamp: Date.now(),
      minute
    };

    const updates: any = {
      [`match/events/${match.events?.length || 0}`]: newEvent
    };

    if (type === 'goal') {
      const teamKey = player.team === 1 ? 'team1' : 'team2';
      updates[`match/score/${teamKey}`] = (match.score[teamKey] || 0) + 1;
    }

    await update(ref(db), updates);
    setIsActionModalOpen(false);
  };

  const finishMatch = async () => {
    if (user?.role !== 'admin' || !match) return;
    const finishedMatch = { 
      ...match, 
      status: 'finished' as const,
      endTime: Date.now()
    };
    
    // Save to history
    const historyRef = push(ref(db, 'history'));
    await set(historyRef, finishedMatch);
    
    // Update current match status
    await update(ref(db, 'match'), { status: 'finished' });
  };

  const userStats = React.useMemo(() => {
    if (!user) return { matches: 0, goals: 0, yellowCards: 0, redCards: 0 };
    
    return history.reduce((acc, m) => {
      const played = m.team1Ids?.includes(user.id) || m.team2Ids?.includes(user.id);
      if (played) {
        acc.matches += 1;
        const userEvents = m.events?.filter(e => e.playerId === user.id) || [];
        userEvents.forEach(e => {
          if (e.type === 'goal') acc.goals += 1;
          if (e.type === 'yellow') acc.yellowCards += 1;
          if (e.type === 'red') acc.redCards += 1;
        });
      }
      return acc;
    }, { matches: 0, goals: 0, yellowCards: 0, redCards: 0 });
  }, [user, history]);

  const toggleUserSelection = (id: string) => {
    setSelectedUserIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleRole = async (targetUserId: string, currentRole: string) => {
    if (user?.role !== 'admin') return;
    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    await update(ref(db, `users/${targetUserId}`), { role: newRole });
  };

  const logout = async () => {
    localStorage.removeItem('soccer_user');
    setUser(null);
    setAuthMode('login');
    setEmail('');
    setPassword('');
    setFullName('');
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0C1222] flex items-center justify-center p-4 font-sans text-white">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md bg-[#121A29] rounded-2xl shadow-2xl p-8 border border-white/5"
        >
          <AnimatePresence mode="wait">
            {authMode === 'login' && (
              <motion.div
                key="login"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-6"
              >
                <div className="text-center space-y-2 mb-8">
                  <p className="text-gray-400">Acesse sua conta para continuar.</p>
                </div>

                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-500">
                      <Mail size={20} />
                    </div>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="E-mail"
                      className="w-full bg-[#1B2436] border border-white/10 rounded-xl py-3.5 pl-11 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all text-sm"
                      required
                    />
                  </div>

                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-500">
                      <Lock size={20} />
                    </div>
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Senha"
                      className="w-full bg-[#1B2436] border border-white/10 rounded-xl py-3.5 pl-11 pr-12 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all text-sm"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-500 hover:text-gray-300"
                    >
                      {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                  </div>

                  {error && <p className="text-red-400 text-xs text-center">{error}</p>}

                  <button
                    type="submit"
                    disabled={isConnecting}
                    className="w-full bg-[#0E46C7] hover:bg-blue-600 text-white font-bold py-3.5 rounded-xl transition-all shadow-lg shadow-blue-900/20 flex items-center justify-center gap-2"
                  >
                    {isConnecting ? <RefreshCw className="animate-spin" /> : "Entrar"}
                  </button>
                </form>

                <div className="text-center space-y-4 pt-4">
                  <p className="text-sm text-gray-400">
                    Não tem uma conta?{" "}
                    <button 
                      onClick={() => { setAuthMode('register-step-1'); setError(null); }}
                      className="text-blue-400 hover:underline font-medium"
                    >
                      Cadastre-se
                    </button>
                  </p>
                </div>
              </motion.div>
            )}

            {authMode === 'register-step-1' && (
              <motion.div
                key="reg1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="text-center space-y-2 mb-8">
                  <p className="text-gray-300 text-lg">Primeiro, insira seu nome completo.</p>
                </div>

                <form 
                  onSubmit={(e) => { e.preventDefault(); setAuthMode('register-step-2'); }}
                  className="space-y-6"
                >
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-500">
                      <UserCircle size={20} />
                    </div>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Nome Completo"
                      className="w-full bg-[#1B2436] border border-white/10 rounded-xl py-3.5 pl-11 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all text-sm"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full bg-[#0E46C7] hover:bg-blue-600 text-white font-bold py-3.5 rounded-xl transition-all shadow-lg shadow-blue-900/20 flex items-center justify-center gap-2"
                  >
                    Avançar
                  </button>
                </form>

                <div className="text-center pt-4">
                  <button 
                    onClick={() => setAuthMode('login')}
                    className="text-sm text-gray-400 hover:text-blue-400 transition-colors"
                  >
                    Já tem uma conta? <span className="text-blue-400 font-medium">Faça login</span>
                  </button>
                </div>
              </motion.div>
            )}

            {authMode === 'register-step-2' && (
              <motion.div
                key="reg2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="text-center space-y-2 mb-8">
                  <p className="text-gray-300">Agora, seu e-mail e uma senha segura.</p>
                </div>

                <form onSubmit={handleRegister} className="space-y-4">
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-500">
                      <Mail size={20} />
                    </div>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="E-mail"
                      className="w-full bg-[#1B2436] border border-white/10 rounded-xl py-3.5 pl-11 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all text-sm"
                      required
                    />
                  </div>

                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-500">
                      <Lock size={20} />
                    </div>
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Senha"
                      className="w-full bg-[#1B2436] border border-white/10 rounded-xl py-3.5 pl-11 pr-12 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all text-sm"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-500 hover:text-gray-300"
                    >
                      {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                  </div>

                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-500">
                      <Lock size={20} />
                    </div>
                    <input
                      type={showPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirmar Senha"
                      className="w-full bg-[#1B2436] border border-white/10 rounded-xl py-3.5 pl-11 pr-12 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all text-sm"
                      required
                    />
                  </div>

                  {error && <p className="text-red-400 text-xs text-center">{error}</p>}

                  <button
                    type="submit"
                    disabled={isConnecting}
                    className="w-full bg-[#0E46C7] hover:bg-blue-600 text-white font-bold py-3.5 rounded-xl transition-all shadow-lg shadow-blue-900/20 flex items-center justify-center gap-2"
                  >
                    {isConnecting ? <RefreshCw className="animate-spin" /> : "Cadastrar"}
                  </button>
                </form>

                <div className="text-center space-y-4 pt-2">
                  <button 
                    onClick={() => setAuthMode('register-step-1')}
                    className="text-sm text-blue-400 hover:underline font-medium block mx-auto"
                  >
                    Voltar
                  </button>
                  <button 
                    onClick={() => setAuthMode('login')}
                    className="text-sm text-gray-400 hover:text-blue-400 transition-colors"
                  >
                    Já tem uma conta? <span className="text-blue-400 font-medium">Faça login</span>
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    );
  }

  const team1 = allUsers.filter(u => teams.find(t => t.player_id === u.id && t.team_number === 1));
  const team2 = allUsers.filter(u => teams.find(t => t.player_id === u.id && t.team_number === 2));
  const unassigned = allUsers.filter(u => teams.length > 0 && !teams.find(t => t.player_id === u.id));

  const nextHalf = async () => {
    if (user?.role !== 'admin' || !match) return;
    await update(ref(db, 'match'), {
      currentHalf: match.currentHalf + 1,
      startTime: Date.now() // Reset timer for second half
    });
  };

  if (match && (match.status === 'active' || match.status === 'finished' || match.status === 'countdown')) {
    return (
      <MatchView 
        user={user}
        match={match}
        team1={team1}
        team2={team2}
        countdown={countdown}
        onRecordAction={(player) => {
          setSelectedPlayerForAction(player);
          setIsActionModalOpen(true);
        }}
        onNextHalf={nextHalf}
        onFinish={finishMatch}
        onExit={() => remove(ref(db, 'match'))}
        isActionModalOpen={isActionModalOpen}
        setIsActionModalOpen={setIsActionModalOpen}
        selectedPlayerForAction={selectedPlayerForAction}
        recordEvent={recordEvent}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#0C1222] font-sans text-white">
      {/* Header */}
      <header className="border-b border-white/5 bg-[#2D3748]/80 backdrop-blur-md p-4 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-3 group cursor-pointer" onClick={() => setViewMode('home')}>
              <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/40 group-hover:scale-110 transition-transform">
                <Trophy size={24} className="text-white" />
              </div>
              <div className="hidden sm:block">
                <span className="font-black uppercase tracking-tighter text-xl italic block leading-none">Sorteio FC</span>
                <span className="text-[10px] text-blue-500 font-black uppercase tracking-widest leading-none">Arena Digital</span>
              </div>
            </div>
            
            <nav className="hidden md:flex items-center gap-1 bg-black/20 p-1 rounded-2xl border border-white/5">
              <button 
                onClick={() => setViewMode('home')}
                className={cn(
                  "px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all italic",
                  viewMode === 'home' ? "bg-blue-600 text-white shadow-lg shadow-blue-900/20" : "text-gray-500 hover:text-white hover:bg-white/5"
                )}
              >
                Início
              </button>
              <button 
                onClick={() => setViewMode('history')}
                className={cn(
                  "px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all italic",
                  viewMode === 'history' ? "bg-blue-600 text-white shadow-lg shadow-blue-900/20" : "text-gray-500 hover:text-white hover:bg-white/5"
                )}
              >
                Histórico
              </button>
            </nav>
          </div>
          <div className="flex items-center gap-4 relative">
            <button 
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              className="p-2 bg-[#0C1222] border border-white/10 rounded-full hover:bg-white/5 transition-colors text-gray-400 hover:text-white"
            >
              <Settings size={20} />
            </button>

            <AnimatePresence>
              {isSettingsOpen && (
                <>
                  <div 
                    className="fixed inset-0 z-20" 
                    onClick={() => setIsSettingsOpen(false)} 
                  />
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute right-0 top-full mt-2 w-48 bg-[#121A29] border border-white/10 rounded-xl shadow-2xl z-30 overflow-hidden"
                  >
                    <div className="p-3 border-b border-white/5 bg-white/5 flex items-center gap-3">
                      <PlayerAvatar userId={user.id} name={user.name} className="w-8 h-8" />
                      <div className="overflow-hidden">
                        <p className="text-xs font-bold truncate">{user.name}</p>
                        <p className="text-[10px] text-gray-500 uppercase tracking-widest">{user.role}</p>
                      </div>
                    </div>
                    <div className="p-1">
                      <button 
                        onClick={() => {
                          setIsSettingsOpen(false);
                          setIsProfileModalOpen(true);
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-all"
                      >
                        <UserIcon size={16} /> Ver Perfil
                      </button>
                      {user.role === 'admin' && (
                        <button 
                          onClick={() => {
                            setIsSettingsOpen(false);
                            setIsAdminPanelOpen(true);
                          }}
                          className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-all"
                        >
                          <Shield size={16} /> Painel Admin
                        </button>
                      )}
                      <button 
                        onClick={logout}
                        className="w-full flex items-center gap-3 px-3 py-2 text-sm text-red-400 hover:bg-red-400/10 rounded-lg transition-all"
                      >
                        <LogOut size={16} /> Sair
                      </button>
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      {viewMode === 'history' ? (
        <HistoryView 
          history={history} 
          allUsers={allUsers}
          selectedMatch={selectedHistoryMatch}
          onSelectMatch={setSelectedHistoryMatch}
        />
      ) : (
        <main className="max-w-7xl mx-auto p-4 md:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Sidebar: User Selection (Admin Only) */}
        <div className="lg:col-span-4 space-y-6">
          <section className="bg-[#121A29] border border-white/10 shadow-2xl rounded-2xl overflow-hidden flex flex-col">
            <div className="p-5 border-b border-white/5 flex justify-between items-center bg-white/5">
              <div>
                <h2 className="font-black uppercase text-sm tracking-widest flex items-center gap-2 italic">
                  <Users size={18} className="text-blue-500" /> {user.role === 'admin' ? 'Convocação' : 'Jogadores'}
                </h2>
                <p className="text-[10px] text-gray-500 font-bold uppercase tracking-tighter mt-0.5">
                  {allUsers.length} Atletas Disponíveis
                </p>
              </div>
              {user.role === 'admin' && (
                <div className="bg-blue-600/20 text-blue-400 text-[10px] font-black px-2 py-1 rounded-lg border border-blue-500/20 italic">
                  {selectedUserIds.length} SEL.
                </div>
              )}
            </div>
            <div className="divide-y divide-white/5 max-h-[50vh] overflow-y-auto custom-scrollbar bg-gradient-to-b from-transparent to-black/20">
              {allUsers.map((u) => (
                <div 
                  key={u.id} 
                  className={cn(
                    "p-4 flex items-center justify-between transition-all group",
                    user.role === 'admin' ? "cursor-pointer hover:bg-white/5 active:scale-[0.98]" : ""
                  )}
                  onClick={() => user.role === 'admin' && toggleUserSelection(u.id)}
                >
                  <div className="flex items-center gap-3">
                    {user.role === 'admin' ? (
                      <div className={cn(
                        "w-6 h-6 border-2 rounded-lg flex items-center justify-center transition-all",
                        selectedUserIds.includes(u.id) 
                          ? "bg-blue-600 border-blue-600 shadow-lg shadow-blue-900/40" 
                          : "border-white/10 group-hover:border-white/30"
                      )}>
                        {selectedUserIds.includes(u.id) && <ChevronRight size={14} className="text-white" />}
                      </div>
                    ) : (
                      <PlayerAvatar userId={u.id} name={u.name} className="w-8 h-8" />
                    )}
                    <div className="overflow-hidden">
                      <span className={cn("font-bold text-sm block truncate", u.id === user.id && "text-blue-400")}>
                        {u.name} {u.id === user.id && "(Você)"}
                      </span>
                      {u.position && (
                        <span className="block text-[10px] text-gray-500 font-black uppercase tracking-tighter leading-none mt-0.5">
                          {u.position}
                        </span>
                      )}
                    </div>
                  </div>
                  {teams.find(t => t.player_id === u.id) && (
                    <div className="flex items-center gap-1.5">
                      <div className={cn(
                        "w-2 h-2 rounded-full animate-pulse",
                        teams.find(t => t.player_id === u.id)?.team_number === 1 ? "bg-blue-500" : "bg-red-500"
                      )} />
                      <span className="text-[10px] font-black italic uppercase text-gray-400">
                        T{teams.find(t => t.player_id === u.id)?.team_number}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {user.role === 'admin' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => drawTeams()}
                  disabled={selectedUserIds.length < 2}
                  className="bg-[#0E46C7] hover:bg-blue-600 text-white p-4 font-black uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 rounded-2xl shadow-xl shadow-blue-900/20 group italic text-xs"
                >
                  <RefreshCw size={18} className="group-hover:rotate-180 transition-transform duration-500" /> 
                  Sortear
                </button>
                <button
                  onClick={clearTeams}
                  className="bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white p-4 font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 rounded-2xl border border-white/5 italic text-xs"
                >
                  <Trash2 size={16} /> Limpar
                </button>
              </div>
              
              {teams.length > 0 && (
                <button
                  onClick={startMatchConfig}
                  className="w-full bg-green-600 hover:bg-green-500 text-white p-4 font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 rounded-2xl shadow-xl shadow-green-900/20 italic"
                >
                  <Play size={20} /> Iniciar Partida
                </button>
              )}
            </div>
          )}
        </div>

        {/* Main: Teams Grid */}
        <div className="lg:col-span-8 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Team 1 */}
            <TeamCard 
              number={1} 
              players={team1} 
              color="bg-blue-600" 
              accent="border-blue-600/50"
            />
            
            {/* Team 2 */}
            <TeamCard 
              number={2} 
              players={team2} 
              color="bg-red-600" 
              accent="border-red-600/50"
            />
          </div>

          {/* Unassigned Players */}
          {unassigned.length > 0 && (
            <section className="bg-[#121A29] border border-white/10 p-6 rounded-2xl shadow-xl">
              <h3 className="text-[10px] font-black uppercase tracking-widest mb-4 text-gray-500 italic">Reserva / Não Sorteados</h3>
              <div className="flex flex-wrap gap-2">
                {unassigned.map(p => (
                  <div key={p.id} className="bg-white/5 border border-white/10 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 hover:bg-white/10 transition-colors">
                    <div className="w-1.5 h-1.5 rounded-full bg-gray-600" />
                    {p.name}
                  </div>
                ))}
              </div>
            </section>
          )}

          {teams.length === 0 && (
            <div className="hidden" />
          )}
        </div>
      </main>
    )}

      <ProfileModal 
        isOpen={isProfileModalOpen} 
        onClose={() => setIsProfileModalOpen(false)} 
        user={user} 
        onUpdate={(updatedUser) => {
          setUser(updatedUser);
          localStorage.setItem('soccer_user', JSON.stringify(updatedUser));
        }}
        stats={userStats}
      />

      <MatchConfigModal 
        isOpen={isMatchConfigOpen}
        onClose={() => setIsMatchConfigOpen(false)}
        onStart={handleStartMatch}
      />

      <AdminPanelModal 
        isOpen={isAdminPanelOpen}
        onClose={() => setIsAdminPanelOpen(false)}
        users={allUsers}
        currentUser={user}
        onToggleRole={toggleRole}
      />

      <ImbalanceConfirmModal 
        isOpen={showImbalanceConfirm}
        onClose={() => setShowImbalanceConfirm(false)}
        onConfirm={() => drawTeams(true)}
        count={selectedUserIds.length}
      />
    </div>
  );
}

function ImbalanceConfirmModal({ isOpen, onClose, onConfirm, count }: { 
  isOpen: boolean, 
  onClose: () => void, 
  onConfirm: () => void,
  count: number 
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-sm bg-[#121A29] rounded-2xl p-8 border border-white/10 shadow-2xl text-center"
      >
        <div className="w-16 h-16 bg-yellow-500/20 text-yellow-500 rounded-full flex items-center justify-center mx-auto mb-4">
          <Users size={32} />
        </div>
        <h2 className="text-xl font-bold mb-2">Times Ímpares</h2>
        <p className="text-gray-400 text-sm mb-6">
          Você selecionou <strong>{count}</strong> jogadores. Um dos times ficará com um jogador a menos. Deseja continuar mesmo assim?
        </p>
        
        <div className="flex gap-3">
          <button 
            onClick={onClose} 
            className="flex-1 py-3 rounded-xl bg-white/5 hover:bg-white/10 font-bold transition-colors"
          >
            Voltar
          </button>
          <button 
            onClick={onConfirm} 
            className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 font-bold transition-colors"
          >
            Sortear
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function AdminPanelModal({ isOpen, onClose, users, currentUser, onToggleRole }: { 
  isOpen: boolean, 
  onClose: () => void, 
  users: User[], 
  currentUser: User,
  onToggleRole: (id: string, role: string) => void 
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-2xl bg-[#121A29] rounded-2xl border border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="p-6 border-b border-white/5 flex justify-between items-center bg-white/5 shrink-0">
          <h2 className="text-xl font-bold flex items-center gap-3">
            <Shield className="text-blue-500" /> Painel de Controle
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="p-4 md:p-6 overflow-y-auto custom-scrollbar">
          <div className="bg-[#0C1222] rounded-xl border border-white/5 overflow-x-auto custom-scrollbar">
            <table className="w-full text-left min-w-[500px]">
              <thead>
                <tr className="bg-white/5 text-[10px] uppercase tracking-widest text-gray-500">
                  <th className="px-4 py-3 md:px-6 md:py-4 font-bold">Usuário</th>
                  <th className="px-4 py-3 md:px-6 md:py-4 font-bold">E-mail</th>
                  <th className="px-4 py-3 md:px-6 md:py-4 font-bold">Cargo</th>
                  <th className="px-4 py-3 md:px-6 md:py-4 font-bold text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3 md:px-6 md:py-4">
                      <div className="flex items-center gap-3">
                        <PlayerAvatar userId={u.id} name={u.name} className="w-8 h-8" />
                        <span className="text-sm font-bold whitespace-nowrap">{u.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 md:px-6 md:py-4 text-sm text-gray-400 whitespace-nowrap">{u.email}</td>
                    <td className="px-4 py-3 md:px-6 md:py-4">
                      <span className={cn(
                        "text-[10px] font-bold uppercase px-2 py-1 rounded-full",
                        u.role === 'admin' ? "bg-blue-600/20 text-blue-400" : "bg-gray-600/20 text-gray-400"
                      )}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 md:px-6 md:py-4 text-right">
                      {u.id !== currentUser.id && (
                        <button 
                          onClick={() => onToggleRole(u.id, u.role)}
                          className={cn(
                            "text-xs font-bold uppercase px-4 py-2 rounded-lg transition-all whitespace-nowrap",
                            u.role === 'admin' ? "text-red-400 hover:bg-red-400/10" : "text-blue-400 hover:bg-blue-400/10"
                          )}
                        >
                          {u.role === 'admin' ? "Remover Admin" : "Tornar Admin"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function MatchConfigModal({ isOpen, onClose, onStart }: { isOpen: boolean, onClose: () => void, onStart: (d: number, h: number) => void }) {
  const [duration, setDuration] = React.useState(10);
  const [halves, setHalves] = React.useState(1);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-sm bg-[#121A29] rounded-2xl p-8 border border-white/10 shadow-2xl"
      >
        <h2 className="text-xl font-bold mb-6 text-center">Configurar Partida</h2>
        
        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase text-gray-500">Duração Total (minutos)</label>
            <input 
              type="number" 
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="w-full bg-[#1B2436] border border-white/10 rounded-xl py-3 px-4 focus:ring-2 focus:ring-blue-500/50 outline-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase text-gray-500">Divisão</label>
            <div className="grid grid-cols-2 gap-2">
              <button 
                onClick={() => setHalves(1)}
                className={cn("py-2 rounded-lg border transition-all", halves === 1 ? "bg-blue-600 border-blue-600" : "border-white/10 hover:bg-white/5")}
              >
                Tempo Único
              </button>
              <button 
                onClick={() => setHalves(2)}
                className={cn("py-2 rounded-lg border transition-all", halves === 2 ? "bg-blue-600 border-blue-600" : "border-white/10 hover:bg-white/5")}
              >
                2 Tempos
              </button>
            </div>
            <p className="text-[10px] text-gray-500 italic text-center">
              {halves === 2 ? `${duration/2} min cada tempo` : `${duration} min tempo único`}
            </p>
          </div>

          <div className="flex gap-3 pt-4">
            <button onClick={onClose} className="flex-1 py-3 rounded-xl bg-white/5 hover:bg-white/10 font-bold">Cancelar</button>
            <button onClick={() => onStart(duration, halves)} className="flex-1 py-3 rounded-xl bg-green-600 hover:bg-green-500 font-bold">Começar</button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function MatchView({ user, match, team1, team2, countdown, onRecordAction, onNextHalf, onFinish, onExit, isActionModalOpen, setIsActionModalOpen, selectedPlayerForAction, recordEvent }: { 
  user: User, 
  match: MatchState, 
  team1: User[], 
  team2: User[], 
  countdown: number | null,
  onRecordAction: (p: {id: string, name: string, team: number}) => void,
  onNextHalf: () => void,
  onFinish: () => void,
  onExit: () => void,
  isActionModalOpen: boolean,
  setIsActionModalOpen: (open: boolean) => void,
  selectedPlayerForAction: {id: string, name: string, team: number} | null,
  recordEvent: (type: 'goal' | 'yellow' | 'red', p: {id: string, name: string, team: number}) => void
}) {
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    if (match.status === 'active' && match.startTime) {
      const interval = setInterval(() => {
        const seconds = Math.floor((Date.now() - match.startTime!) / 1000);
        setElapsed(seconds);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [match.status, match.startTime]);

  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-[#0C1222] text-white p-4 md:p-8">
      {countdown !== null && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md">
          <motion.div 
            key={countdown}
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="text-9xl font-black italic text-blue-500"
          >
            {countdown}
          </motion.div>
        </div>
      )}

      <div className="max-w-6xl mx-auto space-y-8">
        {/* Scoreboard */}
        <div className="bg-[#121A29] rounded-[2rem] p-10 border border-white/10 shadow-2xl flex flex-col items-center gap-8 relative overflow-hidden">
          <div className="flex items-center justify-between w-full max-w-3xl relative z-10">
            <div className="text-center flex-1 group">
              <div className="w-20 h-20 bg-blue-600 rounded-3xl mx-auto mb-4 flex items-center justify-center shadow-2xl shadow-blue-900/60 group-hover:scale-105 transition-transform border border-white/10">
                <Trophy size={40} />
              </div>
              <h3 className="font-black uppercase tracking-[0.2em] text-xs text-blue-400 italic">Time Alfa</h3>
            </div>
            
            <div className="flex flex-col items-center gap-2 px-4">
              <div className="flex items-center gap-8">
                <span className="text-8xl font-black italic tracking-tighter text-white drop-shadow-2xl">{match.score.team1}</span>
                <div className="flex flex-col items-center">
                  <span className="text-xl text-gray-700 font-black italic">VS</span>
                  <div className="w-px h-8 bg-gradient-to-b from-transparent via-gray-800 to-transparent" />
                </div>
                <span className="text-8xl font-black italic tracking-tighter text-white drop-shadow-2xl">{match.score.team2}</span>
              </div>
            </div>

            <div className="text-center flex-1 group">
              <div className="w-20 h-20 bg-red-600 rounded-3xl mx-auto mb-4 flex items-center justify-center shadow-2xl shadow-red-900/60 group-hover:scale-105 transition-transform border border-white/10">
                <Trophy size={40} />
              </div>
              <h3 className="font-black uppercase tracking-[0.2em] text-xs text-red-400 italic">Time Beta</h3>
            </div>
          </div>

          <div className="flex flex-col items-center gap-4 relative z-10">
            <div className="flex items-center gap-4 bg-black/40 backdrop-blur-xl px-8 py-4 rounded-2xl border border-white/5 shadow-inner">
              <Clock size={24} className="text-blue-500 animate-pulse" />
              <span className="text-4xl font-mono font-black tracking-tighter text-white">
                {formatTime(elapsed)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-500 italic">
                {match.status === 'finished' ? 'Fim de Jogo' : `Tempo ${match.currentHalf} / ${match.halves}`}
              </span>
            </div>
          </div>

          {user.role === 'admin' && match.status === 'active' && (
            <div className="flex gap-4 mt-4">
              {match.halves > 1 && match.currentHalf < match.halves && (
                <button 
                  onClick={onNextHalf}
                  className="px-8 py-3 bg-blue-600 text-white rounded-xl font-bold uppercase tracking-widest hover:bg-blue-500 transition-all"
                >
                  Próximo Tempo
                </button>
              )}
              <button 
                onClick={onFinish}
                className="px-8 py-3 bg-red-600/20 text-red-400 border border-red-600/30 rounded-xl font-bold uppercase tracking-widest hover:bg-red-600 hover:text-white transition-all"
              >
                Encerrar Partida
              </button>
            </div>
          )}

          {match.status === 'finished' && user.role === 'admin' && (
            <button 
              onClick={onExit}
              className="mt-4 px-8 py-3 bg-blue-600 text-white rounded-xl font-bold uppercase tracking-widest hover:bg-blue-500 transition-all"
            >
              Novo Sorteio
            </button>
          )}
        </div>

        {/* Players Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <TeamList 
            title="Time 1" 
            players={team1} 
            teamNumber={1} 
            isAdmin={user.role === 'admin'} 
            onAction={onRecordAction}
            events={match.events}
          />
          <TeamList 
            title="Time 2" 
            players={team2} 
            teamNumber={2} 
            isAdmin={user.role === 'admin'} 
            onAction={onRecordAction}
            events={match.events}
          />
        </div>

        {/* Event Log */}
        {match.events && match.events.length > 0 && (
          <div className="bg-[#121A29] rounded-2xl p-6 border border-white/10">
            <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-4">Relatório da Partida</h3>
            <div className="space-y-3">
              {match.events.map((e, i) => (
                <div key={e.id} className="flex items-center gap-4 text-sm border-b border-white/5 pb-2 last:border-0">
                  <span className="font-mono text-gray-500">{e.minute}'</span>
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center",
                    e.type === 'goal' ? "bg-green-600/20 text-green-400" :
                    e.type === 'yellow' ? "bg-yellow-600/20 text-yellow-400" : "bg-red-600/20 text-red-400"
                  )}>
                    {e.type === 'goal' ? <Goal size={16} /> : e.type === 'yellow' ? <AlertTriangle size={16} /> : <ShieldAlert size={16} />}
                  </div>
                  <span className="font-bold">{e.playerName}</span>
                  <span className="text-gray-500">
                    {e.type === 'goal' ? 'marcou um gol!' : e.type === 'yellow' ? 'recebeu cartão amarelo' : 'recebeu cartão vermelho'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <ActionModal 
        isOpen={isActionModalOpen}
        onClose={() => setIsActionModalOpen(false)}
        player={selectedPlayerForAction}
        onAction={recordEvent}
      />
    </div>
  );
}

function HistoryView({ history, allUsers, selectedMatch, onSelectMatch }: { 
  history: MatchState[], 
  allUsers: User[],
  selectedMatch: MatchState | null,
  onSelectMatch: (m: MatchState | null) => void
}) {
  if (selectedMatch) {
    const team1 = allUsers.filter(u => selectedMatch.team1Ids?.includes(u.id));
    const team2 = allUsers.filter(u => selectedMatch.team2Ids?.includes(u.id));

    return (
      <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-6">
        <button 
          onClick={() => onSelectMatch(null)}
          className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-4"
        >
          <ArrowLeft size={20} /> Voltar para a lista
        </button>

        <div className="bg-[#121A29] rounded-3xl p-8 border border-white/10 shadow-2xl flex flex-col items-center gap-6">
          <div className="flex items-center justify-between w-full max-w-2xl">
            <div className="text-center flex-1">
              <div className="w-16 h-16 bg-blue-600 rounded-2xl mx-auto mb-2 flex items-center justify-center shadow-lg shadow-blue-900/40">
                <Trophy size={32} />
              </div>
              <h3 className="font-bold uppercase tracking-widest text-sm text-blue-400">Time 1</h3>
            </div>
            
            <div className="flex items-center gap-8 px-8">
              <span className="text-7xl font-black italic">{selectedMatch.score.team1}</span>
              <span className="text-3xl text-gray-600 font-light">VS</span>
              <span className="text-7xl font-black italic">{selectedMatch.score.team2}</span>
            </div>

            <div className="text-center flex-1">
              <div className="w-16 h-16 bg-red-600 rounded-2xl mx-auto mb-2 flex items-center justify-center shadow-lg shadow-red-900/40">
                <Trophy size={32} />
              </div>
              <h3 className="font-bold uppercase tracking-widest text-sm text-red-400">Time 2</h3>
            </div>
          </div>
          
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-gray-500">
            {new Date(selectedMatch.endTime || 0).toLocaleString('pt-BR')}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <TeamList 
            title="Time 1" 
            players={team1} 
            teamNumber={1} 
            isAdmin={false} 
            onAction={() => {}}
            events={selectedMatch.events}
          />
          <TeamList 
            title="Time 2" 
            players={team2} 
            teamNumber={2} 
            isAdmin={false} 
            onAction={() => {}}
            events={selectedMatch.events}
          />
        </div>

        {selectedMatch.events && selectedMatch.events.length > 0 && (
          <div className="bg-[#121A29] rounded-2xl p-6 border border-white/10">
            <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-4">Relatório da Partida</h3>
            <div className="space-y-3">
              {selectedMatch.events.map((e) => (
                <div key={e.id} className="flex items-center gap-4 text-sm border-b border-white/5 pb-2 last:border-0">
                  <span className="font-mono text-gray-500">{e.minute}'</span>
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center",
                    e.type === 'goal' ? "bg-green-600/20 text-green-400" :
                    e.type === 'yellow' ? "bg-yellow-600/20 text-yellow-400" : "bg-red-600/20 text-red-400"
                  )}>
                    {e.type === 'goal' ? <Goal size={16} /> : e.type === 'yellow' ? <AlertTriangle size={16} /> : <ShieldAlert size={16} />}
                  </div>
                  <span className="font-bold">{e.playerName}</span>
                  <span className="text-gray-500">
                    {e.type === 'goal' ? 'marcou um gol!' : e.type === 'yellow' ? 'recebeu cartão amarelo' : 'recebeu cartão vermelho'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-8">
      <h2 className="text-2xl font-bold mb-8 flex items-center gap-3">
        <Clock className="text-blue-500" /> Histórico de Jogos
      </h2>

      {history.length === 0 ? (
        <div className="text-center py-20 bg-[#121A29] rounded-3xl border border-white/10 border-dashed">
          <Trophy size={48} className="mx-auto mb-4 text-gray-700" />
          <p className="text-gray-500 italic">Nenhuma partida finalizada ainda.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {history.map((m, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => onSelectMatch(m)}
              className="bg-[#121A29] border border-white/10 rounded-2xl p-6 hover:bg-white/5 transition-all cursor-pointer group"
            >
              <div className="flex justify-between items-center mb-4">
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                  {new Date(m.endTime || 0).toLocaleDateString('pt-BR')}
                </span>
                <ChevronRight size={16} className="text-gray-600 group-hover:text-blue-500 transition-colors" />
              </div>
              
              <div className="flex items-center justify-center gap-4 mb-4">
                <div className="text-center">
                  <div className="text-2xl font-black italic">{m.score.team1}</div>
                  <div className="text-[10px] uppercase text-blue-400 font-bold">Time 1</div>
                </div>
                <div className="text-gray-700 font-bold">X</div>
                <div className="text-center">
                  <div className="text-2xl font-black italic">{m.score.team2}</div>
                  <div className="text-[10px] uppercase text-red-400 font-bold">Time 2</div>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Goal size={14} />
                <span>{m.events?.filter(e => e.type === 'goal').length || 0} Gols</span>
                <span className="mx-1">•</span>
                <AlertTriangle size={14} />
                <span>{(m.events?.filter(e => e.type === 'yellow').length || 0) + (m.events?.filter(e => e.type === 'red').length || 0)} Cartões</span>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlayerAvatar({ userId, name, className }: { userId: string, name: string, className?: string }) {
  const [photo, setPhoto] = React.useState<string | null>(null);

  React.useEffect(() => {
    const fetchPhoto = async () => {
      try {
        const docRef = doc(firestore, 'users', userId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setPhoto(docSnap.data().photoBase64);
        }
      } catch (e) {
        console.error("Error fetching player photo:", e);
      }
    };
    fetchPhoto();
  }, [userId]);

  return (
    <div className={cn("rounded-full overflow-hidden bg-[#0C1222] border border-white/10", className)}>
      {photo ? (
        <img src={photo} alt={name} className="w-full h-full object-cover" />
      ) : (
        <UserCircle className="w-full h-full text-gray-700" />
      )}
    </div>
  );
}

function TeamList({ title, players, teamNumber, isAdmin, onAction, events }: { 
  title: string, 
  players: User[], 
  teamNumber: number, 
  isAdmin: boolean, 
  onAction: (p: {id: string, name: string, team: number}) => void,
  events?: MatchEvent[]
}) {
  return (
    <div className="bg-[#121A29] rounded-2xl border border-white/10 overflow-hidden">
      <div className={cn("p-4 font-bold uppercase tracking-widest text-sm", teamNumber === 1 ? "bg-blue-600/10 text-blue-400" : "bg-red-600/10 text-red-400")}>
        {title}
      </div>
      <div className="divide-y divide-white/5">
        {players.map(p => {
          const pEvents = events?.filter(e => e.playerId === p.id) || [];
          const goals = pEvents.filter(e => e.type === 'goal').length;
          const yellows = pEvents.filter(e => e.type === 'yellow').length;
          const reds = pEvents.filter(e => e.type === 'red').length;

          return (
            <div key={p.id} className="p-4 flex items-center justify-between group">
              <div className="flex items-center gap-3">
                <PlayerAvatar userId={p.id} name={p.name} className="w-10 h-10" />
                <div>
                  <div className="font-bold">{p.name}</div>
                  <div className="flex gap-1 mt-1">
                    {Array.from({length: goals}).map((_, i) => <Goal key={i} size={12} className="text-green-500" />)}
                    {Array.from({length: yellows}).map((_, i) => <div key={i} className="w-2 h-3 bg-yellow-400 rounded-sm" />)}
                    {Array.from({length: reds}).map((_, i) => <div key={i} className="w-2 h-3 bg-red-500 rounded-sm" />)}
                  </div>
                </div>
              </div>
              {isAdmin && (
                <button 
                  onClick={() => onAction({id: p.id, name: p.name, team: teamNumber})}
                  className="p-2 text-gray-500 hover:text-white hover:bg-white/5 rounded-lg transition-all"
                >
                  <MoreVertical size={20} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActionModal({ isOpen, onClose, player, onAction }: { 
  isOpen: boolean, 
  onClose: () => void, 
  player: {id: string, name: string, team: number} | null,
  onAction: (type: 'goal' | 'yellow' | 'red', p: {id: string, name: string, team: number}) => void
}) {
  if (!isOpen || !player) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-xs bg-[#121A29] rounded-2xl p-6 border border-white/10 shadow-2xl"
      >
        <div className="text-center mb-6">
          <h3 className="text-lg font-bold">{player.name}</h3>
          <p className="text-xs text-gray-500 uppercase tracking-widest">Registrar Evento</p>
        </div>

        <div className="grid grid-cols-1 gap-3">
          <button 
            onClick={() => onAction('goal', player)}
            className="flex items-center gap-3 p-4 bg-green-600/10 text-green-400 border border-green-600/20 rounded-xl hover:bg-green-600 hover:text-white transition-all font-bold"
          >
            <Goal size={20} /> GOL!
          </button>
          <button 
            onClick={() => onAction('yellow', player)}
            className="flex items-center gap-3 p-4 bg-yellow-600/10 text-yellow-400 border border-yellow-600/20 rounded-xl hover:bg-yellow-600 hover:text-white transition-all font-bold"
          >
            <AlertTriangle size={20} /> Cartão Amarelo
          </button>
          <button 
            onClick={() => onAction('red', player)}
            className="flex items-center gap-3 p-4 bg-red-600/10 text-red-400 border border-red-600/20 rounded-xl hover:bg-red-600 hover:text-white transition-all font-bold"
          >
            <ShieldAlert size={20} /> Cartão Vermelho
          </button>
          <button 
            onClick={onClose}
            className="mt-2 py-3 text-gray-500 hover:text-white font-bold"
          >
            Cancelar
          </button>
        </div>
      </motion.div>
    </div>
  );
}
