import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface User {
  id: string;
  name: string;
}

interface TeamCardProps {
  number: number;
  players: (User | { id: string, name: string })[];
  color: string;
  accent: string;
}

export function TeamCard({ number, players, color, accent }: TeamCardProps) {
  return (
    <motion.section 
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        "bg-[#121A29] border border-white/10 overflow-hidden rounded-2xl shadow-xl transition-all hover:border-white/20",
        accent
      )}
    >
      <div className={cn("p-5 text-white flex justify-between items-center relative overflow-hidden", color)}>
        {/* Decorative background element */}
        <div className="absolute -right-4 -top-4 opacity-10 rotate-12">
          <div className="w-24 h-24 bg-white rounded-full" />
        </div>
        
        <div className="relative z-10">
          <h2 className="font-black uppercase tracking-tighter text-2xl italic">Time {number}</h2>

        </div>
        <div className="relative z-10 bg-black/20 backdrop-blur-sm px-3 py-1 rounded-full border border-white/10">
          <span className="font-mono text-xs font-bold">{players.length} <span className="opacity-60">Jogadores</span></span>
        </div>
      </div>
      <div className="p-2 min-h-[240px] bg-gradient-to-b from-transparent to-black/20">
        <ul className="space-y-1">
          <AnimatePresence mode="popLayout">
            {players.map((p, i) => (
              <motion.li
                key={p.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ delay: i * 0.05 }}
                className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 transition-colors group"
              >
                <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-xs font-black italic border border-white/10 group-hover:border-white/20 transition-all">
                  {i + 1}
                </div>
                <div className="flex-1 overflow-hidden">
                  <span className="font-bold text-sm block truncate">{p.name}</span>
                  {'position' in p && p.position && (
                    <span className="text-[10px] text-gray-500 uppercase font-bold tracking-tighter">{p.position}</span>
                  )}
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
          {players.length === 0 && (
            <div className="h-48 flex flex-col items-center justify-center text-gray-600 italic text-sm gap-3">
              <div className="w-12 h-12 rounded-full border-2 border-dashed border-gray-800 flex items-center justify-center">
                <span className="text-xl">?</span>
              </div>
              <p className="font-medium opacity-40">Aguardando convocação...</p>
            </div>
          )}
        </ul>
      </div>
    </motion.section>
  );
}
