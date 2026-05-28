'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Sidebar from './components/Sidebar'
import { Menu } from 'lucide-react'

export default function LayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(true)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const isLoginPage = pathname === '/login'
  const supabase = createClient()

  useEffect(() => {
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session && !isLoginPage) router.push('/login')
      else if (session && isLoginPage) router.push('/')
      setIsLoading(false)
    }
    checkUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session && !isLoginPage) router.push('/login')
      setIsLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [isLoginPage, router, supabase])

  if (isLoading && !isLoginPage) {
    return (
      <div className="h-screen w-screen bg-gray-50 flex items-center justify-center">
        Carregando...
      </div>
    )
  }

  return (
    <div className="flex min-h-screen">
      {!isLoginPage && (
        <>
          {/* Mobile backdrop */}
          {mobileMenuOpen && (
            <div
              className="fixed inset-0 bg-black/40 z-30 md:hidden"
              onClick={() => setMobileMenuOpen(false)}
            />
          )}
          <Sidebar
            mobileOpen={mobileMenuOpen}
            onMobileClose={() => setMobileMenuOpen(false)}
          />
        </>
      )}

      <main className={`flex-1 min-h-screen overflow-y-auto ${isLoginPage ? 'bg-[#f3f4f6]' : 'bg-gray-50/50'}`}>
        {/* Mobile top bar */}
        {!isLoginPage && (
          <div className="md:hidden sticky top-0 z-20 bg-white border-b border-gray-200 h-14 flex items-center px-4 gap-3 shadow-sm">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
              aria-label="Abrir menu"
            >
              <Menu size={22} />
            </button>
            <span className="text-base font-bold text-[#1e6a8d]">Chamados a Servir</span>
          </div>
        )}

        <div className={isLoginPage ? '' : 'px-4 py-4 md:px-8 md:py-6 w-full'}>
          {children}
        </div>
      </main>
    </div>
  )
}
