'use client'

// Removi a linha errada que estava aqui
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
// CORREÇÃO 1: Importar do seu lib local
import { createClient } from '../../lib/supabase/client' 
import {
  LayoutDashboard,
  History,
  FileText,
  MessageSquare,
  LogOut,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Brain,
} from 'lucide-react'

export default function Sidebar() {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [pendingCount, setPendingCount] = useState<number>(0)
  const pathname = usePathname()
  const router = useRouter() // <--- Essa é a correta, mantenha esta.

  // CORREÇÃO 2: Instanciar usando o helper correto do Next.js
  const supabase = createClient()

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    async function loadPendingCount() {
      const { data } = await supabase.rpc('get_pending_count')
      if (data != null) setPendingCount(data)
    }
    loadPendingCount()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleLogout = async () => {
    try {
      // 1. Remove o token dos cookies e do local storage
      await supabase.auth.signOut()
      
      // 2. Atualiza o estado do servidor (Middleware vai perceber que não tem mais cookie)
      router.refresh()
      
      // 3. Redireciona para o login (replace é melhor que push aqui para não voltar no "Back")
      router.replace('/login') 
      
    } catch (error) {
      console.error('Erro ao sair:', error)
    }
  }

  const menuItems: Array<{ name: string; path: string; icon: typeof LayoutDashboard; badge?: string; count?: number }> = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard },
    { name: 'Lançamentos', path: '/lancamentos', icon: FileText },
    { name: 'Histórico', path: '/historico', icon: History },
    { name: 'Pendências', path: '/pendencias', icon: AlertTriangle, count: pendingCount },
    { name: 'Inteligência', path: '/inteligencia', icon: Brain },
    { name: 'Relatórios', path: '/relatorios', icon: MessageSquare },
  ]

  return (
    <aside 
      className={`
        bg-white border-r border-gray-200 h-screen flex flex-col transition-all duration-300 ease-in-out sticky top-0 z-40 overflow-hidden
        w-20 ${!isCollapsed ? 'md:w-64' : ''}
      `}
    >
      <div className={`
        p-4 flex items-center h-20 transition-all duration-300
        ${!isCollapsed ? 'justify-center md:justify-between' : 'justify-center'}
      `}>
        {!isCollapsed && (
          <span className="text-xl font-bold text-[#1e6a8d] tracking-tight ml-2 truncate hidden md:block whitespace-nowrap">
            Chamados a Servir
          </span>
        )}
        <button 
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-2 rounded-full hover:bg-gray-100 text-gray-400 hover:text-[#1e6a8d] transition-colors ml-auto hidden md:block"
        >
          {isCollapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
        </button>
      </div>

      <nav className="flex-1 px-3 space-y-2 mt-4">
        {menuItems.map((item) => {
          const isDashboard = item.name === 'Dashboard'
          const isActive = mounted && (
            pathname === item.path || 
            (isDashboard && pathname?.includes('dashboard')) ||
            (item.path !== '/' && pathname?.startsWith(item.path))
          )
          
          return (
            <Link
              key={item.path}
              href={item.path}
              className={`
                flex items-center gap-3 px-3 py-3 rounded-xl transition-all relative group
                justify-center ${!isCollapsed ? 'md:justify-start' : ''}
                ${isActive 
                  ? 'bg-[#1e6a8d] text-white shadow-md' 
                  : 'text-gray-500 hover:bg-gray-50 hover:text-[#1e6a8d]'
                }
              `}
            >
              <span className="relative flex-shrink-0">
                <item.icon
                  size={22}
                  className={isActive ? 'text-white' : ''}
                />
                {item.count != null && item.count > 0 && isCollapsed && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500 border border-white" />
                )}
              </span>
              
              {!isCollapsed && (
                <span className={`
                  font-semibold text-sm antialiased whitespace-nowrap hidden md:flex items-center gap-2 transition-opacity duration-300
                  ${isActive ? 'text-white' : ''}
                `}>
                  {item.name}
                  {item.badge && (
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold leading-none ${
                      isActive ? 'bg-white/25 text-white' : 'bg-amber-100 text-amber-800'
                    }`}>
                      {item.badge}
                    </span>
                  )}
                  {item.count != null && item.count > 0 && (
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold leading-none ${
                      isActive ? 'bg-white/25 text-white' : 'bg-red-500 text-white'
                    }`}>
                      {item.count > 99 ? '99+' : item.count}
                    </span>
                  )}
                </span>
              )}

              <div className={`
                absolute left-full ml-4 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg 
                opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 pointer-events-none shadow-xl
                ${!isCollapsed ? 'md:hidden' : 'block'}
              `}>
                {item.name}
              </div>
            </Link>
          )
        })}
      </nav>

      <div className="p-4 border-t border-gray-100 bg-gray-50/50">
        <button
          onClick={handleLogout}
          className={`
            w-full flex items-center gap-3 px-3 py-3 rounded-xl text-gray-500 hover:bg-red-50 hover:text-red-600 transition-all group relative
            justify-center ${!isCollapsed ? 'md:justify-start' : ''}
          `}
        >
          <LogOut size={22} className="flex-shrink-0" />
          {!isCollapsed && (
            <span className="font-semibold text-sm hidden md:block whitespace-nowrap">
              Sair do Sistema
            </span>
          )}
        </button>
      </div>
    </aside>
  )
}