'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
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
  X,
  BarChart3,
  TrendingUp,
} from 'lucide-react'

type Props = {
  mobileOpen?: boolean
  onMobileClose?: () => void
}

export default function Sidebar({ mobileOpen = false, onMobileClose }: Props) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [pendingCount, setPendingCount] = useState<number>(0)
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => { setMounted(true) }, [])

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
      await supabase.auth.signOut()
      router.refresh()
      router.replace('/login')
    } catch (error) {
      console.error('Erro ao sair:', error)
    }
  }

  const menuItems: Array<{ name: string; path: string; icon: typeof LayoutDashboard; count?: number }> = [
    { name: 'Dashboard',    path: '/',            icon: LayoutDashboard },
    { name: 'Lançamentos',  path: '/lancamentos', icon: FileText },
    { name: 'Histórico',    path: '/historico',   icon: History },
    { name: 'Pendências',   path: '/pendencias',  icon: AlertTriangle, count: pendingCount },
    { name: 'Inteligência',           path: '/inteligencia',        icon: Brain },
    { name: 'Relatório Trimestral',  path: '/relatorio-trimestral', icon: BarChart3 },
    { name: 'Análises',              path: '/analises',             icon: TrendingUp },
    { name: 'Relatórios Personalizáveis', path: '/relatorios',      icon: MessageSquare },
  ]

  const asideClasses = [
    // base
    'bg-white border-r border-gray-200 flex flex-col transition-all duration-300 ease-in-out overflow-hidden z-40',
    // mobile: fixed full-height drawer from the left
    'fixed inset-y-0 left-0 w-72',
    mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
    // desktop: sticky, collapsible, no translate
    'md:sticky md:top-0 md:h-screen md:shadow-none md:translate-x-0',
    !isCollapsed ? 'md:w-64' : 'md:w-20',
  ].join(' ')

  return (
    <aside className={asideClasses}>
      {/* Header */}
      <div className={`p-4 flex items-center h-16 gap-2 ${!isCollapsed ? 'md:justify-between' : 'md:justify-center'}`}>
        {!isCollapsed && (
          <span className="text-lg font-bold text-[#1e6a8d] tracking-tight truncate hidden md:block whitespace-nowrap">
            Chamados a Servir
          </span>
        )}
        {/* Mobile: nome + botão fechar */}
        <div className="flex items-center justify-between w-full md:hidden">
          <span className="text-lg font-bold text-[#1e6a8d] tracking-tight">Chamados a Servir</span>
          <button
            onClick={onMobileClose}
            className="p-2 rounded-full hover:bg-gray-100 text-gray-400"
          >
            <X size={20} />
          </button>
        </div>
        {/* Desktop: botão colapsar */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-2 rounded-full hover:bg-gray-100 text-gray-400 hover:text-[#1e6a8d] transition-colors hidden md:block flex-shrink-0"
        >
          {isCollapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 space-y-1 mt-2 overflow-y-auto">
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
              onClick={onMobileClose}
              className={[
                'flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all relative group',
                // mobile: always show label
                'justify-start',
                // desktop collapsed: center icon
                isCollapsed ? 'md:justify-center' : 'md:justify-start',
                isActive
                  ? 'bg-[#1e6a8d] text-white shadow-md'
                  : 'text-gray-500 hover:bg-gray-50 hover:text-[#1e6a8d]',
              ].join(' ')}
            >
              <span className="relative flex-shrink-0">
                <item.icon size={21} className={isActive ? 'text-white' : ''} />
                {item.count != null && item.count > 0 && isCollapsed && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500 border border-white" />
                )}
              </span>

              {/* Label: always visible on mobile, hidden when desktop collapsed */}
              <span className={[
                'font-semibold text-sm antialiased whitespace-nowrap flex items-center gap-2',
                isActive ? 'text-white' : '',
                isCollapsed ? 'hidden md:hidden' : 'flex md:flex',
              ].join(' ')}>
                {item.name}
                {item.count != null && item.count > 0 && (
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold leading-none ${
                    isActive ? 'bg-white/25 text-white' : 'bg-red-500 text-white'
                  }`}>
                    {item.count > 99 ? '99+' : item.count}
                  </span>
                )}
              </span>

              {/* Tooltip when desktop collapsed */}
              {isCollapsed && (
                <div className="absolute left-full ml-3 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 pointer-events-none shadow-xl hidden md:block">
                  {item.name}
                </div>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Logout */}
      <div className="p-3 border-t border-gray-100 bg-gray-50/50">
        <button
          onClick={handleLogout}
          className={[
            'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-gray-500 hover:bg-red-50 hover:text-red-600 transition-all',
            isCollapsed ? 'md:justify-center' : 'md:justify-start',
          ].join(' ')}
        >
          <LogOut size={21} className="flex-shrink-0" />
          <span className={`font-semibold text-sm whitespace-nowrap ${isCollapsed ? 'md:hidden' : ''}`}>
            Sair do Sistema
          </span>
        </button>
      </div>
    </aside>
  )
}
