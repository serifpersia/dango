import { render } from 'preact'
import { BrowserRouter } from 'react-router'
import App from './App'
import './styles/base.css'
import { SidebarProvider } from './contexts/SidebarProvider'
import { ContentTypeProvider } from './contexts/ContentTypeProvider'
import { TitlePreferenceProvider } from './contexts/TitlePreferenceProvider'
import { LowEndModeProvider } from './contexts/LowEndModeProvider'
import { ThemeProvider } from './contexts/ThemeProvider'
import { AnimePaheCookieProvider } from './contexts/AnimePaheCookieProvider'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TRPCProvider, trpcClient } from './lib/trpc'

try {
  window.history.scrollRestoration = 'manual'
} catch {
  // ignore
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      refetchOnWindowFocus: false,
      refetchIntervalInBackground: false,
      retry: 1,
    },
  },
})

const root = document.getElementById('root')
if (root) {
  render(
    <BrowserRouter>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <AnimePaheCookieProvider>
            <SidebarProvider>
              <ContentTypeProvider>
                <TitlePreferenceProvider>
                  <LowEndModeProvider>
                    <ThemeProvider>
                      <App />
                    </ThemeProvider>
                  </LowEndModeProvider>
                </TitlePreferenceProvider>
              </ContentTypeProvider>
            </SidebarProvider>
          </AnimePaheCookieProvider>
        </QueryClientProvider>
      </TRPCProvider>
    </BrowserRouter>,
    root
  )
}
