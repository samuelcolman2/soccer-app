import { motion, AnimatePresence } from 'motion/react';
import { UserCircle, X, Camera, RefreshCw } from 'lucide-react';
import { useState, useEffect, useRef, type ChangeEvent } from 'react';
import { ref, update } from 'firebase/database';
import { doc, setDoc } from 'firebase/firestore';
import { db, firestore } from '../firebase';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  photoUrl?: string;
  position?: string;
}

interface UserStats {
  matches: number;
  goals: number;
  yellowCards: number;
  redCards: number;
}

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
  onUpdate: (u: User) => void;
  stats: UserStats;
}

export function ProfileModal({ isOpen, onClose, user, onUpdate, stats }: ProfileModalProps) {
  const [name, setName] = useState(user.name);
  const [photo, setPhoto] = useState(user.photoUrl || '');
  const [position, setPosition] = useState(user.position || '');
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setName(user.name);
      setPhoto(user.photoUrl || '');
      setPosition(user.position || '');
    }
  }, [isOpen, user]);

  const formatName = (str: string) => {
    return str.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        const maxSize = 400;
        if (width > height) {
          if (width > maxSize) {
            height *= maxSize / width;
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width *= maxSize / height;
            height = maxSize;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);

        let quality = 0.9;
        let base64 = canvas.toDataURL('image/jpeg', quality);
        
        while (base64.length > 200 * 1024 && quality > 0.1) {
          quality -= 0.1;
          base64 = canvas.toDataURL('image/jpeg', quality);
        }

        setPhoto(base64);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    setIsSaving(true);
    const formattedName = formatName(name);
    
    try {
      await update(ref(db, `users/${user.id}`), {
        name: formattedName,
        position: position
      });

      if (photo) {
        await setDoc(doc(firestore, 'users', user.id), {
          photoBase64: photo
        });
      }

      onUpdate({ ...user, name: formattedName, photoUrl: photo, position: position });
      onClose();
    } catch (err) {
      console.error("Error saving profile:", err);
      alert("Erro ao salvar perfil.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="w-full max-w-md bg-[#121A29] rounded-2xl shadow-2xl border border-white/10 overflow-hidden flex flex-col max-h-[90vh]"
          >
            <div className="p-6 flex justify-between items-center border-b border-white/5 shrink-0">
              <h2 className="text-xl font-bold text-center flex-1">Editar Perfil</h2>
              <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                <X size={24} />
              </button>
            </div>

            <div className="p-8 space-y-8 overflow-y-auto custom-scrollbar">
              <div className="flex flex-col items-center gap-4">
                <div className="relative group">
                  <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-blue-600/20 bg-[#0C1222] flex items-center justify-center">
                    {photo ? (
                      <img src={photo} alt="Profile" className="w-full h-full object-cover" />
                    ) : (
                      <UserCircle size={80} className="text-gray-600" />
                    )}
                  </div>
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="absolute bottom-0 right-0 bg-blue-600 p-2 rounded-full shadow-lg hover:bg-blue-500 transition-colors"
                  >
                    <Camera size={20} />
                  </button>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleFileChange} 
                    accept="image/*" 
                    className="hidden" 
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Nome Completo</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-[#1B2436] border border-white/10 rounded-xl py-3.5 px-4 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all text-sm"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Posição Preferida</label>
                <select
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                  className="w-full bg-[#1B2436] border border-white/10 rounded-xl py-3.5 px-4 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all text-sm text-white appearance-none"
                >
                  <option value="" disabled>Selecione sua posição</option>
                  <option value="Goleiro">Goleiro</option>
                  <option value="Defensor">Defensor</option>
                  <option value="Meio-campo">Meio-campo</option>
                  <option value="Atacante">Atacante</option>
                </select>
              </div>

              {/* Career Stats */}
              <div className="grid grid-cols-2 gap-4 pt-2">
                <div className="bg-[#0C1222] p-4 rounded-xl border border-white/5 text-center">
                  <div className="text-2xl font-black italic text-blue-500">{stats.matches}</div>
                  <div className="text-[10px] uppercase font-bold text-gray-500 tracking-widest">Partidas</div>
                </div>
                <div className="bg-[#0C1222] p-4 rounded-xl border border-white/5 text-center">
                  <div className="text-2xl font-black italic text-green-500">{stats.goals}</div>
                  <div className="text-[10px] uppercase font-bold text-gray-500 tracking-widest">Gols</div>
                </div>
                <div className="bg-[#0C1222] p-4 rounded-xl border border-white/5 text-center">
                  <div className="text-2xl font-black italic text-yellow-500">{stats.yellowCards}</div>
                  <div className="text-[10px] uppercase font-bold text-gray-500 tracking-widest">Amarelos</div>
                </div>
                <div className="bg-[#0C1222] p-4 rounded-xl border border-white/5 text-center">
                  <div className="text-2xl font-black italic text-red-500">{stats.redCards}</div>
                  <div className="text-[10px] uppercase font-bold text-gray-500 tracking-widest">Vermelhos</div>
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <button
                  onClick={onClose}
                  className="flex-1 bg-white/5 hover:bg-white/10 text-white font-bold py-3.5 rounded-xl transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="flex-1 bg-[#0E46C7] hover:bg-blue-600 text-white font-bold py-3.5 rounded-xl transition-all shadow-lg shadow-blue-900/20 flex items-center justify-center gap-2"
                >
                  {isSaving ? <RefreshCw className="animate-spin" /> : "Salvar Alterações"}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
